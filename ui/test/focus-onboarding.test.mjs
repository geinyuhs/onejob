import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,cpSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ProblemStore} from '../server/focus/store.mjs';
import {ProblemService} from '../server/focus/service.mjs';
function fixture(t,Service=ProblemService){const dir=mkdtempSync(join(tmpdir(),'onejob-flow-'));const store=new ProblemStore(join(dir,'test.sqlite'));t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});let connected=true;const calls=[];const clients={chatgpt:{account:async()=>({connected}),answer:async context=>{calls.push(context);return {reply:'A synthetic plan based on the supplied context.',memories:[]};}}};return {store,clients,calls,service:new Service(store,clients),setConnected:v=>connected=v};}
async function ready(service,text){await service.call('describe',{text});await service.call('skipClarifications',{id:service.store.active().id});}
test('optional prior attempts persist per job and reach research with the original problem',async t=>{
 const f=fixture(t);const a=await f.service.call('newJob');await f.service.call('modelReady');
 await f.service.call('describe',{text:'A synthetic mural problem'});
 assert.equal(f.service.snapshot().onboarding.stage,'attempts');assert.equal(f.calls.length,0);
 await f.service.call('saveDraft',{id:a.problem.id,field:'tried',text:'Tried a synthetic sketch'});
 const reopened=new ProblemService(f.store,f.clients);
 assert.equal(reopened.snapshot().onboarding.stage,'attempts');assert.equal(reopened.snapshot().problem.brief.tried,'Tried a synthetic sketch');
 await reopened.call('skipClarifications',{id:a.problem.id});await reopened.call('research');
 assert.match(JSON.stringify(f.calls[0]),/A synthetic mural problem/);assert.match(JSON.stringify(f.calls[0]),/Tried a synthetic sketch/);
 const b=await reopened.call('newJob');assert.equal(b.problem.brief.tried,'');
 await reopened.call('modelReady');await reopened.call('describe',{text:'Another synthetic problem'});
 await reopened.call('skipClarifications',{id:b.problem.id});await reopened.call('research');assert.equal(reopened.snapshot().onboarding.stage,'plan');assert.equal(reopened.snapshot().problem.brief.tried,'');
});
test('new jobs persist independently; switching scopes context and resumes the saved stage',async t=>{
 const f=fixture(t),a=await f.service.call('newJob');assert.equal(a.onboarding.stage,'connect');assert.equal(a.entries.length,0);
 await f.service.call('modelReady');await ready(f.service,'Painting a mural.\n'.repeat(100));await f.service.call('research');const plan=f.service.snapshot();assert.equal(plan.onboarding.stage,'plan');assert.match(plan.onboarding.plan,/synthetic/);assert.equal(f.calls[0].phase,'research');
 const b=await f.service.call('newJob');assert.equal(b.jobs.length,2);assert.equal(b.entries.length,0);assert.equal(b.archives.length,0);
 await f.service.call('selectJob',{id:a.problem.id});assert.equal(f.service.snapshot().onboarding.stage,'plan');assert.match(f.store.context('mural').recent[0].text,/mural/);
 f.clients.chatgpt.answer=async()=>({reply:'Synthetic completed layout.',memories:[],execution:{status:'completed',question:''}});
 await f.service.call('acceptPlan');assert.equal(f.service.snapshot().onboarding.stage,'results');
 await f.service.call('selectJob',{id:b.problem.id});assert.equal(f.store.retrieve('mural').length,0);
});
test('failed research preserves the full draft for retry and does not invent a plan',async t=>{const f=fixture(t);await f.service.call('newJob');await f.service.call('modelReady');await ready(f.service,'Synthetic full draft');f.clients.chatgpt.answer=async()=>{throw new Error('offline');};await assert.rejects(f.service.call('research'),/offline/);assert.equal(f.service.snapshot().onboarding.stage,'researchReady');assert.equal(f.service.snapshot().onboarding.draft,'Synthetic full draft');assert.equal(f.service.snapshot().onboarding.plan,'');});
test('restart recovers interrupted research without auto-dispatching a model',async t=>{const f=fixture(t);await f.service.call('newJob');await f.service.call('modelReady');await ready(f.service,'Synthetic draft');f.service.flow.stage('research');const reopened=new ProblemService(f.store,f.clients);assert.equal(reopened.snapshot().onboarding.stage,'researchReady');assert.equal(f.calls.length,0);});
async function signedOut(t,Service){const f=fixture(t,Service);await f.service.call('newJob');f.setConnected(false);await assert.rejects(f.service.call('modelReady'),/Sign in/);}
async function researchGate(t,Service){const f=fixture(t,Service);await f.service.call('newJob');await assert.rejects(f.service.call('research',{text:'Synthetic'}),/clarifying questions/);}
async function describeGate(t,Service){const f=fixture(t,Service);await f.service.call('newJob');await assert.rejects(f.service.call('describe',{text:'Synthetic'}),/Connect/);}
async function planGate(t,Service){const f=fixture(t,Service);await f.service.call('newJob');await assert.rejects(f.service.call('acceptPlan'),/Review/);}
async function reviseGate(t,Service){const f=fixture(t,Service);await f.service.call('newJob');await assert.rejects(f.service.call('reviseProblem'),/Connect/);}
async function busyGate(t,Service){const f=fixture(t,Service);await f.service.call('newJob');await f.service.call('modelReady');await ready(f.service,'Synthetic');let finish;f.clients.chatgpt.answer=()=>new Promise(r=>finish=r);const run=f.service.call('research');try{await assert.rejects(f.service.call('newJob'),/Stop/);}finally{finish({reply:'Synthetic plan',memories:[]});await run.catch(error=>{});}}
async function missingJob(t,Service){const f=fixture(t,Service);await f.service.call('newJob');await assert.rejects(f.service.call('selectJob',{id:'missing'}),/not found/);}
async function staleAccount(t,Service){const f=fixture(t,Service);await f.service.call('newJob');let resolve;f.clients.chatgpt.account=()=>new Promise(r=>resolve=r);const pending=f.service.call('modelReady');await f.service.call('newJob');resolve({connected:true});await assert.rejects(pending,/selection changed/);}
for(const [name,scenario,file,guard] of [
 ['signed-out model',signedOut,'service.mjs','if(!account.connected)'],
 ['research before connection',researchGate,'service.mjs',"if(this.flow.state().stage!=='researchReady' || !this.clarification.ready())"],
 ['describe before connection',describeGate,'service.mjs',"if(this.flow.state().stage!=='problem')"],
 ['accept before plan',planGate,'service.mjs',"if(this.flow.state().stage!=='plan')throw new ProblemError('Review a completed plan first.');"],
 ['revise before connection',reviseGate,'service.mjs',"if(!['plan','work','problem','attempts'].includes(this.flow.state().stage))"],
 ['switch during research',busyGate,'service.mjs',"if(this.job)throw new ProblemError('Stop the current run before switching jobs.');"],
 ['unknown job',missingJob,'onboarding.mjs','if(!row)'],
 ['account checked for another job',staleAccount,'service.mjs',"if(this.store.active()?.id!==id || (this.store.config()?.provider||'chatgpt')!==provider)"],
]) {
 test(name+' is blocked',t=>scenario(t,ProblemService));
 test('mutation proof: '+name,async t=>{const dir=mkdtempSync(join(tmpdir(),'onejob-flow-mutant-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));cpSync(new URL('../server/focus/',import.meta.url),dir,{recursive:true,filter:path=>!path.includes('node_modules')});const path=join(dir,file),s=readFileSync(path,'utf8');assert.ok(s.includes(guard));writeFileSync(path,s.replace(guard,guard.endsWith(';')?'':'if(false)'));const {ProblemService:Broken}=await import(pathToFileURL(join(dir,'service.mjs')));await assert.rejects(scenario(t,Broken));});
}
test('drafts persist and delayed writes cannot edit another job',async t=>{const f=fixture(t);const a=await f.service.call('newJob');await f.service.call('modelReady');await f.service.call('saveDraft',{id:a.problem.id,text:'Synthetic unsent draft'});const b=await f.service.call('newJob');await assert.rejects(f.service.call('saveDraft',{id:a.problem.id,text:'Late draft'}),/another job/);assert.equal(f.service.snapshot().onboarding.draft,'');await f.service.call('selectJob',{id:a.problem.id});assert.equal(f.service.snapshot().onboarding.draft,'Synthetic unsent draft');});
test('mutation proof: delayed draft guard prevents cross-job writes',async t=>{const dir=mkdtempSync(join(tmpdir(),'onejob-draft-mutant-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));cpSync(new URL('../server/focus/',import.meta.url),dir,{recursive:true,filter:path=>!path.includes('node_modules')});const path=join(dir,'service.mjs'),source=readFileSync(path,'utf8');writeFileSync(path,source.replace('if(this.store.active()?.id!==p.id)','if(false)'));const {ProblemService:Broken}=await import(pathToFileURL(path));const f=fixture(t,Broken),a=await f.service.call('newJob');await f.service.call('newJob');await assert.rejects(async()=>assert.rejects(f.service.call('saveDraft',{id:a.problem.id,text:'Late draft'}),/another job/));});

async function openScenario(t,Service=ProblemService){
 const f=fixture(t,Service);
 const first=await f.service.call('openJob');assert.equal(first.onboarding.stage,'connect');assert.ok(first.problem);
 await f.service.call('modelReady');await f.service.call('saveDraft',{id:first.problem.id,text:'Synthetic saved draft'});
 const reopened=await f.service.call('openJob');assert.equal(reopened.problem.id,first.problem.id,'opening must keep the selected job');assert.equal(reopened.onboarding.stage,'problem');assert.equal(reopened.onboarding.draft,'Synthetic saved draft');assert.equal(reopened.jobs.length,1);
 const next=await f.service.call('newJob');const menuOpen=await f.service.call('openJob');assert.equal(menuOpen.problem.id,next.problem.id);assert.equal(menuOpen.jobs.length,2);
}
test('opening creates the first job directly and preserves existing jobs and drafts',t=>openScenario(t));
test('mutation proof: opening must not create a duplicate job',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'onejob-open-mutant-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 cpSync(new URL('../server/focus/',import.meta.url),dir,{recursive:true,filter:path=>!path.includes('node_modules')});
 const path=join(dir,'service.mjs'),s=readFileSync(path,'utf8');const guard='if(!this.store.active())this.flow.create();';assert.ok(s.includes(guard));writeFileSync(path,s.replace(guard,'this.flow.create();'));
 const {ProblemService:Broken}=await import(pathToFileURL(path));await assert.rejects(openScenario(t,Broken),/opening must keep the selected job/);
});
test('both account statuses are independent and expose only readiness flags',async t=>{
 const f=fixture(t);let reads=0;
 f.clients.chatgpt.account=async()=>{reads++;return {connected:true,plan:'synthetic metadata',privateValue:'synthetic private field'};};
 f.clients.claude={account:async()=>{reads++;throw new Error('synthetic private error');}};
 assert.deepEqual(await f.service.call('modelAccounts'),{chatgpt:{connected:true,checked:true},claude:{connected:false,checked:false}});
 assert.equal(reads,2);assert.equal(f.calls.length,0,'account checks must not invoke inference');
 f.clients.chatgpt.account=async()=>{throw new Error('unavailable');};f.clients.claude.account=async()=>({connected:true});
 assert.deepEqual(await f.service.call('modelAccounts'),{chatgpt:{connected:false,checked:false},claude:{connected:true,checked:true}});
});
async function truthfulStatus(t,Service=ProblemService){const f=fixture(t,Service);f.clients.claude={account:async()=>({connected:'false'})};assert.equal((await f.service.call('modelAccounts')).claude.connected,false,'only a verified boolean true can mark an account connected');}
test('an unverified account status cannot produce a connected checkmark',t=>truthfulStatus(t));
test('mutation proof: truthy account metadata cannot mark a model connected',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'onejob-account-mutant-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));cpSync(new URL('../server/focus/',import.meta.url),dir,{recursive:true,filter:path=>!path.includes('node_modules')});const path=join(dir,'service.mjs'),s=readFileSync(path,'utf8');const check='result.value?.connected===true';assert.ok(s.includes(check));writeFileSync(path,s.replace(check,'Boolean(result.value?.connected)'));
 const {ProblemService:Broken}=await import(pathToFileURL(path));await assert.rejects(truthfulStatus(t,Broken),/only a verified boolean true/);
});
