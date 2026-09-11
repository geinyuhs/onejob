import {ProblemError,requiredText} from './store.mjs';

export function executionResponseType(result) {
  if(result.responseType)return result.responseType==='confirmation'?'confirmation':'text';
  // Older saved questions have no response type. Recognize permission phrasing,
  // not requests for missing details such as "Which size?" or "Can you share...".
  return /^(?:would you like|do you want|should I|shall I|may I|can I|is it (?:ok|okay)\b)/iu.test(String(result.question||'').trim())?'confirmation':'text';
}

export function validateExecution(result) {
  const outcome=result?.execution;
  if(!outcome || !['completed','needs_input','blocked'].includes(outcome.status))throw new ProblemError('The AI did not say whether the work finished. Your progress is saved; try again.',502);
  const question=outcome.status==='needs_input'?requiredText(outcome.question,2000):'';
  return {status:outcome.status,question,responseType:executionResponseType(outcome),reply:requiredText(result.reply,120000)};
}

export class Execution {
  constructor(store,flow) {
    this.store=store;this.flow=flow;
    store.db.exec(`CREATE TABLE IF NOT EXISTS job_execution(problem_id TEXT PRIMARY KEY REFERENCES problems(id),result TEXT NOT NULL);
      UPDATE job_flow SET stage='executionPaused' WHERE stage='executing';`);
    // Older questions were displayed without checking whether the agent could
    // retrieve the data. Preserve them as history, but require a fresh run.
    store.db.exec(`UPDATE job_flow SET stage='executionPaused' WHERE stage='needsInput'
      AND problem_id IN (SELECT problem_id FROM job_execution
        WHERE json_extract(result,'$.status')='needs_input'
        AND COALESCE(json_extract(result,'$.inputReviewVersion'),0)<1);`);
  }
  state() {
    const row=this.store.db.prepare('SELECT result FROM job_execution WHERE problem_id=?').get(this.store.active()?.id||'');
    const result=row?JSON.parse(row.result):null;
    return result?{...result,responseType:executionResponseType(result)}:null;
  }
  clear() {this.store.db.prepare('DELETE FROM job_execution WHERE problem_id=?').run(this.store.requireActive().id);}
  save(result) {
    this.store.db.prepare('INSERT OR REPLACE INTO job_execution(problem_id,result) VALUES(?,?)').run(this.store.requireActive().id,JSON.stringify(result));
    this.flow.stage(result.status==='needs_input'?'needsInput':'results');
  }
}
