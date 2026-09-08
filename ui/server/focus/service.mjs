import { ProblemError, requiredText } from './store.mjs';
import {Onboarding} from './onboarding.mjs';
import {randomUUID} from 'node:crypto';

export class ProblemService {
  constructor(store,clients,{folders=null,search=null,tools=null,workspace=null,setup=null,transcription=null,emit=()=>{}}={}) {this.transcription=transcription;this.store=store;this.flow=new Onboarding(store);this.clients=clients;this.job=null;this.folders=folders;this.search=search;this.tools=tools;this.workspace=workspace;this.setup=setup;this.emit=emit;}
  snapshot() {const workspacePath=this.workspace?.ensure();return {workspacePath,...this.stateSnapshot()};}
  stateSnapshot() {return {...this.store.snapshot(),onboarding:this.flow.state(),jobs:this.flow.list(),provider:this.store.config()?.provider || 'chatgpt',searchMode:this.search?.mode || 'keyword',folderScan:this.folders?.lastScan || null,...(this.tools?.snapshot()||{})};}
  syncFolders() {
    this.workspace?.ensure();
    const scan=this.folders?.sync();
    if (scan?.partial) throw new ProblemError('This folder is too large for a complete scan. Move some files out of the job folder before searching or sending.');
    return scan;
  }
  async call(method,p={}) {
    switch(method) {
      case 'openJob':
        if(!this.store.active())this.flow.create();
        return this.snapshot();
      case 'voiceStatus': return this.transcription.status();
      case 'importVoiceKey': return this.transcription.importKey(p.path);
      case 'transcribe': return this.transcription.transcribe(p.audio);
      case 'newJob':
      case 'selectJob':
        if(this.job)throw new ProblemError('Stop the current run before switching jobs.');
        if(method==='newJob')this.flow.create();else this.flow.select(p.id);
        return this.snapshot();
      case 'saveDraft':
        if(this.store.active()?.id!==p.id)throw new ProblemError('This draft belongs to another job.');
        this.store.db.prepare('UPDATE job_flow SET draft=? WHERE problem_id=?').run(typeof p.text==='string'?p.text.slice(0,16000):'',p.id);return {saved:true};
      case 'modelReady': {
        const id=this.store.requireActive().id,provider=this.store.config()?.provider||'chatgpt';
        const account=await this.clients[provider].account();
        if(!account.connected)throw new ProblemError('Sign in to your selected AI first.');
        if(this.store.active()?.id!==id || (this.store.config()?.provider||'chatgpt')!==provider)throw new ProblemError('Your selection changed. Try again.');
        this.flow.stage('problem');return this.snapshot();
      }
      case 'research': {
        if(this.job)throw new ProblemError('An answer is already running.');
        if(this.flow.state().stage!=='problem')throw new ProblemError('Connect your AI and describe the problem first.');
        this.flow.describe(p.text);
        try{await this.send(p.text);this.flow.finish();return this.snapshot();}
        catch(error){this.flow.stage('problem');throw error;}
      }
      case 'acceptPlan':
        if(this.flow.state().stage!=='plan')throw new ProblemError('Review a completed plan first.');
        this.flow.stage('work');return this.snapshot();
      case 'state': return this.snapshot();
      case 'showWorkspace': return {workspaceToOpen:this.workspace.ensure()};
      case 'setup': return this.setup.inspect();
      case 'service.connect':
      case 'aside.connect':
        if(this.job)throw new ProblemError('Stop the current run before changing connections.');
        return method==='service.connect'?this.setup.oauth.begin(p.service):this.setup.connectAside(p);
      case 'service.cancel': this.setup.oauth.cancel(p.service);return {cancelled:true};
      case 'connection.add': if(this.job)throw new ProblemError('Stop the current run before changing connections.');this.tools.connections.save(p);return this.snapshot();
      case 'connection.remove': if(this.job)throw new ProblemError('Stop the current run before changing connections.');if(this.setup)await this.setup.oauth.disconnect(p.id);else this.tools.connections.remove(p.id);return this.snapshot();
      case 'approval': this.tools.resolve(p.id,p.approved);return {accepted:true};
      case 'create': this.store.create(p.title);return this.snapshot();
      case 'brief': this.store.editBrief(p.brief);return this.snapshot();
      case 'archive': this.stop();this.store.archive();return this.snapshot();
      case 'restore': this.store.restore(p.id);return this.snapshot();
      case 'source': this.store.add('source',p.text,{title:requiredText(p.title,200)});this.store.advance();return this.snapshot();
      case 'memory': this.store.decide(p.id,p.action);return this.snapshot();
      case 'connectFolder': this.folders.connect(p.path);return this.snapshot();
      case 'scanFolders': this.syncFolders();return this.snapshot();
      case 'disconnectFolder': this.folders.disconnect(p.id);return this.snapshot();
      case 'retrieve': this.syncFolders();return (this.search || this.store).retrieve(requiredText(p.query,2000));
      case 'provider':
        if(!['chatgpt','claude'].includes(p.provider)) throw new ProblemError('Unknown provider.');
        if(this.job) throw new ProblemError('Stop the current answer before changing providers.');
        this.store.setConfig({provider:p.provider});return this.snapshot();
      case 'reviseProblem':
        if(!['plan','work','problem'].includes(this.flow.state().stage))throw new ProblemError('Connect your AI first.');
        if(this.job)throw new ProblemError('Stop the current run first.');
        this.flow.stage('problem');return this.snapshot();
      case 'modelStatus': return this.clients[this.store.config()?.provider||'chatgpt'].account();
      case 'account': return this.clients.chatgpt.account();
      case 'login': return this.clients.chatgpt.login();
      case 'logout': if(this.job) throw new ProblemError('Stop the current answer before signing out.');return this.clients.chatgpt.logout();
      case 'stop': this.stop();return this.snapshot();
      case 'send': return this.send(p.text);
      default: throw new ProblemError('Unknown app action.');
    }
  }
  stop() { if(this.job){this.job.abort();if(this.store.active()) this.store.advance();} }
  async send(text) {
    if(this.job) throw new ProblemError('An answer is already running. Stop it before sending another.');
    text=requiredText(text,16000);
    this.syncFolders();
    this.store.requireActive();this.store.add('user',text);const problem=this.store.advance();
    const context=this.store.context(text);
    context.phase=this.flow.state().stage;
    if (this.search) context.evidence=this.search.retrieve(`${text} ${problem.title} ${problem.brief.openQuestion}`);
    const sources=[...context.evidence,...context.recent.filter(e=>e.kind==='user')];
    const controller=new AbortController();this.job=controller;
    try {
      const provider=this.store.config()?.provider || 'chatgpt';
      const runId=randomUUID();
      const assertCurrent=()=>{const current=this.store.active();if(!current||current.id!==problem.id||current.revision!==problem.revision)throw new ProblemError('This run was superseded by your newer input.',409);};
      context.capabilities=this.tools?.catalog()||{tools:[],connections:[]};context.toolResults=[];
      let result;
      for(let step=0;step<=12;step++) {
        assertCurrent();controller.signal.throwIfAborted();
        this.emit({event:'runProgress',step,message:step?'Reviewing the tool result…':'Working on your problem…'});
        result=await this.clients[provider].answer(context,controller.signal);
        assertCurrent();controller.signal.throwIfAborted();
        if(!result.action)break;
        if(!this.tools)throw new ProblemError('Tools are not available in this build.');
        if(step===12){result={reply:'I paused after 12 tool steps. Your work and tool history are saved. Send another message to continue.',memories:[]};break;}
        try {
          const outcome=await this.tools.execute(result.action,{runId,problemId:problem.id,signal:controller.signal,assertCurrent});
          assertCurrent();const raw=JSON.stringify(outcome),text=raw.length>12000?raw.slice(0,12000)+'\n[Tool output truncated; narrow the next request.]':raw;
          const id=this.store.add('source',text,{title:'Tool result: '+outcome.tool});
          const source=this.store.snapshot().entries.find(e=>e.id===id);sources.push(source);context.evidence.push(source);
          if(outcome.tool==='memory.search')for(const entry of outcome.result){if(!sources.some(s=>s.id===entry.id)){sources.push(entry);context.evidence.push(entry);}}
          context.toolResults.push({source_id:id,tool:outcome.tool,result:text});
        } catch(error) {
          assertCurrent();controller.signal.throwIfAborted();
          context.toolResults.push({tool:result.action.tool,error:error.message});
        }
      }
      this.store.applyResult(problem.id,problem.revision,result,sources);
      return {...this.snapshot(),usedSources:context.evidence.map(e=>({id:e.id,title:e.title,matched:e.matched}))};
    } finally {if(this.job===controller)this.job=null;}
  }
}
