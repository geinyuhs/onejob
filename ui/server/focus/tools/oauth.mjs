import {randomUUID,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {auth} from '@modelcontextprotocol/sdk/client/auth.js';
import {servicePreset,serviceDestination,serviceFetch} from './presets.mjs';

export function callbackCode(request,expectedURL,expectedState) {
 const expected=new URL(expectedURL),url=new URL(request.url,expected);
 if(request.method!=='GET' || request.headers.host!==expected.host || url.pathname!==expected.pathname || url.searchParams.getAll('state').length!==1 || url.searchParams.get('state')!==expectedState)throw new Error('Invalid sign-in callback.');
 if(url.searchParams.has('error'))throw new Error('Sign-in was declined.');
 if(url.searchParams.getAll('code').length!==1 || !url.searchParams.get('code'))throw new Error('Missing sign-in code.');
 return url.searchParams.get('code');
}
export class OAuthSession {
 constructor(service,key,keychain,{data={},redirectUrl,interactive=false,signal,clock=Date.now}={}) {
  Object.assign(this,{service,key,keychain,data,interactive,signal,clock});this.redirect=redirectUrl||data.redirect;this.stateValue=randomBytes(32).toString('hex');
 }
 get redirectUrl(){return this.redirect;}
 get clientMetadata(){return {client_name:'onejob',redirect_uris:[this.redirect],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'};}
 state(){return this.stateValue;}
 clientInformation(){return this.data.client;}
 saveClientInformation(client){this.data.client=client;}
 tokens(){return this.data.tokens;}
 async saveTokens(tokens){this.signal?.throwIfAborted();this.data={...this.data,tokens,redirect:this.redirect,expiresAt:this.clock()+Number(tokens.expires_in??300)*1000};await this.keychain.write(this.key,this.data);}
 saveCodeVerifier(verifier){this.verifier=verifier;}
 codeVerifier(){return this.verifier;}
 saveDiscoveryState(state){this.data.discovery=state;}
 discoveryState(){return this.data.discovery;}
 async invalidateCredentials(scope){
  if(scope==='all')this.data={};else if(scope==='tokens')delete this.data.tokens;else if(scope==='client')delete this.data.client;else if(scope==='discovery')delete this.data.discovery;else this.verifier=undefined;
  if(!this.interactive)await this.keychain.write(this.key,this.data);
 }
 redirectToAuthorization(url){
  serviceDestination(this.service,url);
  if(!this.interactive)throw new Error('Reconnect this service to continue.');
  this.authorizationURL=url.href;
 }
}
export class OAuthConnections {
 constructor(store,connections,keychain,{emit=()=>{},fetcher=fetch,authorize=auth,clock=Date.now}={}) {
  Object.assign(this,{store,connections,keychain,emit,fetcher,authorize,clock});this.pending=new Map();this.refreshes=new Map();this.statuses=new Map();
  const row=store.db.prepare("SELECT value FROM settings WHERE key='oauth-instance'").get();this.namespace=row?.value||randomUUID();
  if(!row)store.db.prepare("INSERT INTO settings VALUES ('oauth-instance',?)").run(this.namespace);
 }
 key(id){return this.namespace+'-'+id;}
 async begin(serviceId) {
  const service=servicePreset(serviceId);this.cancel(serviceId);const id=randomUUID(),controller=new AbortController();
  const pending={id,controller,serviceId};this.pending.set(serviceId,pending);
  const server=createServer((req,res)=>{this.complete(pending,req,res).catch(error=>this.fail(pending,'Sign-in could not finish. Try connecting again.'));});pending.server=server;
  try {
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
   pending.session=new OAuthSession(service,this.key(id),this.keychain,{redirectUrl:`http://127.0.0.1:${server.address().port}/callback`,interactive:true,signal:controller.signal,clock:this.clock});
   pending.timer=setTimeout(()=>this.fail(pending,'Sign-in expired. Try connecting again.'),10*60*1000);pending.timer.unref();
   const outcome=await this.authorize(pending.session,{serverUrl:service.url,scope:service.scope,fetchFn:serviceFetch(service,this.fetcher,controller.signal)});
   controller.signal.throwIfAborted();
   if(outcome!=='REDIRECT'||!pending.session.authorizationURL)throw new Error('Sign-in did not return a browser URL.');
   this.statuses.set(serviceId,'awaiting sign-in');this.emit({event:'setupChanged',service:serviceId,status:'awaiting sign-in'});
   return {url:pending.session.authorizationURL,service:serviceId};
  } catch(error){this.fail(pending,'Sign-in could not start. Check your connection and try again.');throw new Error('Sign-in could not start. Check your connection and try again.');}
 }
 async complete(pending,req,res) {
  res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'");
  let code;
  try {code=callbackCode(req,pending.session.redirectUrl,pending.session.stateValue);}
  catch(error){res.writeHead(400).end('Sign-in could not be verified. Return to onejob and try again.');if(error.message==='Sign-in was declined.')this.fail(pending,'Sign-in declined.');return;}
  if(pending.consumed||this.pending.get(pending.serviceId)!==pending){res.writeHead(409).end('This sign-in has already been handled.');return;}
  pending.consumed=true;
  try {
   const service=servicePreset(pending.serviceId);
   await this.authorize(pending.session,{serverUrl:service.url,authorizationCode:code,fetchFn:serviceFetch(service,this.fetcher,pending.controller.signal)});
   pending.controller.signal.throwIfAborted();
   if(!pending.session.data.tokens?.access_token)throw new Error('No access token returned.');
   const previous=this.connections.all().filter(c=>c.service===service.id);
   this.connections.write([...this.connections.all().filter(c=>c.service!==service.id),{id:pending.id,kind:'mcp',service:service.id,name:service.name,url:service.url,auth:'oauth',enabled:true,connectedAt:new Date(this.clock()).toISOString()}]);
   for(const old of previous)await this.keychain.remove(this.key(old.id)).catch(error=>this.emit({event:'setupNotice',message:'Connected. A previous local credential could not be removed from Keychain.'}));
   res.end('Connected. You can close this window and return to onejob.');this.closePending(pending);
   this.statuses.set(service.id,'connected');this.emit({event:'setupChanged',service:service.id,status:'connected'});
  } catch(error){res.writeHead(400).end('Sign-in could not finish. Return to onejob and try again.');this.fail(pending,'Sign-in could not finish. Try connecting again.');}
 }
 closePending(pending){clearTimeout(pending.timer);pending.server?.close();if(this.pending.get(pending.serviceId)===pending)this.pending.delete(pending.serviceId);}
 fail(pending,message){pending.controller.abort();this.closePending(pending);this.keychain.remove(this.key(pending.id)).catch(error=>{});this.statuses.set(pending.serviceId,message);this.emit({event:'setupChanged',service:pending.serviceId,status:message});}
 cancel(serviceId){const pending=this.pending.get(serviceId);if(pending)this.fail(pending,'Sign-in cancelled.');}
 async token(connection) {
  const service=servicePreset(connection.service);
  if(connection.url!==service.url)throw new Error('The saved service destination changed. Reconnect it.');
  if(this.refreshes.has(connection.id))return this.refreshes.get(connection.id);
  const task=this.loadToken(connection,service);this.refreshes.set(connection.id,task);
  try{return await task;}finally{this.refreshes.delete(connection.id);}
 }
 async loadToken(connection,service) {
  try {
   const data=await this.keychain.read(this.key(connection.id));
   if(!data?.tokens?.access_token)throw new Error('Missing authorization.');
   const session=new OAuthSession(service,this.key(connection.id),this.keychain,{data,clock:this.clock});
   if(!data.expiresAt||data.expiresAt<=this.clock()+60000)await this.authorize(session,{serverUrl:service.url,fetchFn:serviceFetch(service,this.fetcher)});
   return session.data.tokens.access_token;
  } catch(error){this.statuses.set(service.id,'Reconnect to restore access.');this.emit({event:'setupChanged',service:service.id,status:'Reconnect to restore access.'});throw new Error('Reconnect '+service.name+' in Tools to continue.');}
 }
 async disconnect(id) {
  const connection=this.connections.get(id);if(connection.service)this.cancel(connection.service);
  // Remove this app's credential before reporting that it has disconnected.
  if(connection.auth==='oauth')await this.keychain.remove(this.key(id));
  this.connections.remove(id);if(connection.service)this.statuses.delete(connection.service);
 }
 async close(){for(const service of [...this.pending.keys()])this.cancel(service);await Promise.allSettled([...this.refreshes.values()]);}
}
