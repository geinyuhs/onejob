import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {ProblemStore} from '../server/focus/store.mjs';
import {FolderContext} from '../server/focus/folders.mjs';
import {ProblemService} from '../server/focus/service.mjs';
import {JobWorkspace} from '../server/focus/workspace.mjs';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'onejob-desktop-'));const root=join(dir,'Desktop','onejob');
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
