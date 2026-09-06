import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const source=readFileSync(new URL('../focus/Policy.swift',import.meta.url),'utf8');
const proof=`
func check(_ condition: Bool) { if !condition { exit(1) } }
let page=URL(fileURLWithPath:"/tmp/synthetic/index.html")
check(NativePolicy.trustedPage(page, expected:page, mainFrame:true))
check(!NativePolicy.trustedPage(page, expected:page, mainFrame:false))
check(!NativePolicy.trustedPage(URL(fileURLWithPath:"/tmp/other.html"), expected:page, mainFrame:true))
check(!NativePolicy.trustedPage(URL(string:"https://example.invalid"), expected:page, mainFrame:true))
check(NativePolicy.loginURL("https://auth.openai.com/authorize") != nil)
for url in ["http://auth.openai.com", "https://auth.openai.com.attacker.invalid", "file:///tmp/x", "https://user:secret@chatgpt.com"] { check(NativePolicy.loginURL(url) == nil) }
check(NativePolicy.serviceLoginURL("https://mcp.notion.com/authorize") != nil)
for url in ["https://attacker.invalid/authorize", "http://mcp.notion.com/authorize", "https://mcp.notion.com:444/authorize", "https://user:secret@mcp.linear.app/authorize", "https://mcp.linear.app/authorize#bad"] { check(NativePolicy.serviceLoginURL(url) == nil) }
check(NativePolicy.mayRecord(authorized:true,microphone:true,available:true,onDevice:true,sampleRate:48000,channels:1))
check(!NativePolicy.mayRecord(authorized:false,microphone:true,available:true,onDevice:true,sampleRate:48000,channels:1))
check(!NativePolicy.mayRecord(authorized:true,microphone:false,available:true,onDevice:true,sampleRate:48000,channels:1))
check(!NativePolicy.mayRecord(authorized:true,microphone:true,available:false,onDevice:true,sampleRate:48000,channels:1))
check(!NativePolicy.mayRecord(authorized:true,microphone:true,available:true,onDevice:false,sampleRate:48000,channels:1))
check(!NativePolicy.mayRecord(authorized:true,microphone:true,available:true,onDevice:true,sampleRate:0,channels:1))
check(!NativePolicy.mayRecord(authorized:true,microphone:true,available:true,onDevice:true,sampleRate:48000,channels:0))
`;
test('native trust, login, and recording policy fires; each broken policy fails', {skip:process.platform!=='darwin'},t=>{
 const dir=mkdtempSync(join(tmpdir(),'onejob-native-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const variants=[
  [source,0],
  [source.replace('mainFrame && url?.isFileURL == true && url?.standardizedFileURL == expected?.standardizedFileURL','true'),1],
  [source.replace('else { return nil }','else { return URL(string:"https://chatgpt.com") }'),1],
  [source.replace('["mcp.notion.com", "mcp.linear.app"]','["mcp.notion.com", "mcp.linear.app", "attacker.invalid"]'),1],
  ...['authorized && ','microphone && ','available && ','onDevice && ','sampleRate > 0 && ',' && channels > 0'].map(part=>[source.replace(part,''),1]),
 ];
 for(const [code,expected] of variants){
  const script=join(dir,'policy.swift');writeFileSync(script,code+proof);
  const result=spawnSync('/usr/bin/swift',['-module-cache-path',join(tmpdir(),'onejob-policy-cache'),script],{encoding:'utf8',timeout:60000});
  assert.equal(result.status,expected,result.stderr);assert.doesNotMatch(result.stderr,/error:/,'red must come from the negative assertion, not a compiler error');
 }
});
