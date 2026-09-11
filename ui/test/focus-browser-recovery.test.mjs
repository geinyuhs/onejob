import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AsideAdapter} from '../server/focus/tools/adapters.mjs';
import {ToolRuntime} from '../server/focus/tools/runtime.mjs';
import {ProblemStore} from '../server/focus/store.mjs';

function browser(t,Runtime=ToolRuntime){
 const dir=mkdtempSync(join(tmpdir(),'onejob-recovery-')),store=new ProblemStore(join(dir,'test.sqlite'));
 store.create('Synthetic navigation task');
 const state={tree:'- link "Overview" [ref=e1]',clicks:0,reads:0,failAction:false,failSnapshot:false,changeReview:false};
 const lines=[],page={url:()=> 'https://example.com/',locator:()=>({click:async()=>{state.clicks++;if(state.failAction)throw Object.assign(new Error('SYNTHETIC_PRIVATE_ERROR'),{name:'TimeoutError'});state.tree='- heading "Details"';}})};
 const context=vm.createContext({tab:page,console:{log:x=>lines.push(x)},snapshot:async()=>{state.reads++;if(state.failSnapshot&&state.clicks){state.failSnapshot=false;throw new Error('SYNTHETIC_PRIVATE_ERROR');}return {tree:state.tree};}});
 const aside=new AsideAdapter('synthetic');
 const tools=new Runtime(store,dir,{aside}),c=tools.connections.save({kind:'aside',name:'Synthetic browser',browserAccessApproved:true});
 aside.sessions.set(c.id,{pages:new Map([['page',{variable:'tab',url:page.url(),snapshot:state.tree,problemId:store.active().id}]]),client:{close:async()=>{},callTool:async request=>{
  lines.length=0;
  try{await vm.runInContext('(async()=>{'+request.arguments.code.replace(/\bvar\s+(oj_\w+)/gu,'$1')+'})()',context);return {content:[{type:'text',text:lines.join('\n')}]};}
  catch(error){return {isError:true,content:[{type:'text',text:'SYNTHETIC_PRIVATE_ERROR'}]};}
 }}});
 const controller=new AbortController(),execution={runId:'synthetic-run',problemId:store.active().id,signal:controller.signal,assertCurrent:()=>{},review:async()=>{if(state.changeReview){state.tree='- link "Updated overview" [ref=e1]';state.changeReview=false;}return {decision:'navigation'};}};
 const action={tool:'browser.click',arguments:{connection:c.id,page:'page',selector:'e1'}};
 t.after(async()=>{await tools.close();store.close();rmSync(dir,{recursive:true,force:true});});
 return {state,tools,aside,c,controller,execution,action};
}

test('a changed page is refreshed without clicking and can be independently reviewed again',async t=>{
 const f=browser(t);f.state.changeReview=true;
 const result=await f.tools.execute(f.action,f.execution);
 assert.equal(result.actionState,'not_performed');assert.equal(f.state.clicks,0);
 assert.match(result.result.snapshot,/Updated/);assert.equal(f.tools.snapshot().actions[0].status,'not_performed');
 const next=await f.tools.execute(f.action,f.execution);
 assert.equal(f.state.clicks,1);assert.match(next.result.snapshot,/Details/);
});
test('read recovery preserves known credentials for redaction on the new transport',async()=>{
 const adapter=new AsideAdapter('synthetic'),secret='SYNTHETIC_RECONNECT_CANARY';let attempts=0;
 adapter.credentialMasks.remember('c','job','https://example.com',secret);
 adapter.sessions.set('c',{pages:new Map([['p',{url:'https://example.com/',problemId:'job'}]]),client:{close:async()=>{}}});
 adapter.perform=async()=>{if(++attempts===1)throw new Error('Synthetic lost transport');return {protected:adapter.credentialMasks.scrub('c','job',secret)==='[redacted]'};};
 const result=await adapter.call({id:'c'},{operation:'read',page:'p',problemId:'job'},new AbortController().signal);
 assert.equal(result.protected,true,'A reconnect must not forget credentials that may still appear on the page');
 await adapter.close();assert.equal(adapter.credentialMasks.jobs.size,0);
});

test('a completed click with a failed snapshot recovers the read without repeating the click',async t=>{
 const f=browser(t);f.state.failSnapshot=true;
 const result=await f.tools.execute(f.action,f.execution);
 assert.equal(result.actionState,'completed');assert.equal(result.recovered,true);
 assert.equal(f.state.clicks,1);assert.match(result.result.snapshot,/Details/);
 assert.equal(f.tools.snapshot().actions[0].status,'completed');
 assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_PRIVATE_ERROR/);
});

test('an uncertain click is inspected but never replayed or called completed',async t=>{
 const f=browser(t);f.state.failAction=true;
 const result=await f.tools.execute(f.action,f.execution);
 assert.equal(result.actionState,'uncertain');assert.equal(result.diagnostic,'action_timeout');
 assert.equal(f.state.clicks,1);assert.match(result.result.snapshot,/Overview/);
 assert.equal(f.tools.snapshot().actions[0].status,'uncertain');
 await assert.rejects(f.tools.execute(f.action,f.execution),/Do not automatically retry/);
 assert.equal(f.state.clicks,1);assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_PRIVATE_ERROR/);
});

test('Stop and changed jobs prevent automatic inspection from doing more work',async t=>{
 for(const stop of [true,false]){
  const f=browser(t);let calls=0,stale=false;
  f.aside.call=async()=>{calls++;if(stop)f.controller.abort();else stale=true;throw new Error('Synthetic transport failure');};
  await assert.rejects(f.tools.execute(f.action,{...f.execution,assertCurrent:()=>{if(stale)throw new Error('Synthetic job change');}}));
  assert.equal(calls,1);
 }
});

test('a failed inspection preserves the failure category and allows a safe preflight retry',async t=>{
 const f=browser(t);let calls=0;
 f.aside.call=async()=>{calls++;throw Object.assign(new Error('Synthetic failure'),{browserPhase:'preflight',diagnostic:'preflight_failed'});};
 await assert.rejects(f.tools.execute(f.action,f.execution),/Automatic page inspection also failed/);
 assert.equal(calls,2);assert.equal(f.tools.snapshot().actions[0].status,'not_performed');
 assert.match(f.tools.snapshot().actions[0].summary,/preflight_failed/);
});

test('mutation proof: an action timeout must not be marked safe to replay',async t=>{
 const original=new URL('../server/focus/tools/runtime.mjs',import.meta.url),dir=mkdtempSync(join(tmpdir(),'onejob-recovery-mutation-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let source=readFileSync(original,'utf8');
 const before="error.browserPhase==='preflight'?'not_performed'";
 assert.ok(source.includes(before));source=source.replace(before,"true?'not_performed'");
 source=source.replace(/from '(\.[^']+)'/g,(_,relative)=>`from '${new URL(relative,original).href}'`);
 const path=join(dir,'broken.mjs');writeFileSync(path,source);
 const {ToolRuntime:Broken}=await import(path);
 for(const [Runtime,expected] of [[ToolRuntime,'uncertain'],[Broken,'not_performed']]){
  const f=browser(t,Runtime);f.state.failAction=true;
  const result=await f.tools.execute(f.action,f.execution);assert.equal(result.actionState,expected);
  if(Runtime===Broken)assert.throws(()=>assert.equal(result.actionState,'uncertain'));
 }
});

test('mutation proof: browser diagnostics reject unknown phases and private error text',async t=>{
 const original=new URL('../server/focus/tools/adapters.mjs',import.meta.url),dir=mkdtempSync(join(tmpdir(),'onejob-diagnostic-mutation-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const source=readFileSync(original,'utf8');
 async function check(Adapter){
  const adapter=new Adapter('synthetic');
  adapter.session=async()=>({pages:new Map([['page',{variable:'tab',url:'https://example.com/',problemId:'job'}]]),client:{callTool:async request=>{
   const marker=request.arguments.code.match(/ONEJOB_FAILURE_[^:]+:/)[0];
   return {content:[{type:'text',text:marker+JSON.stringify({phase:'SYNTHETIC_PRIVATE_PHASE',kind:'SYNTHETIC_PRIVATE_ERROR'})}]};
  }}});
  await assert.rejects(adapter.perform({id:'test'},{operation:'click',page:'page',selector:'e1',problemId:'job'},new AbortController().signal),error=>error.browserPhase==='action'&&error.diagnostic==='action_failed'&&!error.message.includes('SYNTHETIC_PRIVATE'));
 }
 await check(AsideAdapter);
 for(const [index,before,after] of [[0,"['preflight','action','snapshot'].includes(detail.phase)",'true'],[1,"['timeout','page_changed','failed'].includes(detail.kind)",'true']]){
  assert.ok(source.includes(before));
  let broken=source.replace(before,after).replace(/from '(\.[^']+)'/g,(_,relative)=>`from '${new URL(relative,original).href}'`);
  broken=broken.replace(/from '@modelcontextprotocol\/sdk\/([^']+)'/g,(_,relative)=>`from '${new URL('../server/focus/node_modules/@modelcontextprotocol/sdk/dist/esm/'+relative,import.meta.url).href}'`);
  const path=join(dir,'broken-'+index+'.mjs');writeFileSync(path,broken);
  const {AsideAdapter:Broken}=await import(path);await assert.rejects(check(Broken));
 }
});
