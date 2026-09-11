import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inferenceProgress,toolProgress,webProgress} from '../server/focus/progress.mjs';

test('reasoning progress names the current task without claiming an account was read',()=>{
 assert.equal(inferenceProgress({phase:'execute',problem:{title:'Organize synthetic notes'}}),'Reviewing the plan for “Organize synthetic notes”…');
 assert.equal(inferenceProgress({phase:'research',problem:{title:'Paper layouts'}}),'Choosing sources for “Paper layouts”…');
 assert.equal(inferenceProgress({phase:'execute'},{tool:'browser.read',destination:'https://example.com/private?token=synthetic',status:'completed'}),'Reviewing the page from example.com…');
 assert.doesNotMatch(inferenceProgress({phase:'execute'},{tool:'browser.read',status:'uncertain'}),/Reviewing the page/);
});
test('tool progress names the approved destination without exposing URL credentials or query parameters',()=>{
 assert.equal(toolProgress('browser.open','https://example.com/items'),'Opening example.com…');
 assert.equal(toolProgress('browser.fill','https://example.com/form',{text:'SYNTHETIC_PRIVATE_INPUT'}),'Entering the approved text on example.com…');
 assert.equal(toolProgress('api.request','https://example.com/api',{method:'POST'}),'Running the approved POST request on example.com…');
 assert.equal(toolProgress('document.save','This Mac',{name:'synthetic.md'}),'Saving synthetic.md…');
 const line=toolProgress('browser.read','https://user:synthetic@example.com/private?token=synthetic');assert.equal(line,'Reading the page on example.com…');
 assert.equal(toolProgress('browser.open','invalid'),'Opening the approved page…');
});
test('public-search events include the actual query or page host, with bounded one-line labels',()=>{
 assert.equal(webProgress({type:'search',query:'synthetic paper shapes'}),'Searching the web for “synthetic paper shapes”…');
 assert.equal(webProgress({type:'search',query:'synthetic paper shapes'},true),'Reviewing search results for “synthetic paper shapes”…');
 assert.equal(webProgress({type:'openPage',url:'https://example.com/docs?private=synthetic'}),'Reading example.com…');
 assert.ok(webProgress({type:'search',query:'x'.repeat(1000)}).length<160);assert.doesNotMatch(webProgress({type:'search',query:'synthetic\nquery'}),/\n/);
});
