'use strict';
const syntax = require('./config-health-syntax');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const has = (value, key) => Object.hasOwn(value, key);
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
const stringMap = value => object(value) && Object.values(value).every(item => typeof item === 'string');
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const dynamic = value => typeof value === 'string' && /\$\{|\$\(|%[A-Za-z_][A-Za-z0-9_]*%|\{file:/.test(value);
const EVENTS = Object.freeze({ codex: new Set(['SessionStart','SessionEnd','SubagentStart','SubagentStop','UserPromptSubmit','PreToolUse','PermissionRequest','PostToolUse','PreCompact','PostCompact','Stop','Interrupt']), claude: new Set(['SessionStart','SessionEnd','UserPromptSubmit','UserPromptExpansion','PreToolUse','PermissionRequest','PermissionDenied','PostToolUse','PostToolUseFailure','PostToolBatch','Notification','SubagentStart','SubagentStop','Stop','StopFailure','PreCompact','PostCompact','TeammateIdle','TaskCreated','TaskCompleted','ConfigChange','InstructionsLoaded','WorktreeCreate','WorktreeRemove','Elicitation','ElicitationResult','Setup','CwdChanged','FileChanged','DirectoryAdded','MessageDisplay','PreModelSwitch','PostModelSwitch']) });
const MODEL_EVENTS = new Set(['PermissionDenied','PostToolBatch','PostToolUse','PostToolUseFailure','PreToolUse','Stop','SubagentStop','TaskCompleted','TaskCreated','TeammateIdle','UserPromptExpansion','UserPromptSubmit']);
const TOOL_EVENTS = new Set(['PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','PermissionDenied']);
const row = (kind, state = 'static-ok', reason = 'STRUCTURE_ONLY', extra = {}) => ({ kind, state, reason, ...extra });
function diagnostic(kind, extra) {
  const check = row(kind, 'static-ok', 'STRUCTURE_ONLY', extra), rank = { 'static-ok': 0, unchecked: 1, issue: 2 };
  return { check, mark(state, reason) { if (rank[state] > rank[check.state]) Object.assign(check, { state, reason }); } };
}
function endpoint(value, mark) {
  if (!text(value)) { mark('issue', 'URL_TYPE'); return; }
  if (dynamic(value)) { mark('unchecked', 'DYNAMIC_REFERENCE_UNCHECKED'); return; }
  try { if (!['http:', 'https:'].includes(new URL(value).protocol)) throw Error(); }
  catch { mark('issue', 'URL_TYPE'); }
}
function mcp(value, agent) {
  const section = agent === 'codex' ? 'mcp_servers' : 'mcpServers';
  if (!object(value)) return [row('mcp', 'issue', 'MAP_REQUIRED', { location: { section } })];
  const result = [];
  for (const [index, item] of Object.values(value).slice(0, 64).entries()) {
    const location = { section, entry: index + 1 };
    if (!object(item)) { result.push(row('mcp', 'issue', 'ENTRY_REQUIRED', { location })); continue; }
    const { check, mark } = diagnostic('mcp', { location, enabled: typeof item.enabled === 'boolean' ? item.enabled : null, argsCount: Array.isArray(item.args) ? item.args.length : 0, environmentPresent: has(item, 'env'), headersPresent: ['headers','http_headers','env_http_headers'].some(key => has(item, key)), transport: 'unknown', executableCheck: 'unchecked' });
    for (const key of ['enabled', ...(agent === 'codex' ? ['required'] : [])]) if (has(item, key) && typeof item[key] !== 'boolean') mark('issue', 'FIELD_TYPE');
    if (has(item, 'args') && !strings(item.args) || has(item, 'env') && !stringMap(item.env)) mark('issue', 'FIELD_TYPE');
    for (const key of ['headers','http_headers','env_http_headers']) if (has(item, key) && !stringMap(item[key])) mark('issue', 'FIELD_TYPE');
    for (const key of agent === 'codex' ? ['startup_timeout_sec','startup_timeout_ms','tool_timeout_sec'] : ['timeout']) if (has(item, key) && !finite(item[key])) mark('issue', 'FIELD_TYPE');
    if (agent === 'codex') {
      for (const key of ['enabled_tools','disabled_tools','scopes']) if (has(item, key) && !strings(item[key])) mark('issue', 'FIELD_TYPE');
      if (has(item, 'cwd') && typeof item.cwd !== 'string') mark('issue', 'FIELD_TYPE');
      if (has(item, 'env_vars') && (!Array.isArray(item.env_vars) || !item.env_vars.every(entry => typeof entry === 'string' || object(entry) && text(entry.name) && ['local','remote'].includes(entry.source)))) mark('issue', 'FIELD_TYPE');
      if (has(item, 'startup_timeout_sec') && has(item, 'startup_timeout_ms')) mark('unchecked', 'TIMEOUT_ALIAS_UNCHECKED');
    }
    const helper = agent === 'codex' ? 'http_headers_helper' : 'headersHelper';
    if (has(item, helper)) { if (!text(item[helper])) mark('issue', 'FIELD_TYPE'); else mark('unchecked', 'DYNAMIC_HELPER_UNCHECKED'); }
    if (has(item, 'command') && has(item, 'url')) mark('issue', 'TRANSPORT_CONFLICT');
    else if (has(item, 'url')) {
      check.transport = 'remote'; check.executableCheck = 'not-applicable';
      // Unknown transports may use other schemes. Do not apply HTTP rules to them.
      if (agent === 'claude' && !['http','sse'].includes(item.type)) {
        mark(has(item, 'type') ? 'unchecked' : 'issue', 'TRANSPORT_UNCONFIRMED');
        if (!text(item.url)) mark('issue', 'URL_TYPE');
      } else endpoint(item.url, mark);
    } else if (has(item, 'command')) {
      check.transport = 'stdio';
      if (!text(item.command)) mark('issue', 'COMMAND_REQUIRED');
      else if (/[\r\n;&|<>`$%{}]/.test(item.command) || /^\s|\s$/.test(item.command) || !/^(?:[^\s"']+|[A-Za-z]:[\\/][^"']+)$/.test(item.command)) mark('unchecked', 'COMMAND_UNCHECKED');
      if (agent === 'claude' && has(item, 'type') && item.type !== 'stdio') mark('unchecked', 'TRANSPORT_UNCONFIRMED');
    } else mark('issue', 'TRANSPORT_REQUIRED');
    result.push(check);
  }
  if (Object.keys(value).length > 64) result.push(row('mcp', 'unchecked', 'ENTRY_LIMIT', { location: { section }, omitted: Object.keys(value).length - 64 }));
  return result.length ? result : [row('mcp', 'static-ok', 'NO_ENTRIES', { location: { section } })];
}
function hooks(value, agent) {
  if (!object(value)) return [row('hooks', 'issue', 'MAP_REQUIRED', { location: { section: 'hooks' } })];
  const result = []; let total = 0;
  for (const [eventIndex, [event, groups]] of Object.entries(value).entries()) {
    const eventLocation = { section: 'hooks', event: eventIndex + 1 }, knownEvent = EVENTS[agent].has(event);
    if (++total > 64) { result.push(row('hooks', 'unchecked', 'ENTRY_LIMIT', { location: eventLocation })); break; }
    if (!Array.isArray(groups)) { result.push(row('hooks', 'issue', 'GROUP_ARRAY_REQUIRED', { location: eventLocation })); continue; }
    if (!knownEvent && !groups.length) result.push(row('hooks', 'unchecked', 'EVENT_UNCONFIRMED', { location: eventLocation }));
    for (const [groupIndex, group] of groups.entries()) {
      const groupLocation = { ...eventLocation, group: groupIndex + 1 };
      if (++total > 128) { result.push(row('hooks', 'unchecked', 'ENTRY_LIMIT', { location: groupLocation })); return result; }
      if (!object(group) || !Array.isArray(group.hooks) || has(group, 'matcher') && typeof group.matcher !== 'string') { result.push(row('hooks', 'issue', 'GROUP_REQUIRED', { location: groupLocation })); continue; }
      if (!knownEvent && !group.hooks.length) result.push(row('hooks', 'unchecked', 'EVENT_UNCONFIRMED', { location: groupLocation }));
      for (const [handlerIndex, handler] of group.hooks.entries()) {
        const location = { ...groupLocation, handler: handlerIndex + 1 };
        if (++total > 128) { result.push(row('hooks', 'unchecked', 'ENTRY_LIMIT', { location })); return result; }
        if (!object(handler)) { result.push(row('hooks', 'issue', 'HANDLER_REQUIRED', { location })); continue; }
        const type = ['command','http','mcp_tool','prompt','agent'].includes(handler.type) ? handler.type : 'unknown';
        const { check, mark } = diagnostic('hooks', { location, handlerType: type, executed: false });
        if (!knownEvent) mark('unchecked', 'EVENT_UNCONFIRMED');
        if (has(handler, 'timeout') && (!finite(handler.timeout) || handler.timeout === 0) || has(handler, 'async') && typeof handler.async !== 'boolean' || has(handler, 'statusMessage') && typeof handler.statusMessage !== 'string') mark('issue', 'FIELD_TYPE');
        if (agent === 'codex' && has(handler, 'additionalContextLimit') && (!Number.isSafeInteger(handler.additionalContextLimit) || handler.additionalContextLimit < 0)) mark('issue', 'FIELD_TYPE');
        if (knownEvent && agent === 'codex' && type === 'mcp_tool' && event === 'SessionEnd') mark('issue', 'EVENT_HANDLER_UNSUPPORTED');
        if (knownEvent && agent === 'claude') {
          if (['prompt','agent'].includes(type) && !MODEL_EVENTS.has(event) && !(event === 'PermissionRequest' && type === 'prompt') || type === 'http' && ['SessionStart','Setup'].includes(event)) mark('issue', 'EVENT_HANDLER_UNSUPPORTED');
          if (type === 'mcp_tool' && event === 'Setup') mark('issue', 'MCP_SETUP_UNAVAILABLE');
          else if (type === 'mcp_tool' && event === 'SessionStart') mark('unchecked', 'MCP_STARTUP_CONTEXT_UNCHECKED');
        }
        if (handler.async === true && type !== 'command') mark('unchecked', 'ASYNC_COMMAND_ONLY');
        if (agent === 'codex' && event === 'SessionEnd' && type === 'command' && handler.async === true) mark('unchecked', 'SESSION_END_FORCED_SYNC');
        if (agent === 'claude') {
          for (const key of ['asyncRewake','once']) if (has(handler, key) && typeof handler[key] !== 'boolean') mark('issue', 'FIELD_TYPE');
          if (handler.asyncRewake === true && type !== 'command') mark('unchecked', 'ASYNC_COMMAND_ONLY');
          if (handler.once === true) mark('unchecked', 'ONCE_IGNORED_IN_SETTINGS');
          if (has(handler, 'if')) {
            if (!text(handler.if)) mark('issue', 'FIELD_TYPE');
            else if (knownEvent && !TOOL_EVENTS.has(event)) mark('issue', 'CONDITION_EVENT_UNSUPPORTED');
            else mark('unchecked', 'CONDITION_UNCHECKED');
          }
        }
        if (type === 'unknown' || agent === 'codex' && ['http','prompt','agent'].includes(type)) mark('unchecked', 'HANDLER_UNCONFIRMED');
        if (type === 'command') {
          const keys = agent === 'codex' ? ['command','commandWindows','command_windows'] : ['command'];
          if (!keys.some(key => text(handler[key]))) mark('issue', 'HANDLER_VALUE_REQUIRED');
          if (keys.some(key => has(handler, key) && typeof handler[key] !== 'string')) mark('issue', 'FIELD_TYPE');
          if (agent === 'claude' && has(handler, 'args') && !strings(handler.args)) mark('issue', 'FIELD_TYPE');
        } else if (['prompt','agent'].includes(type)) {
          if (!text(handler.prompt)) mark('issue', 'HANDLER_VALUE_REQUIRED');
          if (agent === 'claude' && has(handler, 'model') && typeof handler.model !== 'string') mark('issue', 'FIELD_TYPE');
        }
        else if (type === 'http' && agent === 'claude') {
          endpoint(handler.url, mark);
          if (has(handler, 'headers') && !stringMap(handler.headers) || has(handler, 'allowedEnvVars') && !strings(handler.allowedEnvVars)) mark('issue', 'FIELD_TYPE');
        } else if (type === 'mcp_tool') {
          if (!text(handler.server) || !text(handler.tool)) mark('issue', 'HANDLER_VALUE_REQUIRED');
          if (has(handler, 'input') && !object(handler.input)) mark('issue', 'FIELD_TYPE');
          mark('unchecked', 'MCP_RUNTIME_UNCHECKED');
        }
        result.push(check);
      }
    }
  }
  return result.length ? result : [row('hooks', 'static-ok', 'NO_ENTRIES', { location: { section: 'hooks' } })];
}
function skill(value, agent) {
  const namePresent = has(value, 'name'), descriptionPresent = has(value, 'description');
  const { check, mark } = diagnostic('skills', { location: { section: 'frontmatter' }, namePresent, descriptionPresent }); check.reason = 'FRONTMATTER_ONLY';
  if (namePresent && !text(value.name) || descriptionPresent && !text(value.description)) mark('issue', 'FIELD_TYPE');
  if (agent === 'codex' && (!namePresent || !descriptionPresent)) mark('issue', 'SKILL_FIELD_REQUIRED');
  if (agent === 'claude') {
    for (const key of ['disable-model-invocation','user-invocable']) if (has(value, key) && typeof value[key] !== 'boolean') {
      // Documented aliases/coercions vary with the installed client version.
      if ([0,1].includes(value[key]) || typeof value[key] === 'string' && /^(?:true|false|yes|no|on|off|0|1)$/i.test(value[key])) mark('unchecked', 'BOOLEAN_COERCION_UNCHECKED');
      else mark('issue', 'FIELD_TYPE');
    }
    if (has(value, 'allowed-tools') && !(typeof value['allowed-tools'] === 'string' || strings(value['allowed-tools']))) mark('issue', 'FIELD_TYPE');
    for (const key of ['argument-hint','when_to_use','agent','model']) if (has(value, key) && typeof value[key] !== 'string') mark('issue', 'FIELD_TYPE');
    if (has(value, 'context')) { if (typeof value.context !== 'string') mark('issue', 'FIELD_TYPE'); else if (value.context !== 'fork') mark('unchecked', 'CONTEXT_UNCONFIRMED'); }
  }
  return [check];
}
function hookSwitches(value, agent, kind) {
  const result = [];
  if (agent === 'claude' && kind !== 'claude-mcp' && has(value, 'disableAllHooks')) {
    const disabled = value.disableAllHooks, location = { section: 'disableAllHooks' };
    result.push(typeof disabled !== 'boolean' ? row('hooks', 'issue', 'FIELD_TYPE', { location }) : row('hooks', disabled ? 'unchecked' : 'static-ok', disabled ? 'HOOKS_DISABLED_IN_FILE' : 'STRUCTURE_ONLY', { location, configuredEnabled: !disabled }));
  }
  if (kind === 'codex-config' && has(value, 'features')) {
    if (!object(value.features)) result.push(row('hooks', 'issue', 'FIELD_TYPE', { location: { section: 'features' } }));
    else for (const key of ['hooks','codex_hooks']) if (has(value.features, key)) {
      const enabled = value.features[key], location = { section: 'features.' + key };
      const reason = !enabled ? 'HOOKS_DISABLED_IN_FILE' : key === 'codex_hooks' ? 'HOOKS_ALIAS_UNCHECKED' : has(value.features, 'codex_hooks') ? 'HOOKS_PRECEDENCE_UNCHECKED' : 'STRUCTURE_ONLY';
      result.push(typeof enabled !== 'boolean' ? row('hooks', 'issue', 'FIELD_TYPE', { location }) : row('hooks', reason === 'STRUCTURE_ONLY' ? 'static-ok' : 'unchecked', reason, { location, configuredEnabled: enabled }));
    }
  }
  return result;
}
function project(agent, kind, source, observeSkill = () => {}) {
  try {
    const value = kind === 'codex-config' ? syntax.toml(source) : kind === 'skill' ? syntax.frontmatter(source) : syntax.json(source);
    if (!object(value)) return [row('file', 'issue', 'ROOT_OBJECT_REQUIRED')];
    if (kind === 'skill') { const result = skill(value, agent); if (text(value.name)) observeSkill(value.name, result[0]); return result; }
    const result = hookSwitches(value, agent, kind);
    if (kind === 'codex-config' || kind === 'claude-mcp') { const key = agent === 'codex' ? 'mcp_servers' : 'mcpServers'; result.push(...(has(value, key) ? mcp(value[key], agent) : [row('mcp', 'static-ok', 'NO_ENTRIES')])); }
    if (kind !== 'claude-mcp') result.push(...(has(value, 'hooks') ? hooks(value.hooks, agent) : [row('hooks', 'static-ok', 'NO_ENTRIES')]));
    if (kind === 'codex-config' && has(value, 'skills')) {
      const location = { section: 'skills.config' };
      if (!object(value.skills) || has(value.skills, 'config') && !Array.isArray(value.skills.config)) result.push(row('skill-overrides', 'issue', 'FIELD_TYPE', { location }));
      else if (!value.skills.config?.length) result.push(row('skill-overrides', 'unchecked', 'REFERENCES_NOT_FOLLOWED', { location, count: 0 }));
      else {
        for (const [index, item] of value.skills.config.slice(0, 64).entries()) {
          const valid = object(item) && text(item.path) && (!has(item, 'enabled') || typeof item.enabled === 'boolean');
          result.push(row('skill-overrides', valid ? 'unchecked' : 'issue', valid ? 'REFERENCES_NOT_FOLLOWED' : 'FIELD_TYPE', { location: { ...location, entry: index + 1 } }));
        }
        if (value.skills.config.length > 64) result.push(row('skill-overrides', 'unchecked', 'ENTRY_LIMIT', { location, omitted: value.skills.config.length - 64 }));
      }
    }
    return result;
  } catch (error) { return [row('file', 'unchecked', ['DUPLICATE_KEY','PARSE_LIMIT'].includes(error.message) ? error.message : 'PARSE_UNSUPPORTED')]; }
}
module.exports = { project };
