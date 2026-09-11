import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,cpSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ProblemStore} from '../server/focus/store.mjs';
import {ProblemService} from '../server/focus/service.mjs';
function fixture(t,Service=ProblemService){
 const dir=mkdtempSync(join(tmpdir(),'plan-edit-')),store=new ProblemStore(join(dir,'test.sqlite'));
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const calls=[],clients={chatgpt:{answer:async context=>{calls.push(context);return {execution:{status:'completed'},reply:'Synthetic findings',memories:[]};}}};
 const service=new Service(store,clients);service.flow.create();
 store.add('assistant','Synthetic problem\n\nSynthetic research');service.flow.finish();
 return {store,service,clients,calls,params:{id:store.active().id,expectedPlan:service.flow.state().plan,problem:'Edited problem\n\nSecond paragraph',research:'Edited research'}};
}
test('edited plan sections persist, preserve history, and reach research without running on save',async t=>{
 const f=fixture(t),before=f.store.snapshot().entries[0];
 const saved=await f.service.call('editPlan',f.params);
 assert.equal(saved.onboarding.plan,'Edited problem\n\nSecond paragraph\n\nEdited research');
 assert.deepEqual(saved.onboarding.planParts,{problem:f.params.problem,research:f.params.research});
 assert.equal(f.store.snapshot().entries.find(e=>e.id===before.id).text,before.text);
 assert.equal(f.calls.length,0);assert.equal(saved.onboarding.stage,'plan');
 const reopened=new ProblemService(f.store,f.clients);assert.deepEqual(reopened.snapshot().onboarding.planParts,saved.onboarding.planParts);
 await reopened.call('acceptPlan');assert.equal(f.calls[0].plan,saved.onboarding.plan);assert.equal(f.calls[0].researchOnly,true);
});
for(const [name,change,pattern] of [
 ['other job',f=>f.params.id='other',/another job/],
 ['stale text',f=>f.params.expectedPlan='old',/changed/],
 ['running',f=>f.service.job={},/Stop/],
 ['wrong stage',f=>f.service.flow.stage('results'),/review/],
 ['empty summary',f=>f.params.problem=' ',/text/],
 ['oversized plan',f=>f.params.research='x'.repeat(12001),/text/],
 ['invalid research',f=>f.params.research={},/text/],
 ['retired source',f=>f.store.db.exec("UPDATE entries SET status='stale' WHERE kind='assistant'"),/context changed/],
])test('plan edit rejects '+name,async t=>{const f=fixture(t);change(f);await assert.rejects(f.service.call('editPlan',f.params),pattern);});
test('editing cannot detach a plan from retired evidence',async t=>{
 const f=fixture(t);await f.service.call('editPlan',f.params);
 f.store.db.exec("UPDATE entries SET status='stale' WHERE kind='assistant'");
 await assert.rejects(f.service.call('acceptPlan'),/context changed/);assert.equal(f.calls.length,0);
});
for(const [name,guard,change,pattern] of [
 ['job identity',"if(this.store.active()?.id!==p.id)throw new ProblemError('This plan belongs to another job.');",f=>f.params.id='other',/another job/],
 ['stale draft',"if(this.flow.state().plan!==p.expectedPlan)throw new ProblemError('The plan changed. Review the latest version before saving.');",f=>f.params.expectedPlan='old',/changed/],
 ['running job',"if(this.job)throw new ProblemError('Stop the current run before editing the plan.');",f=>f.service.job={},/Stop/],
 ['review stage',"if(this.flow.state().stage!=='plan')throw new ProblemError('Only a plan awaiting review can be edited.');",f=>f.service.flow.stage('results'),/review/],
])test('mutation proof: plan edit '+name,async t=>{
 const dir=mkdtempSync(join(tmpdir(),'plan-edit-mutant-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 cpSync(new URL('../server/focus/',import.meta.url),dir,{recursive:true,filter:p=>!p.includes('node_modules')});
 const path=join(dir,'service.mjs'),source=readFileSync(path,'utf8');assert.ok(source.includes(guard));writeFileSync(path,source.replace(guard,''));
 const {ProblemService:Broken}=await import(pathToFileURL(path));const f=fixture(t,Broken);change(f);
 await assert.rejects(async()=>assert.rejects(f.service.call('editPlan',f.params),pattern));
});
