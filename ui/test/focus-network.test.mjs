import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {localRanker} from '../server/focus/search.mjs';

test('network denial fires; a deliberately unsandboxed helper leaks the synthetic canary', {skip:process.platform!=='darwin'}, async t=>{
 const dir=mkdtempSync(join(tmpdir(),'onejob-network-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const received=[];
 const server=createServer(socket=>{socket.on('data',data=>received.push(data.toString()));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const binary=join(dir,'synthetic-helper');
 writeFileSync(binary,`#!${process.execPath}
const net=require('node:net');let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{
 const socket=net.connect(${server.address().port},'127.0.0.1');
 socket.on('connect',()=>{socket.end('SYNTHETIC_CANARY',()=>{console.log(JSON.stringify({available:true,matches:[]}));socket.destroy();});});
 socket.on('error',()=>console.log(JSON.stringify({available:false,matches:[]})));
});
`,{mode:0o700});
 const query='SYNTHETIC_CANARY';
 const protectedResult=localRanker(binary)(query,[]);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(protectedResult.available,false);
 assert.deepEqual(received,[],'the local indexer must not reach even a test listener');
 const source=readFileSync(new URL('../server/focus/search.mjs',import.meta.url),'utf8');
 const mutant=join(dir,'mutant.mjs');writeFileSync(mutant,source.replace('(deny network*)',''));
 const {localRanker:broken}=await import(pathToFileURL(mutant));
 assert.equal(broken(binary)(query,[]).available,true,'the canary proves the helper actually attempts networking');
 await new Promise(resolve=>setTimeout(resolve,50));
 assert.throws(()=>assert.deepEqual(received,[]),'the same privacy assertion fails when network denial is removed');
 assert.ok(received.join('').includes(query));
});
