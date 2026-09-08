/* Native owns IO. Provider and source text are always inserted as text nodes. */
(() => {
  const $=id=>document.getElementById(id),pending=new Map();
  let serial=0,state={problem:null,entries:[],provider:'chatgpt'},busy=false,listening=false,approvalId=null,setupState=null,voicePrefix='',pendingResearch=null,transcribing=false;
  let models={chatgpt:{connected:false},claude:{connected:false}},modelsChecked=false,modelCheck=null,modelTimer=null,accountAction=false;
  function native(method,params={}) {
    return new Promise((resolve,reject)=>{
      if(!window.webkit?.messageHandlers?.focus){reject(new Error('Open the onejob desktop app to save notes and connect your AI.'));return;}
      const id=++serial;pending.set(id,{resolve,reject});window.webkit.messageHandlers.focus.postMessage({id,method,params});
    });
  }
  function updateSend(){
    $('send').disabled=busy||transcribing||!$('message').value.trim();
    $('send').firstChild.textContent=state.onboarding?.stage==='problem'?'Continue ':listening?'Finish speaking ':'Send ';
  }
  function status(text){$('voice-status').textContent=text;}
  function error(error){status(error.message);}
  async function act(method,params){try{const result=await native(method,params);return result;}catch(e){error(e);throw e;}}
  function fire(method,params){native(method,params).catch(error);}
  window.focusReceive=message=>{
    if(message.event==='transcript') {$('message').value=[voicePrefix,message.text].filter(Boolean).join(' ');status('Review your words, then send.');saveDraft();}
    else if(message.event==='voice') {listening=message.listening;transcribing=!!message.transcribing;updateSend();$('mic').disabled=transcribing;$('mic').textContent=listening?'◉ Finish speaking':'◉ Speak';status(message.message);}
    else if(message.event==='voiceSetup') {$('voice-setup-status').textContent=message.message;}
    else if(message.event==='speech') { /* Native speech has no in-window avatar. */ }
    else if(message.event==='error') error(new Error(message.message));
    else if(message.event==='accountChanged') refreshModels();
    else if(message.event==='runProgress') {status(message.message);$('research-progress').textContent=message.message;}
    else if(message.event==='jobSelected') {render(message.state);status('');}
    else if(message.event==='toolApproval') {approvalId=message.id;$('tool-description').textContent=message.tool+' · '+message.connection+' → '+message.destination;$('tool-notice').textContent=message.notice;$('tool-arguments').textContent=JSON.stringify(message.arguments,null,2)+(message.preview?'\n\nPage excerpt (untrusted content):\n'+message.preview:'');$('approve-tool').disabled=false;$('decline-tool').disabled=false;$('tool-dialog').showModal();status('Waiting for your approval.');}
    else if(message.event==='setupChanged') {refreshSetup();native('state').then(renderTools).catch(error);}
    else if(message.event==='setupNotice') status(message.message);
    else if(message.event==='toolProgress') {status(message.status+(message.summary?': '+message.summary:''));if(message.id===approvalId){$('tool-dialog').close();approvalId=null;}native('state').then(renderTools).catch(error);}
    else if(message.event==='contextChanged') {$('matches').replaceChildren();status('Your job folder is up to date.');}
    else if(message.event==='contextUnavailable') status(message.message);
    else {const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(new Error(message.error)):p.resolve(message.result);}}
  };
  function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
  function setBusy(value){busy=value;updateSend();$('stop').hidden=!value;$('message').disabled=value;$('save-connection').disabled=value;$('connect-browser').disabled=value;for(const button of $('service-cards').querySelectorAll?.('button')||[])button.disabled=value;if(!value){$('tool-dialog').close();approvalId=null;}}
  function render(s){
    const changed=state.problem?.id!==s.problem?.id;
    if(changed){$('matches').replaceChildren();$('search-form').reset();$('source-form').reset();}
    if(changed){$('message').value=s.onboarding?.draft||'';voicePrefix='';pendingResearch=null;$('notebook').hidden=true;}
    state=s;renderTools(s);document.body.classList.toggle('has-problem',!!s.problem);
    $('brief-empty').hidden=!!s.problem;$('brief-form').hidden=!s.problem;
    $('source-form').querySelector('button').disabled=!s.problem;
    $('send').firstChild.textContent=s.problem?'Send ':'Start here ';
    $('send-note').textContent=s.problem?`Sending shares this problem, recent conversation, and relevant notes or folder excerpts with ${s.provider==='claude'?'your Claude Code client':'OpenAI through Codex'}. External tool actions require your review.`:'Your first problem brief is saved on this Mac.';
    $('provider').value=s.provider;providerView();
    if(s.problem){$('headline').textContent=s.problem.title;for(const [key,value]of Object.entries(s.problem.brief)){$('brief-form').elements.namedItem(key).value=value;}}
    else {$('headline').textContent='whats my one job?';}
    const messages=s.entries.filter(e=>['user','assistant'].includes(e.kind));
    $('conversation').replaceChildren(...messages.map(e=>{const el=node('div',undefined,'f-message '+e.kind);el.append(node('span',e.kind==='user'?'You':'onejob','f-speaker'),document.createTextNode(e.text));return el;}));
    $('conversation').scrollTop=$('conversation').scrollHeight;
    const memories=s.entries.filter(e=>!['user','assistant','source'].includes(e.kind)&&e.status!=='forgotten');
    $('memories').replaceChildren(...memories.map(e=>{const card=node('article',undefined,'f-card');card.append(node('span',e.kind+' · '+(e.status==='proposed'?'suggested':'kept'),'f-tag'),node('p',e.text));const d=node('details');d.append(node('summary','See supporting words'),node('blockquote',e.quote));const source=s.entries.find(x=>x.id===e.source_id);if(source)d.append(node('small',source.title||'From your conversation'));card.append(d);for(const action of e.status==='proposed'?['confirm','forget']:['forget']){const b=node('button',action==='confirm'?'Keep this':'Forget','f-quiet');b.onclick=()=>act('memory',{id:e.id,action}).then(render).catch(error);card.append(b);}return card;}));
    if(!memories.length)$('memories').append(node('p','As you talk, useful memories will appear here for you to review.','f-empty-small'));
    $('sources').replaceChildren(...s.entries.filter(e=>e.kind==='source').map(e=>{const card=node('details',undefined,'f-card');card.append(node('summary',e.title),node('p',e.text));return card;}));
    $('archives').replaceChildren(...(s.archives||[]).map(e=>{const b=node('button','Resume: '+e.title,'f-quiet');b.onclick=()=>act('restore',{id:e.id}).then(render).catch(error);return b;}));
    $('folders').replaceChildren(...(s.folders||[]).filter(folder=>folder.label!==('Job-'+s.problem?.id)).map(folder=>{const card=node('div',undefined,'f-card');card.append(node('p',folder.label));const remove=node('button','Stop syncing and forget imports','f-quiet');remove.onclick=()=>act('disconnectFolder',{id:folder.id}).then(s=>{$('matches').replaceChildren();render(s);}).catch(error);card.append(remove);return card;}));
    renderStep();
    $('folder-status').textContent=s.folderScan?.partial?'Too many files to read. Move some out of your job folder.':s.problem?'Desktop → onejob · Updates automatically.':'Desktop → onejob. Start a problem to get its own folder.';
  }
  function renderTools(s) {
    $('connections').replaceChildren(...(s.connections||[]).map(c=>{const card=node('article',undefined,'f-card');card.append(node('span',c.kind,'f-tag'),node('p',c.name),node('small',c.url||'Aside local browser controls'));const remove=node('button','Disconnect','f-quiet');remove.disabled=busy;remove.onclick=()=>act('connection.remove',{id:c.id}).then(s=>{render(s);refreshSetup();}).catch(error);card.append(remove);return card;}));
    $('actions').replaceChildren(...(s.actions||[]).map(a=>{const card=node('article',undefined,'f-card');card.append(node('span',a.status,'f-tag'),node('p',a.tool),node('small',a.summary));const details=node('details');details.append(node('summary','Show request'),node('pre',JSON.stringify(a.arguments,null,2)));card.append(details);return card;}));
    if(!s.actions?.length)$('actions').append(node('p','Tool steps will appear here as onejob works.','f-fine'));
  }
  async function refreshSetup(){
    try {setupState=await native('setup');const s=setupState;
      $('browser-status').textContent=s.asideConnection?'Ready. Ask onejob to find what it needs in your signed-in websites.':s.clients.aside?(s.profiles.length?'Aside found. Enable it once below.':'Open an Aside window, then check connections again.'):'Open Aside and enable its CLI in Developer settings.';
      $('browser-form').hidden=!!s.asideConnection;$('open-aside').hidden=!s.clients.asideApp;
      $('browser-profile-label').hidden=s.profiles.length<=1;$('browser-profile').replaceChildren(...s.profiles.map(id=>{const option=node('option','Aside profile '+id);option.value=id;return option;}));
      $('installed-clients').textContent=[s.clients.chatgpt?'Codex detected':null,s.clients.claude?'Claude Code detected':null].filter(Boolean).join(' · ')||'Install Codex or Claude Code to connect your AI.';
      $('service-cards').replaceChildren(...s.services.map(service=>{const card=node('article',undefined,'f-card');card.append(node('h3',service.name),node('p',service.description),node('small',service.status));
        const button=node('button',service.status==='connected'?'Reconnect':'Connect','f-quiet');button.disabled=busy||service.status==='awaiting sign-in';button.onclick=async()=>{button.disabled=true;try{const r=await act('service.connect',{service:service.id});await native('openServiceAuth',{url:r.url});await refreshSetup();}catch(err){$('setup-status').textContent=err.message;button.disabled=false;}};card.append(button);
        if(service.status==='awaiting sign-in'){const cancel=node('button','Cancel sign-in','f-quiet');cancel.onclick=()=>act('service.cancel',{service:service.id}).then(refreshSetup).catch(error);card.append(cancel);}return card;}));
    }catch(err){$('browser-status').textContent=err.message;}
  }
  $('refresh-setup').onclick=refreshSetup;$('open-aside').onclick=()=>fire('openAside');
  $('browser-form').onsubmit=async event=>{event.preventDefault();try{await act('aside.connect',{profile:$('browser-profile').value||setupState?.profiles[0],privacyConfirmed:$('browser-consent').checked});await refreshSetup();renderTools(await native('state'));if(pendingResearch)await runPendingResearch();}catch(err){$('browser-status').textContent=err.message;}};
  function providerView(){$('chatgpt-settings').hidden=$('provider').value!=='chatgpt';$('claude-settings').hidden=$('provider').value!=='claude';}
  function readyProvider(){return models[state.provider]?.connected?state.provider:['chatgpt','claude'].find(provider=>models[provider]?.connected);}
  function renderAccounts(){
    const selected=readyProvider()||state.provider;
    for(const provider of ['chatgpt','claude']){
      const connected=models[provider]?.connected===true,name=provider==='claude'?'Claude':'ChatGPT';
      $('choose-'+provider).setAttribute('aria-pressed',String(provider===selected));
      $('choose-'+provider).setAttribute('aria-label',name+(connected?', connected':', sign in'));
      $('choose-'+provider).title=name+(connected?' · Connected':' · Sign in');
      $('choose-'+provider).disabled=accountAction;
      $(provider+'-connected').hidden=!connected;
    }
    $('connect-model').textContent=readyProvider()?'Continue':modelsChecked?'Sign in with '+(state.provider==='claude'?'Claude':'ChatGPT'):'Checking accounts…';
    $('connect-model').disabled=accountAction||!modelsChecked;
    $('account-status').textContent=models.chatgpt.connected?'Connected to ChatGPT':models.chatgpt.checked===false?'Could not check ChatGPT.':'Not connected yet.';
    $('login').hidden=!!models.chatgpt.connected;$('logout').hidden=!models.chatgpt.connected;
    $('settings').textContent=readyProvider()?'AI connected ↗':'Connect your AI ↗';
  }
  function scheduleModelCheck(){
    clearTimeout(modelTimer);
    if(state.onboarding?.stage==='connect')modelTimer=setTimeout(refreshModels,2500);
  }
  function refreshModels(){
    if(modelCheck)return modelCheck;
    clearTimeout(modelTimer);
    modelCheck=native('modelAccounts').then(result=>{models=result;modelsChecked=true;})
      .catch(error=>{models={chatgpt:{connected:false,checked:false},claude:{connected:false,checked:false}};modelsChecked=true;status('Could not check your AI accounts. Retrying…');})
      .finally(()=>{modelCheck=null;renderAccounts();scheduleModelCheck();});
    return modelCheck;
  }
  async function refreshAccount(){await refreshModels();}
  async function signIn(provider){
    if(provider==='claude')await native('claudeLogin');
    else {const login=await act('login');await native('openAuth',{url:login.url});}
    status('Finish signing in. This screen will update automatically.');
    await refreshModels();
  }
  $('composer').onsubmit=async event=>{
    event.preventDefault();if(busy||transcribing)return;
    fire('stopSpeech');if(listening){transcribing=true;$('send').disabled=true;fire('stopListening');return;}
    const text=$('message').value.trim();if(!text)return;
    try{
      if(!state.problem)return;
      const researching=state.onboarding?.stage==='problem';
      if(researching && !setupState?.asideConnection){
        pendingResearch=text;state.onboarding.stage='research';renderStep();
        $('research-browser').hidden=false;$('browser-slot').append($('browser-card'));
        $('research-progress').hidden=true;$('research-stop').hidden=true;return;
      }
      if(researching){state.onboarding.stage='research';renderStep();}
      setBusy(true);status('Thinking about your problem…');const answer=await act(researching?'research':'send',{text});render(answer);$('message').value='';status('Saved. Pick up here whenever you’re ready.');
      if($('spoken').checked){const reply=answer.entries.filter(e=>e.kind==='assistant').at(-1);if(reply)fire('speak',{text:reply.text});}
    }catch(e){const current=await native('state').catch(error=>state);render(current);error(e);}finally{setBusy(false);}
  };
  function saveDraft(){updateSend();if(state.onboarding?.stage==='problem')fire('saveDraft',{id:state.problem.id,text:$('message').value});}
  $('message').oninput=saveDraft;
  $('message').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('composer').requestSubmit();}};
  function toggleVoice(){if(busy||transcribing)return;if(!listening)voicePrefix=$('message').value.trim();fire('stopSpeech');fire(listening?'stopListening':'startListening');}
  $('mic').onclick=toggleVoice;
  $('stop').onclick=()=>fire('stop');
  $('brief-form').onsubmit=e=>{e.preventDefault();const brief=Object.fromEntries(new FormData(e.target));act('brief',{brief}).then(s=>{render(s);status('Brief saved.');}).catch(error);};
  $('source-form').onsubmit=e=>{e.preventDefault();act('source',{title:'Added note',text:$('source-text').value}).then(s=>{render(s);e.target.reset();status('Context saved to this problem.');}).catch(error);};
  $('search-form').onsubmit=e=>{e.preventDefault();act('retrieve',{query:$('search').value}).then(rows=>{$('matches').replaceChildren(...rows.map(row=>{const el=node('article',undefined,'f-card');el.append(node('span',row.title||row.kind,'f-tag'),node('p',row.text),node('small',row.retrieval?.includes('meaning')?'Related meaning'+(row.matched.length?' · '+row.matched.join(', '):''):'Matched: '+row.matched.join(', ')));return el;}));if(!rows.length)$('matches').append(node('p','No matching context yet.','f-empty-small'));}).catch(error);};
  $('open-workspace').onclick=()=>fire('showWorkspace');
  document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-selected',String(b===button));$(b.dataset.tab+'-pane').hidden=b!==button;});});
  $('settings').onclick=()=>{$('account-dialog').showModal();refreshAccount();refreshSetup();};$('close-settings').onclick=()=>$('account-dialog').close();
  $('provider').onchange=()=>act('provider',{provider:$('provider').value}).then(render).catch(e=>{$('provider').value=state.provider;providerView();error(e);});
  $('login').onclick=()=>act('login').then(r=>native('openAuth',{url:r.url})).catch(error);
  $('logout').onclick=()=>act('logout').then(refreshAccount).catch(error);
  $('claude-login').onclick=()=>fire('claudeLogin');
  $('archive').onclick=()=>$('archive-dialog').showModal();$('cancel-archive').onclick=()=>$('archive-dialog').close();
  $('confirm-archive').onclick=()=>{fire('stopListening');return act('archive').then(s=>{$('archive-dialog').close();render(s);status('Ready for your next important problem.');}).catch(error);};
  $('spoken').onchange=()=>{if(!$('spoken').checked)fire('stopSpeech');};
  $('connection-kind').onchange=()=>{const aside=$('connection-kind').value==='aside';$('aside-fields').hidden=!aside;$('service-fields').hidden=aside;};
  $('connection-form').onsubmit=async e=>{e.preventDefault();try {const kind=$('connection-kind').value;const s=await act('connection.add',{kind,name:$('connection-name').value,url:$('connection-url').value,account:kind==='aside'?$('aside-account').value:$('credential-account').value,secretRef:kind==='aside'?'':$('credential-reference').value,localBrowserOnly:$('aside-local').checked});render(s);$('connection-status').textContent='Configuration saved. Access will be tested when you approve the first tool action.';}catch(err){$('connection-status').textContent=err.message;}};
  function decideTool(approved){const id=approvalId;if(!id)return;$('approve-tool').disabled=true;$('decline-tool').disabled=true;act('approval',{id,approved}).then(()=>{$('tool-dialog').close();approvalId=null;}).catch(error);}
  $('approve-tool').onclick=()=>decideTool(true);$('decline-tool').onclick=()=>decideTool(false);$('tool-dialog').oncancel=e=>{e.preventDefault();decideTool(false);};
  $('stop-tool-run').onclick=()=>{fire('stop');$('tool-dialog').close();approvalId=null;};
  $('voice-key').onclick=()=>fire('chooseVoiceKey');
  $('show-artifacts').onclick=()=>fire('showArtifacts');
  function renderStep(){
    const step=state.problem?(state.onboarding?.stage||'work'):'connect';
    document.body.dataset.step=step;document.body.classList.toggle('has-problem',step==='work');
    for(const name of ['connect','research','plan'])$(name+'-step').hidden=name!==step;
    if(!pendingResearch)$('browser-home').append($('browser-card'));
    $('research-browser').hidden=!pendingResearch;$('research-progress').hidden=!!pendingResearch;$('research-stop').hidden=!!pendingResearch;
    $('compose-area').hidden=!['problem','work'].includes(step);
    $('conversation').hidden=step!=='work';$('notes-toggle').hidden=!['work','plan'].includes(step);
    if(!['work','plan'].includes(step))$('notebook').hidden=true;
    $('layout').classList.toggle('with-notes',!$('notebook').hidden);
    const titles={connect:'bring your own AI',problem:'whats my one job?',research:'Let’s understand the whole picture.',plan:'A way forward.'};
    if(titles[step])$('headline').textContent=titles[step];
    $('subhead').textContent=({connect:'',problem:'',research:'Finding the context that could change the plan.',plan:'Read it through. We’ll take it one step at a time.',work:''})[step];
    updateSend();
    $('send-note').textContent=step==='problem'?'Your words and relevant context go to your chosen AI.':$('send-note').textContent;
    renderAccounts();scheduleModelCheck();
    $('plan-text').textContent=state.onboarding?.plan||'';
  }
  $('notes-toggle').onclick=()=>{$('notebook').hidden=!$('notebook').hidden;$('layout').classList.toggle('with-notes',!$('notebook').hidden);};
  for(const provider of ['chatgpt','claude'])$('choose-'+provider).onclick=async()=>{
    accountAction=true;renderAccounts();
    try {
      await refreshModels();
      if(models[provider]?.connected){render(await act('provider',{provider}));}
      else {
        if(!readyProvider())render(await act('provider',{provider}));
        await signIn(provider);
      }
    }catch(err){error(err);}finally{accountAction=false;renderAccounts();}
  };
  $('connect-model').onclick=async()=>{
    accountAction=true;renderAccounts();
    try {
      await refreshModels();const provider=readyProvider();
      if(provider){
        render(await act('openJob'));render(await act('provider',{provider}));
        render(await act('modelReady'));status('');
      }else await signIn(state.provider);
    }catch(err){error(err);}finally{accountAction=false;renderAccounts();}
  };
  async function runPendingResearch(){
    const text=pendingResearch;if(!text)return;pendingResearch=null;
    $('research-browser').hidden=true;$('research-progress').hidden=false;$('research-stop').hidden=false;
    setBusy(true);
    try{render(await act('research',{text}));$('message').value='';status('Your plan is ready.');}
    catch(err){render(await native('state'));error(err);}finally{setBusy(false);}
  }
  $('skip-browser').onclick=runPendingResearch;
  $('research-stop').onclick=()=>fire('stop');
  $('accept-plan').onclick=()=>act('acceptPlan').then(render).catch(error);
  $('revise-plan').onclick=()=>act('reviseProblem').then(s=>{render(s);$('message').value=s.onboarding.draft;updateSend();}).catch(error);
  window.addEventListener('focus',()=>{if(state.onboarding?.stage==='connect')refreshModels();});
  native('openJob').then(s=>{render(s);refreshModels();refreshSetup();}).catch(error);
})();
