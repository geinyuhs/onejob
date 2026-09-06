import { ProblemError, requiredText } from './store.mjs';
import {randomUUID} from 'node:crypto';

export class ProblemService {
  constructor(store,clients,{folders=null,search=null,tools=null,emit=()=>{}}={}) {this.store=store;this.clients=clients;this.job=null;this.folders=folders;this.search=search;this.tools=tools;this.emit=emit;}
  snapshot() {return {...this.store.snapshot(),provider:this.store.config()?.provider || 'chatgpt',searchMode:this.search?.mode || 'keyword',folderScan:this.folders?.lastScan || null,...(this.tools?.snapshot()||{})};}
  syncFolders() {
    const scan=this.folders?.sync();
    if (scan?.partial) throw new ProblemError('This folder is too large for a complete scan. Choose a smaller folder before searching or sending.');
    return scan;
  }
  async call(method,p={}) {
    switch(method) {
      case 'state': return this.snapshot();
      case 'connection.add': if(this.job)throw new ProblemError('Stop the current run before changing connections.');this.tools.connections.save(p);return this.snapshot();
      case 'connection.remove': if(this.job)throw new ProblemError('Stop the current run before changing connections.');this.tools.connections.remove(p.id);return this.snapshot();
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
    text=requiredText(text,8000);
    this.syncFolders();
    this.store.requireActive();this.store.add('user',text);const problem=this.store.advance();
    const context=this.store.context(text);
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
