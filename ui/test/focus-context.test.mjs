import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,truncateSync,readFileSync,cpSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {ProblemStore} from '../server/focus/store.mjs';
import {FolderContext} from '../server/focus/folders.mjs';
import {ContextSearch} from '../server/focus/search.mjs';
import {ProblemService} from '../server/focus/service.mjs';

function fixture(t){const dir=mkdtempSync(join(tmpdir(),'onejob-context-'));const root=join(dir,'selected');mkdirSync(root);const store=new ProblemStore(join(dir,'state','memory.sqlite'));store.create('A synthetic job');t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return {dir,root,store,folders:new FolderContext(store)};}
test('folder sync reuses local readers and updates the SQLite search index',t=>{const f=fixture(t);const path=join(f.root,'notes.md');writeFileSync(path,'I am applying for illustration positions.');f.folders.connect(f.root);assert.equal(f.store.retrieve('apply')[0].kind,'source');assert.equal(f.store.snapshot().folders[0].label,'selected');const count=f.store.snapshot().entries.length;f.folders.sync();assert.equal(f.store.snapshot().entries.length,count);writeFileSync(path,'I accepted a position drawing maps.');f.folders.sync();assert.equal(f.store.retrieve('illustration').length,0);assert.equal(f.store.retrieve('maps')[0].kind,'source');});
test('changed or removed sources invalidate derived memories and old model context',t=>{const f=fixture(t);const path=join(f.root,'notes.txt');writeFileSync(path,'I prefer remote work.');f.folders.connect(f.root);const src=f.store.snapshot().entries.find(e=>e.kind==='source');const first=f.store.add('belief','Remote only',{source_id:src.id,quote:src.text});f.store.add('decision','Avoid offices',{source_id:first,quote:'Remote only'});f.store.add('assistant','Earlier advice using remote only');rmSync(path);f.folders.sync();assert.equal(f.store.retrieve('remote offices').length,0);assert.equal(f.store.context('help').recent.some(e=>e.kind==='assistant'),false);assert.equal(f.store.snapshot().entries.find(e=>e.id===first).quote,'');});
test('disconnect removes indexed copies and folder paths stay out of model context',t=>{const f=fixture(t);writeFileSync(join(f.root,'notes.txt'),'Synthetic private note');f.folders.connect(f.root);const context=f.store.context('private');assert.ok(!JSON.stringify(context).includes(f.root));f.folders.disconnect(f.store.snapshot().folders[0].id);assert.equal(f.store.snapshot().folders.length,0);assert.equal(f.store.retrieve('private').length,0);assert.throws(()=>f.folders.disconnect('missing'),/not found/);});
test('reused reader skips credential names, hidden files, symlinks, unsupported and dataless files',t=>{const f=fixture(t);writeFileSync(join(f.dir,'outside.txt'),'Outside canary');symlinkSync(join(f.dir,'outside.txt'),join(f.root,'link.txt'));writeFileSync(join(f.root,'.hidden.txt'),'Hidden canary');mkdirSync(join(f.root,'secrets'));writeFileSync(join(f.root,'secrets','note.txt'),'Secret canary');writeFileSync(join(f.root,'credentials.json'),'Credential canary');writeFileSync(join(f.root,'binary.pdf'),'Unsupported canary');const sparse=join(f.root,'cloud.txt');writeFileSync(sparse,'');truncateSync(sparse,65536);f.folders.connect(f.root);assert.deepEqual(f.store.snapshot().entries.filter(e=>e.kind==='source'),[]);});
test('folder scope rejects linked roots and credential directories',t=>{const f=fixture(t);const link=join(f.dir,'linked');symlinkSync(f.root,link);assert.throws(()=>f.folders.connect(link),/real folder/);const secret=join(f.dir,'secrets');mkdirSync(secret);assert.throws(()=>f.folders.connect(secret),/Credential/);});
test('a faulty file walker cannot read outside the selected root',t=>{const f=fixture(t);const path=join(f.dir,'outside.txt');writeFileSync(path,'Synthetic boundary canary');const folders=new FolderContext(f.store,{walk:()=>[{path,name:'outside.txt',dataless:false}]});assert.throws(()=>folders.connect(f.root),/escaped/);assert.equal(f.store.retrieve('canary').length,0);});
test('unreadable or replaced folder stops contributing old evidence',t=>{const f=fixture(t);writeFileSync(join(f.root,'note.txt'),'Remove this canary');f.folders.connect(f.root);rmSync(f.root,{recursive:true});f.folders.sync();assert.equal(f.store.retrieve('canary').length,0);});
test('folders belong only to their selected problem',t=>{const f=fixture(t);writeFileSync(join(f.root,'note.txt'),'First problem canary');f.folders.connect(f.root);f.store.archive();f.store.create('Another synthetic job');assert.equal(f.folders.roots().length,0);assert.equal(f.store.retrieve('canary').length,0);assert.throws(()=>f.folders.disconnect('missing'),/not found/);});
test('incomplete folder scans block provider dispatch',async t=>{const f=fixture(t);for(let i=0;i<201;i++)writeFileSync(join(f.root,`note-${i}.txt`),'Synthetic note');const scan=f.folders.connect(f.root);assert.equal(scan.partial,true);let sent=false;const service=new ProblemService(f.store,{chatgpt:{answer:async()=>{sent=true;return {reply:'Unexpected'};}}},{folders:f.folders});await assert.rejects(service.send('Help'),/too large/);assert.equal(sent,false);});
test('hybrid search combines lexical results with local meaning and rejects foreign IDs',t=>{const f=fixture(t);const id=f.store.add('source','I dread rejection',{title:'Journal'});f.store.add('source','Painting landscapes',{title:'Art'});const search=new ContextSearch(f.store,()=>({available:true,matches:[{id:'foreign'},{id}]}));assert.equal(search.retrieve('avoiding applications')[0].id,id);assert.equal(search.mode,'keyword + local meaning');f.store.db.prepare("UPDATE entries SET status='forgotten' WHERE id=?").run(id);assert.equal(search.retrieve('avoiding applications').length,0);});
test('missing local meaning model keeps honest keyword search',t=>{const f=fixture(t);f.store.add('source','Applications take time');const search=new ContextSearch(f.store);assert.equal(search.retrieve('application')[0].kind,'source');assert.equal(search.mode,'keyword');assert.deepEqual(f.store.retrieve('" OR () *'),[]);});

test('mutation proof: foreign semantic IDs cannot pass the retrieval boundary',async t=>{
 const f=fixture(t),file=join(f.dir,'search.mjs');
 writeFileSync(file,readFileSync(new URL('../server/focus/search.mjs',import.meta.url),'utf8').replace('if (!allowed.has(hit.id)) return;',''));
 const {ContextSearch:Broken}=await import(pathToFileURL(file));
 const broken=new Broken(f.store,()=>({available:true,matches:[{id:'foreign'}]}));
 assert.throws(()=>assert.equal(broken.retrieve('no match').length,0));
});

test('mutation proof: folder protections fail when removed',async t=>{
 const f=fixture(t),base=fileURLToPath(new URL('../../',import.meta.url));
 const target=join(f.dir,'copy');mkdirSync(join(target,'ui/server'),{recursive:true});mkdirSync(join(target,'connectors/lib'),{recursive:true});
 cpSync(join(base,'ui/server/focus'),join(target,'ui/server/focus'),{recursive:true,filter:path=>!path.includes('/node_modules')});
 for(const name of ['fileWalk.mjs','fileText.mjs'])cpSync(join(base,'connectors/lib',name),join(target,'connectors/lib',name));
 const path=join(target,'ui/server/focus/folders.mjs');
 const original=readFileSync(path,'utf8');
 const link=join(f.dir,'linked');symlinkSync(f.root,link);
 writeFileSync(path,original.replace("if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProblemError('Select a real folder, not a link.');",''));
 const {FolderContext:Linked}=await import(pathToFileURL(path)+'?linked');
 assert.throws(()=>assert.throws(()=>new Linked(f.store).connect(link),/real folder/));
 const secret=join(f.dir,'secrets');mkdirSync(secret);
 writeFileSync(path,original.replace("if (canonical.split(sep).some(part=>SECRET_DIRS.includes(part)) || isSecretName(basename(canonical)))",'if (false)'));
 const {FolderContext:Secret}=await import(pathToFileURL(path)+'?secret');
 assert.throws(()=>assert.throws(()=>new Secret(f.store).connect(secret),/Credential/));
 const outside=join(f.dir,'outside.txt');writeFileSync(outside,'Synthetic outside canary');
 writeFileSync(path,original.replace("if (!real.startsWith(root.path+sep)) throw new ProblemError('A context file escaped its selected folder.');",''));
 const {FolderContext:Escaped}=await import(pathToFileURL(path)+'?escape');
 assert.throws(()=>assert.throws(()=>new Escaped(f.store,{walk:()=>[{path:outside,name:'outside.txt',dataless:false}]}).connect(f.root),/escaped/));
});

test('mutation proof: incomplete scans cannot dispatch and removed evidence cannot recur',async t=>{
 const f=fixture(t),base=fileURLToPath(new URL('../../',import.meta.url));
 const target=join(f.dir,'copy');mkdirSync(join(target,'ui/server'),{recursive:true});
 cpSync(join(base,'ui/server/focus'),join(target,'ui/server/focus'),{recursive:true,filter:path=>!path.includes('/node_modules')});
 const servicePath=join(target,'ui/server/focus/service.mjs');
 writeFileSync(servicePath,readFileSync(servicePath,'utf8').replace('if (scan?.partial)', 'if (false)'));
 const {ProblemService:Broken}=await import(pathToFileURL(servicePath));
 let sent=false;
 const service=new Broken(f.store,{chatgpt:{answer:async()=>{sent=true;return {reply:'Synthetic reply'};}}},{folders:{sync:()=>({partial:true})}});
 await service.send('Synthetic prompt');
 assert.throws(()=>assert.equal(sent,false),'removing the gate must violate the no-dispatch assertion');
 const storePath=join(target,'ui/server/focus/store.mjs');
 writeFileSync(storePath,readFileSync(storePath,'utf8').replace(" && e.status === 'confirmed'",''));
 const {ProblemStore:Stale}=await import(pathToFileURL(storePath)+'?stale');
 const stale=new Stale(join(f.dir,'stale','memory.sqlite'));t.after(()=>stale.close());stale.create('Synthetic job');stale.add('assistant','Retired evidence',{status:'stale'});
 assert.throws(()=>assert.equal(stale.context('help').recent.some(e=>e.kind==='assistant'),false));
});

test('retired memories cannot be revived from a stale Keep button, with mutation proof',async t=>{
 const f=fixture(t);const id=f.store.add('belief','Retired synthetic claim',{status:'forgotten'});
 assert.throws(()=>f.store.decide(id,'confirm'),/not found/);
 const path=join(f.dir,'broken-store.mjs');writeFileSync(path,readFileSync(new URL('../server/focus/store.mjs',import.meta.url),'utf8').replace("if (row.status==='forgotten') throw new ProblemError('Memory not found.',404);",''));
 const {ProblemStore:Broken}=await import(pathToFileURL(path));const broken=new Broken(join(f.dir,'broken','memory.sqlite'));t.after(()=>broken.close());broken.create('Synthetic job');const bad=broken.add('belief','Retired synthetic claim',{status:'forgotten'});
 assert.throws(()=>assert.throws(()=>broken.decide(bad,'confirm'),/not found/));
});
