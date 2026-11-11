'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {DatabaseSync} = require('node:sqlite');
const {fixtures, SENTINEL} = require('./fixtures');
// Protocol buffer encoding for fixtures: [[field, number | Buffer], ...].
function protobuf(fields) {
  const varint = value => { const out = []; do { let byte = value % 128; value = Math.floor(value / 128); if (value) byte |= 128; out.push(byte); } while (value); return Buffer.from(out); };
  return Buffer.concat(fields.flatMap(([field, value]) => typeof value === 'number' ? [varint(field * 8), varint(value)] : [varint(field * 8 + 2), varint(value.length), value]));
}
const agyModels = ['gemini-2.5-pro', 'claude-sonnet-4-20250514'];
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
  // Antigravity: two model calls in the transcript (and its identical short copy),
  // their models in the conversation database's gen_metadata (field 1.19).
  const agyId = 'a6f0c1d2-0000-4000-8000-000000000001', agyLogs = path.join(selected.antigravity[0], agyId, '.system_generated', 'logs');
  const agyRows = [{type:'USER_INPUT', source:'USER_EXPLICIT', status:'DONE', step_index:0, created_at:time, content:SENTINEL},
    {type:'PLANNER_RESPONSE', source:'MODEL', status:'DONE', step_index:1, created_at:time, content:SENTINEL, thinking:SENTINEL, input_tokens:50, output_tokens:10, cache_read_tokens:30},
    {type:'GENERIC', source:'MODEL', status:'DONE', step_index:2, created_at:time, content:SENTINEL},
    {type:'PLANNER_RESPONSE', source:'MODEL', status:'DONE', step_index:3, created_at:time, content:SENTINEL, input_tokens:20, output_tokens:5, cache_read_tokens:15}];
  write(path.join(agyLogs, 'transcript_full.jsonl'), jsonl(agyRows)); write(path.join(agyLogs, 'transcript.jsonl'), jsonl(agyRows));
  write(path.join(agyLogs, 'chunks', 'transcript_full', '0.jsonl'), jsonl(agyRows));
  const agyDb = path.join(path.dirname(selected.antigravity[0]), 'conversations', agyId + '.db'); fs.mkdirSync(path.dirname(agyDb), {recursive:true});
  const conversation = new DatabaseSync(agyDb); conversation.exec('CREATE TABLE gen_metadata(idx INTEGER, data BLOB, size INTEGER)');
  agyModels.forEach((model, idx) => { const blob = protobuf([[1, protobuf([[4, protobuf([[2, 1], [3, 2]])], [19, Buffer.from(model)]])], [4, Buffer.from(SENTINEL)]]); conversation.prepare('INSERT INTO gen_metadata VALUES(?,?,?)').run(idx, blob, blob.length); });
  conversation.close();
  return {...fixture, time, deepseekRows:rows, agyId, agyRows, expected:{...fixture.expected,gemini:125,cursor:130,zcode:120,deepseek:135,antigravity:130,copilot:0,cline:0,pi:0,continue:0,kilo:0,qwen:0,kimi:0}, total:1334};
}
module.exports = {agentFixtures, protobuf, agyModels};
