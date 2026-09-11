import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync,mkdtempSync,mkdirSync,readFileSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {hermesModel,hermesRelease,loginEnvironment,loginPolicy,prepareHermesLogin,startHermesLogin} from '../server/focus/hermes-login.mjs';

function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'onejob-hermes-test-')),home=join(dir,'home'),data=join(dir,'data');
  mkdirSync(home);mkdirSync(data);
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return {dir,home,data,source:{HOME:home,PATH:'/usr/bin:/bin'}};
}
async function mutate(t,before,after) {
  const {dir}=fixture(t),file=join(dir,'mutated.mjs');
  const code=readFileSync(new URL('../server/focus/hermes-login.mjs',import.meta.url),'utf8');
  assert.ok(code.includes(before),'mutation must match real code');
  writeFileSync(file,code.replace(before,after));
  return import(pathToFileURL(file));
}
function envBoundary(clean=loginEnvironment) {
  const result=clean('/tmp/synthetic-profile',{HOME:'/tmp/synthetic-home',PATH:'/bin',OPENAI_API_KEY:'synthetic',
    ANTHROPIC_API_KEY:'synthetic',CODEX_HOME:'/tmp/existing-codex',HERMES_HOME:'/tmp/existing-hermes',
    PYTHONPATH:'/tmp/injected',PYTHONSTARTUP:'/tmp/injected',HERMES_CODEX_BASE_URL:'https://example.com'});
  assert.deepEqual(result,{HOME:'/tmp/synthetic-home',PATH:'/bin',HERMES_HOME:'/tmp/synthetic-profile',PYTHONNOUSERSITE:'1'});
}
test('Hermes login keeps the requested release and model without launching inference',()=>{
  assert.equal(hermesRelease,'v2026.9.7');assert.equal(hermesModel,'gpt-6-astra');envBoundary();
});
test('mutation proof: leaking ambient credentials fails the environment boundary',async t=>{
  const broken=await mutate(t,'return {...clean,HERMES_HOME:directory', 'return {...source,...clean,HERMES_HOME:directory');
  assert.throws(()=>envBoundary(broken.loginEnvironment),assert.AssertionError);
});
test('fresh login uses only the explicit OAuth add command and a private workspace',t=>{
  const f=fixture(t);let launch;
  const result=startHermesLogin({binary:'/usr/bin/true',dataDirectory:f.data,userHome:f.home,source:f.source},
    {platform:'darwin',launch:(...args)=>{launch=args;return 'synthetic-child';}});
  assert.equal(result,'synthetic-child');assert.equal(launch[0],'/usr/bin/sandbox-exec');
  assert.deepEqual(launch[1].slice(2),['/usr/bin/true','auth','add','openai-codex','--type','oauth','--label','onejob']);
  assert.equal(launch[2].stdio,'inherit');assert.equal(launch[2].cwd,launch[2].env.HERMES_HOME);
  assert.equal(statSync(launch[2].cwd).mode & 0o777,0o700);
});
function directoryBoundary(t,prepare=prepareHermesLogin) {
  const f=fixture(t),directory=join(f.data,'hermes-chatgpt');
  mkdirSync(directory);chmodSync(directory,0o755);
  assert.throws(()=>prepare({binary:'/usr/bin/true',dataDirectory:f.data,userHome:f.home,source:f.source}),/mode 0700/);
}
test('existing public profile is rejected, not silently reused',t=>directoryBoundary(t));
test('mutation proof: public profile permissions fail the boundary test',async t=>{
  const broken=await mutate(t,'(stat.mode & 0o077)!==0','false');
  assert.throws(()=>directoryBoundary(t,broken.prepareHermesLogin),assert.AssertionError);
});
test('profile symlinks are rejected without writing credentials through them',t=>{
  const f=fixture(t),target=join(f.dir,'target');mkdirSync(target,{mode:0o700});
  symlinkSync(target,join(f.data,'hermes-chatgpt'));
  assert.throws(()=>prepareHermesLogin({binary:'/usr/bin/true',dataDirectory:f.data,userHome:f.home,source:f.source}),/private directory/);
});
test('missing installation and relative paths fail before creating a profile',t=>{
  const f=fixture(t);
  for(const binary of [null,'hermes'])assert.throws(()=>prepareHermesLogin({binary,dataDirectory:f.data}),/complete pinned/);
  assert.throws(()=>prepareHermesLogin({binary:join(f.dir,'absent'),dataDirectory:f.data}),/ENOENT/);
  assert.throws(()=>prepareHermesLogin({binary:'/usr/bin/true',dataDirectory:'relative'}),/absolute private/);
});
test('login never falls back to an unsandboxed process',()=>{
  assert.throws(()=>startHermesLogin({}, {platform:'linux',launch:()=>assert.fail('must not launch')}),/requires macOS/);
});
function overlapBoundary(policy=loginPolicy) {
  assert.throws(()=>policy({directory:'/tmp/synthetic/.codex/new',dataDirectory:'/tmp/app',userHome:'/tmp/synthetic',source:{}}),/separate/);
}
test('existing provider roots cannot be selected for the new login',()=>overlapBoundary());
test('mutation proof: overlapping credential roots fail the boundary test',async t=>{
  const broken=await mutate(t,"directory===path || directory.startsWith(path+'/')",'false');
  assert.throws(()=>overlapBoundary(broken.loginPolicy),assert.AssertionError);
});
function sandboxBoundary(t,policy=loginPolicy) {
  const f=fixture(t),old=join(f.home,'.codex'),directory=join(f.data,'hermes-chatgpt');
  mkdirSync(old);mkdirSync(directory);writeFileSync(join(old,'auth.json'),'synthetic-secret');
  const profile=policy({directory,dataDirectory:f.data,userHome:f.home,source:f.source});
  const allowed=spawnSync('/usr/bin/sandbox-exec',['-p',profile,'/bin/cat','/dev/null'],{encoding:'utf8'});
  assert.equal(allowed.status,0,allowed.stderr);
  const denied=spawnSync('/usr/bin/sandbox-exec',['-p',profile,'/bin/cat',join(old,'auth.json')],{encoding:'utf8'});
  assert.notEqual(denied.status,0,'existing credentials must be unreadable');
  assert.equal(denied.stdout,'');
  const write=spawnSync('/usr/bin/sandbox-exec',['-p',profile,'/usr/bin/touch',join(old,'new')],{encoding:'utf8'});
  assert.notEqual(write.status,0,'existing credentials must be unwritable');
}
test('macOS blocks actual reads and writes to existing synthetic credentials',{skip:process.platform!=='darwin'},t=>sandboxBoundary(t));
test('mutation proof: removing the macOS deny rule makes the credential test fail',{skip:process.platform!=='darwin'},async t=>{
  const broken=await mutate(t,'(deny file-read* file-write* ${paths})','');
  assert.throws(()=>sandboxBoundary(t,broken.loginPolicy),/existing credentials must be unreadable/);
});
