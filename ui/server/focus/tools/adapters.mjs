import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {randomUUID} from 'node:crypto';
import {executable,clientEnvironment} from '../clients.mjs';
import {relativeURL,serviceURL} from './connections.mjs';
import {redact} from './credentials.mjs';

export async function responseText(response,max=100000) {
  let text='';const decoder=new TextDecoder();const reader=response.body?.getReader();if(!reader)return text;
  try {while(true){const {done,value}=await reader.read();if(done)break;text+=decoder.decode(value,{stream:true});if(text.length>max)throw new Error('The tool response is too large. Narrow the request.');}return text;}
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
      if(JSON.stringify(clean).length>100000)throw new Error('MCP response is too large. Narrow the request.');
      return clean;
    } finally {signal.removeEventListener('abort',cancel);await client.close().catch(error=>{});}
  }
}
export class AsideAdapter {
  constructor(binary=executable('aside')) {this.binary=binary;this.sessions=new Map();}
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
  async call(connection,args,signal) {
    const session=await this.session(connection);let variable,code,pageId;
    if(args.operation==='open') {
      const url=serviceURL(args.url).href;pageId=randomUUID();variable='oj_'+pageId.replaceAll('-','');
      code=`var ${variable}=await openTab(${JSON.stringify(url)}); await (async()=>{const raw=await snapshot(${variable},{interactive:true});const view=typeof raw.tree==='string'?raw.tree:JSON.stringify(raw);console.log('ONEJOB_RESULT:'+JSON.stringify({url:${variable}.url(),snapshot:view.slice(0,30000),truncated:view.length>30000}));})();`;
    } else {
      const saved=session.pages.get(args.page);if(!saved || saved.problemId!==args.problemId)throw new Error('Open a page with onejob first. Existing personal tabs are not attached automatically.');
      variable=saved.variable;pageId=args.page;
      const selector=JSON.stringify(args.selector||'');
      const action=args.operation==='click'?`await ${variable}.locator(${selector}).click();`:args.operation==='fill'?`await ${variable}.locator(${selector}).fill(${JSON.stringify(String(args.text||''))});`:args.operation==='press'?`await ${variable}.locator(${selector}).press(${JSON.stringify(String(args.key||'Enter'))});`:'';
      if(!['read','click','fill','press'].includes(args.operation))throw new Error('Unsupported browser operation.');
      code=`if(${variable}.url()!==${JSON.stringify(saved.url)})throw new Error('The page changed after review. Open a new task tab before continuing.'); ${action} await (async()=>{const raw=await snapshot(${variable},{interactive:true});const view=typeof raw.tree==='string'?raw.tree:JSON.stringify(raw);console.log('ONEJOB_RESULT:'+JSON.stringify({url:${variable}.url(),snapshot:view.slice(0,30000),truncated:view.length>30000}));})();`;
    }
    signal.throwIfAborted();
    const result=await session.client.callTool({name:'repl',arguments:{title:'onejob: '+args.operation+' browser page',code}},undefined,{signal,timeout:120000});
    if(result.isError)throw new Error('Aside could not finish. Check its open profile and account ID. Inspect the browser before retrying an action.');
    const content=(result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n').slice(0,50000);
    const marker=content.indexOf('ONEJOB_RESULT:');
    if(marker<0)throw new Error('Aside returned an incompatible result.');
    const line=content.slice(marker+'ONEJOB_RESULT:'.length).split('\n')[0];
    let parsed;try {parsed=JSON.parse(line);}catch(error){throw new Error('Aside returned an incompatible result.');}
    const url=serviceURL(parsed.url).href;
    session.pages.set(pageId,{variable,url,problemId:args.problemId,snapshot:parsed.snapshot});
    return {page:pageId,url,snapshot:parsed.snapshot,truncated:parsed.truncated===true};
  }
  async close() {for(const {client} of this.sessions.values())await client.close().catch(error=>{});this.sessions.clear();}
}
