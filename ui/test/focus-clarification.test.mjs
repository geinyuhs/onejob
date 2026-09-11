import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,cpSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {ProblemStore} from '../server/focus/store.mjs';
import {ProblemService} from '../server/focus/service.mjs';
import {validateQuestions} from '../server/focus/clarification.mjs';
import {CodexClient,ClaudeClient,claudeArgs,codexArgs} from '../server/focus/clients.mjs';
import {instructionFor,promptFor} from '../server/focus/prompt.mjs';
import {communicationPolicy,clarificationModel} from '../server/focus/ai-policy.mjs';

const question=(n=1)=>({question:`What matters for synthetic task ${n}?`,why:'This helps choose the next step.',options:['A simple result','A detailed result']});
async function fixture(t,Service=ProblemService,count=2){
 const dir=mkdtempSync(join(tmpdir(),'onejob-clarify-'));const store=new ProblemStore(join(dir,'test.sqlite'));
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});const calls=[];
 const clients={chatgpt:{account:async()=>({connected:true}),answer:async context=>{calls.push(context);return context.phase==='clarify'?{questions:Array.from({length:count},(_,i)=>question(i+1))}:{reply:'A synthetic plan.',memories:[]};}}};
 const service=new Service(store,clients);await service.call('newJob');await service.call('modelReady');await service.call('describe',{text:'A synthetic task'});
 return {dir,store,clients,calls,service,id:store.active().id};
}
const params=f=>{const c=f.service.snapshot().clarification;return {id:f.id,token:c.token,index:c.responses.length};};
const generate=f=>f.service.call('clarify',{id:f.id,tried:'A synthetic prior attempt'});
async function questionProgress(t,Service=ProblemService,stop=false){
 const f=await fixture(t,Service),events=[];f.service.emit=event=>events.push(event);let notify;
 f.clients.chatgpt.answer=async(context,signal,progress)=>{
  assert.equal(events.at(-1).message,'Reading your problem and what you’ve tried…');notify=progress;
  progress('Preparing a question about the available time…');
  if(stop){f.service.stop();progress('Late progress after Stop');}
  return {questions:[question()]};
 };
 if(stop)await assert.rejects(generate(f));else await generate(f);
 const expected=['Reading your problem and what you’ve tried…','Preparing a question about the available time…'];
 if(!stop)expected.push('Checking your follow-up questions…');
 assert.deepEqual(events.map(e=>e.message),expected,'only live preparation events reach the UI');
 const count=events.length;notify('Late progress after completion');assert.equal(events.length,count,'completed requests cannot emit progress');
}
for(const stop of [false,true]){
 test(`question preparation reports actual events${stop?' and stops forwarding after cancellation':''}`,t=>questionProgress(t,ProblemService,stop));
 test(`mutation proof: question progress rejects ${stop?'cancelled':'completed'} callbacks`,async t=>{
  const dir=mkdtempSync(join(tmpdir(),'onejob-progress-mutant-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  cpSync(new URL('../server/focus/',import.meta.url),dir,{recursive:true});
  const file=join(dir,'service.mjs'),source=readFileSync(file,'utf8');
  const guard='if(this.job===controller && !controller.signal.aborted)';assert.ok(source.includes(guard));
  writeFileSync(file,source.replace(guard,'if(true)'));
  const {ProblemService:Broken}=await import(pathToFileURL(file));
  await assert.rejects(questionProgress(t,Broken,stop),/only live preparation|completed requests/);
 });
}
test('research progress reflects context preparation, inference and saving the plan',async t=>{
 const f=await fixture(t,ProblemService,0);await generate(f);const events=[];f.service.emit=e=>events.push(e);
 f.clients.chatgpt.answer=async()=>{assert.equal(events.at(-1).message,'Choosing sources for “A synthetic task”…');return {reply:'A synthetic plan.',memories:[]};};
 await f.service.call('research');
 assert.deepEqual(events.filter(e=>e.event==='runProgress').map(e=>e.message),['Checking your saved notes and files…','Choosing sources for “A synthetic task”…','Saving your findings and plan…']);
 assert.equal(f.service.snapshot().onboarding.stage,'plan');
});

test('clarification is a single tool-free call using only intake; answers persist and reach research',async t=>{
 const f=await fixture(t);let toolCalls=0;
 f.service.tools={snapshot:()=>({}),catalog:()=>{toolCalls++;return {};},execute:()=>{toolCalls++;}};
 f.service.folders={sync:()=>{toolCalls++;}};f.service.search={retrieve:()=>{toolCalls++;return [];}};
 await generate(f);assert.equal(toolCalls,0);assert.deepEqual(f.calls,[{phase:'clarify',problem:'A synthetic task',tried:'A synthetic prior attempt'}]);
 await f.service.call('saveDraft',{...params(f),field:'clarification',text:'Synthetic draft answer'});
 f.service=new ProblemService(f.store,f.clients);assert.equal(f.service.snapshot().clarification.draft,'Synthetic draft answer');
 await f.service.call('answerClarification',{...params(f),text:'Synthetic final answer'});
 assert.equal(f.service.snapshot().onboarding.stage,'clarify');assert.equal(f.service.snapshot().clarification.draft,'');
 await f.service.call('answerClarification',{...params(f),skip:true});
 assert.equal(f.service.snapshot().onboarding.stage,'researchReady');assert.equal(f.calls.length,1);
 await f.service.call('research');assert.equal(f.calls[1].clarifications[0].text,'Synthetic final answer');
 assert.deepEqual(f.calls[1].clarifications[1],{question:question(2).question,status:'skipped',text:null});
});
test('zero questions, skip all, and third answer stop without further model calls',async t=>{
 for(const count of [0,3]){
  const f=await fixture(t,ProblemService,count);await generate(f);
  for(let i=0;i<count;i++)await f.service.call('answerClarification',{...params(f),text:'Synthetic answer'});
  assert.equal(f.service.snapshot().onboarding.stage,'researchReady');assert.equal(f.calls.length,1);
 }
 const f=await fixture(t);await f.service.call('skipClarifications',{id:f.id,tried:''});assert.equal(f.calls.length,0);assert.equal(f.service.snapshot().onboarding.stage,'researchReady');
});
test('Back reuses the question batch; edited intake invalidates it; jobs stay separate',async t=>{
 const f=await fixture(t);await generate(f);const first=f.service.snapshot().clarification.token;
 await f.service.call('answerClarification',{...params(f),text:'Synthetic answer'});
 await f.service.call('reviseAttempts');await generate(f);assert.equal(f.calls.length,1);assert.equal(f.service.snapshot().clarification.token,first);
 const second=await f.service.call('newJob');assert.equal(second.clarification,null);
 await f.service.call('selectJob',{id:f.id});assert.equal(f.service.snapshot().clarification.responses[0].text,'Synthetic answer');
 await f.service.call('reviseAttempts');await f.service.call('clarify',{id:f.id,tried:'A changed synthetic attempt'});
 assert.notEqual(f.service.snapshot().clarification.token,first);assert.equal(f.service.snapshot().clarification.responses.length,0);
});
test('failed and interrupted generation retain intake and never invent a question or plan',async t=>{
 const f=await fixture(t);f.clients.chatgpt.answer=async()=>{throw new Error('Synthetic offline');};
 await assert.rejects(generate(f),/offline/);assert.equal(f.service.snapshot().onboarding.stage,'attempts');assert.equal(f.service.snapshot().clarification,null);
 let finish;f.clients.chatgpt.answer=()=>new Promise(r=>finish=r);const pending=generate(f);f.service.stop();finish({questions:[question()]});
 await assert.rejects(pending);assert.equal(f.service.snapshot().clarification,null);assert.equal(f.store.active().brief.tried,'A synthetic prior attempt');
});
test('answer and stage changes commit together or both roll back',async t=>{
 const f=await fixture(t,ProblemService,1);await generate(f);
 const stage=f.service.flow.stage.bind(f.service.flow);f.service.flow.stage=()=>{throw new Error('Synthetic write failure');};
 await assert.rejects(f.service.call('answerClarification',{...params(f),text:'Synthetic answer'}),/write failure/);
 assert.equal(f.service.snapshot().clarification.responses.length,0);assert.equal(f.service.snapshot().onboarding.stage,'clarify');
 f.service.flow.stage=stage;await f.service.call('answerClarification',{...params(f),text:'Synthetic answer'});assert.equal(f.service.snapshot().onboarding.stage,'researchReady');
});
test('a second database connection reads saved answers and the current question',async t=>{
 const f=await fixture(t);await generate(f);await f.service.call('answerClarification',{...params(f),text:'A saved synthetic answer'});
 const reopened=new ProblemStore(join(f.dir,'test.sqlite'));try{const s=new ProblemService(reopened,f.clients);assert.equal(s.snapshot().clarification.responses[0].text,'A saved synthetic answer');assert.equal(s.snapshot().onboarding.stage,'clarify');}finally{reopened.close();}
});
test('malformed, oversized, or tool-shaped model output is rejected',()=>{
 for(const result of [null,{}, {questions:Array.from({length:4},()=>question())},{questions:[],action:{tool:'browser.open'}},{questions:[{...question(),options:['one']}]},{questions:[{...question(),options:Array(5).fill('x')}]},{questions:[{...question(),question:'x'.repeat(241)}]},{questions:[{...question(),why:''}]},{questions:[{...question(),options:['x'.repeat(121),'y']}]},{questions:[{...question(),extra:'x'}]}])assert.throws(()=>validateQuestions(result));
 assert.equal(validateQuestions({questions:[]}).length,0);
});

async function earlyResearch(t,Service){const f=await fixture(t,Service);await assert.rejects(f.service.call('research'),/clarifying/);await generate(f);await assert.rejects(f.service.call('research'),/clarifying/);}
async function earlySend(t,Service){const f=await fixture(t,Service);await assert.rejects(f.service.call('send',{text:'Synthetic bypass'}),/intake/);}
async function badQuestion(t,Service){const f=await fixture(t,Service);await generate(f);const p=params(f);for(const bad of [{id:'other'}, {token:'old'}, {index:5}])await assert.rejects(f.service.call('answerClarification',{...p,...bad,text:'Synthetic'}),/changed/);await f.service.call('answerClarification',{...p,text:'Synthetic'});await assert.rejects(f.service.call('answerClarification',{...p,text:'Duplicate'}),/changed/);}
async function staleGeneration(t,Service){const f=await fixture(t,Service);let finish;f.clients.chatgpt.answer=()=>new Promise(r=>finish=r);const pending=generate(f);f.store.editBrief({tried:'Changed while generating'});finish({questions:[question()]});await assert.rejects(pending,/changed/);}
async function wrongProvider(t,Service){const f=await fixture(t,Service);await f.service.call('provider',{provider:'claude'});await assert.rejects(generate(f),/Astra/);assert.equal(f.calls.length,0);}
async function generationGate(t,Service){const f=await fixture(t,Service);f.service.flow.stage('problem');await assert.rejects(generate(f),/earlier/);}
async function generationJob(t,Service){const f=await fixture(t,Service);await assert.rejects(f.service.call('clarify',{id:'other'}),/another job/);}
async function skipGate(t,Service){const f=await fixture(t,Service);f.service.flow.stage('problem');await assert.rejects(f.service.call('skipClarifications',{id:f.id}),/intake/);}
async function skipJob(t,Service){const f=await fixture(t,Service);await assert.rejects(f.service.call('skipClarifications',{id:'other'}),/another job/);}
async function backGate(t,Service){const f=await fixture(t,Service);await assert.rejects(f.service.call('reviseAttempts'),/current step/);}
async function answerBusy(t,Service){const f=await fixture(t,Service);await generate(f);f.service.job=new AbortController();await assert.rejects(f.service.call('answerClarification',{...params(f),text:'Synthetic'}),/Wait/);}
async function longDraft(t,Service){const f=await fixture(t,Service);await generate(f);await assert.rejects(f.service.call('saveDraft',{...params(f),field:'clarification',text:'x'.repeat(4001)}),/4,000/);}
async function legacyRestart(t,Service){const f=await fixture(t,Service);f.service.flow.stage('research');const reopened=new Service(f.store,f.clients);assert.equal(reopened.snapshot().onboarding.stage,'attempts');assert.equal(f.calls.length,0);}
async function refineBusy(t,Service){const f=await fixture(t,Service);await generate(f);f.service.job=new AbortController();await assert.rejects(f.service.call('simplifyClarification',params(f)),/Wait/);}
async function refineProvider(t,Service){const f=await fixture(t,Service);await generate(f);await f.service.call('provider',{provider:'claude'});f.clients.chatgpt.answer=async()=>({questions:[question()]});await assert.rejects(f.service.call('simplifyClarification',params(f)),/Astra/);}
async function refineStale(t,Service){const f=await fixture(t,Service);await generate(f);let finish;f.clients.chatgpt.answer=()=>new Promise(r=>finish=r);const pending=f.service.call('simplifyClarification',params(f));f.store.advance();finish({questions:[question()]});await assert.rejects(pending,/changed/);}
async function rewriteShape(t,Service){const f=await fixture(t,Service);await generate(f);for(const questions of [[],[question(),question()],[{...question(),options:[]}]]){f.clients.chatgpt.answer=async()=>({questions});await assert.rejects(f.service.call('simplifyClarification',params(f)),/one question/);}}
async function pickShape(t,Service){const f=await fixture(t,Service);await generate(f);f.clients.chatgpt.answer=async()=>({answer:question().options[0],reason:'Synthetic reason',action:{tool:'browser.open'}});await assert.rejects(f.service.call('pickClarification',params(f)),/could not pick/);}
async function pickChoice(t,Service){const f=await fixture(t,Service);await generate(f);f.clients.chatgpt.answer=async()=>({answer:'Not an option',reason:'Synthetic reason'});await assert.rejects(f.service.call('pickClarification',params(f)),/unavailable/);}
async function invalidSelections(t,Service){const f=await fixture(t,Service);await generate(f);for(const choices of [[-1],[2],[0,0],[0.5],['0'],'0',Array(5).fill(0)])for(const method of ['saveDraft','answerClarification'])await assert.rejects(f.service.call(method,{...params(f),field:'clarification',text:'Synthetic',choices}),/available answers/);}
async function longCustomAnswer(t,Service){const f=await fixture(t,Service);await generate(f);for(const text of [null,'x'.repeat(4001)])await assert.rejects(f.service.call('answerClarification',{...params(f),choices:[0],text}),/4,000/);}
async function choiceMigration(t,Service){
 const dir=mkdtempSync(join(tmpdir(),'onejob-choice-migration-'));const store=new ProblemStore(join(dir,'test.sqlite'));t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 new Service(store,{});assert.ok(store.db.prepare('PRAGMA table_info(job_clarifications)').all().some(c=>c.name==='draft_choices'),'draft choice column must exist');new Service(store,{});
}
const cases=[
 ['selection validation',invalidSelections,'clarification.mjs',"if(!Array.isArray(choices)||choices.length>4||new Set(choices).size!==choices.length||choices.some(index=>!Number.isInteger(index)||index<0||index>=row.questions[p.index].options.length))"],
 ['custom answer length',longCustomAnswer,'clarification.mjs',"if(typeof p.text!=='string'||p.text.length>4000)"],
 ['draft selection migration',choiceMigration,'clarification.mjs',"if(!this.db.prepare('PRAGMA table_info(job_clarifications)').all().some(column=>column.name==='draft_choices'))"],
 ['refinement busy',refineBusy,'service.mjs',"if(this.job)throw new ProblemError('Wait for the current question to finish.');"],
 ['refinement provider',refineProvider,'service.mjs',"if(provider!=='chatgpt')"],
 ['refinement stale result',refineStale,'service.mjs',"if(!updated || updated.id!==problem.id || updated.revision!==problem.revision)"],
 ['rewrite shape',rewriteShape,'clarification.mjs',"if(questions.length!==1 || questions[0].options.length<2)"],
 ['pick shape',pickShape,'clarification.mjs',"if(!result || Object.keys(result).sort().join(',')!=='answer,reason')"],
 ['pick must match choice',pickChoice,'clarification.mjs',"if(answer!==null && options.length && !options.includes(answer))"],
 ['research waits',earlyResearch,'service.mjs',"if(this.flow.state().stage!=='researchReady' || !this.clarification.ready())"],
 ['send cannot bypass intake',earlySend,'service.mjs',"if(this.flow.state().stage!=='work')"],
 ['stale questions',badQuestion,'clarification.mjs',"if(this.flow.state().stage!=='clarify' || this.store.active()?.id!==p.id || !row || row.token!==p.token || row.responses.length!==p.index || p.index>=row.questions.length)"],
 ['changed generation',staleGeneration,'service.mjs',"if(!current || current.id!==problem.id || current.revision!==problem.revision)"],
 ['no provider switch',wrongProvider,'service.mjs',"if((this.store.config()?.provider||'chatgpt')!=='chatgpt')"],
 ['generation stage',generationGate,'service.mjs',"if(this.job || this.flow.state().stage!=='attempts')"],
 ['generation job',generationJob,'service.mjs',"if(this.store.active()?.id!==p.id)throw new ProblemError('This answer belongs to another job.');",'last'],
 ['skip stage',skipGate,'service.mjs',"if(this.job || !['attempts','clarify'].includes(this.flow.state().stage))"],
 ['skip job',skipJob,'service.mjs',"if(this.store.active()?.id!==p.id)throw new ProblemError('This answer belongs to another job.');"],
 ['back stage',backGate,'service.mjs',"if(this.job || !['clarify','researchReady'].includes(this.flow.state().stage))"],
 ['answer while busy',answerBusy,'service.mjs',"if(this.job)throw new ProblemError('Wait for the current answer to finish.');"],
 ['answer draft bound',longDraft,'clarification.mjs',"if(typeof p.text!=='string' || p.text.length>4000)"],
 ['legacy interrupted research',legacyRestart,'service.mjs',"if(this.flow.state().stage==='researchReady' && !this.clarification.ready())"],
];
for(const [name,scenario,file,guard,which] of cases){
 test(name,t=>scenario(t,ProblemService));
 test('mutation proof: '+name,async t=>{
  const dir=mkdtempSync(join(tmpdir(),'onejob-clarify-mutant-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  cpSync(new URL('../server/focus/',import.meta.url),dir,{recursive:true,filter:path=>!path.includes('node_modules')});
  const path=join(dir,file),source=readFileSync(path,'utf8'),index=which==='last'?source.lastIndexOf(guard):source.indexOf(guard);assert.ok(index>=0);
  writeFileSync(path,source.slice(0,index)+(guard.endsWith(';')?'':'if(false)')+source.slice(index+guard.length));
  const {ProblemService:Broken}=await import(pathToFileURL(join(dir,'service.mjs')));await assert.rejects(scenario(t,Broken));
 });
}
test('mutation proof: removing the three-question cap admits a fourth question',async()=>{
 const source=readFileSync(new URL('../server/focus/clarification.mjs',import.meta.url),'utf8');
 const functionText=source.slice(source.indexOf('export function validateQuestions'),source.indexOf('export class Clarification')).replace('export ','').replace(' || result.questions.length>3','');
 const broken=new Function('ProblemError','requiredText',functionText+';return validateQuestions;')(Error,v=>v);
 assert.throws(()=>validateQuestions({questions:Array.from({length:4},()=>question())}));
 assert.equal(broken({questions:Array.from({length:4},()=>question())}).length,4);
});
test('action prompts require credential, irreversible-action and external-contact approval',()=>{
 for(const phase of ['work','execute'])for(const prompt of [instructionFor({phase}),claudeArgs({phase}).at(-1)]){
  assert.match(prompt,/before every use of a 1Password credential/);
  assert.match(prompt,/irreversible action/);
  assert.match(prompt,/External contact means sending messages or submitting information/);
  assert.match(prompt,/not ordinary page reads or public searches/);
  assert.match(prompt,/one exact-action approval/);
 }
});
test('ongoing help defaults are scoped to setup prompts',()=>{
 for(const phase of ['clarify']){
  const context={phase,problem:'A synthetic task'};
  for(const prompt of [instructionFor(context),...(phase==='clarify'?[]:[claudeArgs(context).at(-1)])]){
   assert.match(prompt,/Assume the user wants ongoing help/);
   assert.match(prompt,/Respect an explicit request for one-time help/);
   assert.match(prompt,/Do not ask whether they want one-time or ongoing help/);
   assert.match(prompt,/does not authorize background runs, a schedule, notifications, or external changes/);
  }
 }
});
test('all reasoning prompts share plain-language rules; clarification has no research instructions',()=>{
 for(const phase of ['clarify','research','work']){assert.ok(instructionFor({phase}).includes(communicationPolicy));assert.ok(!promptFor({phase}).includes(communicationPolicy),'system instructions must not be duplicated in user context');assert.ok(claudeArgs({phase}).at(-1).includes(communicationPolicy));}
 assert.match(instructionFor({phase:'clarify'}),/Do not browse/);assert.doesNotMatch(instructionFor({phase:'clarify'}),/Use the configured tools/);
});
function protocolClient(model=clarificationModel,Client=CodexClient){
 const c=new Client('/tmp/synthetic-unused');const calls=[];c.account=async()=>({connected:true});
 c.rpc=async(method,p)=>{calls.push({method,p});if(method==='thread/start')return {thread:{id:'synthetic'},model};
  if(method==='turn/start'){queueMicrotask(()=>{c.emit('notification',{method:'item/completed',params:{threadId:'synthetic',item:{type:'agentMessage',phase:'final_answer',text:'{"questions":[]}'}}});c.emit('notification',{method:'turn/completed',params:{threadId:'synthetic',turn:{status:'completed'}}});});return {turn:{id:'synthetic-turn'}};}return {};};
 return {c,calls};
}
test('Astra is pinned for clarification and thinking uses the Codex default; provider-native tools stay off',async()=>{
 const {c,calls}=protocolClient();assert.deepEqual(await c.answer({phase:'clarify',problem:'Synthetic',tried:''}),{questions:[]});
 for(const {p} of calls)assert.equal(p.model,'gpt-6-astra');
 const turn=calls.find(c=>c.method==='turn/start').p;assert.equal(turn.effort,undefined);assert.equal(turn.outputSchema.properties.questions.maxItems,3);assert.equal(turn.permissions,'onejob');assert.equal(turn.sandboxPolicy,undefined);
 assert.equal(calls.find(c=>c.method==='thread/start').p.permissions,'onejob');
 const args=codexArgs();assert.ok(args.includes('permissions.onejob.network.enabled=false'));assert.ok(args.includes('permissions.onejob.filesystem={":root"="deny",":minimal"="read",":workspace_roots"={"."="read"}}'));
});
test('a smaller or unconfirmed model cannot silently replace Astra',async()=>{
 for(const model of ['synthetic-small',null]){const {c,calls}=protocolClient(model);await assert.rejects(c.answer({phase:'clarify'}),/Astra/);assert.equal(calls.some(c=>c.method==='turn/start'),false);}
 await assert.rejects(new ClaudeClient('/tmp/synthetic-unused').answer({phase:'clarify'}),/Astra/);
});
test('mutation proof: removing the model check dispatches to an unintended model',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'onejob-model-mutant-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 cpSync(new URL('../server/focus/',import.meta.url),dir,{recursive:true,filter:path=>!path.includes('node_modules')});
 const path=join(dir,'clients.mjs'),source=readFileSync(path,'utf8'),guard='if(model.model && started.model!==clarificationModel)';assert.ok(source.includes(guard));writeFileSync(path,source.replace(guard,'if(false)'));
 const {CodexClient:Broken}=await import(pathToFileURL(path));const {c,calls}=protocolClient('synthetic-small',Broken);
 await assert.rejects(async()=>assert.rejects(c.answer({phase:'clarify'}),/Astra/));assert.equal(calls.some(c=>c.method==='turn/start'),true);
});
test('close and restart restores a half-finished question without a model call',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'onejob-question-restart-'));let store=new ProblemStore(join(dir,'test.sqlite'));
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const clients={chatgpt:{account:async()=>({connected:true}),answer:async()=>({questions:[question()]})}};
 let service=new ProblemService(store,clients);const start=await service.call('newJob');await service.call('modelReady');await service.call('describe',{text:'Synthetic task'});await service.call('clarify',{id:start.problem.id,tried:''});
 const c=service.snapshot().clarification;await service.call('saveDraft',{id:start.problem.id,token:c.token,index:0,field:'clarification',text:'Half a synthetic answer'});
 store.close();store=new ProblemStore(join(dir,'test.sqlite'));service=new ProblemService(store,{});
 assert.equal(service.snapshot().clarification.draft,'Half a synthetic answer');assert.equal(service.snapshot().onboarding.stage,'clarify');
});
test('mutation proof: closed model-output schemas refuse extra fields and tool actions',()=>{
 const source=readFileSync(new URL('../server/focus/clarification.mjs',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('export function validateQuestions'),source.indexOf('export class Clarification')).replace('export ','');
 for(const [guard,result] of [
  ["if(!result || Object.keys(result).join(',')!=='questions' || !Array.isArray(result.questions) || result.questions.length>3)",{questions:[],action:{tool:'browser.open'}}],
  ["if(!q || !['options,question,why','options,question,recommendedIndex,why'].includes(Object.keys(q).sort().join(',')) || !Array.isArray(q.options) || q.options.length>4 || q.options.length===1)",{questions:[{...question(),extra:'synthetic'}]}],
 ]){
  assert.ok(fn.includes(guard));const broken=new Function('ProblemError','requiredText',fn.replace(guard,'if(false)')+';return validateQuestions;')(Error,v=>v);
  assert.throws(()=>validateQuestions(result));assert.doesNotThrow(()=>broken(result));
 }
});
test('simplifying replaces only the current question, rotates its token, and survives restart',async t=>{
 const f=await fixture(t);await generate(f);await f.service.call('answerClarification',{...params(f),text:'Synthetic first answer'});
 const before=f.service.snapshot().clarification,p=params(f);await f.service.call('saveDraft',{...p,field:'clarification',text:'Unfinished'});
 const clearer={question:'Which result would help?',why:'To choose an approach.',options:['A quick first draft','A detailed finished draft'],recommendedIndex:0};
 let context;f.clients.chatgpt.answer=async c=>{context=c;return {questions:[clearer]};};
 await f.service.call('simplifyClarification',p);
 const after=f.service.snapshot().clarification;
 assert.equal(after.questions.length,before.questions.length);assert.deepEqual(after.questions[0],before.questions[0]);assert.deepEqual(after.questions[1],clearer);
 assert.deepEqual(after.responses,before.responses);assert.notEqual(after.token,p.token);assert.equal(after.draft,'');
 assert.deepEqual(Object.keys(context).sort(),['currentQuestion','earlierAnswers','operation','phase','problem','tried']);assert.equal(context.operation,'simplify');assert.equal(context.earlierAnswers.length,1);
 for(const method of ['answerClarification','simplifyClarification','pickClarification'])await assert.rejects(f.service.call(method,{...p,text:'Stale'}),/changed/);
 const reopened=new ProblemStore(join(f.dir,'test.sqlite'));try{assert.deepEqual(new ProblemService(reopened,{}).snapshot().clarification,after);}finally{reopened.close();}
});
test('AI choices and unknown facts stay distinct from user answers in research',async t=>{
 const f=await fixture(t);await generate(f);let context;
 f.clients.chatgpt.answer=async c=>{context=c;return {answer:question().options[0],reason:'Start with a small reversible step.'};};
 await f.service.call('pickClarification',params(f));assert.equal(context.operation,'pick');
 f.clients.chatgpt.answer=async()=>({answer:null,reason:'This personal fact is still unknown.'});await f.service.call('pickClarification',params(f));
 const answers=f.service.snapshot().clarification.responses;
 assert.equal(answers[0].status,'assumed');assert.equal(answers[1].status,'unknown');assert.equal(answers[1].text,null);assert.equal(f.service.snapshot().onboarding.stage,'researchReady');
 f.clients.chatgpt.answer=async c=>{context=c;return {reply:'A synthetic plan.',memories:[]};};await f.service.call('research');
 assert.deepEqual(context.clarifications.map(({question,...r})=>r),answers);assert.match(instructionFor(context),/provisional assumptions/);
});
test('refinement failure, invalid output, cancellation and changed intake preserve the question',async t=>{
 for(const mode of ['error','invalid','cancel','edited']){
  const f=await fixture(t);await generate(f);const before=f.service.snapshot().clarification;
  let finish;f.clients.chatgpt.answer=()=>mode==='error'?Promise.reject(new Error('Synthetic offline')):new Promise(r=>finish=r);
  const pending=f.service.call('simplifyClarification',params(f));
  if(mode==='cancel')f.service.stop();if(mode==='edited')f.store.editBrief({tried:'Changed synthetic attempt'});
  if(finish)finish(mode==='invalid'?{questions:[],action:{tool:'browser.open'}}:{questions:[question()]});
  await assert.rejects(pending);assert.deepEqual(f.service.snapshot().clarification,before);assert.equal(f.service.job,null);
 }
});
test('recommendations must point to an existing choice; legacy questions remain readable',()=>{
 const good={questions:[{...question(),recommendedIndex:0}]};assert.equal(validateQuestions(good)[0].recommendedIndex,0);
 assert.doesNotThrow(()=>validateQuestions({questions:[question()]}));
 const source=readFileSync(new URL('../server/focus/clarification.mjs',import.meta.url),'utf8');
 const guard='if(recommendedIndex!==null && (!Number.isInteger(recommendedIndex)||recommendedIndex<0||recommendedIndex>=q.options.length))';
 assert.ok(source.includes(guard));const fn=source.slice(source.indexOf('export function validateQuestions'),source.indexOf('export class Clarification')).replace('export ','').replace(guard,'if(false)');
 const broken=new Function('ProblemError','requiredText',fn+';return validateQuestions;')(Error,v=>v);
 for(const recommendedIndex of [-1,2,0.5,'0']){const result={questions:[{...question(),recommendedIndex}]};assert.throws(()=>validateQuestions(result),/unavailable/);assert.doesNotThrow(()=>broken(result));}
});
test('both refinement actions use Astra with Codex default reasoning, closed schemas, and no tools',async()=>{
 for(const operation of ['simplify','pick']){
  const {c,calls}=protocolClient();await c.answer({phase:'clarify',operation});
  const turn=calls.find(c=>c.method==='turn/start').p;assert.equal(turn.model,clarificationModel);assert.equal(turn.effort,undefined);assert.equal(turn.outputSchema.additionalProperties,false);
  assert.match(instructionFor({phase:'clarify',operation}),/Do not browse/);
  if(operation==='simplify')assert.equal(turn.outputSchema.properties.questions.maxItems,1);else assert.deepEqual(turn.outputSchema.required,['answer','reason']);
 }
});
test('multiple choices and custom text persist as drafts and answers without mixing jobs or questions',async t=>{
 const f=await fixture(t);await generate(f);
 await f.service.call('saveDraft',{...params(f),field:'clarification',choices:[1,0],text:'Synthetic custom detail'});
 const reopened=new ProblemStore(join(f.dir,'test.sqlite'));
 try{const c=new ProblemService(reopened,{}).snapshot().clarification;assert.deepEqual(c.draftChoices,[0,1]);assert.equal(c.draft,'Synthetic custom detail');}finally{reopened.close();}
 const other=await f.service.call('newJob');assert.equal(other.clarification,null);await f.service.call('selectJob',{id:f.id});
 await f.service.call('answerClarification',{...params(f),choices:[1,0],text:'Synthetic custom detail'});
 const c=f.service.snapshot().clarification;assert.deepEqual(c.draftChoices,[]);assert.equal(c.draft,'');assert.deepEqual(c.responses[0].choices,question().options);assert.equal(c.responses[0].customText,'Synthetic custom detail');
 assert.equal(c.responses[0].text,question().options.join('\n')+'\nSynthetic custom detail');
 await f.service.call('answerClarification',{...params(f),choices:[],text:'Custom only'});
 assert.equal(f.service.snapshot().onboarding.stage,'researchReady');assert.equal(f.service.clarification.context()[1].text,'Custom only');
});
test('choice-only works; empty answers fail; simplifying clears previous selected drafts',async t=>{
 const f=await fixture(t);await generate(f);
 await assert.rejects(f.service.call('answerClarification',{...params(f),choices:[],text:'  '}));
 await f.service.call('answerClarification',{...params(f),choices:[0,1],text:''});
 await f.service.call('saveDraft',{...params(f),field:'clarification',choices:[1],text:'Draft'});
 f.clients.chatgpt.answer=async()=>({questions:[question()]});await f.service.call('simplifyClarification',params(f));
 const c=f.service.snapshot().clarification;assert.deepEqual(c.draftChoices,[]);assert.equal(c.draft,'');assert.equal(c.responses.length,1);
});
