import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ProblemStore} from '../server/focus/store.mjs';
import {ProblemService} from '../server/focus/service.mjs';
import {ToolRuntime} from '../server/focus/tools/runtime.mjs';
import {researchBlocked} from '../server/focus/research.mjs';
import {hermesRequest} from '../server/focus/hermes-client.mjs';

const done={reply:'Synthetic complete research.',memories:[],execution:{status:'completed'}};
const partial={reply:'Synthetic rules and schedule remain unread because of old app blocks.',memories:[],execution:{status:'blocked'}};
async function restored(t,Service=ProblemService){
 const dir=mkdtempSync(join(tmpdir(),'onejob-resumed-')),path=join(dir,'state.sqlite');
 let store=new ProblemStore(path),tools=new ToolRuntime(store,dir);
 const client={account:async()=>({connected:true}),answer:async()=>({reply:'Synthetic plan: read rules and schedule.',memories:[]})};
 let service=new Service(store,{chatgpt:client},{tools});
 await service.call('newJob');await service.call('modelReady');await service.call('describe',{text:'Synthetic research'});service.clarification.save([]);await service.call('research');
 const job=store.active().id,original=researchBlocked().message;
 const insert=(id,status,tool='browser.click',summary=original)=>store.db.prepare('INSERT INTO tool_actions VALUES(?,?,?,?,?,?,?,?)').run(id,job,'old-run',tool,JSON.stringify({page:'old-page',selector:'e12'}),status,summary,'2026-01-01T00:00:00Z');
 insert('legacy','blocked');insert('decline','declined');insert('unknown-write','uncertain');insert('interrupted-write','interrupted');insert('finished','completed');insert('api-block','blocked','api.request');insert('current-review','blocked','browser.click','review_required: Synthetic independent review refused.');insert('other-error','blocked','browser.click','Synthetic other failure');
 for(let i=0;i<35;i++)insert('later-'+i,'completed','browser.read','Synthetic read');
 store.add('source','Synthetic saved rules evidence.');service.execution.save({...partial.execution,reply:partial.reply});
 const before=store.db.prepare('SELECT * FROM tool_actions ORDER BY id').all(),sourceCount=store.snapshot().entries.length;
 service.stop();await tools.close();store.close();
 store=new ProblemStore(path);tools=new ToolRuntime(store,dir);let calls=0;
 client.answer=async()=>{calls++;return done;};client.runsTools=true;
 service=new Service(store,{chatgpt:client},{tools});
 t.after(async()=>{service.stop();await tools.close();store.close();rmSync(dir,{recursive:true,force:true});});
 assert.equal(calls,0,'restart must not run research');
 return {store,tools,service,client,job,before,sourceCount};
}
async function resumeGate(t,Service=ProblemService){
 const f=await restored(t,Service);let turns=0,reads=0;
 f.tools.execute=async action=>{reads++;return {tool:action.tool,result:{snapshot:reads===1?'Synthetic new status finding':'Synthetic complete schedule and rules'}};};
 f.client.answer=async(c,s,p,execute)=>{
  assert.equal(c.researchRecovery.resumed,true);
  assert.deepEqual(c.researchRecovery.legacyNavigationBlocks.map(a=>a.id),['legacy']);
  const request=hermesRequest(c);assert.match(request.instruction,/legacyNavigationBlocks/);assert.match(request.instruction,/fresh.*review/);assert.match(request.prompt,/requires_fresh_review/);
  if(++turns===1){await execute({tool:'browser.read',arguments:{page:'independent'}},s);return partial;}
  assert(c.browserContinuation);assert.match(c.browserContinuation.instruction,/saved plan/);
  await execute({tool:'browser.read',arguments:{page:'remaining'}},s);return done;
 };
 const result=await f.service.call('continuePlan');
 assert.equal(turns,2);assert.equal(reads,2);assert.equal(result.execution.status,'completed');
 assert.deepEqual(f.store.db.prepare('SELECT * FROM tool_actions ORDER BY id').all(),f.before,'historical action records must not be rewritten');
 assert(f.store.snapshot().entries.some(e=>e.text==='Synthetic saved rules evidence.'));
}
test('restart then resume revisits coverage after successful reads and carries legacy gate corrections',t=>resumeGate(t));
test('resume with no new evidence stops without claiming completion',async t=>{
 const f=await restored(t);let turns=0;f.client.answer=async()=>{turns++;return partial;};
 const result=await f.service.call('continuePlan');assert.equal(turns,2);assert.equal(result.execution.status,'blocked');
});
test('reconciliation is job-local, not a memory wipe or permission migration',async t=>{
 const f=await restored(t);await f.service.call('newJob');await f.service.call('modelReady');await f.service.call('describe',{text:'Another synthetic task'});f.service.clarification.save([]);
 f.client.runsTools=false;f.client.answer=async()=>({reply:'Synthetic plan.',memories:[]});await f.service.call('research');
 f.client.answer=async c=>{assert.deepEqual(c.researchRecovery.legacyNavigationBlocks,[]);assert.equal(c.researchRecovery.resumed,false);return done;};
 await f.service.call('acceptPlan');assert.deepEqual(f.store.db.prepare('SELECT * FROM tool_actions WHERE problem_id=? ORDER BY id').all(f.job),f.before);
});
test('Stop during resumed coverage review prevents further tools and completion',async t=>{
 const f=await restored(t);let turns=0;
 f.client.answer=async(c,s)=>{if(++turns===1)return partial;f.service.stop();s.throwIfAborted();return done;};
 await assert.rejects(f.service.call('continuePlan'));assert.equal(turns,2);assert.notEqual(f.service.execution.state()?.status,'completed');
});
async function mutant(t,file,before,after){
 const original=new URL('../server/focus/'+file,import.meta.url),dir=mkdtempSync(join(tmpdir(),'onejob-resume-mutant-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let source=readFileSync(original,'utf8');assert(source.includes(before));source=source.replace(before,after).replace(/from '(\.[^']+)'/gu,(_,relative)=>"from '"+new URL(relative,original).href+"'");
 const path=join(dir,'mutant.mjs');writeFileSync(path,source);return import(pathToFileURL(path));
}
test('mutation proof: the old fresh-error-only condition misses resumed jobs',async t=>{
 await resumeGate(t);
 const {ProblemService:Broken}=await mutant(t,'service.mjs',"if(execute&&result.execution?.status==='blocked'&&canContinue('browser',context.toolResults))","if(execute&&result.execution?.status==='blocked'&&context.toolResults.some(step=>step.blocked||step.recovered)&&canContinue('browser',context.toolResults))");
 await assert.rejects(resumeGate(t,Broken),assert.AssertionError);
});
test('mutation proofs: only exact old app blocks in this job receive fresh-review annotations',async t=>{
 for(const [before,after] of [["problem_id=? AND status='blocked'","? IS NOT NULL AND status='blocked'"],["AND status='blocked' AND summary=?","AND summary=?"],["AND summary=? AND tool IN","AND ? IS NOT NULL AND tool IN"],["tool IN ('browser.click','browser.fill','browser.press','browser.select','browser.hover','browser.scroll')","tool IS NOT NULL"]]){
  const f=await restored(t);await f.service.call('newJob');const other=f.store.active().id;
  f.store.db.prepare('INSERT INTO tool_actions VALUES(?,?,?,?,?,?,?,?)').run('other-job',other,'old-run','browser.click','{}','blocked',researchBlocked().message,'2026-01-01');
  await f.service.call('selectJob',{id:f.job});
  assert.deepEqual(f.tools.researchRecovery().legacyNavigationBlocks.map(a=>a.id),['legacy']);
  const {ToolRuntime:Broken}=await mutant(t,'tools/runtime.mjs',before,after);Object.setPrototypeOf(f.tools,Broken.prototype);
  assert.throws(()=>assert.deepEqual(f.tools.researchRecovery().legacyNavigationBlocks.map(a=>a.id),['legacy']),assert.AssertionError);
 }
});
test('coverage continuation follows multiple new findings but not duplicate reads',async t=>{
 for(const repeated of [false,true]){
  const f=await restored(t);let turns=0;
  f.tools.execute=async action=>({tool:action.tool,result:{snapshot:'Synthetic finding '+(repeated?'same':turns)}});
  f.client.answer=async(c,s,p,execute)=>{turns++;await execute({tool:'browser.read',arguments:{page:'synthetic'}},s);return turns===4?done:partial;};
  const result=await f.service.call('continuePlan');assert.equal(turns,repeated?2:4);assert.equal(result.execution.status,repeated?'blocked':'completed');
 }
});
test('reconciled historical attempts still need current independent review before dispatch',async t=>{
 const f=await restored(t),connection=f.tools.connections.save({kind:'aside',name:'Synthetic browser',browserAccessApproved:true});let writes=0;
 f.tools.aside.sessions.set(connection.id,{pages:new Map([['fresh',{problemId:f.job,url:'https://example.com/',snapshot:'- generic [ref=e2]:\n  - image "settings-icon"'}]]),client:{close:async()=>{}}});
 f.tools.aside.call=async()=>{writes++;return {};};
 const action={tool:'browser.click',arguments:{connection:connection.id,page:'fresh',selector:'e2'}},options={runId:'new-run',problemId:f.job,signal:new AbortController().signal,assertCurrent:()=>{},researchOnly:true};
 assert.equal(f.tools.researchRecovery().legacyNavigationBlocks.length,1);
 await assert.rejects(f.tools.execute(action,{...options,review:async()=>({decision:'review'})}),e=>e.diagnostic==='review_required');
 await assert.rejects(f.tools.execute(action,{...options,review:async()=>({decision:'navigation'})}),/Do not automatically retry/);
 assert.equal(writes,0);
});
