import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Transcription} from '../server/focus/transcription.mjs';
const sample='sk-'+'synthetic'.repeat(6);
function fixture(t,T=Transcription,fetcher){const dir=mkdtempSync(join(tmpdir(),'onejob-voice-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));let stored=null;const keychain={read:async()=>stored,write:async(k,v)=>{stored=v;}};return {dir,voice:new T(keychain,fetcher),keychain};}
test('voice uses the dedicated key and sends only the recording directly to OpenAI',async t=>{
 let request;const f=fixture(t,Transcription,async(url,options)=>{request={url,options};return {ok:true,json:async()=>({text:'Synthetic voice text.'})};});
 assert.equal((await f.voice.status()).ready,false);const path=join(f.dir,'voice-key');writeFileSync(path,sample,{mode:0o600});await f.voice.importKey(path);
 assert.equal((await f.voice.status()).ready,true);assert.deepEqual(await f.voice.transcribe(Buffer.from('synthetic-audio').toString('base64')),{text:'Synthetic voice text.'});
 assert.equal(request.url,'https://api.openai.com/v1/audio/transcriptions');assert.equal(request.options.redirect,'error');assert.equal(request.options.body.get('model'),'gpt-transcribe');assert.deepEqual([...request.options.body.keys()],['model','file']);assert.equal(request.options.headers.Authorization,'Bearer '+sample);
});
async function fileGuard(t,T){const f=fixture(t,T),path=join(f.dir,'public-key');writeFileSync(path,sample,{mode:0o644});await assert.rejects(f.voice.importKey(path),/0600/);assert.equal((await f.voice.status()).ready,false);}
async function linkGuard(t,T){const f=fixture(t,T),path=join(f.dir,'key'),link=join(f.dir,'link');writeFileSync(path,sample,{mode:0o600});symlinkSync(path,link);await assert.rejects(f.voice.importKey(link));}
async function keyGuard(t,T){const f=fixture(t,T),path=join(f.dir,'not-a-key');writeFileSync(path,'synthetic plain text',{mode:0o600});await assert.rejects(f.voice.importKey(path),/API key/);}
async function audioGuard(t,T){const f=fixture(t,T,async()=>({ok:true,json:async()=>({text:'Synthetic'})}));await f.keychain.write('',{key:sample});await assert.rejects(f.voice.transcribe(''),/empty/);await assert.rejects(f.voice.transcribe(Buffer.alloc(25000001).toString('base64')),/large/);}
async function missingKey(t,T){const f=fixture(t,T,async()=>({ok:true,json:async()=>({text:'Synthetic'})}));await assert.rejects(f.voice.transcribe('YQ=='),/Set up/);}
async function providerError(t,T){const f=fixture(t,T,async()=>({ok:false,json:async()=>({text:'False success'})}));await f.keychain.write('',{key:sample});await assert.rejects(f.voice.transcribe('YQ=='),/billing/);}
async function badTranscript(t,T){const f=fixture(t,T,async()=>({ok:true,json:async()=>({text:{invalid:true}})}));await f.keychain.write('',{key:sample});await assert.rejects(f.voice.transcribe('YQ=='),/unreadable/);}
for(const [name,scenario,guard,replacement] of [
 ['private file',fileGuard,"if(!stat.isFile() || (stat.mode&0o777)!==0o600 || stat.size>4096 || stat.uid!==process.getuid())",'if(false)'],
 ['symlink',linkGuard,'constants.O_RDONLY|constants.O_NOFOLLOW','constants.O_RDONLY'],
 ['key format',keyGuard,"if(!/^sk-[A-Za-z0-9_-]{16,512}$/.test(key))",'if(false)'],
 ['audio bounds',audioGuard,'if(bytes.length===0 || bytes.length>25000000)','if(false)'],
 ['missing key',missingKey,'if(!key)','if(false)'],
 ['provider failure',providerError,'if(!response.ok)','if(false)'],
 ['invalid transcript',badTranscript,"if(typeof result.text!=='string' || result.text.length>16000)",'if(false)'],
]){
 test(name+' is rejected',t=>scenario(t,Transcription));
 test('mutation proof: transcription '+name,async t=>{const dir=mkdtempSync(join(tmpdir(),'onejob-voice-mutant-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const source=readFileSync(new URL('../server/focus/transcription.mjs',import.meta.url),'utf8');assert.ok(source.includes(guard));const path=join(dir,'transcription.mjs');writeFileSync(path,source.replace(guard,replacement));const {Transcription:Broken}=await import(pathToFileURL(path));await assert.rejects(scenario(t,Broken));});
}
