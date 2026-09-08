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
 setAttribute(key,value){this[key]=value;} showModal(){} close(){}
}
async function fixture(code=source,overrides={},accounts={chatgpt:{connected:false,checked:true},claude:{connected:false,checked:true}}){
 const elements=new Map(),posts=[];
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const document={getElementById:get,createElement:()=>new Element(),createTextNode:text=>({textContent:text}),querySelectorAll:()=>[],body:new Element()};
 const timers=new Map(),events={};let timerId=0;
 const window={addEventListener:(event,handler)=>events[event]=handler,webkit:{messageHandlers:{focus:{postMessage:m=>posts.push(m)}}}};
 vm.runInNewContext(code,{window,document,console,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),FormData:class{*[Symbol.iterator](){}}});
 const respond=async(result,id=posts.at(-1).id)=>{window.focusReceive({id,result});await new Promise(r=>setImmediate(r));};
 const state={problem:{id:'synthetic-a',title:'Painting',brief:{}},provider:'chatgpt',entries:[],archives:[],...overrides};
 await respond(state);await respond(accounts,posts.find(p=>p.method==='modelAccounts').id);return {get,posts,respond,state,window,timers,events};
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
 const first=f.get('composer').onsubmit({preventDefault(){}});
 if(f.posts.at(-1).method==='send')await f.respond({...f.state,entries:[]});
 await first;
 assert.equal(f.posts.at(-1).method,'stopListening','recording must stop before model dispatch');
 assert.ok(!f.posts.some(p=>p.method==='send'),'wait for the finished transcript before dispatch');
 f.window.focusReceive({event:'voice',listening:false,transcribing:true,message:'Transcribing'});
 await f.get('composer').onsubmit({preventDefault(){}});assert.ok(!f.posts.some(p=>p.method==='send'));
 f.window.focusReceive({event:'transcript',text:'Complete synthetic transcript.'});f.window.focusReceive({event:'voice',listening:false,message:'Ready'});
 const pending=f.get('composer').onsubmit({preventDefault(){}});assert.equal(f.posts.at(-1).method,'send');assert.equal(f.posts.at(-1).params.text,'Complete synthetic transcript.');
 await f.respond({...f.state,entries:[]});await pending;
}
test('sending finishes recording, waits for transcription, then requires review before dispatch',()=>voiceScenario(source));
test('mutation proof: removing microphone finish fails',async()=>{
 await assert.rejects(voiceScenario(source.replace("if(listening){transcribing=true;$('send').disabled=true;fire('stopListening');return;}",'')));
});

async function approvalScenario(code){
 const f=await fixture(code);const before=f.posts.length;
 f.window.focusReceive({event:'toolApproval',id:'synthetic-approval',tool:'api.request',connection:'Synthetic API',destination:'https://api.example.com/items',arguments:{body:'<img src=x onerror=alert(1)>'},notice:'Review the exact request.'});
 assert.equal(f.posts.length,before,'displaying a proposal must not approve it');
 assert.ok(f.get('tool-arguments').textContent.includes('<img src=x onerror=alert(1)>'));
 f.get('approve-tool').onclick();assert.deepEqual(JSON.parse(JSON.stringify(f.posts.at(-1).params)),{id:'synthetic-approval',approved:true});await f.respond({accepted:true});
 f.get('approve-tool').onclick();assert.equal(f.posts.length,before+1,'approval can be submitted only once');
}
test('tool approval displays inert text and requires one deliberate click',()=>approvalScenario(source));
test('mutation proof: automatic approval fails the UI approval test',async()=>{
 await assert.rejects(approvalScenario(source.replace("approvalId=message.id;", "approvalId=message.id;fire('approval',{id:message.id,approved:true});")),/must not approve/);
});

test('automatic folder needs no connection card; existing manual folders remain manageable',async()=>{
 const f=await fixture();f.get('source-text').value='Synthetic note';f.get('source-form').onsubmit({preventDefault(){},target:f.get('source-form')});
 await f.respond({...f.state,folders:[{id:'auto',label:'Job-synthetic-a'},{id:'manual',label:'Selected notes'}]});
 assert.equal(f.get('folders').children.length,1);assert.equal(f.get('folders').children[0].children[0].textContent,'Selected notes');
 f.get('open-workspace').onclick();assert.equal(f.posts.at(-1).method,'showWorkspace');
});

test('browser-first setup detects one profile without requesting per-service connections',async()=>{
 const f=await fixture();assert.equal(f.posts.at(-1).method,'setup');
 await f.respond({clients:{aside:true,asideApp:true,chatgpt:true},profiles:['u0'],services:[]});
 assert.equal(f.get('browser-profile-label').hidden,true);f.get('browser-consent').checked=true;
 const task=f.get('browser-form').onsubmit({preventDefault(){}});assert.equal(f.posts.at(-1).method,'aside.connect');assert.equal(f.posts.at(-1).params.profile,'u0');assert.equal(f.posts.at(-1).params.privacyConfirmed,true);
 await f.respond({});await f.respond({clients:{aside:true,asideApp:true},profiles:['u0'],services:[],asideConnection:'synthetic-browser'});await f.respond({...f.state,connections:[]});await task;
 assert.equal(f.get('browser-form').hidden,true);assert.ok(!f.posts.some(p=>p.method==='service.connect'));
});
test('onboarding continues with a verified connected model without reopening sign-in',async()=>{
 const accounts={chatgpt:{connected:true,checked:true},claude:{connected:false,checked:true}};
 const f=await fixture(source,{onboarding:{stage:'connect',draft:'',plan:''}},accounts);
 assert.equal(f.get('connect-step').hidden,false);assert.equal(f.get('compose-area').hidden,true);assert.equal(f.get('connect-model').textContent,'Continue');
 const pending=f.get('connect-model').onclick();assert.equal(f.posts.at(-1).method,'modelAccounts');await f.respond(accounts);
 assert.equal(f.posts.at(-1).method,'openJob');await f.respond(f.state);assert.equal(f.posts.at(-1).method,'provider');await f.respond(f.state);assert.equal(f.posts.at(-1).method,'modelReady');
 await f.respond({...f.state,onboarding:{stage:'problem',draft:'',plan:''}});await pending;
 assert.equal(f.get('connect-step').hidden,true);assert.equal(f.get('compose-area').hidden,false);assert.equal(f.get('send').firstChild.textContent,'Continue ');
 assert.equal(f.timers.size,0,'account polling ends after connection setup');assert.ok(!f.posts.some(p=>p.method==='login'||p.method==='claudeLogin'));
});
test('missing browser access is requested inside research without dispatching the model',async()=>{
 const f=await fixture(source,{onboarding:{stage:'problem',draft:'',plan:''}});f.get('message').value='A synthetic brain dump';
 await f.get('composer').onsubmit({preventDefault(){}});
 assert.equal(f.get('research-step').hidden,false);assert.equal(f.get('research-browser').hidden,false);
 assert.equal(f.get('compose-area').hidden,true);assert.ok(!f.posts.some(p=>p.method==='research'));
 const pending=f.get('skip-browser').onclick();assert.equal(f.posts.at(-1).method,'research');
 await f.respond({...f.state,onboarding:{stage:'plan',draft:'A synthetic brain dump',plan:'Synthetic preliminary plan'}});await pending;
 assert.equal(f.get('plan-step').hidden,false);assert.equal(f.get('plan-text').textContent,'Synthetic preliminary plan');assert.equal(f.get('research-browser').hidden,true);
});
test('dictation appends to typed words; a completed plan does not execute itself',async()=>{
 const f=await fixture(source,{onboarding:{stage:'problem',draft:'',plan:''}});f.get('message').value='Already typed.';f.get('mic').onclick();f.window.focusReceive({event:'transcript',text:'More spoken context.'});
 assert.equal(f.get('message').value,'Already typed. More spoken context.');assert.equal(f.posts.at(-1).method,'saveDraft');
 f.window.focusReceive({event:'jobSelected',state:{...f.state,onboarding:{stage:'plan',draft:'',plan:'<script>synthetic</script>'}}});
 assert.equal(f.get('plan-text').textContent,'<script>synthetic</script>');assert.ok(!f.posts.some(p=>p.method==='acceptPlan'));
 f.get('accept-plan').onclick();assert.equal(f.posts.at(-1).method,'acceptPlan');
});

test('opening goes straight to model connection without a redundant create page',async()=>{
 const f=await fixture(source,{onboarding:{stage:'connect',draft:'',plan:''}});
 assert.equal(f.posts[0].method,'openJob');assert.equal(f.get('connect-step').hidden,false);
 assert.equal(f.get('headline').textContent,'bring your own AI');
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/empty-step|Create a onejob|One problem\. A place to solve it/);
});

test('login completion checks the logo automatically, without advancing onboarding',async()=>{
 const f=await fixture(source,{onboarding:{stage:'connect',draft:'',plan:''}});
 assert.equal(f.get('chatgpt-connected').hidden,true);assert.equal(f.get('connect-model').textContent,'Sign in with ChatGPT');
 f.window.focusReceive({event:'accountChanged'});assert.equal(f.posts.at(-1).method,'modelAccounts');
 await f.respond({chatgpt:{connected:true,checked:true},claude:{connected:false,checked:true}});
 assert.equal(f.get('chatgpt-connected').hidden,false);assert.equal(f.get('claude-connected').hidden,true);assert.equal(f.get('connect-model').textContent,'Continue');
 assert.equal(f.get('connect-step').hidden,false);assert.ok(!f.posts.some(p=>p.method==='modelReady'));
});
test('a second account can sign in while the first remains connected; polling detects both',async()=>{
 const first={chatgpt:{connected:true,checked:true},claude:{connected:false,checked:true}};
 const both={chatgpt:{connected:true,checked:true},claude:{connected:true,checked:true}};
 const f=await fixture(source,{onboarding:{stage:'connect',draft:'',plan:''}},first);
 const login=f.get('choose-claude').onclick();await f.respond(first);assert.equal(f.posts.at(-1).method,'claudeLogin');
 assert.equal(f.get('chatgpt-connected').hidden,false);assert.equal(f.get('claude-connected').hidden,true);await f.respond({});await f.respond(first);await login;
 assert.equal(f.get('connect-model').textContent,'Continue');assert.equal(f.get('claude-connected').hidden,true,'opening sign-in is not proof of connection');
 const poll=[...f.timers.values()][0];poll();await f.respond(both);
 assert.equal(f.get('claude-connected').hidden,false);assert.equal(f.get('chatgpt-connected').hidden,false);
 const select=f.get('choose-claude').onclick();await f.respond(both);assert.equal(f.posts.at(-1).method,'provider');assert.equal(f.posts.at(-1).params.provider,'claude');await f.respond({...f.state,provider:'claude'});await select;
 assert.equal(f.get('choose-claude')['aria-pressed'],'true');assert.equal(f.get('connect-model').textContent,'Continue');
 assert.equal(f.posts.filter(p=>p.method==='claudeLogin').length,1);
});
test('a stale connection is rechecked on Continue and cannot advance after sign-out',async()=>{
 const f=await fixture(source,{onboarding:{stage:'connect',draft:'',plan:''}},{chatgpt:{connected:true,checked:true},claude:{connected:false,checked:true}});
 const task=f.get('connect-model').onclick();await f.respond({chatgpt:{connected:false,checked:true},claude:{connected:false,checked:true}});
 assert.equal(f.posts.at(-1).method,'login');assert.ok(!f.posts.some(p=>p.method==='modelReady'));
 await f.respond({url:'https://auth.openai.com/synthetic'});assert.equal(f.posts.at(-1).method,'openAuth');await f.respond({});await f.respond({chatgpt:{connected:false,checked:true},claude:{connected:false,checked:true}});await task;
 assert.equal(f.get('chatgpt-connected').hidden,true);
});
async function coalescedChecks(code){
 const f=await fixture(code,{onboarding:{stage:'connect',draft:'',plan:''}});
 const before=f.posts.filter(p=>p.method==='modelAccounts').length;
 f.events.focus();f.events.focus();f.window.focusReceive({event:'accountChanged'});
 assert.equal(f.posts.filter(p=>p.method==='modelAccounts').length,before+1,'overlapping status reads must share one request');
 await f.respond({chatgpt:{connected:true,checked:true},claude:{connected:false,checked:true}});
}
test('focus and login notifications share an in-flight account check',()=>coalescedChecks(source));
test('mutation proof: removing account-check coalescing fires the negative test',async()=>{
 await assert.rejects(coalescedChecks(source.replace('if(modelCheck)return modelCheck;','')),/overlapping status reads/);
});
test('Continue uses the available Claude account when ChatGPT cannot be checked',async()=>{
 const accounts={chatgpt:{connected:false,checked:false},claude:{connected:true,checked:true}};
 const f=await fixture(source,{onboarding:{stage:'connect',draft:'',plan:''}},accounts);
 assert.equal(f.get('connect-model').textContent,'Continue');assert.equal(f.get('choose-claude')['aria-pressed'],'true');
 const task=f.get('connect-model').onclick();await f.respond(accounts);await f.respond(f.state);
 assert.equal(f.posts.at(-1).method,'provider');assert.equal(f.posts.at(-1).params.provider,'claude');
 await f.respond({...f.state,provider:'claude'});assert.equal(f.posts.at(-1).method,'modelReady');await f.respond({...f.state,provider:'claude',onboarding:{stage:'problem',draft:'',plan:''}});await task;
 assert.ok(!f.posts.some(p=>p.method==='login'||p.method==='claudeLogin'));
});

async function emptyContinueScenario(code){
 const f=await fixture(code,{onboarding:{stage:'problem',draft:'',plan:''}});
 assert.equal(f.get('send').firstChild.textContent,'Continue ');
 assert.equal(f.get('send').disabled,true,'empty problem must disable Continue');
 f.get('message').value='   \n  ';f.get('message').oninput();
 assert.equal(f.get('send').disabled,true,'whitespace must not enable Continue');
 await f.get('composer').onsubmit({preventDefault(){}});
 assert.ok(!f.posts.some(p=>p.method==='research'||p.method==='send'));
 f.get('message').value='A synthetic problem';f.get('message').oninput();assert.equal(f.get('send').disabled,false);
 f.get('message').value='';f.get('message').oninput();assert.equal(f.get('send').disabled,true);
 f.window.focusReceive({event:'voice',listening:true,message:'Listening'});assert.equal(f.get('send').disabled,true);
 f.window.focusReceive({event:'voice',listening:false,transcribing:true,message:'Transcribing'});
 f.window.focusReceive({event:'transcript',text:'A dictated synthetic problem'});assert.equal(f.get('send').disabled,true,'transcription must finish before continuing');
 f.window.focusReceive({event:'voice',listening:false,message:'Ready'});assert.equal(f.get('send').disabled,false);assert.equal(f.get('send').firstChild.textContent,'Continue ');
}
test('Continue requires typed or completed dictated input, including after clearing the field',()=>emptyContinueScenario(source));
test('mutation proof: removing the empty-input check enables Continue too early',async()=>{
 const check="||!$('message').value.trim()";assert.ok(source.includes(check));
 await assert.rejects(emptyContinueScenario(source.replace(check,'')),/empty problem must disable Continue/);
});
test('a restored problem draft enables Continue immediately',async()=>{
 const f=await fixture(source,{onboarding:{stage:'problem',draft:'A saved synthetic problem',plan:''}});
 assert.equal(f.get('send').disabled,false);assert.equal(f.get('send').firstChild.textContent,'Continue ');
});
