import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// Every mutation runs a real negative test against an isolated broken copy.
// Red is required: a mutant that passes means the protection lacks proof.
const source=fileURLToPath(new URL('../server/focus/',import.meta.url));
const cases=[
 ['restore active exclusion','store.mjs',"if (this.active()) throw new ProblemError('Archive the current problem before restoring another.',409);",'', 'restore recovers'],
 ['restore existence','store.mjs',"if (!row) throw new ProblemError('Archived problem not found.',404);",'', 'restore recovers'],
 ['empty input','store.mjs',"typeof value !== 'string' || !value.trim() || value.length > max","false",'rejects empty'],
 ['single active problem','store.mjs',"if (this.active()) throw",'if (false) throw','rejects a second'],
 ['active problem required','store.mjs',"if (!p) throw",'if (false) throw','rejects actions without'],
 ['brief validation','store.mjs',"typeof v !== 'string' || v.length > 4000",'false','rejects invalid brief'],
 ['problem isolation','store.mjs',"WHERE problem_id=? AND status!='forgotten' AND kind!='assistant'","WHERE (problem_id=? OR 1=1) AND status!='forgotten' AND kind!='assistant'",'retrieval stays'],
 ['forgotten exclusion','store.mjs',"AND status!='forgotten'",'','retrieval stays'],
 ['assistant exclusion','store.mjs',"AND kind!='assistant'",'','retrieval stays'],
 ['memory kind','store.mjs',"if (!['fact','belief','hypothesis','attempt','decision'].includes(m.kind))",'if (false)','rejects unsupported'],
 ['memory quote','store.mjs',"if (!source || typeof m.quote !== 'string' || !m.quote.trim() || !source.text.includes(m.quote))",'if (false)','rejects unsupported'],
 ['stale revision','store.mjs',"p.revision !== revision",'false','stale answer'],
 ['stale problem','store.mjs',"p.id !== problemId",'false','stale answer'],
 ['memory action','store.mjs',"if (!['confirm','forget'].includes(action))",'if (false)','memory actions'],
 ['memory ownership','store.mjs',"SELECT * FROM entries WHERE id=? AND problem_id=?","SELECT * FROM entries WHERE id=? AND (problem_id=? OR 1=1)",'memory actions'],
 ['single request','service.mjs',"if(this.job) throw new ProblemError('An answer is already running. Stop it before sending another.');",'', 'overlapping sends'],
 ['cancel revision','service.mjs',"if(this.store.active()) this.store.advance();",'', 'cancelled result'],
 ['provider validation','service.mjs',"if(!['chatgpt','claude'].includes(p.provider))",'if(false)','unknown provider'],
 ['login destination','clients.mjs',"if (url.protocol !== 'https:' || !['auth.openai.com','chatgpt.com'].includes(url.hostname) || url.username || url.password)",'if (false)','login URLs'],
 ['credential environment','clients.mjs',"['HOME','USER','LOGNAME','PATH','TMPDIR','SHELL','LANG','LC_ALL'].filter(k => source[k])",'Object.keys(source)','official clients receive'],
 ['server request denial','clients.mjs',"this.write({id:message.id,error:{code:-32601,message:'This app does not expose tools or credentials.'}});",'this.write({id:message.id,result:{}});','unrequested RPC'],
 ['client tool disabling','clients.mjs',"'shell_tool',",'', 'client launches retain'],
];
for(const [name,file,before,after,pattern]of cases)test('mutation proof: '+name,t=>{
 const dir=mkdtempSync(join(tmpdir(),'focus-mutant-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const target=join(dir,'ui/server/focus');mkdirSync(join(dir,'ui/test'),{recursive:true});cpSync(source,target,{recursive:true,filter:path=>!path.includes('/node_modules')});
 cpSync(fileURLToPath(new URL('focus-store.test.mjs',import.meta.url)),join(dir,'ui/test/focus-store.test.mjs'));
 const path=join(target,file),text=readFileSync(path,'utf8');assert.ok(text.includes(before),'mutation still addresses live code');writeFileSync(path,text.replace(before,after));
 const run=spawnSync(process.execPath,['--test','--test-timeout=2000','--test-name-pattern='+pattern,join(dir,'ui/test/focus-store.test.mjs')],{encoding:'utf8',timeout:5000,env:{...process.env,NODE_TEST_CONTEXT:undefined}});
 assert.equal(run.status,1,'the broken implementation must fail its negative test: '+name);
 assert.match(run.stdout,/fail [1-9]/,'the negative test must actually execute');
});
