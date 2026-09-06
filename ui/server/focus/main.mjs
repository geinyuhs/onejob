import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { ProblemStore } from './store.mjs';
import { ProblemService } from './service.mjs';
import { CodexClient, ClaudeClient } from './clients.mjs';

const directory=resolve(process.argv[2]);
const store=new ProblemStore(join(directory,'problem.sqlite'));
const codex=new CodexClient(directory);
const service=new ProblemService(store,{chatgpt:codex,claude:new ClaudeClient(join(directory,'claude-workspace'))});
const write=value=>process.stdout.write(JSON.stringify(value)+'\n');
codex.on('notification',message=>{if(['account/login/completed','account/updated'].includes(message.method))write({event:'accountChanged'});});
createInterface({input:process.stdin}).on('line',async line=>{
  let id=null;
  try {const message=JSON.parse(line);id=message.id;write({id,result:await service.call(message.method,message.params)});}
  catch(error){write({id,error:error.message || 'The action could not finish.'});}
}).on('close',()=>{service.stop();codex.close();store.close();process.exit(0);});
process.on('SIGTERM',()=>{service.stop();codex.close();store.close();process.exit(0);});
