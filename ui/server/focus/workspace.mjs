import {mkdirSync,lstatSync,realpathSync} from 'node:fs';
import {join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';

// Only the app supplies this root. Never import the Desktop itself.
export class JobWorkspace {
  constructor(store,root) {this.store=store;this.root=root;this.directory(root);}
  directory(path) {
    mkdirSync(path,{recursive:true,mode:0o700});
    if(lstatSync(path).isSymbolicLink())throw new Error('The onejob folder must be a real folder, not a link.');
    return realpathSync(path);
  }
  ensure() {
    const root=this.directory(this.root),problem=this.store.active();
    if(!problem)return root;
    const path=this.directory(join(root,'Job-'+problem.id));
    this.store.db.prepare('INSERT OR IGNORE INTO folders VALUES (?,?,?,?)').run(randomUUID(),problem.id,path,basename(path));
    return path;
  }
}
