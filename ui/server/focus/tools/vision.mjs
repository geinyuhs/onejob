// Page text may leave for local matching, but known credentials must never be
// supplied to page JavaScript (including scripts on a different website).
export function collectTextNodes(key){
 const nodes=[];
 const walker=document.createTreeWalker(document.body,4);
 while(walker.nextNode())nodes.push(walker.currentNode);
 window[key]={nodes,styles:[]};return nodes.map(node=>node.textContent);
}
// Serialized into the owned tab only. Restore every temporary style in finally.
export function concealFields({key,matches}){
 const hidden=new Set(document.querySelectorAll('input,textarea,[contenteditable],iframe'));
 for(const index of matches)hidden.add(window[key].nodes[index]?.parentElement);
 window[key].styles=[...hidden].filter(Boolean).map(element=>({element,value:element.style.getPropertyValue('visibility'),priority:element.style.getPropertyPriority('visibility')}));
 for(const {element} of window[key].styles)element.style.setProperty('visibility','hidden','important');
}
export function revealFields(key){
 for(const {element,value,priority} of window[key]?.styles||[])if(value)element.style.setProperty('visibility',value,priority);else element.style.removeProperty('visibility');
 delete window[key];
}
