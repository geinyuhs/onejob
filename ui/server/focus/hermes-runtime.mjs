import {execFileSync} from 'node:child_process';
import {accessSync,constants,lstatSync,mkdirSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loginEnvironment} from './hermes-login.mjs';
import {prepareProfile} from './hermes-profile.mjs';

export const hermesCommit='2237be355906fbe6065ce1815711eee52b2d646e';
export const workerPath=fileURLToPath(new URL('./hermes-worker.py',import.meta.url));

export function verifyHermesRoot(root,git=(args)=>execFileSync('/usr/bin/git',args,{encoding:'utf8',timeout:10000,env:loginEnvironment('/nonexistent'),stdio:['ignore','pipe','pipe']})) {
  if(!root || !isAbsolute(root))throw new Error('Choose the complete pinned Hermes installation.');
  root=realpathSync(root);
  const commit=git(['-C',root,'rev-parse','HEAD']).trim();
  const changes=git(['-C',root,'status','--porcelain','--untracked-files=normal']);
  if(commit!==hermesCommit || changes.trim())throw new Error('Hermes must match the clean pinned release.');
  accessSync(join(root,'venv/bin/python'),constants.X_OK);
  return root;
}

export function runtimePolicy({home,directory,profile,root,authRoot,worker=workerPath,pythonHome=dirname(dirname(realpathSync(join(root,'venv/bin/python'))))}) {
  home=realpathSync(home);pythonHome=realpathSync(pythonHome);
  root=realpathSync(root);profile=realpathSync(profile);
  if(pythonHome==='/' || home===pythonHome || home.startsWith(pythonHome+'/'))throw new Error('Python needs a dedicated runtime directory.');
  const sub=path=>`(subpath ${JSON.stringify(realpathSync(path))})`;
  const except=paths=>paths.map(path=>`(require-not ${sub(path)})`).join(' ');
  // Hermes alone owns refresh, including its atomic temp file and advisory lock.
  // Do not grant access to the rest of the shared login root or sibling profiles.
  const auth=authRoot?`(regex ${JSON.stringify('^'+realpathSync(authRoot).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/auth\\.(json(\\.tmp\\.[0-9]+\\.[a-f0-9]+)?|lock)$')})`: '(literal "/nonexistent-onejob-auth")';
  // No access to other jobs, inherited provider profiles, home files or Keychain files.
  // This is distinct from the login-only policy. No model-callable native IO is enabled.
  return `(version 1)\n(allow default)\n`+
    `(deny file-read-data file-write* (require-all ${sub(home)} ${except([profile,root,dirname(worker),pythonHome])} (require-not ${auth})))\n`+
    `(deny file-read-data file-write* (require-all ${sub(directory)} ${except([profile,root])} (require-not ${auth})))\n`+
    `(deny file-read-data (literal ${JSON.stringify(join(root,'.env'))}) (literal ${JSON.stringify(join(profile,'.env'))}))\n`+
    `(deny file-write* (require-all (require-not ${sub(profile)}) (require-not ${auth}) (require-not (literal "/dev/null"))))\n`;
}

export function prepareHermesRuntime({root,directory,scope,source=process.env,home=homedir(),platform=process.platform}) {
  if(platform!=='darwin')throw new Error('This Hermes integration requires the macOS sandbox.');
  root=verifyHermesRoot(root);directory=realpathSync(directory);
  const signIn=join(directory,'hermes-chatgpt'),stat=lstatSync(signIn);
  if(!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode&0o077)!==0)throw new Error('Hermes needs its separate private sign-in directory.');
  const {profile,authRoot}=prepareProfile(directory,scope);
  const temp=join(profile,'runtime-tmp');mkdirSync(temp,{recursive:true,mode:0o700});
  const policy=runtimePolicy({home,directory,profile,root,authRoot});
  return {command:'/usr/bin/sandbox-exec',args:['-p',policy,join(root,'venv/bin/python'),'-B',workerPath,root],options:{
    cwd:profile,stdio:['pipe','pipe','pipe'],env:{...loginEnvironment(profile,source),TMPDIR:temp,
      HERMES_SAFE_MODE:'1',HERMES_IGNORE_USER_CONFIG:'1',HERMES_IGNORE_RULES:'1',PYTHONDONTWRITEBYTECODE:'1'},
  }};
}
