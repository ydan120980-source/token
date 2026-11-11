'use strict';
// Independently authored synthetic records, following pinned public schema docs.
const common={schemaVersion:'CustomSourceV1',template:'mapped',mode:'per-request',timeUnit:'iso',inputSemantics:'exclusive',outputIncludesReasoning:true};
module.exports=[{
  name:'oh-my-pi',reference:'https://github.com/can1357/oh-my-pi/blob/076a85ed7dd037225f6d399ed40c4c21e9726251/docs/session.md',
  definition:{...common,name:'公开格式 OMP',mapping:{id:'id',time:'timestamp',model:'message.model',provider:'message.provider',input:'message.usage.input',output:'message.usage.output',cacheRead:'message.usage.cacheRead',cacheWrite:'message.usage.cacheWrite',total:'message.usage.totalTokens'},filters:[{path:'type',values:['message']},{path:'message.role',values:['assistant']}]},
  record:{type:'message',id:'synthetic-omp-call',timestamp:'2026-10-18T00:00:00Z',message:{role:'assistant',model:'fixture-model',provider:'synthetic-public',usage:{input:100,output:20,cacheRead:5,cacheWrite:2,totalTokens:127}}},expected:127,expectedCost:.000381
},{
  name:'Triss',reference:'https://github.com/ayleen/triss-coworker/blob/8baae4dad67dd34f2124062e8caaf64fd92a87f9/docs/usage-accounting.md',
  definition:{...common,name:'公开格式 Triss',mapping:{id:'call_id',time:'ts',model:'model',provider:'provider',input:'tokens.input_uncached',output:'tokens.output_total',cacheRead:'tokens.cache_read',cacheWrite:'tokens.cache_write',reasoning:'tokens.reasoning',total:'tokens.total'},filters:[{path:'schema_version',values:[2]},{path:'usage_status',values:['reported']}]},
  record:{schema_version:2,call_id:'synthetic-triss-call',ts:'2026-10-18T00:00:01Z',provider:'synthetic-public',model:'fixture-model',usage_status:'reported',tokens:{input_uncached:100,cache_read:5,cache_write:2,output_total:23,reasoning:3,total:130}},expected:130,expectedCost:.00039
}];
