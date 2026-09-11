// Only this run's successful page reads can support an account-access handoff.
// Failed clicks, agent summaries and old memory are not access evidence.
export function handoffObservations(context){
 const latest=new Map();
 for(const step of context.toolResults||[]){
  if(step.invalidate){latest.delete(step.invalidate);continue;}
  if(!['browser.read','browser.open'].includes(step.tool)||!step.source_id||typeof step.result!=='string')continue;
  try{
   const value=JSON.parse(step.result),page=value.result;
   if(!page||typeof page.snapshot!=='string')continue;
   const key=page.page||value.destination,previous=latest.get(key);
   const current=page.snapshotId&&previous?.snapshotId===page.snapshotId?previous:{snapshotId:page.snapshotId,chunks:new Map()};
   current.chunks.set(page.offset||0,{source_id:step.source_id,tool:step.tool,destination:value.destination,content:page.snapshot});
   latest.set(key,current);
  }catch(error){continue;}
 }
 return [...latest.values()].slice(-8).flatMap(page=>[...page.chunks.values()]);
}

export function handoffAllowed(review,observations){
 if(!review||typeof review!=='object'||Array.isArray(review))return false;
 const keys=Object.keys(review).sort().join(',');
 if(review.decision==='user_decision')return keys==='decision';
 if(review.decision!=='access_blocker'||keys!=='decision,quote,source_id')return false;
 if(typeof review.quote!=='string'||review.quote.trim().length<12||review.quote.length>800)return false;
 return observations.some(item=>item.source_id===review.source_id&&item.content.includes(review.quote));
}
