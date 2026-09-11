import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {executable,clientEnvironment} from '../clients.mjs';
import {relativeURL,serviceURL} from './connections.mjs';
import {redact} from './credentials.mjs';
import {checkLoginElement,withPrivateCredential,transferDirectory} from './login.mjs';
import {navigationEvidence} from './auto.mjs';
import {collectTextNodes,concealFields,revealFields} from './vision.mjs';
import {validateScroll,scrollViewport,scrollContainer} from './scroll.mjs';
import {CredentialMasks} from './credential-masks.mjs';

export async function responseText(response,max=Infinity) {
  let text='';const decoder=new TextDecoder();const reader=response.body?.getReader();if(!reader)return text;
  try {while(true){const {done,value}=await reader.read();if(done)break;text+=decoder.decode(value,{stream:true});if(text.length>max)throw new Error('The tool response is too large. Narrow the request.');}return text+decoder.decode();}
  finally {await reader.cancel().catch(error=>{});}
}
export async function apiRequest(connection,args,secret,signal,fetcher=fetch) {
  const url=relativeURL(connection.url,args.path);
  const method=String(args.method||'GET').toUpperCase();
  if (!['GET','POST','PUT','PATCH','DELETE'].includes(method)) throw new Error('Unsupported API method.');
  const response=await fetcher(url,{method,headers:{Accept:'application/json',...(secret?{Authorization:'Bearer '+secret}:{}),...(method!=='GET'?{'Content-Type':'application/json'}:{})},body:method==='GET'?undefined:JSON.stringify(args.body??{}),redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(45000)])});
  // Redirects never receive credentials or automatically repeat a write.
  if(response.status>=300 && response.status<400)throw new Error('API redirect blocked. Configure the final service URL explicitly.');
  const text=await responseText(response);let body;try {body=JSON.parse(text);}catch(error){body=text;}
  return {status:response.status,ok:response.ok,body:redact(body,[secret]),url:url.href};
}
export class MCPAdapter {
  constructor() {this.clients=new Map();}
  async connect(connection,secret) {
    const client=new Client({name:'onejob',version:'0.2.0'});
    const base=serviceURL(connection.url,{local:true});
    const boundedFetch=(input,options={})=>{
      const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
      if(target.origin!==base.origin)throw new Error('MCP transport attempted a different destination.');
      return fetch(input,{...options,redirect:'error',signal:options.signal||AbortSignal.timeout(45000)});
    };
    // One explicit transport; no fallback that could replay a request.
    const transport=new StreamableHTTPClientTransport(base,{requestInit:{headers:secret?{Authorization:'Bearer '+secret}:{}},fetch:boundedFetch});
    try {await client.connect(transport,{timeout:45000});return client;}
    catch(error){await client.close().catch(closeError=>{});throw new Error('MCP connection failed. Check its URL and 1Password bearer-token reference.');}
  }
  async call(connection,args,secret,signal) {
    const client=await this.connect(connection,secret);
    const cancel=()=>{client.close().catch(error=>{});};signal.addEventListener('abort',cancel,{once:true});
    try {
      signal.throwIfAborted();
      const result=args.operation==='list'?await client.listTools():await client.callTool({name:args.tool,arguments:args.arguments||{}},undefined,{signal,timeout:60000});
      const clean=redact(result,[secret]);
      return clean;
    } finally {signal.removeEventListener('abort',cancel);await client.close().catch(error=>{});}
  }
}
export class AsideAdapter {
  constructor(binary=executable('aside')) {this.binary=binary;this.sessions=new Map();this.credentialMasks=new CredentialMasks();}
  async view(connection,{page,problemId},signal){
    signal.throwIfAborted();
    const session=this.sessions.get(connection.id),saved=session?.pages.get(page);
    if(!saved||saved.problemId!==problemId)throw new Error('That page does not belong to this job.');
    const key='onejob_visual_'+randomUUID().replaceAll('-','');
    const capture=async(matches,prepared=false)=>{
      const code=`await (async()=>{if(${saved.variable}.url()!==${JSON.stringify(saved.url)})throw new Error('Visual page changed');try{${prepared?'':`await ${saved.variable}.evaluate(${collectTextNodes.toString()},${JSON.stringify(key)});`}await ${saved.variable}.evaluate(${concealFields.toString()},{key:${JSON.stringify(key)},matches:${JSON.stringify(matches)}});await display(await ${saved.variable}.screenshot({type:'png',fullPage:false,timeout:5000}));}finally{await ${saved.variable}.evaluate(${revealFields.toString()},${JSON.stringify(key)});}})();`;
      const result=await session.client.callTool({name:'repl',arguments:{title:'onejob: inspect masked page image',code}},undefined,{signal,timeout:15000});
      signal.throwIfAborted();
      const image=!result.isError&&screenshotData(result.content?.find(item=>item.type==='image'));
      if(!image)throw new Error('The page image could not be captured. Continue with text reads.');
      return {page,url:saved.url,image};
    };
    if(!this.credentialMasks.forJob(connection.id,problemId).records.length)return capture([]);
    const directory=await this.credentialDirectory(session,signal);
    // Aside does not load arbitrary Node modules. Bring page text into the app
    // through a private transient file; no fingerprint/key leaves this process.
    return withPrivateCredential('[]',async path=>{
      try {
        const code=`await (async()=>{if(${saved.variable}.url()!==${JSON.stringify(saved.url)})throw new Error('Visual page changed');const texts=await ${saved.variable}.evaluate(${collectTextNodes.toString()},${JSON.stringify(key)});await fs.writeFile(${JSON.stringify(path)},JSON.stringify(texts));console.log('ONEJOB_MASK_TEXT_READY');})();`;
        const result=await session.client.callTool({name:'repl',arguments:{title:'onejob: prepare private page masking',code}},undefined,{signal,timeout:15000});
        signal.throwIfAborted();
        if(result.isError||!result.content?.some(item=>item.type==='text'&&item.text.includes('ONEJOB_MASK_TEXT_READY')))throw new Error('Page masking could not be prepared.');
        const texts=JSON.parse(await readFile(path,'utf8'));
        if(!Array.isArray(texts)||texts.some(text=>typeof text!=='string'))throw new Error('Page masking returned invalid text.');
        const matches=texts.flatMap((text,index)=>this.credentialMasks.ranges(connection.id,problemId,text).length?[index]:[]);
        signal.throwIfAborted();return await capture(matches,true);
      } finally {
        // Also remove collected node references when preparation or Stop fails
        // before capture's own restoration block can run. This executes no job work.
        await session.client.callTool({name:'repl',arguments:{title:'onejob: restore page masking',code:`await ${saved.variable}.evaluate(${revealFields.toString()},${JSON.stringify(key)});`}},undefined,{signal:AbortSignal.timeout(7000),timeout:7000}).catch(error=>{});
      }
    },directory);
  }
  async screenshot(connection,{page,problemId},signal) {
    signal.throwIfAborted();
    const session=this.sessions.get(connection.id),saved=session?.pages.get(page);
    if(!saved || saved.problemId!==problemId)throw new Error('That page does not belong to this job.');
    try {
      const code=`if(${saved.variable}.url()!==${JSON.stringify(saved.url)})throw new Error('Page changed');await display(await ${saved.variable}.screenshot({type:'png',fullPage:false,timeout:5000}));`;
      const result=await session.client.callTool({name:'repl',arguments:{title:'onejob: preview current page',code}},undefined,{signal,timeout:7000});
      signal.throwIfAborted();
      if(result.isError)return null;
      const image=result.content?.find(item=>item.type==='image');
      return screenshotData(image);
    } catch(error) {signal.throwIfAborted();return null;}
  }
  async session(connection) {
    if(!this.binary)throw new Error('Install the Aside CLI from Aside Developer settings.');
    if(!this.sessions.has(connection.id)) {
      const client=new Client({name:'onejob-browser',version:'0.2.0'});
      const transport=new StdioClientTransport({command:this.binary,args:[...(connection.account?['--account',connection.account]:[]),'mcp'],env:clientEnvironment(),stderr:'ignore'});
      try {await client.connect(transport);this.sessions.set(connection.id,{client,pages:new Map()});}
      catch(error){await client.close().catch(closeError=>{});throw new Error('Aside could not connect. Check its CLI and open profile.');}
    }
    return this.sessions.get(connection.id);
  }
  async call(connection,args,signal,{assertCurrent=()=>{},onRecovery=()=>{}}={}) {
    signal.throwIfAborted();assertCurrent();
    if(args.operation==='read'){
      if(args.offset!==undefined&&(!Number.isSafeInteger(args.offset)||args.offset<0))throw new Error('Use a nonnegative integer page offset.');
      if(args.snapshotId!==undefined||args.offset>0){
        const saved=this.sessions.get(connection.id)?.pages.get(args.page);
        if(!saved||saved.problemId!==args.problemId)throw new Error('That snapshot belongs to another job or expired.');
        if(args.snapshotId!==saved.snapshotId)throw new Error('That snapshot expired. Read the page again from the beginning.');
        return this.pageChunk(args.page,saved,args.offset||0);
      }
    }
    // Reads can recover; a failed click may already have changed the account.
    if(!['open','read'].includes(args.operation))return this.perform(connection,args,signal);
    let url;
    if(args.operation==='open')url=serviceURL(args.url).href;
    else {
      const saved=this.sessions.get(connection.id)?.pages.get(args.page);
      if(!saved || saved.problemId!==args.problemId)throw new Error('Open a page with onejob first. Existing personal tabs are not attached automatically.');
      url=serviceURL(saved.url).href;
    }
    try {return await this.perform(connection,args,signal);}
    catch(error) {
      signal.throwIfAborted();assertCurrent();onRecovery();
      const session=this.sessions.get(connection.id);
      this.sessions.delete(connection.id);
      if(session)await session.client.close().catch(closeError=>{});
      signal.throwIfAborted();assertCurrent();
      try {return await this.perform(connection,{operation:'open',url,problemId:args.problemId},signal);}
      catch(recoveryError) {
        signal.throwIfAborted();assertCurrent();
        const failure=new Error('The browser connection failed after automatic recovery. Your progress is saved.');
        failure.code='BROWSER_RECOVERY_FAILED';throw failure;
      }
    }
  }
  async checkLogin(connection,args,signal) {
    const session=await this.session(connection),saved=session.pages.get(args.page);
    if(!saved||saved.problemId!==args.problemId)throw new Error('This login page does not belong to the current job.');
    const guard=`if(${saved.variable}.url()!==${JSON.stringify(saved.url)})throw new Error('Login page changed');await ${saved.variable}.locator(${JSON.stringify(args.selector)}).evaluate((element)=> (${checkLoginElement.toString()})(element,${JSON.stringify(args.origin)},${JSON.stringify(args.field)}));`;
    const result=await session.client.callTool({name:'repl',arguments:{title:'Check sign-in field',code:guard+"console.log('ONEJOB_LOGIN_READY');"}},undefined,{signal,timeout:15000});
    if(result.isError||!result.content?.some(c=>c.type==='text'&&c.text.includes('ONEJOB_LOGIN_READY')))throw new Error('The sign-in field could not be verified. No credential was filled.');
    return {session,saved,guard};
  }
  async credentialDirectory(session,signal) {
    const result=await session.client.callTool({name:'repl',arguments:{title:'Locate private login transfer directory',code:"console.log('ONEJOB_DIRECTORY:'+JSON.stringify(pwd));"}},undefined,{signal,timeout:10000});
    const text=(result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
    const match=text.match(/ONEJOB_DIRECTORY:(.+)/);
    if(result.isError||!match)throw new Error('Aside did not provide its session directory.');
    return transferDirectory(JSON.parse(match[1]));
  }
  async fillCredential(connection,args,secret,signal) {
    const {session,saved,guard}=await this.checkLogin(connection,args,signal);
    const directory=await this.credentialDirectory(session,signal);
    this.credentialMasks.remember(connection.id,saved.problemId,saved.url,secret);
    try {
      await withPrivateCredential(secret,async path=>{
        signal.throwIfAborted();
        const code=guard+`await (async()=>{let value=await fs.readFile(${JSON.stringify(path)},'utf8');try{await ${session.pages.get(args.page).variable}.locator(${JSON.stringify(args.selector)}).fill(value);}finally{value='';}})();console.log('ONEJOB_LOGIN_FILLED');`;
        const result=await session.client.callTool({name:'repl',arguments:{title:'Fill approved 1Password sign-in field',code}},undefined,{signal,timeout:15000});
        if(result.isError||!result.content?.some(c=>c.type==='text'&&c.text.includes('ONEJOB_LOGIN_FILLED')))throw new Error('Credential fill could not be confirmed.');
      },directory);
      // No snapshot here: password values must never become a model tool result.
      return {page:args.page,filled:args.field,credentialUsed:true};
    } catch(error){throw new Error('Sign-in fill could not be confirmed. Inspect the page before retrying.');}
  }
  async perform(connection,args,signal) {
    const session=await this.session(connection);let variable,code,pageId,cacheVariable;
    const failureMarker='ONEJOB_FAILURE_'+randomUUID()+':';
    const capture=()=>`await (async()=>{const raw=await snapshot(${variable},{interactive:false});const view=typeof raw.tree==='string'?raw.tree:JSON.stringify(raw);${cacheVariable}={text:view};console.log('ONEJOB_RESULT:'+JSON.stringify({url:${variable}.url(),snapshot:view.slice(0,8000),totalLength:view.length}));})();`;
    if(args.operation==='open') {
      const url=serviceURL(args.url).href;pageId=randomUUID();variable='oj_'+pageId.replaceAll('-','');
      cacheVariable=variable+'_snapshot';
      code=`var ${variable}=await openTab(${JSON.stringify(url)});var ${cacheVariable}=null;${capture()}`;
    } else {
      const saved=session.pages.get(args.page);if(!saved || saved.problemId!==args.problemId)throw new Error('Open a page with onejob first. Existing personal tabs are not attached automatically.');
      variable=saved.variable;pageId=args.page;
      cacheVariable=saved.cacheVariable||'oj_snapshot_'+randomUUID().replaceAll('-','');
      const selector=JSON.stringify(args.selector||'');
      let scroll='';
      if(args.operation==='scroll'){
        validateScroll(args);
        const options=JSON.stringify({direction:args.direction,amount:args.amount});
        scroll=args.selector===undefined?`await ${variable}.evaluate(${scrollViewport.toString()},${options});`:args.direction!==undefined||args.amount!==undefined?`await ${variable}.locator(${selector}).evaluate(${scrollContainer.toString()},${options});`:`await ${variable}.locator(${selector}).scrollIntoViewIfNeeded();`;
      }
      const action=args.operation==='click'?`await ${variable}.locator(${selector}).click();`:args.operation==='fill'?`await ${variable}.locator(${selector}).fill(${JSON.stringify(String(args.text||''))});`:args.operation==='press'?`await ${variable}.locator(${selector}).press(${JSON.stringify(String(args.key||'Enter'))});`:args.operation==='select'?`await ${variable}.locator(${selector}).selectOption(${JSON.stringify(String(args.value||''))});`:args.operation==='hover'?`await ${variable}.locator(${selector}).hover();`:scroll;
      if(!['read','click','fill','press','select','hover','scroll'].includes(args.operation))throw new Error('Unsupported browser operation.');
      const review=args.operation==='read'?'':`if(${variable}.url()!==${JSON.stringify(saved.url)})throw new Error('The page changed after review. Open a new task tab before continuing.');`;
      const targetReview=args.navigationOnly===true?`const evidence=${navigationEvidence.toString()};const expected=evidence(${saved.cacheVariable?saved.cacheVariable+'.text':JSON.stringify(args.expectedSnapshot)},${selector});if(!expected||evidence(view,${selector})!==expected)throw new Error('The page changed during automatic review.');`:'';
      const autoReview=args.expectedSnapshot===undefined?'':`await (async()=>{const raw=await snapshot(${variable},{interactive:false});const view=typeof raw.tree==='string'?raw.tree:JSON.stringify(raw);${targetReview||`if(${JSON.stringify(args.expectedSnapshot!==saved.snapshot&&args.expectedSnapshot!==saved.snapshotText)}||view!==${saved.cacheVariable?saved.cacheVariable+'.text':JSON.stringify(args.expectedSnapshot)})throw new Error('The page changed during automatic review.');`}})();`;
      const initialize=`var ${cacheVariable}=typeof ${cacheVariable}==='undefined'?null:${cacheVariable};`;
      code=`${review} ${autoReview} ${args.operation==='read'?'':"phase='action';"} ${action} ${args.operation==='read'?'':"phase='snapshot';"} ${capture()}`;
      // Report where dispatch stopped, never the raw exception (it may contain
      // page text or a credential). Only a preflight failure proves no action ran.
      if(args.operation!=='read')code=`await (async()=>{let phase='preflight';try{${code}}catch(error){console.log(${JSON.stringify(failureMarker)}+JSON.stringify({phase,kind:error.name==='TimeoutError'?'timeout':String(error.message).startsWith('The page changed')?'page_changed':'failed'}));}})();`;
      // Declare in the persistent REPL scope, not inside the action closure:
      // a local var would shadow the saved snapshot and reset it before review.
      code=initialize+code;
    }
    signal.throwIfAborted();
    const result=await session.client.callTool({name:'repl',arguments:{title:'onejob: '+args.operation+' browser page',code}},undefined,{signal,timeout:120000});
    if(result.isError)throw new Error('Aside could not finish. Check its open profile and account ID. Inspect the browser before retrying an action.');
    const content=(result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
    const failureLine=content.split('\n').find(line=>line.startsWith(failureMarker));
    if(failureLine){
      const detail=JSON.parse(failureLine.slice(failureMarker.length));
      const phase=['preflight','action','snapshot'].includes(detail.phase)?detail.phase:'action';
      const kind=['timeout','page_changed','failed'].includes(detail.kind)?detail.kind:'failed';
      const failure=new Error(phase==='preflight'?'The page changed during automatic review or its preflight read failed. No action was sent.':phase==='snapshot'?'The action finished, but its page snapshot failed.':'The browser action did not confirm completion.');
      failure.browserPhase=phase;failure.diagnostic=phase+'_'+kind;throw failure;
    }
    const marker=content.indexOf('ONEJOB_RESULT:');
    if(marker<0)throw new Error('Aside returned an incompatible result.');
    const line=content.slice(marker+'ONEJOB_RESULT:'.length).split('\n')[0];
    let parsed;try {parsed=JSON.parse(line);}catch(error){throw new Error('Aside returned an incompatible result.');}
    const url=serviceURL(parsed.url).href;
    // Retrieve the complete snapshot in bounded transport chunks. Redact before
    // model paging so a credential cannot leak split across two page boundaries.
    const total=parsed.totalLength??parsed.snapshot.length;
    while(parsed.snapshot.length<total){
      signal.throwIfAborted();
      const part=await session.client.callTool({name:'repl',arguments:{title:'onejob: retrieve remaining page text',code:`console.log('ONEJOB_RESULT:'+JSON.stringify({snapshot:${cacheVariable}.text.slice(${parsed.snapshot.length},${parsed.snapshot.length+8000})}));`}},undefined,{signal,timeout:120000});
      const line=(part.content||[]).filter(c=>c.type==='text').flatMap(c=>c.text.split('\n')).find(line=>line.startsWith('ONEJOB_RESULT:'));
      if(part.isError||!line)throw new Error('Aside could not retrieve the remaining page text.');
      const chunk=JSON.parse(line.slice('ONEJOB_RESULT:'.length)).snapshot;
      if(typeof chunk!=='string'||!chunk.length)throw new Error('Aside returned an incomplete page chunk.');
      parsed.snapshot+=chunk;
    }
    parsed.snapshot=this.credentialMasks.scrub(connection.id,args.problemId,parsed.snapshot);
    if(this.credentialMasks.ranges(connection.id,args.problemId,url).length)throw new Error('The page exposed sign-in data in its address.');
    const saved={variable,cacheVariable,url,problemId:args.problemId,snapshotText:parsed.snapshot,snapshotId:randomUUID()};
    session.pages.set(pageId,saved);
    return this.pageChunk(pageId,saved,0);
  }
  pageChunk(page,saved,offset){
    const text=saved.snapshotText;
    if(typeof text!=='string'||offset>text.length)throw new Error('That page offset is outside the saved snapshot.');
    let end=Math.min(text.length,offset+8000);
    // Keep normal element-reference lines intact, with room for JSON escaping
    // and source metadata under the store's existing entry-size limit.
    while(JSON.stringify(text.slice(offset,end)).length>10000)end=offset+Math.floor((end-offset)/2);
    if(end<text.length){const line=text.lastIndexOf('\n',end-1);if(line>=offset)end=line+1;}
    saved.snapshot=text.slice(offset,end);
    return {page,url:saved.url,snapshot:saved.snapshot,snapshotId:saved.snapshotId,offset,totalLength:text.length,nextOffset:end<text.length?end:null,truncated:end<text.length};
  }
  async close() {for(const {client} of this.sessions.values())await client.close().catch(error=>{});this.sessions.clear();this.credentialMasks.clear();}
}

// Local display only. Do not put image bytes in tool results or saved sources.
export function screenshotData(image) {
  if(!image || !['image/png','image/jpeg','image/webp'].includes(image.mimeType) || typeof image.data!=='string' || image.data.length>2000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data))return null;
  const bytes=Buffer.from(image.data,'base64');
  const valid=image.mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):image.mimeType==='image/jpeg'?bytes.subarray(0,3).equals(Buffer.from([255,216,255])):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!valid)return null;
  return `data:${image.mimeType};base64,${image.data}`;
}
