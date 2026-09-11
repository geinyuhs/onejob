import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,cpSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {hermesCommit,verifyHermesRoot,runtimePolicy,prepareHermesRuntime} from '../server/focus/hermes-runtime.mjs';

function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'onejob-hermes-runtime-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const home=join(dir,'home'),directory=join(home,'app-data'),profile=join(directory,'hermes-chatgpt'),root=join(home,'runtime'),worker=join(home,'code/worker.py');
 for(const path of [profile,root,join(home,'code'),join(root,'venv/bin')])mkdirSync(path,{recursive:true,mode:0o700});
 writeFileSync(worker,'synthetic');writeFileSync(join(root,'venv/bin/python'),'synthetic',{mode:0o700});
 return {dir,home,directory,profile,root,worker};
}
async function mutate(t,before,after){
 const f=fixture(t),target=join(f.dir,'copy');cpSync(new URL('../server/focus/',import.meta.url),target,{recursive:true,filter:path=>!path.includes('node_modules')});
 const path=join(target,'hermes-runtime.mjs'),source=readFileSync(path,'utf8');assert.ok(source.includes(before));writeFileSync(path,source.replace(before,after));return import(pathToFileURL(path));
}
function pinGate(t,verify=verifyHermesRoot){
 const f=fixture(t),good=args=>args.includes('rev-parse')?hermesCommit:'';
 assert.match(verify(f.root,good),/runtime$/);
 assert.throws(()=>verify(f.root,args=>args.includes('rev-parse')?'other':''),/pinned/);
 assert.throws(()=>verify(f.root,args=>args.includes('rev-parse')?hermesCommit:' M run_agent.py'),/pinned/);
 assert.throws(()=>verify('relative',good),/pinned/);
}
test('runtime rejects a changed release or modified source',t=>pinGate(t));
test('mutation proof: a changed commit and a dirty runtime fail verification',async t=>{
 for(const before of ['commit!==hermesCommit','changes.trim()']){
  const broken=await mutate(t,before,'false');assert.throws(()=>pinGate(t,broken.verifyHermesRoot),assert.AssertionError);
 }
});
test('runtime refuses to fall back to an unsandboxed platform',()=>{
 assert.throws(()=>prepareHermesRuntime({platform:'linux'}),/macOS sandbox/);
});
test('Python runtime exception cannot expose the entire home directory',async t=>{
 const f=fixture(t);for(const pythonHome of [f.home,'/'])assert.throws(()=>runtimePolicy({...f,pythonHome}),/dedicated/);
 const broken=await mutate(t,"pythonHome==='/' || home===pythonHome || home.startsWith(pythonHome+'/')",'false');
 assert.throws(()=>assert.throws(()=>broken.runtimePolicy({...f,pythonHome:f.home}),/dedicated/),assert.AssertionError);
});
function sandboxGate(t,policy=runtimePolicy){
 const f=fixture(t),secret=join(f.home,'synthetic-private'),otherJob=join(f.directory,'other-job');
 writeFileSync(secret,'synthetic secret');writeFileSync(otherJob,'synthetic other job');
 const envFiles=[join(f.root,'.env'),join(f.profile,'.env')];for(const file of envFiles)writeFileSync(file,'SYNTHETIC_OVERRIDE=blocked');
 const rules=policy(f),run=(binary,args)=>spawnSync('/usr/bin/sandbox-exec',['-p',rules,binary,...args],{encoding:'utf8'});
 assert.equal(run('/bin/cat',[f.worker]).status,0);
 assert.equal(run('/usr/bin/touch',[join(f.profile,'allowed')]).status,0);
 for(const file of [secret,otherJob,...envFiles]){const result=run('/bin/cat',[file]);assert.notEqual(result.status,0,'private files must be unreadable');assert.equal(result.stdout,'');}
 assert.notEqual(run('/usr/bin/touch',[join(f.root,'forbidden')]).status,0,'runtime source must be unwritable');
}
test('actual runtime sandbox blocks unrelated home files, jobs and source writes',{skip:process.platform!=='darwin'},t=>sandboxGate(t));
test('a runtime installed inside app data stays readable but immutable',{skip:process.platform!=='darwin'},t=>{
 const f=fixture(t),root=join(f.directory,'hermes-runtime');cpSync(f.root,root,{recursive:true});
 const rules=runtimePolicy({...f,root});
 const read=spawnSync('/usr/bin/sandbox-exec',['-p',rules,'/bin/cat',join(root,'venv/bin/python')],{encoding:'utf8'});
 assert.equal(read.status,0,'the installed runtime must be readable');
 assert.notEqual(spawnSync('/usr/bin/sandbox-exec',['-p',rules,'/usr/bin/touch',join(root,'forbidden')]).status,0);
});
function interpreterGate(t,policy=runtimePolicy){
 const f=fixture(t),bin=join(f.home,'interpreters/pinned/bin');mkdirSync(bin,{recursive:true});
 const executable=join(bin,'python');cpSync('/bin/echo',executable);
 const signed=spawnSync('/usr/bin/codesign',['--force','--sign','-',executable],{encoding:'utf8'});assert.equal(signed.status,0,signed.stderr);
 const link=join(f.root,'venv/bin/python');rmSync(link);symlinkSync(executable,link);
 const result=spawnSync('/usr/bin/sandbox-exec',['-p',policy(f),link,'synthetic-runtime-started'],{encoding:'utf8'});
 assert.equal(result.status,0,'the exact symlinked interpreter must start');assert.match(result.stdout,/synthetic-runtime-started/);
}
test('separately installed interpreter can start without home-file access',{skip:process.platform!=='darwin'},t=>interpreterGate(t));
test('regression proof: parent path metadata stays readable for runtime resolution',{skip:process.platform!=='darwin'},async t=>{
 const metadata=policy=>{const f=fixture(t),result=spawnSync('/usr/bin/sandbox-exec',['-p',policy(f),'/usr/bin/stat','-f','%HT',f.home],{encoding:'utf8'});assert.equal(result.status,0,'parent metadata must stay readable');};
 metadata(runtimePolicy);
 const broken=await mutate(t,'(deny file-read-data file-write* (require-all ${sub(home)}','(deny file-read* file-write* (require-all ${sub(home)}');
 assert.throws(()=>metadata(broken.runtimePolicy),/parent metadata must stay readable/);
});
test('mutation proof: home isolation and source immutability are enforced',{skip:process.platform!=='darwin'},async t=>{
 const home=await mutate(t,'${sub(home)}','(subpath "/nonexistent-synthetic")');assert.throws(()=>sandboxGate(t,home.runtimePolicy),/private files must be unreadable/);
 const write=await mutate(t,'(deny file-write* (require-all','(deny file-write* (require-all (subpath "/nonexistent-synthetic")');assert.throws(()=>sandboxGate(t,write.runtimePolicy),/runtime source must be unwritable/);
 const dotenv=await mutate(t,'(deny file-read-data (literal ${JSON.stringify(join(root,\'.env\'))}) (literal ${JSON.stringify(join(profile,\'.env\'))}))','');assert.throws(()=>sandboxGate(t,dotenv.runtimePolicy),/private files must be unreadable/);
});
test('Python worker contract and mutation proofs run without Hermes or credentials',()=>{
 const result=spawnSync(process.platform==='darwin'?'/usr/bin/python3':'python3',['-B',fileURLToPath(new URL('./focus-hermes-worker.test.py',import.meta.url))],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr||result.error?.message);assert.match(result.stderr,/Ran 7 tests/);
});
test('Python continuation context avoids duplicate delivery without erasing history',()=>{
 const result=spawnSync(process.platform==='darwin'?'/usr/bin/python3':'python3',['-B',fileURLToPath(new URL('./focus-hermes-context.test.py',import.meta.url))],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr||result.error?.message);assert.match(result.stderr,/Ran 6 tests/);
});
test('Python job persistence and crash recovery checks run without an account',()=>{
 const result=spawnSync(process.platform==='darwin'?'/usr/bin/python3':'python3',['-B',fileURLToPath(new URL('./focus-hermes-session.test.py',import.meta.url))],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr||result.error?.message);assert.match(result.stderr,/Ran 7 tests/);
});
test('Python compaction retains the pinned route and rejects partial summaries',()=>{
 const result=spawnSync(process.platform==='darwin'?'/usr/bin/python3':'python3',['-B',fileURLToPath(new URL('./focus-hermes-compaction.test.py',import.meta.url))],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr||result.error?.message);assert.match(result.stderr,/Ran 2 tests/);
});

function authScopeGate(t,policy=runtimePolicy){
 const f=fixture(t),authRoot=f.profile,profile=join(authRoot,'profiles/synthetic-a'),sibling=join(authRoot,'profiles/synthetic-b');
 for(const dir of [profile,sibling])mkdirSync(dir,{recursive:true,mode:0o700});
 for(const file of [join(authRoot,'auth.json'),join(sibling,'state.db'),join(authRoot,'state.db'),join(authRoot,'config.yaml'),join(authRoot,'.env')])writeFileSync(file,'synthetic');
 const rules=policy({...f,profile,authRoot}),run=(cmd,args)=>spawnSync('/usr/bin/sandbox-exec',['-p',rules,cmd,...args],{encoding:'utf8'});
 assert.equal(run('/bin/cat',[join(authRoot,'auth.json')]).status,0,'fresh root auth remains Hermes-owned and usable');
 for(const name of ['auth.lock','auth.json.tmp.123.abcdef'])assert.equal(run('/usr/bin/touch',[join(authRoot,name)]).status,0,'Hermes refresh needs its own lock and atomic temp');
 for(const file of [join(sibling,'state.db'),join(authRoot,'state.db'),join(authRoot,'config.yaml'),join(authRoot,'.env')])assert.notEqual(run('/bin/cat',[file]).status,0,'no sibling or root context may be read');
 assert.notEqual(run('/usr/bin/touch',[join(sibling,'forbidden')]).status,0,'other job memory must stay unwritable');
}
test('job worker can refresh shared fresh auth but cannot read root or sibling context',{skip:process.platform!=='darwin'},t=>authScopeGate(t));
test('mutation proof: granting the full auth root breaks job isolation',{skip:process.platform!=='darwin'},async t=>{
 // Mutate the actual pattern rather than disabling unrelated home rules.
 const source=readFileSync(new URL('../server/focus/hermes-runtime.mjs',import.meta.url),'utf8');
 const before=source.split('\n').find(line=>line.includes('const auth=authRoot?'));
 const broad=await mutate(t,before,'  const auth=authRoot?sub(authRoot):\'(literal "/nonexistent-onejob-auth")\';');
 assert.throws(()=>authScopeGate(t,broad.runtimePolicy),/no sibling or root context may be read/);
});
