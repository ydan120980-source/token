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
    ['deepseek', 'DeepSeek Harness', 'DeepSeek Harness', '本地会话 · JSONL / Zstandard · v2–v4'],
    ['antigravity', 'Antigravity', 'Antigravity', '对话记录 · 用量来自 transcript，模型来自对话库'],
    ['copilot', 'GitHub Copilot', 'GitHub Copilot CLI', '本地 session-state · 可选 OTel 调用记录'],
    ['cline', 'Cline', 'Cline IDE / CLI', '任务调用用量 · IDE / CLI'],
    ['pi', 'Pi', 'Pi coding agent', 'v3 会话 JSONL · assistant 用量'],
    ['continue', 'Continue', 'Continue', '本地 devdata.sqlite · 客户端估算用量'],
    ['kilo', 'Kilo Code', 'Kilo Code IDE / CLI', '任务用量 · IDE / CLI 数据库'],
    ['qwen', 'Qwen Code', 'Qwen Code', '本地 chats JSONL · usageMetadata'],
    ['kimi', 'Kimi', 'Kimi CLI / Code', '本地 wire JSONL · 逐调用用量']
  ];
  const usageOnly = new Set(['copilot','cline','pi','continue','kilo','qwen','kimi']);
  const agents = Object.fromEntries(definitions.map(([id, name, label, hint]) => [id, Object.freeze({name, label, hint, icon:'agents/' + id, quota:id === 'codex', ...(usageOnly.has(id) ? {usageOnly:true} : {})})]));
  function install(catalog) {
    if(!catalog || typeof catalog !== 'object')return;
    let changed=false;
    for(const [id,meta] of Object.entries(catalog)) if(/^custom-[a-f0-9-]{36}$/.test(id) && typeof meta.name==='string' && meta.name.length<=80) {const next={name:meta.name,label:meta.name,hint:meta.archived?'已移除 · 历史统计保留':'自定义 JSONL · 逐请求用量',icon:'ui/layout-grid',quota:false,custom:true,archived:meta.archived===true};if(JSON.stringify(agents[id])!==JSON.stringify(next)){agents[id]=Object.freeze(next);changed=true;}}
    if(changed && typeof window!=='undefined')window.dispatchEvent(new Event('source-catalog'));
  }
  if(typeof window!=='undefined')install(window.previewUsage?.sourceCatalog);
  return Object.freeze({agents,install,get sources(){return Object.freeze(Object.keys(agents));},get labels(){return Object.freeze(Object.fromEntries(Object.entries(agents).map(([id,a])=>[id,a.label])));}});
});
