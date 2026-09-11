import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,cpSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ProblemStore} from '../server/focus/store.mjs';
import {ProblemService} from '../server/focus/service.mjs';
import {instructionFor} from '../server/focus/prompt.mjs';
import {executionResponseType,validateExecution} from '../server/focus/execution.mjs';
import {FolderContext} from '../server/focus/folders.mjs';

test('execution question types preserve explicit input needs and recognize legacy permission questions',()=>{
 for(const question of ['Would you like me to try another page?','Can I continue?','Should I use the summary?'])assert.equal(executionResponseType({question}),'confirmation');
 for(const question of ['Which size?','Can you share the document?','What should change?'])assert.equal(executionResponseType({question}),'text');
 assert.equal(executionResponseType({question:'Can I continue?',responseType:'text'}),'text');
 assert.equal(executionResponseType({question:'Can I continue?',responseType:'invalid'}),'text');
 const result=validateExecution({reply:'Synthetic question.',execution:{status:'needs_input',question:'Proceed?',responseType:'confirmation'}});assert.equal(result.responseType,'confirmation');
});
test('mutation proof: explicit text input cannot be overridden by legacy question inference',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'onejob-response-type-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));cpSync(new URL('../server/focus/',import.meta.url),dir,{recursive:true,filter:path=>!path.includes('node_modules')});
 const path=join(dir,'execution.mjs'),source=readFileSync(path,'utf8');assert.ok(source.includes('if(result.responseType)'));writeFileSync(path,source.replace('if(result.responseType)','if(false)'));
 const {executionResponseType:broken}=await import(pathToFileURL(path));assert.throws(()=>assert.equal(broken({question:'Can I continue?',responseType:'text'}),'text'));
});

const final=(status='completed',question='')=>({reply:'Synthetic finished paper layout.',memories:[],execution:{status,question}});
const browserTools=connections=>({snapshot:()=>({}),catalog:()=>({tools:[],connections})});
async function recoveryFailureGate(t,Service=ProblemService){
 const tools={...browserTools([]),execute:async()=>{const error=new Error('Synthetic internal detail');error.code='BROWSER_RECOVERY_FAILED';throw error;}};
 const f=await fixture(t,Service,{tools});let calls=0;
 f.client.answer=async()=>{calls++;return calls===1?{action:{tool:'browser.read',arguments:{page:'synthetic'}}}:final('needs_input','Can you check your login?');};
 await assert.rejects(f.service.call('acceptPlan'),/browser connection failed after automatic recovery/);
 assert.equal(calls,1,'the AI must not reinterpret a transport failure as a login requirement');
 assert.equal(f.service.snapshot().onboarding.stage,'executionPaused');assert.equal(f.service.snapshot().execution,null);
 const reopened=new ProblemService(f.store,{chatgpt:f.client},{tools});assert.equal(reopened.snapshot().onboarding.stage,'executionPaused');
 assert.equal(reopened.snapshot().canResumeWithBrowser,false);
}
test('exhausted browser recovery pauses work without asking the user to troubleshoot',recoveryFailureGate);
async function browserOnce(t,Service=ProblemService){
 const connections=[],f=await fixture(t,Service,{tools:browserTools(connections)});
 f.client.answer=async context=>{if(context.phase==='inputReview')return {decision:'user_decision'};f.calls.push(structuredClone(context));return final('needs_input','Which synthetic page?');};
 const blocked=await f.service.call('acceptPlan');assert.deepEqual(blocked.execution.browserConnections,[]);assert.equal(blocked.canResumeWithBrowser,false);
 connections.push({id:'synthetic-browser',kind:'aside'});assert.equal(f.service.snapshot().canResumeWithBrowser,true);
 const result=await f.service.call('resumeWithBrowser',{id:f.store.active().id});assert.equal(f.calls.length,2);assert.equal(f.calls[1].plan,blocked.onboarding.plan);assert.equal(f.calls[1].capabilities.connections[0].id,'synthetic-browser');
 assert.equal(result.canResumeWithBrowser,false);assert.deepEqual(result.execution.browserConnections,['synthetic-browser']);
 const reopened=new ProblemService(f.store,{chatgpt:f.client},{tools:browserTools(connections)});assert.equal(reopened.snapshot().canResumeWithBrowser,false);
 await assert.rejects(reopened.call('resumeWithBrowser',{id:f.store.active().id}),/No new browser/);assert.equal(f.calls.length,2);
}
test('a new browser resumes missing-input work once, preserving plan and action review',browserOnce);
async function browserResumeGate(t,Service=ProblemService){
 const connections=[],f=await fixture(t,Service,{tools:browserTools(connections)}),id=f.store.active().id;
 await assert.rejects(f.service.call('resumeWithBrowser',{id}),/No new browser/);
 f.service.execution.save({status:'needs_input',question:'Synthetic?',reply:'Synthetic missing input.',browserConnections:[]});
 await assert.rejects(f.service.call('resumeWithBrowser',{id}),/No new browser/);
 connections.push({id:'synthetic-browser',kind:'aside'});
 await assert.rejects(f.service.call('resumeWithBrowser',{id:'other-job'}),/No new browser/);
 for(const stage of ['plan','results','executionPaused','researchReady']){f.service.flow.stage(stage);await assert.rejects(f.service.call('resumeWithBrowser',{id}),/No new browser/);}
 assert.equal(f.calls.length,0);
}
test('browser resume rejects wrong jobs, absent connections and non-waiting stages',browserResumeGate);
test('legacy missing-input jobs recheck once; failure stays paused after restart',async t=>{
 const connections=[{id:'synthetic-browser',kind:'aside'}],f=await fixture(t,ProblemService,{tools:browserTools(connections)});
 f.service.execution.save({status:'needs_input',question:'Synthetic?',reply:'Synthetic missing input.'});assert.equal(f.service.snapshot().canResumeWithBrowser,true);
 f.client.answer=async()=>{throw new Error('Synthetic offline');};
 await assert.rejects(f.service.call('resumeWithBrowser',{id:f.store.active().id}),/offline/);
 const reopened=new ProblemService(f.store,{chatgpt:f.client},{tools:browserTools(connections)});assert.equal(reopened.flow.state().stage,'executionPaused');assert.equal(reopened.snapshot().canResumeWithBrowser,false);
});
async function fixture(t,Service=ProblemService,options={}) {
 const dir=mkdtempSync(join(tmpdir(),'onejob-execution-')),path=join(dir,'test.sqlite'),store=new ProblemStore(path),calls=[],events=[];
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const client={account:async()=>({connected:true}),answer:async context=>{calls.push(structuredClone(context));return context.phase==='research'?{reply:'Synthetic plan: arrange the supplied paper shapes.',memories:[]}:final();}};
 const service=new Service(store,{chatgpt:client},{emit:e=>events.push(e),...options});
 await service.call('newJob');await service.call('modelReady');await service.call('describe',{text:'Arrange synthetic paper shapes.'});
 service.clarification.save([]);await service.call('research');calls.length=0;
 return {dir,path,store,client,calls,events,service};
}
test('Continue executes the saved plan, then persists results across restart and job changes',async t=>{
 const f=await fixture(t),plan=f.service.flow.state().plan,id=f.store.active().id;
 const result=await f.service.call('acceptPlan');assert.equal(result.onboarding.stage,'results');assert.equal(result.execution.status,'completed');
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].phase,'execute');assert.equal(f.calls[0].plan,plan);
 assert.ok(f.events.some(e=>e.event==='runProgress'));
 const reopenedStore=new ProblemStore(f.path);try{const reopened=new ProblemService(reopenedStore,{chatgpt:f.client});assert.deepEqual(reopened.snapshot().execution,result.execution);assert.equal(f.calls.length,1);await reopened.call('newJob');assert.equal(reopened.snapshot().execution,null);await reopened.call('selectJob',{id});assert.deepEqual(reopened.snapshot().execution,result.execution);assert.equal(f.calls.length,1);}finally{reopenedStore.close();}
});
test('missing information asks one question and an answer resumes the same plan',async t=>{
 const f=await fixture(t);f.client.answer=async context=>{if(context.phase==='inputReview')return {decision:'user_decision'};f.calls.push(structuredClone(context));return f.calls.length===1?final('needs_input','Which paper size should I use?'):final();};
 const blocked=await f.service.call('acceptPlan');assert.equal(blocked.onboarding.stage,'needsInput');assert.equal(blocked.execution.question,'Which paper size should I use?');
 const result=await f.service.call('continuePlan',{text:'Use the synthetic square sheet.'});assert.equal(result.onboarding.stage,'results');
 assert.equal(f.calls[1].execution.question,blocked.execution.question);assert.ok(f.calls[1].recent.some(e=>e.text==='Use the synthetic square sheet.'));assert.equal(f.calls[1].plan,blocked.onboarding.plan);
});
async function retiredPlanGate(t,Service=ProblemService){
 for(const change of ['remove','edit','disconnect']){
  const f=await fixture(t,Service),folder=join(f.dir,'notes');mkdirSync(folder);
  const file=join(folder,'synthetic.txt');writeFileSync(file,'SYNTHETIC_RETIRED_DETAIL');
  f.service.folders=new FolderContext(f.store);f.service.folders.connect(folder);
  f.client.answer=async context=>{f.calls.push(structuredClone(context));return {reply:'Plan containing SYNTHETIC_RETIRED_DETAIL',memories:[],execution:{status:'completed'}};};
  f.service.flow.stage('researchReady');await f.service.call('research');f.calls.length=0;
  f.service.execution.save({status:'needs_input',question:'Continue?',reply:'SYNTHETIC_RETIRED_DETAIL'});
  if(change==='remove')rmSync(file);
  if(change==='edit')writeFileSync(file,'A replacement synthetic detail.');
  if(change==='disconnect')f.service.folders.disconnect(f.service.folders.roots()[0].id);
  await assert.rejects(f.service.call('continuePlan',{text:'Yes.'}),/context changed/);
  assert.equal(f.calls.length,0,'retired plan must not reach a provider');
  assert.equal(f.service.flow.state().stage,'researchReady');assert.equal(f.service.flow.state().plan,'');assert.equal(f.service.execution.state(),null);
 }
}
test('removed or changed folder context cannot return to the AI through a saved plan',retiredPlanGate);
test('execution uses the selected provider, not an automatic model substitution',async t=>{
 const f=await fixture(t);f.service.clients.claude=f.client;await f.service.call('provider',{provider:'claude'});
 f.service.clients.chatgpt={answer:async()=>assert.fail('must keep selected provider')};
 assert.equal((await f.service.call('acceptPlan')).execution.status,'completed');
});
test('execution keeps the reviewed tool loop and supplies saved action history',async t=>{
 let resolveAction,executed=0;
 const history=[{tool:'api.request',status:'uncertain',arguments:{path:'/synthetic'}}];
 const tools={snapshot:()=>({actions:history}),catalog:()=>({tools:[{name:'api.request'}],connections:[]}),execute:async(action,context)=>{executed++;assert.equal(context.signal.aborted,false);context.assertCurrent();await new Promise(r=>resolveAction=r);return {tool:action.tool,result:{ok:true}};}};
 const f=await fixture(t,ProblemService,{tools});f.client.answer=async context=>{f.calls.push(structuredClone(context));return f.calls.length===1?{action:{tool:'api.request',arguments:{path:'/different-synthetic'}}}:final();};
 const run=f.service.call('acceptPlan');await new Promise(setImmediate);
 assert.equal(executed,1);assert.equal(f.service.snapshot().onboarding.stage,'executing');assert.equal(f.service.snapshot().execution,null);
 assert.deepEqual(f.calls[0].previousActions,history);resolveAction();assert.equal((await run).onboarding.stage,'results');assert.equal(f.calls[1].toolResults.length,1);
});
test('Stop interrupts a long tool loop without inventing a completed result',async t=>{
 const tools={snapshot:()=>({}),catalog:()=>({tools:[],connections:[]}),execute:async()=>({tool:'memory.search',result:[]})};
 const f=await fixture(t,ProblemService,{tools});let calls=0;
 f.client.answer=async()=>{if(++calls===15)f.service.stop();return {action:{tool:'memory.search',arguments:{query:'synthetic'}}};};
 await assert.rejects(f.service.call('acceptPlan'));assert.equal(calls,15);assert.equal(f.service.snapshot().onboarding.stage,'executionPaused');assert.equal(f.service.snapshot().execution,null);
});
async function outcomeGate(t,Service=ProblemService){
 for(const outcome of [undefined,{status:'invented'},{status:'needs_input',question:''},{status:'needs_input',question:'x'.repeat(2001)}]){
  const f=await fixture(t,Service);f.client.answer=async()=>({...final(),execution:outcome});
  const before=f.store.snapshot().entries.filter(e=>e.kind==='assistant').length;
  await assert.rejects(f.service.call('acceptPlan'));assert.equal(f.service.snapshot().onboarding.stage,'executionPaused');assert.equal(f.service.snapshot().execution,null);assert.equal(f.store.snapshot().entries.filter(e=>e.kind==='assistant').length,before);
 }
}
test('an invalid completion or missing question never becomes a result',outcomeGate);
async function resumeGate(t,Service=ProblemService){const f=await fixture(t,Service);await assert.rejects(f.service.call('continuePlan',{text:'bypass review'}),/no paused plan/);assert.equal(f.calls.length,0);await f.service.call('acceptPlan');await assert.rejects(f.service.call('continuePlan'),/no paused plan/);}
test('resume cannot bypass plan review or rerun finished work',resumeGate);
test('blank answers do not start inference',async t=>{const f=await fixture(t);f.client.answer=async context=>context.phase==='inputReview'?{decision:'user_decision'}:final('needs_input','Which size?');await f.service.call('acceptPlan');await assert.rejects(f.service.call('continuePlan',{text:'  '}),/Enter text/);assert.equal(f.service.flow.state().stage,'needsInput');});
async function busyGate(t,Service=ProblemService){const f=await fixture(t,Service);f.service.job=new AbortController();await assert.rejects(f.service.call('acceptPlan'),/already running/);assert.equal(f.service.flow.state().stage,'plan');assert.equal(f.calls.length,0);}
test('busy execution cannot alter the reviewed plan stage',busyGate);
test('double clicks cannot start a second run; stop does not save a late answer',async t=>{
 const f=await fixture(t);let finish;f.client.answer=()=>new Promise(r=>finish=r);const run=f.service.call('acceptPlan');
 await assert.rejects(f.service.call('acceptPlan'),/Review/);await assert.rejects(f.service.call('continuePlan'),/no paused plan/);
 await f.service.call('stop');finish(final());await assert.rejects(run);assert.equal(f.service.flow.state().stage,'executionPaused');assert.equal(f.service.execution.state(),null);
});
test('an archived run cannot write its answer or recovery stage onto the new job',async t=>{
 const f=await fixture(t);let finish;f.client.answer=()=>new Promise(r=>finish=r);const run=f.service.call('acceptPlan');await f.service.call('archive');
 const next=await f.service.call('openJob');finish(final());await assert.rejects(run);assert.equal(f.service.snapshot().problem.id,next.problem.id);assert.equal(f.service.flow.state().stage,'connect');assert.equal(f.service.execution.state(),null);
});
test('restart pauses interrupted work and legacy plans require an explicit continue',async t=>{
 const f=await fixture(t);f.service.flow.stage('executing');const restarted=new ProblemService(f.store,{chatgpt:f.client});assert.equal(restarted.flow.state().stage,'executionPaused');assert.equal(f.calls.length,0);
 restarted.flow.stage('work');const legacy=new ProblemService(f.store,{chatgpt:f.client});await legacy.call('openJob');assert.equal(f.calls.length,0);assert.equal((await legacy.call('continuePlan')).onboarding.stage,'results');
});
for(const [name,scenario,file,from,to] of [
 ['browser failure is not user input',recoveryFailureGate,'service.mjs',"if(error.code==='BROWSER_RECOVERY_FAILED'&&!this.tools?.autoMode?.(problem.id))",'if(false)'],
 ['retired plan gate',retiredPlanGate,'service.mjs','if(execute)this.requireCurrentPlan();',''],
 ['browser connection checkpoint',browserOnce,'service.mjs',".some(id=>!(result.browserConnections||[]).includes(id))",'.some(()=>true)'],
 ['browser resume gate',browserResumeGate,'service.mjs',"if(p.id!==this.store.active()?.id || !this.canResumeWithBrowser())",'if(false)'],
 ['outcome validation',outcomeGate,'service.mjs','const outcome=execute?validateExecution(result):null;','const outcome=execute?{status:"completed",reply:result.reply,question:""}:null;'],
 ['resume gate',resumeGate,'service.mjs',"if(!['needsInput','executionPaused'].includes(flow.stage) && !(flow.stage==='results' && flow.plan && this.execution.state()?.status==='blocked') && !(flow.stage==='work' && flow.plan && !this.execution.state()))",'if(false)'],
 ['busy gate',busyGate,'service.mjs',"if(this.job)throw new ProblemError('This plan is already running.');",''],
])test('mutation proof: '+name,async t=>{
 const dir=mkdtempSync(join(tmpdir(),'onejob-execution-mutant-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));cpSync(new URL('../server/focus/',import.meta.url),dir,{recursive:true,filter:path=>!path.includes('node_modules')});
 const path=join(dir,file),source=readFileSync(path,'utf8');assert.ok(source.includes(from));writeFileSync(path,source.replace(from,to));const {ProblemService:Broken}=await import(pathToFileURL(join(dir,'service.mjs')));await assert.rejects(scenario(t,Broken));
});
test('execution instructions require deliverables, evidence, safe queries and specific missing-input questions',()=>{
 const prompt=instructionFor({phase:'execute'});for(const phrase of ['plain','actual useful deliverable','needs_input','Never automatically repeat','not blanket approval','never private notes'])assert.ok(prompt.toLowerCase().includes(phrase.toLowerCase()),phrase);
});
