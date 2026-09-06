import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../focus/ui/focus.js',import.meta.url),'utf8');
class Element {
 constructor(){this.children=[];this.value='';this.dataset={};this.classList={toggle(){}};this.firstChild={textContent:''};this.elements={namedItem:()=>new Element()};this.resets=0;}
 set innerHTML(value){throw new Error('Untrusted content reached HTML parsing');}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=items;}
 querySelector(){return this.child??=new Element();}
 reset(){this.resets++;this.value='';}
 setAttribute(){} showModal(){} close(){}
}
async function fixture(code=source){
 const elements=new Map(),posts=[];
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const document={getElementById:get,createElement:()=>new Element(),createTextNode:text=>({textContent:text}),querySelectorAll:()=>[],body:new Element()};
 const window={webkit:{messageHandlers:{focus:{postMessage:m=>posts.push(m)}}}};
 vm.runInNewContext(code,{window,document,console,FormData:class{*[Symbol.iterator](){}}});
 const respond=async(result,id=posts.at(-1).id)=>{window.focusReceive({id,result});await new Promise(r=>setImmediate(r));};
 const state={problem:{id:'synthetic-a',title:'Painting',brief:{}},provider:'chatgpt',entries:[],archives:[]};
 await respond(state);return {get,posts,respond,state,window};
}
async function archiveScenario(code){
 const f=await fixture(code);f.get('search').value='painting';f.get('search-form').onsubmit({preventDefault(){}});
 await f.respond([{title:'Synthetic',kind:'source',text:'<img src=x onerror=alert(1)>',matched:['painting']}]);
 assert.equal(f.get('matches').children.length,1);
 assert.equal(f.get('matches').children[0].children[1].textContent,'<img src=x onerror=alert(1)>');
 const resets=f.get('source-form').resets;f.get('confirm-archive').onclick();await f.respond({...f.state,problem:null});
 assert.equal(f.get('matches').children.length,0,'old problem search results must disappear');
 assert.equal(f.get('source-form').resets,resets+1,'unsaved source context must not leak into the next problem');
}
test('problem changes clear old retrieval; source markup stays inert text',()=>archiveScenario(source));
test('mutation proof: removing cross-problem UI cleanup fails',async()=>{
 await assert.rejects(archiveScenario(source.replace("if(changed){$('matches').replaceChildren();$('search-form').reset();$('source-form').reset();}",'')),/old problem search results/);
});
async function voiceScenario(code){
 const f=await fixture(code);f.window.focusReceive({event:'voice',listening:true,message:'Synthetic listening event'});f.get('message').value='A synthetic user message';
 const pending=f.get('composer').onsubmit({preventDefault(){}});
 const methods=f.posts.map(p=>p.method);
 assert.ok(methods.indexOf('stopListening')>0 && methods.indexOf('stopListening')<methods.indexOf('send'),'recording must stop before model dispatch');
 await f.respond({...f.state,entries:[]});await pending;
}
test('sending stops voice recording before model dispatch',()=>voiceScenario(source));
test('mutation proof: removing microphone stop fails',async()=>{
 await assert.rejects(voiceScenario(source.replace("if(listening)fire('stopListening');",'')),/recording must stop/);
});
