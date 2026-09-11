import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,rmSync,cpSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {HermesClient,hermesRequest,checkHermesReady} from '../server/focus/hermes-client.mjs';
import {communicationPolicy,evidencePolicy} from '../server/focus/ai-policy.mjs';

const context={phase:'execute',problem:{id:'synthetic-job',title:'Synthetic task'},hermesScope:{jobId:'synthetic-job',epoch:0},capabilities:{tools:[{name:'memory.search'}]}};
const ready={event:'ready',model:'gpt-6-astra',provider:'openai-codex',tools:['job_history','memory','onejob_action'],fallbacks:0};
const final={reply:'Synthetic finished result.',memories:[],execution:{status:'completed'}};
const tick=()=>new Promise(setImmediate);
function fixture(Client=HermesClient,timeout=1000){
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kills=[];child.kill=s=>child.kills.push(s);
 const writes=[];child.stdin.on('data',b=>writes.push(JSON.parse(String(b))));
 const client=new Client({}, {prepare:()=>({command:'synthetic',args:[],options:{}}),launch:()=>child,timeout});
 return {child,writes,client,event:value=>child.stdout.write(JSON.stringify(value)+'\n'),finish:()=>{child.stdout.write(JSON.stringify({event:'result',text:JSON.stringify(final),model:ready.model,provider:ready.provider})+'\n');child.emit('close',0);}};
}
async function mutate(t,before,after){
 const dir=mkdtempSync(join(tmpdir(),'onejob-hermes-client-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 cpSync(new URL('../server/focus/',import.meta.url),dir,{recursive:true,filter:path=>!path.includes('node_modules')});
 const path=join(dir,'hermes-client.mjs'),source=readFileSync(path,'utf8');assert.ok(source.includes(before));writeFileSync(path,source.replace(before,after));return import(pathToFileURL(path));
}
function readyGate(check=checkHermesReady){
 check(ready,['memory.search'],true);
 for(const override of [{model:'other'},{provider:'other'},{fallbacks:1},{tools:['terminal']},{tools:['onejob_action','terminal']}])assert.throws(()=>check({...ready,...override},['memory.search'],true),/unexpected/);
 assert.throws(()=>check(ready,[]),/unexpected/);
}
test('handshake rejects model substitution, fallback and extra tools',()=>readyGate());
test('mutation proof: each handshake boundary is enforced',async t=>{
 for(const before of ["event.model!==hermesModel","event.provider!=='openai-codex'","event.fallbacks!==0","JSON.stringify(event.tools)!==JSON.stringify(expected)"]){
  const broken=await mutate(t,before,'false');assert.throws(()=>readyGate(broken.checkHermesReady),assert.AssertionError);
 }
});
function phaseGate(make=hermesRequest){
 assert.throws(()=>make({...context,phase:'research'}),/not connected/);
 for(const phase of ['clarify','actionReview']){assert.deepEqual(make({...context,phase}).tools,[]);assert.equal(make({...context,phase}).persistent,false);}
 assert.equal(make(context).persistent,true);
 const request=make(context);assert.deepEqual(request.tools,['memory.search']);assert.ok(request.instruction.includes(communicationPolicy));assert.ok(request.instruction.includes(evidencePolicy));assert.match(request.instruction,/onejob_action/);assert.match(request.prompt,/synthetic-job/);
}
test('preview fails closed for research and keeps clarification/review tool-free',()=>phaseGate());
test('only execution supplies a persistent host scope to the launcher',async()=>{
 for(const phase of ['execute','work','clarify','actionReview']){
  let scope;
  const client=new HermesClient({}, {prepare:options=>{scope=options.scope;throw new Error('Synthetic launch stopped');}});
  await assert.rejects(client.answer({...context,phase}),/Synthetic launch stopped/);
  assert.deepEqual(scope,['execute','work'].includes(phase)?context.hermesScope:undefined);
 }
});
test('mutation proof: a mismatched job cannot choose another profile',async t=>{
 const gate=make=>assert.throws(()=>make({...context,hermesScope:{jobId:'synthetic-other',epoch:0}}),/different job/);
 gate(hermesRequest);
 const broken=await mutate(t,'context.hermesScope.jobId!==context.problem?.id','false');assert.throws(()=>gate(broken.hermesRequest));
});
test('mutation proof: enabling tools in isolated review fails',async t=>{
 const broken=await mutate(t,"['execute','work'].includes(context.phase)",'true');assert.throws(()=>phaseGate(broken.hermesRequest),assert.AssertionError);
});
test('two tool steps remain in one Hermes run; app results go back before completion',async()=>{
 const f=fixture(),calls=[];
 const answer=f.client.answer(context,null,()=>{},async action=>{calls.push(action);return {result:'synthetic evidence'};});
 f.event(ready);
 for(const id of [1,2]){f.event({event:'action',id,action:{tool:'memory.search',arguments:{query:'synthetic'}}});await tick();assert.equal(f.writes.at(-1).id,id);}
 f.finish();assert.deepEqual(await answer,final);assert.equal(calls.length,2);assert.equal(f.writes.length,3);assert.equal(f.client.runs.size,0);
});
async function actionGate(Client=HermesClient){
 for(const scenario of ['early','unknown','duplicate','concurrent']){
  const f=fixture(Client);let calls=0,release;
  const promise=f.client.answer(context,null,()=>{},async()=>{calls++;if(scenario==='concurrent')await new Promise(r=>release=r);return {};});
  const rejected=assert.rejects(promise);
  if(scenario!=='early')f.event(ready);
  f.event({event:'action',id:1,action:{tool:scenario==='unknown'?'terminal':'memory.search',arguments:{query:'synthetic'}}});
  if(scenario==='duplicate'){await tick();f.event({event:'action',id:1,action:{tool:'memory.search',arguments:{}}});}
  if(scenario==='concurrent')f.event({event:'action',id:2,action:{tool:'memory.search',arguments:{}}});
  await rejected;assert.equal(calls,['early','unknown'].includes(scenario)?0:1);release?.();
 }
}
test('early, unknown, replayed and overlapping actions never reach the executor',()=>actionGate());
test('mutation proof: a tool outside the catalog fails the protocol test',async t=>{
 const broken=await mutate(t,'!request.tools.includes(event.action?.tool)','false');
 await assert.rejects(actionGate(broken.HermesClient));
});
async function stopGate(Client=HermesClient){
 const f=fixture(Client),controller=new AbortController();let release,toolSignal;
 const pending=f.client.answer(context,controller.signal,()=>{},async(action,signal)=>{toolSignal=signal;await new Promise(r=>release=r);return {result:'late'};});
 const rejected=assert.rejects(pending,/Stopped/);f.event(ready);f.event({event:'action',id:1,action:{tool:'memory.search',arguments:{}}});await tick();
 controller.abort();await rejected;assert.equal(toolSignal.aborted,true);release();await tick();
 assert.equal(f.writes.length,1);assert.ok(f.child.kills.includes('SIGTERM'));f.finish();assert.equal(f.client.runs.size,0);
}
test('Stop cancels a pending tool and discards late results',()=>stopGate());
test('closing the client cancels all active runs',async()=>{
 const f=fixture(),pending=f.client.answer(context);const rejected=assert.rejects(pending,/Stopped/);f.client.close();await rejected;assert.ok(f.child.kills.length);
});
test('already-aborted work never launches',async()=>{
 const client=new HermesClient({}, {prepare:()=>assert.fail('must not prepare')});await assert.rejects(client.answer(context,AbortSignal.abort()));
});
async function quietModel(Client,t){
 t.mock.timers.enable({apis:['setTimeout']});
 const f=fixture(Client,180000),progress=[];
 const pending=f.client.answer(context,null,text=>progress.push(text));pending.catch(error=>{});
 f.event(ready);
 for(let i=0;i<12;i++){t.mock.timers.tick(60000);f.event({event:'heartbeat'});await tick();}
 assert.equal(f.child.kills.length,0,'a live quiet model must outlast the former three-minute deadline');
 assert.equal(progress.length,0,'worker liveness is not model progress');
 f.event({event:'activity'});assert.equal(progress.length,1);
 f.finish();assert.deepEqual(await pending,final);
}
test('a live worker can wait on a quiet model without fake progress or a three-minute cutoff',t=>quietModel(HermesClient,t));
test('mutation proof: ignoring healthy worker heartbeats reproduces the premature cutoff',async t=>{
 const broken=await mutate(t,"if(event.event==='heartbeat'&&ready)return;",'');
 await assert.rejects(quietModel(broken.HermesClient,t));
});
test('provider timeout errors are distinct from a dead worker and keep their safe category',async()=>{
 const f=fixture(),pending=f.client.answer(context),rejected=assert.rejects(pending,/model request timed out/);
 f.event(ready);f.event({event:'error',category:'TimeoutError',message:'SYNTHETIC_PRIVATE_ERROR'});await rejected;
});
test('missing worker heartbeats still expire; Stop still interrupts a live quiet worker',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=fixture(),pending=f.client.answer(context),rejected=assert.rejects(pending,/worker connection/);
 f.event(ready);t.mock.timers.tick(1001);await rejected;assert.ok(f.child.kills.length);
 const g=fixture(),controller=new AbortController(),run=g.client.answer(context,controller.signal),stopped=assert.rejects(run,/Stopped/);
 g.event(ready);g.event({event:'heartbeat'});controller.abort();await stopped;
});
test('progress and heartbeats never restart the timeout during an outstanding tool approval',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=fixture(),controller=new AbortController();let release;
 const pending=f.client.answer(context,controller.signal,()=>{},()=>new Promise(r=>release=r));pending.catch(error=>{});
 f.event(ready);f.event({event:'action',id:1,action:{tool:'memory.search',arguments:{}}});
 f.event({event:'progress'});f.event({event:'heartbeat'});t.mock.timers.tick(1000000);await tick();
 assert.equal(f.child.kills.length,0,'approval wait is not a dead worker');
 release({});await tick();f.finish();await pending;
});
test('tool failure stops the worker and cancels approval signals',async()=>{
 const f=fixture();let signal;const pending=f.client.answer(context,null,()=>{},async(a,s)=>{signal=s;throw new Error('Synthetic connection failed');});
 const rejected=assert.rejects(pending,/Synthetic connection failed/);f.event(ready);f.event({event:'action',id:1,action:{tool:'memory.search',arguments:{}}});await rejected;assert.equal(signal.aborted,true);
});
test('Hermes can continue past twelve tool steps and forwards the selected thinking effort',async()=>{
 const f=fixture();let calls=0;const pending=f.client.answer({...context,reasoningEffort:'medium'},null,()=>{},async()=>{calls++;return {};});
 f.event(ready);for(let id=1;id<=15;id++){f.event({event:'action',id,action:{tool:'memory.search',arguments:{query:'synthetic'}}});await tick();}
 f.finish();await pending;assert.equal(calls,15);assert.equal(f.writes[0].reasoningEffort,'medium');
});
test('malformed, oversized and incomplete output never becomes a saved answer',async()=>{
 for(const mode of ['malformed','large','no-result','wrong-final-model','action-final','error']){
  const f=fixture(),pending=f.client.answer(context),rejected=assert.rejects(pending);f.event(ready);
  if(mode==='malformed')f.child.stdout.write('bad json\n');
  if(mode==='large')f.child.stdout.write('x'.repeat(1000001));
  if(mode==='wrong-final-model')f.event({event:'result',text:JSON.stringify(final),model:'other',provider:ready.provider});
  if(mode==='action-final')f.event({event:'result',text:JSON.stringify({action:{tool:'memory.search'}}),model:ready.model,provider:ready.provider});
  if(mode==='error')f.event({event:'error',category:'SyntheticError'});
  if(mode==='no-result')f.child.emit('close',0);
  await rejected;
 }
});
test('a finished plain-text answer survives the Hermes protocol for tool-free formatting',async()=>{
 const f=fixture(),pending=f.client.answer(context);
 f.event(ready);
 f.event({event:'result',text:'Synthetic research is complete.',model:ready.model,provider:ready.provider});
 f.child.emit('close',0);
 assert.deepEqual(await pending,{unformattedAnswer:'Synthetic research is complete.'});
 assert.equal(f.writes.length,1,'the worker never receives a second research turn');
});
