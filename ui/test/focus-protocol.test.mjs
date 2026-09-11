import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync,lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CodexClient} from '../server/focus/clients.mjs';

test('official-client protocol round trip keeps login state in its own profile',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'focus-protocol-'));
 const binary=join(dir,'synthetic-codex');
 writeFileSync(binary,`#!/usr/bin/env node
const {createInterface}=require('node:readline');
const {writeFileSync}=require('node:fs');
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id)return;
 let result={};
 if(m.method==='account/read')result={account:{type:'chatgpt',planType:'synthetic'}};
 if(m.method==='account/login/start')result={authUrl:'https://auth.openai.com/authorize',loginId:'synthetic'};
 if(m.method==='thread/start'){writeFileSync(process.env.CODEX_HOME+'/observed.json',JSON.stringify({cwd:process.cwd(),args:process.argv,thread:m.params}));result={thread:{id:'synthetic-thread'},model:'gpt-6-astra'};}
 if(m.method==='turn/start'){if(m.params.sandboxPolicy?.access || m.params.permissions!=='onejob'){send({id:m.id,error:{code:-32600,message:'readOnly.access is no longer supported; use a named permissions profile'}});return;}result={turn:{id:'synthetic-turn'}};send({id:m.id,result});send({method:'item/completed',params:{threadId:'synthetic-thread',item:{type:'agentMessage',phase:'final_answer',text:JSON.stringify({reply:'Synthetic protocol fixture',memories:[]})}}});send({method:'turn/completed',params:{threadId:'synthetic-thread',turn:{status:'completed'}}});return;}
 send({id:m.id,result});
});
`,{mode:0o700});
 const client=new CodexClient(dir,binary);t.after(()=>{client.close();rmSync(dir,{recursive:true,force:true});});
 assert.equal((await client.account()).connected,true);
 assert.equal((await client.login()).url,'https://auth.openai.com/authorize');
 const answer=await client.answer({problem:{title:'Synthetic task'},recent:[],evidence:[]},new AbortController().signal);
 assert.equal(answer.reply,'Synthetic protocol fixture');
 const observed=JSON.parse(readFileSync(join(dir,'codex-profile/observed.json'),'utf8'));
 assert.equal(observed.thread.ephemeral,true);assert.equal(observed.thread.approvalPolicy,'never');assert.equal(observed.cwd,realpathSync(join(dir,'empty-workspace')));assert.equal(lstatSync(join(dir,'codex-profile')).isSymbolicLink(),false);
 assert.equal(observed.thread.permissions,'onejob');assert.ok(observed.args.includes('permissions.onejob.network.enabled=false'));assert.ok(observed.args.includes('permissions.onejob.filesystem={":root"="deny",":minimal"="read",":workspace_roots"={"."="read"}}'));
 assert.deepEqual(await client.logout(),{connected:false});
});
