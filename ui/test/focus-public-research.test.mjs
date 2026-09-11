import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,cpSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {CodexClient,ClaudeClient,claudeArgs} from '../server/focus/clients.mjs';
import {ProblemService} from '../server/focus/service.mjs';
import {ProblemStore} from '../server/focus/store.mjs';

async function research(t,Service=ProblemService,{inspect=()=>{},action='browser.open'}={}) {
 const dir=mkdtempSync(join(tmpdir(),'onejob-public-test-')),store=new ProblemStore(join(dir,'test.sqlite'));
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const executed=[],events=[],contexts=[];let savedProgress;
 const client={account:async()=>({connected:true}),answer:async(context,signal,progress)=>{
  contexts.push(structuredClone(context));inspect(context);savedProgress=progress;progress('Searching the web…');
  return contexts.length===1?{action:{tool:action,arguments:{query:'synthetic'}}}:{reply:'Synthetic findings.',memories:[]};
 }};
 const tools={snapshot:()=>({}),catalog:()=>({tools:[{name:'memory.search'},{name:'browser.open'},{name:'api.request'}],connections:[{id:'synthetic-private'}]}),execute:async a=>{executed.push(a);return {tool:a.tool,result:[]};}};
 const service=new Service(store,{chatgpt:client},{tools,emit:e=>events.push(e)});
 await service.call('newJob');await service.call('modelReady');await service.call('describe',{text:'Synthetic research task'});
 service.clarification.save([]);await service.call('research');
 return {executed,events,contexts,savedProgress,service};
}
async function actionBoundary(t,Service=ProblemService){
 for(const action of ['browser.open','browser.read','api.request','mcp.call','document.save']) {
  const f=await research(t,Service,{action});assert.equal(f.executed.length,0,'research must not execute account or write tools');
  assert.match(f.contexts[1].toolResults[0].error,/Research can only/);
 }
}
async function catalogBoundary(t,Service=ProblemService){
 await research(t,Service,{inspect:context=>assert.deepEqual(context.capabilities,{tools:[{name:'memory.search'}],connections:[]},'research catalog must omit private connections')});
}
test('research blocks account actions and writes even if requested by the model',actionBoundary);
test('research does not advertise private connections',catalogBoundary);
test('research can retrieve local notes and forwards only live-run progress',async t=>{
 const f=await research(t,ProblemService,{action:'memory.search'});
 assert.equal(f.executed.length,1);assert.ok(f.events.some(e=>e.message==='Searching the web…'));
 const count=f.events.length;f.savedProgress('Late result');assert.equal(f.events.length,count,'completed runs cannot publish stale progress');
});
for(const [name,scenario,guard] of [
 ['account action boundary',actionBoundary,"if(context.phase==='research' && action.tool!=='memory.search')"],
 ['private catalog boundary',catalogBoundary,"if(context.phase==='research')context.capabilities="],
])test('mutation proof: '+name,async t=>{
 const dir=mkdtempSync(join(tmpdir(),'onejob-public-mutant-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 cpSync(new URL('../server/focus/',import.meta.url),dir,{recursive:true,filter:path=>!path.includes('node_modules')});
 const path=join(dir,'service.mjs'),source=readFileSync(path,'utf8');assert.ok(source.includes(guard));
 writeFileSync(path,source.replace(guard,name==='private catalog boundary'?'if(false)context.capabilities=':'if(false)'));
 const {ProblemService:Broken}=await import(pathToFileURL(path));await assert.rejects(scenario(t,Broken));
});

test('Codex enables hosted web only for research or execution and reports actual search events',async()=>{
 for(const phase of ['research','execute','clarify','work']) {
  const client=new CodexClient('/tmp/synthetic-unused'),calls=[],progress=[];
  client.account=async()=>({connected:true});client.rpc=async(method,params)=>{
   calls.push({method,params});
   if(method==='thread/start')return {thread:{id:'synthetic'},model:'gpt-6-astra'};
   if(method==='turn/start') {
    queueMicrotask(()=>{
     client.emit('notification',{method:'item/started',params:{threadId:'other-job',item:{type:'webSearch'}}});
     for(const [method,item] of [['item/started',{type:'webSearch'}],['item/started',{type:'webSearch',action:{type:'search',query:'synthetic paper shapes'}}],['item/completed',{type:'webSearch'}],['item/started',{type:'webSearch',action:{type:'openPage',url:'https://example.com/paper'}}],['item/completed',{type:'agentMessage',text:'{"reply":"Synthetic","memories":[]}'}]])client.emit('notification',{method,params:{threadId:'synthetic',item}});
     client.emit('notification',{method:'turn/completed',params:{threadId:'synthetic',turn:{status:'completed'}}});
    });return {turn:{id:'synthetic-turn'}};
   }
  };
  await client.answer({phase},undefined,message=>progress.push(message));
  const start=calls[0].params;assert.equal(start.config.web_search,['research','execute'].includes(phase)?'live':'disabled');assert.equal(start.permissions,'onejob');assert.equal(start.approvalPolicy,'never');
  assert.deepEqual(progress,['research','execute'].includes(phase)?['Checking public sources…','Searching the web for “synthetic paper shapes”…','Reviewing web findings…','Reading example.com…']:[]);
 }
});

function claudeFixture(t,body){
 const dir=mkdtempSync(join(tmpdir(),'onejob-public-claude-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const binary=join(dir,'synthetic-client');writeFileSync(binary,'#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on("end",()=>{'+body+'});',{mode:0o700});
 return new ClaudeClient(dir,binary);
}
test('Claude permits hosted search only, never browser, shell, files or WebFetch',()=>{
 for(const phase of ['research','execute','work','clarify']) {
  const args=claudeArgs({phase});assert.equal(args[args.indexOf('--tools')+1],['research','execute'].includes(phase)?'WebSearch':'');
  assert.ok(args.includes('--safe-mode'));assert.ok(args.includes('--strict-mcp-config'));assert.ok(args.includes('--no-chrome'));
  if(['research','execute'].includes(phase))assert.equal(args[args.indexOf('--allowedTools')+1],'WebSearch');
 }
});
test('Claude research consumes streamed search events and the final result',async t=>{
 const events=[{type:'assistant',message:{content:[{type:'tool_use',name:'WebSearch'}]}},{type:'user',message:{content:[{type:'tool_result'}]}},{type:'result',result:'{"reply":"Synthetic result","memories":[]}'}];
 const client=claudeFixture(t,`const data=${JSON.stringify(events.map(e=>JSON.stringify(e)).join('\n')+'\n')};process.stdout.write(data.slice(0,17));setTimeout(()=>process.stdout.write(data.slice(17)),10);`),progress=[];
 assert.equal((await client.answer({phase:'research'},undefined,m=>progress.push(m))).reply,'Synthetic result');
 assert.deepEqual(progress,['Searching the web…','Reviewing web findings…']);
});
for(const [name,body] of [
 ['malformed stream','process.stdout.write("not-json\\n");'],
 ['missing final result','process.stdout.write("{\\"type\\":\\"system\\"}\\n");'],
 ['provider error','process.stdout.write(JSON.stringify({type:"result",is_error:true,result:"{}"})+"\\n");'],
 ['oversized stream','process.stdout.write("x".repeat(1000001));'],
])test('Claude rejects '+name,async t=>{await assert.rejects(claudeFixture(t,body).answer({phase:'research'}));});
