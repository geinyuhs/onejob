import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const source=readFileSync(new URL('../focus/Keychain.swift',import.meta.url),'utf8');
test('native Keychain stores only its synthetic item and refuses malformed keys, with mutation proof',{skip:process.platform!=='darwin'},t=>{
 const dir=mkdtempSync(join(tmpdir(),'onejob-keychain-')),key='test-'+randomUUID();let binary;t.after(()=>{if(binary)spawnSync(binary,[],{input:JSON.stringify({operation:'remove',key}),timeout:10000});rmSync(dir,{recursive:true,force:true});});
 const build=(code,name)=>{const input=join(dir,name+'.swift'),binary=join(dir,name);writeFileSync(input,code);const result=spawnSync('/usr/bin/swiftc',['-module-cache-path',join(tmpdir(),'onejob-policy-cache'),input,'-framework','Security','-o',binary],{encoding:'utf8',timeout:60000});assert.equal(result.status,0,result.stderr);return binary;};
 binary=build(source,'keychain');const call=(exe,operation,key,value)=>spawnSync(exe,[],{input:JSON.stringify({operation,key,value}),encoding:'utf8',timeout:10000});
 const value={tokens:{access_token:'SYNTHETIC_KEYCHAIN_CANARY'}};
 assert.equal(call(binary,'write',key,value).status,0);assert.deepEqual(JSON.parse(call(binary,'read',key).stdout).value,value);assert.equal(call(binary,'remove',key).status,0);assert.equal(JSON.parse(call(binary,'read',key).stdout).value,null);
 const malformed='INVALID-'+randomUUID();assert.equal(call(binary,'remove',malformed).status,1);
 const guard='guard key.range(of: "^[a-z0-9-]{1,128}$", options: .regularExpression) != nil else';assert.ok(source.includes(guard));const broken=build(source.replace(guard,'guard true else'),'broken');
 assert.throws(()=>assert.equal(call(broken,'remove',malformed).status,1));
});
