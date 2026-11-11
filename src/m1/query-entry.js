'use strict';
// Direct Node entry, also runs inside ASAR with ELECTRON_RUN_AS_NODE=1.
const path=require('node:path');
const {query,inputSchema,outputSchema}=require('./usage-query');
const {defaultFile}=require('./read-snapshot');
const CODES=new Set(['QUERY_DIRECTORY_REQUIRED','QUERY_DIRECTORY_INVALID','QUERY_STORAGE_INVALID','QUERY_SNAPSHOT_BUSY','QUERY_SNAPSHOT_MISSING','QUERY_ARGUMENT_INVALID','QUERY_DATE_INVALID','QUERY_OUTPUT_LIMIT','QUERY_READ_ONLY','QUERY_REVISION_REQUIRED','QUERY_SNAPSHOT_CHANGED']);
function code(error){return CODES.has(error?.message)?error.message:'QUERY_FAILED';}
function options(args){
  const mode=args.shift();if(!['query','mcp'].includes(mode))throw new Error('QUERY_ARGUMENT_INVALID');
  let file,selection={};const seen=new Set();
  while(args.length){const key=args.shift(),value=args.shift();if(!['--data-dir','--json'].includes(key)||!value||seen.has(key)||mode==='mcp'&&key==='--json')throw new Error('QUERY_ARGUMENT_INVALID');seen.add(key);if(key==='--data-dir')file=path.join(path.resolve(value),'statistics.json');else{if(Buffer.byteLength(value)>65536)throw new Error('QUERY_ARGUMENT_INVALID');selection=JSON.parse(value);}}
  return {mode,file:file||defaultFile(),selection};
}
async function main(args=process.argv.slice(2)){
  const opts=options([...args]);
  require('./query-runtime').guard();
  if(opts.mode==='query'){process.stdout.write(JSON.stringify(query(opts.file,opts.selection))+'\n');return;}
  const {Server}=require('@modelcontextprotocol/sdk/server/index.js');
  const {StdioServerTransport}=require('@modelcontextprotocol/sdk/server/stdio.js');
  const {ListToolsRequestSchema,CallToolRequestSchema}=require('@modelcontextprotocol/sdk/types.js');
  const server=new Server({name:'agent-usage-saved-query',version:'1.0.0'},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,()=>({tools:[{name:'usage_query',description:'Query saved aggregate usage without collection. Unknown is null; costs are API-equivalent estimates. No session identities, paths or configuration.',inputSchema,outputSchema,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}]}));
  server.setRequestHandler(CallToolRequestSchema,request=>{
    try{
      if(request.params.name!=='usage_query')throw new Error('QUERY_ARGUMENT_INVALID');
      const result=query(opts.file,request.params.arguments??{}),response={content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};
      // Reserve the entire bounded input buffer for a caller-supplied JSON-RPC id.
      if(Buffer.byteLength(JSON.stringify(response))>959*1024)throw new Error('QUERY_OUTPUT_LIMIT');
      return response;
    }
    catch(error){return {isError:true,content:[{type:'text',text:code(error)}]};}
  });
  const transport=new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:65536});
  await server.connect(transport);
  transport.onerror=()=>{process.stderr.write('QUERY_PROTOCOL_ERROR\n');};
  process.stdin.on('end',()=>void server.close());
}
if(require.main===module)main().catch(error=>{process.stderr.write(code(error)+'\n');process.exitCode=1;});
module.exports={main,options};
