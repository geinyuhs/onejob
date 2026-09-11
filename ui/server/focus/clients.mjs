import { spawn, execFile } from 'node:child_process';
import { mkdirSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { ProblemError } from './store.mjs';
import {answerFormatSchema} from './answer-format.mjs';
import { instructionFor, promptFor, parseAnswer } from './prompt.mjs';
import {clarificationModel,clarificationSchemaFor} from './ai-policy.mjs';
import {webProgress} from './progress.mjs';

export function executable(name) {
  const paths = name === 'codex' ? ['/Applications/Codex.app/Contents/Resources/codex'] : [];
  paths.push(join(homedir(), '.local/bin', name), '/opt/homebrew/bin/' + name, '/usr/local/bin/' + name);
  return paths.find(path => { try { accessSync(path, constants.X_OK); return true; } catch (error) { return false; } }) || null;
}
export function clientEnvironment(source = process.env) {
  // Each official client owns authentication. No ambient API key or token is forwarded.
  return Object.fromEntries(['HOME','USER','LOGNAME','PATH','TMPDIR','SHELL','LANG','LC_ALL'].filter(k => source[k]).map(k => [k,source[k]]));
}
export function authURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['auth.openai.com','chatgpt.com'].includes(url.hostname) || url.username || url.password)
    throw new ProblemError('The official client returned an unexpected sign-in address.');
  return url.href;
}
export const disabledFeatures = ['plugins','hooks','apps','in_app_browser','browser_use','browser_use_external','browser_use_full_cdp_access','shell_tool','shell_snapshot','multi_agent','multi_agent_v2','skill_mcp_dependency_install','tool_suggest','recommended_plugins'];
export function codexArgs() {
  return ['app-server','--stdio', ...disabledFeatures.flatMap(f => ['--disable',f]), '-c','web_search="disabled"','-c','cli_auth_credentials_store="file"',
    '-c','permissions.onejob.filesystem={":root"="deny",":minimal"="read",":workspace_roots"={"."="read"}}',
    '-c','permissions.onejob.network.enabled=false','-c','default_permissions="onejob"'];
}
export function claudeArgs(context={}) {
  const research=['research','execute','publicSearch'].includes(context.phase);
  return ['-p','--safe-mode','--tools',research?'WebSearch':'',...(research?['--allowedTools','WebSearch','--verbose']:[]),'--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--disable-slash-commands','--no-session-persistence','--no-chrome','--prompt-suggestions','false','--output-format',research?'stream-json':'json','--system-prompt',instructionFor(context)];
}

export class CodexClient extends EventEmitter {
  constructor(directory, binary = executable('codex')) {
    super(); this.directory = directory; this.binary = binary; this.pending = new Map(); this.serial = 0;
    this.work = join(directory,'empty-workspace');
  }
  async start() {
    if (this.ready) return this.ready;
    this.ready = this.boot().catch(error => { this.ready = null; throw error; });
    return this.ready;
  }
  async boot() {
    if (!this.binary) throw new ProblemError('Install the official Codex CLI to connect ChatGPT.');
    const profile = join(this.directory,'codex-profile');
    mkdirSync(profile,{recursive:true,mode:0o700}); mkdirSync(this.work,{recursive:true,mode:0o700});
    this.child = spawn(this.binary,codexArgs(),{cwd:this.work,env:{...clientEnvironment(),CODEX_HOME:profile},stdio:['pipe','pipe','pipe']});
    this.child.stderr.resume();
    this.child.stdin.on('error', error => this.fail(new Error('The Codex connection closed.',{cause:error})));
    this.child.on('error', error => this.fail(new Error('Could not start the official Codex client.',{cause:error})));
    this.child.on('close', () => { this.ready=null; this.fail(new Error('The Codex connection closed. Reconnect and try again.')); });
    createInterface({input:this.child.stdout}).on('line', line => this.receiveLine(line));
    await this.rpc('initialize',{clientInfo:{name:'onejob',title:'onejob',version:'0.1.0'},capabilities:{experimentalApi:true}});
    this.write({method:'initialized',params:{}});
  }
  receiveLine(line) {
    let message;
    try { message=JSON.parse(line); }
    catch (error) { this.fail(new Error('The Codex client sent an invalid response.',{cause:error})); return; }
    try { this.receive(message); }
    catch (error) { this.fail(new Error('onejob could not process a Codex update. Your notes are saved.',{cause:error})); }
  }
  write(message) { this.child.stdin.write(JSON.stringify(message)+'\n'); }
  rpc(method,params={}) {
    return new Promise((resolve,reject) => {
      const id=++this.serial;
      const timer=setTimeout(() => { this.pending.delete(id); reject(new Error('The official client took too long to respond.')); },30000);
      this.pending.set(id,{resolve,reject,timer}); this.write({id,method,params});
    });
  }
  receive(message) {
    if (message.id !== undefined && message.method) {
      // This app never grants provider-requested tool or credential access.
      this.write({id:message.id,error:{code:-32601,message:'This app does not expose tools or credentials.'}}); return;
    }
    const pending=this.pending.get(message.id);
    if (pending) {
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(new Error('Codex rejected the request. Check your sign-in, usage limit, or client version.'));
      else pending.resolve(message.result);
    } else if (message.method) this.emit('notification',message);
  }
  fail(error) { for (const p of this.pending.values()) {clearTimeout(p.timer);p.reject(error);} this.pending.clear(); this.emit('disconnected',error); }
  async account() {
    await this.start(); const result=await this.rpc('account/read',{refreshToken:false});
    return {connected:result.account?.type === 'chatgpt',plan:result.account?.planType || null};
  }
  async login() { await this.start(); const r=await this.rpc('account/login/start',{type:'chatgpt'}); this.loginId=r.loginId; return {url:authURL(r.authUrl)}; }
  async logout() { await this.start(); await this.rpc('account/logout'); return {connected:false}; }
  async thinkingModes() {
    await this.start();let cursor;
    do {
      const page=await this.rpc('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});
      const model=page.data?.find(item=>item.model===clarificationModel);
      if(model)return {model:model.model,defaultEffort:model.defaultReasoningEffort,options:model.supportedReasoningEfforts};
      cursor=page.nextCursor;
    }while(cursor);
    throw new ProblemError('Astra is not available through this connection. Update Codex and try again.');
  }
  async checkEffort(effort) {
    const modes=await this.thinkingModes();
    if(!modes.options?.some(option=>option.reasoningEffort===effort))throw new ProblemError('This thinking mode is not supported by Astra on this connection.');
    return effort;
  }
  async answer(context, signal, progress=()=>{}) {
    if (!(await this.account()).connected) throw new ProblemError('Connect ChatGPT first.');
    const clarifying=context.phase==='clarify';
    const effort=context.reasoningEffort?await this.checkEffort(context.reasoningEffort):undefined;
    const model={model:clarificationModel};
    const started=await this.rpc('thread/start',{...model,cwd:this.work,approvalPolicy:'never',permissions:'onejob',ephemeral:true,baseInstructions:instructionFor(context),config:{web_search:['research','execute','publicSearch'].includes(context.phase)?'live':'disabled'},serviceName:'onejob'});
    if(model.model && started.model!==clarificationModel)throw new ProblemError('Astra is not available through this connection. Update Codex and try again.');
    const threadId=started.thread.id;
    return new Promise((resolve,reject) => {
      let answer='',turnId;
      const finish=(error,value) => { clearTimeout(timer);this.off('notification',onEvent);this.off('disconnected',onDisconnect);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(value); };
      const interrupt=() => { if(turnId) this.rpc('turn/interrupt',{threadId,turnId}).catch(error=>this.emit('notice','Cancellation could not be confirmed.')); };
      const cancel=() => { interrupt();finish(new Error('Stopped. Your notes are saved.')); };
      const onDisconnect=error=>finish(error);
      const onEvent=({method,params:p}) => {
        if (p?.threadId !== threadId) return;
        resetTimer();
        if(['research','execute','publicSearch'].includes(context.phase) && p.item?.type==='webSearch') {
          // Display-only failures must not discard an otherwise valid model result.
          try {
            if(method==='item/started')progress(webProgress(p.item.action));
            if(method==='item/completed')progress(webProgress(p.item.action,true));
          } catch (error) { this.emit('notice','Search status unavailable; research is continuing.'); }
        }
        if (method==='item/completed' && p.item?.type==='agentMessage' && (!p.item.phase || p.item.phase==='final_answer')) answer=p.item.text;
        if (method==='turn/completed') {
          if (p.turn.status !== 'completed') finish(new Error('The model did not finish. Check your connection or usage limit.'));
          else { try { finish(null,parseAnswer(answer)); } catch(error) { finish(error); } }
        }
      };
      // A quiet connection may be stalled; active reasoning is not a time budget.
      let timer;
      const resetTimer=()=>{clearTimeout(timer);timer=setTimeout(()=>{interrupt();finish(new Error('The model stopped sending updates. Your notes are saved.'));},180000);};
      resetTimer();
      this.on('notification',onEvent);this.on('disconnected',onDisconnect);signal?.addEventListener('abort',cancel,{once:true});
      if (signal?.aborted) {cancel();return;}
      this.rpc('turn/start',{...model,...(effort?{effort}:{}),...(clarifying?{outputSchema:clarificationSchemaFor(context)}:context.phase==='answerFormat'?{outputSchema:answerFormatSchema}:{}),threadId,input:[{type:'text',text:promptFor(context)}],cwd:this.work,approvalPolicy:'never',permissions:'onejob'})
        .then(r=>{turnId=r.turn.id;if(signal?.aborted) interrupt();}).catch(finish);
    });
  }
  close() { this.child?.kill(); }
}

export class ClaudeClient {
  constructor(directory,binary=executable('claude')) {this.directory=directory;this.binary=binary;}
  async account() {
    if(!this.binary)return {connected:false};
    return new Promise(resolve=>execFile(this.binary,['auth','status','--json'],{env:clientEnvironment(),timeout:15000,maxBuffer:32000},(error,stdout)=>{
      if(error){resolve({connected:false});return;}
      try{resolve({connected:JSON.parse(stdout).loggedIn===true});}catch(error){resolve({connected:false});}
    }));
  }
  async answer(context,signal,progress=()=>{}) {
    if(context.phase==='clarify')throw new ProblemError('Clarifying questions use Astra through ChatGPT. Choose ChatGPT in the app settings.');
    if (!this.binary) throw new ProblemError('Install and sign in to official Claude Code first.');
    mkdirSync(this.directory,{recursive:true,mode:0o700});
    return new Promise((resolve,reject)=>{
      const child=spawn(this.binary,claudeArgs(context),{cwd:this.directory,env:clientEnvironment(),stdio:['pipe','pipe','pipe']});
      let output='',overflow=false,envelope=null,received=0;
      const cancel=()=>{child.kill('SIGTERM');const reap=setTimeout(()=>child.kill('SIGKILL'),5000);reap.unref();};
      const timer=setTimeout(cancel,180000);
      signal?.addEventListener('abort',cancel,{once:true});
      child.stdin.on('error',error=>{cancel();});
      child.stderr.resume();
      child.stdout.on('data',chunk=>{
        received+=chunk.length;if(received>1000000){overflow=true;output='';cancel();return;}
        output+=chunk;
        if(['research','execute','publicSearch'].includes(context.phase)) {
          let end;
          while((end=output.indexOf('\n'))>=0) {
            const line=output.slice(0,end);output=output.slice(end+1);if(!line.trim())continue;
            try {
              const event=JSON.parse(line);
              if(event.type==='result')envelope=event;
              for(const item of event.message?.content||[]) {
                if(item.type==='tool_use' && item.name==='WebSearch')progress(webProgress({type:'search',query:item.input?.query}));
                if(item.type==='tool_result')progress('Reviewing web findings…');
              }
            } catch(error) {overflow=true;cancel();return;}
          }
        }
      });
      child.on('error',error=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(new Error('Could not start official Claude Code.',{cause:error}));});
      child.on('close',code=>{
        clearTimeout(timer);signal?.removeEventListener('abort',cancel);
        if(code!==0 || signal?.aborted || overflow) {reject(new Error('Claude Code did not finish. Check its sign-in and usage limit in Terminal.'));return;}
        try {if(!['research','execute','publicSearch'].includes(context.phase))envelope=JSON.parse(output);if(!envelope || envelope.is_error) throw new Error('Claude Code reported a failure.');resolve(parseAnswer(envelope.result));}
        catch(error){reject(new Error('Claude Code returned an unreadable answer. Your notes are saved.',{cause:error}));}
      });
      if(signal?.aborted) cancel(); else child.stdin.end(promptFor(context));
    });
  }
}
