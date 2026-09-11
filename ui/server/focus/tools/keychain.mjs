import {execFile} from 'node:child_process';
import {clientEnvironment} from '../clients.mjs';
export class Keychain {
 constructor(binary,run=execFile){this.binary=binary;this.run=run;}
 call(operation,key,value) {
  return new Promise((resolve,reject)=>{
   const child=this.run(this.binary,[],{env:clientEnvironment(),timeout:20000,maxBuffer:1024*1024},(error,stdout)=>{
    if(error){reject(new Error('macOS Keychain is unavailable. Unlock it and try connecting again.'));return;}
    try {const reply=JSON.parse(stdout);if(reply.error)throw new Error('Keychain refused the request.');resolve(reply.value??null);}
    catch(error){reject(new Error('macOS Keychain could not complete the request.'));}
   });
   child.stdin.on('error',error=>reject(new Error('macOS Keychain connection closed.')));
   child.stdin.end(JSON.stringify({operation,key,value}));
  });
 }
 read(key){return this.call('read',key);}
 write(key,value){return this.call('write',key,value);}
 remove(key){return this.call('remove',key);}
}
