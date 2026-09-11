import {validateExecution} from './execution.mjs';
// A model-returned JSON property cannot impersonate this host-only marker.
export const answerFormattingIncomplete=Symbol('onejob.answerFormattingIncomplete');

export const answerFormatSchema={type:'object',additionalProperties:false,required:['status','question'],properties:{
 status:{type:'string',enum:['completed','needs_input','blocked']},question:{type:'string'},
}};

export async function formatExecutionAnswer(result,context,client,signal,progress=()=>{}){
 try{validateExecution(result);return result;}catch(error){/* A finished answer needs an envelope, not more research. */}
 const text=result?.unformattedAnswer??(typeof result?.reply==='string'?result.reply:JSON.stringify(result));
 if(typeof text!=='string'||!text.trim())throw new Error('The agent returned no final answer. Your progress is saved.');
 const warning='Display note: The answer above is saved, but the app could not confirm its completion status.';
 const fallback={reply:text+'\n\n'+warning,memories:[],execution:{status:'blocked'},formattingWarning:warning,[answerFormattingIncomplete]:true};
 signal?.throwIfAborted();progress('Preparing the finished research for display…');
 try{
  const formatted=await client.answer({phase:'answerFormat',answer:text,reasoningEffort:context.reasoningEffort},signal);
  signal?.throwIfAborted();
  if(!formatted||Object.keys(formatted).some(key=>!['status','question'].includes(key))||!['completed','needs_input','blocked'].includes(formatted.status)||typeof formatted.question!=='string')return fallback;
  // A formatting pass may copy a question, never invent a new user handoff.
  if(formatted.status==='needs_input'&&(!formatted.question.trim()||!text.includes(formatted.question)))return fallback;
  return {reply:text,memories:[],execution:{status:formatted.status,question:formatted.status==='needs_input'?formatted.question:''}};
 }catch(error){signal?.throwIfAborted();return fallback;}
}
