import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {executable,clientEnvironment} from '../clients.mjs';
import {services} from './presets.mjs';
export function runMetadata(binary,args) {
 return new Promise((resolve,reject)=>execFile(binary,args,{env:clientEnvironment(),timeout:10000,maxBuffer:100000},(error,stdout)=>error?reject(new Error('The installed client could not be checked.')):resolve(stdout)));
}
export class ServiceSetup {
 constructor(connections,oauth,{find=executable,exists=existsSync,run=runMetadata}={}){Object.assign(this,{connections,oauth,find,exists,run});}
 async inspect() {
  const clients={chatgpt:!!this.find('codex'),claude:!!this.find('claude'),aside:!!this.find('aside'),asideApp:this.exists('/Applications/Aside.app'),onePassword:this.exists('/Applications/1Password.app')};
  let profiles=[];
  if(clients.aside)try{const text=await this.run(this.find('aside'),['account','list']);profiles=[...new Set([...text.matchAll(/\bu\d+\b/g)].map(m=>m[0]))];}catch(error){profiles=[];}
  const connected=this.connections.public();
  return {clients,profiles,services:Object.values(services).map(({id,name,description})=>{const connection=connected.find(c=>c.service===id);return {id,name,description,connectionId:connection?.id,status:this.oauth.statuses.get(id)||(connection?'connected':'not connected')};}),asideConnection:connected.find(c=>c.kind==='aside')?.id};
 }
 async connectAside({profile,privacyConfirmed}) {
  const status=await this.inspect();
  const selected=profile||(status.profiles.length===1?status.profiles[0]:null);
  if(!status.clients.aside||!selected||!status.profiles.includes(selected))throw new Error('Open Aside, enable its CLI in Developer settings, and choose an available profile.');
  const existing=this.connections.all().find(c=>c.kind==='aside'&&c.account===selected);
  if(existing)return existing;
  return this.connections.save({kind:'aside',name:'Aside browser',account:selected,localBrowserOnly:privacyConfirmed});
 }
}
