import { lstatSync, realpathSync, readdirSync } from 'node:fs';
import { basename, relative, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { walkFiles, extensionOf, SECRET_DIRS, isSecretName } from '../../../connectors/lib/fileWalk.mjs';
import { extractText, TEXT_EXTS } from '../../../connectors/lib/fileText.mjs';
import { ProblemError } from './store.mjs';

export class FolderContext {
  constructor(store,{walk=walkFiles}={}) { this.store=store; this.walk=walk; this.lastScan=null; }

  connect(path) {
    const stat=lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProblemError('Select a real folder, not a link.');
    const canonical=realpathSync(path);
    if (canonical.split(sep).some(part=>SECRET_DIRS.includes(part)) || isSecretName(basename(canonical)))
      throw new ProblemError('Credential folders cannot be added as context.');
    const problem=this.store.requireActive();
    this.store.db.prepare('INSERT OR IGNORE INTO folders VALUES (?,?,?,?)').run(randomUUID(),problem.id,canonical,basename(canonical));
    return this.sync();
  }

  roots() {
    const problem=this.store.active();
    return problem ? this.store.db.prepare('SELECT * FROM folders WHERE problem_id=?').all(problem.id) : [];
  }

  retire(entryIds) {
    for (const id of entryIds) {
      this.store.db.prepare("WITH RECURSIVE affected(id) AS (VALUES(?) UNION SELECT entries.id FROM entries JOIN affected ON entries.source_id=affected.id) UPDATE entries SET status='forgotten',quote='' WHERE id IN (SELECT id FROM affected)").run(id);
      this.store.db.prepare('DELETE FROM entries WHERE id=?').run(id);
    }
    // Old replies can repeat removed evidence. Keep them visible as history,
    // but exclude them from future model context and clear the derived plan.
    if (entryIds.length) {
      this.store.db.prepare("UPDATE entries SET status='stale' WHERE problem_id=? AND kind='assistant'").run(this.store.requireActive().id);
      this.store.editBrief({nextStep:'',openQuestion:''});
    }
  }

  disconnect(id) {
    const root=this.roots().find(root=>root.id===id);
    if (!root) throw new ProblemError('Folder not found for this problem.',404);
    this.store.db.exec('BEGIN');
    try {
      this.retire(this.store.db.prepare('SELECT entry_id FROM folder_entries WHERE folder_id=?').all(id).map(row=>row.entry_id));
      this.store.db.prepare('DELETE FROM folders WHERE id=?').run(id);
      this.store.advance();this.store.db.exec('COMMIT');
    } catch(error) { this.store.db.exec('ROLLBACK');throw error; }
  }

  sync() {
    let changed=0,skipped=0,partial=false;
    for (const root of this.roots()) {
      // A disconnected/unreadable root must not leave old context usable.
      let available=true;
      try { available=lstatSync(root.path).isDirectory() && realpathSync(root.path)===root.path;readdirSync(root.path); }
      catch(error) { available=false; }
      const documents=new Map();let visited=0;
      if (available) for (const file of this.walk(root.path,{onSkip:()=>{skipped++;}})) {
        if (++visited>200) {partial=true;break;}
        if (file.dataless || !TEXT_EXTS.includes(extensionOf(file.name))) {skipped++;continue;}
        const real=realpathSync(file.path);
        if (!real.startsWith(root.path+sep)) throw new ProblemError('A context file escaped its selected folder.');
        const text=extractText(real,extensionOf(file.name));
        if (!text) {skipped++;continue;}
        documents.set(relative(root.path,real),{text,digest:createHash('sha256').update(text).digest('hex')});
      }
      const existing=this.store.db.prepare('SELECT * FROM folder_entries WHERE folder_id=?').all(root.id);
      this.store.db.exec('BEGIN');
      try {
        for (const [file,document] of documents) {
          const previous=existing.filter(row=>row.file===file);
          if (previous.length && previous.every(row=>row.digest===document.digest)) continue;
          this.retire(previous.map(row=>row.entry_id));
          for (let offset=0;offset<document.text.length;offset+=5000) {
            const entryId=this.store.add('source',document.text.slice(offset,offset+5000),{title:`${root.label} / ${file} · excerpt ${Math.floor(offset/5000)+1}`});
            this.store.db.prepare('INSERT INTO folder_entries VALUES (?,?,?,?)').run(entryId,root.id,file,document.digest);
          }
          changed++;
        }
        if (!partial) {
          const gone=existing.filter(row=>!documents.has(row.file));
          this.retire(gone.map(row=>row.entry_id));changed+=new Set(gone.map(row=>row.file)).size;
        }
        if (changed) this.store.advance();
        this.store.db.exec('COMMIT');
      } catch(error) {this.store.db.exec('ROLLBACK');throw error;}
    }
    this.lastScan={changed,skipped,partial,at:new Date().toISOString()};
    return this.lastScan;
  }
}
