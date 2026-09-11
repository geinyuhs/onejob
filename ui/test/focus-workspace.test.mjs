import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync,readdirSync,realpathSync} from 'node:fs';
import {join,basename,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {ProblemStore} from '../server/focus/store.mjs';
import {FolderContext} from '../server/focus/folders.mjs';
import {ProblemService} from '../server/focus/service.mjs';
import {JobWorkspace} from '../server/focus/workspace.mjs';
function fixture(t){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'onejob-desktop-')));const root=join(dir,'Desktop','onejob');
 const store=new ProblemStore(join(dir,'data','memory.sqlite'));
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return {dir,root,store};
}
test('Desktop workspace is automatic and imports only the active job folder',async t=>{
 const f=fixture(t),workspace=new JobWorkspace(f.store,f.root),folders=new FolderContext(f.store);
 assert.ok(existsSync(f.root));writeFileSync(join(f.dir,'Desktop','unrelated.txt'),'Unrelated desktop canary');writeFileSync(join(f.root,'outside-job.txt'),'Outside job canary');
 const service=new ProblemService(f.store,{}, {workspace,folders});
 const first=await service.call('create',{title:'Synthetic first job'});const path=first.workspacePath;
 assert.ok(existsSync(path));assert.equal(first.folders.length,1);writeFileSync(join(path,'notes.md'),'Illustration plans for this job');service.syncFolders();assert.equal(f.store.retrieve('illustration').length,1);assert.equal(f.store.retrieve('canary').length,0);
 writeFileSync(join(path,'notes.md'),'Painting plans changed');service.syncFolders();assert.equal(f.store.retrieve('illustration').length,0);assert.equal(f.store.retrieve('painting').length,1);
 await service.call('archive');const second=await service.call('create',{title:'Synthetic next job'});assert.notEqual(second.workspacePath,path);assert.equal(f.store.retrieve('painting').length,0);
 await service.call('archive');const restored=await service.call('restore',{id:first.problem.id});assert.equal(restored.workspacePath,path);assert.equal(restored.folders.length,1);
 assert.deepEqual(await service.call('showWorkspace',{path:'/untrusted'}),{workspaceToOpen:path});
 rmSync(join(path,'notes.md'));service.syncFolders();assert.equal(f.store.retrieve('painting').length,0);
 assert.equal(new JobWorkspace(f.store,f.root).ensure(),path);assert.equal(folders.roots().length,1);
});
async function linkedScenario(t,Implementation=JobWorkspace){
 const f=fixture(t);mkdirSync(join(f.dir,'elsewhere'));mkdirSync(join(f.dir,'Desktop'));symlinkSync(join(f.dir,'elsewhere'),f.root);
 assert.throws(()=>new Implementation(f.store,f.root),/real folder/);
}
test('an existing Desktop symlink cannot silently select another folder',t=>linkedScenario(t));
test('mutation proof: removing the workspace link check breaks the negative test',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'onejob-desktop-mutation-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const original=readFileSync(new URL('../server/focus/workspace.mjs',import.meta.url),'utf8');const guard='if(lstatSync(path).isSymbolicLink())';assert.ok(original.includes(guard));
 const path=join(dir,'workspace.mjs');writeFileSync(path,original.replace(guard,'if(false)'));
 const {JobWorkspace:Broken}=await import(pathToFileURL(path));await assert.rejects(linkedScenario(t,Broken),/Missing expected exception/);
});

function legacy(f,title='New onejob') {
 f.store.create(title);const id=f.store.active().id,path=join(f.root,'Job-'+id);mkdirSync(path,{recursive:true});
 f.store.db.prepare('INSERT INTO folders VALUES (?,?,?,?)').run('folder-'+id,id,path,basename(path));
 return {id,path};
}
async function mutate(t,before,after) {
 const dir=mkdtempSync(join(tmpdir(),'onejob-workspace-mutant-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const code=readFileSync(new URL('../server/focus/workspace.mjs',import.meta.url),'utf8');assert.ok(code.includes(before));
 const path=join(dir,'workspace.mjs');writeFileSync(path,code.replace(before,after));return (await import(pathToFileURL(path))).JobWorkspace;
}
function blankScenario(t,Implementation=JobWorkspace) {
 const f=fixture(t),old=legacy(f);f.store.archive();const current=legacy(f);
 const workspace=new Implementation(f.store,f.root);
 assert.equal(workspace.ensure(),f.root,'blank jobs do not create folders');
 assert.ok(!existsSync(old.path)&&!existsSync(current.path),'empty draft folders are removed');
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM folders').get().n,0);
 f.store.db.prepare('UPDATE problems SET title=? WHERE id=?').run('Plan the garden',current.id);
 assert.equal(basename(workspace.ensure()),'Plan the garden');
 assert.equal(workspace.snapshot().folders[0].managed,true);
}
test('blank jobs wait for a problem name and empty legacy drafts are cleaned up',t=>blankScenario(t));
test('mutation proof: unnamed jobs cannot create folders',async t=>{
 const Broken=await mutate(t,"if(title==='New onejob')return '';",'');
 assert.throws(()=>blankScenario(t,Broken),/blank jobs/);
});
test('renaming a legacy job preserves files, folder identity and indexed excerpts',t=>{
 const f=fixture(t),old=legacy(f,'Plan the garden'),workspace=new JobWorkspace(f.store,f.root),folders=new FolderContext(f.store);
 writeFileSync(join(old.path,'notes.txt'),'Synthetic garden notes');folders.sync();
 const before=f.store.snapshot().entries.map(e=>e.id),folderId=folders.roots()[0].id;
 const named=workspace.ensure();assert.equal(basename(named),'Plan the garden');assert.ok(!existsSync(old.path));
 assert.equal(readFileSync(join(named,'notes.txt'),'utf8'),'Synthetic garden notes');folders.sync();
 assert.deepEqual(f.store.snapshot().entries.map(e=>e.id),before);assert.equal(folders.roots()[0].id,folderId);
 f.store.db.prepare('UPDATE problems SET title=? WHERE id=?').run('Grow herbs',old.id);
 const renamed=workspace.ensure();assert.equal(basename(renamed),'Grow herbs');assert.equal(folders.roots()[0].path,renamed);
 assert.equal(workspace.ensure(),renamed);
});
test('unnamed drafts containing files are kept until the problem gets a name',t=>{
 const f=fixture(t),old=legacy(f),workspace=new JobWorkspace(f.store,f.root);
 writeFileSync(join(old.path,'keep.txt'),'Synthetic note');assert.equal(workspace.ensure(),old.path);
 assert.equal(readFileSync(join(old.path,'keep.txt'),'utf8'),'Synthetic note');
});
function collisionScenario(t,Implementation=JobWorkspace) {
 const f=fixture(t),workspace=new Implementation(f.store,f.root);
 const occupied=join(f.root,'Plan the garden');mkdirSync(occupied);writeFileSync(join(occupied,'keep.txt'),'Not owned by this job');
 f.store.create('Plan the garden');const first=workspace.ensure();assert.notEqual(first,occupied,'existing folders cannot be adopted or overwritten');
 assert.equal(basename(first),'Plan the garden (2)');f.store.archive();f.store.create('Plan the garden');
 assert.equal(basename(workspace.ensure()),'Plan the garden (3)');assert.ok(existsSync(join(occupied,'keep.txt')));
}
test('duplicate titles get readable numbers without merging jobs or existing folders',t=>collisionScenario(t));
test('mutation proof: occupied names cannot be reused',async t=>{
 const Broken=await mutate(t,'if(path===current)return path;','if(true)return path;');
 assert.throws(()=>collisionScenario(t,Broken),/existing folders/);
});
test('problem text cannot create nested, hidden or overlong folder paths',t=>{
 const f=fixture(t),workspace=new JobWorkspace(f.store,f.root);
 for(const title of ['../../outside',' / : \\ ? * | < > ','.hidden\u0000\u202e','🌱'.repeat(150)]) {
  f.store.create(title);const path=workspace.ensure();assert.equal(dirname(path),f.root);assert.ok(!basename(path).startsWith('.'));assert.ok([...basename(path)].length<=80);f.store.archive();
 }
});
function resetScenario(t,Implementation=JobWorkspace) {
 const f=fixture(t),workspace=new Implementation(f.store,f.root);f.store.create('Plan the garden');
 const id=f.store.active().id,path=workspace.ensure();writeFileSync(join(path,'keep.txt'),'Recover this synthetic note');
 const manual=join(f.dir,'Selected context');mkdirSync(manual);new FolderContext(f.store).connect(manual);
 f.store.db.prepare('DELETE FROM entries WHERE problem_id=?').run(id);f.store.db.prepare('DELETE FROM folders WHERE problem_id=?').run(id);
 f.store.db.prepare('DELETE FROM hermes_context_epochs WHERE problem_id=?').run(id);f.store.db.prepare('DELETE FROM problems WHERE id=?').run(id);
 workspace.ensure();assert.ok(!existsSync(path),'reset removes its owned folder from the Desktop');assert.ok(existsSync(manual));
 const batches=readdirSync(workspace.recovery);assert.equal(batches.length,1);
 assert.equal(readFileSync(join(workspace.recovery,batches[0],'Plan the garden','keep.txt'),'utf8'),'Recover this synthetic note');
 workspace.ensure();assert.equal(readdirSync(workspace.recovery).length,1);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM job_workspaces').get().n,0);
}
test('local job deletion recovers its owned folder and leaves manually selected folders alone',t=>resetScenario(t));
test('mutation proof: deleting a job cannot leave its workspace behind',async t=>{
 const Broken=await mutate(t,'renameSync(owned.path,join(batch,basename(owned.path)));','');
 assert.throws(()=>resetScenario(t,Broken),/reset removes/);
});
function boundaryScenario(t,kind,Implementation=JobWorkspace) {
 const f=fixture(t),workspace=new Implementation(f.store,f.root);f.store.create('Plan the garden');const id=f.store.active().id;
 const outside=join(f.dir,'outside');mkdirSync(outside);const path=kind==='outside'?outside:join(f.root,'linked');
 if(kind==='link')symlinkSync(outside,path);
 f.store.db.prepare('INSERT INTO job_workspaces VALUES (?,?,?,?)').run(id,path,'synthetic-folder','');
 assert.throws(()=>workspace.ensure(),/inside onejob|real folder/,'unowned paths must be rejected');assert.ok(existsSync(outside));assert.ok(existsSync(path),'unowned paths cannot move before rejection');
}
for(const kind of ['outside','link']) {
 test(`workspace moves reject ${kind} paths`,t=>boundaryScenario(t,kind));
 test(`mutation proof: ${kind} boundary fires`,async t=>{
  const guard=kind==='outside'?"if(dirname(path)!==this.root)":"if(stat.isSymbolicLink()||!stat.isDirectory()||realpathSync(path)!==path)";
  const Broken=await mutate(t,guard,'if(false)');assert.throws(()=>boundaryScenario(t,kind,Broken),/unowned paths/);
 });
}
function manualScenario(t,Implementation=JobWorkspace) {
 const f=fixture(t),workspace=new Implementation(f.store,f.root);f.store.create('Plan the garden');
 const manual=join(f.root,'Selected notes');mkdirSync(manual);new FolderContext(f.store).connect(manual);
 workspace.ensure();assert.ok(existsSync(manual),'selected folders must never be renamed');
 assert.equal(workspace.snapshot().folders.find(f=>f.label==='Selected notes').managed,false);
}
test('migration claims only registered legacy job folders, not selected context',t=>manualScenario(t));
test('mutation proof: legacy migration cannot claim arbitrary selected folders',async t=>{
 const Broken=await mutate(t,"if(folder.path===join(root,'Job-'+folder.problem_id) && /^Job-[a-f0-9-]{36}$/i.test(basename(folder.path)))",'if(true)');
 assert.throws(()=>manualScenario(t,Broken),/selected folders/);
});
test('mutation proof: multibyte titles stay within filesystem name limits',async t=>{
 const check=Implementation=>assert.ok(Buffer.byteLength(Implementation.prototype.folderName('🌱'.repeat(150)))<=200,'folder names need a byte limit');
 check(JobWorkspace);
 const Broken=await mutate(t,"while(Buffer.byteLength(name)>200)name=[...name].slice(0,-1).join('');",'');
 assert.throws(()=>check(Broken),/byte limit/);
});
test('the real intake creates a named folder only after describing the problem',async t=>{
 const f=fixture(t),workspace=new JobWorkspace(f.store,f.root),service=new ProblemService(f.store,{}, {workspace});
 const blank=await service.call('newJob');assert.equal(blank.workspacePath,f.root);assert.equal(blank.folders.length,0);
 service.flow.stage('problem');const named=await service.call('describe',{text:'Plan the garden\nSome synthetic context.'});
 assert.equal(basename(named.workspacePath),'Plan the garden');assert.equal(named.folders[0].managed,true);
});
