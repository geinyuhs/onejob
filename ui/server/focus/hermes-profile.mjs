import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,mkdtempSync,realpathSync} from 'node:fs';
import {join} from 'node:path';

export function privateDirectory(path) {
  mkdirSync(path,{recursive:true,mode:0o700});
  const stat=lstatSync(path);
  if(!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode&0o077)!==0)throw new Error('Hermes needs a private directory without links.');
  return realpathSync(path);
}

export function jobProfileName(scope) {
  if(typeof scope?.jobId!=='string' || !scope.jobId || scope.jobId.length>200 || !Number.isSafeInteger(scope.epoch) || scope.epoch<0)
    throw new Error('Hermes needs the selected job and its current context version.');
  // Names reveal neither job titles nor personal information. Epochs quarantine
  // old memory after source removal; old private data is preserved, never reloaded.
  // Hermes profile IDs are at most 64 characters; retain 240 bits of the hash.
  return 'job-'+createHash('sha256').update(JSON.stringify([scope.jobId,scope.epoch])).digest('hex').slice(0,60);
}

export function prepareProfile(directory,scope) {
  const authRoot=privateDirectory(join(realpathSync(directory),'hermes-chatgpt'));
  const profiles=privateDirectory(join(authRoot,'profiles'));
  const profile=scope?privateDirectory(join(profiles,jobProfileName(scope))):mkdtempSync(join(profiles,'check-'));
  return {profile,authRoot};
}
