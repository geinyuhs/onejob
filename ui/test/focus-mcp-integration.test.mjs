import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {McpServer} from '../server/focus/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js';
import {StreamableHTTPServerTransport} from '../server/focus/node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js';
import {MCPAdapter} from '../server/focus/tools/adapters.mjs';

test('real MCP transport discovers and executes against a user-controlled local server',async t=>{
 const observed=[];const sessions=[];
 const http=createServer(async(req,res)=>{
  observed.push(req.headers.authorization);
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  const server=new McpServer({name:'synthetic-mcp',version:'1.0.0'});
  server.registerTool('read_example',{description:'Synthetic fixture',inputSchema:{}},async()=>({content:[{type:'text',text:'Synthetic service result'}]}));
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});sessions.push(server);
  try {await server.connect(transport);let body='';for await(const chunk of req)body+=chunk;await transport.handleRequest(req,res,JSON.parse(body));}
  catch(error){if(!res.headersSent)res.writeHead(500).end();}
 });
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));t.after(async()=>{for(const s of sessions)await s.close();http.closeAllConnections();await new Promise(resolve=>http.close(resolve));});
 const connection={url:`http://127.0.0.1:${http.address().port}/mcp`},adapter=new MCPAdapter(),signal=new AbortController().signal;
 const catalog=await adapter.call(connection,{operation:'list'},'SYNTHETIC_LOCAL_TOKEN',signal);assert.equal(catalog.tools[0].name,'read_example');
 const reply=await adapter.call(connection,{operation:'call',tool:'read_example'},'SYNTHETIC_LOCAL_TOKEN',signal);assert.equal(reply.content[0].text,'Synthetic service result');
 assert.ok(observed.length>0);assert.ok(observed.every(header=>header==='Bearer SYNTHETIC_LOCAL_TOKEN'));assert.ok(!JSON.stringify(reply).includes('SYNTHETIC_LOCAL_TOKEN'));
});
