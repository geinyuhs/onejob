import {spawn} from 'node:child_process';
import {accessSync,constants,lstatSync,mkdirSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';

export const hermesRelease='v2026.9.7';
export const hermesModel='gpt-6-astra';

function canonicalPath(path) {
  let parent=resolve(path);const missing=[];
  for(;;) {
    try {return join(realpathSync(parent),...missing);}
    catch(error) {
      if(error.code!=='ENOENT' || dirname(parent)===parent)throw error;
      missing.unshift(basename(parent));parent=dirname(parent);
    }
  }
}

// Login only. This must not be reused as the sandbox for an autonomous agent.
export function loginEnvironment(directory,source=process.env) {
  const clean=Object.fromEntries(['HOME','USER','LOGNAME','PATH','TMPDIR','SHELL','LANG','LC_ALL']
    .filter(key=>source[key]).map(key=>[key,source[key]]));
  return {...clean,HERMES_HOME:directory,PYTHONNOUSERSITE:'1'};
}

export function loginPolicy({directory,dataDirectory,userHome=homedir(),source=process.env}) {
  directory=canonicalPath(directory);
  const homes=[userHome,source.HOME].filter(Boolean);
  const protectedPaths=[...homes.flatMap(home=>[
    join(home,'.codex'),join(home,'.claude'),join(home,'.claude.json'),join(home,'.hermes'),
    join(home,'Library','Keychains'),
  ]),join(dataDirectory,'codex-profile'),join(dataDirectory,'claude-workspace'),
  source.CODEX_HOME,source.CLAUDE_CONFIG_DIR,source.HERMES_HOME].filter(Boolean).map(canonicalPath);
  for(const path of protectedPaths) {
    if(directory===path || directory.startsWith(path+'/'))throw new Error('Use a separate Hermes login directory.');
  }
  const paths=[...new Set(protectedPaths)].map(path=>`(subpath ${JSON.stringify(path)})`).join(' ');
  return `(version 1)\n(allow default)\n(deny file-read* file-write* ${paths})\n`;
}

export function prepareHermesLogin({binary,dataDirectory,source=process.env,userHome=homedir()}) {
  if(!binary || !isAbsolute(binary))throw new Error('Install the complete pinned Hermes release first.');
  accessSync(binary,constants.X_OK);
  if(!dataDirectory || !isAbsolute(dataDirectory))throw new Error('Use an absolute private app data directory.');
  const directory=join(realpathSync(dataDirectory),'hermes-chatgpt');
  const policy=loginPolicy({directory,dataDirectory:realpathSync(dataDirectory),source,userHome});
  mkdirSync(directory,{recursive:true,mode:0o700});
  const stat=lstatSync(directory);
  if(!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)!==0)
    throw new Error('Hermes login needs its own private directory with mode 0700.');
  // auth add calls the upstream fresh device flow; generic login may import Codex tokens.
  return {command:'/usr/bin/sandbox-exec',args:['-p',policy,binary,'auth','add','openai-codex','--type','oauth','--label','onejob'],
    options:{cwd:directory,env:loginEnvironment(directory,source),stdio:'inherit'}};
}

export function startHermesLogin(options,{platform=process.platform,launch=spawn}={}) {
  if(platform!=='darwin')throw new Error('The isolated Hermes login currently requires macOS.');
  const plan=prepareHermesLogin(options);
  // Keep login codes in the user's terminal, not saved app/model context. No inference here.
  return launch(plan.command,plan.args,plan.options);
}
