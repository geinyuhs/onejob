import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProblemStore} from '../server/focus/store.mjs';
import {ProblemService} from '../server/focus/service.mjs';
import {instructionFor} from '../server/focus/prompt.mjs';
import {setupSettings} from '../server/focus/job-settings.mjs';

function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'onejob-settings-')),path=join(dir,'store.sqlite'),store=new ProblemStore(path);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const calls=[],client={account:async()=>({connected:true}),answer:async context=>{calls.push(structuredClone(context));return context.phase==='clarify'?{questions:[],settings:{helpMode:'ongoing',scope:''}}:{reply:'Synthetic result',memories:[],execution:{status:'completed'}};}};
 return {path,store,calls,client,service:new ProblemService(store,{chatgpt:client})};
}
test('research scope requires context coverage and reserves scheduling for the later empty step',()=>{
 const plan=instructionFor({phase:'research'}),research=instructionFor({phase:'execute',researchOnly:true});
 assert.match(plan,/Plan only the research/);
 for(const phrase of ['every team','full roster','league','scoring','NFL season schedule','bye weeks','source references','Scheduled actions','not implemented yet'])assert.ok(research.includes(phrase),phrase);
 assert.match(research,/Do not change lineups/);
 assert.doesNotMatch(instructionFor({phase:'clarify'}),/For fantasy football/);
});
async function setup(f,text='Arrange synthetic paper shapes.'){
 await f.service.call('newJob');await f.service.call('modelReady');await f.service.call('describe',{text});
 return f.service.call('clarify',{id:f.store.active().id,tried:''});
}
test('setup persists ongoing help; later agents consume settings without re-defaulting',async t=>{
 const f=fixture(t);await setup(f);assert.deepEqual(f.store.jobSettings(),{helpMode:'ongoing',scope:''});
 await f.service.call('research');await f.service.call('acceptPlan');
 for(const context of f.calls.filter(c=>c.phase!=='clarify'))assert.deepEqual(context.jobSettings,{helpMode:'ongoing',scope:''});
 assert.match(instructionFor({phase:'clarify'}),/Assume the user wants ongoing help/);
 for(const phase of ['research','work','execute']){const prompt=instructionFor({phase});assert.doesNotMatch(prompt,/Assume the user wants ongoing help|zero to three|at most 12 tool steps/);assert.match(prompt,/context.jobSettings/);}
});
test('explicit one-time scope persists across restart and remains isolated by job',async t=>{
 const f=fixture(t),scope='Only do a one-time review.';
 f.client.answer=async()=>({questions:[],settings:{helpMode:'one_time',scope}});
 await setup(f,scope);const id=f.store.active().id;
 const reopened=new ProblemStore(f.path);
 try{assert.deepEqual(reopened.jobSettings(),{helpMode:'one_time',scope});}finally{reopened.close();}
 await f.service.call('newJob');assert.equal(f.store.jobSettings(),null);
 await f.service.call('selectJob',{id});assert.deepEqual(f.store.jobSettings(),{helpMode:'one_time',scope});
});
test('malformed or invented setup settings fail before saving questions or settings',async t=>{
 for(const settings of [{helpMode:'forever',scope:''},{helpMode:'one_time',scope:''},{helpMode:'one_time',scope:'Invented user request'},{helpMode:'ongoing',scope:'',autoApprove:true}]){
  const f=fixture(t);f.client.answer=async()=>({questions:[],settings});
  await assert.rejects(setup(f),/settings|scope/);assert.equal(f.service.clarification.state(),null);assert.equal(f.store.jobSettings(),null);
 }
});
test('ordinary execution continues beyond twelve tool steps without a fake user decision',async t=>{
 const f=fixture(t);await setup(f);await f.service.call('research');let steps=0;
 f.service.tools={catalog:()=>({tools:[],connections:[]}),snapshot:()=>({actions:[]}),execute:async()=>({tool:'memory.search',result:[]})};
 f.client.answer=async()=>++steps<=14?{action:{tool:'memory.search',arguments:{query:'synthetic'}}}:{reply:'Finished synthetic lookup',memories:[],execution:{status:'completed'}};
 assert.equal((await f.service.call('acceptPlan')).execution.status,'completed');assert.equal(steps,15);
});
test('mutation proof: each settings check rejects a deliberately broken setup response',async()=>{
 const source=readFileSync(new URL('../server/focus/job-settings.mjs',import.meta.url),'utf8');
 for(const [start,value,input] of [
  ['if(!value',{helpMode:'unsafe',scope:''},{}],
  ["if((value.helpMode",{helpMode:'one_time',scope:'Invented'}, {problem:'Synthetic request'}],
 ]){
  const begin=source.indexOf(start),end=source.indexOf('\n    throw',begin);assert.ok(begin>=0&&end>begin);
  const broken=await import('data:text/javascript,'+encodeURIComponent(source.slice(0,begin)+'if(false)'+source.slice(end)));
  assert.throws(()=>setupSettings(value,input));assert.doesNotThrow(()=>broken.setupSettings(value,input));
 }
});
test('login instructions prefer the dedicated credential path and identify missing connections',()=>{
 const prompt=instructionFor({phase:'execute'});
 assert.match(prompt,/configured 1Password-backed credentials through the app executor/);
 assert.match(prompt,/Use browser.login/);
 assert.match(prompt,/inspect its status with read-only tools first/);
 assert.doesNotMatch(prompt,/ask the user to verify it first|Only ask the user to complete login/);
 assert.doesNotMatch(instructionFor({phase:'research'}),/Use the configured tools|Only ask the user to complete login/);
});
test('thinking selection is persisted, survives provider changes and reaches later stages',async t=>{
 const f=fixture(t);f.client.checkEffort=async effort=>effort;
 await f.service.call('reasoningEffort',{effort:'high'});await setup(f);
 await f.service.call('research');assert.ok(f.calls.every(context=>context.reasoningEffort==='high'));
 await f.service.call('provider',{provider:'claude'});assert.equal(f.store.config().reasoningEffort,'high');
 await f.service.call('reasoningEffort',{effort:null});assert.equal(f.store.config().reasoningEffort,null);
});
test('thinking settings cannot change during a run or if a run starts during validation',async t=>{
 const f=fixture(t);let resolve;
 f.client.checkEffort=()=>new Promise(done=>resolve=done);
 f.service.job=new AbortController();await assert.rejects(f.service.call('reasoningEffort',{effort:'high'}),/Stop/);assert.equal(resolve,undefined);
 f.service.job=null;const pending=f.service.call('reasoningEffort',{effort:'high'});f.service.job=new AbortController();resolve('high');
 await assert.rejects(pending,/Stop/);assert.equal(f.store.config(),null);
});
