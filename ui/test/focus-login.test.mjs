import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,statSync,readFileSync,mkdtempSync,mkdirSync,rmSync,symlinkSync,realpathSync,lstatSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {loginBinding,checkLoginElement,withPrivateCredential,transferDirectory} from '../server/focus/tools/login.mjs';
import {cleanConnection} from '../server/focus/tools/connections.mjs';

const connection={kind:'login',name:'Synthetic login',url:'https://example.com',account:'Synthetic',secretRef:'op://test/item/password',usernameRef:'op://test/item/username'};
function element(overrides={}){return {tagName:'INPUT',name:'username',id:'username',ownerDocument:{location:{origin:'https://example.com',href:'https://example.com/login'}},form:{action:'https://example.com/session'},getAttribute:key=>key==='type'?'text':null,...overrides};}
function bindingGate(fn=loginBinding){
 assert.throws(()=>fn({...connection,url:'http://example.com'},'http://example.com','password'));
 assert.equal(fn(connection,'https://example.com/login','password').secretRef,connection.secretRef);
 for(const [c,url,field] of [[connection,'https://other.example/login','password'],[connection,'http://example.com','password'],[connection,'https://example.com/reset','password'],[connection,'https://example.com','token'],[{...connection,kind:'api'},'https://example.com','password'],[{...connection,secretRef:''},'https://example.com','password']])assert.throws(()=>fn(c,url,field));
}
test('website credentials are bound to the exact HTTPS origin and configured field',()=>bindingGate());
test('mutation proof: origin, field, connection kind, credential reference and reset guards fire',()=>{
 const source=loginBinding.toString();
 for(const before of ["connection.kind!=='login'","!['username','password'].includes(field)","target.origin!==bound.origin","target.protocol!=='https:'","/\\b(signup|register|reset|recover|change-password)\\b/i.test(target.pathname)","!reference"]){
  assert.ok(source.includes(before));const broken=Function('return ('+source.replace(before,'false')+')')();assert.throws(()=>bindingGate(broken));
 }
});
function elementGate(fn=checkLoginElement){
 assert.equal(fn(element(),'https://example.com','username'),true);
 assert.equal(fn(element({getAttribute:key=>key==='type'?'password':null}),'https://example.com','password'),true);
 for(const [e,field] of [[element({tagName:'TEXTAREA'}),'username'],[element({form:{action:'https://other.example'}}),'username'],[element({ownerDocument:{location:{origin:'https://other.example',href:'https://other.example'}}}),'username'],[element(),'password'],[element({getAttribute:key=>key==='autocomplete'?'new-password':'password'}),'password'],[element({name:'message',id:'body'}),'username'],[element({getAttribute:()=> 'hidden'}),'username']])assert.throws(()=>fn(e,'https://example.com',field));
}
test('live sign-in field checks reject changed documents, form destinations and password creation',()=>elementGate());
test('mutation proof: every login element gate rejects its unsafe counterexample',()=>{
 const source=checkLoginElement.toString();
 for(const before of ["doc.location.origin!==origin","new URL(action,doc.location.href).origin!==origin","element.tagName!=='INPUT'","autocomplete==='new-password'","type!=='password'","!['text','email'].includes(type)","!/(user|email|login|identifier)/i.test([element.name,element.id,autocomplete].join(' '))"]){
  assert.ok(source.includes(before));const broken=Function('return ('+source.replace(before,'false')+')')();assert.throws(()=>elementGate(broken));
 }
});
test('transient credential files are private and removed on both success and failure',async()=>{
 for(const fail of [false,true]){let path;
  const run=withPrivateCredential('synthetic-secret',async p=>{path=p;assert.equal(statSync(p).mode&0o777,0o600);assert.equal(readFileSync(p,'utf8'),'synthetic-secret');if(fail)throw new Error('synthetic failure');return true;});
  if(fail)await assert.rejects(run,/synthetic failure/);else assert.equal(await run,true);
  assert.equal(existsSync(path),false);
 }
});
test('login configuration accepts only references and an origin',()=>{
 assert.equal(cleanConnection(connection).kind,'login');
 for(const change of [{usernameRef:'plain-secret'},{secretRef:'plain-secret'},{usernameRef:''},{url:'https://example.com/login'},{url:'https://example.com?secret=test'}])assert.throws(()=>cleanConnection({...connection,...change}));
});
test('mutation proof: private transfer accepts only real Aside session directories',t=>{
 const dir=mkdtempSync(join(tmpdir(),'login-path-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const root=join(dir,'aside'),valid=join(root,'u/0/sessions/synthetic'),outside=join(dir,'other/u/0/sessions/synthetic'),wrong=join(root,'u/0/not-session/synthetic'),link=join(root,'u/0/sessions/link');
 for(const path of [valid,outside,wrong])mkdirSync(path,{recursive:true});symlinkSync(valid,link);
 const gate=fn=>{assert.equal(fn(valid,root),realpathSync(valid));for(const path of [outside,wrong,link,'relative'])assert.throws(()=>fn(path,root));};
 gate(transferDirectory);const source=transferDirectory.toString();
 for(const before of ["lstatSync(path).isSymbolicLink()","!directory.startsWith(root+'/u/')","!/^\\d+\\/sessions\\/[^/]+$/.test(directory.slice((root+'/u/').length))"]){
  assert.ok(source.includes(before));const broken=Function('realpathSync','lstatSync','join','isAbsolute','homedir','return ('+source.replace(before,'false')+')')(realpathSync,lstatSync,join,isAbsolute,homedir);
  assert.throws(()=>gate(broken));
 }
});
