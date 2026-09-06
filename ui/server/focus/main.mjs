import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { ProblemStore } from './store.mjs';
import { ProblemService } from './service.mjs';
import { CodexClient, ClaudeClient } from './clients.mjs';
import { FolderContext } from './folders.mjs';
import { ContextSearch,localRanker } from './search.mjs';
import {JobWorkspace} from './workspace.mjs';
import {OAuthConnections} from './tools/oauth.mjs';
import {Keychain} from './tools/keychain.mjs';
import {Credentials} from './tools/credentials.mjs';
import {ServiceSetup} from './tools/setup.mjs';
import {ToolRuntime} from './tools/runtime.mjs';

const directory=resolve(process.argv[2]);
const store=new ProblemStore(join(directory,'problem.sqlite'));
const codex=new CodexClient(directory);
const workspace=new JobWorkspace(store,process.argv[4]||join(directory,'workspace'));
const write=value=>process.stdout.write(JSON.stringify(value)+'\n');
const folders=new FolderContext(store),search=new ContextSearch(store,localRanker(process.argv[3]));
const runtime=new ToolRuntime(store,directory,{search,emit:write,sync:()=>service.syncFolders()});
const oauth=new OAuthConnections(store,runtime.connections,new Keychain(process.argv[5]),{emit:write});
runtime.credentials=new Credentials(null,oauth);
const setup=new ServiceSetup(runtime.connections,oauth);
const service=new ProblemService(store,{chatgpt:codex,claude:new ClaudeClient(join(directory,'claude-workspace'))},{folders,search,tools:runtime,workspace,setup,emit:write});
codex.on('notification',message=>{if(['account/login/completed','account/updated'].includes(message.method))write({event:'accountChanged'});});
const scanTimer=setInterval(()=>{
  try { const scan=service.syncFolders();if(scan?.changed)write({event:'contextChanged'}); }
  catch(error) { write({event:'contextUnavailable',message:'Your job folder needs attention. Open it from Context before sending.'}); }
},30000);
scanTimer.unref();
createInterface({input:process.stdin}).on('line',async line=>{
  let id=null;
  try {const message=JSON.parse(line);id=message.id;write({id,result:await service.call(message.method,message.params)});}
  catch(error){write({id,error:error.message || 'The action could not finish.'});}
}).on('close',()=>{service.stop();codex.close();Promise.all([runtime.close(),oauth.close()]).finally(()=>{store.close();process.exit(0);});});
process.on('SIGTERM',()=>{service.stop();codex.close();Promise.all([runtime.close(),oauth.close()]).finally(()=>{store.close();process.exit(0);});});
