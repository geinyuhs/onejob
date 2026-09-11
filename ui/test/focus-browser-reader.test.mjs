import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {AsideAdapter} from '../server/focus/tools/adapters.mjs';
import {navigationTarget} from '../server/focus/tools/auto.mjs';

function fixture(Implementation=AsideAdapter){
 const state={text:('- paragraph "Synthetic archive detail"\n').repeat(1800)+'- paragraph "Keeper limit: 2; INDIGO-742"\n- link "View Proposed Trade" [ref=e999]',clicks:0,fullReads:0};
 const lines=[],page={url:()=> 'https://example.com/',locator:()=>({click:async()=>{state.clicks++;}})};
 const context=vm.createContext({console:{log:x=>lines.push(x)},openTab:async()=>page,snapshot:async(p,options)=>{if(options.interactive===false)state.fullReads++;return {tree:state.text};}});
 const session={pages:new Map(),client:{close:async()=>{},callTool:async request=>{
  const code=request.arguments.code,boundary=code.indexOf('await (async()=>'),prefix=boundary<0?code:code.slice(0,boundary);
  // Only top-level REPL declarations persist. Nested declarations must retain
  // normal JS scoping so tests catch accidental shadowing of the native cache.
  lines.length=0;await vm.runInContext('(async()=>{'+prefix.replace(/\bvar\s+(oj_\w+)/gu,'$1')+code.slice(prefix.length)+'})()',context);
  return {content:[{type:'text',text:lines.join('\n')}]};
 }}};
 const adapter=new Implementation('synthetic'),connection={id:'test'};adapter.sessions.set(connection.id,session);
 const controller=new AbortController(),signal=controller.signal;
 const call=args=>adapter.call(connection,{problemId:'job-a',...args},signal);
 return {state,adapter,session,call,controller,connection,signal};
}
test('full page text remains retrievable past both old cutoffs',async()=>{
 const f=fixture();let p=await f.call({operation:'open',url:'https://example.com'}),text=p.snapshot;
 assert.equal(f.state.fullReads,1);
 while(p.nextOffset!==null){assert(Number.isSafeInteger(p.nextOffset));p=await f.call({operation:'read',page:p.page,offset:p.nextOffset,snapshotId:p.snapshotId});text+=p.snapshot;}
 assert.equal(text,f.state.text);assert.match(text,/INDIGO-742/);
 assert.equal(f.state.fullReads,1,'continuations read the same saved snapshot, not a shifting page');
});
test('paging rejects wrong jobs, stale snapshots, and invalid offsets',async()=>{
 const f=fixture(),p=await f.call({operation:'open',url:'https://example.com'});
 for(const offset of [-1,1.5,'1'])await assert.rejects(f.call({operation:'read',page:p.page,offset,snapshotId:p.snapshotId}));
 await assert.rejects(f.call({operation:'read',page:p.page,offset:8000,snapshotId:'old'}));
 await assert.rejects(f.call({operation:'read',page:p.page,offset:8000,snapshotId:p.snapshotId,problemId:'job-b'}));
});
test('a change outside the visible chunk prevents an automatic click',async()=>{
 const f=fixture();f.state.text='- link "Overview" [ref=e1]\n'+f.state.text;
 const p=await f.call({operation:'open',url:'https://example.com'});
 f.state.text+='\nChanged outside first chunk';
 await assert.rejects(f.call({operation:'click',page:p.page,selector:'e1',expectedSnapshot:p.snapshot}),/page changed during automatic review/i);
 assert.equal(f.state.clicks,0);
});
test('navigation ignores unrelated updates but rejects changed target context',async()=>{
 const f=fixture();f.state.text='- heading "Synthetic account"\n- link "Overview" [ref=e1]\n  - /url: /overview\n- paragraph "Old feed"';
 let p=await f.call({operation:'open',url:'https://example.com'});
 f.state.text=f.state.text.replace('Old feed','Updated feed');
 await f.call({operation:'click',page:p.page,selector:'e1',expectedSnapshot:p.snapshot,navigationOnly:true});
 assert.equal(f.state.clicks,1);
 for(const change of [text=>text.replace('/overview','/different'),text=>text.replace('Synthetic account','Other account'),text=>text.replace('Overview','Different target')]){
  p=await f.call({operation:'read',page:p.page});f.state.text=change(f.state.text);
  await assert.rejects(f.call({operation:'click',page:p.page,selector:'e1',expectedSnapshot:p.snapshot,navigationOnly:true}),/page changed/i);
  assert.equal(f.state.clicks,1);
 }
});
test('research navigation labels are candidates, not permission',()=>{
 assert(navigationTarget({name:'browser.fill',args:{selector:'e1',text:'synthetic'},snapshot:'- textbox "Password" [ref=e1]'}));
 for(const label of ['Trade history','Trade rules','Download rules'])assert.equal(navigationTarget({name:'browser.click',args:{selector:'e1'},snapshot:`- link "${label}" [ref=e1]`})?.label,label);
 for(const [name,role,args] of [['fill','searchbox',{text:'Synthetic query'}],['select','combobox',{value:'current'}],['hover','button',{}],['scroll','region',{}],['press','searchbox',{key:'Enter'}]]){
  assert(navigationTarget({name:'browser.'+name,args:{selector:'e1',...args},snapshot:`- ${role} "View filter" [ref=e1]:\n  - option "Current" value="current"`}));
 }
});
test('an unchanged full snapshot permits navigation from the last chunk',async()=>{
 const f=fixture();let p=await f.call({operation:'open',url:'https://example.com'});
 while(p.nextOffset!==null)p=await f.call({operation:'read',page:p.page,offset:p.nextOffset,snapshotId:p.snapshotId});
 await f.call({operation:'click',page:p.page,selector:'e999',expectedSnapshot:p.snapshot});
 assert.equal(f.state.clicks,1);
});
test('credentials are scrubbed before model paging can split them',async()=>{
 const f=fixture();const secret='synthetic-secret-at-page-boundary';f.adapter.credentialMasks.remember('test','job-a','https://example.com',secret);
 f.state.text='x'.repeat(7990)+secret+'tail';
 let p=await f.call({operation:'open',url:'https://example.com'}),text=p.snapshot;
 while(p.nextOffset!==null){assert(Number.isSafeInteger(p.nextOffset));p=await f.call({operation:'read',page:p.page,offset:p.nextOffset,snapshotId:p.snapshotId});text+=p.snapshot;}
 assert.equal(text,'x'.repeat(7990)+'[redacted]tail');
});
test('all trade labels reach independent review without keyword rules',()=>{
 const target=label=>navigationTarget({name:'browser.click',args:{selector:'e1'},snapshot:`- link "${label}" [ref=e1]`});
 for(const label of ['View Proposed Trade','You have proposed a trade. View Proposed Trade'])assert.equal(target(label)?.label,label);
 for(const label of ['Accept trade','Trade player','View trade and accept','Accept trade. View Proposed Trade'])assert.equal(target(label)?.label,label);
});
test('refresh invalidates old cursors and Stop cancels cached reads',async()=>{
 const f=fixture(),old=await f.call({operation:'open',url:'https://example.com'});
 const fresh=await f.call({operation:'read',page:old.page});
 assert.notEqual(fresh.snapshotId,old.snapshotId);
 await assert.rejects(f.call({operation:'read',page:old.page,offset:old.nextOffset,snapshotId:old.snapshotId}),/expired/);
 f.controller.abort();
 await assert.rejects(f.call({operation:'read',page:fresh.page,offset:fresh.nextOffset,snapshotId:fresh.snapshotId}),e=>e.name==='AbortError');
});
test('escaped page text fits a source entry and remains complete',async()=>{
 const f=fixture();f.state.text='"\\\t'.repeat(10000);
 let p=await f.call({operation:'open',url:'https://example.com'}),text='';
 while(true){
  assert(JSON.stringify(p).length<12000);text+=p.snapshot;
  if(p.nextOffset===null)break;
  p=await f.call({operation:'read',page:p.page,offset:p.nextOffset,snapshotId:p.snapshotId});
 }
 assert.equal(text,f.state.text);
});
async function mutation(t,file,before,after){
 const original=new URL('../server/focus/tools/'+file,import.meta.url);
 let source=readFileSync(original,'utf8');assert(source.includes(before));source=source.replace(before,after);
 source=source.replace(/from '(\.[^']+)'/gu,(_,relative)=>`from '${new URL(relative,original).href}'`);
 source=source.replace(/from '@modelcontextprotocol\/sdk\/([^']+)'/gu,(_,relative)=>`from '${new URL('../server/focus/node_modules/@modelcontextprotocol/sdk/dist/esm/'+relative,import.meta.url).href}'`);
 const dir=mkdtempSync(join(tmpdir(),'onejob-reader-mutation-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,file);writeFileSync(path,source);return import(pathToFileURL(path));
}
for(const [guard,args] of [
 ["if(args.offset!==undefined&&(!Number.isSafeInteger(args.offset)||args.offset<0))",{offset:-1}],
 ["if(!saved||saved.problemId!==args.problemId)",{problemId:'job-b'}],
 ["if(args.snapshotId!==saved.snapshotId)",{snapshotId:'expired'}],
 ["if(typeof text!=='string'||offset>text.length)",{offset:1000000}]
])test('mutation proof: cursor guard '+guard,async t=>{
 const {AsideAdapter:Broken}=await mutation(t,'adapters.mjs',guard,'if(false)');
 const check=async Implementation=>{
  const f=fixture(Implementation),p=await f.call({operation:'open',url:'https://example.com'});
  await assert.rejects(f.call({operation:'read',page:p.page,offset:p.nextOffset,snapshotId:p.snapshotId,...args}));
 };
 await check(AsideAdapter);await assert.rejects(check(Broken),/Missing expected rejection/);
});
test('mutation proof: empty transport chunks fail instead of silently omitting text',async t=>{
 const guard="if(typeof chunk!=='string'||!chunk.length)throw new Error('Aside returned an incomplete page chunk.');";
 const {AsideAdapter:Broken}=await mutation(t,'adapters.mjs',guard,'');
 const check=async Implementation=>{
  const f=fixture(Implementation),callTool=f.session.client.callTool;let requests=0;
  f.session.client.callTool=async request=>{
   if(request.arguments.title==='onejob: retrieve remaining page text'&&++requests===1)return {content:[{type:'text',text:'ONEJOB_RESULT:{"snapshot":""}'}]};
   return callTool(request);
  };
  await assert.rejects(f.adapter.perform(f.connection,{operation:'open',url:'https://example.com',problemId:'job-a'},f.signal),/incomplete page chunk/);
 };
 await check(AsideAdapter);await assert.rejects(check(Broken),/Missing expected rejection/);
});
