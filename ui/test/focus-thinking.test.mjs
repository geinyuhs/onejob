import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CodexClient} from '../server/focus/clients.mjs';

function client(){
 const c=new CodexClient('/tmp/synthetic-unused'),calls=[];c.start=async()=>{};c.account=async()=>({connected:true});
 c.rpc=async(method,params)=>{calls.push({method,params});
  if(method==='model/list')return {data:[{model:'gpt-6-astra',defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'low',description:'Light'},{reasoningEffort:'high',description:'Deep'}]}],nextCursor:null};
  if(method==='thread/start')return {model:'gpt-6-astra',thread:{id:'synthetic'}};
  return {turn:{id:'synthetic-turn'}};
 };return {c,calls};
}
const event=(c,method,extra={})=>c.emit('notification',{method,params:{threadId:'synthetic',...extra}});
function complete(c){event(c,'item/completed',{item:{type:'agentMessage',text:'{"reply":"Synthetic","memories":[]}'}});event(c,'turn/completed',{turn:{status:'completed'}});}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('thinking modes use the provider catalog and reject unsupported effort before a turn',async()=>{
 const {c,calls}=client();assert.equal((await c.thinkingModes()).defaultEffort,'medium');
 await assert.rejects(c.answer({phase:'execute',reasoningEffort:'imaginary'}),/not supported/);
 assert.equal(calls.some(call=>call.method==='thread/start'),false);
});
test('selected effort reaches turn/start in setup, research and execution; omitted uses Codex default',async()=>{
 for(const phase of ['clarify','research','execute','actionReview','inputReview','publicSearch'])for(const reasoningEffort of [undefined,'high']){
  const {c,calls}=client(),pending=c.answer({phase,reasoningEffort});await flush();
  const turn=calls.find(call=>call.method==='turn/start').params;assert.equal(turn.effort,reasoningEffort);
  assert.equal(turn.model,'gpt-6-astra');complete(c);await pending;
 }
});
test('answer formatting uses native outputSchema, pinned effort and disabled search',async()=>{
 const {c,calls}=client(),pending=c.answer({phase:'answerFormat',answer:'Synthetic research complete.',reasoningEffort:'high'});await flush();
 const start=calls.find(call=>call.method==='thread/start').params,turn=calls.find(call=>call.method==='turn/start').params;
 assert.equal(start.config.web_search,'disabled');assert.equal(turn.model,'gpt-6-astra');assert.equal(turn.effort,'high');
 assert.equal(turn.outputSchema.additionalProperties,false);assert.deepEqual(turn.outputSchema.required,['status','question']);
 complete(c);await pending;
});
test('active progress extends the stall timer; silence still interrupts and Stop remains immediate',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {c}=client(),pending=c.answer({phase:'execute'});await flush();
 t.mock.timers.tick(179000);event(c,'item/reasoning/textDelta',{delta:'Synthetic progress'});
 t.mock.timers.tick(179000);complete(c);assert.equal((await pending).reply,'Synthetic');
 const idle=client(),stalled=idle.c.answer({phase:'execute'});await flush();const rejection=assert.rejects(stalled,/stopped sending updates/);
 t.mock.timers.tick(180001);await rejection;assert.ok(idle.calls.some(call=>call.method==='turn/interrupt'));
 const stopped=client(),controller=new AbortController(),run=stopped.c.answer({phase:'execute'},controller.signal);await flush();const cancelled=assert.rejects(run,/Stopped/);controller.abort();await cancelled;
});
test('mutation proof: unsupported effort check is required',async()=>{
 const source=readFileSync(new URL('../server/focus/clients.mjs',import.meta.url),'utf8');
 const start=source.indexOf('  async checkEffort('),end=source.indexOf('  async answer(',start);
 const method=source.slice(start,end),guard="if(!modes.options?.some(option=>option.reasoningEffort===effort))";
 assert.ok(method.includes(guard));const Broken=new Function('ProblemError','return class {'+method.replace(guard,'if(false)')+'}')(Error);
 const broken=new Broken();broken.thinkingModes=async()=>({options:[]});assert.equal(await broken.checkEffort('imaginary'),'imaginary');
 await assert.rejects(client().c.checkEffort('imaginary'),/not supported/);
});
