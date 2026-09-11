import { spawnSync } from 'node:child_process';

export function localRanker(binary) {
  return (query,entries) => {
    if (!binary) return {available:false,matches:[]};
    // Rank every entry in bounded batches, then merge by the native distance.
    // Batch-local rank positions cannot be compared across the whole archive.
    const matches=[];
    for(let offset=0;offset<Math.max(1,entries.length);offset+=128){
    const run=spawnSync('/usr/bin/sandbox-exec',['-p','(version 1)(allow default)(deny network*)',binary],{
      input:JSON.stringify({query,entries:entries.slice(offset,offset+128).map(e=>({id:e.id,text:e.title+'\n'+e.text}))}),
      encoding:'utf8',timeout:30000,maxBuffer:1024*1024,
      env:{PATH:'/usr/bin:/bin'},
    });
    if (run.status!==0) return {available:false,matches:[]};
    try { const result=JSON.parse(run.stdout);if(!result.available)return {available:false,matches:[]};matches.push(...result.matches); }
    catch(error) { return {available:false,matches:[]}; }
    }
    return {available:true,matches:matches.sort((a,b)=>a.distance-b.distance).slice(0,24)};
  };
}

export class ContextSearch {
  constructor(store,rank=()=>({available:false,matches:[]})) {this.store=store;this.rank=rank;this.mode='keyword';}
  retrieve(query,limit=8) {
    const lexical=this.store.retrieve(query,24);
    const candidates=this.store.candidates();
    const semantic=this.rank(query,candidates);
    this.mode=semantic.available?'keyword + local meaning':'keyword';
    const allowed=new Map(candidates.map(e=>[e.id,e]));
    const combined=new Map();
    lexical.forEach((entry,index)=>combined.set(entry.id,{...entry,score:1/(60+index)}));
    semantic.matches.forEach((hit,index)=>{
      if (!allowed.has(hit.id)) return;
      const previous=combined.get(hit.id);
      combined.set(hit.id,{...allowed.get(hit.id),...previous,matched:previous?.matched||[],score:(previous?.score||0)+1/(60+index),retrieval:previous?'keyword + meaning':'meaning'});
    });
    return [...combined.values()].sort((a,b)=>b.score-a.score).slice(0,limit);
  }
}
