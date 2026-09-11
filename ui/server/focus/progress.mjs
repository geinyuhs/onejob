const brief=value=>String(value||'').replace(/\s+/gu,' ').trim().slice(0,120);
function site(value){try{return new URL(value).hostname;}catch(error){return '';}}
export function toolProgress(tool,destination,args={},status='running') {
  const host=site(destination),where=host?' on '+host:'';
  const actions={
    'browser.open':host?'Opening '+host+'…':'Opening the approved page…',
    'browser.read':'Reading the page'+where+'…',
    'browser.click':'Clicking the approved control'+where+'…',
    'browser.fill':'Entering the approved text'+where+'…',
    'browser.press':'Using the approved control'+where+'…',
    'api.request':'Running the approved '+(args.method||'GET')+' request'+where+'…',
    'mcp.tools':'Checking available tools'+where+'…',
    'mcp.call':'Running '+brief(args.tool||'the approved service action')+where+'…',
    'memory.search':'Searching your saved notes…',
    'document.save':'Saving '+brief(args.name||'your document')+'…'
  };
  if(status==='completed')return tool.startsWith('browser.')?'Reviewing the page'+(host?' from '+host:'')+'…':tool==='document.save'?'Checking the saved document…':'Reviewing the '+(host?host+' ':'')+'result…';
  if(status==='declined')return 'Checking alternatives after the unapproved step…';
  if(status==='uncertain')return 'Checking what happened before taking another step…';
  return actions[tool]||'Running the approved step…';
}
export function inferenceProgress(context,lastStep) {
  if(lastStep)return toolProgress(lastStep.tool,lastStep.destination,lastStep.arguments,lastStep.status);
  const title=brief(context.problem?.title);
  return context.phase==='research'?(title?'Choosing sources for “'+title+'”…':'Choosing what to investigate…'):(title?'Reviewing the plan for “'+title+'”…':'Reviewing your plan and available connections…');
}
export function webProgress(action={},completed=false) {
  // Codex can emit a search item before its action details are available.
  action??={};
  const query=brief(action.query),host=site(action.url);
  if(completed)return query?'Reviewing search results for “'+query+'”…':host?'Reviewing findings from '+host+'…':'Reviewing web findings…';
  if(action.type==='search')return query?'Searching the web for “'+query+'”…':'Searching the web…';
  return host?'Reading '+host+'…':action.type?'Reading a public page…':'Checking public sources…';
}
