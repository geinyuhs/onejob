import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../focus/ui/focus.js',import.meta.url),'utf8');
const asideSetup={clients:{aside:true,asideApp:true},profiles:['u0'],services:[]};
const confirmationState={onboarding:{stage:'needsInput',plan:'Synthetic plan'},execution:{status:'needs_input',responseType:'confirmation',question:'Should I use the other page?',reply:'Hidden explanation'}};
test('completed research shows an empty scheduled-actions section, not an active schedule',async()=>{
 const f=await fixture(source,{onboarding:{stage:'results'},execution:{researchOnly:true,status:'completed',reply:'Synthetic context',scheduledActions:[{task:'Untrusted schedule'}]}});
 assert.equal(f.get('headline').textContent,'Research complete.');assert.equal(f.get('scheduled-actions-section').hidden,false);
 assert.equal(f.get('scheduled-actions').textContent,'');
 const pending=await fixture(source,{onboarding:{stage:'results'},execution:{researchOnly:true,status:'blocked',reply:'Synthetic missing context'}});
 assert.equal(pending.get('scheduled-actions-section').hidden,true);assert.equal(pending.get('headline').textContent,'Research incomplete.');
});
test('incomplete results have an explicit Continue button and Auto below it',async()=>{
 const f=await fixture(source,{onboarding:{stage:'results',plan:'Synthetic plan'},execution:{status:'blocked',reply:'Synthetic partial result.'}});
 assert.equal(f.get('resume-results').hidden,false);
 assert.ok(f.get('results-auto-slot').children.includes(f.get('auto-mode-control')));
 assert.ok(!f.posts.some(p=>p.method==='continuePlan'));
 f.get('resume-results').onclick();assert.equal(f.posts.at(-1).method,'continuePlan');
 const done=await fixture(source,{onboarding:{stage:'results'},execution:{status:'completed',reply:'Synthetic result.'}});
 assert.equal(done.get('resume-results').hidden,true);
});
async function resumeAfterResult(code=source){
 const f=await fixture(code,{onboarding:{stage:'results',plan:'Synthetic plan'},execution:{status:'blocked',reply:'Synthetic partial result.'}});
 const run=f.get('resume-results').onclick();assert.equal(f.get('resume-results').disabled,true);
 await f.respond({...f.state,onboarding:{stage:'results',plan:'Synthetic plan'},execution:{status:'blocked',reply:'Synthetic remaining gap.'}});await run;
 assert.equal(f.get('resume-results').disabled,false,'Continue must re-enable after the running state clears');
 f.window.focusReceive({event:'voice',listening:true});assert.equal(f.get('resume-results').disabled,true);
 f.window.focusReceive({event:'voice',listening:false,transcribing:false});assert.equal(f.get('resume-results').disabled,false);
}
test('Continue re-enables after a result without restarting the app',()=>resumeAfterResult());
test('mutation proof: results Continue participates in busy and voice state updates',async()=>{
 const before="'resume-plan','resume-results','execution-yes'";assert(source.includes(before));
 await assert.rejects(resumeAfterResult(source.replace(before,"'resume-plan','execution-yes'")),/Continue must re-enable/);
});
test('blocked Auto work displays results without a question or answer box',async()=>{
 const f=await fixture(source,{autoMode:true,onboarding:{stage:'results'},execution:{status:'blocked',reply:'Synthetic result; one step is unavailable.',question:''}});
 assert.equal(f.get('headline').textContent,'Some work is blocked.');
 assert.equal(f.get('execution-text').textContent,'Synthetic result; one step is unavailable.');
 assert.equal(f.get('compose-area').hidden,true);assert.equal(f.get('execution-choices').hidden,true);
});
test('website login configuration is reachable while a job is paused and sends references only',async()=>{
 const f=await fixture(source,{onboarding:{stage:'executionPaused'}});
 f.get('settings').onclick();f.get('manage-tools').onclick();
 assert.equal(f.get('tools-pane').hidden,false);
 f.get('connection-kind').value='login';f.get('connection-kind').onchange();assert.equal(f.get('service-fields').hidden,false);
 f.get('connection-name').value='Synthetic login';f.get('connection-url').value='https://example.com';f.get('credential-account').value='Synthetic';f.get('credential-reference').value='op://test/item/password';f.get('username-reference').value='op://test/item/username';
 const run=f.get('connection-form').onsubmit({preventDefault(){}}),request=f.posts.at(-1);
 assert.equal(request.method,'connection.add');assert.equal(request.params.kind,'login');assert.equal(request.params.usernameRef,'op://test/item/username');
 await f.respond(f.state,request.id);await run;
});
test('thinking picker uses reported modes, persists the selected effort and restores on error',async()=>{
 const f=await fixture();let prevented=false;f.events.keydown({metaKey:true,key:',',preventDefault:()=>prevented=true});assert.equal(prevented,true);
 const request=f.posts.findLast(post=>post.method==='thinkingModes');assert.ok(request);
 await f.respond({model:'gpt-6-astra',defaultEffort:'medium',options:[{reasoningEffort:'high',description:'Deep thinking'},{reasoningEffort:'low',description:'Light thinking'}]},request.id);
 const select=f.get('thinking-mode');assert.deepEqual(select.children.map(option=>option.value),['','high','low']);
 select.value='high';const pending=select.onchange();const save=f.posts.at(-1);assert.equal(save.method,'reasoningEffort');assert.equal(save.params.effort,'high');
 await f.respond({...f.state,reasoningEffort:'high'},save.id);await pending;
 select.value='low';const failed=select.onchange();f.window.focusReceive({id:f.posts.at(-1).id,error:'Synthetic unavailable mode'});await failed;
 assert.equal(select.value,'high');
});
test('credential approval names 1Password and does not repeat it on the next browser action',async()=>{
 const f=await fixture();
 f.window.focusReceive({...permission,tool:'api.request',usesOnePassword:true,destination:'https://api.example.com/items'});
 assert.equal(f.get('tool-question').textContent,'Can I use 1Password and perform this action?');
 assert.equal(f.get('tool-description').textContent,'https://api.example.com/items');
 f.window.focusReceive({...permission,usesOnePassword:false});
 assert.doesNotMatch(f.get('tool-question').textContent,/1Password/);
});
async function screenshotUI(code=source){
 const f=await fixture(code),data='data:image/png;base64,aW1hZ2U=';
 f.window.focusReceive({...permission,screenshot:data});
 assert.equal(f.get('tool-screenshot').src,data);assert.equal(f.get('tool-screenshot').hidden,false);
 for(const invalid of ['https://example.com/image.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,'+'A'.repeat(2000030)]){
  f.window.focusReceive({...permission,screenshot:invalid});assert.equal(f.get('tool-screenshot').hidden,true,'invalid images stay hidden');assert.equal(f.get('tool-screenshot').src,'');
 }
 f.window.focusReceive({...permission,screenshot:data});
 f.window.focusReceive({...permission,id:'next-action'});assert.equal(f.get('tool-screenshot').src,'');
 f.window.focusReceive({...permission,screenshot:data});f.get('tool-screenshot').onerror();assert.equal(f.get('tool-screenshot').hidden,true);
 f.window.focusReceive({...permission,screenshot:data});f.window.focusReceive({event:'toolProgress',id:permission.id,status:'completed'});assert.equal(f.get('tool-screenshot').src,'');
}
test('approval screenshot displays safely and clears between actions',()=>screenshotUI());
test('mutation proof: screenshot URL and size validation fires',async()=>{
 await assert.rejects(screenshotUI(source.replace("value.length<=2000030","true")),/invalid images stay hidden/);
 await assert.rejects(screenshotUI(source.replace("image.hidden=!safe;image.src=safe?value:'';","image.hidden=false;image.src=value;")),/invalid images stay hidden/);
});
test('the intake orb is 30% smaller without resizing the desktop orbs',()=>{
 const css=readFileSync(new URL('../focus/ui/focus.css',import.meta.url),'utf8');
 const rule=css.match(/\.f-problem-orb \.orb\{([^}]+)\}/)?.[1];
 assert.ok(rule);assert.match(rule,/width:42px;height:42px;/);
 assert.equal(Number(rule.match(/scale:([\d.]+)/)?.[1]),Number((2.75*.7).toFixed(3)));
});
test('composers start at two lines, plan editors fit their text, and Stop stays centered',()=>{
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8'),css=readFileSync(new URL('../focus/ui/focus.css',import.meta.url),'utf8');
 assert.doesNotMatch(html,/Results go to your chosen AI|id="tool-details"|id="tool-notice"/);
 assert.match(css,/#stop-tool-run\{display:block;margin:16px auto 0\}/);
 for(const textarea of html.match(/<textarea\b[^>]*>/g))assert.match(textarea,/f-plan-editor/.test(textarea)?/rows="1"/:/rows="2"/);
 assert.match(css,/\.f-composer \.f-answer-field textarea\{[^}]*height:3\.1em;min-height:3\.1em;max-height:3\.1em;resize:none/);
 assert.match(css,/\.f-composer \.f-answer-field textarea\{[^}]*font-size:18\.2px;/,'answer text is 30% larger than the original 14px');
});
async function specificToolStatus(code=source){const f=await fixture(code,{onboarding:{stage:'executing'}});f.window.focusReceive({event:'toolProgress',id:'synthetic',tool:'browser.open',status:'running',message:'Opening example.com…'});assert.equal(f.get('headline').textContent,'Opening example.com…','specific destination must reach the headline');}
test('actual tool destinations replace generic progress',()=>specificToolStatus());
test('mutation proof: specific tool progress is not discarded',async()=>{await assert.rejects(specificToolStatus(source.replace('if(message.message)return message.message;','')),/specific destination/);});
async function visibleActionData(code=source){const f=await fixture(code);f.window.focusReceive({...permission,tool:'browser.fill',arguments:{selector:'e4',text:'<b>Synthetic text</b>'},preview:'e4 Text field'});assert.equal(f.get('tool-arguments').hidden,false,'text to be sent must remain visible');assert.ok(f.get('tool-arguments').textContent.includes('<b>Synthetic text</b>'));assert.ok(f.get('tool-arguments').textContent.includes('e4 Text field'));}
test('removing Details does not conceal text that an action will send',()=>visibleActionData());
test('mutation proof: writable action content cannot be omitted from review',async()=>{await assert.rejects(visibleActionData(source.replace("['browser.open','browser.read','mcp.tools']","['browser.open','browser.read','mcp.tools','browser.fill']")),/text to be sent/);});
test('confirmation heading and choices are centered as one full-window group',()=>{
 const css=readFileSync(new URL('../focus/ui/focus.css',import.meta.url),'utf8');
 const scope='body[data-step="needsInput"][data-response-type="confirmation"]';
 for(const rule of ['.f-layout{min-height:100vh}','.f-conversation{min-height:100vh;justify-content:center;padding:40px 30px}','.f-hero{margin:0 0 26px}','h1{margin:0;text-align:center}','#execution-choices{margin:0;justify-content:center}'])assert.ok(css.includes(scope+' '+rule),rule);
});
test('confirmation questions offer Yes or No with no paragraph or empty box',async()=>{
 const f=await fixture(source,structuredClone(confirmationState));assert.equal(f.get('execution-choices').hidden,false);assert.equal(f.get('compose-area').hidden,true);assert.equal(f.get('execution-result').hidden,true);assert.equal(f.get('execution-text').textContent,'');
 const run=f.get('execution-yes').onclick(),request=f.posts.at(-1);assert.equal(request.method,'continuePlan');assert.equal(request.params.text,'Yes.');assert.ok(!f.posts.some(p=>p.method==='approval'));
 await f.respond({...f.state,onboarding:{stage:'results'},execution:{status:'completed',reply:'Synthetic result'}},request.id);await run;
});
test('No reveals required directions and submits them as No, not approval',async()=>{
 const f=await fixture(source,structuredClone(confirmationState));const count=f.posts.length;f.get('execution-no').onclick();assert.equal(f.posts.length,count);assert.equal(f.get('compose-area').hidden,false);assert.equal(f.get('message').placeholder,'What should I do differently?');assert.equal(f.get('send').disabled,true);
 await f.get('composer').onsubmit({preventDefault(){}});assert.ok(!f.posts.some(p=>p.method==='continuePlan'));
 f.get('message').value='Use the synthetic archive instead.';f.get('message').oninput();const run=f.get('composer').onsubmit({preventDefault(){}}),request=f.posts.at(-1);assert.equal(request.params.text,'No. Use the synthetic archive instead.');
 await f.respond({...f.state,onboarding:{stage:'needsInput'},execution:{status:'needs_input',responseType:'confirmation',question:'Should I use the summary?'}},request.id);await run;assert.equal(f.get('compose-area').hidden,true);assert.equal(f.get('execution-no')['aria-pressed'],'false');
});
test('failed No submission keeps the directions visible for retry',async()=>{
 const f=await fixture(source,structuredClone(confirmationState));f.get('execution-no').onclick();f.get('message').value='Use another synthetic page.';
 const run=f.get('composer').onsubmit({preventDefault(){}});f.window.focusReceive({id:f.posts.at(-1).id,error:'Synthetic offline'});await new Promise(setImmediate);await f.respond({...f.state,...structuredClone(confirmationState)});await run;
 assert.equal(f.get('compose-area').hidden,false);assert.equal(f.get('message').value,'Use another synthetic page.');assert.equal(f.get('send').disabled,false);
});
async function confirmationGate(code=source){
 const f=await fixture(code,structuredClone(confirmationState));f.window.focusReceive({event:'voice',listening:true});const count=f.posts.length;f.get('execution-yes').onclick();f.get('execution-no').onclick();assert.equal(f.posts.length,count);assert.equal(f.get('execution-no')['aria-pressed'],'false','confirmation choices wait for dictation');
}
test('confirmation choices wait for dictation',()=>confirmationGate());
test('mutation proof: confirmation input guard fires',async()=>{await assert.rejects(confirmationGate(source.replaceAll('if(!confirmationQuestion()||busy||listening||transcribing)return;','')),/choices wait/);});
test('live work status and Stop stay centered as progress changes',async()=>{
 const css=readFileSync(new URL('../focus/ui/focus.css',import.meta.url),'utf8');
 assert.match(css,/body\[data-step="executing"\] \.f-layout\{min-height:100vh\}/);
 assert.match(css,/body\[data-step="executing"\] \.f-conversation\{min-height:100vh;justify-content:center;padding:40px 30px\}/);
 assert.match(css,/body\[data-step="executing"\] \.f-hero\{margin:0 0 26px\}/);
 assert.match(css,/body\[data-step="executing"\] #execution-stop\{margin:0\}/);
 const f=await fixture(source,{onboarding:{stage:'executing',plan:'Synthetic plan'}});
 for(const message of ['Working on your problem…','Reading the requested page…']){f.window.focusReceive({event:'runProgress',message});assert.equal(f.get('headline').textContent,message);assert.equal(f.get('executing-step').hidden,false);}
 f.get('execution-stop').onclick();assert.equal(f.posts.at(-1).method,'stop');
});
test('paused heading and Continue form a centered group in the full window',async()=>{
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8');
 assert.match(html,/<section id="executionPaused-step"[^>]*><button id="resume-plan"[^>]*>continue<\/button><div id="paused-auto-slot"><\/div><\/section>/);
 const css=readFileSync(new URL('../focus/ui/focus.css',import.meta.url),'utf8');
 assert.match(css,/body\[data-step="executionPaused"\] \.f-layout\{min-height:100vh\}/);
 assert.match(css,/body\[data-step="executionPaused"\] \.f-conversation\{min-height:100vh;justify-content:center;padding:40px 30px\}/);
 assert.match(css,/body\[data-step="executionPaused"\] \.f-hero\{margin:0 0 26px\}/);
 assert.match(css,/body\[data-step="executionPaused"\] #resume-plan\{margin:0\}/);
 const f=await fixture(source,{onboarding:{stage:'executionPaused',plan:'Synthetic plan'}});assert.equal(f.get('headline').textContent,'Work paused.');assert.equal(f.get('executionPaused-step').hidden,false);assert.ok(!f.posts.some(p=>p.method==='continuePlan'));
 assert.ok(f.get('paused-auto-slot').children.includes(f.get('auto-mode-control')));
});
test('reopening a waiting job with a new browser replaces the old question with live progress',async()=>{
 const f=await fixture(source,{canResumeWithBrowser:true,onboarding:{stage:'needsInput',plan:'Synthetic plan'},execution:{status:'needs_input',question:'Old question',reply:'Old blocker'}});
 const request=f.posts.find(p=>p.method==='resumeWithBrowser');assert.ok(request);assert.equal(request.params.id,f.state.problem.id);assert.equal(f.get('headline').textContent,'Checking your browser connection…');assert.equal(f.get('execution-result').hidden,true);
 f.window.focusReceive({event:'runProgress',message:'Reading the requested page…'});assert.equal(f.get('headline').textContent,'Reading the requested page…');
 await f.respond({...f.state,canResumeWithBrowser:false,onboarding:{stage:'needsInput',plan:'Synthetic plan'},execution:{status:'needs_input',question:'Sign in in Aside?',reply:'A login is needed.'}},request.id);
 assert.equal(f.get('headline').textContent,'Sign in in Aside?');assert.equal(f.posts.filter(p=>p.method==='resumeWithBrowser').length,1);
});
async function browserAutoGate(code=source){
 for(const [canResumeWithBrowser,stage] of [[false,'needsInput'],[true,'plan'],[true,'results'],[true,'executionPaused']]){
  const f=await fixture(code,{canResumeWithBrowser,onboarding:{stage,plan:'Synthetic plan'},execution:{status:'needs_input'}});assert.equal(f.posts.filter(p=>p.method==='resumeWithBrowser').length,0,'resume needs a waiting job and a new connection');
 }
}
test('browser auto-resume requires a new connection and waiting job',()=>browserAutoGate());
test('mutation proof: browser auto-resume eligibility fires',async()=>{await assert.rejects(browserAutoGate(source.replace("if(state.canResumeWithBrowser && state.onboarding?.stage==='needsInput')","if(true)")),/resume needs/);});
async function connectResume(code=source,switched=false){
 const f=await fixture(code,{onboarding:{stage:'needsInput',plan:'Synthetic plan'},execution:{status:'needs_input',question:'Old question',reply:'Old blocker'}});await f.respond(asideSetup,f.posts.find(p=>p.method==='setup').id);
 const run=f.get('browser-form').onsubmit({preventDefault(){}});await f.respond({});await f.respond({...asideSetup,asideConnection:'synthetic-browser'});
 const current={...f.state,problem:{...f.state.problem,id:switched?'another-job':f.state.problem.id},canResumeWithBrowser:true};await f.respond(current);
 const request=f.posts.find(p=>p.method==='resumeWithBrowser');
 if(switched){assert.equal(request,undefined,'connection callback cannot resume another job');await run;return;}
 assert.ok(request);assert.equal(f.get('execution-result').hidden,true);await f.respond({...current,canResumeWithBrowser:false,onboarding:{stage:'results',plan:'Synthetic plan'},execution:{status:'completed',reply:'Synthetic result'}},request.id);await run;
 assert.equal(f.get('execution-text').textContent,'Synthetic result');
}
test('connecting Aside resumes the waiting job without typed input',()=>connectResume());
test('connection completion does not resume a different selected job',()=>connectResume(source,true));
test('mutation proof: connection completion keeps job identity',async()=>{await assert.rejects(connectResume(source.replace('if(current.problem?.id!==connectedJob)return;',''),true),/cannot resume another job/);});
test('Aside appears beside the AI connections and opens only browser setup',async()=>{
 const f=await fixture(source,{onboarding:{stage:'connect'}});const before=f.posts.length;f.get('choose-aside').onclick();assert.equal(f.posts.at(-1).method,'setup');assert.ok(f.get('browser-dialog-slot').children.includes(f.get('browser-card')));
 await f.respond(asideSetup);assert.equal(f.get('aside-connected').hidden,true);assert.equal(f.get('connect-browser').disabled,false);
 assert.ok(!f.posts.slice(before).some(p=>['provider','aside.connect','modelReady'].includes(p.method)));f.get('skip-aside').onclick();assert.ok(f.get('browser-home').children.includes(f.get('browser-card')));
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8'),section=html.match(/<section id="connect-step"[\s\S]*?<\/section>/)[0];for(const id of ['choose-chatgpt','choose-claude','choose-aside'])assert.ok(section.includes(id));assert.equal((html.match(/id="browser-card"/g)||[]).length,1);
});
async function asideBadge(code=source){const f=await fixture(code);await f.respond(asideSetup,f.posts.find(p=>p.method==='setup').id);assert.equal(f.get('aside-connected').hidden,true,'installed is not connected');const refresh=f.get('refresh-setup').onclick();await f.respond({...asideSetup,asideConnection:'synthetic-aside'});await refresh;assert.equal(f.get('aside-connected').hidden,false);}
test('Aside checkmark means a saved connection, not merely installation',()=>asideBadge());
test('mutation proof: Aside badge requires a saved connection',async()=>{await assert.rejects(asideBadge(source.replace('const connected=!!setupState?.asideConnection;','const connected=!!setupState?.clients.aside;')),/installed is not connected/);});
test('waiting questions omit the supporting paragraph and Connections shortcut',async()=>{
 const f=await fixture(source,{onboarding:{stage:'needsInput'},execution:{question:'Which size?',reply:'Synthetic explanation'}});assert.equal(f.get('execution-result').hidden,true);assert.equal(f.get('execution-text').textContent,'');
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8');assert.doesNotMatch(html,/id="execution-connections"/);assert.doesNotMatch(source,/execution-connections/);
});
async function asideUnavailable(code=source){const f=await fixture(code);await f.respond({...asideSetup,profiles:[]},f.posts.find(p=>p.method==='setup').id);const count=f.posts.length;const attempt=f.get('browser-form').onsubmit({preventDefault(){}});assert.equal(f.posts.length,count,'no connect without an available profile');await attempt;assert.equal(f.get('connect-browser').disabled,true);}
test('Aside cannot connect without an available profile',()=>asideUnavailable());
test('mutation proof: disabled Aside submission cannot dispatch',async()=>{await assert.rejects(asideUnavailable(source.replace("if($('connect-browser').disabled)return;",'')),/no connect without an available profile/);});
test('Aside connecting state blocks duplicates and keeps AI onboarding in place',async()=>{
 const f=await fixture(source,{onboarding:{stage:'connect'}});await f.respond(asideSetup,f.posts.find(p=>p.method==='setup').id);assert.equal(f.get('connect-browser').disabled,false);
 const run=f.get('browser-form').onsubmit({preventDefault(){}}),request=f.posts.at(-1),count=f.posts.length;assert.equal(f.get('connect-browser').textContent,'Connecting…');assert.equal(f.get('connect-model').disabled,true);await f.get('browser-form').onsubmit({preventDefault(){}});assert.equal(f.posts.length,count);
 await f.respond({},request.id);await f.respond({...asideSetup,asideConnection:'synthetic-aside'});await f.respond({...f.state,connections:[]});await run;assert.equal(f.get('aside-connected').hidden,false);assert.equal(f.state.onboarding.stage,'connect');assert.ok(!f.posts.some(p=>p.method==='provider'));
});
test('profile refresh does not connect automatically or require a settings checkbox',async()=>{
 const f=await fixture();await f.respond(asideSetup,f.posts.find(p=>p.method==='setup').id);const refresh=f.get('refresh-setup').onclick();await f.respond({...asideSetup,profiles:['u1']});await refresh;
 assert.equal(f.get('browser-profile').value,'u1');assert.equal(f.get('connect-browser').disabled,false);assert.ok(!f.posts.some(p=>p.method==='aside.connect'));
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8');assert.doesNotMatch(html,/id="(?:browser-consent|aside-local)"/);assert.match(html,/Page content goes to your chosen AI/);
});
test('Aside setup failures clear the checkmark and leave an actionable message',async()=>{
 const f=await fixture();await f.respond({...asideSetup,asideConnection:'synthetic-aside'},f.posts.find(p=>p.method==='setup').id);const refresh=f.get('refresh-setup').onclick(),request=f.posts.at(-1);f.window.focusReceive({id:request.id,error:'Synthetic unavailable'});await refresh;assert.equal(f.get('aside-connected').hidden,true);assert.equal(f.get('connect-browser').disabled,true);assert.equal(f.get('browser-status').textContent,'Synthetic unavailable');
});
const permission={event:'toolApproval',id:'synthetic-permission',tool:'browser.open',connection:'Synthetic browser',destination:'https://example.com',arguments:{url:'https://example.com'},notice:'Page content goes to the selected AI.'};
test('permission details show the full request and surrounding page context',async()=>{
 const f=await fixture();f.window.focusReceive({...permission,tool:'browser.click',target:'Synthetic league',arguments:{selector:'e7',connection:'internal-connection',page:'internal-page'},preview:'Unrelated neighboring item'});
 assert.equal(f.get('tool-arguments').textContent,JSON.stringify({selector:'e7',connection:'internal-connection',page:'internal-page'},null,2)+'\n\nUnrelated neighboring item');assert.equal(f.get('tool-arguments').hidden,false);
 assert.equal(f.get('tool-description').textContent,'https://example.com');
});
test('Auto mode sends the selected job and rolls back a failed setting change',async()=>{
 const f=await fixture(source,{onboarding:{stage:'executing'},autoMode:false});assert.equal(f.get('auto-mode').checked,false);
 f.get('auto-mode').checked=true;const first=f.get('auto-mode').onchange(),request=f.posts.at(-1);
 assert.equal(request.method,'autoMode');assert.equal(request.params.problemId,f.state.problem.id);assert.equal(request.params.enabled,true);
 await f.respond({autoMode:true},request.id);await first;assert.equal(f.get('auto-mode').checked,true);
 f.get('auto-mode').checked=false;const second=f.get('auto-mode').onchange();f.window.focusReceive({id:f.posts.at(-1).id,error:'Synthetic failure'});await second;
 assert.equal(f.get('auto-mode').checked,true);assert.equal(f.get('auto-mode').disabled,false);
});
async function autoSettingRace(code=source){
 const f=await fixture(code,{onboarding:{stage:'plan'},autoMode:false});f.get('auto-mode').checked=true;
 const run=f.get('auto-mode').onchange(),request=f.posts.at(-1);
 f.window.focusReceive({event:'jobSelected',state:{...f.state,problem:{...f.state.problem,id:'other-job'},onboarding:{stage:'plan'},autoMode:false}});
 await f.respond({autoMode:true},request.id);await run;assert.equal(f.get('auto-mode').checked,false,'an old setting response must not enable another job');
}
test('Auto mode acknowledgement cannot overwrite another job’s setting',()=>autoSettingRace());
test('mutation proof: stale Auto mode responses stay in their own job',async()=>{
 await assert.rejects(autoSettingRace(source.replace('if(state.problem?.id===problemId)','if(true)')));
});
test('action No reveals directions without dispatching or accepting blank text',async()=>{
 const f=await fixture();f.window.focusReceive(permission);assert.equal(f.get('tool-response-form').hidden,true);const count=f.posts.length;f.get('decline-tool').onclick();assert.equal(f.get('tool-response-form').hidden,false);assert.equal(f.posts.length,count);
 f.get('tool-response-form').onsubmit({preventDefault(){}});assert.equal(f.posts.length,count);
 const run=declineWithDirections(f);assert.equal(f.posts.at(-1).params.approved,false);assert.equal(f.posts.at(-1).params.text,'Use a different synthetic page.');await f.respond({accepted:true});await run;
});
async function noWhileSending(code=source){const f=await fixture(code);f.window.focusReceive(permission);const run=f.get('approve-tool').onclick();f.get('decline-tool').onclick();assert.equal(f.get('tool-response-form').hidden,true,'No cannot change a submitting approval');await f.respond({accepted:true});await run;}
test('No cannot change a submitting approval',()=>noWhileSending());
test('mutation proof: No waits for the pending approval response',async()=>{await assert.rejects(noWhileSending(source.replace('if(!approvalId||approvalSubmitting)return;','')),/No cannot change/);});
test('approval lives in the main page without redundant details for opening a page',async()=>{
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8'),css=readFileSync(new URL('../focus/ui/focus.css',import.meta.url),'utf8');
 const main=html.match(/<main[\s\S]*?<\/main>/)[0];assert.match(main,/<section id="tool-step"[^>]*hidden>/);assert.doesNotMatch(html,/<dialog id="tool-dialog"/);assert.doesNotMatch(source,/tool-dialog/);
 assert.match(css,/body\.has-approval \.f-conversation>:not\(#tool-step\)\{display:none!important\}/);
 const f=await fixture();let focused=0;f.get('tool-question').focus=()=>{focused++;};const count=f.posts.length;
 f.window.focusReceive(permission);assert.equal(f.get('tool-step').hidden,false);assert.equal(f.get('tool-arguments').hidden,true);assert.equal(focused,1);assert.equal(f.posts.length,count);
 assert.equal(f.get('tool-description').textContent,permission.destination);
 const run=f.get('approve-tool').onclick();assert.equal(f.get('tool-step').hidden,false);assert.equal(f.get('tool-status').textContent,'Sending your answer…');await f.respond({accepted:true});await run;assert.equal(f.get('tool-step').hidden,true);
});
test('No declines the exact action and the next inline question starts with empty directions',async()=>{
 const f=await fixture();f.window.focusReceive(permission);f.get('tool-response').value='Old directions';
 const run=declineWithDirections(f);assert.equal(f.posts.at(-1).params.approved,false);assert.equal(f.posts.at(-1).params.id,permission.id);await f.respond({accepted:true});await run;assert.equal(f.get('tool-step').hidden,true);
 f.window.focusReceive({...permission,id:'synthetic-next'});assert.equal(f.get('tool-step').hidden,false);assert.equal(f.get('tool-response').value,'');assert.equal(f.get('tool-response-error').textContent,'');
});
test('permission offers simple Yes, No and written directions with exact request details',async()=>{
 const f=await fixture();f.window.focusReceive(permission);assert.equal(f.get('tool-question').textContent,'Can I open this page?');assert.equal(f.get('tool-status').textContent,'');assert.match(f.get('tool-description').textContent,/https:\/\/example.com/);assert.equal(f.get('tool-arguments').textContent,'');
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8');assert.match(html,/id="approve-tool"[^>]*>Yes</);assert.match(html,/id="decline-tool"[^>]*>No</);assert.match(html,/id="tool-response"/);
 f.get('tool-response').value='yes, but use a different page';f.get('tool-response').oninput();assert.equal(f.get('send-tool-response').disabled,false);
 const run=f.get('tool-response-form').onsubmit({preventDefault(){}});assert.deepEqual(JSON.parse(JSON.stringify(f.posts.at(-1).params)),{id:permission.id,approved:false,text:'yes, but use a different page'});await f.respond({accepted:true});await run;
});
function declineWithDirections(f){f.get('decline-tool').onclick();f.get('tool-response').value='Use a different synthetic page.';f.get('tool-response').oninput();return f.get('tool-response-form').onsubmit({preventDefault(){}});}
async function permissionBusy(code=source){const f=await fixture(code);f.window.focusReceive(permission);const run=f.get('approve-tool').onclick(),request=f.posts.at(-1),count=f.posts.length;f.get('approve-tool').onclick();assert.equal(f.posts.length,count,'pending approval must send only once');assert.equal(f.get('tool-response').disabled,true);await f.respond({accepted:true},request.id);await run;}
test('permission response cannot race another Yes or No',()=>permissionBusy());
test('mutation proof: approval submission guard prevents double dispatch',async()=>{await assert.rejects(permissionBusy(source.replace('if(!id||approvalSubmitting)return;','if(!id)return;')),/pending approval/);});
async function permissionRace(code=source){
 for(const fail of [false,true]){
  const f=await fixture(code);f.window.focusReceive(permission);
  const run=f.get('approve-tool').onclick(),request=f.posts.at(-1);f.window.focusReceive({...permission,id:'synthetic-next'});
  f.window.focusReceive(fail?{id:request.id,error:'Old response failed'}:{id:request.id,result:{accepted:true}});await run;
  assert.equal(f.get('tool-step').hidden,false,'an old response must not close the new permission');assert.equal(f.get('tool-response-error').textContent,'','an old failure must not overwrite the new permission');
  const next=declineWithDirections(f);assert.equal(f.posts.at(-1).params.id,'synthetic-next');await f.respond({accepted:true});await next;
 }
}
test('late approval acknowledgements cannot dismiss or change a newer permission',()=>permissionRace());
test('mutation proof: permission identity guards reject stale acknowledgements',async()=>{await assert.rejects(permissionRace(source.replaceAll('if(approvalId===id)','if(true)')),/old response/);});
test('blank permission text sends nothing and a failed response can be retried',async()=>{
 const f=await fixture();f.window.focusReceive(permission);const count=f.posts.length;f.get('tool-response').value=' ';f.get('tool-response-form').onsubmit({preventDefault(){}});assert.equal(f.posts.length,count);
 const run=f.get('approve-tool').onclick(),request=f.posts.at(-1);f.window.focusReceive({id:request.id,error:'Synthetic error'});await run;assert.equal(f.get('approve-tool').disabled,false);assert.equal(f.get('tool-response-error').textContent,'Synthetic error');
});
async function activeStep(code=source){
 const f=await fixture(code,{onboarding:{stage:'plan',plan:'Synthetic plan'}});const run=f.get('accept-plan').onclick(),request=f.posts.at(-1);
 f.window.focusReceive({event:'runProgress',message:'Reading the requested page…'});f.window.focusReceive({event:'contextChanged'});f.window.focusReceive({event:'contextUnavailable',message:'Unrelated scan notice'});assert.equal(f.get('headline').textContent,'Reading the requested page…','background scans must not replace the active step');
 f.window.focusReceive(permission);f.window.focusReceive({event:'contextChanged'});assert.equal(f.get('tool-status').textContent,'');
 await f.respond({...f.state,onboarding:{stage:'results'},execution:{status:'completed',reply:'Synthetic result'}},request.id);await run;
}
test('current step stays visible during permission and background refreshes',()=>activeStep());
test('mutation proof: background status guards preserve the active step',async()=>{await assert.rejects(activeStep(source.replaceAll('if(!busy&&!approvalId)','if(true)')),/background scans/);});
test('Continue starts work immediately, shows real progress and displays only the result',async()=>{
 const f=await fixture(source,{onboarding:{stage:'plan',plan:'Synthetic paper plan'}});
 const run=f.get('accept-plan').onclick();const request=f.posts.at(-1);assert.equal(request.method,'acceptPlan');
 assert.equal(f.get('executing-step').hidden,false);assert.equal(f.get('conversation').hidden,true);assert.equal(f.get('compose-area').hidden,true);
 f.window.focusReceive({event:'runProgress',message:'Searching the web…'});assert.equal(f.get('headline').textContent,'Searching the web…');
 await f.respond({...f.state,onboarding:{stage:'results',plan:'Synthetic paper plan'},execution:{status:'completed',reply:'<script>Synthetic result</script>',question:''}},request.id);await run;
 assert.equal(f.get('headline').textContent,'the results');assert.equal(f.get('execution-text').textContent,'<script>Synthetic result</script>');assert.equal(f.get('execution-result').hidden,false);assert.equal(f.get('conversation').hidden,true);assert.equal(f.get('compose-area').hidden,true);
});
async function executionBusy(code=source){
 const f=await fixture(code,{onboarding:{stage:'plan',plan:'Synthetic plan'}}),run=f.get('accept-plan').onclick(),request=f.posts.at(-1),count=f.posts.length;
 f.get('accept-plan').onclick();f.get('resume-plan').onclick();assert.equal(f.posts.length,count,'one click must start only one run');assert.equal(f.get('accept-plan').disabled,true);
 await f.respond({...f.state,onboarding:{stage:'results'},execution:{status:'completed',reply:'Synthetic result'}},request.id);await run;
}
test('execution buttons prevent duplicate dispatch',()=>executionBusy());
test('mutation proof: execution click guard prevents duplicate runs',async()=>{await assert.rejects(executionBusy(source.replaceAll('if(busy||listening||transcribing)return;','')),/one click must start only one run/);});
test('a missing input shows one question and submitting it continues the plan',async()=>{
 const f=await fixture(source,{onboarding:{stage:'needsInput',plan:'Synthetic plan'},execution:{status:'needs_input',reply:'I need the sheet size.',question:'Which size should I use?'}});
 assert.equal(f.get('headline').textContent,'Which size should I use?');assert.equal(f.get('compose-area').hidden,false);assert.equal(f.get('conversation').hidden,true);assert.equal(f.get('execution-result').hidden,true);
 f.get('message').value='Synthetic square';const run=f.get('composer').onsubmit({preventDefault(){}}),request=f.posts.at(-1);
 assert.equal(request.method,'continuePlan');assert.equal(request.params.text,'Synthetic square');
 await f.respond({...f.state,onboarding:{stage:'results'},execution:{status:'completed',reply:'Synthetic square layout.'}},request.id);await run;assert.equal(f.get('message').value,'');
});
test('saved results and paused runs never execute on open or job selection',async()=>{
 for(const stage of ['results','needsInput','executionPaused']){
  const execution={status:stage==='results'?'completed':'needs_input',reply:'Synthetic saved progress',question:'Which size?'};
  const f=await fixture(source,{onboarding:{stage,plan:'Synthetic saved plan'},execution});
  assert.ok(!f.posts.some(p=>['acceptPlan','continuePlan'].includes(p.method)));assert.equal(f.get('conversation').hidden,true);
  f.window.focusReceive({event:'jobSelected',state:{...f.state,problem:{...f.state.problem,id:'synthetic-b'},onboarding:{stage:'problem',plan:''},execution:null}});
  assert.equal(f.get('execution-result').hidden,true);assert.equal(f.get('execution-text').textContent,'');assert.ok(!f.posts.some(p=>['acceptPlan','continuePlan'].includes(p.method)));
 }
});
test('an already-accepted legacy plan starts once without another Continue screen',async()=>{
 const f=await fixture(source,{onboarding:{stage:'work',plan:'Synthetic accepted plan'},execution:null});
 const requests=f.posts.filter(p=>p.method==='continuePlan');assert.equal(requests.length,1);assert.equal(f.get('executing-step').hidden,false);assert.equal(f.get('executionPaused-step').hidden,true);assert.equal(f.get('headline').textContent,'Starting your research…');
 assert.doesNotMatch(source,/Ready to start\./);
 await f.respond({...f.state,onboarding:{stage:'results',plan:'Synthetic accepted plan'},execution:{status:'completed',reply:'Synthetic result'}},requests[0].id);
 assert.equal(f.posts.filter(p=>p.method==='continuePlan').length,1);assert.equal(f.get('execution-text').textContent,'Synthetic result');
});
async function approvedPlanGate(code=source){
 for(const onboarding of [{stage:'plan',plan:'Synthetic unapproved plan'},{stage:'researchReady',plan:''},{stage:'executionPaused',plan:'Synthetic interrupted plan'},{stage:'work',plan:''}]){
  const f=await fixture(code,{onboarding,execution:null});assert.equal(f.posts.filter(p=>p.method==='continuePlan').length,0,'only an already-accepted pending plan may auto-start');
 }
 const f=await fixture(code,{onboarding:{stage:'work',plan:'Synthetic plan'},execution:{status:'completed',reply:'Synthetic result'}});assert.equal(f.posts.filter(p=>p.method==='continuePlan').length,0,'finished work must not auto-start');
}
test('auto-start is limited to already-accepted, not-yet-executed plans',()=>approvedPlanGate());
test('mutation proof: removing the approved-plan gate starts unapproved work',async()=>{
 const guard="if(state.onboarding?.stage!=='work'||!state.onboarding.plan||state.execution)return;";assert.ok(source.includes(guard));await assert.rejects(approvedPlanGate(source.replace(guard,'')),/only an already-accepted/);
});
test('selecting an already-accepted legacy plan starts it without duplicating the request',async()=>{
 const f=await fixture(source,{onboarding:{stage:'plan',plan:'Synthetic unapproved plan'}});
 const selected={...f.state,problem:{...f.state.problem,id:'synthetic-b'},onboarding:{stage:'work',plan:'Synthetic accepted plan'},execution:null};
 f.window.focusReceive({event:'jobSelected',state:selected});const request=f.posts.find(p=>p.method==='continuePlan');assert.ok(request);assert.equal(f.get('executing-step').hidden,false);
 f.window.focusReceive({event:'jobSelected',state:selected});assert.equal(f.posts.filter(p=>p.method==='continuePlan').length,1);
 await f.respond({...selected,onboarding:{stage:'needsInput',plan:'Synthetic accepted plan'},execution:{status:'needs_input',reply:'A size is missing.',question:'Which size?'}},request.id);
 assert.equal(f.get('headline').textContent,'Which size?');
});
test('failed execution shows a paused screen and does not auto-retry',async()=>{
 const f=await fixture(source,{onboarding:{stage:'plan',plan:'Synthetic plan'}});const run=f.get('accept-plan').onclick(),request=f.posts.at(-1);
 f.window.focusReceive({id:request.id,error:'Synthetic offline error'});await new Promise(setImmediate);const refresh=f.posts.at(-1);assert.equal(refresh.method,'state');
 await f.respond({...f.state,onboarding:{stage:'executionPaused',plan:'Synthetic plan'}},refresh.id);await run;
 assert.equal(f.get('executionPaused-step').hidden,false);assert.equal(f.get('voice-status').textContent,'Synthetic offline error');assert.equal(f.posts.filter(p=>p.method==='acceptPlan').length,1);
});
test('plan labels the first paragraph problem and the remaining content research',async()=>{
 const problem='A synthetic problem.\nA supporting detail.';
 const next='A missing detail.\n1. First action.\n2. Second action.\n\nA closing note.';
 const f=await fixture(source,{onboarding:{stage:'plan',plan:problem+'\n\n'+next}});
 assert.equal(f.get('plan-problem').value,problem);
 assert.equal(f.get('plan-next').value,next);
 assert.equal(f.get('plan-next-section').hidden,false);
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8');
 assert.match(html,/<h2[^>]*>problem<\/h2>/);assert.match(html,/<h2[^>]*>research<\/h2>/);
});
test('a plan without a second paragraph does not invent a next step; changing jobs clears both sections',async()=>{
 const f=await fixture(source,{onboarding:{stage:'plan',plan:'<script>synthetic</script>'}});
 assert.equal(f.get('plan-problem').value,'<script>synthetic</script>');
 assert.equal(f.get('plan-next').value,'');assert.equal(f.get('plan-next-section').hidden,true);
 f.window.focusReceive({event:'jobSelected',state:{...f.state,problem:{...f.state.problem,id:'synthetic-b'},onboarding:{stage:'problem',plan:''}}});
 assert.equal(f.get('plan-problem').value,'');assert.equal(f.get('plan-next').value,'');
});
test('plan page has no explanatory subtitle',async()=>{
 const f=await fixture(source,{onboarding:{stage:'plan',draft:'Synthetic task',plan:'Synthetic plan'}});
 assert.equal(f.get('subhead').textContent,'');
 assert.equal(f.get('headline').textContent,'Research plan');
 assert.equal(f.get('plan-problem').value,'Synthetic plan');
});
test('plan page hides the notes and AI toolbar without removing work-view controls',()=>{
 const css=readFileSync(new URL('../focus/ui/focus.css',import.meta.url),'utf8');
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8');
 assert.ok(css.includes('body[data-step="plan"] .f-header{display:none}'),'plan toolbar must be hidden');
 const header=html.match(/<header class="f-header">([\s\S]*?)<\/header>/)?.[1];
 assert.match(header,/id="notes-toggle"/);assert.match(header,/id="settings"/);
});
test('plan Auto mode is centered below Continue without changing its value',async()=>{
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8');
 assert.match(html,/<button id="accept-plan"[^>]*>continue<\/button><div id="plan-auto-slot"><\/div><\/section>/);
 const css=readFileSync(new URL('../focus/ui/focus.css',import.meta.url),'utf8');
 assert.match(css,/#plan-auto-slot\{display:flex;justify-content:center;margin-top:24px\}/);
 for(const autoMode of [false,true]){
  const f=await fixture(source,{autoMode,onboarding:{stage:'plan',plan:'Synthetic plan'}});
  assert.ok(f.get('plan-auto-slot').children.includes(f.get('auto-mode-control')));
  assert.equal(f.get('auto-mode-control').hidden,false);
  assert.equal(f.get('auto-mode').checked,autoMode);
  assert.ok(!f.posts.some(post=>post.method==='autoMode'));
 }
});
test('plan screen offers continue without Change the problem',()=>{
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8');
 assert.match(html,/<button id="accept-plan"[^>]*>continue<\/button>/);
 assert.doesNotMatch(html,/Change the problem|id="revise-plan"/);
 assert.doesNotMatch(source,/\$\('revise-plan'\)/);
});
test('research loading hides the AI toolbar without leaving its header space',()=>{
 const css=readFileSync(new URL('../focus/ui/focus.css',import.meta.url),'utf8');
 assert.ok(css.includes('body[data-step="research"] .f-header{display:none}'));
 assert.ok(css.includes('body[data-step="research"] .f-layout{min-height:100vh}'));
 assert.ok(css.includes('body[data-step="research"] .f-conversation{min-height:100vh}'));
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8');
 assert.match(html,/id="settings"/,'other screens retain the connection settings entry');
});
test('question count shares the top-left Back row, outside the heading',()=>{
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8');
 const row=html.match(/<div class="f-intake-nav">([\s\S]*?)<\/div>/)?.[1]||'';
 assert.match(row,/id="intake-back"/);
 assert.match(row,/<\/button>\s*<p id="clarification-progress"[^>]*><\/p>/);
 assert.ok(html.indexOf('id="clarification-progress"')<html.indexOf('<main'));
 assert.doesNotMatch(html,/<h1 id="headline">[^<]*<\/h1><p id="clarification-progress"/);
 assert.equal((html.match(/id="clarification-progress"/g)||[]).length,1);
 const css=readFileSync(new URL('../focus/ui/focus.css',import.meta.url),'utf8');
 const nav=css.match(/\.f-intake-nav\{([^}]+)\}/)?.[1]||'';
 for(const rule of ['position:fixed','top:16px','left:16px','display:flex','align-items:center','gap:8px'])assert.ok(nav.includes(rule),rule);
 assert.match(css,/\.f-clarification-progress\{[^}]*margin:0;[^}]*text-align:left/);
 assert.match(css,/body\.has-approval \.f-intake-nav[^}]*display:none!important/);
 assert.match(css,/body\[data-step="clarify"\] \.f-hero\{margin:0 0 32px\}/);
 assert.match(css,/body\[data-step="clarify"\] h1\{[^}]*margin-bottom:8px/);
});
test('question composer omits Not sure and Pick for me, keeping mic and Continue',()=>{
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8');
 const row=html.match(/<form id="composer"[\s\S]*?<\/form>/)[0];
 assert.doesNotMatch(html+source,/unsure-question|pick-question|clarification-controls|refineQuestion/);
 assert.match(row,/id="mic"/);assert.match(row,/id="send"/);
});
test('mic and circular send icons live inside every shared composer',()=>{
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8');
 for(const [form,mic,send] of [['composer','mic','send'],['tool-response-form','tool-mic','send-tool-response'],['source-form','source-mic','save-source']]){
  const field=html.match(new RegExp('<form id="'+form+'"[\\s\\S]*?<\\/form>'))[0];
  assert.match(field,/class="f-answer-field"/);assert.match(field,/class="f-input-actions"/);
  assert.ok(field.indexOf('id="'+mic+'"')<field.indexOf('id="'+send+'"'));
  assert.match(field,new RegExp('id="'+mic+'"[^>]*aria-label="Start dictation"[^>]*><svg'));
  assert.match(field,new RegExp('id="'+send+'"[^>]*class="f-primary f-icon-button f-send"'));
  assert.match(field,/<svg aria-hidden="true"/);
 }
 assert.doesNotMatch(html,/◉ Speak/);
 assert.equal((html.match(/id="mic"/g)||[]).length,1);
 const css=readFileSync(new URL('../focus/ui/focus.css',import.meta.url),'utf8');
 assert.match(css,/\.f-answer-field\{[^}]*border:1px solid/);
 assert.match(css,/\.f-answer-field:focus-within\{[^}]*outline:2px solid/);
 assert.match(css,/\.f-input-actions\{[^}]*margin-left:auto/);
 assert.match(css,/\.f-icon-button\{[^}]*width:40px;height:40px;[^}]*border-radius:50%/);
});
test('intake Back is an accessible arrow in the top-left corner, outside the composer',()=>{
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8');
 const css=readFileSync(new URL('../focus/ui/focus.css',import.meta.url),'utf8');
 const back=html.match(/<button\b[^>]*id="intake-back"[^>]*>[\s\S]*?<\/button>/)?.[0];
 assert.ok(back);assert.match(back,/aria-label="Back"/);assert.match(back,/<svg\b[^>]*aria-hidden="true"/);
 assert.ok(html.indexOf(back)<html.indexOf('<main'),'Back is separate from the intake form');
 assert.doesNotMatch(html.match(/<form id="composer"[\s\S]*?<\/form>/)[0],/intake-back/);
 const style=css.match(/\.f-intake-back\s*\{([^}]+)\}/)?.[1]||'';
 for(const rule of ['width:44px','height:44px'])assert.ok(style.includes(rule),rule);
});
class Element {
 constructor(){this.style={};this.scrollHeight=100;this.children=[];this.value='';this.dataset={};this.classList={toggle(){}};this.firstChild={textContent:''};this.elements={namedItem:()=>new Element()};this.resets=0;}
 set innerHTML(value){throw new Error('Untrusted content reached HTML parsing');}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=items;}
 querySelector(){return this.child??=new Element();}
 reset(){this.resets++;this.value='';}
 setAttribute(key,value){this[key]=value;} showModal(){} close(){}
}
test('plan text edits survive refresh, save both sections, and do not run research',async()=>{
 const plan='Synthetic summary\n\nSynthetic research',f=await fixture(source,{onboarding:{stage:'plan',plan}});
 f.get('plan-problem').value='Edited summary\n\nMore context';f.get('plan-problem').oninput();
 f.get('plan-next').value='<script>inert research</script>';f.get('plan-next').oninput();
 f.window.focusReceive({event:'jobSelected',state:f.state});
 assert.equal(f.get('plan-problem').value,'Edited summary\n\nMore context');
 assert.equal(f.get('plan-edit-actions').hidden,false);
 const run=f.get('save-plan').onclick(),request=f.posts.at(-1);
 assert.equal(request.method,'editPlan');assert.equal(request.params.id,f.state.problem.id);assert.equal(request.params.expectedPlan,plan);
 assert.equal(request.params.research,'<script>inert research</script>');assert.equal(f.get('plan-problem').disabled,true);
 await f.respond({...f.state,onboarding:{stage:'plan',plan:'Edited combined plan',planParts:{problem:request.params.problem,research:request.params.research}}},request.id);await run;
 assert.equal(f.get('plan-edit-actions').hidden,true);assert.equal(f.get('plan-problem').disabled,false);
 assert.ok(!f.posts.some(p=>p.method==='acceptPlan'));assert.equal(f.get('plan-next').value,request.params.research);
});
test('Cancel restores saved text and changing jobs discards an unsaved plan draft',async()=>{
 const f=await fixture(source,{onboarding:{stage:'plan',plan:'Original'}});
 f.get('plan-problem').value='Draft';f.get('plan-problem').oninput();f.get('cancel-plan-edit').onclick();
 assert.equal(f.get('plan-problem').value,'Original');assert.ok(!f.posts.some(p=>p.method==='editPlan'));
 f.get('plan-problem').value='Draft';f.get('plan-problem').oninput();
 f.window.focusReceive({event:'jobSelected',state:{...f.state,problem:{...f.state.problem,id:'other'},onboarding:{stage:'plan',plan:'Other plan'}}});
 assert.equal(f.get('plan-problem').value,'Other plan');assert.equal(f.get('plan-edit-actions').hidden,true);
});
test('Continue saves first; failed saves keep the draft and never start research',async()=>{
 const f=await fixture(source,{onboarding:{stage:'plan',plan:'Original'}});
 f.get('plan-problem').value='Edited';f.get('plan-problem').oninput();
 const failed=f.get('accept-plan').onclick(),first=f.posts.at(-1);assert.equal(first.method,'editPlan');
 f.window.focusReceive({id:first.id,error:'Synthetic save failure'});await failed;
 assert.equal(f.get('plan-problem').value,'Edited');assert.ok(!f.posts.some(p=>p.method==='acceptPlan'));
 const retry=f.get('accept-plan').onclick(),save=f.posts.at(-1);
 await f.respond({...f.state,onboarding:{stage:'plan',plan:'Edited',planParts:{problem:'Edited',research:''}}},save.id);
 const execute=f.posts.at(-1);assert.equal(execute.method,'acceptPlan');
 await f.respond({...f.state,onboarding:{stage:'results'},execution:{status:'completed',reply:'Synthetic'}},execute.id);await retry;
});
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
async function finishResearch(f){
 if(f.posts.at(-1).method==='research')await f.respond({...f.state,onboarding:{stage:'plan',draft:'Synthetic task',plan:'Synthetic plan'}});
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

async function secondaryVoice(code,target){
 const f=await fixture(code),permission=target==='tool-response';
 const form=permission?'tool-response-form':'source-form',mic=permission?'tool-mic':'source-mic',method=permission?'approval':'source';
 if(permission)f.window.focusReceive({event:'toolApproval',id:'synthetic-voice',tool:'api.request',arguments:{}});
 f.get(target).value='Typed context.';f.get(mic).onclick();
 assert.equal(f.posts.at(-1).method,'startListening');
 f.window.focusReceive({event:'voice',listening:true});
 assert.equal(f.get(mic)['aria-pressed'],'true');assert.equal(f.get(mic)['aria-label'],'Finish speaking');
 const submit=()=>f.get(form).onsubmit({preventDefault(){},target:f.get(form)});
 submit();assert.ok(!f.posts.some(p=>p.method===method),'dictation must finish before sending');
 f.window.focusReceive({event:'voice',listening:false,transcribing:true});
 submit();assert.ok(!f.posts.some(p=>p.method===method),'transcription must finish before sending');
 f.window.focusReceive({event:'transcript',text:'Spoken context.'});
 assert.equal(f.get(target).value,'Typed context. Spoken context.');assert.equal(f.get('message').value,'');
 assert.ok(!f.posts.some(p=>p.method===method),'transcript needs review');
 f.window.focusReceive({event:'voice',listening:false});
 assert.equal(f.get(mic)['aria-label'],'Start dictation');
 submit();assert.equal(f.posts.at(-1).method,method);
 await f.respond(permission?{accepted:true}:f.state);
}
for(const target of ['tool-response','source-text']){
 test(`dictation stays in ${target} and waits for review`,()=>secondaryVoice(source,target));
 test(`mutation proof: ${target} cannot submit an unfinished transcript`,async()=>{
  await assert.rejects(secondaryVoice(source.replaceAll('if(holdForTranscript())return;',''),target),/dictation must finish/);
 });
}
async function staleVoice(code,scope){
 const f=await fixture(code);
 if(scope==='approval')f.window.focusReceive({event:'toolApproval',id:'synthetic-old',tool:'api.request',arguments:{}});
 f.get(scope==='approval'?'tool-mic':'source-mic').onclick();
 if(scope==='approval')f.window.focusReceive({event:'toolApproval',id:'synthetic-new',tool:'api.request',arguments:{}});
 else {f.get('search-form').onsubmit({preventDefault(){}});await f.respond([]);f.get('confirm-archive').onclick();await f.respond({...f.state,problem:{...f.state.problem,id:'synthetic-b'}});}
 const target=scope==='approval'?'tool-response':'source-text',before=f.get(target).value;
 f.window.focusReceive({event:'transcript',text:'Stale transcript'});
 assert.equal(f.get(target).value,before,'old dictation cannot enter a different job or decision');
}
for(const scope of ['approval','job']){
 test(`late dictation stays out of a different ${scope}`,()=>staleVoice(source,scope));
 test(`mutation proof: ${scope} dictation identity gate fires`,async()=>{
  await assert.rejects(staleVoice(source.replace("if(voiceJob&&voiceJob!==state.problem?.id||voiceTarget==='tool-response'&&voiceApproval!==approvalId)return;",''),scope),/old dictation/);
 });
}
async function captureOwner(code){
 const f=await fixture(code);f.get('source-mic').onclick();f.window.focusReceive({event:'voice',listening:true});
 const count=f.posts.length;assert.equal(f.get('mic').disabled,true);f.get('mic').onclick();
 assert.equal(f.posts.length,count,'another input cannot interrupt dictation');
}
test('active dictation belongs to one input',()=>captureOwner(source));
test('mutation proof: another mic cannot interrupt active dictation',async()=>{
 await assert.rejects(captureOwner(source.replace('||approvalSubmitting||(listening&&target!==voiceTarget))return;','||approvalSubmitting)return;')),/another input/);
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
 await f.respond({...f.state,folders:[{id:'auto',label:'Job-synthetic-a'},{id:'named',label:'Plan the garden',managed:true},{id:'manual',label:'Selected notes'}]});
 assert.equal(f.get('folders').children.length,1);assert.equal(f.get('folders').children[0].children[0].textContent,'Selected notes');
 f.get('open-workspace').onclick();assert.equal(f.posts.at(-1).method,'showWorkspace');
});

test('browser-first setup detects one profile without requesting per-service connections',async()=>{
 const f=await fixture();assert.equal(f.posts.at(-1).method,'setup');
 await f.respond({clients:{aside:true,asideApp:true,chatgpt:true},profiles:['u0'],services:[]});
 assert.equal(f.get('browser-profile-label').hidden,true);
 const task=f.get('browser-form').onsubmit({preventDefault(){}});assert.equal(f.posts.at(-1).method,'aside.connect');assert.equal(f.posts.at(-1).params.profile,'u0');assert.equal(f.posts.at(-1).params.browserAccessApproved,true);
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
test('public research starts without browser access or setup controls',async()=>{
 const f=await fixture(source,{onboarding:{stage:'researchReady',draft:'A synthetic brain dump',plan:''}});
 const pending=f.get('start-research').onclick();
 assert.equal(f.get('research-step').hidden,false);assert.equal(f.posts.at(-1).method,'research');
 assert.equal(f.get('compose-area').hidden,true);
 assert.doesNotMatch(readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8'),/id="(?:research-browser|browser-slot|skip-browser)"/);
 await f.respond({...f.state,onboarding:{stage:'plan',draft:'A synthetic brain dump',plan:'Synthetic preliminary plan'}});await pending;
 assert.equal(f.get('plan-step').hidden,false);assert.equal(f.get('plan-problem').value,'Synthetic preliminary plan');
});
const browserSetup=connected=>({clients:{aside:true},profiles:[],services:[],asideConnection:connected?'synthetic-browser':null});
async function autoResearch(mode,code=source){
 const clarification={token:'synthetic',questions:[{question:'Which approach?',why:'',options:['Quick','Thorough']}],responses:[],draft:''};
 const f=await fixture(code,{onboarding:{stage:mode==='zero'?'attempts':'clarify',draft:'Synthetic task',plan:''},clarification});
 await f.respond(browserSetup(false),f.posts.find(p=>p.method==='setup').id);
 let task;
 if(mode==='answer'){f.get('message').value='Synthetic answer';f.get('message').oninput();}
 task=f.get('composer').onsubmit({preventDefault(){}});
 const next={...f.state,onboarding:{stage:'researchReady',draft:'Synthetic task',plan:''},clarification:{...clarification,responses:[{status:'assumed',text:'Quick',reason:'Small first step.'}]}};
 await f.respond(next);
 assert.equal(f.posts.at(-1).method,'research','completing intake starts research without another click');
 assert.equal(f.get('research-step').hidden,false);assert.equal(f.get('researchReady-step').hidden,true);
 assert.equal(f.get('headline').textContent,'Reading your answers…');
 const request=f.posts.at(-1),count=f.posts.filter(p=>p.method==='research').length;
 f.get('start-research').onclick();f.get('composer').onsubmit({preventDefault(){}});assert.equal(f.posts.filter(p=>p.method==='research').length,count);
 await f.respond({...next,onboarding:{stage:'plan',draft:'Synthetic task',plan:'Synthetic plan'}},request.id);await task;
 assert.equal(f.get('plan-step').hidden,false);
}
test('last custom answer and zero-question intake each start research once',async()=>{for(const mode of ['answer','zero'])await autoResearch(mode);});
async function partialQuestion(code=source){
 const clarification={token:'synthetic',questions:[{question:'First?',why:'',options:[]},{question:'Second?',why:'',options:[]}],responses:[],draft:''};
 const f=await fixture(code,{onboarding:{stage:'clarify',draft:'Synthetic task',plan:''},clarification});
 f.get('message').value='Synthetic answer';const task=f.get('composer').onsubmit({preventDefault(){}});
 await f.respond({...f.state,clarification:{...clarification,responses:[{status:'answered',text:'Synthetic answer'}]}});
 const hidden=f.get('research-step').hidden;
 if(f.posts.at(-1).method==='research')await f.respond({...f.state,onboarding:{stage:'plan',plan:'Synthetic'}});
 await task;assert.equal(hidden,true,'unfinished questions must not enter research');
}
test('unfinished questions never start research',()=>partialQuestion());
test('mutation proof: automatic research waits for the final answer',async()=>{
 const guard="if(state.onboarding?.stage!=='researchReady'||pendingResearch)return;";assert.ok(source.includes(guard));
 await assert.rejects(partialQuestion(source.replace(guard,'')),/unfinished questions/);
});
test('late browser setup neither duplicates research nor connects an account',async()=>{
 const f=await fixture(source,{onboarding:{stage:'researchReady',draft:'Synthetic task',plan:''}});const run=f.get('start-research').onclick(),request=f.posts.at(-1);
 await f.respond(browserSetup(true),f.posts.find(p=>p.method==='setup').id);
 assert.equal(f.posts.filter(p=>p.method==='research').length,1);assert.ok(!f.posts.some(p=>p.method==='aside.connect'));
 f.get('research-stop').onclick();assert.equal(f.posts.at(-1).method,'stop');
 await f.respond({...f.state,onboarding:{stage:'plan',draft:'Synthetic task',plan:'Synthetic plan'}},request.id);await run;
 assert.equal(f.get('plan-step').hidden,false);
});
test('research header follows live progress without a duplicate status line or timed updates',async()=>{
 const f=await fixture(source,{onboarding:{stage:'research',draft:'Synthetic task',plan:''}});
 assert.equal(f.get('headline')['aria-live'],'polite');
 assert.doesNotMatch(readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8'),/id="research-progress"/);
 for(const [event,expected] of [
  [{event:'runProgress',message:'Choosing what to investigate…'},'Choosing what to investigate…'],
  [{event:'toolProgress',status:'running',tool:'memory.search'},'Searching your notes…'],
  [{event:'toolProgress',status:'running',tool:'browser.read'},'Reading a page…'],
  [{event:'toolProgress',status:'completed',tool:'browser.read'},'Reviewing the result…'],
  [{event:'toolApproval',id:'synthetic',tool:'browser.open',connection:'Synthetic',destination:'https://example.com',arguments:{}},'Waiting for your answer…'],
 ]){f.window.focusReceive(event);assert.equal(f.get('headline').textContent,expected);}
 f.window.focusReceive({event:'jobSelected',state:f.state});
 assert.equal(f.get('headline').textContent,'Waiting for your answer…','rendering preserves the current research status');
 assert.equal(f.timers.size,0);
});
test('restoring ready intake does not silently spend another research call',async()=>{
 const f=await fixture(source,{onboarding:{stage:'researchReady',draft:'Synthetic task',plan:''}});await f.respond(browserSetup(true),f.posts.find(p=>p.method==='setup').id);
 assert.ok(!f.posts.some(p=>p.method==='research'));assert.equal(f.get('headline').textContent,'Research paused.');
});
test('failed research keeps answers and waits for an explicit retry',async()=>{
 const f=await fixture(source,{onboarding:{stage:'researchReady',draft:'Synthetic task',plan:''}});
 await f.respond(browserSetup(true),f.posts.find(p=>p.method==='setup').id);
 const run=f.get('start-research').onclick();f.window.focusReceive({id:f.posts.at(-1).id,error:'Synthetic offline'});
 await new Promise(r=>setImmediate(r));assert.equal(f.posts.at(-1).method,'state');await f.respond({...f.state,onboarding:{stage:'researchReady',draft:'Synthetic task',plan:''}});await run;
 assert.equal(f.get('researchReady-step').hidden,false);assert.equal(f.get('voice-status').textContent,'Synthetic offline');assert.equal(f.posts.filter(p=>p.method==='research').length,1);
 const retry=f.get('start-research').onclick();assert.equal(f.posts.filter(p=>p.method==='research').length,2);
 await f.respond({...f.state,onboarding:{stage:'plan',draft:'Synthetic task',plan:'Synthetic plan'}});await retry;
});

async function intakeScenario(code=source){
 const f=await fixture(code,{onboarding:{stage:'problem',draft:'A synthetic problem',plan:''}});
 const next=f.get('composer').onsubmit({preventDefault(){}});
 assert.equal(f.posts.at(-1).method,'describe','first Continue saves the problem before research');
 await f.respond({...f.state,onboarding:{stage:'attempts',draft:'A synthetic problem',plan:''}});await next;
 assert.equal(f.get('headline').textContent,'What have you tried so far?');
 assert.equal(f.get('subhead').textContent,'');assert.equal(f.get('skip-attempts').hidden,false);
 assert.equal(f.get('message').value,'');assert.equal(f.get('send').disabled,false,'the attempts step is optional');
 assert.ok(!f.posts.some(p=>p.method==='research'),'first Continue cannot start research');
 const questions=f.get('composer').onsubmit({preventDefault(){}});
 assert.equal(f.posts.at(-1).method,'clarify');assert.equal(f.posts.at(-1).params.tried,'');
 await f.respond({...f.state,onboarding:{stage:'researchReady',draft:'A synthetic problem',plan:''},clarification:{token:'synthetic',questions:[],responses:[],draft:''}});
 assert.ok(f.posts.some(p=>p.method==='research'),'public research needs no browser connection');
 assert.equal(f.get('research-step').hidden,false,'zero questions automatically enter research');
 assert.equal(f.posts.at(-1).method,'research');
 assert.equal(Object.keys(f.posts.at(-1).params).length,0);
 await f.respond({...f.state,onboarding:{stage:'plan',draft:'A synthetic problem',plan:'Synthetic plan'}});await questions;
}
test('intake saves the problem, then lets the optional attempts step stay blank',()=>intakeScenario());
test('Skip is centered below the text box, outside the composer form',()=>{
 const html=readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8');
 const css=readFileSync(new URL('../focus/ui/focus.css',import.meta.url),'utf8');
 assert.match(html,/<\/form><button type="button" id="skip-attempts" class="f-quiet f-skip" hidden>Skip<\/button>/);
 assert.doesNotMatch(html.match(/<form id="composer"[\s\S]*?<\/form>/)[0],/skip-attempts/);
 assert.match(css,/\.f-skip\{display:block;margin:16px auto 0\}/);
});
test('Skip omits prior attempts and advances to clarification exactly once',async()=>{
 const f=await fixture(source,{onboarding:{stage:'attempts',draft:'Synthetic task',plan:''}});
 f.get('message').value='An unsent draft';const pending=f.get('skip-attempts').onclick(),request=f.posts.at(-1);
 assert.equal(request.method,'clarify');assert.equal(request.params.tried,'');assert.equal(f.get('skip-attempts').disabled,true);
 await f.get('skip-attempts').onclick();assert.equal(f.posts.at(-1),request);
 await f.respond({...f.state,onboarding:{...f.state.onboarding,stage:'clarify'},clarification:{token:'synthetic',questions:[{question:'Which approach?',options:['Quick','Thorough']}],responses:[],draft:''}},request.id);await pending;
 assert.equal(f.get('skip-attempts').hidden,true);assert.ok(!f.posts.some(p=>p.method==='skipClarifications'));
});
test('a failed Skip restores the unsent draft and allows retry',async()=>{
 const f=await fixture(source,{onboarding:{stage:'attempts',draft:'Synthetic task',plan:''}});
 f.get('message').value='An unsent draft';const pending=f.get('skip-attempts').onclick();
 f.window.focusReceive({id:f.posts.at(-1).id,error:'Synthetic failure'});await new Promise(r=>setImmediate(r));
 assert.equal(f.posts.at(-1).method,'state');await f.respond(f.state);await pending;
 assert.equal(f.get('message').value,'An unsent draft');assert.equal(f.get('skip-attempts').disabled,false);
});
async function skipGate(code,mode){
 const f=await fixture(code,{onboarding:{stage:mode==='wrong-step'?'problem':'attempts',draft:'Synthetic task',plan:''}});
 f.get('message').value='Keep this draft';
 if(mode==='listening')f.window.focusReceive({event:'voice',listening:true});
 if(mode==='transcribing')f.window.focusReceive({event:'voice',listening:false,transcribing:true});
 let pending;if(mode==='busy')pending=f.get('composer').onsubmit({preventDefault(){}});
 const count=f.posts.length;const skipped=f.get('skip-attempts').onclick();
 assert.equal(f.get('message').value,'Keep this draft','Skip must not alter an unavailable step');
 await skipped;assert.equal(f.posts.length,count,'Skip must not dispatch while unavailable');
 if(pending){await f.respond({...f.state,onboarding:{stage:'clarify',draft:'Synthetic task',plan:''}});await pending;}
}
for(const mode of ['wrong-step','listening','transcribing','busy']){
 test(`Skip waits when ${mode}`,()=>skipGate(source,mode));
 test(`mutation proof: Skip ${mode} gate fires`,async()=>{
  const gate="if(state.onboarding?.stage!=='attempts'||busy||listening||transcribing)return;";
  await assert.rejects(skipGate(source.replace(gate,''),mode),/Skip must not/);
 });
}
async function buttonLoading(code=source){
 const f=await fixture(code,{onboarding:{stage:'attempts',draft:'Synthetic task',plan:''}});
 const pending=f.get('composer').onsubmit({preventDefault(){}});
 assert.equal(f.get('send')['aria-busy'],'true','Continue must display its loading state');
 assert.equal(f.get('send')['aria-label'],'Loading questions');assert.equal(f.get('send').disabled,true);
 assert.equal(f.get('research-step').hidden,false,'question preparation must show the loading page');
 assert.equal(f.get('compose-area').hidden,true);assert.equal(f.get('intake-back').hidden,true);assert.equal(f.get('skip-attempts').hidden,true);
 assert.equal(f.get('headline').textContent,'Preparing your follow-up questions…');assert.equal(f.get('headline')['aria-live'],'polite');
 assert.equal(f.get('research-stop').textContent,'Stop');
 f.window.focusReceive({event:'runProgress',message:'Reading your problem and what you’ve tried…'});
 assert.equal(f.get('headline').textContent,'Reading your problem and what you’ve tried…','live question progress must reach the header');
 const request=f.posts.at(-1);await f.get('composer').onsubmit({preventDefault(){}});assert.equal(f.posts.at(-1),request);
 await f.respond({...f.state,onboarding:{stage:'researchReady',draft:'Synthetic task',plan:''}},request.id);await finishResearch(f);await pending;
 assert.equal(f.get('send')['aria-busy'],'false');
}
test('Continue immediately shows the live one-line loading page without a duplicate request',()=>buttonLoading());
test('mutation proof: question preparation cannot stay on the input page',async()=>{
 await assert.rejects(buttonLoading(source.replace("questionsLoading()?'research':",'')),/must show the loading page/);
});
test('mutation proof: live question progress reaches the loading header',async()=>{
 await assert.rejects(buttonLoading(source.replace('questionsLoading()||[','[')),/Preparing your follow-up questions|live question progress/);
});
test('mutation proof: losing the button busy state is caught',async()=>{
 const check="$('send').setAttribute('aria-busy',String(loading));";assert.ok(source.includes(check));
 await assert.rejects(buttonLoading(source.replace(check,'')),/must display its loading state/);
});
test('button loading replaces the arrow with a spinner and respects reduced motion',()=>{
 const css=readFileSync(new URL('../focus/ui/focus.css',import.meta.url),'utf8');
 assert.match(css,/#send\[aria-busy="true"\] svg\{visibility:hidden\}/);
 assert.match(css,/#send\[aria-busy="true"\]::after\{[^}]*animation:f-send-spin/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{#send\[aria-busy="true"\]::after\{animation:none\}\}/);
});
test('mutation proof: making prior attempts mandatory blocks the optional intake test',async()=>{
 const guard="if(!text&&state.onboarding?.stage!=='attempts')return;";assert.ok(source.includes(guard));
 await assert.rejects(intakeScenario(source.replace(guard,'if(!text)return;')));
});
async function clarificationFailure(code=source){
 const f=await fixture(code,{onboarding:{stage:'attempts',draft:'Synthetic task',plan:''}});
 const pending=f.get('composer').onsubmit({preventDefault(){}});
 f.window.focusReceive({id:f.posts.at(-1).id,error:'Synthetic connection failure'});
 await new Promise(r=>setImmediate(r));assert.equal(f.posts.at(-1).method,'state');await f.respond(f.state);await pending;
 assert.equal(f.get('send').disabled,false);
 assert.equal(f.get('send')['aria-busy'],'false','an error must clear the button loading state');
 assert.equal(f.get('research-step').hidden,true);assert.equal(f.get('compose-area').hidden,false);
 assert.equal(f.get('headline').textContent,'What have you tried so far?');
}
test('question generation failure leaves Continue available to retry',()=>clarificationFailure());
test('Stop on the question-loading page cancels the request and restores the draft',async()=>{
 const f=await fixture(source,{onboarding:{stage:'attempts',draft:'Synthetic task',plan:''},problem:{id:'synthetic-a',title:'Synthetic task',brief:{tried:'A saved draft'}}});
 const pending=f.get('composer').onsubmit({preventDefault(){}}),request=f.posts.at(-1);
 f.get('research-stop').onclick();assert.equal(f.posts.at(-1).method,'stop');await f.respond(f.state);
 f.window.focusReceive({id:request.id,error:'Stopped'});await new Promise(r=>setImmediate(r));await f.respond(f.state);await pending;
 assert.equal(f.get('research-step').hidden,true);assert.equal(f.get('message').value,'A saved draft');assert.equal(f.get('skip-attempts').disabled,false);
});
test('mutation proof: a failed question request must clear busy state',async()=>{
 const original="render(current);error(e);}finally{setBusy(false);}";assert.ok(source.includes(original));
 await assert.rejects(clarificationFailure(source.replace(original,'render(current);error(e);}finally{setBusy(true);}')));
});
test('Back preserves prior attempts and restores the original problem draft',async()=>{
 const f=await fixture(source,{problem:{id:'synthetic-a',title:'Synthetic problem',brief:{tried:'A saved attempt'}},onboarding:{stage:'attempts',draft:'Original synthetic problem',plan:''}});
 assert.equal(f.get('message').value,'A saved attempt');f.get('message').value='An edited attempt';
 const back=f.get('intake-back').onclick();assert.equal(f.posts.at(-1).method,'saveDraft');assert.equal(f.posts.at(-1).params.field,'tried');
 await f.respond({saved:true});assert.equal(f.posts.at(-1).method,'reviseProblem');
 await f.respond({...f.state,onboarding:{stage:'problem',draft:'Original synthetic problem',plan:''}});await back;
 assert.equal(f.get('message').value,'Original synthetic problem');assert.equal(f.get('intake-back').hidden,true);
});
test('questions show choices without explanatory subtitles; final answer enters research',async()=>{
 assert.doesNotMatch(readFileSync(new URL('../focus/ui/index.html',import.meta.url),'utf8'),/id="clarification-notice"/);
 assert.doesNotMatch(source,/clarification-notice/);
 const clarification={token:'synthetic',questions:[{question:'What result matters?',why:'This helps choose an approach.',options:['Quick','Thorough']},{question:'What is the deadline?',why:'This helps set the pace.',options:[]}],responses:[],draft:''};
 const f=await fixture(source,{onboarding:{stage:'clarify',draft:'Synthetic task',plan:''},clarification});
 assert.equal(f.get('headline').textContent,'What result matters?');assert.equal(f.get('subhead').textContent,'');assert.equal(f.get('clarification-progress').textContent,'Question 1 of 2');
 assert.equal(f.get('compose-area').hidden,false);
 f.get('clarification-options').children[0].onclick();assert.equal(f.posts.at(-1).method,'saveDraft');
 const answer=f.get('composer').onsubmit({preventDefault(){}});assert.equal(f.posts.at(-1).method,'answerClarification');assert.equal(f.posts.at(-1).params.index,0);assert.deepEqual([...f.posts.at(-1).params.choices],[0]);
 const c2={...clarification,responses:[{status:'answered',text:'Quick'}]};await f.respond({...f.state,clarification:c2});await answer;
 assert.equal(f.get('headline').textContent,'What is the deadline?');assert.equal(f.get('message').value,'');assert.equal(f.get('compose-area').hidden,false);
 f.get('message').value='A short trial';
 const finalAnswer=f.get('composer').onsubmit({preventDefault(){}});assert.equal(f.posts.at(-1).method,'answerClarification');
 await f.respond({...f.state,onboarding:{stage:'researchReady',draft:'Synthetic task',plan:''},clarification:{...c2,responses:[...c2.responses,{status:'answered',text:'A short trial'}]}});assert.equal(f.posts.at(-1).method,'research');await finishResearch(f);await finalAnswer;
 assert.equal(f.get('plan-step').hidden,false);assert.equal(f.get('researchReady-step').hidden,true);
});
async function choiceBusy(code=source){
 const clarification={token:'synthetic',questions:[{question:'Which approach?',why:'',options:['Quick','Thorough']}],responses:[],draft:''};
 const f=await fixture(code,{onboarding:{stage:'clarify',draft:'Synthetic task',plan:''},clarification});
 const buttons=f.get('clarification-options').children;
 buttons[0].onclick();const pending=f.get('composer').onsubmit({preventDefault(){}}),request=f.posts.at(-1),count=f.posts.length;
 assert.ok(buttons.every(button=>button.disabled));
 buttons[1].onclick();assert.equal(f.posts.length,count,'choices cannot change during submission');
 f.get('composer').onsubmit({preventDefault(){}});assert.equal(f.posts.length,count);
 f.window.focusReceive({id:request.id,error:'Synthetic save failed'});await new Promise(r=>setImmediate(r));await f.respond(f.state);await pending;
 assert.equal(f.get('voice-status').textContent,'Synthetic save failed');assert.equal(f.get('send').disabled,false);
 assert.equal(f.get('compose-area').hidden,false);
 const retry=f.get('composer').onsubmit({preventDefault(){}});assert.deepEqual([...f.posts.at(-1).params.choices],[0]);
 await f.respond({...f.state,onboarding:{stage:'researchReady',draft:'Synthetic task',plan:''},clarification:{...clarification,responses:[{status:'answered',text:'Thorough'}]}});assert.equal(f.posts.at(-1).method,'research');await finishResearch(f);await retry;
 assert.equal(f.get('plan-step').hidden,false);
}
test('choice submission blocks double-clicks and allows retry after failure',()=>choiceBusy());
test('every question accepts custom text plus toggled choices, saved together only on Continue',async()=>{
 const clarification={token:'synthetic',questions:[{question:'Which approach?',why:'',options:['Quick','Thorough']}],responses:[],draft:'',draftChoices:[]};
 const f=await fixture(source,{onboarding:{stage:'clarify',draft:'Synthetic task',plan:''},clarification});
 const buttons=f.get('clarification-options').children;assert.equal(f.get('send').disabled,true);assert.equal(f.get('message').placeholder,'Your own answer…');assert.equal(f.get('compose-area').hidden,false);
 buttons[0].onclick();buttons[1].onclick();assert.equal(buttons[0]['aria-pressed'],'true');assert.equal(buttons[1]['aria-pressed'],'true');assert.equal(f.get('send').disabled,false);
 assert.ok(!f.posts.some(p=>p.method==='answerClarification'));
 buttons[0].onclick();buttons[1].onclick();assert.equal(f.get('send').disabled,true);
 buttons[1].onclick();f.get('message').value='A custom detail';f.get('message').oninput();
 assert.deepEqual([...f.posts.at(-1).params.choices],[1]);assert.equal(f.posts.at(-1).params.text,'A custom detail');
 const answer=f.get('composer').onsubmit({preventDefault(){}});assert.equal(f.posts.at(-1).method,'answerClarification');assert.deepEqual([...f.posts.at(-1).params.choices],[1]);assert.equal(f.posts.at(-1).params.text,'A custom detail');
 await f.respond({...f.state,onboarding:{stage:'researchReady',draft:'Synthetic task',plan:''},clarification:{...clarification,responses:[{status:'answered',text:'Thorough\nA custom detail'}]}});assert.equal(f.posts.at(-1).method,'research');await finishResearch(f);await answer;
 assert.equal(f.get('plan-step').hidden,false);
});
test('restored selections and custom text reappear; new questions do not inherit them',async()=>{
 const clarification={token:'synthetic',questions:[{question:'Which approach?',why:'',options:['Quick','Thorough']},{question:'What else?',why:'',options:[]}],responses:[],draft:'Saved detail',draftChoices:[1]};
 const f=await fixture(source,{onboarding:{stage:'clarify',draft:'Synthetic task',plan:''},clarification});
 assert.equal(f.get('clarification-options').children[1]['aria-pressed'],'true');assert.equal(f.get('message').value,'Saved detail');assert.equal(f.get('send').disabled,false);
 f.window.focusReceive({event:'jobSelected',state:{...f.state,clarification:{...clarification,responses:[{status:'answered',text:'Saved answer'}],draft:'',draftChoices:[]}}});
 assert.equal(f.get('message').value,'');assert.equal(f.get('send').disabled,true);assert.equal(f.get('compose-area').hidden,false);
 f.get('message').value='Custom only';f.get('message').oninput();assert.equal(f.get('send').disabled,false);
});
test('recommended choices remain labels, not answer text',async()=>{
 const clarification={token:'synthetic',questions:[{question:'Which approach?',why:'',options:['Quick','Thorough'],recommendedIndex:1}],responses:[],draft:''};
 const f=await fixture(source,{onboarding:{stage:'clarify',draft:'Synthetic task',plan:''},clarification});
 assert.equal(f.get('clarification-options').children[1].textContent,'Thorough (Recommended)');
 f.get('clarification-options').children[1].onclick();
 assert.deepEqual([...f.posts.at(-1).params.choices],[1]);assert.equal(f.posts.at(-1).params.text,'');
});
test('mutation proof: choices cannot change while submitting',async()=>{
 const broken=source.replace("function toggleAnswer(index){\n    if(busy||listening||transcribing)return;","function toggleAnswer(index){");
 assert.notEqual(broken,source);await assert.rejects(choiceBusy(broken),/choices cannot change during submission/);
});
async function navigationBusy(code=source){
 const f=await fixture(code,{onboarding:{stage:'attempts',draft:'Synthetic task',plan:''}});
 const pending=f.get('composer').onsubmit({preventDefault(){}});const request=f.posts.at(-1),before=f.posts.length;
 assert.equal(f.get('intake-back').disabled,true);
 f.get('intake-back').onclick();assert.equal(f.posts.length,before,'busy navigation cannot submit another action');
 await f.respond({...f.state,onboarding:{stage:'researchReady',draft:'Synthetic task',plan:''}},request.id);await finishResearch(f);await pending;
}
test('navigation cannot race question generation or active dictation',async()=>{
 await navigationBusy();const f=await fixture(source,{onboarding:{stage:'attempts',draft:'Synthetic task',plan:''}});
 f.window.focusReceive({event:'voice',listening:true});const before=f.posts.length;await f.get('intake-back').onclick();assert.equal(f.posts.length,before);assert.equal(f.get('intake-back').disabled,true);
});
test('mutation proof: navigation waits while questions are being generated',async()=>{
 const guard='if(busy||listening||transcribing)return;';assert.ok(source.includes(guard));
 await assert.rejects(navigationBusy(source.replaceAll(guard,'')),/busy navigation/);
});
test('dictation appends to typed words; a completed plan does not execute itself',async()=>{
 const f=await fixture(source,{onboarding:{stage:'problem',draft:'',plan:''}});f.get('message').value='Already typed.';f.get('mic').onclick();f.window.focusReceive({event:'transcript',text:'More spoken context.'});
 assert.equal(f.get('message').value,'Already typed. More spoken context.');assert.equal(f.posts.at(-1).method,'saveDraft');
 f.window.focusReceive({event:'jobSelected',state:{...f.state,onboarding:{stage:'plan',draft:'',plan:'<script>synthetic</script>'}}});
 assert.equal(f.get('plan-problem').value,'<script>synthetic</script>');assert.ok(!f.posts.some(p=>p.method==='acceptPlan'));
 f.get('accept-plan').onclick();assert.equal(f.posts.at(-1).method,'acceptPlan');
});

test('opening goes straight to model connection without a redundant create page',async()=>{
 const f=await fixture(source,{onboarding:{stage:'connect',draft:'',plan:''}});
 assert.equal(f.posts[0].method,'openJob');assert.equal(f.get('connect-step').hidden,false);
 assert.equal(f.get('headline').textContent,'connect your apps');
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
 const check="||(!answerText()&&state.onboarding?.stage!=='attempts')";assert.ok(source.includes(check));
 await assert.rejects(emptyContinueScenario(source.replace(check,'')),/empty problem must disable Continue/);
});
test('a restored problem draft enables Continue immediately',async()=>{
 const f=await fixture(source,{onboarding:{stage:'problem',draft:'A saved synthetic problem',plan:''}});
 assert.equal(f.get('send').disabled,false);assert.equal(f.get('send').firstChild.textContent,'Continue ');
});
