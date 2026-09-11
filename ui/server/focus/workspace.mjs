import {mkdirSync,lstatSync,realpathSync,readdirSync,renameSync,rmdirSync,mkdtempSync} from 'node:fs';
import {join,basename,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

// Only the app supplies this root. Never import the Desktop itself.
export class JobWorkspace {
  constructor(store,root) {
    this.store=store;this.root=this.directory(root);
    this.recovery=join(dirname(store.db.prepare('PRAGMA database_list').get().file),'deleted-job-folders');
    // No foreign key: ownership must survive a local job deletion long enough
    // to recover its files. Never sweep unregistered or user-selected folders.
    store.db.exec('CREATE TABLE IF NOT EXISTS job_workspaces(problem_id TEXT PRIMARY KEY,path TEXT NOT NULL UNIQUE,folder_id TEXT NOT NULL,title TEXT NOT NULL)');
  }
  directory(path) {
    mkdirSync(path,{recursive:true,mode:0o700});
    if(lstatSync(path).isSymbolicLink())throw new Error('The onejob folder must be a real folder, not a link.');
    return realpathSync(path);
  }
  ensure() {
    const root=this.directory(this.root),db=this.store.db;
    for(const folder of db.prepare('SELECT f.*,p.title FROM folders f JOIN problems p ON p.id=f.problem_id').all()) {
      if(folder.path===join(root,'Job-'+folder.problem_id) && /^Job-[a-f0-9-]{36}$/i.test(basename(folder.path)))
        db.prepare('INSERT OR IGNORE INTO job_workspaces VALUES (?,?,?,?)').run(folder.problem_id,folder.path,folder.id,'');
    }
    for(const owned of db.prepare('SELECT * FROM job_workspaces').all()) {
      const problem=db.prepare('SELECT * FROM problems WHERE id=?').get(owned.problem_id);
      const present=this.ownedDirectory(owned.path);
      if(!problem) {
        if(present) {
          const recovery=this.directory(this.recovery),batch=mkdtempSync(join(recovery,'job-'));
          renameSync(owned.path,join(batch,basename(owned.path)));
        }
        db.prepare('DELETE FROM job_workspaces WHERE problem_id=?').run(owned.problem_id);
        continue;
      }
      const title=this.folderName(problem.title);
      if(!title && (!present || readdirSync(owned.path).length===0) && !db.prepare('SELECT 1 FROM folder_entries WHERE folder_id=? LIMIT 1').get(owned.folder_id)) {
        if(present)rmdirSync(owned.path);
        db.prepare('DELETE FROM folders WHERE id=?').run(owned.folder_id);
        db.prepare('DELETE FROM job_workspaces WHERE problem_id=?').run(owned.problem_id);
        continue;
      }
      if(present && title && owned.title!==title) {
        const path=this.availablePath(title,owned.path);
        if(path!==owned.path)renameSync(owned.path,path);
        db.prepare('UPDATE folders SET path=?,label=? WHERE id=?').run(path,basename(path),owned.folder_id);
        db.prepare('UPDATE job_workspaces SET path=?,title=? WHERE problem_id=?').run(path,title,problem.id);
      }
    }
    const problem=this.store.active();
    if(!problem)return root;
    const owned=db.prepare('SELECT * FROM job_workspaces WHERE problem_id=?').get(problem.id);
    if(!owned && !this.folderName(problem.title))return root;
    const path=owned?.path||this.availablePath(this.folderName(problem.title));
    this.directory(path);
    const folderId=owned?.folder_id||randomUUID();
    db.prepare('INSERT OR IGNORE INTO folders VALUES (?,?,?,?)').run(folderId,problem.id,path,basename(path));
    db.prepare('INSERT OR IGNORE INTO job_workspaces VALUES (?,?,?,?)').run(problem.id,path,folderId,this.folderName(problem.title));
    return path;
  }
  folderName(title) {
    if(title==='New onejob')return '';
    let name=[...String(title).normalize('NFC').replace(/[\p{C}\\/:*?"<>|]/gu,' ').replace(/\s+/g,' ').replace(/^[. ]+|[. ]+$/g,'')].slice(0,80).join('').trim();
    while(Buffer.byteLength(name)>200)name=[...name].slice(0,-1).join('');
    return name||'Untitled problem';
  }
  ownedDirectory(path) {
    if(dirname(path)!==this.root)throw new Error('A managed job folder must stay inside onejob.');
    try {
      const stat=lstatSync(path);
      if(stat.isSymbolicLink()||!stat.isDirectory()||realpathSync(path)!==path)throw new Error('The managed job folder must be a real folder, not a link.');
      return true;
    } catch(error) {if(error.code==='ENOENT')return false;throw error;}
  }
  availablePath(title,current=null) {
    for(let suffix=1;;suffix++) {
      const path=join(this.root,title+(suffix===1?'':` (${suffix})`));
      if(path===current)return path;
      try {lstatSync(path);}catch(error){if(error.code==='ENOENT'&&!this.store.db.prepare('SELECT 1 FROM job_workspaces WHERE path=?').get(path))return path;if(error.code!=='ENOENT')throw error;}
    }
  }
  isManaged(folderId) {return !!this.store.db.prepare('SELECT 1 FROM job_workspaces WHERE folder_id=?').get(folderId);}
  snapshot() {const state=this.store.snapshot();return {...state,folders:state.folders.map(folder=>({...folder,managed:this.isManaged(folder.id)}))};}
}
