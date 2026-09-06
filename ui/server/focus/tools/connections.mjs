import {randomUUID} from 'node:crypto';
import {ProblemError,requiredText} from '../store.mjs';

export function serviceURL(value,{local=false}={}) {
  let url;try {url=new URL(value);} catch(error) {throw new ProblemError('Enter a complete service URL.');}
  const loopback=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if ((url.protocol!=='https:' && !(local && loopback && url.protocol==='http:')) || url.username || url.password || url.hash)
    throw new ProblemError('Use HTTPS without embedded credentials. Local MCP servers may use HTTP on loopback.');
  return url;
}
export function relativeURL(base,path) {
  if (typeof path!=='string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\r\n]/u.test(path)) throw new ProblemError('Use a relative API path beginning with one slash.');
  const url=new URL(path,base);
  if (url.origin!==new URL(base).origin || url.username || url.password || url.hash) throw new ProblemError('The API request must stay on the configured service.');
  return url;
}
export function cleanConnection(input) {
  const kind=input.kind;
  if (!['api','mcp','aside'].includes(kind)) throw new ProblemError('Choose API, MCP, or Aside.');
  const name=requiredText(input.name,80);
  const url=kind==='aside'?'':serviceURL(input.url,{local:kind==='mcp'}).href;
  if(url && new URL(url).search)throw new ProblemError('Service URLs cannot include query parameters. Keep credentials in 1Password.');
  const account=String(input.account||'').trim();
  const secretRef=String(input.secretRef||'').trim();
  if (secretRef && (!/^op:\/\/[^/?#\s]+\/[^/?#\s]+\/[^?#\s]+$/u.test(secretRef) || !account)) throw new ProblemError('Use a 1Password account name and an op://vault/item/field reference. Never paste a secret.');
  if (kind==='aside' && !input.localBrowserOnly) throw new ProblemError('Confirm the Aside privacy setup before enabling browser access.');
  if (kind==='aside' && account && !/^u?\d+$/u.test(account)) throw new ProblemError('Aside account ID must look like u0 or u1.');
  return {id:randomUUID(),kind,name,url,account,secretRef,localBrowserOnly:kind==='aside',enabled:true};
}
export class Connections {
  constructor(store) {this.store=store;}
  all() {const row=this.store.db.prepare("SELECT value FROM settings WHERE key='tool-connections'").get();return row?JSON.parse(row.value):[];}
  public() {return this.all().map(({secretRef,account,...c})=>({...c,hasCredential:!!secretRef}));}
  save(input) {const connection=cleanConnection(input);this.write([...this.all(),connection]);return connection;}
  remove(id) {this.write(this.all().filter(c=>c.id!==id));}
  write(items) {this.store.db.prepare("INSERT OR REPLACE INTO settings VALUES ('tool-connections',?)").run(JSON.stringify(items));}
  get(id) {const c=this.all().find(c=>c.id===id && c.enabled);if(!c)throw new ProblemError('Connection not found. Add it in Tools first.');return c;}
}
