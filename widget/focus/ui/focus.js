/* Native owns IO. Provider and source text are always inserted as text nodes. */
(() => {
  const $=id=>document.getElementById(id),pending=new Map();
  let serial=0,state={problem:null,entries:[],provider:'chatgpt'},busy=false,listening=false,approvalId=null;
  function native(method,params={}) {
    return new Promise((resolve,reject)=>{
      if(!window.webkit?.messageHandlers?.focus){reject(new Error('Open the onejob desktop app to save notes and connect your AI.'));return;}
      const id=++serial;pending.set(id,{resolve,reject});window.webkit.messageHandlers.focus.postMessage({id,method,params});
    });
  }
  function status(text){$('voice-status').textContent=text;}
  function orb(mode){$('orb').querySelector('.orb').className='orb '+mode;}
  function error(error){status(error.message);}
  async function act(method,params){try{const result=await native(method,params);return result;}catch(e){error(e);throw e;}}
  function fire(method,params){native(method,params).catch(error);}
  window.focusReceive=message=>{
    if(message.event==='transcript') {$('message').value=message.text;status('Review your words, then send.');}
    else if(message.event==='voice') {listening=message.listening;$('mic').textContent=listening?'◉ Finish speaking':'◉ Speak';orb(listening?'listening':'notify');status(message.message);}
    else if(message.event==='speech') {orb(message.speaking?'talking':'notify');}
    else if(message.event==='error') error(new Error(message.message));
    else if(message.event==='accountChanged') refreshAccount();
    else if(message.event==='runProgress') status(message.message);
    else if(message.event==='toolApproval') {approvalId=message.id;$('tool-description').textContent=message.tool+' · '+message.connection+' → '+message.destination;$('tool-notice').textContent=message.notice;$('tool-arguments').textContent=JSON.stringify(message.arguments,null,2)+(message.preview?'\n\nPage excerpt (untrusted content):\n'+message.preview:'');$('approve-tool').disabled=false;$('decline-tool').disabled=false;$('tool-dialog').showModal();status('Waiting for your approval.');}
    else if(message.event==='toolProgress') {status(message.status+(message.summary?': '+message.summary:''));if(message.id===approvalId){$('tool-dialog').close();approvalId=null;}native('state').then(renderTools).catch(error);}
    else if(message.event==='contextChanged') {$('matches').replaceChildren();status('Your folder context has changed. Refresh Context to see the updates. The latest version will be used on Send.');}
    else if(message.event==='contextUnavailable') status(message.message);
    else {const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(new Error(message.error)):p.resolve(message.result);}}
  };
  function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
  function setBusy(value){busy=value;$('send').disabled=value;$('stop').hidden=!value;$('message').disabled=value;orb(value?'processing':'notify');$('save-connection').disabled=value;if(!value){$('tool-dialog').close();approvalId=null;}}
  function render(s){
    const changed=state.problem?.id!==s.problem?.id;
    if(changed){$('matches').replaceChildren();$('search-form').reset();$('source-form').reset();}
    state=s;renderTools(s);document.body.classList.toggle('has-problem',!!s.problem);
    $('brief-empty').hidden=!!s.problem;$('brief-form').hidden=!s.problem;
    $('source-form').querySelector('button').disabled=!s.problem;
    $('send').firstChild.textContent=s.problem?'Send ':'Start here ';
    $('send-note').textContent=s.problem?`Sending shares this problem, recent conversation, and relevant notes or folder excerpts with ${s.provider==='claude'?'your Claude Code client':'OpenAI through Codex'}. External tool actions require your review.`:'Your first problem brief is saved on this Mac.';
    $('provider').value=s.provider;providerView();
    if(s.problem){$('headline').textContent=s.problem.title;$('eyebrow').textContent='YOUR ONE THING';for(const [key,value]of Object.entries(s.problem.brief)){$('brief-form').elements.namedItem(key).value=value;}}
    else {$('headline').replaceChildren(node('span','What’s the one thing'),node('br'),node('span','you want to change?'));$('eyebrow').textContent='ONE THING. YOUR FULL ATTENTION.';}
    const messages=s.entries.filter(e=>['user','assistant'].includes(e.kind));
    $('conversation').replaceChildren(...messages.map(e=>{const el=node('div',undefined,'f-message '+e.kind);el.append(node('span',e.kind==='user'?'You':'onejob','f-speaker'),document.createTextNode(e.text));return el;}));
    $('conversation').scrollTop=$('conversation').scrollHeight;
    const memories=s.entries.filter(e=>!['user','assistant','source'].includes(e.kind)&&e.status!=='forgotten');
    $('memories').replaceChildren(...memories.map(e=>{const card=node('article',undefined,'f-card');card.append(node('span',e.kind+' · '+(e.status==='proposed'?'suggested':'kept'),'f-tag'),node('p',e.text));const d=node('details');d.append(node('summary','See supporting words'),node('blockquote',e.quote));const source=s.entries.find(x=>x.id===e.source_id);if(source)d.append(node('small',source.title||'From your conversation'));card.append(d);for(const action of e.status==='proposed'?['confirm','forget']:['forget']){const b=node('button',action==='confirm'?'Keep this':'Forget','f-quiet');b.onclick=()=>act('memory',{id:e.id,action}).then(render).catch(error);card.append(b);}return card;}));
    if(!memories.length)$('memories').append(node('p','As you talk, useful memories will appear here for you to review.','f-empty-small'));
    $('sources').replaceChildren(...s.entries.filter(e=>e.kind==='source').map(e=>{const card=node('details',undefined,'f-card');card.append(node('summary',e.title),node('p',e.text));return card;}));
    $('archives').replaceChildren(...(s.archives||[]).map(e=>{const b=node('button','Resume: '+e.title,'f-quiet');b.onclick=()=>act('restore',{id:e.id}).then(render).catch(error);return b;}));
    $('folders').replaceChildren(...(s.folders||[]).map(folder=>{const card=node('div',undefined,'f-card');card.append(node('p',folder.label));const remove=node('button','Stop syncing and forget imports','f-quiet');remove.onclick=()=>act('disconnectFolder',{id:folder.id}).then(s=>{$('matches').replaceChildren();render(s);}).catch(error);card.append(remove);return card;}));
    $('folder-status').textContent=s.folderScan?.partial?'Scan incomplete. Choose a smaller folder.':s.folderScan?`Last scanned ${new Date(s.folderScan.at).toLocaleTimeString()}. Search: ${s.searchMode}.`:'Folder indexing stays on this Mac.';
    $('choose-folder').disabled=!s.problem;
  }
  function renderTools(s) {
    $('connections').replaceChildren(...(s.connections||[]).map(c=>{const card=node('article',undefined,'f-card');card.append(node('span',c.kind,'f-tag'),node('p',c.name),node('small',c.url||'Aside local browser controls'));const remove=node('button','Disconnect','f-quiet');remove.disabled=busy;remove.onclick=()=>act('connection.remove',{id:c.id}).then(render).catch(error);card.append(remove);return card;}));
    $('actions').replaceChildren(...(s.actions||[]).map(a=>{const card=node('article',undefined,'f-card');card.append(node('span',a.status,'f-tag'),node('p',a.tool),node('small',a.summary));const details=node('details');details.append(node('summary','Show request'),node('pre',JSON.stringify(a.arguments,null,2)));card.append(details);return card;}));
    if(!s.actions?.length)$('actions').append(node('p','Tool steps will appear here as onejob works.','f-fine'));
  }
  function providerView(){$('chatgpt-settings').hidden=$('provider').value!=='chatgpt';$('claude-settings').hidden=$('provider').value!=='claude';}
  async function refreshAccount(){try{const a=await native('account');$('account-status').textContent=a.connected?'Connected to ChatGPT'+(a.plan?' · '+a.plan:''):'Not connected yet.';$('login').hidden=a.connected;$('logout').hidden=!a.connected;$('settings').textContent=a.connected?'AI connected ↗':'Connect your AI ↗';}catch(e){$('account-status').textContent=e.message;}}
  $('composer').onsubmit=async event=>{
    event.preventDefault();const text=$('message').value.trim();if(!text||busy)return;
    fire('stopSpeech');if(listening)fire('stopListening');
    try{
      if(!state.problem){render(await act('create',{title:text}));$('message').value='';status('Your problem is saved. What would a meaningful improvement look like?');return;}
      setBusy(true);status('Thinking about your problem…');const answer=await act('send',{text});render(answer);$('message').value='';status('Saved. Pick up here whenever you’re ready.');
      if($('spoken').checked){const reply=answer.entries.filter(e=>e.kind==='assistant').at(-1);if(reply)fire('speak',{text:reply.text});}
    }catch(e){const current=await native('state').catch(()=>state);render(current);error(e);}finally{setBusy(false);}
  };
  $('message').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('composer').requestSubmit();}};
  function toggleVoice(){if(busy)return;fire('stopSpeech');fire(listening?'stopListening':'startListening');}
  $('orb').onclick=toggleVoice;$('mic').onclick=toggleVoice;
  $('stop').onclick=()=>fire('stop');
  $('brief-form').onsubmit=e=>{e.preventDefault();const brief=Object.fromEntries(new FormData(e.target));act('brief',{brief}).then(s=>{render(s);status('Brief saved.');}).catch(error);};
  $('source-form').onsubmit=e=>{e.preventDefault();act('source',{title:$('source-title').value,text:$('source-text').value}).then(s=>{render(s);e.target.reset();status('Context saved to this problem.');}).catch(error);};
  $('search-form').onsubmit=e=>{e.preventDefault();act('retrieve',{query:$('search').value}).then(rows=>{$('matches').replaceChildren(...rows.map(row=>{const el=node('article',undefined,'f-card');el.append(node('span',row.title||row.kind,'f-tag'),node('p',row.text),node('small',row.retrieval?.includes('meaning')?'Related meaning'+(row.matched.length?' · '+row.matched.join(', '):''):'Matched: '+row.matched.join(', ')));return el;}));if(!rows.length)$('matches').append(node('p','No matching context yet.','f-empty-small'));}).catch(error);};
  $('choose-folder').onclick=()=>act('chooseFolder').then(result=>{if(!result.cancelled)render(result);}).catch(error);
  $('refresh-folders').onclick=()=>act('scanFolders').then(s=>{$('matches').replaceChildren();render(s);}).catch(error);
  document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-selected',String(b===button));$(b.dataset.tab+'-pane').hidden=b!==button;});});
  $('settings').onclick=()=>{$('account-dialog').showModal();refreshAccount();};$('close-settings').onclick=()=>$('account-dialog').close();
  $('provider').onchange=()=>act('provider',{provider:$('provider').value}).then(render).catch(e=>{$('provider').value=state.provider;providerView();error(e);});
  $('login').onclick=()=>act('login').then(r=>native('openAuth',{url:r.url})).catch(error);
  $('logout').onclick=()=>act('logout').then(refreshAccount).catch(error);
  $('claude-login').onclick=()=>fire('claudeLogin');
  $('archive').onclick=()=>$('archive-dialog').showModal();$('cancel-archive').onclick=()=>$('archive-dialog').close();
  $('confirm-archive').onclick=()=>act('archive').then(s=>{$('archive-dialog').close();render(s);status('Ready for your next important problem.');}).catch(error);
  $('spoken').onchange=()=>{if(!$('spoken').checked)fire('stopSpeech');};
  $('connection-kind').onchange=()=>{const aside=$('connection-kind').value==='aside';$('aside-fields').hidden=!aside;$('service-fields').hidden=aside;};
  $('connection-form').onsubmit=async e=>{e.preventDefault();try {const kind=$('connection-kind').value;const s=await act('connection.add',{kind,name:$('connection-name').value,url:$('connection-url').value,account:kind==='aside'?$('aside-account').value:$('credential-account').value,secretRef:kind==='aside'?'':$('credential-reference').value,localBrowserOnly:$('aside-local').checked});render(s);$('connection-status').textContent='Configuration saved. Access will be tested when you approve the first tool action.';}catch(err){$('connection-status').textContent=err.message;}};
  function decideTool(approved){const id=approvalId;if(!id)return;$('approve-tool').disabled=true;$('decline-tool').disabled=true;act('approval',{id,approved}).then(()=>{$('tool-dialog').close();approvalId=null;}).catch(error);}
  $('approve-tool').onclick=()=>decideTool(true);$('decline-tool').onclick=()=>decideTool(false);$('tool-dialog').oncancel=e=>{e.preventDefault();decideTool(false);};
  $('stop-tool-run').onclick=()=>{fire('stop');$('tool-dialog').close();approvalId=null;};
  $('show-artifacts').onclick=()=>fire('showArtifacts');
  native('state').then(render).catch(error);
})();
