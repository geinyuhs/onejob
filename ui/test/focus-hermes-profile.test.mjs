import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,symlinkSync,chmodSync,readFileSync,writeFileSync,cpSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {jobProfileName,prepareProfile,privateDirectory} from '../server/focus/hermes-profile.mjs';
import {ProblemStore} from '../server/focus/store.mjs';
import {hermesRequest} from '../server/focus/hermes-client.mjs';

const scope={jobId:'synthetic-a',epoch:0};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'onejob-profiles-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return realpathSync(dir);}
async function mutate(t,file,before,after){
 const dir=fixture(t);cpSync(new URL('../server/focus/',import.meta.url),dir,{recursive:true,filter:path=>!path.includes('node_modules')});
 const path=join(dir,file),source=readFileSync(path,'utf8');assert.ok(source.includes(before));writeFileSync(path,source.replace(before,after));return import(pathToFileURL(path));
}
function identityGate(name=jobProfileName){
 assert.equal(name(scope),name({...scope}));
 assert.notEqual(name(scope),name({...scope,jobId:'synthetic-b'}));
 assert.notEqual(name(scope),name({...scope,epoch:1}));
 assert.match(name({jobId:'../synthetic',epoch:0}),/^job-[a-f0-9]{60}$/);
 for(const invalid of [undefined,{}, {...scope,epoch:-1},{...scope,epoch:0.5},{...scope,jobId:''}])assert.throws(()=>name(invalid));
}
test('profile names bind job and context version, never paths or titles',()=>identityGate());
test('mutation proof: dropping job, version or scope validation fails',async t=>{
 for(const [before,after] of [['[scope.jobId,scope.epoch]','[scope.jobId]'],['[scope.jobId,scope.epoch]','[scope.epoch]'],["typeof scope?.jobId!=='string' || !scope.jobId || scope.jobId.length>200 || !Number.isSafeInteger(scope.epoch) || scope.epoch<0",'false']]){
  const broken=await mutate(t,'hermes-profile.mjs',before,after);assert.throws(()=>identityGate(broken.jobProfileName));
 }
});
test('restart selects the same profile; checks get separate fresh profiles',t=>{
 const dir=fixture(t),a=prepareProfile(dir,scope);
 assert.deepEqual(prepareProfile(dir,scope),a);
 assert.notEqual(prepareProfile(dir,{...scope,epoch:1}).profile,a.profile);
 assert.notEqual(prepareProfile(dir).profile,prepareProfile(dir).profile);
});
function directoryGate(t,prepare=privateDirectory){
 const dir=fixture(t),target=join(dir,'target'),link=join(dir,'link');mkdirSync(target,{mode:0o700});symlinkSync(target,link);
 assert.throws(()=>prepare(link),/private directory/);chmodSync(target,0o755);assert.throws(()=>prepare(target),/private directory/);
}
test('private profiles reject links and permissive directories',t=>directoryGate(t));
test('mutation proof: directory boundaries are enforced',async t=>{
 for(const before of ['!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode&0o077)!==0','(stat.mode&0o077)!==0']){
  const broken=await mutate(t,'hermes-profile.mjs',before,'false');assert.throws(()=>directoryGate(t,broken.privateDirectory));
 }
});
function epochGate(t,Store=ProblemStore){
 const path=join(fixture(t),'state.sqlite'),store=new Store(path);t.after(()=>store.close());store.create('Synthetic job');
 const read=()=>store.context('Synthetic').hermesScope;
 let old=read();store.advance();store.add('user','Synthetic follow-up');assert.deepEqual(read(),old);
 const id=store.add('fact','Synthetic fact');store.decide(id,'forget');assert.ok(read().epoch>old.epoch);old=read();
 const source=store.add('source','Synthetic source');store.db.prepare('DELETE FROM entries WHERE id=?').run(source);assert.ok(read().epoch>old.epoch);old=read();
 const reply=store.add('assistant','Synthetic old reply');store.db.prepare("UPDATE entries SET status='stale' WHERE id=?").run(reply);assert.ok(read().epoch>old.epoch);old=read();
 store.db.prepare('INSERT INTO folders VALUES (?,?,?,?)').run('synthetic-folder',old.jobId,'/synthetic','Synthetic');
 store.db.prepare('DELETE FROM folders WHERE id=?').run('synthetic-folder');assert.ok(read().epoch>old.epoch);
 const reopened=new Store(path);assert.deepEqual(reopened.context('Synthetic').hermesScope,read());reopened.close();
 const a=read();store.archive();store.create('Synthetic other job');assert.notEqual(read().jobId,a.jobId);assert.equal(read().epoch,0);
}
test('removing evidence rotates persisted context; messages and restarts do not',t=>epochGate(t));
test('mutation proof: every revocation trigger is necessary',async t=>{
 for(const name of ['hermes_context_delete','hermes_context_revoke','hermes_context_folder']){
  const source=readFileSync(new URL('../server/focus/store.mjs',import.meta.url),'utf8');
  const trigger=source.match(new RegExp('CREATE TRIGGER IF NOT EXISTS '+name+'[\\s\\S]*? END;'))[0];
  const broken=await mutate(t,'store.mjs',trigger,'');assert.throws(()=>epochGate(t,broken.ProblemStore));
 }
});
test('persistent execution needs a host-bound matching job; isolated checks do not',()=>{
 const context={phase:'execute',problem:{id:scope.jobId},hermesScope:scope};
 assert.equal(hermesRequest(context).persistent,true);
 assert.throws(()=>hermesRequest({...context,hermesScope:{...scope,jobId:'synthetic-other'}}),/different job/);
 assert.throws(()=>hermesRequest({...context,hermesScope:undefined}),/selected job/);
 for(const phase of ['clarify','actionReview'])assert.equal(hermesRequest({phase}).persistent,false);
});
