import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CodexClient} from '../server/focus/clients.mjs';
import {webProgress} from '../server/focus/progress.mjs';

test('web progress accepts null and omitted action details at both lifecycle stages',()=>{
 for(const action of [null,undefined,{}]){
  assert.equal(webProgress(action),'Checking public sources…');
  assert.equal(webProgress(action,true),'Reviewing web findings…');
 }
});

test('mutation proof: removing null-action handling recreates the original crash',async()=>{
 const source=readFileSync(new URL('../server/focus/progress.mjs',import.meta.url),'utf8');
 const broken=source.replace('action??={};','');assert.notEqual(broken,source);
 const module=await import('data:text/javascript,'+encodeURIComponent(broken));
 assert.throws(()=>module.webProgress(null),/Cannot read properties of null/);
});

async function searchRun(phase,progress){
 const client=new CodexClient('/tmp/synthetic-unused'),notices=[],disconnects=[];
 client.on('notice',message=>notices.push(message));
 client.on('disconnected',error=>disconnects.push(error));
 client.account=async()=>({connected:true});
 client.rpc=async method=>{
  if(method==='thread/start')return {thread:{id:'synthetic'},model:'gpt-6-astra'};
  if(method==='turn/start'){
   queueMicrotask(()=>{
    for(const method of ['item/started','item/completed'])client.receiveLine(JSON.stringify({method,params:{threadId:'synthetic',item:{id:'search',type:'webSearch',query:'',action:null,results:null}}}));
    client.receiveLine(JSON.stringify({method:'item/completed',params:{threadId:'synthetic',item:{type:'agentMessage',phase:'final_answer',text:'{"reply":"Synthetic findings","memories":[]}'}}}));
    client.receiveLine(JSON.stringify({method:'turn/completed',params:{threadId:'synthetic',turn:{status:'completed'}}}));
   });
   return {turn:{id:'synthetic-turn'}};
  }
  return {};
 };
 const result=await client.answer({phase},undefined,progress);
 assert.equal(result.reply,'Synthetic findings');assert.equal(disconnects.length,0);
 assert.equal(client.listenerCount('notification'),0);assert.equal(client.listenerCount('disconnected'),1);
 return notices;
}

test('valid JSON search events with null actions reach a final result through the line reader',async()=>{
 for(const phase of ['research','execute']){
  const progress=[];await searchRun(phase,line=>progress.push(line));
  assert.deepEqual(progress,['Checking public sources…','Reviewing web findings…']);
 }
});

test('a deliberately broken status callback cannot disconnect or discard the research result',async()=>{
 const notices=await searchRun('research',()=>{throw new Error('SYNTHETIC_PRIVATE_DIAGNOSTIC');});
 assert.equal(notices.length,2);
 assert.ok(notices.every(message=>message==='Search status unavailable; research is continuing.'));
 assert.doesNotMatch(notices.join(' '),/SYNTHETIC_PRIVATE_DIAGNOSTIC/);
});

test('invalid JSON and an internal update-handler crash produce distinct safe errors',()=>{
 for(const brokenJSON of [true,false]){
  const client=new CodexClient('/tmp/synthetic-unused'),errors=[];
  client.on('disconnected',error=>errors.push(error));
  if(!brokenJSON)client.on('notification',()=>{throw new Error('SYNTHETIC_PRIVATE_DIAGNOSTIC');});
  client.receiveLine(brokenJSON?'not JSON':JSON.stringify({method:'synthetic/event',params:{}}));
  assert.equal(errors.length,1);
  assert.equal(errors[0].message,brokenJSON?'The Codex client sent an invalid response.':'onejob could not process a Codex update. Your notes are saved.');
  assert.ok(errors[0].cause instanceof Error);
  assert.doesNotMatch(errors[0].message,/SYNTHETIC_PRIVATE_DIAGNOSTIC/);
 }
});
