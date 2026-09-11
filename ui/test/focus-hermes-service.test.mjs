import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,cpSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ProblemStore} from '../server/focus/store.mjs';
import {ProblemService} from '../server/focus/service.mjs';
import {ToolRuntime} from '../server/focus/tools/runtime.mjs';
import {formatExecutionAnswer} from '../server/focus/answer-format.mjs';

const tick=()=>new Promise(setImmediate);
const final={reply:'Synthetic deliverable.',memories:[],execution:{status:'completed'}};
test('visual pixels reach the native loop without entering app sources or context',async t=>{
 const f=await fixture(t),image='data:image/png;base64,c3ludGhldGlj';f.client.runsTools=true;f.client.supportsToolImages=true;
 f.tools.execute=async()=>({tool:'browser.view',result:{page:'synthetic',image}});
 f.client.answer=async(c,s,p,execute)=>{
  assert(c.capabilities.tools.some(tool=>tool.name==='browser.view'));
  assert.equal((await execute({tool:'browser.view',arguments:{}},s)).image,image);
  assert(!JSON.stringify(c).includes(image));return final;
 };
 await f.service.call('acceptPlan');assert(!JSON.stringify(f.store.snapshot()).includes(image));
});
test('paged browser results keep valid JSON and their continuation cursor in saved sources',async t=>{
 const f=await fixture(t);
 const outcome={tool:'browser.read',destination:'https://example.com',result:{page:'synthetic-page',snapshot:'x'.repeat(12500),snapshotId:'synthetic-snapshot',offset:0,nextOffset:12500,totalLength:25000,truncated:true}};
 f.tools.execute=async()=>outcome;
 f.client.runsTools=true;f.client.answer=async(c,s,p,execute)=>{
  const result=await execute({tool:'browser.read',arguments:{page:'synthetic-page'}},s);
  assert.deepEqual(JSON.parse(result.result),outcome);
  return final;
 };
 await f.service.call('acceptPlan');
 const source=f.store.snapshot().entries.find(e=>e.kind==='source'&&e.title==='Tool result: browser.read');
 assert.deepEqual(JSON.parse(source.text),outcome);
});
test('accepted plans gather context only and leave scheduled actions empty',async t=>{
 const f=await fixture(t);let calls=0;
 f.tools.execute=async(action,options)=>{calls++;assert.equal(options.researchOnly,true);return {tool:action.tool,result:[]};};
 f.client.runsTools=true;f.client.answer=async(c,s,p,execute)=>{
  assert.equal(c.researchOnly,true);
  assert.ok(!c.capabilities.tools.some(t=>['api.request','mcp.call'].includes(t.name)));
  assert.ok(c.capabilities.tools.some(t=>t.name==='browser.select'));
  await execute({tool:'memory.search',arguments:{query:'Synthetic context'}},s);
  return {...final,scheduledActions:[{task:'Must not be scheduled'}]};
 };
 const result=await f.service.call('acceptPlan');
 assert.equal(calls,1);assert.equal(result.execution.researchOnly,true);assert.deepEqual(result.execution.scheduledActions,[]);
});
test('incomplete results can explicitly continue, but completed results cannot replay',async t=>{
 const f=await fixture(t);let turns=0;f.client.answer=async()=>{turns++;return final;};
 f.service.execution.save({status:'blocked',question:'',reply:'Synthetic partial result.'});
 assert.equal(turns,0);
 const result=await f.service.call('continuePlan');
 assert.equal(result.execution.status,'completed');assert.equal(turns,1);
 await assert.rejects(f.service.call('continuePlan'),/no paused plan/);assert.equal(turns,1);
});
test('a recovered browser failure gets a continuation before an incomplete result',async t=>{
 const f=await fixture(t);let turns=0;
 f.tools.execute=async action=>({tool:action.tool,destination:'https://example.com/',actionState:'not_performed',recovered:true,result:{page:'synthetic-page',snapshot:'- link "Overview" [ref=e1]'}});
 f.client.runsTools=true;f.client.answer=async(c,s,p,execute)=>{
  if(++turns===1){await execute({tool:'browser.click',arguments:{page:'synthetic-page'}},s);return {...final,execution:{status:'blocked'}};}
  assert.ok(c.browserContinuation);return final;
 };
 const result=await f.service.call('acceptPlan');
 assert.equal(turns,2);assert.equal(result.execution.status,'completed');
});
async function blockedRouteGate(t,Service=ProblemService,diagnostic='review_required'){
 const f=await fixture(t,Service);let turns=0,clicks=0,reads=0;
 f.tools.execute=async action=>{
  if(action.tool==='browser.click'){clicks++;const error=new Error('Synthetic route unavailable.');error.code='RESEARCH_ONLY';error.diagnostic=diagnostic;if(diagnostic==='target_unresolved')error.actionState='not_performed';throw error;}
  reads++;return {tool:action.tool,result:{snapshot:'Synthetic independent schedule evidence'}};
 };
 f.client.runsTools=true;f.client.answer=async(c,s,p,execute)=>{
  if(++turns===1){const result=await execute({tool:'browser.click',arguments:{page:'synthetic'}},s);assert.equal(result.diagnostic,diagnostic);return {...final,execution:{status:'blocked'}};}
  assert(c.browserContinuation);assert.match(c.browserContinuation.instruction,/must not be repeated/);
  assert.equal(c.toolResults[0].diagnostic,diagnostic);assert.equal(c.toolResults[0].blocked,true);
  if(diagnostic==='target_unresolved')assert.equal(c.toolResults[0].actionState,'not_performed');
  await execute({tool:'browser.read',arguments:{page:'independent'}},s);return final;
 };
 const result=await f.service.call('acceptPlan');assert.equal(turns,2);assert.equal(clicks,1);assert.equal(reads,1);assert.equal(result.execution.status,'completed');
}
test('a blocked research route continues independent work without replaying the action',t=>blockedRouteGate(t));
test('an unresolved control preserves its not-performed diagnostic through continuation',t=>blockedRouteGate(t,ProblemService,'target_unresolved'));
test('mutation proof: research route blocks must reach independent-work continuation',async t=>{
 await blockedRouteGate(t);
 const dir=mkdtempSync(join(tmpdir(),'onejob-route-gate-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const original=new URL('../server/focus/service.mjs',import.meta.url),branch="if(execute&&result.execution?.status==='blocked'&&canContinue('browser',context.toolResults))";
 let source=readFileSync(original,'utf8');assert(source.includes(branch));source=source.replace(branch,'if(false)').replace(/from '(\.[^']+)'/gu,(_,relative)=>"from '"+new URL(relative,original).href+"'");
 const path=join(dir,'service.mjs');writeFileSync(path,source);
 const {ProblemService:Broken}=await import(pathToFileURL(path));await assert.rejects(blockedRouteGate(t,Broken),assert.AssertionError);
});
test('blocked-route continuation stops when no new evidence arrives',async t=>{
 const f=await fixture(t);let turns=0,clicks=0;
 f.tools.execute=async()=>{clicks++;const error=new Error('Synthetic route unavailable.');error.code='RESEARCH_ONLY';throw error;};
 f.client.runsTools=true;f.client.answer=async(c,s,p,execute)=>{if(++turns===1)await execute({tool:'browser.click',arguments:{page:'synthetic'}},s);return {...final,execution:{status:'blocked'}};};
 const result=await f.service.call('acceptPlan');assert.equal(turns,2);assert.equal(clicks,1);assert.equal(result.execution.status,'blocked');
});
async function formattingGate(t,Service=ProblemService){
 const f=await fixture(t,Service);let turns=0;
 const formatted=await formatExecutionAnswer({unformattedAnswer:'Synthetic finished answer.'},{},{answer:async()=>{throw new Error('Synthetic formatter unavailable');}});
 f.tools.execute=async action=>({tool:action.tool,actionState:'not_performed',recovered:true,result:{page:'synthetic',snapshot:'Synthetic recovered view'}});
 f.client.runsTools=true;f.client.answer=async(c,s,p,execute)=>{turns++;await execute({tool:'browser.click',arguments:{page:'synthetic'}},s);return formatted;};
 const result=await f.service.call('acceptPlan');assert.equal(turns,1);assert.match(result.execution.reply,/Synthetic finished answer/);assert.equal(result.execution.status,'blocked');
}
test('unavailable answer formatting never restarts research after a recovered browser failure',t=>formattingGate(t));
test('mutation proof: a formatting failure cannot enter the research recovery loop',async t=>{
 await formattingGate(t);
 const dir=mkdtempSync(join(tmpdir(),'onejob-format-gate-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const original=new URL('../server/focus/service.mjs',import.meta.url),guard='if(result[answerFormattingIncomplete])break;';
 let source=readFileSync(original,'utf8');assert(source.includes(guard));source=source.replace(guard,'').replace(/from '(\.[^']+)'/gu,(_,relative)=>"from '"+new URL(relative,original).href+"'");
 const path=join(dir,'service.mjs');writeFileSync(path,source);
 const {ProblemService:Broken}=await import(pathToFileURL(path));await assert.rejects(formattingGate(t,Broken),assert.AssertionError);
});
test('a model JSON formatting-warning property cannot skip normal research recovery',async t=>{
 const f=await fixture(t);let turns=0;
 f.tools.execute=async action=>({tool:action.tool,actionState:'not_performed',recovered:true,result:{page:'synthetic',snapshot:'Synthetic recovered view'}});
 f.client.runsTools=true;f.client.answer=async(c,s,p,execute)=>{if(++turns===1){await execute({tool:'browser.click',arguments:{page:'synthetic'}},s);return {...final,formattingWarning:'model text',execution:{status:'blocked'}};}return final;};
 await f.service.call('acceptPlan');assert.equal(turns,2);
});
test('browser continuation is bounded and never pretends unresolved work finished',async t=>{
 const f=await fixture(t);let turns=0;
 f.tools.execute=async action=>({tool:action.tool,actionState:'uncertain',recovered:true,result:{page:'synthetic-page',snapshot:'Synthetic view'}});
 f.client.runsTools=true;f.client.answer=async(c,s,p,execute)=>{turns++;await execute({tool:'browser.click',arguments:{page:'synthetic-page'}},s);return {...final,execution:{status:'blocked'}};};
 const result=await f.service.call('acceptPlan');
 assert.equal(turns,2);assert.equal(result.execution.status,'blocked');
});
test('Auto off rejects a premature screenshot request and lets the agent retrieve instead',async t=>{
 const f=await fixture(t);let turns=0,checks=0;
 f.client.runsTools=true;f.client.answer=async(c,s,p,execute)=>{
  if(c.phase==='inputReview'){checks++;return {decision:'retrieve'};}
  if(++turns===1)return {reply:'Navigation failed.',memories:[],execution:{status:'needs_input',question:'Can you send dashboard screenshots?'}};
  assert.ok(c.handoffContinuation);
  await execute({tool:'memory.search',arguments:{query:'synthetic'}},s);return final;
 };
 const result=await f.service.call('acceptPlan');
 assert.equal(turns,2);assert.equal(checks,1);assert.equal(result.execution.status,'completed');
 assert.equal(f.events.some(e=>e.event==='toolApproval'),false);
});
test('an unverified repeated handoff is blocked rather than asking or looping forever',async t=>{
 const f=await fixture(t);let turns=0;
 f.client.answer=async c=>c.phase==='inputReview'?{decision:'access_blocker',source_id:'invented',quote:'Access denied'}:(turns++,{reply:'Partial work.',memories:[],execution:{status:'needs_input',question:'Send screenshots?'}});
 const result=await f.service.call('acceptPlan');
 assert.equal(turns,2);assert.equal(result.execution.status,'blocked');assert.equal(result.execution.question,'');
 assert.equal(result.onboarding.stage,'results');
});
test('legacy questions are retired without deleting notes or starting a job',async t=>{
 const f=await fixture(t);f.service.execution.save({status:'needs_input',question:'Send dashboard screenshots?',reply:'Partial work.'});
 const before=f.store.snapshot().entries.length;let calls=0;f.client.answer=async()=>{calls++;return final;};
 const reopened=new ProblemService(f.store,{chatgpt:f.client},{tools:f.tools});
 assert.equal(reopened.flow.state().stage,'executionPaused');assert.equal(reopened.execution.state().question,'Send dashboard screenshots?');
 assert.equal(f.store.snapshot().entries.length,before);assert.equal(calls,0);
});
test('a verified security challenge can ask with Auto off and survives restart',async t=>{
 const f=await fixture(t);let turns=0;
 f.tools.execute=async action=>({tool:action.tool,destination:'https://example.com',result:{page:'synthetic-page',snapshot:'Use your security key to verify your identity. '+'Synthetic detail '.repeat(1000)}});
 f.client.runsTools=true;f.client.answer=async(c,s,p,execute)=>{
  if(c.phase==='inputReview'){
   assert.equal(c.observations.length,1,'long page results remain available for evidence checking');
   return {decision:'access_blocker',source_id:c.observations[0].source_id,quote:'Use your security key to verify your identity.'};
  }
  turns++;await execute({tool:'browser.read',arguments:{page:'synthetic-page'}},s);
  return {reply:'The page requires a security key.',memories:[],execution:{status:'needs_input',question:'Can you confirm the security-key challenge in the browser?'}};
 };
 const result=await f.service.call('acceptPlan');
 assert.equal(turns,1);assert.equal(result.execution.status,'needs_input');assert.equal(result.execution.inputReviewVersion,1);
 const reopened=new ProblemService(f.store,{chatgpt:f.client},{tools:f.tools});
 assert.equal(reopened.flow.state().stage,'needsInput');
});
test('Stop during handoff review discards the question',async t=>{
 const f=await fixture(t);
 f.client.answer=async c=>{
  if(c.phase==='inputReview'){f.service.stop();return {decision:'user_decision'};}
  return {reply:'Synthetic draft.',memories:[],execution:{status:'needs_input',question:'Which tone?'}};
 };
 await assert.rejects(f.service.call('acceptPlan'));
 assert.equal(f.service.flow.state().stage,'executionPaused');assert.equal(f.service.execution.state(),null);
});
test('Auto skips an unapproved action and continues useful work without an approval dialog',async t=>{
 const f=await fixture(t);f.tools.setAutoMode(f.store.active().id,true);
 f.client.runsTools=true;f.client.answer=async(c,s,p,execute)=>{
  assert.equal(c.autoMode,true);
  const blocked=await execute(f.action,s);assert.match(blocked.error,/only gathers context/);
  const note=await execute({tool:'document.save',arguments:{name:'progress.md',text:'Synthetic progress'}},s);
  assert.equal(note.tool,'document.save');return final;
 };
 const result=await f.service.call('acceptPlan');
 assert.equal(result.execution.status,'completed');assert.deepEqual(f.counts(),{writes:0,secrets:0});
 assert.match(result.execution.reply,/Synthetic deliverable/);
 assert.equal(f.events.some(e=>e.event==='toolApproval'),false);
 assert.equal(f.tools.snapshot().actions.find(a=>a.tool==='api.request').status,'blocked');
});
test('Auto gives routine questions one continuation, then records a blocker instead of asking',async t=>{
 const f=await fixture(t);f.tools.setAutoMode(f.store.active().id,true);let calls=0;
 f.client.answer=async c=>{calls++;assert.equal(c.autoMode,true);return {reply:'Synthetic partial work.',memories:[],next_question:'Which color?',execution:{status:'needs_input',question:'Which color?'}};};
 const result=await f.service.call('acceptPlan');
 assert.equal(calls,2);assert.equal(result.execution.status,'blocked');assert.equal(result.execution.question,'');
 assert.equal(result.onboarding.stage,'results');assert.doesNotMatch(result.execution.reply,/Which color/);
 assert.equal(f.events.some(e=>e.event==='toolApproval'),false);
});
test('Auto can resolve a routine choice and return useful completed work',async t=>{
 const f=await fixture(t);f.tools.setAutoMode(f.store.active().id,true);let calls=0;
 f.client.answer=async c=>{
  if(++calls===1)return {reply:'Synthetic draft.',memories:[],execution:{status:'needs_input',question:'Should the draft be brief?'}};
  assert.ok(c.autoContinuation);return {...final,reply:'A brief synthetic draft. Brevity is an assumption.'};
 };
 const result=await f.service.call('acceptPlan');
 assert.equal(calls,2);assert.equal(result.execution.status,'completed');assert.equal(result.execution.question,'');
 assert.equal(result.onboarding.stage,'results');assert.match(result.execution.reply,/assumption/);
});
test('a failed route does not override completion through an independent route',async t=>{
 const f=await fixture(t);f.tools.setAutoMode(f.store.active().id,true);const execute=f.tools.execute.bind(f.tools);
 f.tools.execute=async(action,context)=>{if(action.tool==='browser.read'){const error=new Error('Synthetic unavailable browser');error.code='BROWSER_RECOVERY_FAILED';throw error;}return execute(action,context);};
 f.client.runsTools=true;f.client.answer=async(c,s,p,run)=>{
  assert.equal((await run({tool:'browser.read',arguments:{}},s)).blocked,true);
  assert.equal((await run({tool:'document.save',arguments:{name:'partial.md',text:'Synthetic useful result'}},s)).tool,'document.save');
  return final;
 };
 const result=await f.service.call('acceptPlan');
 assert.equal(result.execution.status,'completed');assert.equal(result.onboarding.stage,'results');
 assert.equal(f.events.some(e=>e.event==='toolApproval'),false);
});
async function fixture(t,Service=ProblemService){
 const dir=mkdtempSync(join(tmpdir(),'onejob-hermes-service-')),store=new ProblemStore(join(dir,'test.sqlite')),events=[];
 let writes=0,secrets=0;
 const tools=new ToolRuntime(store,dir,{emit:e=>events.push(e),credentials:{resolve:async()=>{secrets++;return '';}},api:async()=>{writes++;return {synthetic:'saved'};}});
 const client={account:async()=>({connected:true}),answer:async()=>({reply:'Synthetic plan.',memories:[]})};
 const service=new Service(store,{chatgpt:client},{tools,emit:e=>events.push(e)});
 t.after(async()=>{service.stop();await tools.close();store.close();rmSync(dir,{recursive:true,force:true});});
 await service.call('newJob');await service.call('modelReady');await service.call('describe',{text:'Synthetic task.'});service.clarification.save([]);await service.call('research');
 const c=tools.connections.save({kind:'api',name:'Synthetic API',url:'https://api.example.com',account:'Synthetic account',secretRef:'op://synthetic/item/credential'});
 const login=()=>{
  const browser=tools.connections.save({kind:'aside',name:'Synthetic browser',browserAccessApproved:true}),credential=tools.connections.save({kind:'login',name:'Synthetic login',url:'https://example.com',account:'Synthetic account',secretRef:'op://test/item/password',usernameRef:'op://test/item/username'});
  tools.aside.sessions.set(browser.id,{pages:new Map([['page',{url:'https://example.com/',problemId:store.active().id,snapshot:'- textbox "Username" [ref=e1]'}]]),client:{close:async()=>{}}});
  tools.aside.checkLogin=async()=>{};tools.aside.fillCredential=async()=>{writes++;return {filled:'username',synthetic:'saved'};};
  return {tool:'browser.login',arguments:{connection:browser.id,page:'page',selector:'e1',login:credential.id,field:'username'}};
 };
 return {store,service,tools,client,events,login,counts:()=>({writes,secrets}),action:{tool:'api.request',arguments:{connection:c.id,method:'POST',path:'/synthetic',body:{synthetic:true}}}};
}
test('research through Hermes still waits for exact approval before credential fills',async t=>{
 const f=await fixture(t);f.action=f.login();let turns=0;
 f.client.runsTools=true;f.client.answer=async(context,signal,progress,execute)=>{
  turns++;const result=await execute(f.action,signal);assert.match(result.result,/saved/);
  const memory=await execute({tool:'memory.search',arguments:{query:'synthetic'}},signal);assert.equal(memory.tool,'memory.search');return final;
 };
 const run=f.service.call('acceptPlan');await tick();assert.deepEqual(f.counts(),{writes:0,secrets:0});
 const approval=f.events.find(e=>e.event==='toolApproval');assert.deepEqual(approval.arguments,f.action.arguments);
 await f.service.call('approval',{id:approval.id,approved:true});const result=await run;
 assert.equal(result.execution.status,'completed');assert.equal(turns,1);assert.deepEqual(f.counts(),{writes:1,secrets:1});
 assert.ok(f.store.snapshot().entries.some(e=>e.kind==='source'&&e.title==='Tool result: browser.login'));
 assert.ok(f.events.some(e=>e.event==='toolProgress'&&e.status==='completed'));
});
test('declined Hermes action is not retried; new directions return to the agent',async t=>{
 const f=await fixture(t);f.action=f.login();f.client.runsTools=true;
 f.client.answer=async(context,signal,progress,execute)=>{
  const result=await execute(f.action,signal);assert.match(result.error,/declined/);
  assert.equal(result.userFeedback,'Use the synthetic note instead.');
  assert.ok(context.recent.some(e=>e.text==='Use the synthetic note instead.'));
  const repeated=await execute(f.action,signal);assert.match(repeated.error,/Do not automatically retry/);return final;
 };
 const run=f.service.call('acceptPlan');await tick();f.tools.resolve(f.events.find(e=>e.event==='toolApproval').id,false,'Use the synthetic note instead.');await run;
 assert.deepEqual(f.counts(),{writes:0,secrets:0});assert.equal(f.events.filter(e=>e.event==='toolApproval').length,1);
});
test('Stop while Hermes waits for approval prevents writes and late completion',async t=>{
 const f=await fixture(t);f.action=f.login();f.client.runsTools=true;f.client.answer=async(c,s,p,execute)=>{await execute(f.action,s);return final;};
 const run=f.service.call('acceptPlan'),rejected=assert.rejects(run);await tick();f.service.stop();await rejected;
 assert.deepEqual(f.counts(),{writes:0,secrets:0});assert.equal(f.tools.pending.size,0);assert.equal(f.service.snapshot().onboarding.stage,'executionPaused');
});
test('Hermes failure cancels its pending approval through the child signal',async t=>{
 const f=await fixture(t),child=new AbortController();f.action=f.login();f.client.runsTools=true;
 f.client.answer=async(c,s,p,execute)=>{await execute(f.action,AbortSignal.any([s,child.signal]));return final;};
 const run=f.service.call('acceptPlan'),rejected=assert.rejects(run);await tick();child.abort();await rejected;
 assert.deepEqual(f.counts(),{writes:0,secrets:0});assert.equal(f.tools.pending.size,0);
});
test('newer job input invalidates a Hermes action before it reaches the runtime',async t=>{
 const f=await fixture(t);f.client.runsTools=true;f.client.answer=async(c,s,p,execute)=>{f.store.advance();await execute(f.action,s);return final;};
 await assert.rejects(f.service.call('acceptPlan'),/superseded/);assert.deepEqual(f.counts(),{writes:0,secrets:0});assert.equal(f.events.some(e=>e.event==='toolApproval'),false);
});
async function unfinishedGate(t,Service=ProblemService){
 const f=await fixture(t,Service);let calls=0;f.client.runsTools=true;f.client.answer=async()=>++calls===1?{action:f.action}:final;
 await assert.rejects(f.service.call('acceptPlan'),/unfinished tool step/);assert.equal(f.events.some(e=>e.event==='toolApproval'),false);
}
test('a native-loop final action is rejected instead of starting the old outer loop',t=>unfinishedGate(t));
test('mutation proof: native-loop results cannot restart the old loop',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'onejob-native-gate-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));cpSync(new URL('../server/focus/',import.meta.url),dir,{recursive:true,filter:p=>!p.includes('node_modules')});
 const path=join(dir,'service.mjs'),source=readFileSync(path,'utf8'),before='this.clients[provider].runsTools && result.action';assert.ok(source.includes(before));writeFileSync(path,source.replace(before,'false'));
 const {ProblemService:Broken}=await import(pathToFileURL(path));
 // A synthetic executor throws before any approval can hang this mutation probe.
 class Probe extends Broken {constructor(...args){super(...args);this.tools.execute=async()=>{throw new Error('Synthetic forbidden old-loop entry');};}}
 await assert.rejects(unfinishedGate(t,Probe));
});
