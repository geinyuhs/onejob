import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {ProblemStore} from '../server/focus/store.mjs';
import {Connections} from '../server/focus/tools/connections.mjs';
import {OAuthConnections,OAuthSession,callbackCode} from '../server/focus/tools/oauth.mjs';
import {services,servicePreset,serviceDestination,serviceFetch} from '../server/focus/tools/presets.mjs';
import {ServiceSetup} from '../server/focus/tools/setup.mjs';
import {Credentials} from '../server/focus/tools/credentials.mjs';
import {Keychain} from '../server/focus/tools/keychain.mjs';
import {PassThrough} from 'node:stream';

function fixture(t,Implementation=OAuthConnections){
 const dir=mkdtempSync(join(tmpdir(),'onejob-oauth-')),store=new ProblemStore(join(dir,'memory.sqlite'));store.create('Synthetic job');const connections=new Connections(store),vault=new Map(),events=[];let now=100000,exchanges=0,refreshes=0,challenge;
 const keychain={read:async key=>structuredClone(vault.get(key)||null),write:async(key,value)=>vault.set(key,structuredClone(value)),remove:async key=>vault.delete(key)};
 const fetcher=async(input,options={})=>{
  const url=new URL(input),params=new URLSearchParams(options.body),json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  if(url.pathname.includes('oauth-protected-resource'))return json({resource:services.notion.url,authorization_servers:[services.notion.origin],scopes_supported:['default']});
  if(url.pathname.includes('oauth-authorization-server'))return json({issuer:services.notion.origin,authorization_endpoint:services.notion.origin+'/authorize',token_endpoint:services.notion.origin+'/token',registration_endpoint:services.notion.origin+'/register',response_types_supported:['code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']});
  if(url.pathname==='/register'){const body=JSON.parse(options.body);assert.equal(body.token_endpoint_auth_method,'none');assert.match(body.redirect_uris[0],/^http:\/\/127\.0\.0\.1:\d+\/callback$/);return json({...body,client_id:'synthetic-client'});}
  if(url.pathname==='/token'){
   if(params.get('grant_type')==='authorization_code'){exchanges++;assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'),challenge);assert.equal(params.get('code'),'synthetic-code');}
   else {refreshes++;assert.equal(params.get('refresh_token'),'SYNTHETIC_REFRESH');}
   return json({access_token:'SYNTHETIC_ACCESS_'+refreshes,refresh_token:'SYNTHETIC_REFRESH',token_type:'Bearer',expires_in:3600});
  }
  throw new Error('Unexpected fixture request');
 };
 const oauth=new Implementation(store,connections,keychain,{fetcher,emit:e=>events.push(e),clock:()=>now});
 t.after(async()=>{await oauth.close();store.close();rmSync(dir,{recursive:true,force:true});});
 return {dir,store,connections,keychain,vault,events,oauth,fetcher,advance:()=>{now+=4000000;},counts:()=>({exchanges,refreshes}),setChallenge:value=>{challenge=value;}};
}
async function connect(f){
 const result=await f.oauth.begin('notion');const url=new URL(result.url);f.setChallenge(url.searchParams.get('code_challenge'));assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 const redirect=new URL(url.searchParams.get('redirect_uri'));redirect.searchParams.set('state',url.searchParams.get('state'));redirect.searchParams.set('code','synthetic-code');
 return {result,url,redirect};
}
test('real SDK handles registration, PKCE, callback, refresh and local disconnect',async t=>{
 const f=fixture(t),{redirect}=await connect(f);assert.equal(f.connections.all().length,0);
 const wrong=new URL(redirect);wrong.searchParams.set('state','wrong');assert.equal((await fetch(wrong)).status,400);assert.equal(f.counts().exchanges,0);
 const response=await fetch(redirect);assert.equal(response.status,200);assert.match(await response.text(),/Connected/);assert.equal(response.headers.get('Cache-Control'),'no-store');
 const connection=f.connections.all()[0];assert.equal(connection.service,'notion');assert.equal(await new Credentials(null,f.oauth).resolve(connection),'SYNTHETIC_ACCESS_0');
 f.advance();assert.deepEqual(await Promise.all([f.oauth.token(connection),f.oauth.token(connection)]),['SYNTHETIC_ACCESS_1','SYNTHETIC_ACCESS_1']);assert.equal(f.counts().refreshes,1);
 assert.ok(!JSON.stringify(f.store.db.prepare('SELECT * FROM settings').all()).includes('SYNTHETIC_ACCESS'));assert.ok(!JSON.stringify(f.events).includes('SYNTHETIC_REFRESH'));
 await f.oauth.disconnect(connection.id);assert.equal(f.vault.size,0);assert.equal(f.connections.all().length,0);
});
test('cancelled sign-in cannot install credentials, and failure messages contain no server content',async t=>{
 const f=fixture(t);const {redirect}=await connect(f);f.oauth.cancel('notion');await assert.rejects(fetch(redirect));assert.equal(f.connections.all().length,0);assert.equal(f.vault.size,0);
 const bad=new OAuthConnections(f.store,f.connections,f.keychain,{authorize:async()=>{throw new Error('SYNTHETIC_PROVIDER_SECRET');},emit:e=>f.events.push(e)});await assert.rejects(bad.begin('notion'),/could not start/);assert.ok(!JSON.stringify(f.events).includes('SYNTHETIC_PROVIDER_SECRET'));await bad.close();
});
test('sign-in denial closes its pending session',async t=>{
 const f=fixture(t),{redirect}=await connect(f);redirect.searchParams.delete('code');redirect.searchParams.set('error','access_denied');assert.equal((await fetch(redirect)).status,400);assert.equal(f.oauth.pending.size,0);assert.equal(f.connections.all().length,0);
});
test('callback rejects wrong method, host, path, duplicate state and missing code',()=>{
 const expected='http://127.0.0.1:3210/callback',good={method:'GET',headers:{host:'127.0.0.1:3210'},url:'/callback?state=synthetic-state&code=synthetic-code'};
 assert.equal(callbackCode(good,expected,'synthetic-state'),'synthetic-code');
 for(const request of [{...good,method:'POST'},{...good,headers:{host:'other.invalid'}},{...good,url:'/other?state=synthetic-state&code=x'},{...good,url:good.url+'&state=synthetic-state'},{...good,url:'/callback?state=synthetic-state'},{...good,url:good.url+'&code=other'}])assert.throws(()=>callbackCode(request,expected,'synthetic-state'));
});
test('OAuth destinations are pinned; redirects and server-selected brokers cannot receive tokens',async()=>{
 assert.throws(()=>servicePreset('__proto__'));assert.throws(()=>servicePreset('other'));
 for(const url of ['http://mcp.notion.com/token','https://mcp.notion.com.attacker.invalid/token','https://user:secret@mcp.notion.com/token','https://mcp.notion.com/token#fragment'])assert.throws(()=>serviceDestination(services.notion,url));
 let calls=0;const send=serviceFetch(services.notion,async(input,options)=>{calls++;assert.equal(options.redirect,'error');return new Response('{}');});
 await send(services.notion.origin+'/token');assert.equal(calls,1);assert.throws(()=>send('https://attacker.invalid/token'));assert.equal(calls,1);
});
test('background refresh never opens consent; changed destinations and missing secrets require reconnect',async t=>{
 const f=fixture(t);const s=new OAuthSession(services.notion,'synthetic',f.keychain,{data:{redirect:'http://127.0.0.1:3210/callback'}});assert.throws(()=>s.redirectToAuthorization(new URL(services.notion.origin+'/authorize')),/Reconnect/);
 await assert.rejects(f.oauth.token({id:'missing',service:'notion',url:services.linear.url}),/destination changed/);
 await assert.rejects(f.oauth.token({id:'missing',service:'notion',url:services.notion.url}),/Reconnect/);
});
test('disconnect does not claim success if Keychain removal fails',async t=>{
 const f=fixture(t);const {redirect}=await connect(f);await fetch(redirect);const c=f.connections.all()[0];f.keychain.remove=async()=>{throw new Error('Synthetic Keychain failure');};await assert.rejects(f.oauth.disconnect(c.id));assert.equal(f.connections.all().length,1);
});
test('automatic browser setup chooses a single profile and requires the Connect Aside permission',async t=>{
 const f=fixture(t);const setup=new ServiceSetup(f.connections,f.oauth,{find:name=>'/synthetic/'+name,exists:()=>true,run:async()=>'* u0 Synthetic browser account'});
 const status=await setup.inspect();assert.deepEqual(status.profiles,['u0']);assert.ok(status.clients.aside);assert.ok(!JSON.stringify(status).includes('Synthetic browser account'));
 await assert.rejects(setup.connectAside({browserAccessApproved:false}),/browser access/);await assert.rejects(setup.connectAside({profile:'u9',browserAccessApproved:true}),/available profile/);
 const c=await setup.connectAside({browserAccessApproved:true});assert.equal(c.account,'u0');assert.equal((await setup.connectAside({browserAccessApproved:true})).id,c.id);
 const missing=new ServiceSetup(f.connections,f.oauth,{find:()=>null,exists:()=>false});assert.equal((await missing.inspect()).clients.aside,false);await assert.rejects(missing.connectAside({browserAccessApproved:true}));
});
test('Keychain secrets use stdin, never argv or ambient tokens; failures have no plaintext fallback',async()=>{
 let seen;const run=(binary,args,options,callback)=>{seen={binary,args,options};const stdin=new PassThrough();let body='';stdin.on('data',chunk=>body+=chunk);stdin.on('end',()=>{seen.body=JSON.parse(body);callback(null,'{"value":true}');});return {stdin};};
 await new Keychain('/synthetic/helper',run).write('synthetic-key',{token:'SYNTHETIC_SECRET'});assert.deepEqual(seen.args,[]);assert.ok(!JSON.stringify(seen.options).includes('SYNTHETIC_SECRET'));assert.equal(seen.body.value.token,'SYNTHETIC_SECRET');assert.equal(seen.options.env.OPENAI_API_KEY,undefined);
 const failing=(binary,args,options,callback)=>{const stdin=new PassThrough();stdin.on('finish',()=>callback(new Error('SYNTHETIC_SECRET'),'SYNTHETIC_SECRET'));return {stdin};};await assert.rejects(new Keychain('/synthetic/helper',failing).write('synthetic-key',{}),error=>!error.message.includes('SYNTHETIC_SECRET'));
});
async function mutation(t,file,before,after){
 const dir=mkdtempSync(join(tmpdir(),'onejob-oauth-mutation-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const original=new URL('../server/focus/tools/'+file,import.meta.url);let source=readFileSync(original,'utf8');assert.ok(source.includes(before));source=source.replace(before,after).replace(/from '(\.[^']+)'/g,(_,ref)=>`from '${new URL(ref,original).href}'`).replace(/from '@modelcontextprotocol\/sdk\/([^']+)'/g,(_,ref)=>`from '${new URL('../server/focus/node_modules/@modelcontextprotocol/sdk/dist/esm/'+ref,import.meta.url).href}'`);const path=join(dir,file);writeFileSync(path,source);return import(pathToFileURL(path));
}
test('mutation proof: removing callback binding accepts a forged state',async t=>{
 const {callbackCode:broken}=await mutation(t,'oauth.mjs',"if(request.method!=='GET' || request.headers.host!==expected.host || url.pathname!==expected.pathname || url.searchParams.getAll('state').length!==1 || url.searchParams.get('state')!==expectedState)",'if(false)');
 assert.throws(()=>assert.throws(()=>broken({method:'GET',headers:{host:'127.0.0.1:3210'},url:'/callback?state=wrong&code=synthetic'},'http://127.0.0.1:3210/callback','expected')));
});
test('mutation proof: removing the destination check permits an outside recipient',async t=>{
 const {serviceDestination:broken}=await mutation(t,'presets.mjs',"if(url.origin!==service.origin || url.username || url.password || url.hash)",'if(false)');assert.throws(()=>assert.throws(()=>broken(services.notion,'https://attacker.invalid/token')));
});
test('mutation proof: automatic browser setup refuses an undiscovered profile',async t=>{
 const {ServiceSetup:Broken}=await mutation(t,'setup.mjs',"if(!status.clients.aside||!selected||!status.profiles.includes(selected))",'if(false)');const f=fixture(t);const setup=new Broken(f.connections,f.oauth,{find:()=>'/synthetic',exists:()=>true,run:async()=>'* u0 Synthetic'});await assert.rejects(assert.rejects(setup.connectAside({profile:'u9',browserAccessApproved:true})),/Missing expected rejection/);
});
async function replayScenario(t,Implementation=OAuthConnections){
 const f=fixture(t,Implementation),{redirect}=await connect(f),pending=f.oauth.pending.get('notion');let reached,release;
 const started=new Promise(resolve=>{reached=resolve;}),barrier=new Promise(resolve=>{release=resolve;});
 const fetcher=f.oauth.fetcher;f.oauth.fetcher=async(input,options)=>{if(new URL(input).pathname==='/token'){reached();await barrier;}return fetcher(input,options);};
 const response=()=>({status:200,setHeader(){},writeHead(status){this.status=status;return this;},end(){return this;}});
 const req={method:'GET',headers:{host:redirect.host},url:redirect.pathname+redirect.search},first=response(),second=response();
 const p1=f.oauth.complete(pending,req,first);await started;const p2=f.oauth.complete(pending,req,second);const rejected=second.status===409;release();await Promise.all([p1,p2]);assert.ok(rejected,'a callback must be consumed once');
}
test('overlapping callback replays cannot exchange a code twice',t=>replayScenario(t));
test('mutation proof: removing single-use callback protection admits a replay',async t=>{
 const {OAuthConnections:Broken}=await mutation(t,'oauth.mjs',"if(pending.consumed||this.pending.get(pending.serviceId)!==pending)",'if(false)');await assert.rejects(replayScenario(t,Broken),/consumed once/);
});
test('mutation proof: background auth cannot open a new consent flow',async t=>{
 const {OAuthSession:Broken}=await mutation(t,'oauth.mjs',"if(!this.interactive)throw new Error('Reconnect this service to continue.');",'');const f=fixture(t);const session=new Broken(services.notion,'synthetic',f.keychain);
 assert.throws(()=>assert.throws(()=>session.redirectToAuthorization(new URL(services.notion.origin+'/authorize')),/Reconnect/));
});
test('mutation proof: a Keychain error reply cannot be reported as a successful write',async t=>{
 const reply=(binary,args,options,callback)=>{const stdin=new PassThrough();stdin.on('finish',()=>callback(null,'{"error":"SYNTHETIC_PRIVATE_DETAIL"}'));return {stdin};};
 await assert.rejects(new Keychain('/synthetic',reply).write('test',{}),error=>!error.message.includes('SYNTHETIC_PRIVATE_DETAIL'));
 const {Keychain:Broken}=await mutation(t,'keychain.mjs',"if(reply.error)throw new Error('Keychain refused the request.');",'');await assert.rejects(assert.rejects(new Broken('/synthetic',reply).write('test',{})),/Missing expected rejection/);
});
