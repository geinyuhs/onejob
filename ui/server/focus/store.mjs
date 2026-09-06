import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class ProblemError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function requiredText(value, max = 16000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new ProblemError(`Enter text between 1 and ${max} characters.`);
  return value.trim();
}
const words = text => [...new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])]
  .filter(w => !new Set(['the','and','that','this','with','have','from','what','your','you','for','are','but','was','how','can','our','about']).has(w));

export class ProblemStore {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS problems(id TEXT PRIMARY KEY, title TEXT NOT NULL,
        brief TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_problem ON problems(active) WHERE active=1;
      CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, problem_id TEXT NOT NULL REFERENCES problems(id),
        kind TEXT NOT NULL, text TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', source_id TEXT,
        quote TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'confirmed', created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS entry_search USING fts5(title,text,content='entries',content_rowid='rowid',tokenize='porter unicode61');
      CREATE TRIGGER IF NOT EXISTS entry_search_insert AFTER INSERT ON entries BEGIN
        INSERT INTO entry_search(rowid,title,text) VALUES(new.rowid,new.title,new.text); END;
      CREATE TRIGGER IF NOT EXISTS entry_search_delete AFTER DELETE ON entries BEGIN
        INSERT INTO entry_search(entry_search,rowid,title,text) VALUES('delete',old.rowid,old.title,old.text); END;
      CREATE TRIGGER IF NOT EXISTS entry_search_update AFTER UPDATE OF title,text ON entries BEGIN
        INSERT INTO entry_search(entry_search,rowid,title,text) VALUES('delete',old.rowid,old.title,old.text);
        INSERT INTO entry_search(rowid,title,text) VALUES(new.rowid,new.title,new.text); END;
      CREATE TABLE IF NOT EXISTS folders(id TEXT PRIMARY KEY,problem_id TEXT NOT NULL REFERENCES problems(id),path TEXT NOT NULL,label TEXT NOT NULL,UNIQUE(problem_id,path));
      CREATE TABLE IF NOT EXISTS folder_entries(entry_id TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,file TEXT NOT NULL,digest TEXT NOT NULL);
      INSERT INTO entry_search(entry_search) VALUES('rebuild');`);
  }
  close() { this.db.close(); }
  config() { const row = this.db.prepare("SELECT value FROM settings WHERE key='model'").get(); return row ? JSON.parse(row.value) : null; }
  setConfig(config) { this.db.prepare("INSERT OR REPLACE INTO settings VALUES ('model',?)").run(JSON.stringify(config)); }
  active() { const p = this.db.prepare('SELECT * FROM problems WHERE active=1').get(); return p ? { ...p, brief: JSON.parse(p.brief) } : null; }
  snapshot() {
    const problem = this.active();
    const entries = problem ? this.db.prepare('SELECT * FROM entries WHERE problem_id=? ORDER BY created,rowid').all(problem.id) : [];
    const folders = problem ? this.db.prepare('SELECT id,label FROM folders WHERE problem_id=?').all(problem.id) : [];
    return { problem, entries, folders, archives: this.db.prepare('SELECT id,title,created FROM problems WHERE active=0 ORDER BY created DESC').all() };
  }
  create(title) {
    title = requiredText(title, 500);
    if (this.active()) throw new ProblemError('Archive the current problem before starting another.', 409);
    const id = randomUUID();
    this.db.prepare('INSERT INTO problems(id,title,brief,created) VALUES (?,?,?,?)').run(id, title,
      JSON.stringify({ outcome: '', why: '', constraints: '', tried: '', nextStep: '', openQuestion: 'What would a meaningful improvement look like?' }), new Date().toISOString());
    this.add('user', title);
    return this.snapshot();
  }
  requireActive() { const p = this.active(); if (!p) throw new ProblemError('Choose your most important problem first.', 409); return p; }
  add(kind, text, extra = {}) {
    const p = this.requireActive();
    const id = randomUUID();
    this.db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?,?,?)').run(id, p.id, kind, requiredText(text),
      String(extra.title || ''), extra.source_id || null, String(extra.quote || ''), extra.status || 'confirmed', new Date().toISOString());
    return id;
  }
  advance() { const p = this.requireActive(); this.db.prepare('UPDATE problems SET revision=revision+1 WHERE id=?').run(p.id); return this.active(); }
  editBrief(brief) {
    const p = this.requireActive();
    const clean = {};
    for (const key of ['outcome','why','constraints','tried','nextStep','openQuestion']) {
      const v = brief?.[key] ?? p.brief[key] ?? '';
      if (typeof v !== 'string' || v.length > 4000) throw new ProblemError('A brief field is too long.');
      clean[key] = v;
    }
    this.db.prepare('UPDATE problems SET brief=?,revision=revision+1 WHERE id=?').run(JSON.stringify(clean), p.id);
  }
  archive() { const p = this.requireActive(); this.db.prepare('UPDATE problems SET active=0,revision=revision+1 WHERE id=?').run(p.id); }
  restore(id) {
    if (this.active()) throw new ProblemError('Archive the current problem before restoring another.',409);
    const row = this.db.prepare('SELECT id FROM problems WHERE id=? AND active=0').get(id);
    if (!row) throw new ProblemError('Archived problem not found.',404);
    this.db.prepare('UPDATE problems SET active=1,revision=revision+1 WHERE id=?').run(id);
  }
  decide(id, action) {
    if (!['confirm','forget'].includes(action)) throw new ProblemError('Unknown memory action.');
    const p = this.requireActive();
    const row = this.db.prepare('SELECT * FROM entries WHERE id=? AND problem_id=?').get(id,p.id);
    if (!row || !['fact','belief','hypothesis','attempt','decision'].includes(row.kind)) throw new ProblemError('Memory not found.',404);
    if (row.status==='forgotten') throw new ProblemError('Memory not found.',404);
    this.db.prepare('UPDATE entries SET status=? WHERE id=?').run(action === 'confirm' ? 'confirmed' : 'forgotten',id);
    this.advance();
  }
  candidates() {
    const p = this.requireActive();
    return this.db.prepare("SELECT * FROM entries WHERE problem_id=? AND status!='forgotten' AND kind!='assistant' ORDER BY created DESC LIMIT 1000").all(p.id);
  }
  retrieve(query, limit = 8) {
    const tokens = words(query);
    const allowed = new Map(this.candidates().map(row => [row.id,row]));
    if (!tokens.length) return [];
    const match = tokens.slice(0,40).map(token => '"'+token+'"').join(' OR ');
    return this.db.prepare('SELECT entries.id,bm25(entry_search,2,1) AS rank FROM entry_search JOIN entries ON entries.rowid=entry_search.rowid WHERE entry_search MATCH ? ORDER BY rank').all(match)
      .filter(row => allowed.has(row.id)).slice(0,limit).map(row => ({...allowed.get(row.id),score:-row.rank,matched:tokens.filter(t => words(allowed.get(row.id).text+' '+allowed.get(row.id).title).includes(t)),retrieval:'keyword'}));
  }
  context(utterance) {
    const { problem, entries } = this.snapshot();
    const evidence = this.retrieve(`${utterance} ${problem.title} ${problem.brief.openQuestion}`);
    const recent = entries.filter(e => ['user','assistant'].includes(e.kind) && e.status === 'confirmed').slice(-12);
    return { problem, evidence, recent };
  }
  applyResult(problemId, revision, result, allowedSources) {
    const p = this.active();
    if (!p || p.id !== problemId || p.revision !== revision) throw new ProblemError('This answer was superseded by your newer input.',409);
    const reply = requiredText(result.reply,12000);
    const memories = Array.isArray(result.memories) ? result.memories.slice(0,6) : [];
    const valid = memories.map(m => {
      if (!['fact','belief','hypothesis','attempt','decision'].includes(m.kind)) throw new ProblemError('The model returned an invalid memory.',502);
      const source = allowedSources.find(e => e.id === m.source_id);
      if (!source || typeof m.quote !== 'string' || !m.quote.trim() || !source.text.includes(m.quote))
        throw new ProblemError('The model returned memory without supporting evidence.',502);
      return { ...m, text: requiredText(m.text,2000), status: 'proposed' };
    });
    this.db.exec('BEGIN');
    try {
      this.add('assistant',reply);
      for (const m of valid) this.add(m.kind,m.text,m);
      if (typeof result.next_question === 'string' || typeof result.next_step === 'string') {
        const brief = { ...p.brief };
        if (typeof result.next_question === 'string') brief.openQuestion = result.next_question.slice(0,2000);
        if (typeof result.next_step === 'string') brief.nextStep = result.next_step.slice(0,2000);
        this.db.prepare('UPDATE problems SET brief=? WHERE id=?').run(JSON.stringify(brief),p.id);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.snapshot();
  }
}
