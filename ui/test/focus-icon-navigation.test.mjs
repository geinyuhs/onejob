import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProblemStore} from '../server/focus/store.mjs';
import {ToolRuntime} from '../server/focus/tools/runtime.mjs';
import {navigationTarget,navigationEvidence} from '../server/focus/tools/auto.mjs';

const tree='- main:\n  - heading [level=1]:\n    - text: "Synthetic league"\n  - generic [ref=e12]:\n    - image "settings-icon"\n  - generic "MATCHUP" [ref=e13]';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'onejob-icon-')),store=new ProblemStore(join(dir,'store.sqlite'));store.create('Synthetic research');
 const events=[],tools=new ToolRuntime(store,dir,{emit:e=>events.push(e)}),connection=tools.connections.save({kind:'aside',name:'Synthetic browser',browserAccessApproved:true});
 const page={problemId:store.active().id,url:'https://example.com/',snapshot:tree,snapshotText:tree};let calls=0;
 tools.aside.sessions.set(connection.id,{pages:new Map([['page',page]]),client:{close:async()=>{}}});
 tools.aside.call=async()=>{calls++;return {snapshot:'Synthetic settings'};};
 const options={runId:'synthetic',problemId:store.active().id,signal:new AbortController().signal,assertCurrent:()=>{},researchOnly:true};
 const action={tool:'browser.click',arguments:{connection:connection.id,page:'page',selector:'e12'}};
 t.after(async()=>{await tools.close();store.close();rmSync(dir,{recursive:true,force:true});});return {store,tools,events,page,options,action,calls:()=>calls};
}
test('an icon-only generic target reaches review with its image and ancestor context',async t=>{
 const f=fixture(t);let reviews=0;
 const target=navigationTarget({name:'browser.click',args:{selector:'e12'},snapshot:tree});assert(target);assert.equal(target.role,'generic');
 await f.tools.execute(f.action,{...f.options,review:async detail=>{reviews++;assert.match(detail.targetContext,/settings-icon/);assert.match(detail.targetContext,/- main:/);assert.equal(detail.page,tree);return {decision:'navigation'};}});
 assert.equal(reviews,1);assert.equal(f.calls(),1);assert.equal(f.events.some(e=>e.event==='toolApproval'),false);
});
test('missing targets report unresolved controls, not forbidden changes or user declines',async t=>{
 const f=fixture(t);f.action.arguments.selector='e999';
 await assert.rejects(f.tools.execute(f.action,{...f.options,review:()=>assert.fail('missing target must not dispatch review')}),error=>{
  assert.equal(error.diagnostic,'target_unresolved');assert.equal(error.actionState,'not_performed');assert.match(error.message,/could not identify/);assert.doesNotMatch(error.message,/approval of this change/);return true;
 });
 assert.equal(f.tools.snapshot().actions[0].status,'not_performed');assert.equal(f.calls(),0);
});
test('icon controls never dispatch on failed, malformed, uncertain, or non-navigation review',async t=>{
 for(const [review,diagnostic] of [[async()=>{throw new Error('Synthetic outage');},'review_unavailable'],[async()=>({decision:'navigation',extra:true}),'review_invalid'],[async()=>({decision:'review'}),'review_required'],[async()=>({decision:'scoped'}),'review_required']]){
  const f=fixture(t);await assert.rejects(f.tools.execute(f.action,{...f.options,review}),error=>{assert.equal(error.diagnostic,diagnostic);return true;});assert.equal(f.calls(),0);assert.equal(f.events.some(e=>e.event==='toolApproval'),false);
 }
});
test('unnamed controls preserve exact references, roles and their complete descendants',()=>{
 for(const role of ['generic','button','link','menuitem'])assert(navigationTarget({name:'browser.click',args:{selector:'e12'},snapshot:tree.replace('generic [ref=e12]',role+' [ref=e12]')}));
 for(const selector of ['e1','e123','button'])assert.equal(navigationTarget({name:'browser.click',args:{selector},snapshot:tree}),null);
 assert.equal(navigationTarget({name:'browser.fill',args:{selector:'e12'},snapshot:tree}),null);
 assert.notEqual(navigationEvidence(tree,'e12'),navigationEvidence(tree.replace('settings-icon','delete-icon'),'e12'));
});
