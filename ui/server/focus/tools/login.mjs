import {mkdtempSync,writeFileSync,rmSync,realpathSync,lstatSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,isAbsolute} from 'node:path';

export function loginBinding(connection,url,field) {
 if(connection.kind!=='login'||!['username','password'].includes(field))throw new Error('Choose a configured website login field.');
 const target=new URL(url),bound=new URL(connection.url);
 if(target.protocol!=='https:'||target.origin!==bound.origin||target.username||target.password)throw new Error('This login is restricted to its configured HTTPS origin.');
 if(/\b(signup|register|reset|recover|change-password)\b/i.test(target.pathname))throw new Error('Creating or changing credentials requires you to take over.');
 const reference=field==='password'?connection.secretRef:connection.usernameRef;
 if(!reference)throw new Error('Configure this field’s 1Password reference in Tools.');
 return {account:connection.account,secretRef:reference};
}

// This function is serialized into Aside. It returns only metadata, never values.
export function checkLoginElement(element,origin,field) {
 const type=element.getAttribute('type')?.toLowerCase()||'text';
 const autocomplete=element.getAttribute('autocomplete')||'';
 const doc=element.ownerDocument;
 const action=element.form?.action||doc.location.href;
 if(doc.location.origin!==origin||new URL(action,doc.location.href).origin!==origin||element.tagName!=='INPUT'||autocomplete==='new-password')throw new Error('Login target changed or is not a sign-in field.');
 if(field==='password'?type!=='password':(!['text','email'].includes(type)||!/(user|email|login|identifier)/i.test([element.name,element.id,autocomplete].join(' '))))throw new Error('Not a supported sign-in field.');
 return true;
}

export function transferDirectory(path,asideRoot=join(homedir(),'.aside')) {
 if(typeof path!=='string'||!isAbsolute(path)||lstatSync(path).isSymbolicLink())throw new Error('Invalid Aside session directory.');
 const root=realpathSync(asideRoot),directory=realpathSync(path);
 if(!directory.startsWith(root+'/u/')||!/^\d+\/sessions\/[^/]+$/.test(directory.slice((root+'/u/').length)))throw new Error('Credential transfer requires an Aside session directory.');
 return directory;
}

export async function withPrivateCredential(secret,use,directory=tmpdir()) {
 const dir=mkdtempSync(join(directory,'onejob-login-')),path=join(dir,'credential');
 try {writeFileSync(path,secret,{mode:0o600,flag:'wx'});return await use(path);}
 finally {rmSync(dir,{recursive:true,force:true});}
}
