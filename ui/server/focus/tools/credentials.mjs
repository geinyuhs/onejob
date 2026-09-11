// Only the executor calls this class. No model-facing tool can read credentials.
export class Credentials {
  constructor(create=null,oauth=null) {this.create=create;this.oauth=oauth;}
  async resolve(connection,{interactive=true}={}) {
    if (!connection.secretRef && connection.auth!=='oauth') return '';
    // Desktop SDK access can open an OS authorization dialog even if the vault
    // was unlocked earlier. Auto must not start an interactive authorization.
    if(!interactive && connection.auth!=='oauth'){
      const failure=new Error('1Password desktop access requires an interactive authorization session. This credential step is blocked in Auto mode.');
      failure.name='CredentialUnavailable';throw failure;
    }
    try {
      if(connection.auth==='oauth')return await this.oauth.token(connection);
      const sdk=this.create?null:await import('@1password/sdk');
      const client=await (this.create?this.create(connection.account):sdk.createClient({auth:new sdk.DesktopAuth(connection.account),integrationName:'onejob',integrationVersion:'0.2.0'}));
      return await client.secrets.resolve(connection.secretRef);
    } catch(error) {const failure=new Error(connection.auth==='oauth'?'Reconnect this service in Tools to restore access.':'1Password could not provide the approved credential. Unlock it and enable SDK integration in its Developer settings.');failure.name='CredentialUnavailable';throw failure;}
  }
}
export function redact(value,secrets=[]) {
  const scrub=text=>secrets.filter(Boolean).reduce((result,secret)=>result.split(secret).join('[redacted]'),String(text));
  if (typeof value==='string') return scrub(value);
  if (Array.isArray(value)) return value.map(v=>redact(v,secrets));
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,v])=>[key, /password|secret|token|authorization|cookie|api.?key/i.test(key)?'[redacted]':redact(v,secrets)]));
  return value;
}
