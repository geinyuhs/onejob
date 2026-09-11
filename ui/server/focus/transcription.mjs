import {openSync,fstatSync,readFileSync,closeSync,constants} from 'node:fs';
export class Transcription {
  constructor(keychain,fetcher=fetch){this.keychain=keychain;this.fetcher=fetcher;}
  async status(){return {ready:!!(await this.keychain.read('speech-openai'))?.key,model:'gpt-transcribe'};}
  async importKey(path){
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const stat=fstatSync(fd);
      if(!stat.isFile() || (stat.mode&0o777)!==0o600 || stat.size>4096 || stat.uid!==process.getuid())throw new Error('Choose a private 0600 file owned by you.');
      const key=readFileSync(fd,'utf8').trim();
      if(!/^sk-[A-Za-z0-9_-]{16,512}$/.test(key))throw new Error('The selected file does not contain an OpenAI API key.');
      await this.keychain.write('speech-openai',{key});return {ready:true,model:'gpt-transcribe'};
    }finally{closeSync(fd);}
  }
  async transcribe(audio){
    const bytes=Buffer.from(typeof audio==='string'?audio:'','base64');
    if(bytes.length===0 || bytes.length>25000000)throw new Error('The recording is empty or too large. Record a shorter part.');
    const key=(await this.keychain.read('speech-openai'))?.key;
    if(!key)throw new Error('Set up OpenAI dictation in AI settings first.');
    const form=new FormData();form.set('model','gpt-transcribe');form.set('file',new Blob([bytes],{type:'audio/mp4'}),'dictation.m4a');
    let response;
    try {response=await this.fetcher('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:form,redirect:'error',signal:AbortSignal.timeout(180000)});}
    catch(error){throw new Error('Dictation could not reach OpenAI. Please try again.');}
    if(!response.ok)throw new Error('OpenAI dictation failed. Check your API billing and access.');
    const result=await response.json();
    if(typeof result.text!=='string' || result.text.length>16000)throw new Error('The transcript is too long or unreadable. Record a shorter part.');
    return {text:result.text};
  }
}
