import { ProblemError, requiredText } from './store.mjs';

export class ProblemService {
  constructor(store,clients,{folders=null,search=null}={}) {this.store=store;this.clients=clients;this.job=null;this.folders=folders;this.search=search;}
  snapshot() {return {...this.store.snapshot(),provider:this.store.config()?.provider || 'chatgpt',searchMode:this.search?.mode || 'keyword',folderScan:this.folders?.lastScan || null};}
  syncFolders() {
    const scan=this.folders?.sync();
    if (scan?.partial) throw new ProblemError('This folder is too large for a complete scan. Choose a smaller folder before searching or sending.');
    return scan;
  }
  async call(method,p={}) {
    switch(method) {
      case 'state': return this.snapshot();
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
      const result=await this.clients[provider].answer(context,controller.signal);
      this.store.applyResult(problem.id,problem.revision,result,sources);
      return {...this.snapshot(),usedSources:context.evidence.map(e=>({id:e.id,title:e.title,matched:e.matched}))};
    } finally {if(this.job===controller)this.job=null;}
  }
}
