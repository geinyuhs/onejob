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
import {apiRequest,responseText,MCPAdapter,AsideAdapter} from '../server/focus/tools/adapters.mjs';

function fixture(t,options={}) {
 const dir=mkdtempSync(join(tmpdir(),'onejob-tools-')),store=new ProblemStore(join(dir,'memory.sqlite'));store.create('Synthetic test job');
 const events=[],tools=new ToolRuntime(store,dir,{emit:event=>events.push(event),...options});
 t.after(async()=>{await tools.close();store.close();rmSync(dir,{recursive:true,force:true});});
 const controller=new AbortController(),p=store.active();const execution={runId:'synthetic-run',problemId:p.id,signal:controller.signal,assertCurrent:()=>{assert.equal(store.active()?.id,p.id);assert.equal(store.active()?.revision,p.revision);}};
 return {dir,store,tools,events,controller,execution};
}
const apiConfig={kind:'api',name:'Synthetic API',url:'https://api.example.com',account:'Synthetic vault account',secretRef:'op://test-vault/test-item/credential'};
const spin=()=>new Promise(resolve=>setImmediate(resolve));
async function approve(f,promise,approved=true){await spin();const event=f.events.findLast(e=>e.event==='toolApproval');assert.ok(event);f.tools.resolve(event.id,approved);return promise;}

test('connections reject credential URLs and require explicit Aside setup',()=>{
 for(const value of ['http://api.example.com','https://name:secret@api.example.com','file:///tmp/source','https://api.example.com/#secret'])assert.throws(()=>serviceURL(value),/HTTPS/);
 assert.equal(serviceURL('http://127.0.0.1:3210/mcp',{local:true}).hostname,'127.0.0.1');
 assert.throws(()=>serviceURL('http://other.example.com',{local:true}),/HTTPS/);
 assert.throws(()=>cleanConnection({...apiConfig,kind:'unknown'}),/Choose/);
 assert.throws(()=>cleanConnection({...apiConfig,url:'https://api.example.com/?key=synthetic'}),/query parameters/);
 assert.throws(()=>cleanConnection({...apiConfig,secretRef:'SYNTHETIC_RAW_SECRET'}),/Never paste/);
 assert.throws(()=>cleanConnection({...apiConfig,account:''}),/Never paste/);
 assert.throws(()=>cleanConnection({kind:'aside',name:'Aside'}),/privacy/);
 assert.throws(()=>cleanConnection({kind:'aside',name:'Aside',localBrowserOnly:true,account:'unexpected'}),/account ID/);
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
 assert.ok(!JSON.stringify(f.tools.catalog()).includes(apiConfig.secretRef));assert.ok(!JSON.stringify(f.events).includes(secret));
 const result=await approve(f,pending);assert.equal(calls,1);assert.equal(result.result.echo,'[redacted]');assert.ok(!JSON.stringify(result).includes(secret));
 assert.throws(()=>f.tools.resolve(result.action,true),/expired/);
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
 const c=f.tools.connections.save({kind:'aside',name:'Test browser',localBrowserOnly:true});
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
test('the work loop pauses at its budget and keeps tools behind onejob',async t=>{
 const f=fixture(t);let calls=0;const service=new ProblemService(f.store,{chatgpt:{answer:async()=>{calls++;return {action:{tool:'memory.search',arguments:{query:'Synthetic'}}};}}},{tools:f.tools});
 const result=await service.send('Keep working');assert.equal(calls,13);assert.equal(result.actions.length,12);assert.match(result.entries.at(-1).text,/paused after 12/);
});

async function mutated(t,file,before,after) {
 const dir=mkdtempSync(join(tmpdir(),'onejob-tool-mutation-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const original=new URL('../server/focus/tools/'+file,import.meta.url);let source=readFileSync(original,'utf8');assert.ok(source.includes(before));source=source.replace(before,after);
 source=source.replace(/from '(\.[^']+)'/g,(_,relative)=>`from '${new URL(relative,original).href}'`);
 source=source.replace(/from '@modelcontextprotocol\/sdk\/([^']+)'/g,(_,relative)=>`from '${new URL('../server/focus/node_modules/@modelcontextprotocol/sdk/dist/esm/'+relative,import.meta.url).href}'`);
 const path=join(dir,file);writeFileSync(path,source);return import(pathToFileURL(path));
}
test('mutation proof: removing URL and path guards breaks their negative cases',async t=>{
 const {serviceURL:broken}=await mutated(t,'connections.mjs',"if ((url.protocol!=='https:' && !(local && loopback && url.protocol==='http:')) || url.username || url.password || url.hash)",'if (false)');
 assert.throws(()=>assert.throws(()=>broken('https://name:secret@api.example.com')));
 const {relativeURL:escaped}=await mutated(t,'connections.mjs',"if (typeof path!=='string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\\\') || /[\\r\\n]/u.test(path))",'if (false)');
 assert.throws(()=>assert.throws(()=>escaped(apiConfig.url,'https://api.example.com/items')));
});
test('mutation proof: removing approval executes without consent',async t=>{
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs','if(!spec.local) await this.approval','if(false) await this.approval');let calls=0;const f=fixture(t);
 const broken=new Broken(f.store,f.dir,{credentials:{resolve:async()=>''},api:async()=>{calls++;return {};}});const c=broken.connections.save(apiConfig);
 await broken.execute({tool:'api.request',arguments:{connection:c.id,path:'/items'}},f.execution);
 assert.throws(()=>assert.equal(calls,0));
});
test('mutation proof: removing secret redaction leaks the canary',async t=>{
 const {redact:broken}=await mutated(t,'credentials.mjs',"result.split(secret).join('[redacted]')",'result');
 assert.throws(()=>assert.ok(!JSON.stringify(broken({echo:'SYNTHETIC_CREDENTIAL'},['SYNTHETIC_CREDENTIAL'])).includes('SYNTHETIC_CREDENTIAL')));
});
test('mutation proof: retired page and artifact path guards are exercised',async t=>{
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs',"if(!page || page.problemId!==this.store.requireActive().id)",'if(!page)');const f=fixture(t);const broken=new Broken(f.store,f.dir);const c=broken.connections.save({kind:'aside',name:'Test',localBrowserOnly:true});broken.aside.sessions.set(c.id,{pages:new Map([['foreign',{url:'https://example.com',problemId:'other'}]]),client:{close:async()=>{}}});
 assert.throws(()=>assert.throws(()=>broken.validate({tool:'browser.read',arguments:{connection:c.id,page:'foreign'}})));
 const {ToolRuntime:Paths}=await mutated(t,'runtime.mjs',"if(typeof args.name!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,99}\\.(md|txt)$/u.test(args.name)||args.name.includes('..')||typeof args.text!=='string'||args.text.length>40000)",'if(false)');
 assert.throws(()=>assert.throws(()=>new Paths(f.store,f.dir).validate({tool:'document.save',arguments:{name:'../outside.md',text:'Synthetic'}})));
});

test('mutation proof: removing the retry gate permits an uncertain write again',async t=>{
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs',"if(prior)throw new Error('Do not automatically retry a declined or uncertain action. Ask the user to inspect the service first.');",'');
 const f=fixture(t);let proposals=0;const broken=new Broken(f.store,f.dir,{credentials:{resolve:async()=>''},api:async()=>{throw new Error('Synthetic failure');},emit:e=>{if(e.event==='toolApproval'){proposals++;queueMicrotask(()=>broken.resolve(e.id,true));}}});const c=broken.connections.save(apiConfig),action={tool:'api.request',arguments:{connection:c.id,path:'/items',method:'POST'}};
 await assert.rejects(broken.execute(action,f.execution));await assert.rejects(broken.execute(action,f.execution));assert.throws(()=>assert.equal(proposals,1));
});
test('mutation proof: removing the post-approval state check dispatches stale work',async t=>{
 const {ToolRuntime:Broken}=await mutated(t,'runtime.mjs',"signal.throwIfAborted();assertCurrent();this.update(id,'running');", "this.update(id,'running');");
 const f=fixture(t);let calls=0;const connection={kind:'aside',name:'Synthetic browser',localBrowserOnly:true};let stale=false;
 const broken=new Broken(f.store,f.dir,{aside:{call:async()=>{calls++;return {};},close:async()=>{}},emit:e=>{if(e.event==='toolApproval')queueMicrotask(()=>{stale=true;broken.resolve(e.id,true);});}});const c=broken.connections.save(connection);
 await assert.rejects(broken.execute({tool:'browser.open',arguments:{connection:c.id,url:'https://example.com'}},{...f.execution,assertCurrent:()=>{if(stale)throw new Error('Synthetic changed state');}}));assert.throws(()=>assert.equal(calls,0));
});
test('mutation proof: removing the credential-reference guard accepts a raw secret',async t=>{
 const {cleanConnection:broken}=await mutated(t,'connections.mjs',"if (secretRef && (!/^op:\\/\\/[^/?#\\s]+\\/[^/?#\\s]+\\/[^?#\\s]+$/u.test(secretRef) || !account))",'if (false)');
 assert.throws(()=>assert.throws(()=>broken({...apiConfig,secretRef:'SYNTHETIC_RAW_SECRET'})));
});

async function browserScenario(Implementation=AsideAdapter){
 const calls=[],lines=[];let url='';const page={url:()=>url,locator:selector=>({click:async()=>calls.push({selector}),fill:async text=>calls.push({selector,text}),press:async key=>calls.push({selector,key})})};
 const context=vm.createContext({openTab:async address=>{url=address;return page;},snapshot:async()=>({tree:'e3 textbox Title\ne4 button Save'}),console:{log:value=>lines.push(value)}});
 const session={pages:new Map(),client:{callTool:async request=>{lines.length=0;await vm.runInContext('(async()=>{'+request.arguments.code.replace(/^var /u,'')+'})()',context);return {content:[{type:'text',text:lines.join('\n')}]};}}};
 const adapter=new Implementation('synthetic-aside');adapter.session=async()=>session;
 const c={id:'synthetic-browser'},signal=new AbortController().signal;
 const opened=await adapter.call(c,{operation:'open',url:'https://example.com',problemId:'job-a'},signal);assert.match(opened.snapshot,/textbox/);
 const text="'); fetch('https://other.example.com'); //";
 await adapter.call(c,{operation:'fill',page:opened.page,selector:'e3',text,problemId:'job-a'},signal);assert.equal(calls[0].text,text,'text must stay a literal, never execute as code');
 await assert.rejects(adapter.call(c,{operation:'read',page:opened.page,problemId:'job-b'},signal),/Existing personal tabs/);
 url='https://other.example.com';await assert.rejects(adapter.call(c,{operation:'click',page:opened.page,selector:'e4',problemId:'job-a'},signal),/page changed/);
 assert.equal(calls.length,1,'changed page must not receive the approved click');
}
test('Aside templates keep text inert and bind actions to the reviewed page',()=>browserScenario());
test('mutation proof: removing the reviewed-page check allows the wrong page to be clicked',async t=>{
 const {AsideAdapter:Broken}=await mutated(t,'adapters.mjs',"if(${variable}.url()!==${JSON.stringify(saved.url)})throw new Error('The page changed after review. Open a new task tab before continuing.');",'');
 await assert.rejects(browserScenario(Broken),/Missing expected rejection/);
});

test('mutation proofs cover connection setup and request validation',async t=>{
 const cases=[
  ["if (!['api','mcp','aside'].includes(kind))",{...apiConfig,kind:'unknown'}],
  ["if(url && new URL(url).search)",{...apiConfig,url:'https://api.example.com/?key=synthetic'}],
  ["if (kind==='aside' && !input.localBrowserOnly)",{kind:'aside',name:'Synthetic'}],
  ["if (kind==='aside' && account && !/^u?\\d+$/u.test(account))",{kind:'aside',name:'Synthetic',localBrowserOnly:true,account:'wrong'}]
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
