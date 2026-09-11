import {createHmac,randomBytes} from 'node:crypto';

// Runs in the local app only, never in Aside or page JavaScript.
// Exact UTF-16 substring matching preserves the old redaction behavior without
// retaining plaintext login values. Merge overlaps before replacing text.
export function credentialRanges(text,records,digest){
 const sizes=new Map(),ranges=[];
 for(const {length,hash} of records){if(!sizes.has(length))sizes.set(length,new Set());sizes.get(length).add(hash);}
 for(const [length,hashes] of sizes){
  for(let start=0;start+length<=text.length;start++){
   if(hashes.has(digest(text.slice(start,start+length))))ranges.push([start,start+length]);
  }
 }
 ranges.sort((a,b)=>a[0]-b[0]||b[1]-a[1]);const merged=[];
 for(const range of ranges){const last=merged.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}
 return merged;
}

export class CredentialMasks {
 constructor(){this.jobs=new Map();}
 jobKey(connection,job){
  if(typeof connection!=='string'||!connection||typeof job!=='string'||!job)throw new Error('Credential masking requires a browser connection and job.');
  return JSON.stringify([connection,job]);
 }
 remember(connection,job,url,value){
  const id=this.jobKey(connection,job),origin=new URL(url);
  if(origin.protocol!=='https:'||origin.username||origin.password||typeof value!=='string'||!value)throw new Error('Credential masking requires an HTTPS origin and a nonempty value.');
  let saved=this.jobs.get(id);if(!saved){saved={key:randomBytes(32).toString('hex'),origins:new Map()};this.jobs.set(id,saved);}
  if(!saved.origins.has(origin.origin))saved.origins.set(origin.origin,new Map());
  const hash=createHmac('sha256',saved.key).update(value).digest('hex');
  saved.origins.get(origin.origin).set(hash,{length:value.length,hash});
 }
 forJob(connection,job){
  const saved=this.jobs.get(this.jobKey(connection,job));
  if(!saved)return {key:'',records:[]};
  // Check the same job's fingerprints across origins too: a redirect may reflect
  // an earlier login value. This grants no credential fill or account access.
  return {key:saved.key,records:[...saved.origins].flatMap(([origin,items])=>[...items.values()].map(item=>({origin,...item})))};
 }
 ranges(connection,job,text){const {key,records}=this.forJob(connection,job);return credentialRanges(text,records,value=>createHmac('sha256',key).update(value).digest('hex'));}
 scrub(connection,job,text){
  let result='',offset=0;
  for(const [start,end] of this.ranges(connection,job,text)){result+=text.slice(offset,start)+'[redacted]';offset=end;}
  return result+text.slice(offset);
 }
 clear(){this.jobs.clear();}
}
