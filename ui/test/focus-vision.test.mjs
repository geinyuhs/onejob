import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {collectTextNodes,concealFields,revealFields} from '../server/focus/tools/vision.mjs';
import {AsideAdapter} from '../server/focus/tools/adapters.mjs';

function masking(hide=concealFields){
 const element=()=>{const values=new Map();return {style:{getPropertyValue:k=>values.get(k)?.value||'',getPropertyPriority:k=>values.get(k)?.priority||'',setProperty:(k,value,priority)=>values.set(k,{value,priority}),removeProperty:k=>values.delete(k)}};};
 const input=element(),privateText=element(),publicText=element(),window={};
 const nodes=[{textContent:'SYNTHETIC_SECRET',parentElement:privateText},{textContent:'Ordinary text',parentElement:publicText}];let index=-1;
 const context=vm.createContext({window,document:{body:{},querySelectorAll:()=>[input],createTreeWalker:()=>({nextNode:()=>++index<nodes.length,get currentNode(){return nodes[index];}})}});
 const texts=vm.runInContext(`(${collectTextNodes.toString()})('synthetic')`,context);
 assert.deepEqual([...texts],['SYNTHETIC_SECRET','Ordinary text']);
 vm.runInContext(`(${hide.toString()})({key:'synthetic',matches:[0]})`,context);
 assert.equal(input.style.getPropertyValue('visibility'),'hidden');assert.equal(privateText.style.getPropertyValue('visibility'),'hidden');assert.equal(publicText.style.getPropertyValue('visibility'),'');
 vm.runInContext(`(${revealFields.toString()})('synthetic')`,context);
 assert.equal(input.style.getPropertyValue('visibility'),'');assert.equal(privateText.style.getPropertyValue('visibility'),'');assert.deepEqual(window,{});
}
test('visual input conceals fields and known credential text, then restores styles',()=>masking());
test('mutation proof: image masking is exercised, not just documented',()=>{
 const source=concealFields.toString();
 for(const [before,after] of [["new Set(document.querySelectorAll('input,textarea,[contenteditable],iframe'))",'new Set()'],['for(const index of matches)','for(const index of [])']]){
  assert(source.includes(before));assert.throws(()=>masking(new Function('return '+source.replace(before,after))()));
 }
});
test('visual input refuses other jobs and restores masking after capture failure',async()=>{
 const adapter=new AsideAdapter('synthetic'),signal=new AbortController().signal;
 let restored=false,captures=0;
 const page={url:()=> 'https://example.com/',evaluate:async(fn,args)=>{if(fn.name==='revealFields')restored=true;return fn.name==='collectTextNodes'?[]:undefined;},screenshot:async()=>{captures++;throw new Error('Synthetic screenshot failure');}};
 const context=vm.createContext({tab:page,display:()=>{}});
 adapter.sessions.set('c',{pages:new Map([['p',{variable:'tab',url:page.url(),problemId:'a'}]]),client:{callTool:async request=>{try{await vm.runInContext('(async()=>{'+request.arguments.code+'})()',context,{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});return {};}catch(error){return {isError:true};}}}});
 await assert.rejects(adapter.view({id:'c'},{page:'p',problemId:'b'},signal),/job/);assert.equal(captures,0);
 await assert.rejects(adapter.view({id:'c'},{page:'p',problemId:'a'},signal),/captured/);assert.equal(captures,1);assert.equal(restored,true);
 const code=readFileSync(new URL('../server/focus/tools/adapters.mjs',import.meta.url),'utf8');
 assert(!code.includes("secrets:${JSON.stringify([...session.secrets])}"),'secret values never enter generated tool arguments');
});
test('credential text never enters webpage evaluation arguments during image masking',async()=>{
 const adapter=new AsideAdapter('synthetic'),secret='SYNTHETIC_PRIVATE_CANARY',signal=new AbortController().signal;
 let exposed=false;
 const page={url:()=> 'https://example.com/',evaluate:async(fn,args)=>{if(JSON.stringify(args).includes(secret))exposed=true;return fn.name==='collectTextNodes'?['Ordinary text',secret]:undefined;},screenshot:async()=>Buffer.from([137,80,78,71,13,10,26,10])};
 const context=vm.createContext({tab:page,fs:{writeFile},console:{log:()=>{}},display:()=>{}});
 adapter.credentialDirectory=async()=>tmpdir();
 adapter.credentialMasks.remember('c','a',page.url(),secret);
 adapter.sessions.set('c',{pages:new Map([['p',{variable:'tab',url:page.url(),problemId:'a'}]]),client:{callTool:async request=>{
  assert(!JSON.stringify(request).includes(secret));await vm.runInContext('(async()=>{'+request.arguments.code+'})()',context,{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
  return {content:request.arguments.title==='onejob: prepare private page masking'?[{type:'text',text:'ONEJOB_MASK_TEXT_READY'}]:[{type:'image',mimeType:'image/png',data:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')}]};
 }}});
 await adapter.view({id:'c'},{page:'p',problemId:'a'},signal);assert.equal(exposed,false,'Known credentials must stay in the local executor, not enter page JavaScript');
});
