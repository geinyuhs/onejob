// Only fixed scrolling code crosses the browser boundary; callers supply data.
export function validateScroll(args){
 if(args.selector!==undefined&&(typeof args.selector!=='string'||!/^e\d+$/u.test(args.selector)))throw new Error('Use a current element reference for the scroll container.');
 if(args.direction!==undefined&&!['up','down','left','right'].includes(args.direction))throw new Error('Use up, down, left or right for scrolling.');
 if(args.amount!==undefined&&(!Number.isFinite(args.amount)||args.amount<=0))throw new Error('Use a positive finite scroll amount.');
}
export function scrollViewport({direction='down',amount}){
 const horizontal=direction==='left'||direction==='right';
 const distance=amount??Math.max(1,(horizontal?window.innerWidth:window.innerHeight)*0.8);
 window.scrollBy({left:horizontal?distance*(direction==='left'?-1:1):0,top:horizontal?0:distance*(direction==='up'?-1:1),behavior:'instant'});
}
export function scrollContainer(element,{direction='down',amount}){
 const horizontal=direction==='left'||direction==='right';
 const distance=amount??Math.max(1,(horizontal?element.clientWidth:element.clientHeight)*0.8);
 element.scrollBy({left:horizontal?distance*(direction==='left'?-1:1):0,top:horizontal?0:distance*(direction==='up'?-1:1),behavior:'instant'});
}
