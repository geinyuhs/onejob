/* Native owns IO. Provider and source text are always inserted as text nodes. */
(() => {
  const $=id=>document.getElementById(id),pending=new Map();
  let serial=0,state={problem:null,entries:[],provider:'chatgpt'},busy=false,listening=false,approvalId=null,setupState=null,voicePrefix='',pendingResearch=null,transcribing=false;
  let models={chatgpt:{connected:false},claude:{connected:false}},modelsChecked=false,modelCheck=null,modelTimer=null,accountAction=false;
  let selectedChoices=new Set();
  let approvalSubmitting=false;
  let browserConnecting=false;
  let executionNo=false;
  let planDraft=null;
  let voiceTarget='message',voiceJob=null,voiceApproval=null;
  const voiceInputs=[['mic','message'],['tool-mic','tool-response'],['source-mic','source-text']];
  function confirmationQuestion(){return state.onboarding?.stage==='needsInput'&&state.execution?.responseType==='confirmation';}
  function native(method,params={}) {
    return new Promise((resolve,reject)=>{
      if(!window.webkit?.messageHandlers?.focus){reject(new Error('Open the onejob desktop app to save notes and connect your AI.'));return;}
      const id=++serial;pending.set(id,{resolve,reject});window.webkit.messageHandlers.focus.postMessage({id,method,params});
    });
  }
  function updateSend(){
    $('send').disabled=busy||transcribing||(!answerText()&&state.onboarding?.stage!=='attempts');
    $('send').firstChild.textContent=['problem','attempts','clarify','needsInput'].includes(state.onboarding?.stage)?'Continue ':listening?'Finish speaking ':'Send ';
    const loading=busy&&state.onboarding?.stage==='attempts';
    $('send').setAttribute('aria-busy',String(loading));
    $('send').setAttribute('aria-label',loading?'Loading questions':$('send').firstChild.textContent.trim());
    $('send').title=$('send').firstChild.textContent.trim();
    updateVoiceControls();
    for(const id of ['intake-back','skip-attempts','start-research','accept-plan','resume-plan','resume-results','execution-yes','execution-no'])$(id).disabled=busy||listening||transcribing;
    for(const button of $('clarification-options').children)button.disabled=busy||listening||transcribing;
    for(const id of ['plan-problem','plan-next','save-plan','cancel-plan-edit'])$(id).disabled=busy||listening||transcribing;
  }
  let researchStatus='Reading your answers…';
  function questionsLoading(){return busy&&state.onboarding?.stage==='attempts';}
  function status(text){$('voice-status').textContent=text;if(approvalId)$('tool-status').textContent=text==='Waiting for your answer…'?'':text;if(questionsLoading()||['research','executing'].includes(state.onboarding?.stage)){researchStatus=text||researchStatus;$('headline').textContent=researchStatus;}}
  function permissionQuestion(tool,usesOnePassword=false){if(usesOnePassword)return 'Can I use 1Password and perform this action?';return ({'browser.open':'Can I open this page?','browser.read':'Can I read this page?','browser.click':'Select this item?','browser.fill':'Can I enter this text?','browser.press':'Can I use this page control?','api.request':'Can I make this service request?','mcp.tools':'Can I check this service’s available tools?','mcp.call':'Can I run this service action?'})[tool]||'Can I do this?';}
  function reviewArguments(message){
    if(['browser.open','browser.read','mcp.tools'].includes(message.tool))return '';
    return JSON.stringify(message.arguments||{},null,2)+(message.preview?'\n\n'+message.preview:'');
  }
  function showScreenshot(value){
    const image=$('tool-screenshot');
    const safe=typeof value==='string'&&value.length<=2000030&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
    image.hidden=!safe;image.src=safe?value:'';
    image.onerror=()=>{image.hidden=true;};
  }
  function toolStatus(message){
    if(message.message)return message.message;
    if(message.status==='running')return ({'memory.search':'Searching your notes…','document.save':'Saving a document…','browser.open':'Opening a research page…','browser.read':'Reading a page…','browser.click':'Following a link or page control…','browser.fill':'Entering the approved text…','browser.press':'Using the approved page control…','api.request':'Checking a connected service…','mcp.tools':'Checking available tools…','mcp.call':'Running the approved tool…'})[message.tool]||'Running the approved step…';
    return ({completed:'Reviewing the result…',declined:'That step was not completed. Reviewing the next step…',uncertain:'That step could not be confirmed. Reviewing what happened…'})[message.status]||'Waiting for the next step…';
  }
  function error(error){status(error.message);}
  async function act(method,params){try{const result=await native(method,params);return result;}catch(e){error(e);throw e;}}
  function fire(method,params){native(method,params).catch(error);}
  window.focusReceive=message=>{
    if(message.event==='transcript') {if(voiceJob&&voiceJob!==state.problem?.id||voiceTarget==='tool-response'&&voiceApproval!==approvalId)return;$(voiceTarget).value=[voicePrefix,message.text].filter(Boolean).join(' ');status('Review your words, then send.');if(voiceTarget==='message')saveDraft();else if(voiceTarget==='tool-response')updatePermission();}
    else if(message.event==='voice') {listening=message.listening;transcribing=!!message.transcribing;updateSend();updatePermission();status(message.message);}
    else if(message.event==='voiceSetup') {$('voice-setup-status').textContent=message.message;}
    else if(message.event==='speech') { /* Native speech has no in-window avatar. */ }
    else if(message.event==='error') error(new Error(message.message));
    else if(message.event==='accountChanged') refreshModels();
    else if(message.event==='runProgress') {status(message.message);}
    else if(message.event==='jobSelected') {render(message.state);status('');startApprovedPlan().catch(error);}
    else if(message.event==='toolApproval') {showScreenshot(message.screenshot);approvalId=message.id;placeAutoMode();approvalSubmitting=false;$('tool-question').textContent=permissionQuestion(message.tool,message.usesOnePassword===true);$('tool-description').textContent=message.destination;$('tool-arguments').textContent=reviewArguments(message);$('tool-arguments').hidden=!$('tool-arguments').textContent;$('tool-response').value='';$('tool-response-form').hidden=true;$('decline-tool').setAttribute('aria-expanded','false');$('tool-response-error').textContent='';updatePermission();$('tool-step').hidden=false;document.body.classList.toggle('has-approval',true);$('tool-question').focus?.();status('Waiting for your answer…');}
    else if(message.event==='setupChanged') {refreshSetup();native('state').then(renderTools).catch(error);}
    else if(message.event==='setupNotice') status(message.message);
    else if(message.event==='toolProgress') {status(toolStatus(message));if(message.id===approvalId){closePermission();}native('state').then(renderTools).catch(error);}
    else if(message.event==='contextChanged') {$('matches').replaceChildren();if(!busy&&!approvalId)status('Your job folder is up to date.');}
    else if(message.event==='contextUnavailable') {if(!busy&&!approvalId)status(message.message);}
    else {const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(new Error(message.error)):p.resolve(message.result);}}
  };
  function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
  function setBusy(value){busy=value;updateSend();$('stop').hidden=!value;$('message').disabled=value;$('save-connection').disabled=value;updateBrowserConnect();for(const button of $('service-cards').querySelectorAll?.('button')||[])button.disabled=value;if(!value){closePermission();}if(state.onboarding?.stage==='attempts')renderStep();}
  function render(s){
    const changed=state.problem?.id!==s.problem?.id;
    const stepChanged=state.onboarding?.stage!==s.onboarding?.stage;
    const questionChanged=state.clarification?.token!==s.clarification?.token||state.clarification?.responses.length!==s.clarification?.responses.length;
    if(changed||stepChanged||state.execution?.question!==s.execution?.question)executionNo=false;
    if(changed||stepChanged)planDraft=null;
    if(changed){$('matches').replaceChildren();$('search-form').reset();$('source-form').reset();}
    if(changed){$('message').value=s.onboarding?.draft||'';voicePrefix='';pendingResearch=null;$('notebook').hidden=true;}
    if(changed||stepChanged||questionChanged){$('message').value=s.onboarding?.stage==='clarify'?(s.clarification?.draft||''):s.onboarding?.stage==='attempts'?(s.problem?.brief.tried||''):s.onboarding?.stage==='problem'?(s.onboarding?.draft||''):'';voicePrefix='';}
    if(changed||stepChanged||questionChanged)selectedChoices=new Set(s.onboarding?.stage==='clarify'?(s.clarification?.draftChoices||[]):[]);
    state=s;renderTools(s);document.body.classList.toggle('has-problem',!!s.problem);
    $('brief-empty').hidden=!!s.problem;$('brief-form').hidden=!s.problem;
    $('save-source').disabled=!s.problem;
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
    $('folders').replaceChildren(...(s.folders||[]).filter(folder=>!folder.managed&&folder.label!==('Job-'+s.problem?.id)).map(folder=>{const card=node('div',undefined,'f-card');card.append(node('p',folder.label));const remove=node('button','Stop syncing and forget imports','f-quiet');remove.onclick=()=>act('disconnectFolder',{id:folder.id}).then(s=>{$('matches').replaceChildren();render(s);}).catch(error);card.append(remove);return card;}));
    renderStep();
    $('folder-status').textContent=s.folderScan?.partial?'Too many files to read. Move some out of your job folder.':s.problem?'Desktop → onejob · Updates automatically.':'Desktop → onejob. Start a problem to get its own folder.';
  }
  function renderTools(s) {
    if(Object.hasOwn(s,'autoMode')){$('auto-mode').checked=!!s.autoMode;state.autoMode=!!s.autoMode;}
    $('connections').replaceChildren(...(s.connections||[]).map(c=>{const card=node('article',undefined,'f-card');card.append(node('span',c.kind,'f-tag'),node('p',c.name),node('small',c.url||'Aside local browser controls'));const remove=node('button','Disconnect','f-quiet');remove.disabled=busy;remove.onclick=()=>act('connection.remove',{id:c.id}).then(s=>{render(s);refreshSetup();}).catch(error);card.append(remove);return card;}));
    $('actions').replaceChildren(...(s.actions||[]).map(a=>{const card=node('article',undefined,'f-card');card.append(node('span',a.status,'f-tag'),node('p',a.tool),node('small',a.summary));const details=node('details');details.append(node('summary','Show request'),node('pre',JSON.stringify(a.arguments,null,2)));card.append(details);return card;}));
    if(!s.actions?.length)$('actions').append(node('p','Tool steps will appear here as onejob works.','f-fine'));
  }
  async function refreshSetup(){
    const previousProfile=$('browser-profile').value;
    try {setupState=await native('setup');const s=setupState;
      renderAsideConnection();
      $('browser-status').textContent=s.asideConnection?'Connected.':s.clients.aside?(s.profiles.length?'Aside found.':'Open an Aside window, then try again.'):'In Aside, enable the CLI in Settings → Developer.';
      $('browser-form').hidden=!!s.asideConnection;$('open-aside').hidden=!s.clients.asideApp;
      $('browser-profile-label').hidden=s.profiles.length<=1;$('browser-profile').replaceChildren(...s.profiles.map(id=>{const option=node('option','Aside profile '+id);option.value=id;return option;}));
      $('browser-profile').value=s.profiles.includes(previousProfile)?previousProfile:(s.profiles[0]||'');
      updateBrowserConnect();
      $('installed-clients').textContent=[s.clients.chatgpt?'Codex detected':null,s.clients.claude?'Claude Code detected':null].filter(Boolean).join(' · ')||'Install Codex or Claude Code to connect your AI.';
      $('service-cards').replaceChildren(...s.services.map(service=>{const card=node('article',undefined,'f-card');card.append(node('h3',service.name),node('p',service.description),node('small',service.status));
        const button=node('button',service.status==='connected'?'Reconnect':'Connect','f-quiet');button.disabled=busy||service.status==='awaiting sign-in';button.onclick=async()=>{button.disabled=true;try{const r=await act('service.connect',{service:service.id});await native('openServiceAuth',{url:r.url});await refreshSetup();}catch(err){$('setup-status').textContent=err.message;button.disabled=false;}};card.append(button);
        if(service.status==='awaiting sign-in'){const cancel=node('button','Cancel sign-in','f-quiet');cancel.onclick=()=>act('service.cancel',{service:service.id}).then(refreshSetup).catch(error);card.append(cancel);}return card;}));
    }catch(err){setupState=null;renderAsideConnection();updateBrowserConnect();$('browser-status').textContent=err.message;}
  }
  function renderAsideConnection(){
    const connected=!!setupState?.asideConnection;
    $('aside-connected').hidden=!connected;
    $('choose-aside').setAttribute('aria-label',connected?'Aside, browser connected':'Aside, connect browser');
    $('choose-aside').title=connected?'Aside · Connected':'Aside · Connect browser';
  }
  function openBrowserSetup(){$('browser-dialog-slot').append($('browser-card'));$('browser-dialog').showModal();refreshSetup();}
  $('choose-aside').onclick=openBrowserSetup;
  function closeBrowserSetup(){$('browser-dialog').close();$('browser-home').append($('browser-card'));}
  $('close-browser').onclick=closeBrowserSetup;
  $('skip-aside').onclick=closeBrowserSetup;
  $('browser-dialog').oncancel=event=>{event.preventDefault();closeBrowserSetup();};
  $('refresh-setup').onclick=refreshSetup;$('open-aside').onclick=()=>fire('openAside');
  function updateBrowserConnect(){$('connect-browser').disabled=busy||browserConnecting||!setupState?.clients.aside||!setupState?.profiles.length;$('connect-browser').textContent=browserConnecting?'Connecting…':'Connect Aside';$('connect-browser').setAttribute('aria-busy',String(browserConnecting));}
  $('browser-profile').onchange=updateBrowserConnect;
  $('browser-form').onsubmit=async event=>{
    event.preventDefault();updateBrowserConnect();if($('connect-browser').disabled)return;
    const connectedJob=state.problem?.id;
    browserConnecting=true;updateBrowserConnect();renderAccounts();
    try{await act('aside.connect',{profile:$('browser-profile').value||setupState.profiles[0],browserAccessApproved:true});await refreshSetup();const current=await native('state');if(current.problem?.id!==connectedJob)return;render(current);if(setupState?.asideConnection)closeBrowserSetup();await startApprovedPlan();}
    catch(err){$('browser-status').textContent=err.message;}
    finally{browserConnecting=false;updateBrowserConnect();renderAccounts();}
  };
  function providerView(){$('chatgpt-settings').hidden=$('provider').value!=='chatgpt';$('claude-settings').hidden=$('provider').value!=='claude';}
  function readyProvider(){return models[state.provider]?.connected?state.provider:['chatgpt','claude'].find(provider=>models[provider]?.connected);}
  function renderAccounts(){
    const selected=readyProvider()||state.provider;
    for(const provider of ['chatgpt','claude']){
      const connected=models[provider]?.connected===true,name=provider==='claude'?'Claude':'ChatGPT';
      $('choose-'+provider).setAttribute('aria-pressed',String(provider===selected));
      $('choose-'+provider).setAttribute('aria-label',name+(connected?', connected':', sign in'));
      $('choose-'+provider).title=name+(connected?' · Connected':' · Sign in');
      $('choose-'+provider).disabled=accountAction||browserConnecting;
      $(provider+'-connected').hidden=!connected;
    }
    $('connect-model').textContent=readyProvider()?'Continue':modelsChecked?'Sign in with '+(state.provider==='claude'?'Claude':'ChatGPT'):'Checking accounts…';
    $('connect-model').disabled=accountAction||browserConnecting||!modelsChecked;
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
    const text=answerText();if(!text&&state.onboarding?.stage!=='attempts')return;
    try{
      if(!state.problem)return;
      if(state.onboarding?.stage==='problem'){setBusy(true);render(await act('describe',{text}));status('');return;}
      if(state.onboarding?.stage==='attempts'){setBusy(true);status('Preparing your follow-up questions…');render(await act('clarify',{id:state.problem.id,tried:text}));status('');await beginResearch();return;}
      if(state.onboarding?.stage==='clarify'){setBusy(true);render(await act('answerClarification',{...questionParams(),text:$('message').value,choices:[...selectedChoices]}));status('');await beginResearch();return;}
      if(state.onboarding?.stage==='needsInput'){await runPlan('continuePlan',{text:confirmationQuestion()&&executionNo?'No. '+text:text});return;}
      setBusy(true);status('Thinking about your problem…');const answer=await act('send',{text});render(answer);$('message').value='';status('Saved. Pick up here whenever you’re ready.');
      if($('spoken').checked){const reply=answer.entries.filter(e=>e.kind==='assistant').at(-1);if(reply)fire('speak',{text:reply.text});}
    }catch(e){const current=await native('state').catch(error=>state);render(current);error(e);}finally{setBusy(false);}
  };
  function questionParams(){return {id:state.problem.id,token:state.clarification?.token,index:state.clarification?.responses.length};}
  $('skip-attempts').onclick=async()=>{
    if(state.onboarding?.stage!=='attempts'||busy||listening||transcribing)return;
    const draft=$('message').value;$('message').value='';
    await $('composer').onsubmit({preventDefault(){}});
    if(state.onboarding?.stage==='attempts'){$('message').value=draft;updateSend();}
  };
  function answerText(){return state.onboarding?.stage==='clarify'?[...[...selectedChoices].map(index=>state.clarification.questions[state.clarification.responses.length].options[index]),$('message').value.trim()].filter(Boolean).join('\n'):$('message').value.trim();}
  function saveDraft(){updateSend();if(state.onboarding?.stage==='clarify')fire('saveDraft',{...questionParams(),field:'clarification',text:$('message').value,choices:[...selectedChoices]});else if(['problem','attempts'].includes(state.onboarding?.stage))fire('saveDraft',{id:state.problem.id,text:$('message').value,field:state.onboarding.stage==='attempts'?'tried':'draft'});}
  $('message').oninput=saveDraft;
  $('message').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('composer').requestSubmit();}};
  function updateVoiceControls(){for(const [id,target] of voiceInputs){const active=listening&&target===voiceTarget;$(id).disabled=transcribing||(listening&&target!==voiceTarget)||(busy&&target!=='tool-response')||(target==='tool-response'&&approvalSubmitting);$(id).setAttribute('aria-pressed',String(active));$(id).setAttribute('aria-label',active?'Finish speaking':transcribing?'Transcribing':'Start dictation');$(id).title=active?'Finish speaking':transcribing?'Transcribing':'Start dictation';}}
  function toggleVoice(target='message'){if((busy&&target!=='tool-response')||transcribing||approvalSubmitting||(listening&&target!==voiceTarget))return;if(!listening){voiceTarget=target;voiceJob=state.problem?.id;voiceApproval=approvalId;voicePrefix=$(target).value.trim();}fire('stopSpeech');fire(listening?'stopListening':'startListening');}
  for(const [id,target] of voiceInputs)$(id).onclick=()=>toggleVoice(target);
  function holdForTranscript(){if(!listening&&!transcribing)return false;if(listening){transcribing=true;fire('stopListening');}updateSend();updatePermission();return true;}
  $('stop').onclick=()=>fire('stop');
  $('brief-form').onsubmit=e=>{e.preventDefault();const brief=Object.fromEntries(new FormData(e.target));act('brief',{brief}).then(s=>{render(s);status('Brief saved.');}).catch(error);};
  $('source-form').onsubmit=e=>{e.preventDefault();if(holdForTranscript())return;act('source',{title:'Added note',text:$('source-text').value}).then(s=>{render(s);e.target.reset();status('Context saved to this problem.');}).catch(error);};
  $('search-form').onsubmit=e=>{e.preventDefault();act('retrieve',{query:$('search').value}).then(rows=>{$('matches').replaceChildren(...rows.map(row=>{const el=node('article',undefined,'f-card');el.append(node('span',row.title||row.kind,'f-tag'),node('p',row.text),node('small',row.retrieval?.includes('meaning')?'Related meaning'+(row.matched.length?' · '+row.matched.join(', '):''):'Matched: '+row.matched.join(', ')));return el;}));if(!rows.length)$('matches').append(node('p','No matching context yet.','f-empty-small'));}).catch(error);};
  $('open-workspace').onclick=()=>fire('showWorkspace');
  document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-selected',String(b===button));$(b.dataset.tab+'-pane').hidden=b!==button;});});
  $('settings').onclick=()=>{$('account-dialog').showModal();refreshAccount();refreshSetup();refreshThinkingModes();};$('close-settings').onclick=()=>$('account-dialog').close();
  $('manage-tools').onclick=()=>{$('account-dialog').close();$('tools-dialog-slot').append($('tools-pane'));$('tools-pane').hidden=false;$('tools-dialog').showModal();refreshSetup();};
  $('close-tools').onclick=()=>$('tools-dialog').close();
  $('tools-dialog').onclose=()=>{$('tools-home').append($('tools-pane'));$('tools-pane').hidden=true;};
  window.addEventListener('keydown',event=>{if(event.metaKey&&event.key===','){event.preventDefault();$('settings').onclick();}});
  async function refreshThinkingModes(){
    const select=$('thinking-mode');select.disabled=true;
    try{
      const modes=await native('thinkingModes');
      const choices=[node('option','Codex default'),...modes.options.map(mode=>{const option=node('option',mode.reasoningEffort);option.value=mode.reasoningEffort;option.title=mode.description;return option;})];
      choices[0].value='';select.replaceChildren(...choices);select.value=state.reasoningEffort||'';
      $('thinking-status').textContent='Astra · Codex default: '+modes.defaultEffort;select.disabled=busy;
    }catch(err){$('thinking-status').textContent=err.message;}
  }
  $('thinking-mode').onchange=async()=>{const select=$('thinking-mode');select.disabled=true;try{render(await act('reasoningEffort',{effort:select.value||null}));}catch(err){select.value=state.reasoningEffort||'';error(err);}finally{select.disabled=busy;}};
  $('provider').onchange=()=>act('provider',{provider:$('provider').value}).then(render).catch(e=>{$('provider').value=state.provider;providerView();error(e);});
  $('login').onclick=()=>act('login').then(r=>native('openAuth',{url:r.url})).catch(error);
  $('logout').onclick=()=>act('logout').then(refreshAccount).catch(error);
  $('claude-login').onclick=()=>fire('claudeLogin');
  $('archive').onclick=()=>$('archive-dialog').showModal();$('cancel-archive').onclick=()=>$('archive-dialog').close();
  $('confirm-archive').onclick=()=>{fire('stopListening');return act('archive').then(s=>{$('archive-dialog').close();render(s);status('Ready for your next important problem.');}).catch(error);};
  $('spoken').onchange=()=>{if(!$('spoken').checked)fire('stopSpeech');};
  $('connection-kind').onchange=()=>{const aside=$('connection-kind').value==='aside';$('aside-fields').hidden=!aside;$('service-fields').hidden=aside;};
  $('connection-form').onsubmit=async e=>{e.preventDefault();try {const kind=$('connection-kind').value;const s=await act('connection.add',{kind,name:$('connection-name').value,url:$('connection-url').value,account:kind==='aside'?$('aside-account').value:$('credential-account').value,secretRef:kind==='aside'?'':$('credential-reference').value,usernameRef:kind==='login'?$('username-reference').value:'',browserAccessApproved:kind==='aside'});render(s);$('connection-status').textContent='Configuration saved. Access will be tested when you approve the first tool action.';}catch(err){$('connection-status').textContent=err.message;}};
  function placeAutoMode(){$(approvalId?'tool-auto-slot':state.onboarding?.stage==='executing'?'execution-auto-slot':state.onboarding?.stage==='executionPaused'?'paused-auto-slot':state.onboarding?.stage==='results'&&state.execution?.status==='blocked'?'results-auto-slot':state.onboarding?.stage==='plan'?'plan-auto-slot':'auto-mode-home').append($('auto-mode-control'));}
  function closePermission(){approvalId=null;showScreenshot(null);$('tool-step').hidden=true;document.body.classList.toggle('has-approval',false);placeAutoMode();}
  function updatePermission(){for(const id of ['approve-tool','decline-tool','tool-response'])$(id).disabled=approvalSubmitting;$('send-tool-response').disabled=approvalSubmitting||transcribing||!$('tool-response').value.trim();updateVoiceControls();}
  async function decideTool(approved,text=''){
    const id=approvalId;if(!id||approvalSubmitting)return;
    approvalSubmitting=true;updatePermission();$('tool-response-error').textContent='';status('Sending your answer…');
    try{await act('approval',{id,approved,...(text?{text}:{})});if(approvalId===id){closePermission();}}
    catch(err){if(approvalId===id){approvalSubmitting=false;updatePermission();$('tool-response-error').textContent=err.message;status('Your answer wasn’t sent. Try again.');}}
  }
  $('tool-response').oninput=updatePermission;
  $('auto-mode').onchange=async()=>{
    const problemId=state.problem?.id,enabled=$('auto-mode').checked;
    $('auto-mode').disabled=true;
    try{const result=await act('autoMode',{problemId,enabled});if(state.problem?.id===problemId){state.autoMode=result.autoMode;$('auto-mode').checked=!!result.autoMode;}}
    catch(err){$('auto-mode').checked=!!state.autoMode;error(err);}
    finally{$('auto-mode').disabled=false;}
  };
  $('tool-response-form').onsubmit=event=>{event.preventDefault();if(holdForTranscript())return;const text=$('tool-response').value.trim();if(!text)return;return decideTool(false,text);};
  $('approve-tool').onclick=()=>decideTool(true);$('decline-tool').onclick=()=>{if(!approvalId||approvalSubmitting)return;$('tool-response-form').hidden=false;$('decline-tool').setAttribute('aria-expanded','true');$('tool-response').focus?.();};
  $('stop-tool-run').onclick=()=>{fire('stop');closePermission();};
  $('voice-key').onclick=()=>fire('chooseVoiceKey');
  $('show-artifacts').onclick=()=>fire('showArtifacts');
  function renderStep(){
    placeAutoMode();
    $('auto-mode-control').hidden=!state.problem||!['plan','executing','executionPaused','needsInput','results','work'].includes(state.onboarding?.stage);
    const savedStep=state.problem?(state.onboarding?.stage||'work'):'connect';
    const legacyPlan=savedStep==='work'&&state.onboarding?.plan&&!state.execution;
    const step=questionsLoading()?'research':legacyPlan?'executing':savedStep;
    const question=state.clarification?.questions[state.clarification.responses.length];
    document.body.dataset.step=step;document.body.dataset.responseType=confirmationQuestion()?'confirmation':'text';document.body.classList.toggle('has-problem',step==='work');
    for(const name of ['connect','research','plan','researchReady','executing','executionPaused'])$(name+'-step').hidden=name!==step;
    $('execution-result').hidden=step!=='results';
    $('resume-results').hidden=step!=='results'||state.execution?.status!=='blocked';
    $('resume-results').disabled=busy||listening||transcribing;
    $('execution-text').textContent=step==='results'?(state.execution?.reply||''):'';
    $('scheduled-actions-section').hidden=step!=='results'||!state.execution?.researchOnly||state.execution?.status!=='completed';
    $('scheduled-actions').textContent='';
    $('execution-choices').hidden=!confirmationQuestion();$('execution-no').setAttribute('aria-pressed',String(executionNo));
    $('research-stop').hidden=false;
    $('research-stop').textContent=questionsLoading()?'Stop':'Stop research';
    $('compose-area').hidden=!['problem','attempts','clarify','work','needsInput'].includes(step)||(confirmationQuestion()&&!executionNo);
    $('intake-back').hidden=!['attempts','clarify','researchReady'].includes(step);
    $('skip-attempts').hidden=step!=='attempts';
    $('message').maxLength=['attempts','clarify'].includes(step)?4000:16000;
    $('message').placeholder=confirmationQuestion()?'What should I do differently?':['clarify','needsInput'].includes(step)?'Your own answer…':step==='attempts'?'What did you try, and how did it go?':'brain dump it';
    $('message').setAttribute('aria-label',confirmationQuestion()?'What should I do differently?':step==='clarify'?'Your own answer':step==='attempts'?'What have you tried so far? (optional)':'Your message');
    $('conversation').hidden=step!=='work';$('notes-toggle').hidden=!['work','plan'].includes(step);
    if(!['work','plan','needsInput'].includes(step))$('notebook').hidden=true;
    $('layout').classList.toggle('with-notes',!$('notebook').hidden);
    const titles={connect:'connect your apps',problem:'whats my one job?',attempts:'What have you tried so far?',clarify:question?.question||'A few quick questions.',researchReady:'Research paused.',research:researchStatus,plan:'Research plan',executing:legacyPlan?'Starting your research…':researchStatus,executionPaused:'Work paused.',results:state.execution?.researchOnly?(state.execution.status==='completed'?'Research complete.':'Research incomplete.'):(state.execution?.status==='blocked'?'Some work is blocked.':'the results'),needsInput:state.execution?.question||'One thing I need.'};
    $('headline').setAttribute('aria-live',['research','executing'].includes(step)?'polite':'off');
    if(titles[step])$('headline').textContent=titles[step];
    $('subhead').textContent=({researchReady:'Your answers are saved.'})[step]||'';
    $('clarification-progress').hidden=step!=='clarify';
    $('clarification-progress').textContent=question?`Question ${state.clarification.responses.length+1} of ${state.clarification.questions.length}`:'';
    $('clarification-options').hidden=step!=='clarify';
    $('clarification-options').replaceChildren(...(question?.options||[]).map((option,index)=>{const button=node('button',option+(question.recommendedIndex===index?' (Recommended)':''),'f-clarification-option');button.type='button';button.setAttribute('aria-pressed',String(selectedChoices.has(index)));button.onclick=()=>toggleAnswer(index);return button;}));
    updateSend();
    $('send-note').textContent=step==='problem'?'Your words and relevant context go to your chosen AI.':$('send-note').textContent;
    renderAccounts();scheduleModelCheck();
    renderPlanEditor();
  }
  function planParts(){const [problem,...rest]=(state.onboarding?.plan||'').split(/\r?\n[ \t]*\r?\n/);return state.onboarding?.planParts||{problem,research:rest.join('\n\n')};}
  function sizePlanEditor(el){el.style.height='auto';el.style.height=el.scrollHeight+'px';}
  function renderPlanEditor(){
    const parts=planDraft||planParts();
    for(const [id,key] of [['plan-problem','problem'],['plan-next','research']]){$(id).value=parts[key];}
    $('plan-next-section').hidden=!parts.research&&!planDraft;
    for(const id of ['plan-problem','plan-next'])sizePlanEditor($(id));
    $('plan-edit-actions').hidden=!planDraft;
    $('accept-plan').textContent=planDraft?'Save & continue':'continue';
  }
  for(const id of ['plan-problem','plan-next'])$(id).oninput=()=>{
    planDraft={id:state.problem.id,expectedPlan:planDraft?.expectedPlan??state.onboarding.plan,problem:$('plan-problem').value,research:$('plan-next').value};
    sizePlanEditor($(id));$('plan-edit-actions').hidden=false;$('accept-plan').textContent='Save & continue';
  };
  async function savePlanEdits(){
    if(!planDraft)return true;
    if(busy||listening||transcribing)return false;
    setBusy(true);
    try{const saved=await act('editPlan',planDraft);planDraft=null;render(saved);status('Edits saved.');return true;}
    catch(err){error(err);return false;}
    finally{setBusy(false);}
  }
  $('save-plan').onclick=savePlanEdits;
  $('cancel-plan-edit').onclick=()=>{planDraft=null;renderPlanEditor();};
  window.addEventListener('resize',()=>{for(const id of ['plan-problem','plan-next'])sizePlanEditor($(id));});
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
    const params=pendingResearch;if(!params)return;pendingResearch=null;
    $('research-stop').hidden=false;
    setBusy(true);status('Reading your answers…');
    try{render(await act('research',params));$('message').value='';status('Your plan is ready.');}
    catch(err){render(await native('state'));error(err);}finally{setBusy(false);}
  }
  function toggleAnswer(index){
    if(busy||listening||transcribing)return;
    if(selectedChoices.has(index))selectedChoices.delete(index);else selectedChoices.add(index);
    $('clarification-options').children[index].setAttribute('aria-pressed',String(selectedChoices.has(index)));saveDraft();
  }
  async function beginResearch(){
    if(state.onboarding?.stage!=='researchReady'||pendingResearch)return;
    researchStatus='Reading your answers…';pendingResearch={};state.onboarding.stage='research';renderStep();
    await runPendingResearch();
  }
  $('start-research').onclick=async()=>{if(busy)return;await beginResearch();};
  $('intake-back').onclick=async()=>{
    if(busy||listening||transcribing)return;
    setBusy(true);try{
      const step=state.onboarding.stage;
      if(step==='attempts')await act('saveDraft',{id:state.problem.id,field:'tried',text:$('message').value});
      if(step==='clarify')await act('saveDraft',{...questionParams(),field:'clarification',text:$('message').value,choices:[...selectedChoices]});
      render(await act(step==='attempts'?'reviseProblem':'reviseAttempts'));status('');
    }catch(err){error(err);}finally{setBusy(false);}
  };
  $('research-stop').onclick=()=>{if(pendingResearch){pendingResearch=null;state.onboarding.stage='researchReady';renderStep();status('Research paused.');}else fire('stop');};
  async function runPlan(method,params={}) {
    if(busy||listening||transcribing)return;
    const draft=$('message').value,rejected=executionNo;
    setBusy(true);researchStatus=method==='resumeWithBrowser'?'Checking your browser connection…':'Starting your research…';state.onboarding.stage='executing';renderStep();status(researchStatus);
    try{render(await act(method,params));$('message').value='';status('');}
    catch(err){render(await native('state'));executionNo=rejected;renderStep();$('message').value=draft;updateSend();error(err);}
    finally{setBusy(false);}
  }
  $('accept-plan').onclick=()=>planDraft?savePlanEdits().then(saved=>saved?runPlan('acceptPlan'):undefined):runPlan('acceptPlan');
  $('resume-plan').onclick=()=>runPlan('continuePlan');
  $('resume-results').onclick=()=>runPlan('continuePlan');
  async function startApprovedPlan() {
    if(state.canResumeWithBrowser && state.onboarding?.stage==='needsInput'){await runPlan('resumeWithBrowser',{id:state.problem.id});return;}
    if(state.onboarding?.stage!=='work'||!state.onboarding.plan||state.execution)return;
    await runPlan('continuePlan');
  }
  $('execution-stop').onclick=()=>fire('stop');
  $('execution-yes').onclick=()=>{if(!confirmationQuestion()||busy||listening||transcribing)return;return runPlan('continuePlan',{text:'Yes.'});};
  $('execution-no').onclick=()=>{if(!confirmationQuestion()||busy||listening||transcribing)return;executionNo=true;renderStep();$('message').focus?.();};
  window.addEventListener('focus',()=>{if(state.onboarding?.stage==='connect')refreshModels();});
  native('openJob').then(s=>{render(s);refreshModels();refreshSetup();return startApprovedPlan();}).catch(error);
})();
