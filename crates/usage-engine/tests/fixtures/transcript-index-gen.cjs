'use strict';

const fs = require('node:fs');
const path = require('node:path');
const transcript = require('../../../../src/m1/transcript');
const root = process.argv[2];
const id = 'fixture-session';
const moment = seconds => '2026-11-02T01:00:' + String(seconds).padStart(2, '0') + 'Z';
const codex = (type, payload, seconds) => ({ type, payload, timestamp: moment(seconds) });
const response = (type, fields, seconds) => codex('response_item', { type, ...fields }, seconds);
const message = (role, text, seconds) => response('message', { role, content: [{ text }] }, seconds);
const claude = (type, content, seconds, extra = {}, messageExtra = {}) => ({
  type, sessionId: id, timestamp: moment(seconds), message: { role: type, content, ...messageExtra }, ...extra
});
const usage = { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 2 };
const huge = '中🙂 ' + 'x'.repeat(transcript.LIMITS.page + 1) + ' hidden tail 彩色';
const image = 'c3ludGhldGlj';
const code = 'text(await tools.exec_command({cmd:"echo synthetic"}));';
const rows = {
  codex: [
    codex('session_meta', { id }, 0),
    codex('event_msg', { type: 'user_message', message: '重复的用户事件' }, 1),
    message('user', '问题', 1), message('assistant', huge, 2), message('assistant', '边界 needle', 3),
    codex('event_msg', { type: 'token_count', info: { last_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } }, 4),
    codex('event_msg', { type: 'token_count', info: { last_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } }, 4),
    response('custom_tool_call', { name: 'exec', call_id: 'code', input: code }, 5),
    response('function_call', { name: 'apply_patch', call_id: 'edit', arguments: { patch: '*** Begin Patch\n*** Update File: file.txt\n@@\n-before\n+needle\n*** End Patch' } }, 6),
    response('function_call_output', { call_id: 'code', output: 'Process exited with code 1\nneedle\n' + 'verbose\n'.repeat(50) }, 7),
    response('function_call_output', { call_id: 'edit', output: { metadata: { exit_code: 0 }, content: [{ text: 'ok' }] } }, 8),
    response('function_call_output', { call_id: 'missing', output: '孤立结果' }, 9),
    codex('compacted', { message: '压缩' }, 10),
    response('message', { role: 'user', content: [{ text: '看图' }, { type: 'input_image', image_url: 'data:image/png;base64,' + image }] }, 11),
    response('unknown_future', { data: '句子' }, 12), response('unknown_future', { data: '第二行' }, 13),
    message('assistant', '答复\n<oai-mem-citation><citation_entries>\nMEMORY.md:1|note=[synthetic]\n</citation_entries></oai-mem-citation>', 14)
  ],
  claude: [
    claude('user', '问题', 0), claude('assistant', [{ type: 'text', text: huge }, { type: 'thinking', thinking: '思考' },
      { type: 'tool_use', id: 'edit', name: 'Edit', input: { file_path: 'file.txt', old_string: 'old', new_string: 'needle' } }],
      1, {}, { usage, id: 'msg' }),
    claude('assistant', [{ type: 'text', text: '又写了' }], 4, {}, { usage, id: 'msg' }),
    claude('user', [{ type: 'tool_result', tool_use_id: 'edit', content: [{ type: 'text', text: 'needle' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } }] }], 5),
    { type: 'attachment', timestamp: moment(6), attachment: { type: 'queued_command', prompt: '排队的消息' } },
    { type: 'system', subtype: 'compact_boundary', timestamp: moment(7), compactMetadata: { trigger: 'auto', preTokens: 100 } },
    claude('user', 'session summary', 8, { isCompactSummary: true }),
    claude('assistant', [{ type: 'future_part', text: '保留' }], 9),
    claude('user', '<command-name>/status</command-name>', 10),
  ]
};
const event = (type, data, seconds) => ({ type, data, timestamp: moment(seconds) });
rows.copilot = [
  event('session.start', { sessionId: id }, 0),
  event('user.message', { content: '问 needle' }, 1),
  event('assistant.message', { content: '回答', reasoningText: '想', toolRequests: [
    { toolCallId: 'call-1', name: 'Edit', arguments: { file_path: 'src/edit.js', old_string: 'before', new_string: 'after' } }
  ] }, 2),
  event('tool.execution_start', { toolCallId: 'call-1', toolName: 'duplicate-call', arguments: {} }, 2),
  event('tool.execution_complete', { toolCallId: 'call-1', result: { content: 'brief', detailedContent: 'detail needle' } }, 3),
  event('assistant.message', { parentToolCallId: 'child-abcdef012345', content: '子代理' }, 4),
  event('tool.execution_complete', { toolCallId: 'orphan', success: false, error: { message: '失败了' } }, 5),
  event('session.compaction_complete', { success: true, preCompactionTokens: 1024 }, 6),
  event('session.warning', { content: 'warning' }, 7), event('session.warning', { message: 'another warning' }, 8)
];
const buddy = (type, fields, seconds) => ({ type, sessionId: id, timestamp: Date.parse(moment(seconds)), ...fields });
rows.workbuddy = [
  buddy('message', { role: 'user', content: { text: '问 needle' } }, 1),
  buddy('reasoning', { rawContent: [{ text: '思考' }] }, 2),
  buddy('function_call', { callId: 'read', name: 'Read', arguments: '{"file_path":"file.txt"}' }, 3),
  buddy('function_call_result', { call_id: 'read', status: 'failed', output: { text: '读不到' } }, 4),
  buddy('function_call_result', { id: 'orphan', output: { value: 'needle' } }, 5),
  buddy('message', { role: 'assistant', message: { content: [{ text: '回答' }], usage }, providerData: { messageId: 'm' } }, 6),
  buddy('future', { content: '新的格式' }, 7)
];
rows.cursor = [
  { role: 'user', message: { content: [{ type: 'text', text: '<user_query>\n问题 needle\n</user_query>' }] } },
  { role: 'assistant', message: { content: [
    { type: 'thinking', text: '想一想' }, { type: 'text', text: '回答' },
    { type: 'tool_use', name: 'Write', input: { path: 'file.txt', content: 'needle' } },
    { type: 'future', text: '保留这个' }
  ] } },
  { role: 'tool', message: { content: 'not a message' } }
];
const write = (file, values) => fs.writeFileSync(file, values.map(value => JSON.stringify(value)).join('\n'));
const fixedTime = new Date('2026-11-04T00:00:00.000Z');
function ownDirectory(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
async function generate() {
  const results = [];
  for (const agent of ['codex', 'claude', 'codex-events', 'claude-embedded', 'copilot', 'workbuddy', 'cursor']) {
    const base = agent.split('-')[0];
    const dir = ownDirectory(agent);
    const record = path.join(dir, {
      codex: 'rollout-own-' + id + '.jsonl', 'codex-events': 'alternate-name.jsonl',
      copilot: 'session-state/' + id + '/events.jsonl', workbuddy: 'header-lookup.jsonl',
      cursor: 'project/agent-transcripts/' + id + '/' + id + '.jsonl'
    }[agent] || id + '.jsonl');
    const data = rows[agent] || (agent === 'codex-events' ? [
      codex('session_meta', { id }, 0), codex('event_msg', { type: 'user_message', message: '旧式问题' }, 1),
      codex('event_msg', { type: 'agent_message', message: '旧式回答' }, 2)
    ] : [
      claude('user', '问题', 0),
      { type: 'progress', timestamp: moment(2), data: { type: 'agent_progress', agentId: 'child-old', message: claude('assistant', '内嵌', 2) } },
      { type: 'unrecognized', timestamp: moment(3), order: 1, '1': 'indexed property' },
      claude('assistant', '回复', 4)
    ]);
    fs.mkdirSync(path.dirname(record), { recursive: true });
    write(record, data);
    fs.utimesSync(record, fixedTime, fixedTime);
    if (agent === 'claude') {
      const subdir = path.join(dir, id, 'subagents', 'nested');
      fs.mkdirSync(subdir, { recursive: true });
      const sub = path.join(subdir, 'agent-child.jsonl');
      write(sub, [claude('user', '子会话', 2), claude('assistant', 'needle in child', 3)]);
      fs.utimesSync(sub, fixedTime, fixedTime);
    }
    if (agent === 'cursor') {
      const subdir = path.join(path.dirname(record), 'subagents');
      fs.mkdirSync(subdir, { recursive: true });
      const sub = path.join(subdir, 'child-0123456789.jsonl');
      write(sub, [{ role: 'assistant', message: { content: 'subagent needle' } }]);
      fs.utimesSync(sub, fixedTime, fixedTime);
      write(path.join(dir, 'unapproved.jsonl'), rows.cursor);
    }
    const preview = await transcript.transcript(base, id, [dir]);
    const { value } = await transcript.load(base, id, [dir]);
    const parts = [];
    for (const [index, item] of value.items.entries()) {
      const fields = item.kind === 'image' ? ['image'] : item.kind === 'tool'
        ? [...(item.tool.output === null ? [] : ['output']), ...(item.tool.change ? ['diff'] : [])] : ['text'];
      for (const field of fields) {
        const offset = field === 'text' && item.text.length > transcript.LIMITS.page ? transcript.LIMITS.page : 0;
        const request = { stamp: preview.stamp, index, field, offset };
        parts.push({ request, expected: await transcript.part(base, id, [dir], request) });
      }
    }
    const finds = [];
    for (const query of ['needle', 'hidden tail', '彩色\n\n边界', 'nonexistent']) {
      const request = { stamp: preview.stamp, query };
      finds.push({ request, expected: await transcript.find(base, id, [dir], request) });
    }
    const facts = await transcript.facts(base, id, [dir]);
    const markdown = await transcript.markdown(base, id, [dir], { stamp: preview.stamp, from: 0, to: preview.items.length - 1 });
    results.push({ directory: agent, agent: base, id, preview, parts, finds, facts, markdown });
  }
  process.stdout.write(JSON.stringify(results));
}
generate().catch(error => { console.error(error); process.exitCode = 1; });
