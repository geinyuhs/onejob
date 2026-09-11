import { ProblemError, requiredText } from './store.mjs';
import {Onboarding} from './onboarding.mjs';
import {randomUUID} from 'node:crypto';
import {Clarification,validateQuestions} from './clarification.mjs';
import {Execution,validateExecution} from './execution.mjs';
import {inferenceProgress} from './progress.mjs';
import {handoffObservations,handoffAllowed} from './handoff.mjs';
import {researchTools} from './research.mjs';
import {continuationCheck} from './continuation.mjs';
import {answerFormattingIncomplete} from './answer-format.mjs';

export class ProblemService {
  constructor(store,clients,{folders=null,search=null,tools=null,workspace=null,setup=null,transcription=null,emit=()=>{}}={}) {
    this.transcription=transcription;this.store=store;this.flow=new Onboarding(store);this.clarification=new Clarification(store,this.flow);
    this.execution=new Execution(store,this.flow);
    if(this.flow.state().stage==='researchReady' && !this.clarification.ready())this.flow.stage('attempts');
    this.clients=clients;this.job=null;this.folders=folders;this.search=search;this.tools=tools;this.workspace=workspace;this.setup=setup;this.emit=emit;
  }
  snapshot() {const workspacePath=this.workspace?.ensure();return {workspacePath,...this.stateSnapshot()};}
  stateSnapshot() {return {...(this.workspace?.snapshot()||this.store.snapshot()),onboarding:this.flow.state(),execution:this.execution.state(),canResumeWithBrowser:this.canResumeWithBrowser(),clarification:this.clarification.state(),jobs:this.flow.list(),provider:this.store.config()?.provider || 'chatgpt',reasoningEffort:this.store.config()?.reasoningEffort||null,searchMode:this.search?.mode || 'keyword',folderScan:this.folders?.lastScan || null,...(this.tools?.snapshot()||{})};}
  browserConnections() {return (this.tools?.catalog().connections||[]).filter(c=>c.kind==='aside'&&c.enabled!==false).map(c=>c.id);}
  canResumeWithBrowser() {
    const flow=this.flow.state(),result=this.execution.state();
    return flow.stage==='needsInput' && !!flow.plan && result?.status==='needs_input' && this.browserConnections().some(id=>!(result.browserConnections||[]).includes(id));
  }
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
        if(p.field==='clarification'){this.clarification.saveDraft(p);return {saved:true};}
        if(p.field==='tried'){this.store.editBrief({tried:typeof p.text==='string'?p.text.slice(0,4000):''});return {saved:true};}
        this.store.db.prepare('UPDATE job_flow SET draft=? WHERE problem_id=?').run(typeof p.text==='string'?p.text.slice(0,16000):'',p.id);return {saved:true};
      case 'modelReady': {
        const id=this.store.requireActive().id,provider=this.store.config()?.provider||'chatgpt';
        const account=await this.clients[provider].account();
        if(!account.connected)throw new ProblemError('Sign in to your selected AI first.');
        if(this.store.active()?.id!==id || (this.store.config()?.provider||'chatgpt')!==provider)throw new ProblemError('Your selection changed. Try again.');
        this.flow.stage('problem');return this.snapshot();
      }
      case 'describe':
        if(this.job)throw new ProblemError('An answer is already running.');
        if(this.flow.state().stage!=='problem')throw new ProblemError('Connect your AI and describe the problem first.');
        this.flow.describe(p.text);this.flow.stage('attempts');return this.snapshot();
      case 'research': {
        if(this.job)throw new ProblemError('An answer is already running.');
        if(this.flow.state().stage!=='researchReady' || !this.clarification.ready())throw new ProblemError('Finish the clarifying questions first.');
        const text=this.flow.state().draft;
        this.flow.describe(text);
        try{await this.send(text);this.flow.finish();this.execution.clear();return this.snapshot();}
        catch(error){this.flow.stage('researchReady');throw error;}
      }
      case 'clarify': return this.clarify(p);
      case 'simplifyClarification': return this.refineClarification(p,'simplify');
      case 'pickClarification': return this.refineClarification(p,'pick');
      case 'answerClarification':
        if(this.job)throw new ProblemError('Wait for the current answer to finish.');
        this.clarification.answer(p);return this.snapshot();
      case 'skipClarifications':
        if(this.job || !['attempts','clarify'].includes(this.flow.state().stage))throw new ProblemError('Finish the intake step first.');
        if(this.store.active()?.id!==p.id)throw new ProblemError('This answer belongs to another job.');
        if(this.flow.state().stage==='attempts')this.store.editBrief({tried:p.tried??this.store.requireActive().brief.tried});
        this.clarification.skip();return this.snapshot();
      case 'reviseAttempts':
        if(this.job || !['clarify','researchReady'].includes(this.flow.state().stage))throw new ProblemError('Finish the current step first.');
        this.flow.stage('attempts');return this.snapshot();
      case 'editPlan': {
        if(this.job)throw new ProblemError('Stop the current run before editing the plan.');
        if(this.store.active()?.id!==p.id)throw new ProblemError('This plan belongs to another job.');
        if(this.flow.state().stage!=='plan')throw new ProblemError('Only a plan awaiting review can be edited.');
        if(this.flow.state().plan!==p.expectedPlan)throw new ProblemError('The plan changed. Review the latest version before saving.');
        const problem=requiredText(p.problem,12000);
        if(typeof p.research!=='string')throw new ProblemError('Enter research text.');
        const research=p.research.trim(),plan=requiredText([problem,research].filter(Boolean).join('\n\n'),12000);
        this.syncFolders();this.requireCurrentPlan();
        const source=this.planSource();
        this.flow.transaction(()=>{
          this.store.db.prepare('INSERT OR REPLACE INTO job_plan_edits VALUES(?,?,?,?)').run(p.id,problem,research,source?.id||null);
          this.store.db.prepare('UPDATE job_flow SET plan=? WHERE problem_id=?').run(plan,p.id);
          this.store.advance();
        });
        return this.snapshot();
      }
      case 'acceptPlan':
        if(this.flow.state().stage!=='plan')throw new ProblemError('Review a completed plan first.');
        return this.executePlan('Research the context described in the plan I just reviewed. Do not make account changes or schedule actions.');
      case 'continuePlan': {
        const flow=this.flow.state();
        if(!['needsInput','executionPaused'].includes(flow.stage) && !(flow.stage==='results' && flow.plan && this.execution.state()?.status==='blocked') && !(flow.stage==='work' && flow.plan && !this.execution.state()))throw new ProblemError('There is no paused plan to continue.');
        const text=flow.stage==='needsInput'?requiredText(p.text,16000):'Continue the saved plan. Check prior results before taking another step.';
        return this.executePlan(text);
      }
      case 'resumeWithBrowser':
        if(p.id!==this.store.active()?.id || !this.canResumeWithBrowser())throw new ProblemError('No new browser connection is available for this paused job.');
        return this.executePlan('Continue the saved plan using the newly connected browser. Recheck the missing information with the available tools before asking me to supply it. Keep all action approvals.');
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
      case 'approval': this.tools.resolve(p.id,p.approved,p.text);return {accepted:true};
      case 'autoMode': return this.tools.setAutoMode(p.problemId,p.enabled);
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
        this.store.setConfig({...this.store.config(),provider:p.provider});return this.snapshot();
      case 'thinkingModes': return this.clients.chatgpt.thinkingModes();
      case 'reasoningEffort': {
        if(this.job)throw new ProblemError('Stop the current run before changing thinking mode.');
        const effort=p.effort===null?null:await this.clients.chatgpt.checkEffort(p.effort);
        if(this.job)throw new ProblemError('Stop the current run before changing thinking mode.');
        this.store.setConfig({...this.store.config(),reasoningEffort:effort});return this.snapshot();
      }
      case 'reviseProblem':
        if(!['plan','work','problem','attempts'].includes(this.flow.state().stage))throw new ProblemError('Connect your AI first.');
        if(this.job)throw new ProblemError('Stop the current run first.');
        this.flow.stage('problem');return this.snapshot();
      case 'modelAccounts': {
        const providers=['chatgpt','claude'];
        const results=await Promise.allSettled(providers.map(async provider=>this.clients[provider].account()));
        return Object.fromEntries(providers.map((provider,index)=>{
          const result=results[index];
          return [provider,{connected:result.status==='fulfilled' && result.value?.connected===true,checked:result.status==='fulfilled'}];
        }));
      }
      case 'modelStatus': return this.clients[this.store.config()?.provider||'chatgpt'].account();
      case 'account': return this.clients.chatgpt.account();
      case 'login': return this.clients.chatgpt.login();
      case 'logout': if(this.job) throw new ProblemError('Stop the current answer before signing out.');return this.clients.chatgpt.logout();
      case 'stop': this.stop();return this.snapshot();
      case 'send':
        if(this.flow.state().stage!=='work')throw new ProblemError('Finish the intake and review the plan first.');
        return this.send(p.text);
      default: throw new ProblemError('Unknown app action.');
    }
  }
  stop() { if(this.job){this.job.abort();if(this.store.active()) this.store.advance();} }
  async refineClarification(p,operation) {
    if(this.job)throw new ProblemError('Wait for the current question to finish.');
    const row=this.clarification.requireQuestion(p);
    const provider=this.store.config()?.provider||'chatgpt';
    if(provider!=='chatgpt')throw new ProblemError('These questions use Astra. Connect ChatGPT from the app settings.');
    const problem=this.store.requireActive(),controller=new AbortController();this.job=controller;
    try{
      const result=await this.clients.chatgpt.answer({phase:'clarify',operation,...(this.store.config()?.reasoningEffort?{reasoningEffort:this.store.config().reasoningEffort}:{}),...this.clarification.input(),currentQuestion:row.questions[p.index],earlierAnswers:this.clarification.context().slice(0,p.index)},controller.signal);
      controller.signal.throwIfAborted();
      const updated=this.store.active();
      if(!updated || updated.id!==problem.id || updated.revision!==problem.revision)throw new ProblemError('Your answers changed. Try again.');
      if(operation==='simplify')this.clarification.replaceQuestion(p,result);else this.clarification.pick(p,result);
      return this.snapshot();
    }finally{if(this.job===controller)this.job=null;}
  }
  async clarify(p) {
    if(this.job || this.flow.state().stage!=='attempts')throw new ProblemError('Finish the earlier intake steps first.');
    if(this.store.active()?.id!==p.id)throw new ProblemError('This answer belongs to another job.');
    this.store.editBrief({tried:p.tried??this.store.requireActive().brief.tried});
    const saved=this.clarification.current();
    if(saved){this.flow.stage(this.clarification.ready()?'researchReady':'clarify');return this.snapshot();}
    if((this.store.config()?.provider||'chatgpt')!=='chatgpt')throw new ProblemError('Clarifying questions use Astra. Choose ChatGPT in the app settings.');
    const problem=this.store.requireActive(),controller=new AbortController();this.job=controller;
    try {
      this.emit({event:'runProgress',message:'Reading your problem and what you’ve tried…'});
      const result=await this.clients.chatgpt.answer({phase:'clarify',...this.clarification.input(),...(this.store.config()?.reasoningEffort?{reasoningEffort:this.store.config().reasoningEffort}:{})},controller.signal,message=>{
        if(this.job===controller && !controller.signal.aborted)this.emit({event:'runProgress',message});
      });
      controller.signal.throwIfAborted();
      const current=this.store.active();
      if(!current || current.id!==problem.id || current.revision!==problem.revision)throw new ProblemError('Your answers changed. Try again.');
      this.emit({event:'runProgress',message:'Checking your follow-up questions…'});
      const {settings,...questionResult}=result;
      this.clarification.save(validateQuestions(questionResult),settings);return this.snapshot();
    } finally {if(this.job===controller)this.job=null;}
  }
  async executePlan(text) {
    if(this.job)throw new ProblemError('This plan is already running.');
    const id=this.store.requireActive().id;
    this.flow.stage('executing');
    try{return await this.send(text,{execute:true});}
    catch(error){this.store.db.prepare("UPDATE job_flow SET stage='executionPaused' WHERE problem_id=? AND stage='executing'").run(id);throw error;}
  }
  planSource() {
    const saved=this.store.db.prepare('SELECT source_id FROM job_plan_edits WHERE problem_id=?').get(this.store.requireActive().id);
    const entries=this.store.snapshot().entries;
    return saved?entries.find(entry=>entry.id===saved.source_id):entries.findLast(entry=>entry.kind==='assistant' && entry.text===this.flow.state().plan);
  }
  requireCurrentPlan() {
    // Folder retirement excludes old replies from chat context. The separately
    // saved plan must not reintroduce that same text during execution.
    const source=this.planSource();
    if(source?.status==='stale') {
      this.flow.transaction(()=>{
        this.store.db.prepare("UPDATE job_flow SET plan='',stage='researchReady' WHERE problem_id=?").run(this.store.requireActive().id);
        this.execution.clear();
      });
      throw new ProblemError('Your context changed. Research a new plan before continuing.');
    }
  }
  async send(text,{execute=false}={}) {
    if(this.job) throw new ProblemError('An answer is already running. Stop it before sending another.');
    text=requiredText(text,16000);
    this.emit({event:'runProgress',message:'Checking your saved notes and files…'});
    this.syncFolders();
    if(execute)this.requireCurrentPlan();
    this.store.requireActive();this.store.add('user',text);const problem=this.store.advance();
    const context=this.store.context(text);
    context.phase=execute?'execute':this.flow.state().stage;
    context.researchOnly=execute||context.phase==='work';
    if(this.store.config()?.provider!=='claude' && this.store.config()?.reasoningEffort)context.reasoningEffort=this.store.config().reasoningEffort;
    if(execute){context.plan=this.flow.state().plan;context.execution=this.execution.state();context.previousActions=this.tools?.snapshot().actions||[];}
    if(execute)context.researchRecovery={resumed:!!context.execution,...(this.tools?.researchRecovery?.()||{legacyNavigationBlocks:[]})};
    context.clarifications=this.clarification.context();
    if (this.search) context.evidence=this.search.retrieve(`${text} ${problem.title} ${problem.brief.openQuestion}`);
    const sources=[...context.evidence,...context.recent.filter(e=>e.kind==='user')];
    const controller=new AbortController();this.job=controller;
    try {
      const provider=this.store.config()?.provider || 'chatgpt';
      const runId=randomUUID();
      const assertCurrent=()=>{const current=this.store.active();if(!current||current.id!==problem.id||current.revision!==problem.revision)throw new ProblemError('This run was superseded by your newer input.',409);};
      context.capabilities=this.tools?.catalog()||{tools:[],connections:[]};context.toolResults=[];
      if(!this.clients[provider].supportsToolImages)context.capabilities={...context.capabilities,tools:context.capabilities.tools.filter(tool=>tool.name!=='browser.view')};
      if(context.researchOnly)context.capabilities={...context.capabilities,tools:context.capabilities.tools.filter(tool=>researchTools.includes(tool.name))};
      if(context.phase==='research')context.capabilities={tools:(context.capabilities.tools||[]).filter(tool=>tool.name==='memory.search'),connections:[]};
      let result,lastStep;
      const canContinue=continuationCheck();
      const handoffEvidence=[];
      const executeAction=async(action,signal=controller.signal)=>{
        let image;
        assertCurrent();controller.signal.throwIfAborted();signal.throwIfAborted();
        if(!this.tools)throw new ProblemError('Tools are not available in this build.');
        if(action.tool?.startsWith('browser.')&&!['browser.read','browser.open','browser.view'].includes(action.tool))handoffEvidence.push({invalidate:action.arguments?.page});
        try {
          if(context.phase==='research' && action.tool!=='memory.search')throw new ProblemError('Research can only search public information and your saved notes. Account actions wait until you approve the plan.');
          const outcome=await this.tools.execute(action,{runId,problemId:problem.id,signal,assertCurrent,researchOnly:context.researchOnly,review:(action,signal)=>this.clients[provider].answer({phase:'actionReview',reasoningEffort:context.reasoningEffort,task:problem.title,userRequest:context.recent.filter(e=>e.kind==='user').map(e=>e.text),userAnswers:context.clarifications,action},signal)});
          if(outcome.tool==='browser.view'){image=outcome.result.image;delete outcome.result.image;outcome.result.visualObservation=true;}
          lastStep={tool:outcome.tool,destination:outcome.destination,arguments:action.arguments,status:outcome.actionState||'completed'};
          assertCurrent();controller.signal.throwIfAborted();signal.throwIfAborted();
          const raw=JSON.stringify(outcome),text=this.tools.serializeOutput?this.tools.serializeOutput(outcome):raw;
          const id=this.store.add('source',text,{title:'Tool result: '+outcome.tool});
          handoffEvidence.push({source_id:id,tool:outcome.tool,result:raw});
          const source=this.store.snapshot().entries.find(e=>e.id===id);sources.push(source);context.evidence.push(source);
          if(outcome.tool==='memory.search')for(const entry of outcome.result){if(!sources.some(s=>s.id===entry.id)){sources.push(entry);context.evidence.push(entry);}}
          context.toolResults.push({source_id:id,tool:outcome.tool,result:text,...(outcome.recovered?{recovered:true,actionState:outcome.actionState}:{})});
        } catch(error) {
          assertCurrent();controller.signal.throwIfAborted();signal.throwIfAborted();
          // An exhausted transport recovery is an app failure, not missing user input.
          if(error.code==='BROWSER_RECOVERY_FAILED'&&!this.tools?.autoMode?.(problem.id))throw new ProblemError('The browser connection failed after automatic recovery. Your progress is saved.',502);
          if(error.code==='BROWSER_RECOVERY_FAILED')error.code='AUTO_BLOCKED';
          if(error.feedback){const id=this.store.add('user',error.feedback);const source=this.store.snapshot().entries.find(e=>e.id===id);sources.push(source);context.recent.push(source);}
          const blocked=['AUTO_BLOCKED','RESEARCH_ONLY'].includes(error.code);
          context.toolResults.push({tool:action.tool,error:error.message,...(blocked?{blocked:true}:{}),...(error.diagnostic?{diagnostic:error.diagnostic}:{}),...(error.actionState?{actionState:error.actionState}:{}),...(error.feedback?{userFeedback:error.feedback}:{})});
          lastStep={tool:action.tool,status:error.actionState|| (blocked?'blocked':'uncertain')};
        }
        this.emit({event:'runProgress',message:inferenceProgress(context,lastStep)});
        context.autoMode=this.tools?.autoMode?.(problem.id)||false;
        return {...context.toolResults.at(-1),autoMode:context.autoMode,...(image?{image}:{})};
      };
      for(let step=0;;step++) {
        assertCurrent();controller.signal.throwIfAborted();
        this.emit({event:'runProgress',step,message:inferenceProgress(context,lastStep)});
        context.autoMode=this.tools?.autoMode?.(problem.id)||false;
        result=await this.clients[provider].answer(context,controller.signal,message=>{
          if(this.job===controller && !controller.signal.aborted)this.emit({event:'runProgress',message});
        },executeAction);
        assertCurrent();controller.signal.throwIfAborted();
        if(this.clients[provider].runsTools && result.action)throw new ProblemError('The agent returned an unfinished tool step. Your progress is saved.');
        if(!result.action){
          if(result[answerFormattingIncomplete])break;
          // Coverage, not the presence of a new tool error, drives continuation.
          // This includes resumed jobs that only remember an earlier blocked route.
          if(execute&&result.execution?.status==='blocked'&&canContinue('browser',context.toolResults)){
            context.browserContinuation={instruction:'A blocked route does not block the entire research plan. Reconcile the saved plan with verified findings and continue unfinished independent work, including relevant rules, entities, schedules and current-state checks. Use other safe read-only routes where possible. not_performed means no action was dispatched: inspect a fresh page and request a new checked action if the control can now be identified. review_required or a declined action must not be repeated or bypassed. uncertain means it may have happened: inspect with read-only tools, never replay it. Do not invent unavailable future facts or claim unverified work is complete. Finish with specific remaining blockers only after independent work is exhausted; duplicate reads are not progress.'};
            this.emit({event:'runProgress',message:'Continuing the remaining independent research…'});
            continue;
          }
          if(execute&&result.execution?.status==='needs_input')validateExecution(result);
          if(execute&&!this.tools?.autoMode?.(problem.id)&&result.execution?.status==='needs_input'){
            this.emit({event:'runProgress',message:'Checking whether I can find that information myself…'});
            const observations=handoffObservations({toolResults:handoffEvidence});
            let review;
            try{
              review=await this.clients[provider].answer({phase:'inputReview',reasoningEffort:context.reasoningEffort,task:problem.title,question:result.execution.question,reply:result.reply,connections:context.capabilities.connections,observations},controller.signal);
            }catch(error){controller.signal.throwIfAborted();}
            assertCurrent();controller.signal.throwIfAborted();
            if(!handoffAllowed(review,observations)){
              if(canContinue('handoff',context.toolResults)){
                context.handoffContinuation={question:result.execution.question,reason:'This handoff lacks a verified user-only need. Retrieve the information with available tools. Failed clicks do not prove an access blocker. Try fresh page reads or another safe read-only route. Do not repeat declined or uncertain changes. If no safe route works, report partial results as blocked instead of asking the user to gather data.'};
                continue;
              }
              result={...result,reply:'The information could not be retrieved yet. No verified user-only access blocker was found. Progress is saved; this work is not complete.',execution:{status:'blocked',question:''},next_question:'',next_step:''};
            }
          }
          if(execute&&this.tools?.autoMode?.(problem.id)&&result.execution?.status==='needs_input'){
            if(canContinue('auto',context.toolResults)){
              context.autoContinuation={previousResult:result,instruction:'Auto mode is on. Do not ask this question. Use a safe, reversible default when possible. Never invent facts or permission. Continue independent work; report any remaining limitation as execution.status blocked, not needs_input.'};
              continue;
            }
            result={...result,reply:'Some work remains blocked by missing information or access. Completed steps and tool results are saved in this job.',execution:{status:'blocked',question:''}};
          }
          if(this.tools?.autoMode?.(problem.id))result={...result,next_question:'',next_step:''};
          break;
        }
        await executeAction(result.action);
      }
      this.emit({event:'runProgress',message:context.phase==='research'?'Saving your findings and plan…':'Saving your answer…'});
      // A blocked route remains in action history, but another read-only route
      // may have supplied the missing facts. Completion describes plan coverage.
      const outcome=execute?validateExecution(result):null;
      this.store.applyResult(problem.id,problem.revision,result,sources);
      if(execute)this.execution.save({...outcome,researchOnly:true,scheduledActions:[],inputReviewVersion:1,browserConnections:this.browserConnections()});
      return {...this.snapshot(),usedSources:context.evidence.map(e=>({id:e.id,title:e.title,matched:e.matched}))};
    } finally {if(this.job===controller)this.job=null;}
  }
}
