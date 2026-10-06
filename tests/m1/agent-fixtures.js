'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {DatabaseSync} = require('node:sqlite');
const {fixtures, SENTINEL} = require('./fixtures');
function agentFixtures(home) {
  const fixture = fixtures(home), selected = fixture.roots, time = new Date().toISOString();
  const write = (file, text) => { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, text); return file; };
  const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  const gemini = {id:'gemini-message', type:'gemini', model:'gemini-2.5-pro', timestamp:time, content:SENTINEL, tokens:{input:100, output:20, cached:40, thoughts:5, tool:0, total:125}};
  write(path.join(selected.gemini[0], 'project', 'chats', 'session-fixture.jsonl'), jsonl([{sessionId:'gemini-session', projectHash:'synthetic'},gemini,{$rewindTo:gemini.id},{$set:{messages:[gemini]}}]));
  write(path.join(selected.gemini[0], 'project', 'chats', 'session-copy.json'), JSON.stringify({sessionId:'gemini-session', messages:[gemini]}));
  selected.cursor = [path.join(home, 'cursor-sdk', 'runs.ndjson')];
  write(selected.cursor[0], jsonl([{agentId:'sdk-agent', runId:'run-1', model:{id:'gpt-4.1'}, createdAt:Date.parse(time), usage:{inputTokens:60, outputTokens:20, cacheReadTokens:40, cacheWriteTokens:10, reasoningTokens:3, totalTokens:130}, result:SENTINEL}]));
  fs.mkdirSync(path.dirname(selected.zcode[0]), {recursive:true});
  const db = new DatabaseSync(selected.zcode[0]);
  db.exec('CREATE TABLE model_usage(id TEXT, session_id TEXT, provider_id TEXT, model_id TEXT, started_at INTEGER, completed_at INTEGER, input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER, cache_creation_input_tokens INTEGER, cache_read_input_tokens INTEGER, provider_total_tokens INTEGER, computed_total_tokens INTEGER, raw_usage_json TEXT); CREATE TABLE turn_usage(input_tokens INTEGER)');
  db.prepare('INSERT INTO model_usage VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('z-request','z-session','zai','GLM-5.3',Date.parse(time),Date.parse(time),100,20,2,0,40,120,120,SENTINEL);
  db.exec('INSERT INTO turn_usage VALUES(120)'); db.close();
  const usage = {inputTokens:60, outputTokens:20, cacheReadTokens:40, cacheWriteTokens:0, reasoningTokens:2, totalTokens:120};
  const rows = [{type:'session', version:4, id:'dsh-child', createdAt:Date.parse(time), isSeeded:true, delegationDepth:0},
    {seq:0, type:'assistant/message', time:Date.parse(time), data:{usage, message:{source:{kind:'model',provider:'deepseek',model:'deepseek-chat'}, content:SENTINEL}}},
    {seq:1, type:'session/end-seed', time:Date.parse(time), data:{inherited:true}},
    {seq:2, type:'request/context', time:Date.parse(time), data:{provider:'deepseek',model:'deepseek-chat'}},
    {seq:3, type:'assistant/attempt', time:Date.parse(time), data:{turn:0, step:0, stream:[{type:'chunk', time:Date.parse(time), chunk:{type:'usage',usage:{inputTokens:10,outputTokens:5,cacheReadTokens:0,cacheWriteTokens:0,totalTokens:15}}}]}},
    {seq:4, type:'assistant/message', time:Date.parse(time), data:{turn:0, step:1, usage, stream:[{type:'chunk', time:Date.parse(time), chunk:{type:'usage',usage}}], message:{source:{kind:'model',provider:'deepseek',model:'deepseek-chat'},content:SENTINEL}}}];
  const dsh = path.join(selected.deepseek[0], 'project', 'child');
  write(path.join(dsh,'session.v3.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(jsonl([{...rows[0],version:3},...rows.slice(1)]))));
  // The default backend writes concatenated checksummed frames, not one JSON array.
  write(path.join(dsh,'session.v4.jsonl.zstd'), Buffer.concat(rows.map(row => zlib.zstdCompressSync(Buffer.from(jsonl([row]))))));
  return {...fixture, time, deepseekRows:rows, expected:{...fixture.expected,gemini:125,cursor:130,zcode:120,deepseek:135}, total:1204};
}
module.exports = {agentFixtures};
