'use strict';
const crypto = require('node:crypto');
const builtin = require('./agent-catalog');
const CUSTOM_ID = /^custom-[a-f0-9-]{36}$/;
function catalog(state) {
  const agents = {...builtin.agents};
  for (const [id, source] of Object.entries(state.customSources || {})) if (CUSTOM_ID.test(id)) agents[id] = {name:source.name, label:source.name, hint:source.archived ? '已移除 · 历史统计保留' : '自定义 JSONL · 逐请求用量', icon:'ui/layout-grid', quota:false, custom:true, archived:Boolean(source.archived)};
  return agents;
}
function revision(agents) { return crypto.createHash('sha256').update(JSON.stringify(agents)).digest('hex'); }
module.exports = {catalog, revision, CUSTOM_ID};
