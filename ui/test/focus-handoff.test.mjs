import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {handoffObservations,handoffAllowed} from '../server/focus/handoff.mjs';

const context={toolResults:[
 {tool:'browser.click',error:'Navigation failed'},
 {tool:'browser.read',source_id:'fresh',result:JSON.stringify({destination:'https://example.com',result:{page:'page',snapshot:'Verify your identity using your security key.'}})}
]};
test('a handoff needs a current read with an exact supporting quote, not a failed click',()=>{
 const observations=handoffObservations(context);
 assert.equal(observations.length,1);
 assert.equal(handoffAllowed({decision:'access_blocker',source_id:'fresh',quote:'Verify your identity using your security key.'},observations),true);
 for(const review of [null,{}, {decision:'ask'}, {decision:'access_blocker',source_id:'old',quote:'Verify your identity using your security key.'},{decision:'access_blocker',source_id:'fresh',quote:'Login unavailable'},{decision:'access_blocker',source_id:'fresh',quote:''},{decision:'access_blocker',source_id:'fresh',quote:'Verify',extra:true}])
  assert.equal(handoffAllowed(review,observations),false);
 assert.equal(handoffAllowed({decision:'user_decision'},observations),true);
 assert.equal(handoffAllowed({decision:'retrieve'},observations),false);
});
test('old reads of the same page cannot justify a new access question',()=>{
 const observations=handoffObservations({toolResults:[...context.toolResults,{tool:'browser.read',source_id:'newer',result:JSON.stringify({destination:'https://example.com/home',result:{page:'page',snapshot:'Dashboard available'}})}]});
 assert.equal(handoffAllowed({decision:'access_blocker',source_id:'fresh',quote:'Verify your identity using your security key.'},observations),false);
});
test('a changed or uncertain page requires a fresh read before a handoff',()=>{
 assert.equal(handoffObservations({toolResults:[...context.toolResults,{invalidate:'page'}]}).length,0);
});
test('mutation proof: fabricated source IDs and quotes fail the evidence boundary',()=>{
 const review={decision:'access_blocker',source_id:'fresh',quote:'Invented inaccessible account'};
 assert.equal(handoffAllowed(review,handoffObservations(context)),false);
 const broken=vm.runInNewContext('('+handoffAllowed.toString().replace('item.content.includes(review.quote)','true')+')');
 assert.equal(broken(review,handoffObservations(context)),true);
 const wrongSource={...review,source_id:'other-job',quote:'Verify your identity using your security key.'};
 const wrong=vm.runInNewContext('('+handoffAllowed.toString().replace('item.source_id===review.source_id','true')+')');
 assert.equal(handoffAllowed(wrongSource,handoffObservations(context)),false);
 assert.equal(wrong(wrongSource,handoffObservations(context)),true);
});
