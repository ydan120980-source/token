'use strict';
// One catalogue for collection, billing and the desktop controls. Quota is a
// separate capability; a local usage adapter does not imply account access.
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.agentCatalog = factory();
})(typeof window === 'undefined' ? this : window, function() {
  const definitions = [
    ['codex', 'Codex', 'Codex Desktop / CLI', '会话日志 · Desktop / CLI'],
    ['claude', 'Claude Code', 'Claude Code', '项目会话 · assistant 用量'],
    ['opencode', 'OpenCode', 'OpenCode', 'SQLite 或历史 message JSON'],
    ['workbuddy', 'WorkBuddy', 'WorkBuddy', '会话明细优先 · 数据库总量作为补充'],
    ['mimo', 'MiMo Code', 'MiMo Code / Desktop', 'SQLite · CLI / Desktop'],
    ['gemini', 'Gemini CLI', 'Gemini CLI', '本地 chats · JSON / JSONL'],
    ['cursor', 'Cursor', 'Cursor SDK / 用量导出', '自动读取 SDK index.db；也可选择 runs.ndjson 或逐请求 CSV。普通聊天记录未提供用量时无法计量'],
    ['zcode', 'ZCode', 'ZCode', '本地 model_usage · 每次模型调用'],
    ['deepseek', 'DeepSeek Harness', 'DeepSeek Harness', '本地会话 · JSONL / Zstandard · v2–v4']
  ];
  const agents = Object.freeze(Object.fromEntries(definitions.map(([id, name, label, hint]) => [id, Object.freeze({name, label, hint, icon:'agents/' + id, quota:id === 'codex'})])));
  return Object.freeze({agents, sources:Object.freeze(Object.keys(agents)), labels:Object.freeze(Object.fromEntries(Object.entries(agents).map(([id,a]) => [id,a.label])))});
});
