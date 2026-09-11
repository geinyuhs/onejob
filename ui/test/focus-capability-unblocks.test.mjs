import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ProblemStore} from '../server/focus/store.mjs';
import {ContextSearch,localRanker} from '../server/focus/search.mjs';
import {ToolRuntime} from '../server/focus/tools/runtime.mjs';
import {AsideAdapter,responseText,MCPAdapter} from '../server/focus/tools/adapters.mjs';
import {validateScroll,scrollViewport,scrollContainer} from '../server/focus/tools/scroll.mjs';
import {formatExecutionAnswer} from '../server/focus/answer-format.mjs';
import {AgentEngine} from '../server/focus/agent-engine.mjs';
import {instructionFor} from '../server/focus/prompt.mjs';

function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'onejob-unblocks-')),store=new ProblemStore(join(dir,'store.sqlite'));store.create('Synthetic research');
 const tools=new ToolRuntime(store,dir),options={runId:'synthetic',problemId:store.active().id,signal:new AbortController().signal,assertCurrent:()=>{},researchOnly:true};
 t.after(async()=>{await tools.close();store.close();rmSync(dir,{recursive:true,force:true});});return {dir,store,tools,options};
}
test('old meaning-only evidence is available beyond a thousand newer entries, still job-owned',t=>{
 const {store}=fixture(t);const id=store.add('source','Synthetic concept without query words');
 store.db.prepare("UPDATE entries SET created='2000-01-01' WHERE id=?").run(id);
 for(let i=0;i<1001;i++)store.add('source','Synthetic filler '+i);
 const search=new ContextSearch(store,(_query,entries)=>({available:true,matches:entries.filter(e=>e.id===id).map(e=>({id:e.id,distance:0.1}))}));
 assert.equal(search.retrieve('distant synonym')[0]?.id,id);
 store.archive();store.create('Separate synthetic job');assert.equal(search.retrieve('distant synonym').length,0);
});
test('native meaning ranking batches the whole archive and merges by distance',{skip:process.platform!=='darwin'},t=>{
 const {dir}=fixture(t),binary=join(dir,'synthetic-ranker');
 writeFileSync(binary,'#!'+process.execPath+'\nlet s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const r=JSON.parse(s);if(r.entries.length>128)process.exit(1);console.log(JSON.stringify({available:true,matches:r.entries.map(e=>({id:e.id,distance:Number(e.id)})).sort((a,b)=>a.distance-b.distance).slice(0,24)}));});',{mode:0o700});
 const entries=Array.from({length:1200},(_,i)=>({id:String(1199-i),title:'Synthetic',text:'Synthetic text'}));
 const result=localRanker(binary)('query',entries);assert.equal(result.available,true);assert.equal(result.matches[0].id,'0');assert.equal(result.matches.length,24);
});
test('large documents survive save, search and paged readback without the former caps',async t=>{
 const {store,tools,options}=fixture(t),text='Synthetic large document 🙂\n'.repeat(8000);
 const saved=await tools.execute({tool:'document.save',arguments:{name:'large.md',text}},options);
 let value='',offset=0;
 do{const result=(await tools.execute({tool:'document.read',arguments:{artifact:saved.result.artifact,offset}},options)).result;value+=result.text;offset=result.nextOffset;}while(offset!==null);
 assert.equal(value,text);assert(store.retrieve('Synthetic large').length);
});
test('API and MCP results larger than the old cap reach lossless paging',async t=>{
 const {tools}=fixture(t),text='Synthetic 🙂'.repeat(18000);
 assert.equal(await responseText(new Response(text)),text);
 const adapter=new MCPAdapter();adapter.connect=async()=>({callTool:async()=>({text}),close:async()=>{}});
 const result=await adapter.call({}, {operation:'call',tool:'synthetic'},'',new AbortController().signal);
 assert.equal(result.text,text);
 const page=JSON.parse(tools.serializeOutput({tool:'mcp.call',result})).result;assert(page.nextOffset);assert.equal(page.totalLength,JSON.stringify({tool:'mcp.call',result}).length);
});
test('browser review sees complete context and targets outside the last displayed chunk',async t=>{
 const {tools,options}=fixture(t),connection=tools.connections.save({kind:'aside',name:'Synthetic browser',browserAccessApproved:true});
 const snapshot='- heading "Synthetic rules"\n- button "Add/drop rules" [ref=e1]:\n  - text "Opens the rulebook"\n'+'- paragraph "Synthetic detail"\n'.repeat(1200);
 tools.aside.sessions.set(connection.id,{pages:new Map([['p',{problemId:options.problemId,url:'https://example.com/',snapshot:'- paragraph "Last chunk"',snapshotText:snapshot}]]),client:{close:async()=>{}}});
 let calls=0;tools.aside.call=async()=>{calls++;return {snapshot:'Rules'};};
 await tools.execute({tool:'browser.click',arguments:{connection:connection.id,page:'p',selector:'e1'}},{...options,review:async value=>{assert.equal(value.page,snapshot);assert.match(value.targetContext,/Opens the rulebook/);assert.equal(value.target.label,'Add/drop rules');return {decision:'navigation'};}});
 assert.equal(calls,1);
});
test('free scrolling never needs approval and remains bound to the job and Stop',async t=>{
 const {tools,options}=fixture(t),connection=tools.connections.save({kind:'aside',name:'Synthetic browser',browserAccessApproved:true});
 tools.aside.sessions.set(connection.id,{pages:new Map([['p',{problemId:options.problemId,url:'https://example.com/',snapshot:''}]]),client:{close:async()=>{}}});
 let calls=0;tools.aside.call=async()=>{calls++;return {snapshot:'More content'};};
 const action={tool:'browser.scroll',arguments:{connection:connection.id,page:'p',direction:'down',amount:600}};
 await tools.execute(action,{...options,review:()=>assert.fail('scroll should not need a model review')});assert.equal(calls,1);
 await assert.rejects(tools.execute(action,{...options,signal:AbortSignal.abort()}));assert.equal(calls,1);
 tools.aside.sessions.get(connection.id).pages.get('p').problemId='foreign';assert.throws(()=>tools.validate(action),/owned/);
});
test('fixed scrolling supports all directions, viewport defaults, and nested containers',()=>{
 const calls=[],window={innerWidth:1000,innerHeight:500,scrollBy:args=>calls.push(args)},element={clientWidth:200,clientHeight:300,scrollBy:args=>calls.push(args)};
 vm.runInNewContext('('+scrollViewport.toString()+')({direction:"down"})',{window});assert.equal(calls.at(-1).top,400);
 for(const [direction,field,value] of [['up','top',-70],['down','top',70],['left','left',-70],['right','left',70]]){
  scrollContainer(element,{direction,amount:70});assert.equal(calls.at(-1)[field],value);
 }
 scrollContainer(element,{});assert.equal(calls.at(-1).top,240);
});
test('scroll input guards fire, with retained mutation proof',()=>{
 const cases=[
  ["args.selector!==undefined&&(typeof args.selector!=='string'||!/^e\\d+$/u.test(args.selector))",{selector:'body;evil()'}],
  ["args.direction!==undefined&&!['up','down','left','right'].includes(args.direction)",{direction:'execute'}],
  ["args.amount!==undefined&&(!Number.isFinite(args.amount)||args.amount<=0)",{amount:Infinity}],
 ];
 validateScroll({});validateScroll({selector:'e12',direction:'up',amount:500});
 for(const [guard,input] of cases){
  assert.throws(()=>validateScroll(input));
  const source=validateScroll.toString();assert(source.includes(guard));
  const broken=Function('return ('+source.replace(guard,'false')+')')();
  assert.throws(()=>assert.throws(()=>broken(input)),assert.AssertionError);
 }
 for(const amount of [-1,0,NaN,'10'])assert.throws(()=>validateScroll({amount}));
 for(const selector of [null,['e1'],{},1])assert.throws(()=>validateScroll({selector}));
});
test('answer formatting preserves the original answer and cannot rerun tools',async()=>{
 const text='Research is complete. Synthetic findings are saved.';let calls=0;
 const codex={thinkingModes:async()=>({defaultEffort:'high'}),answer:async context=>{calls++;assert.deepEqual(context,{phase:'answerFormat',answer:text,reasoningEffort:'high'});return {status:'completed',question:''};}};
 const engine=new AgentEngine(codex,{answer:async()=>({unformattedAnswer:text})});
 const result=await engine.answer({phase:'execute',problem:{id:'synthetic'}},undefined,()=>{},()=>assert.fail('formatting cannot execute'));
 assert.equal(result.reply,text);assert.equal(result.execution.status,'completed');assert.equal(calls,1);assert.match(instructionFor({phase:'answerFormat'}),/Do not continue the task/);
});
test('unavailable or unsafe formatting keeps the answer without claiming completion',async()=>{
 const text='Synthetic findings; completion is unclear.';
 for(const result of [{action:{tool:'browser.click'},status:'completed',question:''},{status:'unknown',question:''},{status:'completed',question:null},{status:'needs_input',question:'Invented question?'},null]){
  const answer=await formatExecutionAnswer({unformattedAnswer:text},{},{answer:async()=>result});assert(answer.reply.startsWith(text+'\n\nDisplay note:'));assert.equal(answer.execution.status,'blocked');
 }
 const answer=await formatExecutionAnswer({unformattedAnswer:text},{},{answer:async()=>{throw new Error('Synthetic unavailable');}});
 assert(answer.reply.startsWith(text));assert.match(answer.reply,/could not confirm/);assert.equal(answer.execution.status,'blocked');
 const controller=new AbortController();
 await assert.rejects(formatExecutionAnswer({unformattedAnswer:text},{},{answer:async()=>{controller.abort();return {status:'completed',question:''};}},controller.signal));
});
test('formatter may only copy an existing question',async()=>{
 const text='Synthetic research is waiting. Which region should I use?';
 const result=await formatExecutionAnswer({unformattedAnswer:text},{},{answer:async()=>({status:'needs_input',question:'Which region should I use?'})});
 assert.equal(result.execution.question,'Which region should I use?');
});
test('mutation proof: formatting cannot accept an action or invent a handoff',async t=>{
 const {dir}=fixture(t),original=new URL('../server/focus/answer-format.mjs',import.meta.url);
 const source=readFileSync(original,'utf8').replace("'./execution.mjs'","'"+new URL('../server/focus/execution.mjs',import.meta.url).href+"'");
 for(const [index,guard,result] of [
  [0,"Object.keys(formatted).some(key=>!['status','question'].includes(key))||",{status:'completed',question:'',action:{tool:'browser.click'}}],
  [1,"formatted.status==='needs_input'&&(!formatted.question.trim()||!text.includes(formatted.question))",{status:'needs_input',question:'Invented?'}],
 ]){
  assert(source.includes(guard));const path=join(dir,'format-'+index+'.mjs');writeFileSync(path,source.replace(guard,index===0?'':'false'));
  const broken=await import(pathToFileURL(path));const answer=await broken.formatExecutionAnswer({unformattedAnswer:'Synthetic incomplete research'},{},{answer:async()=>result});
  assert.throws(()=>assert.equal(answer.execution.status,'blocked'));
 }
});
