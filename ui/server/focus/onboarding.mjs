import {ProblemError,requiredText} from './store.mjs';

// active=1 is selected; active=2 is parked; active=0 remains archived.
export class Onboarding {
  constructor(store) {
    this.store=store;this.db=store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS job_flow(problem_id TEXT PRIMARY KEY REFERENCES problems(id),stage TEXT NOT NULL,draft TEXT NOT NULL DEFAULT '',plan TEXT NOT NULL DEFAULT '');
      UPDATE job_flow SET stage='problem' WHERE stage='research';`);
  }
  state() {const p=this.store.active();return p?(this.db.prepare('SELECT stage,draft,plan FROM job_flow WHERE problem_id=?').get(p.id)||{stage:'work',draft:'',plan:''}):{stage:'empty',draft:'',plan:''};}
  list() {return this.db.prepare('SELECT p.id,p.title,p.active,COALESCE(f.stage,\'work\') stage FROM problems p LEFT JOIN job_flow f ON f.problem_id=p.id WHERE p.active IN (1,2) ORDER BY p.created,p.rowid').all();}
  transaction(fn) {this.db.exec('BEGIN');try{fn();this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}}
  create() {
    this.transaction(()=>{this.db.exec('UPDATE problems SET active=2,revision=revision+1 WHERE active=1');this.store.create('New onejob');const id=this.store.active().id;this.db.prepare('DELETE FROM entries WHERE problem_id=?').run(id);this.db.prepare("INSERT INTO job_flow(problem_id,stage) VALUES(?,'connect')").run(id);});
  }
  select(id) {
    const row=this.db.prepare('SELECT id FROM problems WHERE id=? AND active IN (1,2)').get(id);
    if(!row)throw new ProblemError('Job not found.');
    this.transaction(()=>{this.db.exec('UPDATE problems SET active=2,revision=revision+1 WHERE active=1');this.db.prepare('UPDATE problems SET active=1,revision=revision+1 WHERE id=?').run(id);});
  }
  stage(stage) {this.db.prepare('UPDATE job_flow SET stage=? WHERE problem_id=?').run(stage,this.store.requireActive().id);}
  describe(text) {
    text=requiredText(text,16000);const p=this.store.requireActive();
    this.db.prepare("UPDATE job_flow SET draft=?,stage='research' WHERE problem_id=?").run(text,p.id);
    this.db.prepare('UPDATE problems SET title=? WHERE id=?').run(text.split('\n')[0].slice(0,100),p.id);
  }
  finish() {const reply=this.store.snapshot().entries.filter(e=>e.kind==='assistant').at(-1)?.text||'';this.db.prepare("UPDATE job_flow SET plan=?,stage='plan' WHERE problem_id=?").run(reply,this.store.requireActive().id);}
}
