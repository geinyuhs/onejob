export const services=Object.freeze({
 notion:{id:'notion',name:'Notion',url:'https://mcp.notion.com/mcp',origin:'https://mcp.notion.com',description:'Search and work with the pages you authorize.',scope:'default'},
 linear:{id:'linear',name:'Linear',url:'https://mcp.linear.app/mcp',origin:'https://mcp.linear.app',description:'Work with issues and projects you authorize.',scope:'read write'}
});
export function servicePreset(id) {
 const service=Object.hasOwn(services,id)?services[id]:null;
 if(!service)throw new Error('Choose a supported service.');
 return service;
}
export function serviceDestination(service,value) {
 const url=new URL(value);
 if(url.origin!==service.origin || url.username || url.password || url.hash)throw new Error('The service returned an unexpected sign-in destination.');
 return url;
}
export function serviceFetch(service,fetcher=fetch,signal) {
 return (input,options={})=>{
  serviceDestination(service,typeof input==='string'?input:input instanceof URL?input.href:input.url);
  return fetcher(input,{...options,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(30000),...([signal,options.signal].filter(Boolean))])});
 };
}
