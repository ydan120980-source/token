'use strict';
// What an Agent writes into a conversation that is not the person's or the model's own words, recognised for the
// reading view (docs/m2/UI-READER-RECOGNITION-20261102.md). Nothing here is kept or counted; the original text of a
// folded message stays readable where it folds. Grounds:
// - <oai-mem-citation> ends a Codex reply and its app hides it: codex-rs/utils/stream-parser (openai/codex).
// - <send_user_message_question_reply> holds JSON {question, answer}: codex-rs/tui/src/async_question_reply.rs.
// - "## My request for Codex:" separates what the Codex app prepends from the person's words: protocol.rs USER_MESSAGE_BEGIN.
// - "# Files mentioned by the user:" and its "## " lines: raycast/extensions codex message-cleaning.ts, third party.
// - The other tags: the list in yetone/magpie internal/gateway/prompt.go, third party, and Codex's own fragments.
// A message made only of tagged elements whose names are written like these (a "_" or "-" inside) folds too, so a
// new tag needs no new release; a person who pastes exactly that finds it in the fold, not lost.

const KNOWN = {
  environment_context: '环境信息', user_instructions: '用户指令', INSTRUCTIONS: '指令', session_context: '会话环境', hook_context: 'Hook 内容', 'permissions instructions': '权限说明',
  'system-reminder': '系统提醒', external_codex_apps_open_page: '打开了一个应用页面', turn_aborted: '这一轮被中断', subagent_notification: '子 Agent 通知', 'subagent-notification': '子 Agent 通知',
  'task-notification': '任务通知', 'in-app-browser-context': '内置浏览器内容', plugin_reference: '插件引用', recommended_plugins: '推荐的插件', skill: 'Skill 内容', 'local-command-caveat': '本地命令说明', 'local-command-stdout': '本地命令输出',
};
const LEADING = /^\s*# AGENTS\.md instructions/;
const WRAPPED = /^\s*<(?:permissions instructions)\b/;
const OPENING = /^\s*# (?:Files mentioned by the user|Context from my IDE setup):|^\s*## Referenced ChatGPT conversation:/;
const REQUEST = '\n## My request for Codex:\n';

// The tags a message is made of, or null when anything else is in it.
function onlyTags(text) {
  const tags = [];
  let rest = text.trim();
  while (rest) {
    const open = /^<([A-Za-z][\w-]*)(?:\s[^>]*)?>/.exec(rest);
    if (!open) return null;
    const close = '</' + open[1] + '>', end = rest.indexOf(close);
    if (end < 0) return null;
    tags.push(open[1]);
    rest = rest.slice(end + close.length).trim();
  }
  return tags.length ? tags : null;
}
const tagged = tag => tag in KNOWN || /[a-z0-9][_-][a-z0-9]/i.test(tag);

function answers(text) {
  const match = /^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(text);
  if (!match) return null;
  let value; try { value = JSON.parse(match[1]); } catch { return null; }
  const list = (Array.isArray(value) ? value : [value]).filter(entry => typeof entry?.question === 'string' && typeof entry?.answer === 'string');
  return list.length ? list : null;
}
function attachments(block) {
  const list = [];
  for (const line of block.split('\n')) {
    const match = /^##\s+(.+?)(?::\s+(.+))?\s*$/.exec(line);
    if (match && !/^My request\b/.test(match[1]) && !/^Referenced ChatGPT conversation\b/.test(match[1])) list.push({ name: match[1].trim().slice(0, 200), ...(match[2] ? { path: match[2].trim().slice(0, 1000) } : {}) });
  }
  return list.slice(0, 64);
}
const firstLine = text => (text.split('\n').find(line => line.trim()) ?? '').trim().slice(0, 80);

// How one user-side text reads: { kind: 'user' | 'context' | 'command', text, label?, attached?, answered? }.
function classify(value) {
  // The app's marker for an image the record carries elsewhere is not the person's words.
  const text = (typeof value === 'string' ? value : '').replace(/<image\b[^>]*>\s*<\/image>\s*/g, '');
  if (OPENING.test(text)) {
    const at = text.lastIndexOf(REQUEST), attached = attachments(at < 0 ? text : text.slice(0, at)), words = at < 0 ? '' : text.slice(at + REQUEST.length).trim();
    if (words) return { ...classify(words), ...(attached.length ? { attached } : {}) };
    if (attached.length) return { kind: 'user', text: attached.map(file => file.name).join('\n'), label: '附带了 ' + attached.length + ' 个文件', attached };
  }
  const replied = answers(text);
  if (replied) return { kind: 'user', text: replied.map(entry => entry.question.split('\n').map(line => '> ' + line).join('\n') + '\n\n' + entry.answer).join('\n\n'), label: '回答：' + firstLine(replied[0].answer), answered: true };
  if (LEADING.test(text) || WRAPPED.test(text)) return { kind: 'context', text, label: LEADING.test(text) ? 'AGENTS.md 指令' : '权限说明' };
  const tags = onlyTags(text);
  if (tags?.every(tagged)) {
    if (tags.length === 1 && tags[0] === 'user_shell_command') { const command = /<command>([\s\S]*?)<\/command>/.exec(text)?.[1].trim(); if (command) return { kind: 'command', text: command }; }
    return { kind: 'context', text, label: KNOWN[tags.find(tag => KNOWN[tag]) ?? ''] ?? '注入的上下文' };
  }
  if (tags === null && /^\s*<(?:environment_context|user_instructions|system-reminder|INSTRUCTIONS|session_context|hook_context)\b/.test(text)) return { kind: 'context', text, label: KNOWN[/^\s*<([\w-]+)/.exec(text)[1]] ?? '注入的上下文' };
  return { kind: 'user', text };
}
// A slash command the person typed (/model, /compact args) reads as a command line.
const slash = text => text.length <= 500 && /^\s*\/[A-Za-z][\w:-]*(?:\s|$)/.test(text) && !text.trim().includes('\n');

// A Codex reply without its memory citation, and that citation: where each remembered fact came from.
const CITATION = /\s*<oai-mem-citation>([\s\S]*?)<\/oai-mem-citation>\s*/g;
function citations(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text.includes('<oai-mem-citation>')) return { text, cited: null };
  const cited = [];
  const clean = text.replace(CITATION, (_, body) => {
    const block = /<citation_entries>([\s\S]*?)<\/citation_entries>/.exec(body)?.[1] ?? '';
    for (const line of block.split('\n')) {
      const match = /^\s*(.+?):(\d+(?:-\d+)?)\|note=\[(.*)\]\s*$/.exec(line);
      if (match) cited.push({ path: match[1].slice(0, 1000), lines: match[2], note: match[3].slice(0, 400) });
    }
    return '\n\n';
  }).trim();
  return { text: clean, cited: cited.slice(0, 64) };
}

// Codex's code mode: the model writes JavaScript for the `exec` tool and calls real tools inside it
// (codex-rs/code-mode-protocol/src/description.rs). What it ran is read from the source, never by running it.
function literal(source, from) {
  const quote = source[from];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  let out = '';
  for (let at = from + 1; at < source.length; at++) {
    const char = source[at];
    if (char === quote) return { text: out, end: at + 1 };
    if (char === '\\') {
      const next = source[++at];
      if (next === 'n') out += '\n'; else if (next === 't') out += '\t'; else if (next === 'r') out += '\r';
      else if (next === 'u' && /^[0-9a-f]{4}$/i.test(source.slice(at + 1, at + 5))) { out += String.fromCharCode(parseInt(source.slice(at + 1, at + 5), 16)); at += 4; }
      else out += next ?? '';
    } else out += char;
  }
  return null;
}
function codeMode(source) {
  if (typeof source !== 'string' || !/\btools\s*(?:\.|\[)/.test(source)) return null;
  const commands = [], tools = [];
  let patch = null;
  const call = /\btools\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*["']([^"']+)["']\s*\])\s*\(/g;
  for (let match = call.exec(source); match; match = call.exec(source)) {
    const name = match[1] ?? match[2], after = source.slice(match.index + match[0].length, match.index + match[0].length + 400);
    tools.push(name);
    if (/^(?:exec_command|shell|shell_command|local_shell|write_stdin_never)$/.test(name)) {
      const key = /^\s*\{[^}]*?\b(?:cmd|command)\s*:\s*/.exec(after);
      const value = key ? literal(source, match.index + match[0].length + key[0].length) : null;
      if (value?.text.trim()) commands.push(value.text.replace(/\s+/g, ' ').trim().slice(0, 240));
    } else if (name === 'apply_patch' && patch === null) {
      const key = /^\s*(?:\{[^}]*?\binput\s*:\s*)?/.exec(after);
      const value = literal(source, match.index + match[0].length + (key?.[0].length ?? 0));
      if (value?.text.includes('*** Begin Patch')) patch = value.text;
    }
  }
  if (!tools.length) return null;
  const others = [...new Set(tools.filter(name => !/^(?:exec_command|shell|shell_command|local_shell)$/.test(name)))];
  const summary = commands.length ? commands[0] + (commands.length > 1 ? ' 等 ' + commands.length + ' 条' : '') : others.slice(0, 4).join('、');
  return { name: new Set(tools).size === 1 ? tools[0] : commands.length ? 'exec_command' : 'exec', summary, commands: commands.slice(0, 64), patch };
}

module.exports = { classify, slash, citations, codeMode };
