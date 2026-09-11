import {createHash,randomUUID} from 'node:crypto';
import {ProblemError,requiredText} from './store.mjs';
import {setupSettings} from './job-settings.mjs';

export function validateQuestions(result) {
  if(!result || Object.keys(result).join(',')!=='questions' || !Array.isArray(result.questions) || result.questions.length>3)
    throw new ProblemError('The AI could not make a short question list. Try again.');
  return result.questions.map(q=>{
    if(!q || !['options,question,why','options,question,recommendedIndex,why'].includes(Object.keys(q).sort().join(',')) || !Array.isArray(q.options) || q.options.length>4 || q.options.length===1)
      throw new ProblemError('The AI returned an unclear question. Try again.');
    const recommendedIndex=q.recommendedIndex??null;
    if(recommendedIndex!==null && (!Number.isInteger(recommendedIndex)||recommendedIndex<0||recommendedIndex>=q.options.length))throw new ProblemError('The AI recommended an unavailable choice. Try again.');
    return {question:requiredText(q.question,240),why:requiredText(q.why,240),options:q.options.map(o=>requiredText(o,120)),...(q.recommendedIndex!==undefined?{recommendedIndex}: {})};
  });
}

export class Clarification {
  constructor(store,flow) {
    this.store=store;this.flow=flow;this.db=store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS job_clarifications(
      problem_id TEXT PRIMARY KEY REFERENCES problems(id),token TEXT NOT NULL,input_hash TEXT NOT NULL,
      questions TEXT NOT NULL,responses TEXT NOT NULL,draft TEXT NOT NULL DEFAULT '');`);
    if(!this.db.prepare('PRAGMA table_info(job_clarifications)').all().some(column=>column.name==='draft_choices'))
      this.db.exec("ALTER TABLE job_clarifications ADD COLUMN draft_choices TEXT NOT NULL DEFAULT '[]'");
  }
  input() {return {problem:this.flow.state().draft,tried:this.store.requireActive().brief.tried};}
  hash() {return createHash('sha256').update(JSON.stringify(this.input())).digest('hex');}
  state() {
    const row=this.db.prepare('SELECT * FROM job_clarifications WHERE problem_id=?').get(this.store.active()?.id||'');
    return row?{token:row.token,inputHash:row.input_hash,questions:JSON.parse(row.questions),responses:JSON.parse(row.responses),draft:row.draft,draftChoices:JSON.parse(row.draft_choices)}:null;
  }
  current() {const row=this.state();return row?.inputHash===this.hash()?row:null;}
  save(questions,settings) {
    const preferences=setupSettings(settings,this.input());
    this.flow.transaction(()=>{
      this.store.saveJobSettings(preferences);
      this.db.prepare('INSERT OR REPLACE INTO job_clarifications (problem_id,token,input_hash,questions,responses,draft) VALUES (?,?,?,?,?,?)').run(this.store.requireActive().id,randomUUID(),this.hash(),JSON.stringify(questions),'[]','');
      this.flow.stage(questions.length?'clarify':'researchReady');
    });
  }
  requireQuestion(p) {
    const row=this.current();
    if(this.flow.state().stage!=='clarify' || this.store.active()?.id!==p.id || !row || row.token!==p.token || row.responses.length!==p.index || p.index>=row.questions.length)
      throw new ProblemError('This question has changed. Reopen the job and try again.');
    return row;
  }
  saveDraft(p) {
    const row=this.requireQuestion(p),choices=this.choices(p,row);
    if(typeof p.text!=='string' || p.text.length>4000)throw new ProblemError('Keep your answer under 4,000 characters.');
    this.db.prepare('UPDATE job_clarifications SET draft=?,draft_choices=? WHERE problem_id=?').run(p.text,JSON.stringify(choices),p.id);
  }
  choices(p,row) {
    const choices=p.choices??[];
    if(!Array.isArray(choices)||choices.length>4||new Set(choices).size!==choices.length||choices.some(index=>!Number.isInteger(index)||index<0||index>=row.questions[p.index].options.length))throw new ProblemError('Choose only the available answers.');
    return [...choices].sort((a,b)=>a-b);
  }
  answer(p,picked=null) {
    const row=this.requireQuestion(p);
    let response;
    if(picked)response={status:picked.answer===null?'unknown':'assumed',text:picked.answer,reason:picked.reason};
    else if(p.skip===true)response={status:'skipped',text:null};
    else if(p.choices!==undefined){
      const choices=this.choices(p,row).map(index=>row.questions[p.index].options[index]);
      if(typeof p.text!=='string'||p.text.length>4000)throw new ProblemError('Keep your answer under 4,000 characters.');
      const customText=p.text.trim(),text=requiredText([...choices,customText].filter(Boolean).join('\n'),5000);
      response={status:'answered',text,choices,customText};
    }else response={status:'answered',text:requiredText(p.text,4000)};
    row.responses.push(response);
    this.flow.transaction(()=>{
      this.db.prepare("UPDATE job_clarifications SET responses=?,draft='',draft_choices='[]' WHERE problem_id=?").run(JSON.stringify(row.responses),p.id);
      if(row.responses.length===row.questions.length)this.flow.stage('researchReady');
    });
  }
  replaceQuestion(p,result) {
    const row=this.requireQuestion(p),questions=validateQuestions(result);
    if(questions.length!==1 || questions[0].options.length<2)throw new ProblemError('The AI did not return one question with clear choices. Try again.');
    row.questions[p.index]=questions[0];
    this.db.prepare("UPDATE job_clarifications SET questions=?,token=?,draft='',draft_choices='[]' WHERE problem_id=?").run(JSON.stringify(row.questions),randomUUID(),p.id);
  }
  pick(p,result) {
    const row=this.requireQuestion(p),options=row.questions[p.index].options;
    if(!result || Object.keys(result).sort().join(',')!=='answer,reason')throw new ProblemError('The AI could not pick an answer. Try again.');
    const answer=result.answer===null?null:requiredText(result.answer,4000),reason=requiredText(result.reason,240);
    if(answer!==null && options.length && !options.includes(answer))throw new ProblemError('The AI picked an unavailable choice. Try again.');
    this.answer(p,{answer,reason});
  }
  skip() {
    const row=this.current();
    if(!row){this.save([]);return;}
    const responses=row.questions.map((q,i)=>row.responses[i]||{status:'skipped',text:null});
    this.flow.transaction(()=>{
      this.db.prepare("UPDATE job_clarifications SET responses=?,draft='',draft_choices='[]' WHERE problem_id=?").run(JSON.stringify(responses),this.store.requireActive().id);
      this.flow.stage('researchReady');
    });
  }
  context() {
    const row=this.current();
    return row?row.questions.map((q,i)=>({question:q.question,...(row.responses[i]||{status:'unanswered',text:null})})):[];
  }
  ready() {const row=this.current();return !!row && row.responses.length===row.questions.length;}
}
