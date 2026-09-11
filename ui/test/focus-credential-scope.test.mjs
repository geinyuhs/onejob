import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AsideAdapter} from '../server/focus/tools/adapters.mjs';
import {CredentialMasks} from '../server/focus/tools/credential-masks.mjs';
import {createHmac,randomBytes} from 'node:crypto';

function fixture(Adapter=AsideAdapter){
 const adapter=new Adapter('synthetic'),signal=new AbortController().signal,requests=[];
 const session={pages:new Map([['page',{variable:'tab',url:'https://example.com/login',problemId:'job-a'}]]),client:{close:async()=>{},callTool:async request=>{requests.push(request);return {content:[{type:'text',text:'ONEJOB_LOGIN_FILLED'}]};}}};
 adapter.sessions.set('browser',session);
 adapter.checkLogin=async()=>({session,saved:session.pages.get('page'),guard:''});
 adapter.credentialDirectory=async()=>tmpdir();
 return {adapter,session,signal,requests};
}
test('approved fills retain no plaintext credential in the browser session or redaction records',async()=>{
 const f=fixture(),secret='SYNTHETIC_SCOPE_CANARY';
 await f.adapter.fillCredential({id:'browser'},{page:'page',problemId:'job-a',origin:'https://example.com',field:'password',selector:'e1'},secret,f.signal);
 assert(!f.session.secrets?.has(secret),'connection-wide plaintext credential cache must be absent');
 assert(!JSON.stringify(f.requests).includes(secret));
 const own=f.adapter.credentialMasks.forJob('browser','job-a');
 assert(!JSON.stringify(own).includes(secret));
 assert.deepEqual(own.records.map(record=>record.origin),['https://example.com']);
 assert.equal(f.adapter.credentialMasks.scrub('browser','job-a',secret),'[redacted]');
 assert.equal(f.adapter.credentialMasks.scrub('browser','job-b',secret),secret);
 assert.equal(f.adapter.credentialMasks.scrub('another-browser','job-a',secret),secret);
 await f.adapter.close();assert.equal(f.adapter.credentialMasks.scrub('browser','job-a',secret),secret);
});
test('image masking uses only the owning job and sends neither credentials nor fingerprints to Aside',async()=>{
 const f=fixture(),secret='SYNTHETIC_IMAGE_CANARY';
 await f.adapter.fillCredential({id:'browser'},{page:'page',problemId:'job-a',origin:'https://example.com',field:'password',selector:'e1'},secret,f.signal);
 f.adapter.credentialMasks.remember('browser','job-b','https://example.org','SYNTHETIC_OTHER_JOB');
 let hidden;
 const page={url:()=> 'https://example.com/login',evaluate:async(fn,args)=>{assert(!JSON.stringify(args).includes(secret));if(fn.name==='collectTextNodes')return ['Public',secret,'SYNTHETIC_OTHER_JOB'];if(fn.name==='concealFields')hidden=args.matches;},screenshot:async()=>{}};
 const context=vm.createContext({tab:page,fs:{writeFile},console:{log:()=>{}},display:()=>{}});
 f.session.client.callTool=async request=>{
  assert(!JSON.stringify(request).includes(secret));
  const code=request.arguments.code;
  assert(!code.includes(f.adapter.credentialMasks.forJob('browser','job-a').key));
  await vm.runInContext('(async()=>{'+code+'})()',context);
  return {content:request.arguments.title==='onejob: prepare private page masking'?[{type:'text',text:'ONEJOB_MASK_TEXT_READY'}]:[{type:'image',mimeType:'image/png',data:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')}]};
 };
 await f.adapter.view({id:'browser'},{page:'page',problemId:'job-a'},f.signal);
 assert.deepEqual([...hidden],[1]);
});

function boundaries(Masks=CredentialMasks){
 const masks=new Masks();
 for(const [connection,job] of [['','job'],['browser',''],[null,'job'],['browser',null],[7,'job'],['browser',7]])assert.throws(()=>masks.remember(connection,job,'https://example.com','synthetic'),/Credential masking requires/);
 for(const [url,value] of [['http://example.com','synthetic'],['https://user@example.com','synthetic'],['https://:password@example.com','synthetic'],['https://example.com',7],['https://example.com','']])assert.throws(()=>masks.remember('browser','job',url,value),/Credential masking requires/);
 masks.remember('browser','job','https://example.com/login','synthetic');
 masks.remember('browser','job','https://example.org/login','synthetic-two');
 assert.deepEqual(masks.forJob('browser','job').records.map(record=>record.origin),['https://example.com','https://example.org']);
 assert.equal(masks.scrub('browser','job','synthetic-two synthetic'),'[redacted] [redacted]');
 assert.equal(masks.scrub('browser','other-job','synthetic'),'synthetic');
 assert.equal(masks.scrub('other-browser','job','synthetic'),'synthetic');
}
test('fingerprint scopes require job identity and an exact HTTPS origin',()=>boundaries());
test('mutation proof: scope identity and credential-record guards reject unsafe counterexamples',()=>{
 const source=CredentialMasks.toString();
 for(const before of ["typeof connection!=='string'","!connection","typeof job!=='string'","!job","origin.protocol!=='https:'","origin.username","origin.password","typeof value!=='string'","!value"]){
  assert(source.includes(before));
  // These mutations only exercise guards; use the production pure matcher.
  const Broken=Function('createHmac','randomBytes','credentialRanges','return ('+source.replace(before,'false')+')')(createHmac,randomBytes,()=>[]);
  assert.throws(()=>{
   // Preserve scrub behavior so only the selected boundary is broken.
   Broken.prototype.scrub=CredentialMasks.prototype.scrub;
   Broken.prototype.ranges=CredentialMasks.prototype.ranges;
   boundaries(Broken);
  });
 }
 for(const [before,after] of [["JSON.stringify([connection,job])","JSON.stringify([connection])"],["JSON.stringify([connection,job])","JSON.stringify([job])"]]){
  const Broken=Function('createHmac','randomBytes','return ('+source.replace(before,after)+')')(createHmac,randomBytes);
  Broken.prototype.scrub=CredentialMasks.prototype.scrub;Broken.prototype.ranges=CredentialMasks.prototype.ranges;
  assert.throws(()=>boundaries(Broken));
 }
});
test('fingerprint masking handles Unicode, overlapping values and repeated values',()=>{
 const masks=new CredentialMasks();
 for(const value of ['abc','bcdef','🔐synthetic'])masks.remember('c','j','https://example.com',value);
 assert.equal(masks.scrub('c','j','abcdef 🔐synthetic abc'),'[redacted] [redacted] [redacted]');
});

async function rejectedPreparation(Adapter,mode){
 const f=fixture(Adapter);f.adapter.credentialMasks.remember('browser','job-a','https://example.com','synthetic');
 let path,restored=false,captured=false;
 f.session.client.callTool=async request=>{
  if(request.arguments.title==='onejob: prepare private page masking'){
   path=JSON.parse(request.arguments.code.match(/fs\.writeFile\(("[^"]+")/)[1]);
   await writeFile(path,JSON.stringify(mode==='invalid-array'?{}:mode==='invalid-item'?[7]:['synthetic']));
   return {isError:mode==='tool-error',content:mode==='no-marker'?[]:[{type:'text',text:'ONEJOB_MASK_TEXT_READY'}]};
  }
  if(request.arguments.title==='onejob: restore page masking'){restored=true;return {};}
  captured=true;return {content:[{type:'image',mimeType:'image/png',data:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')}]};
 };
 await assert.rejects(f.adapter.view({id:'browser'},{page:'page',problemId:'job-a'},f.signal),/Page masking (could not be prepared|returned invalid text)/);
 assert.equal(captured,false);assert.equal(restored,true);assert.equal(existsSync(path),false);
}
test('failed or malformed masking preparation cannot capture and always removes its private transfer',async()=>{
 for(const mode of ['tool-error','no-marker','invalid-array','invalid-item'])await rejectedPreparation(AsideAdapter,mode);
});
test('mutation proof: masking preparation failures and malformed text fail closed',async t=>{
 const original=new URL('../server/focus/tools/adapters.mjs',import.meta.url),source=readFileSync(original,'utf8');
 const dir=mkdtempSync(join(tmpdir(),'onejob-mask-mutation-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const cases=[['result.isError||!result.content?.some(item=>item.type===\'text\'&&item.text.includes(\'ONEJOB_MASK_TEXT_READY\'))',['tool-error','no-marker']],['!Array.isArray(texts)||texts.some(text=>typeof text!==\'string\')',['invalid-array','invalid-item']]];
 for(const [index,[condition,modes]] of cases.entries()){
  assert(source.includes(condition));
  let broken=source.replace(condition,'false').replace(/from '(\.[^']+)'/g,(_,relative)=>`from '${new URL(relative,original).href}'`);
  broken=broken.replace(/from '@modelcontextprotocol\/sdk\/([^']+)'/g,(_,relative)=>`from '${new URL('../server/focus/node_modules/@modelcontextprotocol/sdk/dist/esm/'+relative,import.meta.url).href}'`);
  const path=join(dir,'broken-'+index+'.mjs');writeFileSync(path,broken);const {AsideAdapter:Broken}=await import(path);
  for(const mode of modes)await assert.rejects(rejectedPreparation(Broken,mode));
 }
});
