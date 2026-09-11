import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProblemStore} from '../server/focus/store.mjs';
import {ToolRuntime} from '../server/focus/tools/runtime.mjs';
import {handoffObservations,handoffAllowed} from '../server/focus/handoff.mjs';
import {continuationCheck} from '../server/focus/continuation.mjs';
import {validateExecution} from '../server/focus/execution.mjs';

function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'onejob-capability-')),store=new ProblemStore(join(dir,'test.sqlite'));store.create('Synthetic research');
 const tools=new ToolRuntime(store,dir),options={runId:'test',problemId:store.active().id,signal:new AbortController().signal,assertCurrent:()=>{},researchOnly:true};
 t.after(async()=>{await tools.close();store.close();rmSync(dir,{recursive:true,force:true});});return {store,tools,options};
}
test('older evidence remains searchable beyond the latest thousand sources',t=>{
 const {store}=fixture(t),id=store.add('source','INDIGO_OLD_RULE');
 store.db.prepare("UPDATE entries SET created='2000-01-01' WHERE id=?").run(id);
 for(let i=0;i<1001;i++)store.add('source','Synthetic later source '+i);
 assert.equal(store.retrieve('INDIGO_OLD_RULE')[0]?.id,id);
});
test('saved documents are searchable and readable after runtime restart',async t=>{
 const {store,tools,options}=fixture(t);
 const save=await tools.execute({tool:'document.save',arguments:{name:'rules.md',text:'INDIGO_DOCUMENT_RULE\n'+'Synthetic detail. '.repeat(1100)}},options);
 assert(store.retrieve('INDIGO_DOCUMENT_RULE').length);
 const restarted=new ToolRuntime(store,tools.directory);t.after(()=>restarted.close());
 let result=await restarted.execute({tool:'document.read',arguments:{artifact:save.result.artifact}},options),text=result.result.text;
 while(result.result.nextOffset!==null){result=await restarted.execute({tool:'document.read',arguments:{artifact:save.result.artifact,offset:result.result.nextOffset}},options);text+=result.result.text;}
 assert.equal(text,'INDIGO_DOCUMENT_RULE\n'+'Synthetic detail. '.repeat(1100));
 for(const offset of [-1,0.5,'1',text.length+1])assert.throws(()=>tools.validate({tool:'document.read',arguments:{artifact:save.result.artifact,offset}}),/offset/);
 store.archive();store.create('Different synthetic job');
 await assert.rejects(restarted.execute({tool:'document.read',arguments:{artifact:save.result.artifact}},{...options,problemId:store.active().id}),/job|document/i);
});
test('older successful document actions become readable without recreating files',async t=>{
 const {store,tools,options}=fixture(t),id='legacy-synthetic-document';
 store.db.prepare('INSERT INTO tool_actions VALUES (?,?,?,?,?,?,?,?)').run(id,store.active().id,'old-run','document.save',JSON.stringify({name:'legacy.md',text:'INDIGO_LEGACY_DOCUMENT'}),'completed','','2000-01-01');
 const restarted=new ToolRuntime(store,tools.directory);t.after(()=>restarted.close());
 assert(store.retrieve('INDIGO_LEGACY_DOCUMENT').length);
 assert.equal((await restarted.execute({tool:'document.read',arguments:{artifact:id}},options)).result.text,'INDIGO_LEGACY_DOCUMENT');
});
test('long research replies are retained rather than rejected by the old speech cap',t=>{
 const {store}=fixture(t),problem=store.active(),result={reply:'Synthetic research. '.repeat(3000),memories:[],execution:{status:'completed'}};
 assert.equal(validateExecution(result).reply,result.reply.trim());
 store.applyResult(problem.id,problem.revision,result,[]);
 assert.equal(store.snapshot().entries.at(-1).text,result.reply.trim());
});
test('handoff evidence retains every chunk of one snapshot, never an older snapshot',()=>{
 const chunk=(source_id,snapshotId,offset,snapshot)=>({source_id,tool:'browser.read',result:JSON.stringify({result:{page:'p',snapshotId,offset,snapshot}})});
 const a=chunk('a','same',0,'Use your security key to verify your identity.'),b=chunk('b','same',8000,'Synthetic footer.');
 const review={decision:'access_blocker',source_id:'a',quote:'Use your security key to verify your identity.'};
 assert(handoffAllowed(review,handoffObservations({toolResults:[a,b]})));
 assert(!handoffAllowed(review,handoffObservations({toolResults:[a,b,chunk('c','new',0,'Dashboard')]})));
 assert.equal(handoffObservations({toolResults:[a,b,{invalidate:'p'}]}).length,0);
});
test('continuations follow new evidence, not changing IDs or a fixed turn count',()=>{
 const check=continuationCheck(),steps=[];
 for(let i=0;i<5;i++){
  steps.push({tool:'browser.read',result:JSON.stringify({result:{snapshot:'Synthetic fact '+i}})});
  assert.equal(check('browser',steps),true);
 }
 steps.push({source_id:'new-id',tool:'browser.read',result:JSON.stringify({result:{snapshot:'Synthetic fact 4',snapshotId:'new'}})});
 assert.equal(check('browser',steps),false);
});
test('large escaped results are valid, fully readable JSON and remain job-owned',async t=>{
 const {store,tools,options}=fixture(t),outcome={tool:'public.search',result:{reply:'\u0001\\"'.repeat(9000)}};
 const first=JSON.parse(tools.serializeOutput(outcome));let page=first.result,text=page.text;
 const output=page.output;
 while(page.nextOffset!==null){page=(await tools.execute({tool:'tool.output',arguments:{output,offset:page.nextOffset}},options)).result;text+=page.text;}
 assert.deepEqual(JSON.parse(text),outcome);
 for(const offset of [-1,1.2,'1',text.length+1])assert.throws(()=>tools.validate({tool:'tool.output',arguments:{output,offset}}),/offset/);
 store.archive();store.create('Other synthetic job');
 assert.throws(()=>tools.validate({tool:'tool.output',arguments:{output,offset:0}}),/job/);
});
