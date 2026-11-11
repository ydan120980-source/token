'use strict';
// Tool-only: the source stays O_RDONLY, including WAL; no source SQLite connection.
// The existing image reader is capped at 512 MiB. SQL returns <=200 projected rows,
// never message content; JSON/JSONL sampling keeps its separate 64 MiB ceiling.
const {readDatabase,query}=require('../../src/m1/sqlite-memory');
const LIMIT=200,ROW_BYTES=1024*1024;
async function sample(file,audit){
  return readDatabase(file,audit,db=>{
    const tables=new Set(query(db,"SELECT name FROM sqlite_master WHERE type='table'").map(r=>r.name)),objects=[];
    let inspected=0,skipped=0;
    for(const table of ['message','session_message']){
      if(!tables.has(table)||inspected>=LIMIT)continue;
      const valid="CASE WHEN length(CAST(data AS BLOB))<=1048576 AND json_valid(data) THEN data ELSE '{}' END";
      const fields=['role','tokens','time','timestamp','modelID','model','providerID','sessionID'];
      const rows=query(db,'SELECT id,session_id,length(CAST(data AS BLOB)) AS bytes,'+fields.map((f,i)=>"json_extract("+valid+", '$."+f+"') AS f"+i).join(',')+(table==='session_message'?',type':'')+' FROM '+table+' ORDER BY id DESC LIMIT '+(LIMIT-inspected));
      inspected+=rows.length;
      for(const r of rows){if(r.bytes>ROW_BYTES||r.f0===null&&!r.type){skipped++;continue;}const obj={id:r.id,session_id:r.session_id};for(let i=0;i<fields.length;i++){let value=r['f'+i];if(['tokens','time','model'].includes(fields[i])&&typeof value==='string'&&/^[{[]/.test(value))value=JSON.parse(value);if(value!==null)obj[fields[i]]=value;}obj.role||=r.type;objects.push(obj);}
    }
    return {objects,sampling:{kind:'sqlite-usage-projection',rowLimit:LIMIT,inspectedRows:inspected,oversizeOrInvalidRows:skipped,rowBytesLimit:ROW_BYTES,limitReached:inspected===LIMIT}};
  });
}
module.exports={sample,LIMIT};
