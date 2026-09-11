import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {ProblemStore} from '../server/focus/store.mjs';
import {ProblemService} from '../server/focus/service.mjs';
import {ToolRuntime} from '../server/focus/tools/runtime.mjs';
import {cleanConnection,relativeURL,serviceURL} from '../server/focus/tools/connections.mjs';
import {Credentials,redact} from '../server/focus/tools/credentials.mjs';
import {apiRequest,responseText,MCPAdapter,AsideAdapter,screenshotData} from '../server/focus/tools/adapters.mjs';
import {navigationTarget,navigationDecision,automaticTarget,scopedDecision} from '../server/focus/tools/auto.mjs';

function fixture(t,options={}) {
 const dir=mkdtempSync(join(tmpdir(),'onejob-tools-')),store=new ProblemStore(join(dir,'memory.sqlite'));store.create('Synthetic test job');
 const events=[],tools=new ToolRuntime(store,dir,{emit:event=>events.push(event),...options});
 t.after(async()=>{await tools.close();store.close();rmSync(dir,{recursive:true,force:true});});
 const controller=new AbortController(),p=store.active();const execution={runId:'synthetic-run',problemId:p.id,signal:controller.signal,assertCurrent:()=>{assert.equal(store.active()?.id,p.id);assert.equal(store.active()?.revision,p.revision);}};
 return {dir,store,tools,events,controller,execution};
}
const apiConfig={kind:'api',name:'Synthetic API',url:'https://api.example.com',account:'Synthetic vault account',secretRef:'op://test-vault/test-item/credential'};
const spin=()=>new Promise(resolve=>setImmediate(resolve));
test('research-only blocks account changes before approval, credentials or dispatch in either Auto mode',async t=>{
 for(const auto of [false,true]){
  const f=autoFixture(t);f.tools.setAutoMode(f.execution.problemId,auto);
  f.tools.emit=event=>{f.events.push(event);if(event.event==='toolApproval')f.controller.abort();};
  const api=f.tools.connections.save(apiConfig);
  for(const action of [{tool:'api.request',arguments:{connection:api.id,method:'POST',path:'/items'}},{tool:'browser.fill',arguments:{connection:f.c.id,page:'page',selector:'e1',text:'Synthetic change'}}]){
   await assert.rejects(f.tools.execute(action,{...f.execution,researchOnly:true,review:async()=>({decision:'scoped'})}),e=>e.code==='RESEARCH_ONLY');
  }
  await assert.rejects(f.tools.execute(f.action,{...f.execution,researchOnly:true,review:async()=>({decision:'scoped'})}),e=>e.code==='RESEARCH_ONLY');
  assert.equal(f.events.some(e=>e.event==='toolApproval'),false);assert.equal(f.calls(),0);
 }
});
test('research-only allows independently checked navigation without asking',async t=>{
 const f=autoFixture(t);
 await f.tools.execute(f.action,{...f.execution,researchOnly:true,review:async()=>({decision:'navigation'})});
 assert.equal(f.calls(),1);assert.equal(f.events.some(e=>e.event==='toolApproval'),false);
});
test('research can inspect a proposed trade but cannot accept or submit it',async t=>{
 for(const enabled of [false,true])for(const label of ['View Proposed Trade','You have proposed a trade. View Proposed Trade','Accept trade. View Proposed Trade','Accept trade','Submit trade']){
  const f=autoFixture(t);f.page.snapshot=`- link "${label}" [ref=e1]`;f.tools.setAutoMode(f.execution.problemId,enabled);
  const allowed=label.startsWith('View')||label.startsWith('You have');
  const run=f.tools.execute(f.action,{...f.execution,researchOnly:true,review:async()=>({decision:allowed?'navigation':'review'})});
  if(allowed)await run;else await assert.rejects(run,e=>e.code==='RESEARCH_ONLY');
  assert.equal(f.calls(),allowed?1:0);assert.equal(f.events.some(e=>e.event==='toolApproval'),false);
 }
});
test('view-trade links still need a successful independent review',async t=>{
 for(const response of [{decision:'review'},{decision:'navigation',extra:true},new Error('Synthetic review failure')]){
  const f=autoFixture(t);f.page.snapshot='- link "View Proposed Trade" [ref=e1]';
  await assert.rejects(f.tools.execute(f.action,{...f.execution,researchOnly:true,review:async()=>{if(response instanceof Error)throw response;return response;}}),e=>e.code==='RESEARCH_ONLY');
  assert.equal(f.calls(),0);
 }
});
test('mutation proof: Auto cannot expand research into scoped account actions',async t=>{
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs','scoped=!researchOnly&&modeAtStart&&automaticTarget(spec)','scoped=modeAtStart&&automaticTarget(spec)');
 for(const [Runtime,expected] of [[ToolRuntime,0],[Broken,1]]){
  const f=autoFixture(t);Object.setPrototypeOf(f.tools,Runtime.prototype);f.tools.setAutoMode(f.execution.problemId,true);
  const run=f.tools.execute(f.action,{...f.execution,researchOnly:true,review:async()=>({decision:'scoped'})});
  if(Runtime===ToolRuntime)await assert.rejects(run,e=>e.code==='RESEARCH_ONLY');else await run;
  assert.equal(f.calls(),expected);if(Runtime===Broken)assert.throws(()=>assert.equal(f.calls(),0));
 }
});
test('mutation proof: research cannot turn a non-navigation click into manual change approval',async t=>{
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs',"if(researchOnly&&name!=='browser.login')throw researchNavigationBlocked(spec.reviewFailure);",'');
 for(const [Runtime,expected] of [[ToolRuntime,0],[Broken,1]]){
  const f=autoFixture(t);Object.setPrototypeOf(f.tools,Runtime.prototype);
  f.tools.emit=e=>{f.events.push(e);if(e.event==='toolApproval')f.controller.abort();};
  await assert.rejects(f.tools.execute(f.action,{...f.execution,researchOnly:true,review:async()=>({decision:'review'})}));
  assert.equal(f.events.filter(e=>e.event==='toolApproval').length,expected);assert.equal(f.calls(),0);
 }
});
async function noInteractiveCredential(CredentialType=Credentials){
 let opened=0;const credentials=new CredentialType(async()=>{opened++;return {secrets:{resolve:async()=> 'synthetic'}};});
 await assert.rejects(credentials.resolve(apiConfig,{interactive:false}),e=>e.name==='CredentialUnavailable');
 assert.equal(opened,0,'Auto must not launch desktop authorization');
 assert.equal(await credentials.resolve(apiConfig),'synthetic');
}
test('Auto credential resolution never launches desktop authorization',()=>noInteractiveCredential());
test('mutation proof: the noninteractive credential gate fires',async t=>{
 const {Credentials:Broken}=await mutated(t,'credentials.mjs',"if(!interactive && connection.auth!=='oauth')","if(false)");
 await assert.rejects(noInteractiveCredential(Broken),/Missing expected rejection/);
});
test('enabling Auto closes an existing unapproved step as blocked without executing it',async t=>{
 const f=fixture(t),c=f.tools.connections.save(apiConfig);
 const run=f.tools.execute({tool:'api.request',arguments:{connection:c.id,path:'/items'}},f.execution);
 const rejected=assert.rejects(run,e=>e.code==='AUTO_BLOCKED');await spin();
 assert.equal(f.tools.pending.size,1);f.tools.setAutoMode(f.execution.problemId,true);await rejected;
 assert.equal(f.tools.pending.size,0);assert.equal(f.tools.snapshot().actions[0].status,'blocked');
 assert.equal(f.events.filter(e=>e.event==='toolApproval').length,1);
});
test('a stale page during an Auto recheck cannot leave an approval dialog waiting',async t=>{
 const f=autoFixture(t);let reviews=0;
 const run=f.tools.execute(f.action,{...f.execution,review:async()=>({decision:++reviews===1?'review':'navigation'})});run.catch(error=>{});
 await spin();assert.equal(f.tools.pending.size,1);
 f.tools.aside.sessions.get(f.c.id).pages.delete('page');f.tools.setAutoMode(f.execution.problemId,true);await spin();
 try{assert.equal(f.tools.pending.size,0);assert.equal(f.calls(),0);}
 finally{f.controller.abort();await assert.rejects(run);}
});
test('mutation proof: blocked actions cannot be attempted again in the same run',async t=>{
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs',"status IN ('declined','blocked')","status IN ('declined')");
 for(const [Runtime,expected] of [[ToolRuntime,1],[Broken,2]]){
  const f=autoFixture(t);Object.setPrototypeOf(f.tools,Runtime.prototype);f.tools.setAutoMode(f.execution.problemId,true);
  for(let i=0;i<2;i++)await assert.rejects(f.tools.execute(f.action,{...f.execution,review:async()=>({decision:'review'})}));
  assert.equal(f.tools.snapshot().actions.length,expected);
 }
});
const syntheticImage={type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='};
function imageBoundary(parse=screenshotData) {
 assert.ok(parse(syntheticImage)?.startsWith('data:image/png;base64,'));
 for(const image of [{...syntheticImage,mimeType:'image/svg+xml',data:Buffer.from('RIFF0000WEBP').toString('base64')},{...syntheticImage,data:'iVBORw0KGgoA'+'A'.repeat(2000004)},{...syntheticImage,data:'<script>'},{...syntheticImage,data:'YWJj'},{...syntheticImage,mimeType:'image/jpeg'},null])assert.equal(parse(image),null,'unsafe image rejected');
}
test('page preview permits only bounded raster image bytes',()=>imageBoundary());
for(const [before,after] of [["!['image/png','image/jpeg','image/webp'].includes(image.mimeType)","false"],["image.data.length>2000000","false"],["if(!valid)return null;",""]])test('mutation proof: screenshot boundary '+before,async t=>{
 const {screenshotData:broken}=await mutated(t,'adapters.mjs',before,after);
 assert.throws(()=>imageBoundary(broken),/unsafe image rejected/);
});
async function screenshotOwnership(t,Adapter=AsideAdapter) {
 const a=new Adapter('synthetic'),calls=[];
 a.sessions.set('connection',{pages:new Map([['page',{variable:'syntheticTab',url:'https://example.com/',problemId:'job'}]]),client:{callTool:async request=>{calls.push(request);return {content:[syntheticImage]};},close:async()=>{}}});
 const signal=new AbortController().signal;
 assert.equal(await a.screenshot({id:'connection'},{page:'page',problemId:'job'},signal),screenshotData(syntheticImage));
 await assert.rejects(a.screenshot({id:'connection'},{page:'page',problemId:'other'},signal),/belong/);
 assert.equal(calls.length,1);
 assert.match(calls[0].arguments.code,/syntheticTab.screenshot/);
 const displays=[],context={syntheticTab:{url:()=> 'https://example.com/changed',screenshot:async()=>syntheticImage.data},display:data=>displays.push(data)};
 await assert.rejects(vm.runInNewContext('(async()=>{'+calls[0].arguments.code+'})()',context),/Page changed/);
 assert.equal(displays.length,0);
}
test('screenshot reads only the owned task tab at its reviewed URL',t=>screenshotOwnership(t));
test('mutation proof: screenshot ownership cannot be bypassed',async t=>{
 const {AsideAdapter:broken}=await mutated(t,'adapters.mjs','if(!saved || saved.problemId!==problemId)','if(!saved)');
 await assert.rejects(screenshotOwnership(t,broken),/Missing expected rejection/);
});
test('mutation proof: changed page is not presented as the reviewed destination',async t=>{
 const {AsideAdapter:broken}=await mutated(t,'adapters.mjs',".url()!==\u0024{JSON.stringify(saved.url)})throw new Error('Page changed');",".url()!==\u0024{JSON.stringify(saved.url)})void 0;");
 await assert.rejects(screenshotOwnership(t,broken),/Missing expected rejection/);
});
test('screenshots are transient approval data, never tool results or action history',async t=>{
 const f=browserFixture(t),data=screenshotData(syntheticImage);
 f.tools.aside.screenshot=async()=>data;
 const pending=f.tools.execute({tool:'browser.click',arguments:{connection:f.c.id,page:'page',selector:'e1'}},f.execution);
 await spin();const event=f.events.find(e=>e.event==='toolApproval');assert.equal(event.screenshot,data);
 f.tools.resolve(event.id,true);
 assert.ok(!JSON.stringify(await pending).includes(syntheticImage.data));
 assert.ok(!JSON.stringify(f.tools.snapshot()).includes(syntheticImage.data));
});
test('screenshot failures keep manual review available without stale pictures',async t=>{
 const f=browserFixture(t);f.tools.aside.screenshot=async()=>{throw new Error('Synthetic capture failed');};
 const pending=f.tools.execute({tool:'browser.click',arguments:{connection:f.c.id,page:'page',selector:'e1'}},f.execution);
 await spin();const event=f.events.find(e=>e.event==='toolApproval');assert.equal(event.screenshot,null);
 f.tools.resolve(event.id,true);await pending;
});
test('Stop during capture prevents the approval and external click',async t=>{
 const f=browserFixture(t);f.tools.aside.screenshot=async()=>{f.controller.abort();return screenshotData(syntheticImage);};
 await assert.rejects(f.tools.execute({tool:'browser.click',arguments:{connection:f.c.id,page:'page',selector:'e1'}},f.execution));
 assert.equal(f.events.some(e=>e.event==='toolApproval'),false);assert.equal(f.calls(),0);
});
test('written permission responses decline the action without resolving secrets',async t=>{
 let calls=0;const f=fixture(t,{credentials:{resolve:async()=>{calls++;return '';}}}),c=f.tools.connections.save(apiConfig);
 const pending=f.tools.execute({tool:'api.request',arguments:{connection:c.id,path:'/items'}},f.execution);
 const rejected=assert.rejects(pending,error=>{assert.equal(error.feedback,'Use a public page instead.');return /declined/.test(error.message);});
 await spin();f.tools.resolve(f.events.find(e=>e.event==='toolApproval').id,false,'Use a public page instead.');await rejected;assert.equal(calls,0);
});
async function feedbackGuard(t,Runtime=ToolRuntime){
 for(const [approved,text] of [[true,'Only if you change the destination'],[false,'x'.repeat(2001)],[false,{text:'unexpected'}]]){
  const f=fixture(t),runtime=new Runtime(f.store,f.dir,{credentials:{resolve:async()=>{assert.fail('must not resolve credentials');}},emit:e=>f.events.push(e)}),c=runtime.connections.save(apiConfig);
  const pending=runtime.execute({tool:'api.request',arguments:{connection:c.id,path:'/items'}},f.execution),rejected=assert.rejects(pending);await spin();const id=f.events.find(e=>e.event==='toolApproval').id;
  try{assert.throws(()=>runtime.resolve(id,approved,text),/directions|2,000/);}finally{if(runtime.pending.has(id))runtime.resolve(id,false);await rejected;}
 }
}
test('permission feedback cannot also approve or exceed the input boundary',t=>feedbackGuard(t));
test('written directions are stored as user input and reach the next model step',async t=>{
 let requests=0;const f=fixture(t,{credentials:{resolve:async()=>{assert.fail('written response is not permission');}}});
 const c=f.tools.connections.save({kind:'aside',name:'Synthetic browser',browserAccessApproved:true}),login=f.tools.connections.save({kind:'login',name:'Synthetic login',url:'https://example.com',account:'Synthetic account',secretRef:'op://test/item/password',usernameRef:'op://test/item/username'});
 f.tools.aside.sessions.set(c.id,{pages:new Map([['page',{url:'https://example.com/',problemId:f.store.active().id,snapshot:'- textbox "Username" [ref=e1]'}]]),client:{close:async()=>{}}});
 const service=new ProblemService(f.store,{chatgpt:{answer:async context=>{requests++;if(requests===1)return {action:{tool:'browser.login',arguments:{connection:c.id,page:'page',selector:'e1',login:login.id,field:'username'}}};assert.ok(context.recent.some(e=>e.kind==='user'&&e.text==='Use the public guide instead.'));return {reply:'I will use the public guide.',memories:[]};}}},{tools:f.tools});
 const run=service.send('Synthetic task');await spin();await service.call('approval',{id:f.events.find(e=>e.event==='toolApproval').id,approved:false,text:'Use the public guide instead.'});
 const result=await run;assert.equal(requests,2);assert.ok(result.entries.some(e=>e.kind==='user'&&e.text==='Use the public guide instead.'));assert.equal(result.actions[0].status,'declined');
});
test('tool progress names the operation and only reports running after approval',async t=>{
 const f=fixture(t,{credentials:{resolve:async()=>''},api:async()=>({ok:true})});
 const c=f.tools.connections.save(apiConfig);
 const pending=f.tools.execute({tool:'api.request',arguments:{connection:c.id,path:'/items',method:'GET'}},f.execution);
 await spin();assert.ok(f.events.some(e=>e.event==='toolApproval'));assert.equal(f.events.some(e=>e.event==='toolProgress'),false);
 f.tools.resolve(f.events.find(e=>e.event==='toolApproval').id,true);await pending;
 assert.deepEqual(f.events.filter(e=>e.event==='toolProgress').map(({tool,status})=>({tool,status})),[{tool:'api.request',status:'running'},{tool:'api.request',status:'completed'}]);
});
async function approve(f,promise,approved=true){await spin();const event=f.events.findLast(e=>e.event==='toolApproval');assert.ok(event);f.tools.resolve(event.id,approved);return promise;}

function browserFixture(t,Runtime=ToolRuntime){
 const f=fixture(t),sessions=new Map();let calls=0;
 const runtime=new Runtime(f.store,f.dir,{aside:{sessions,call:async()=>{calls++;return {snapshot:'Synthetic page'};},close:async()=>{}},emit:e=>f.events.push(e)});
 const c=runtime.connections.save({kind:'aside',name:'Synthetic browser',browserAccessApproved:true});
 sessions.set(c.id,{pages:new Map([['page',{url:'https://example.com',problemId:f.execution.problemId,snapshot:'e1 button Submit'}]])});
 return {...f,tools:runtime,c,calls:()=>calls};
}
test('opening and reading job pages runs without another permission prompt',async t=>{
 const f=browserFixture(t);
 for(const action of [{tool:'browser.open',arguments:{connection:f.c.id,url:'https://example.com'}},{tool:'browser.read',arguments:{connection:f.c.id,page:'page'}}]){
  const pending=f.tools.execute(action,f.execution);pending.catch(error=>{});await spin();
  if(f.tools.pending.size)f.controller.abort();
  assert.equal(f.events.some(e=>e.event==='toolApproval'),false);
  assert.equal((await pending).result.snapshot,'Synthetic page');
 }
 assert.equal(f.calls(),2);assert.ok(f.tools.snapshot().actions.every(a=>a.status==='completed'));
});
async function browserWriteReview(t,Runtime=ToolRuntime){
 for(const tool of ['browser.click','browser.fill','browser.press']){
  const f=browserFixture(t,Runtime),pending=f.tools.execute({tool,arguments:{connection:f.c.id,page:'page',selector:'e1',text:'Synthetic text',key:'Enter',readOnly:true}},f.execution);
  pending.catch(error=>{});await spin();
  try{assert.equal(f.calls(),0);assert.equal(f.events.filter(e=>e.event==='toolApproval').length,1);assert.match(f.events.find(e=>e.event==='toolApproval').preview,/e1 button Submit/);}
  finally{f.controller.abort();await pending.catch(error=>{});}
 }
}
test('browser controls still need review, even if model arguments claim read-only',t=>browserWriteReview(t));
test('failed and legacy uncertain page reads can retry, but explicit declines stay blocked',async t=>{
 const f=browserFixture(t),action={tool:'browser.read',arguments:{connection:f.c.id,page:'page'}};
 f.tools.aside.call=async()=>{throw new Error('Synthetic connection failure');};
 await assert.rejects(f.tools.execute(action,f.execution),/no extra approval/);
 assert.equal(f.tools.snapshot().actions[0].status,'failed');
 f.tools.aside.call=async()=>({snapshot:'Recovered'});
 await f.tools.execute(action,f.execution);
 f.store.db.prepare("UPDATE tool_actions SET status='uncertain'").run();
 await f.tools.execute(action,f.execution);
 f.store.db.prepare("UPDATE tool_actions SET status='declined'").run();
 await assert.rejects(f.tools.execute(action,f.execution),/Do not automatically retry/);
 assert.equal(f.events.some(e=>e.event==='toolApproval'),false);
});
test('runtime preserves exhausted recovery as an app error, not a login request',async t=>{
 const f=browserFixture(t);f.tools.aside.call=async(c,args,signal,{onRecovery})=>{onRecovery();const error=new Error('Synthetic private detail');error.code='BROWSER_RECOVERY_FAILED';throw error;};
 await assert.rejects(f.tools.execute({tool:'browser.read',arguments:{connection:f.c.id,page:'page'}},f.execution),error=>error.code==='BROWSER_RECOVERY_FAILED'&&!error.message.includes('Synthetic private detail'));
 assert.equal(f.tools.snapshot().actions[0].status,'failed');
 assert.ok(f.events.some(e=>e.message==='Reconnecting to the browser and reopening the page…'));
});
function autoFixture(t){
 const f=browserFixture(t),page=f.tools.aside.sessions.get(f.c.id).pages.get('page');
 page.snapshot='- link "Team overview" [ref=e1]\n- button "Submit" [ref=e10]';
 const action={tool:'browser.click',arguments:{connection:f.c.id,page:'page',selector:'e1'}};
 return {...f,page,action};
}
test('routine links, buttons and settings icons do not ask even with Auto mode off',async t=>{
 for(const snapshot of ['- link "Team overview" [ref=e1]','- button "Team" [ref=e1]','- generic "settings-icon" [ref=e1]','- menuitem "Overview" [ref=e1]']){
  const f=autoFixture(t);f.page.snapshot=snapshot;let sent;
  f.tools.aside.call=async(c,args)=>{sent=args;return {};};
  const run=f.tools.execute(f.action,{...f.execution,review:async()=>({decision:'navigation'})});run.catch(error=>{});
  await spin();const asked=f.tools.pending.size>0;if(asked)f.controller.abort();
  await run.catch(error=>{});assert.equal(asked,false,'routine navigation must not ask the user');
  assert.equal(sent.expectedSnapshot,snapshot);assert.equal(f.events.some(e=>e.event==='toolApproval'),false);
 }
});
test('Auto mode defaults off, is per job, persists and validates the setting',t=>{
 const f=autoFixture(t),id=f.execution.problemId;
 assert.equal(f.tools.autoMode(),false);
 for(const enabled of ['true',1,null])assert.throws(()=>f.tools.setAutoMode(id,enabled),/current job/);
 assert.throws(()=>f.tools.setAutoMode('other-job',true),/current job/);
 f.tools.setAutoMode(id,true);assert.equal(new ToolRuntime(f.store,f.dir).autoMode(),true);
 f.store.archive();f.store.create('Another synthetic job');assert.equal(f.tools.autoMode(),false);assert.equal(f.tools.autoMode(id),true);
});
test('Auto mode can carry out a reviewed scoped edit; Off still asks',async t=>{
 for(const enabled of [false,true]){
  const f=autoFixture(t);f.tools.setAutoMode(f.execution.problemId,enabled);f.page.snapshot='- button "Save note" [ref=e1]';
  const run=f.tools.execute(f.action,{...f.execution,review:async()=>({decision:'scoped'})});run.catch(error=>{});await spin();
  assert.equal(f.calls(),enabled?1:0);assert.equal(f.tools.pending.size,enabled?0:1);
  if(enabled)await run;else {f.controller.abort();await assert.rejects(run);}
 }
});
test('Auto mode blocks high-impact controls when the reviewer requires approval',async t=>{
 for(const label of ['Delete account','Buy now','Transfer money','Change password','Authorize access']){
  const f=autoFixture(t);f.tools.setAutoMode(f.execution.problemId,true);f.page.snapshot=`- button "${label}" [ref=e1]`;
  const run=f.tools.execute(f.action,{...f.execution,review:async()=>({decision:'review'})});run.catch(error=>{});await spin();
  assert.equal(f.calls(),0);assert.equal(f.tools.pending.size,0);await assert.rejects(run,e=>e.code==='AUTO_BLOCKED');
 }
});
test('website login asks before retrieval when Off, stays secret-free, and does not submit',async t=>{
 for(const enabled of [false,true]){
  const f=autoFixture(t);f.page.snapshot='- textbox "Password" [ref=e1]';f.tools.setAutoMode(f.execution.problemId,enabled);
  const login=f.tools.connections.save({kind:'login',name:'Synthetic login',url:'https://example.com',account:'Synthetic',secretRef:'op://test/item/password',usernameRef:'op://test/item/username'});
  let retrieved=0,filled=0;f.tools.credentials.resolve=async()=>{retrieved++;return 'synthetic-secret';};
  f.tools.aside.checkLogin=async()=>{};f.tools.aside.fillCredential=async(c,args,secret)=>{filled++;assert.equal(secret,'synthetic-secret');return {filled:args.field};};
  const run=f.tools.execute({tool:'browser.login',arguments:{...f.action.arguments,login:login.id,field:'password'}},f.execution);await spin();
  if(!enabled){assert.equal(retrieved,0);assert.equal(f.tools.pending.size,1);assert.equal(f.events.find(e=>e.event==='toolApproval').usesOnePassword,true);f.tools.resolve(f.events.find(e=>e.event==='toolApproval').id,true);}
  await run;assert.equal(retrieved,1);assert.equal(filled,1);
  assert.ok(!JSON.stringify(f.tools.snapshot()).includes('synthetic-secret'));assert.ok(!JSON.stringify(f.tools.catalog()).includes('op://'));
 }
});
test('a wrong-origin website login never reaches 1Password',async t=>{
 const f=autoFixture(t),login=f.tools.connections.save({kind:'login',name:'Synthetic login',url:'https://other.example',account:'Synthetic',secretRef:'op://test/item/password',usernameRef:'op://test/item/username'});
 f.tools.credentials.resolve=async()=>assert.fail('must not retrieve');
 await assert.rejects(f.tools.execute({tool:'browser.login',arguments:{...f.action.arguments,login:login.id,field:'password'}},f.execution),/origin/);
});
test('the real login adapter fills through a private file without serializing the secret into tool code',async t=>{
 const f=fixture(t),adapter=new AsideAdapter(),code=[],secret='synthetic-secret-marker';let filled;
 const element={tagName:'INPUT',name:'password',id:'password',ownerDocument:{location:{origin:'https://example.com',href:'https://example.com/login'}},form:{action:'https://example.com/session'},getAttribute:key=>key==='type'?'password':null};
 const page={url:()=> 'https://example.com/login',locator:()=>({evaluate:async fn=>fn(element),fill:async value=>{filled=value;}})};
 const session={pages:new Map([['page',{variable:'page',url:page.url(),problemId:f.execution.problemId}]])};
 session.client={callTool:async request=>{code.push(request.arguments.code);const lines=[];await vm.runInNewContext('(async()=>{'+request.arguments.code+'})()',{page,URL,console:{log:v=>lines.push(v)},fs:{readFile:async path=>readFileSync(path,'utf8')}});return {content:lines.map(text=>({type:'text',text}))};}};
 adapter.session=async()=>session;adapter.credentialDirectory=async()=>f.dir;
 const result=await adapter.fillCredential({id:'synthetic'}, {page:'page',selector:'e1',field:'password',origin:'https://example.com',problemId:f.execution.problemId},secret,f.controller.signal);
 assert.equal(filled,secret);assert.deepEqual(result,{page:'page',filled:'password',credentialUsed:true});
 assert.ok(code.every(script=>!script.includes(secret)));assert.ok(!JSON.stringify(result).includes(secret));
});
test('public search is a bounded read-only tool and does not need account approval',async t=>{
 const f=fixture(t,{publicSearch:async query=>({reply:'Synthetic public result: '+query})});
 const result=await f.tools.execute({tool:'public.search',arguments:{query:'synthetic topic'}},f.execution);
 assert.match(result.result.reply,/synthetic topic/);assert.equal(f.tools.pending.size,0);
 for(const query of ['',null,'x'.repeat(1001)])assert.throws(()=>f.tools.validate({tool:'public.search',arguments:{query}}));
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs',"typeof args.query!=='string'||!args.query.trim()||args.query.length>1000",'false');
 assert.throws(()=>assert.throws(()=>new Broken(f.store,f.dir).validate({tool:'public.search',arguments:{query:''}})));
});
test('Auto mode off during password-manager unlock cancels the fill',async t=>{
 const f=autoFixture(t);f.tools.setAutoMode(f.execution.problemId,true);
 const login=f.tools.connections.save({kind:'login',name:'Synthetic login',url:'https://example.com',account:'Synthetic',secretRef:'op://test/item/password',usernameRef:'op://test/item/username'});
 f.tools.aside.checkLogin=async()=>{};f.tools.aside.fillCredential=async()=>assert.fail('must not fill');
 f.tools.credentials.resolve=async()=>{f.tools.setAutoMode(f.execution.problemId,false);return 'synthetic-secret';};
 await assert.rejects(f.tools.execute({tool:'browser.login',arguments:{...f.action.arguments,login:login.id,field:'password'}},f.execution),/Auto mode changed/);
});
test('mutation proof: Auto candidates require exact references, supported tools/keys, with labels left to review',()=>{
 const base={name:'browser.click',args:{selector:'e1'},snapshot:'- button "Save note" [ref=e1]'};
 const gate=fn=>{assert.ok(fn(base));for(const spec of [{...base,name:'api.request'},{...base,args:{selector:'button'},snapshot:'- button "Save note" [ref=button]'},{...base,snapshot:'- button "Save note" [ref=e10]'},{...base,name:'browser.press',args:{selector:'e1',key:'Meta+A'}}])assert.equal(fn(spec),null);};
 gate(automaticTarget);const source=automaticTarget.toString();
 for(const [before,after] of [["!['browser.click','browser.fill','browser.press'].includes(spec.name)",'false'],["if(!/^e\\d+$/u.test(selector||''))return null;",''],["spec.name==='browser.press'&&!['Enter','Tab','Escape','ArrowDown','ArrowUp'].includes(spec.args.key)",'false']]){
  assert.ok(source.includes(before));const broken=Function('return ('+source.replace(before,after)+')')();assert.throws(()=>gate(broken));
 }
 assert.ok(automaticTarget({...base,snapshot:'- button "Delete account" [ref=e1]'}),'labels go to review');
 assert.equal(scopedDecision({decision:'scoped',extra:true}),false);
});
test('Auto mode dispatches only independently reviewed navigation and binds the snapshot',async t=>{
 const f=autoFixture(t);f.tools.setAutoMode(f.execution.problemId,true);let sent;
 f.tools.aside.call=async(c,args)=>{sent=args;return {};};
 await f.tools.execute(f.action,{...f.execution,review:async details=>{assert.equal(details.target.label,'Team overview');return {decision:'navigation'};}});
 assert.equal(sent.expectedSnapshot,f.page.snapshot);assert.equal(f.events.some(e=>e.event==='toolApproval'),false);
});
test('a pending navigation can continue when Auto mode is enabled',async t=>{
 const f=autoFixture(t);let checks=0;const pending=f.tools.execute(f.action,{...f.execution,review:async()=>({decision:++checks===1?'review':'navigation'})});
 await spin();assert.equal(f.calls(),0);assert.equal(f.tools.pending.size,1);
 f.tools.setAutoMode(f.execution.problemId,true);await pending;assert.equal(f.calls(),1);assert.equal(f.tools.pending.size,0);
});
test('unclear results ask with Auto off and are blocked with Auto on',async t=>{
 for(const enabled of [false,true])for(const response of [null,{},true,{decision:'navigation',action:{}},{decision:'review'},new Error('Synthetic unavailable')]){
  const f=autoFixture(t);f.tools.setAutoMode(f.execution.problemId,enabled);
  const run=f.tools.execute(f.action,{...f.execution,review:async()=>{if(response instanceof Error)throw response;return response;}});
  run.catch(error=>{});await spin();assert.equal(f.calls(),0);assert.equal(f.tools.pending.size,enabled?0:1);if(!enabled)f.controller.abort();await assert.rejects(run);
 }
});
async function autoRecheck(t,Runtime=ToolRuntime){
 for(const change of ['disabled','page','job']){
  const f=autoFixture(t);Object.setPrototypeOf(f.tools,Runtime.prototype);f.tools.setAutoMode(f.execution.problemId,true);
  let finish;const run=f.tools.execute(f.action,{...f.execution,review:()=>new Promise(resolve=>{finish=resolve;})});run.catch(error=>{});await spin();
  if(change==='disabled')f.tools.setAutoMode(f.execution.problemId,false);
  if(change==='page')f.page.snapshot='- link "Different action" [ref=e1]';
  if(change==='job')f.store.advance();
  finish({decision:'navigation'});await spin();assert.equal(f.calls(),0,'changed authorization or context must prevent dispatch');
  f.controller.abort();await assert.rejects(run);
 }
}
test('turning Auto mode off or changing the job/page during review prevents dispatch',autoRecheck);
test('an explicit No wins over an in-flight automatic check',async t=>{
 const f=autoFixture(t);let finish,checks=0;const run=f.tools.execute(f.action,{...f.execution,review:()=>++checks===1?Promise.resolve({decision:'review'}):new Promise(resolve=>{finish=resolve;})});run.catch(error=>{});await spin();
 f.tools.setAutoMode(f.execution.problemId,true);await spin();f.tools.resolve(f.events.find(e=>e.event==='toolApproval').id,false,'Stop that action.');
 finish({decision:'navigation'});await assert.rejects(run);await spin();assert.equal(f.calls(),0);
});
function riskyTargets(target=navigationTarget){
 const spec={name:'browser.click',args:{selector:'e1'},snapshot:'- link "Team overview" [ref=e1]'};
 assert.equal(target(spec).label,'Team overview');
 for(const role of ['link','button','generic','menuitem'])for(const label of ['Delete account','Send message','Buy now','Submit order','Trade player','Authorize access','Save settings','Enable sharing','Disable protection','Reset account','Upload file','Share report','Invite member','Download file','Unlock vault','Login','Sign-in','Sign out'])assert.equal(target({...spec,snapshot:`- ${role} "${label}" [ref=e1]`})?.label,label);
 for(const name of ['browser.fill','browser.press','api.request','mcp.call'])assert.equal(target({...spec,name}),null);
 for(const snapshot of ['- checkbox "Team" [ref=e1]','- link "Team" [ref=e10]','- switch "Team" [ref=e1]'])assert.equal(target({...spec,snapshot}),null);
}
test('exact candidate controls reach the reviewer regardless of wording',()=>riskyTargets());
test('consequential controls classified for review cannot dispatch without approval',async t=>{
 for(const enabled of [false,true])for(const label of ['Save settings','Send message','Delete account','Login','Enable sharing']){
  const f=autoFixture(t);f.page.snapshot=`- button "${label}" [ref=e1]`;f.tools.setAutoMode(f.execution.problemId,enabled);let reviews=0;
  const run=f.tools.execute(f.action,{...f.execution,review:async()=>{reviews++;return {decision:'review'};}});run.catch(error=>{});
  await spin();assert.equal(reviews,1);assert.equal(f.calls(),0);assert.equal(f.tools.pending.size,enabled?0:1);
  if(!enabled)f.controller.abort();await assert.rejects(run);
 }
});
test('mutation proof: unsupported tool types cannot qualify for navigation',async t=>{
 const {navigationTarget:broken}=await mutated(t,'auto.mjs',"if(!['browser.click','browser.fill','browser.press','browser.select','browser.hover','browser.scroll'].includes(spec.name))return null;",'');
 assert.throws(()=>riskyTargets(broken));
});
test('mutation proof: Auto mode rechecks the saved setting after the AI returns',async t=>{
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs','const allowed=this.autoMode(problemId)===modeAtStart&&current.snapshot===spec.snapshot','const allowed=current.snapshot===spec.snapshot');
 await assert.rejects(autoRecheck(t,Broken));
});
test('mutation proof: changed page context invalidates automatic approval',async t=>{
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs','current.snapshot===spec.snapshot&&','');await assert.rejects(autoRecheck(t,Broken));
});
test('mutation proof: Auto mode rejects stale-job settings and malformed decisions',async t=>{
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs',"if(problemId!==this.store.requireActive().id || typeof enabled!=='boolean')",'if(false)');
 const f=browserFixture(t,Broken);assert.throws(()=>assert.throws(()=>f.tools.setAutoMode('other-job',true)));assert.throws(()=>assert.throws(()=>f.tools.setAutoMode(f.execution.problemId,'true')));
 assert.equal(navigationDecision({decision:'navigation',action:{}}),false);
 const {navigationDecision:broken}=await mutated(t,'auto.mjs','Object.keys(result).length===1&&','');assert.throws(()=>assert.equal(broken({decision:'navigation',action:{}}),false));
});

test('connections reject credential URLs and require explicit Aside setup',()=>{
 for(const value of ['http://api.example.com','https://name:secret@api.example.com','file:///tmp/source','https://api.example.com/#secret'])assert.throws(()=>serviceURL(value),/HTTPS/);
 assert.equal(serviceURL('http://127.0.0.1:3210/mcp',{local:true}).hostname,'127.0.0.1');
 assert.throws(()=>serviceURL('http://other.example.com',{local:true}),/HTTPS/);
 assert.throws(()=>cleanConnection({...apiConfig,kind:'unknown'}),/Choose/);
 assert.throws(()=>cleanConnection({...apiConfig,url:'https://api.example.com/?key=synthetic'}),/query parameters/);
 assert.throws(()=>cleanConnection({...apiConfig,secretRef:'SYNTHETIC_RAW_SECRET'}),/Never paste/);
 assert.throws(()=>cleanConnection({...apiConfig,account:''}),/Never paste/);
 assert.throws(()=>cleanConnection({kind:'aside',name:'Aside'}),/browser access/);
 for(const value of [false,'true',1])assert.throws(()=>cleanConnection({kind:'aside',name:'Aside',browserAccessApproved:value}),/browser access/);
 assert.throws(()=>cleanConnection({kind:'aside',name:'Aside',localBrowserOnly:true}),/browser access/);
 const browser=cleanConnection({kind:'aside',name:'Aside',browserAccessApproved:true});
 assert.equal(browser.browserAccessApproved,true);assert.equal(Object.hasOwn(browser,'localBrowserOnly'),false);
 assert.throws(()=>cleanConnection({kind:'aside',name:'Aside',browserAccessApproved:true,account:'unexpected'}),/account ID/);
});
test('relative API requests cannot switch hosts or smuggle credentials',()=>{
 for(const path of ['//other.example.com','/\\other.example.com','https://other.example.com','/ok\nHeader: bad','/ok#secret'])assert.throws(()=>relativeURL(apiConfig.url,path));
 assert.equal(relativeURL(apiConfig.url,'/v1/items?limit=3').origin,new URL(apiConfig.url).origin);
});
test('an external request waits for approval; the secret goes only into execution',async t=>{
 const secret='SYNTHETIC_PRIVATE_CREDENTIAL';let calls=0,resolves=0;
 const f=fixture(t,{credentials:{resolve:async()=>{resolves++;return secret;}},api:async(c,args,key)=>{calls++;assert.equal(key,secret);return {ok:true,echo:key,token:key};}});
 const c=f.tools.connections.save(apiConfig);const action={tool:'api.request',arguments:{connection:c.id,path:'/items',method:'GET'}};
 const pending=f.tools.execute(action,f.execution);await spin();assert.equal(calls,0);assert.equal(resolves,0);
 assert.equal(f.events.find(event=>event.event==='toolApproval').usesOnePassword,true);
 assert.ok(!JSON.stringify(f.tools.catalog()).includes(apiConfig.secretRef));assert.ok(!JSON.stringify(f.events).includes(secret));
 const result=await approve(f,pending);assert.equal(calls,1);assert.equal(result.result.echo,'[redacted]');assert.ok(!JSON.stringify(result).includes(secret));
 assert.throws(()=>f.tools.resolve(result.action,true),/expired/);
});
test('API credential calls require fresh review with Auto off and are blocked with Auto on',async t=>{
 for(const enabled of [false,true]){
  let resolves=0;
  const f=fixture(t,{credentials:{resolve:async()=>{resolves++;return 'SYNTHETIC_SECRET';}},api:async()=>({ok:true})});
  f.tools.setAutoMode(f.execution.problemId,enabled);
  const connection=f.tools.connections.save(apiConfig);
  for(let i=0;i<2;i++){
   const pending=f.tools.execute({tool:'api.request',arguments:{connection:connection.id,path:'/items',method:'GET'}},f.execution);
   if(enabled){await assert.rejects(pending);assert.equal(resolves,0);assert.equal(f.events.some(e=>e.event==='toolApproval'),false);continue;}
   await spin();assert.equal(resolves,i,'credentials must wait for each approval');
   const approvals=f.events.filter(event=>event.event==='toolApproval');assert.equal(approvals.length,i+1);
   assert.equal(approvals.at(-1).usesOnePassword,true);
   assert.ok(!JSON.stringify(approvals).includes(apiConfig.secretRef));
   f.tools.resolve(approvals.at(-1).id,true);await pending;assert.equal(resolves,i+1);
  }
 }
});
test('declined actions never resolve credentials and cannot be retried within the run',async t=>{
 let calls=0;const f=fixture(t,{credentials:{resolve:async()=>{calls++;return '';}}});const c=f.tools.connections.save(apiConfig);
 const action={tool:'api.request',arguments:{connection:c.id,path:'/items',method:'POST'}};
 const pending=f.tools.execute(action,f.execution);await assert.rejects(approve(f,pending,false),/declined/);assert.equal(calls,0);
 await assert.rejects(f.tools.execute(action,f.execution),/Do not automatically retry/);
});
test('stopping or changing the brief while approval is open prevents dispatch',async t=>{
 for(const stale of [false,true]) {
  let calls=0;const f=fixture(t,{api:async()=>{calls++;},credentials:{resolve:async()=>''}});const c=f.tools.connections.save(apiConfig);
  const pending=f.tools.execute({tool:'api.request',arguments:{connection:c.id,path:'/items'}},f.execution);
  await spin();const event=f.events.find(e=>e.event==='toolApproval');
  if(stale){f.store.advance();f.tools.resolve(event.id,true);}else{f.controller.abort();}
  await assert.rejects(pending);assert.equal(calls,0);assert.throws(()=>f.tools.resolve(event.id,true),/expired/);
 }
});
test('approval is bound to a cloned request and a write failure is not retried',async t=>{
 let sent;const f=fixture(t,{credentials:{resolve:async()=>''},api:async(c,args)=>{sent=args;throw new Error('SYNTHETIC_SERVER_SECRET');}});const c=f.tools.connections.save(apiConfig);
 const action={tool:'api.request',arguments:{connection:c.id,path:'/items',method:'POST',body:{title:'Approved'}}};const pending=f.tools.execute(action,f.execution);action.arguments.body.title='Changed after proposal';
 await assert.rejects(approve(f,pending),/Check the service/);assert.equal(sent.body.title,'Approved');assert.ok(!JSON.stringify(f.events).includes('SYNTHETIC_SERVER_SECRET'));
 await assert.rejects(f.tools.execute({tool:'api.request',arguments:sent},f.execution),/Do not automatically retry/);
});
test('local documents cannot escape their artifact directory and need no network approval',async t=>{
 const f=fixture(t);
 for(const name of ['../outside.md','/tmp/out.txt','x/thing.md','.hidden.md','x.command'])assert.throws(()=>f.tools.validate({tool:'document.save',arguments:{name,text:'Synthetic'}}));
 const r=await f.tools.execute({tool:'document.save',arguments:{name:'plan.md',text:'Synthetic plan'}},f.execution);
 assert.equal(readFileSync(f.tools.artifacts.get(r.result.artifact),'utf8'),'Synthetic plan');assert.ok(!f.events.some(e=>e.event==='toolApproval'));
 assert.ok(!JSON.stringify(r).includes(f.dir));
});
test('tool catalog and browser page ownership are enforced',t=>{
 const f=fixture(t);for(const action of [null,{tool:'shell',arguments:{}},{tool:'memory.search',arguments:[]},{tool:'memory.search',arguments:{query:''}}])assert.throws(()=>f.tools.validate(action));
 const c=f.tools.connections.save({kind:'aside',name:'Test browser',browserAccessApproved:true});
 f.tools.aside.sessions.set(c.id,{pages:new Map([['foreign',{url:'https://example.com',problemId:'another-job'}]]),client:{close:async()=>{}}});
 assert.throws(()=>f.tools.validate({tool:'browser.read',arguments:{connection:c.id,page:'foreign'}}),/not owned/);
 assert.throws(()=>f.tools.validate({tool:'api.request',arguments:{connection:c.id,path:'/items'}}),/API connection/);
 const m=f.tools.connections.save({kind:'mcp',name:'Local MCP',url:'http://127.0.0.1:3210/mcp'});
 assert.throws(()=>f.tools.validate({tool:'mcp.call',arguments:{connection:m.id,tool:'undiscovered'}}),/Discover/);
});
test('1Password SDK resolves only the configured reference, and errors reveal no secrets',async()=>{
 let observed;const credentials=new Credentials(async account=>({secrets:{resolve:async ref=>{observed={account,ref};return 'SYNTHETIC_VALUE';}}}));
 assert.equal(await credentials.resolve(apiConfig),'SYNTHETIC_VALUE');assert.deepEqual(observed,{account:apiConfig.account,ref:apiConfig.secretRef});
 const failing=new Credentials(async()=>{throw new Error('SYNTHETIC_VALUE');});await assert.rejects(failing.resolve(apiConfig),e=>e.name==='CredentialUnavailable'&&!e.message.includes('SYNTHETIC_VALUE'));
 assert.deepEqual(redact({authorization:'secret',nested:['private']},['private']),{authorization:'[redacted]',nested:['[redacted]']});
});
test('API credentials are injected into the pinned service; redirects never follow',async()=>{
 let request;const result=await apiRequest(apiConfig,{path:'/items',method:'POST',body:{title:'Synthetic'}},'SYNTHETIC_KEY',new AbortController().signal,async(url,options)=>{request={url,options};return new Response('{"ok":true}',{status:200});});
 assert.equal(request.url.origin,'https://api.example.com');assert.equal(request.options.headers.Authorization,'Bearer SYNTHETIC_KEY');assert.equal(request.options.redirect,'manual');assert.equal(result.ok,true);
 await assert.rejects(apiRequest(apiConfig,{path:'/items'},'SYNTHETIC_KEY',new AbortController().signal,async()=>new Response('',{status:302,headers:{Location:'https://other.example.com'}})),/redirect blocked/);
 await assert.rejects(responseText(new Response('x'.repeat(21)),20),/too large/);
});
test('the frontier work loop searches memory, saves a document, then uses the real results',async t=>{
 const f=fixture(t);f.store.add('source','Synthetic useful context');let calls=0;
 const service=new ProblemService(f.store,{chatgpt:{answer:async context=>{calls++;if(calls===1)return {action:{tool:'memory.search',arguments:{query:'useful'}}};if(calls===2){assert.ok(context.toolResults[0].result.includes('Synthetic useful context'));return {action:{tool:'document.save',arguments:{name:'next-step.md',text:'Synthetic next step'}}};}assert.ok(context.toolResults[1].result.includes('"saved":true'));return {reply:'Saved the next step.',memories:[]};}}},{tools:f.tools});
 const result=await service.send('Help with the synthetic job');assert.equal(calls,3);assert.equal(result.entries.at(-1).text,'Saved the next step.');assert.equal(result.actions.filter(a=>a.status==='completed').length,2);
});
test('long work loops keep every tool behind onejob without a twelve-step permission prompt',async t=>{
 const f=fixture(t);let calls=0;const service=new ProblemService(f.store,{chatgpt:{answer:async()=>{calls++;return calls<=14?{action:{tool:'memory.search',arguments:{query:'Synthetic'}}}:{reply:'Synthetic completed lookup.',memories:[]};}}},{tools:f.tools});
 const result=await service.send('Keep working');assert.equal(calls,15);assert.equal(result.actions.length,14);assert.equal(result.entries.at(-1).text,'Synthetic completed lookup.');
});

async function mutated(t,file,before,after) {
 const dir=mkdtempSync(join(tmpdir(),'onejob-tool-mutation-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const original=new URL('../server/focus/tools/'+file,import.meta.url);let source=readFileSync(original,'utf8');assert.ok(source.includes(before));source=source.replace(before,after);
 source=source.replace(/from '(\.[^']+)'/g,(_,relative)=>`from '${new URL(relative,original).href}'`);
 source=source.replace(/from '@modelcontextprotocol\/sdk\/([^']+)'/g,(_,relative)=>`from '${new URL('../server/focus/node_modules/@modelcontextprotocol/sdk/dist/esm/'+relative,import.meta.url).href}'`);
 const path=join(dir,file);writeFileSync(path,source);return import(pathToFileURL(path));
}
for(const guard of ["if(typeof feedback!=='string'||feedback.length>2000)","if(approved===true&&feedback)"])test('mutation proof: permission feedback validation '+guard,async t=>{
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs',guard,'if(false)');await assert.rejects(feedbackGuard(t,Broken));
});
test('mutation proof: removing URL and path guards breaks their negative cases',async t=>{
 const {serviceURL:broken}=await mutated(t,'connections.mjs',"if ((url.protocol!=='https:' && !(local && loopback && url.protocol==='http:')) || url.username || url.password || url.hash)",'if (false)');
 assert.throws(()=>assert.throws(()=>broken('https://name:secret@api.example.com')));
 const {relativeURL:escaped}=await mutated(t,'connections.mjs',"if (typeof path!=='string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\\\') || /[\\r\\n]/u.test(path))",'if (false)');
 assert.throws(()=>assert.throws(()=>escaped(apiConfig.url,'https://api.example.com/items')));
});
test('mutation proof: removing approval executes without consent',async t=>{
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs','if(needsApproval && !await autoCheck()) {','if(false) {');let calls=0;const f=fixture(t);
 const broken=new Broken(f.store,f.dir,{credentials:{resolve:async()=>''},api:async()=>{calls++;return {};}});const c=broken.connections.save(apiConfig);
 await broken.execute({tool:'api.request',arguments:{connection:c.id,path:'/items'}},f.execution);
 assert.throws(()=>assert.equal(calls,0));
});
test('mutation proof: treating all browser controls as reads bypasses required review',async t=>{
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs',"readOnly:['browser.read','browser.view','browser.scroll'].includes(name)",'readOnly:true');
 await assert.rejects(browserWriteReview(t,Broken));
});
test('mutation proof: removing secret redaction leaks the canary',async t=>{
 const {redact:broken}=await mutated(t,'credentials.mjs',"result.split(secret).join('[redacted]')",'result');
 assert.throws(()=>assert.ok(!JSON.stringify(broken({echo:'SYNTHETIC_CREDENTIAL'},['SYNTHETIC_CREDENTIAL'])).includes('SYNTHETIC_CREDENTIAL')));
});
test('mutation proof: retired page and artifact path guards are exercised',async t=>{
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs',"if(!page || page.problemId!==this.store.requireActive().id)",'if(!page)');const f=fixture(t);const broken=new Broken(f.store,f.dir);const c=broken.connections.save({kind:'aside',name:'Test',browserAccessApproved:true});broken.aside.sessions.set(c.id,{pages:new Map([['foreign',{url:'https://example.com',problemId:'other'}]]),client:{close:async()=>{}}});
 assert.throws(()=>assert.throws(()=>broken.validate({tool:'browser.read',arguments:{connection:c.id,page:'foreign'}})));
 const {ToolRuntime:Paths}=await mutated(t,'runtime.mjs',"if(typeof args.name!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,99}\\.(md|txt)$/u.test(args.name)||args.name.includes('..')||typeof args.text!=='string')",'if(false)');
 assert.throws(()=>assert.throws(()=>new Paths(f.store,f.dir).validate({tool:'document.save',arguments:{name:'../outside.md',text:'Synthetic'}})));
});

test('mutation proof: removing the retry gate permits an uncertain write again',async t=>{
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs',"if(prior)throw new Error('Do not automatically retry a declined, blocked or uncertain action. Inspect with read-only tools; otherwise leave this step blocked.');",'');
 const f=fixture(t);let proposals=0;const broken=new Broken(f.store,f.dir,{credentials:{resolve:async()=>''},api:async()=>{throw new Error('Synthetic failure');},emit:e=>{if(e.event==='toolApproval'){proposals++;queueMicrotask(()=>broken.resolve(e.id,true));}}});const c=broken.connections.save(apiConfig),action={tool:'api.request',arguments:{connection:c.id,path:'/items',method:'POST'}};
 await assert.rejects(broken.execute(action,f.execution));await assert.rejects(broken.execute(action,f.execution));assert.throws(()=>assert.equal(proposals,1));
});
test('mutation proof: removing the post-approval state check dispatches stale work',async t=>{
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs',"signal.throwIfAborted();assertCurrent();this.update(id,'running'", "this.update(id,'running'");
 const f=fixture(t);let calls=0;const connection={kind:'aside',name:'Synthetic browser',browserAccessApproved:true};let stale=false;
 const sessions=new Map();const broken=new Broken(f.store,f.dir,{aside:{sessions,call:async()=>{calls++;return {};},close:async()=>{}},emit:e=>{if(e.event==='toolApproval')queueMicrotask(()=>{stale=true;broken.resolve(e.id,true);});}});const c=broken.connections.save(connection);
 sessions.set(c.id,{pages:new Map([['page',{url:'https://example.com',problemId:f.execution.problemId}]])});
 await assert.rejects(broken.execute({tool:'browser.click',arguments:{connection:c.id,page:'page',selector:'e1'}},{...f.execution,assertCurrent:()=>{if(stale)throw new Error('Synthetic changed state');}}));assert.throws(()=>assert.equal(calls,0));
});
test('mutation proof: removing the credential-reference guard accepts a raw secret',async t=>{
 const {cleanConnection:broken}=await mutated(t,'connections.mjs',"if (secretRef && (!/^op:\\/\\/[^/?#\\s]+\\/[^/?#\\s]+\\/[^?#\\s]+$/u.test(secretRef) || !account))",'if (false)');
 assert.throws(()=>assert.throws(()=>broken({...apiConfig,secretRef:'SYNTHETIC_RAW_SECRET'})));
});

async function browserScenario(Implementation=AsideAdapter){
 const calls=[],lines=[];let url='';const page={url:()=>url,locator:selector=>({click:async()=>calls.push({selector}),fill:async text=>calls.push({selector,text}),press:async key=>calls.push({selector,key})})};
 const context=vm.createContext({openTab:async address=>{url=address;return page;},snapshot:async()=>({tree:'e3 textbox Title\ne4 button Save'}),console:{log:value=>lines.push(value)}});
 const session={pages:new Map(),client:{callTool:async request=>{lines.length=0;await vm.runInContext('(async()=>{'+request.arguments.code.replace(/\bvar\s+(oj_\w+)/gu,'$1')+'})()',context);return {content:[{type:'text',text:lines.join('\n')}]};}}};
 const adapter=new Implementation('synthetic-aside');adapter.session=async()=>session;
 const c={id:'synthetic-browser'},signal=new AbortController().signal;
 adapter.sessions.set(c.id,session);
 const opened=await adapter.call(c,{operation:'open',url:'https://example.com',problemId:'job-a'},signal);assert.match(opened.snapshot,/textbox/);
 await assert.rejects(adapter.call(c,{operation:'click',page:opened.page,selector:'e4',problemId:'job-a',expectedSnapshot:'Different page content'},signal),/page changed during automatic review/);
 assert.equal(calls.length,0,'automatic clicks must check the live snapshot first');
 const text="'); fetch('https://other.example.com'); //";
 await adapter.call(c,{operation:'fill',page:opened.page,selector:'e3',text,problemId:'job-a'},signal);assert.equal(calls[0].text,text,'text must stay a literal, never execute as code');
 await assert.rejects(adapter.call(c,{operation:'read',page:opened.page,problemId:'job-b'},signal),/Existing personal tabs/);
 url='https://other.example.com';await assert.rejects(adapter.call(c,{operation:'click',page:opened.page,selector:'e4',problemId:'job-a'},signal),/page changed/);
 assert.equal(calls.length,1,'changed page must not receive the approved click');
 const navigatedURL=new URL(url).href,refreshed=await adapter.call(c,{operation:'read',page:opened.page,problemId:'job-a'},signal);
 assert.equal(refreshed.url,navigatedURL,'a read must follow navigation instead of demanding user inspection');
 assert.equal(refreshed.page,opened.page,'normal navigation should not trigger a replacement tab');
 assert.equal(session.pages.get(opened.page).url,navigatedURL);
}
test('Aside templates keep text inert and bind actions to the reviewed page',()=>browserScenario());
test('mutation proof: automatic clicks reject changed live page content',async t=>{
 const {AsideAdapter:Broken}=await mutated(t,'adapters.mjs',"if(${JSON.stringify(args.expectedSnapshot!==saved.snapshot&&args.expectedSnapshot!==saved.snapshotText)}||view!==${saved.cacheVariable?saved.cacheVariable+'.text':JSON.stringify(args.expectedSnapshot)})throw new Error('The page changed during automatic review.');",'');
 await assert.rejects(browserScenario(Broken));
});
test('mutation proof: treating reads like reviewed writes loses the navigated page',async t=>{
 const {AsideAdapter:Broken}=await mutated(t,'adapters.mjs',"const review=args.operation==='read'?'':",'const review=');
 await assert.rejects(browserScenario(Broken));
});
test('mutation proof: removing the reviewed-page check allows the wrong page to be clicked',async t=>{
 const {AsideAdapter:Broken}=await mutated(t,'adapters.mjs',"if(${variable}.url()!==${JSON.stringify(saved.url)})throw new Error('The page changed after review. Open a new task tab before continuing.');",'');
 await assert.rejects(browserScenario(Broken),/Missing expected rejection/);
});

function recoveryBrowser(Implementation=AsideAdapter){
 const adapter=new Implementation('synthetic-aside'),c={id:'synthetic-browser'},controller=new AbortController();
 const state={connections:0,opens:0,clicks:0,closes:0,fail:false};
 adapter.session=async()=>{
  if(adapter.sessions.has(c.id))return adapter.sessions.get(c.id);
  state.connections++;const lines=[];
  const context=vm.createContext({console:{log:line=>lines.push(line)},openTab:async url=>{state.opens++;return {url:()=>url,locator:()=>({click:async()=>{state.clicks++;throw new Error('Synthetic click uncertainty');}})};},snapshot:async()=>{if(state.fail)throw new Error('Synthetic disconnected snapshot');return {tree:'Synthetic page'};}});
  const session={pages:new Map(),client:{close:async()=>{state.closes++;},callTool:async request=>{
   lines.length=0;try{await vm.runInContext('(async()=>{'+request.arguments.code.replace(/\bvar\s+(oj_\w+)/gu,'$1')+'})()',context);return {content:[{type:'text',text:lines.join('\n')}]};}
   catch(error){return {isError:true,content:[{type:'text',text:'SYNTHETIC_INTERNAL_ERROR'}]};}
  }}};
  adapter.sessions.set(c.id,session);return session;
 };
 return {adapter,c,controller,state};
}
test('a lost browser handle reconnects once and returns a fresh job-owned page',async()=>{
 const f=recoveryBrowser(),args={operation:'open',url:'https://example.com',problemId:'job-a'};
 const first=await f.adapter.call(f.c,args,f.controller.signal);f.state.fail=true;let recovering=0;
 const next=await f.adapter.call(f.c,{operation:'read',page:first.page,problemId:'job-a'},f.controller.signal,{onRecovery:()=>{recovering++;f.state.fail=false;}});
 assert.equal(recovering,1);assert.equal(f.state.connections,2);assert.equal(f.state.closes,1);assert.notEqual(next.page,first.page);
 assert.equal(next.snapshot,'Synthetic page');assert.equal(f.adapter.sessions.get(f.c.id).pages.get(next.page).problemId,'job-a');
});
test('persistent read failure stops after one recovery and does not expose internal errors',async()=>{
 const f=recoveryBrowser();f.state.fail=true;
 await assert.rejects(f.adapter.call(f.c,{operation:'open',url:'https://example.com',problemId:'job-a'},f.controller.signal),error=>error.code==='BROWSER_RECOVERY_FAILED'&&!error.message.includes('SYNTHETIC_INTERNAL_ERROR'));
 assert.equal(f.state.opens,2);assert.equal(f.state.connections,2);
});
async function noWriteRecovery(Implementation=AsideAdapter){
 const f=recoveryBrowser(Implementation),opened=await f.adapter.call(f.c,{operation:'open',url:'https://example.com',problemId:'job-a'},f.controller.signal);
 await assert.rejects(f.adapter.call(f.c,{operation:'click',page:opened.page,problemId:'job-a',selector:'e1'},f.controller.signal));
 assert.equal(f.state.clicks,1);assert.equal(f.state.opens,1);assert.equal(f.state.connections,1);
}
test('an uncertain click is never replayed or disguised as a recovered read',()=>noWriteRecovery());
test('mutation proof: allowing write recovery breaks the no-replay boundary',async t=>{
 const {AsideAdapter:Broken}=await mutated(t,'adapters.mjs',"if(!['open','read'].includes(args.operation))return this.perform(connection,args,signal);",'');
 await assert.rejects(noWriteRecovery(Broken));
});
async function recoveryCurrent(Implementation=AsideAdapter){
 for(const stop of [true,false]){
  const f=recoveryBrowser(Implementation);let attempts=0,stale=false;
  f.adapter.perform=async()=>{attempts++;if(attempts===1)throw new Error('Synthetic failure');return {};};
  f.adapter.sessions.set(f.c.id,{pages:new Map(),client:{close:async()=>{if(stop)f.controller.abort();else stale=true;}}});
  await assert.rejects(f.adapter.call(f.c,{operation:'open',url:'https://example.com',problemId:'job-a'},f.controller.signal,{assertCurrent:()=>{if(stale)throw new Error('Synthetic changed job');}}));
  assert.equal(attempts,1);
 }
}
test('stop and changed job prevent recovery from opening another tab',()=>recoveryCurrent());
test('mutation proof: the post-disconnect state check prevents stale recovery',async t=>{
 const {AsideAdapter:Broken}=await mutated(t,'adapters.mjs',"signal.throwIfAborted();assertCurrent();\n      try {return await this.perform",'try {return await this.perform');
 await assert.rejects(recoveryCurrent(Broken));
});
async function recoveryOwnership(Implementation=AsideAdapter){
 const f=recoveryBrowser(Implementation);let attempts=0;
 f.adapter.sessions.set(f.c.id,{pages:new Map([['foreign',{url:'https://example.com',problemId:'job-b'}]])});
 f.adapter.perform=async()=>{attempts++;return {};};
 await assert.rejects(f.adapter.call(f.c,{operation:'read',page:'foreign',problemId:'job-a'},f.controller.signal),/Existing personal tabs/);
 assert.equal(attempts,0);
}
test('recovery cannot reopen another job’s page',()=>recoveryOwnership());
test('mutation proof: recovery ownership is checked before dispatch',async t=>{
 const {AsideAdapter:Broken}=await mutated(t,'adapters.mjs',"if(!saved || saved.problemId!==args.problemId)",'if(!saved)');
 await assert.rejects(recoveryOwnership(Broken));
});

test('mutation proofs cover connection setup and request validation',async t=>{
 const cases=[
  ["if (!['api','mcp','aside','login'].includes(kind))",{...apiConfig,kind:'unknown'}],
  ["if(url && new URL(url).search)",{...apiConfig,url:'https://api.example.com/?key=synthetic'}],
  ["if (kind==='aside' && input.browserAccessApproved!==true)",{kind:'aside',name:'Synthetic'}],
  ["if (kind==='aside' && account && !/^u?\\d+$/u.test(account))",{kind:'aside',name:'Synthetic',browserAccessApproved:true,account:'wrong'}]
 ];
 for(const [guard,input]of cases){const {cleanConnection:broken}=await mutated(t,'connections.mjs',guard,'if(false)');assert.throws(()=>assert.throws(()=>broken(input)));}
 const f=fixture(t),c=f.tools.connections.save(apiConfig),m=f.tools.connections.save({kind:'mcp',name:'Synthetic',url:'https://mcp.example.com'});
 const guards=[
  ["if(!action || !toolCatalog.some(t=>t.name===action.tool) || !action.arguments || typeof action.arguments!=='object' || Array.isArray(action.arguments))",{tool:'unknown',arguments:{connection:c.id}}],
  ["if(!['GET','POST','PUT','PATCH','DELETE'].includes(args.method))",{tool:'api.request',arguments:{connection:c.id,path:'/items',method:'CONNECT'}}],
  ["if(name==='mcp.call' && !this.discovered.get(connection.id)?.has(args.tool))",{tool:'mcp.call',arguments:{connection:m.id,tool:'undiscovered'}}]
 ];
 // Unknown tools have an additional kind check; bypassing the catalog still changes its reported error.
 const first=guards.shift();const {ToolRuntime:Catalog}=await mutated(t,'runtime.mjs',first[0],'if(false)');assert.throws(()=>assert.throws(()=>new Catalog(f.store,f.dir).validate(first[1]),/unknown or malformed/));
 for(const [guard,input]of guards){const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs',guard,'if(false)');assert.throws(()=>assert.throws(()=>new Broken(f.store,f.dir).validate(input)));}
});
test('mutation proofs cover response bounds and redirect rejection',async t=>{
 const {responseText:unbounded}=await mutated(t,'adapters.mjs',"if(text.length>max)",'if(false)');
 await assert.rejects(assert.rejects(unbounded(new Response('x'.repeat(21)),20)),/Missing expected rejection/);
 const {apiRequest:redirect}=await mutated(t,'adapters.mjs',"if(response.status>=300 && response.status<400)",'if(false)');
 await assert.rejects(assert.rejects(redirect(apiConfig,{path:'/items'},'',new AbortController().signal,async()=>new Response('',{status:302}))),/Missing expected rejection/);
});
test('connections cannot change during a running job; restarting preserves action uncertainty',async t=>{
 const f=fixture(t);const service=new ProblemService(f.store,{}, {tools:f.tools});service.job=new AbortController();
 for(const method of ['connection.add','connection.remove'])await assert.rejects(service.call(method,apiConfig),/Stop/);
 f.store.db.prepare("INSERT INTO tool_actions VALUES (?,?,?,?,?,?,?,?)").run('synthetic-interrupted',f.store.active().id,'run','api.request','{}','running','','synthetic-time');
 new ToolRuntime(f.store,f.dir);assert.equal(f.tools.snapshot().actions[0].status,'interrupted');
});
