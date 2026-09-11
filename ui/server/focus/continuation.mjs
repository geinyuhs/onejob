import {createHash} from 'node:crypto';

// Continue while new observations arrive, not for an arbitrary number of turns.
// IDs, timestamps and duplicate reads are not research progress.
export function continuationCheck(){
 const checkpoints=new Map();
 return (reason,steps)=>{
  const evidence=new Set();
  for(const step of steps){
   if(typeof step.result!=='string')continue;
   try {
    const value=JSON.parse(step.result).result;
    const text=value?.snapshot??value?.text??(step.tool==='public.search'?value?.reply:null);
    if(typeof text==='string'&&text.trim())evidence.add(createHash('sha256').update(text).digest('hex'));
   } catch(error){continue;}
  }
  const previous=checkpoints.get(reason),progress=!previous||[...evidence].some(hash=>!previous.has(hash));
  checkpoints.set(reason,evidence);return progress;
 };
}
