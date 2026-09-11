// An element role is a candidate, not permission; the independent review must
// distinguish opening a panel from changing the settings inside it.
export function navigationTarget(spec) {
 if(!['browser.click','browser.fill','browser.press','browser.select','browser.hover','browser.scroll'].includes(spec.name))return null;
 const selector=spec.args.selector;
 if(!/^e\d+$/u.test(selector||''))return null;
 const line=String(spec.snapshot||'').split('\n').find(line=>new RegExp(`\\[ref=${selector}\\](?:\\s|:|$)`).test(line));
 const match=line?.match(/^\s*(?:-\s*)?(link|tab|button|generic|menuitem|textbox|searchbox|combobox|listbox|region)\b(?:\s+"([^"]*)")?/u);
 if(!match)return null;
 if(spec.name==='browser.fill'&&!['textbox','searchbox','combobox'].includes(match[1]))return null;
 if(spec.name==='browser.press'&&!['Enter','Tab','Escape','ArrowDown','ArrowUp','ArrowLeft','ArrowRight','PageDown','PageUp'].includes(spec.args.key))return null;
 // Labels are evidence for the independent reviewer, never a keyword veto.
 return {role:match[1],label:match[2]||'',...(!match[2]?{context:navigationEvidence(spec.snapshot,selector)}:{})};
}
export function navigationEvidence(snapshot,selector){
 const lines=String(snapshot||'').split('\n'),index=lines.findIndex(line=>new RegExp(`\\[ref=${selector}\\](?:\\s|:|$)`).test(line));
 if(index<0)return null;
 const indent=line=>line.length-line.trimStart().length,depth=indent(lines[index]);
 const context=lines.filter(line=>/^\s*-?\s*heading\b/u.test(line));
 let parentDepth=depth;
 for(let i=index-1;i>=0;i--)if(lines[i].trim()&&indent(lines[i])<parentDepth){context.push(lines[i]);parentDepth=indent(lines[i]);}
 context.push(lines[index]);
 for(let i=index+1;i<lines.length&&(!lines[i].trim()||indent(lines[i])>depth);i++)context.push(lines[i]);
 return context.join('\n');
}
export function navigationDecision(result) {
 return !!result&&Object.keys(result).length===1&&result.decision==='navigation';
}

// Missing context and unknown tool types cannot bypass independent review.
export function automaticTarget(spec) {
 if(!['browser.click','browser.fill','browser.press'].includes(spec.name))return null;
 const selector=spec.args.selector;
 if(!/^e\d+$/u.test(selector||''))return null;
 const line=String(spec.snapshot||'').split('\n').find(line=>new RegExp(`\\[ref=${selector}\\](?:\\s|:|$)`).test(line));
 if(!line)return null;
 if(spec.name==='browser.press'&&!['Enter','Tab','Escape','ArrowDown','ArrowUp'].includes(spec.args.key))return null;
 return {control:line.trim(),arguments:spec.args};
}
export function scopedDecision(result){return !!result&&Object.keys(result).length===1&&result.decision==='scoped';}
