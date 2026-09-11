// Deliberate phase routing, never a fallback: Hermes owns continuing job turns.
// The existing Astra client supplies setup, independent review and hosted search.
import {formatExecutionAnswer} from './answer-format.mjs';
export class AgentEngine {
 constructor(codex,hermes){this.codex=codex;this.hermes=hermes;this.runsTools=true;this.supportsToolImages=true;}
 account(){return this.codex.account();}
 login(){return this.codex.login();}
 logout(){return this.codex.logout();}
 thinkingModes(){return this.codex.thinkingModes();}
 checkEffort(effort){return this.codex.checkEffort(effort);}
 async answer(context,signal,progress,execute){
  if(['execute','work'].includes(context.phase)){
   const reasoningEffort=context.reasoningEffort||(await this.codex.thinkingModes()).defaultEffort;
   const result=await this.hermes.answer({...context,reasoningEffort},signal,progress,execute);
   return formatExecutionAnswer(result,{...context,reasoningEffort},this.codex,signal,progress);
  }
  if(['actionReview','inputReview'].includes(context.phase))return this.codex.answer(context,signal,progress);
  for(;;){
   signal?.throwIfAborted();
   const result=await this.codex.answer(context,signal,progress);
   if(!result.action)return result;
   await execute(result.action,signal);
  }
 }
 close(){this.codex.close();this.hermes.close();}
}
