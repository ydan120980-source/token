'use strict';
const https = require('node:https');
const { routes } = require('./provider-catalog');
const { normalizeCredential } = require('./provider-credentials');
const { quotaJSON } = require('./quota-json');
function credential(value) { return typeof value === 'string' && value.length >= 8 && value.length <= 16384 && !/[\x00-\x20\x7f-\uffff]/.test(value); }
const validProject = value => typeof value === 'string' && /^[a-z][a-z0-9-]{4,98}[a-z0-9]$/.test(value);
function readProvider(adapter, token, { signal, project, part, organization, pageNumber, workbuddyAt = Date.now(), get = https.get, post = https.request, timeoutMs = 15000 } = {}) {
  token = normalizeCredential(adapter, token);
  if (!Object.hasOwn(routes, adapter) || !routes[adapter].url || !token) return Promise.reject(new Error('PROVIDER_CREDENTIAL_REQUIRED'));
  if (part !== undefined && !Object.hasOwn(routes[adapter].extra || {}, part)) return Promise.reject(new Error('PROVIDER_ACTION_INVALID'));
  if (pageNumber !== undefined && (adapter !== 'workbuddy-desktop' || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 10) || adapter === 'workbuddy-desktop' && (!Number.isSafeInteger(workbuddyAt) || workbuddyAt < 0 || workbuddyAt > 8000000000000000)) return Promise.reject(new Error('PROVIDER_ACTION_INVALID'));
  if (organization !== undefined && (adapter !== 'claude-web' || !/^[a-f0-9-]{36}$/i.test(organization))) return Promise.reject(new Error('PROVIDER_ACTION_INVALID'));
  if (adapter === 'opencode-web' && part && !/^(?:wrk_|org_)[A-Za-z0-9_-]{1,100}$/.test(project?.workspace || '')) return Promise.reject(new Error('PROVIDER_ACTION_INVALID'));
  if (adapter === 'workbuddy-web' && (typeof project?.userAgent !== 'string' || !project.userAgent.length || project.userAgent.length > 512 || /[^\x20-\x7e]/.test(project.userAgent))) return Promise.reject(new Error('PROVIDER_ACTION_INVALID'));
  if (adapter === 'workbuddy-desktop' && !require('./workbuddy-client').desktopContext(project?.desktop)) return Promise.reject(new Error('PROVIDER_ACTION_INVALID'));
  if (adapter === 'zcode-device' && !require('./zcode-login').zcodeContext(project?.zcode)) return Promise.reject(new Error('PROVIDER_ACTION_INVALID'));
  if (adapter === 'opencode-zen' && !require('./opencode-console-login').consoleContext(project?.console)) return Promise.reject(new Error('PROVIDER_ACTION_INVALID'));
  if (signal?.aborted) return Promise.reject(new Error('PROVIDER_CANCELED'));
  if (routes[adapter].kind === 'google-internal' && !validProject(project) && !(project?.discover === true || part === 'bootstrap')) return Promise.reject(new Error('PROVIDER_ACTION_INVALID'));
  return new Promise((resolve, reject) => {
    let settled = false, response, bytes = 0; const chunks = [];
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); if (error) { request.destroy(); response?.destroy(); reject(error); } else resolve(value); };
    const abort = () => finish(new Error('PROVIDER_CANCELED'));
    // Fixed quota capability: no caller URLs, ambient cookies, proxy env, redirects or
    // response bodies in errors. Credentials never cross to another host.
    const fmt = date => { const p = value => String(value).padStart(2, '0'); return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`; };
    const desktopBody = adapter === 'workbuddy-desktop' ? { PageNumber: pageNumber ?? 1, PageSize: 100, ProductCode: 'p_tcaca', Status: [0, 3], PackageEndTimeRangeBegin: fmt(new Date(workbuddyAt)), PackageEndTimeRangeEnd: fmt(new Date(workbuddyAt + 365 * 101 * 86400000)) } : null;
    const desktopHeaders = adapter === 'workbuddy-desktop' ? { 'X-User-Id': project.desktop.uid, ...(project.desktop.domain ? { 'X-Domain': project.desktop.domain } : {}), ...(project.desktop.enterpriseId ? { 'X-Enterprise-Id': project.desktop.enterpriseId, 'X-Tenant-Id': project.desktop.enterpriseId } : {}) } : {};
    if (adapter === 'opencode-zen') desktopHeaders['x-org-id'] = project.console.orgId;
    if (adapter === 'zcode-device') Object.assign(desktopHeaders, { 'X-Device-Mid': project.zcode.deviceMid, 'X-ZCode-App-Version': require('./zcode-login').VERSION, 'HTTP-Referer': 'https://zcode.z.ai', 'X-Platform': 'win32', 'X-Os-Category': 'windows' });
    const body = routes[adapter].method === 'POST' ? JSON.stringify(desktopBody || (adapter === 'workbuddy-web' ? {} : part === 'bootstrap' ? { metadata: { ideType: 'GEMINI_CLI', pluginType: 'GEMINI' } } : typeof project === 'string' ? { project } : {})) : null;
    const url = organization ? 'https://claude.ai/api/organizations/' + organization + '/usage' : part ? routes[adapter].extra[part] : routes[adapter].url;
    const request = (body ? post : get)(url, { method: body ? 'POST' : 'GET', headers: { Accept: 'application/json', ...desktopHeaders, ...(routes[adapter].kind === 'cookie' ? { Cookie: token } : { Authorization: 'Bearer ' + token }), 'User-Agent': adapter === 'workbuddy-web' ? project.userAgent : adapter === 'zcode-device' ? 'ZCode/' + require('./zcode-login').VERSION : 'AgentUsage-Quota/1', ...(adapter === 'workbuddy-web' ? { Origin: 'https://www.workbuddy.cn', Referer: 'https://www.workbuddy.cn/profile/plans-usage' } : {}), ...(adapter === 'claude-oauth' ? { 'anthropic-beta': 'oauth-2025-04-20' } : {}), ...(adapter === 'deepseek-web' ? { 'x-client-platform': 'web' } : {}), ...(adapter === 'opencode-web' && part ? { 'x-org-id': project.workspace } : {}), ...(adapter === 'gemini-web' ? { Referer: 'https://gemini.google.com/usage' } : {}), ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) } }, incoming => {
      if (settled) { incoming.destroy(); return; }
      response = incoming;
      const status = incoming.statusCode;
      if (status !== 200) { finish(new Error(status === 401 ? 'PROVIDER_AUTH_REQUIRED' : status === 403 ? 'PROVIDER_ACCESS_DENIED' : status === 429 ? 'PROVIDER_RATE_LIMITED' : status >= 300 && status < 400 ? 'PROVIDER_REDIRECT_REJECTED' : 'PROVIDER_REQUEST_FAILED')); return; }
      incoming.on('data', chunk => { bytes += chunk.length; if (bytes > 512 * 1024) finish(new Error('PROVIDER_OUTPUT_LIMIT')); else chunks.push(chunk); });
      incoming.on('aborted', () => finish(new Error('PROVIDER_REQUEST_FAILED'))); incoming.on('error', () => finish(new Error('PROVIDER_REQUEST_FAILED')));
      incoming.on('end', () => { if (settled) return; try { const text = Buffer.concat(chunks).toString('utf8'); finish(null, quotaJSON(adapter === 'gemini-web' ? text.trim().replace(/^\)\]\}'\s*/, '') : text)); } catch { finish(new Error('PROVIDER_RESPONSE_INVALID')); } });
    });
    const timer = setTimeout(() => finish(new Error('PROVIDER_TIMEOUT')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true }); request.on('error', () => finish(new Error(signal?.aborted ? 'PROVIDER_CANCELED' : 'PROVIDER_REQUEST_FAILED')));
    if (signal?.aborted) abort();
    if (body && !settled) request.end(body);
  });
}
module.exports = { readProvider, credential, validProject };
