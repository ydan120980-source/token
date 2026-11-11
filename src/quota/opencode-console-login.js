'use strict';
// Fixed Console device flow verified against anomalyco/opencode 4d59657,
// packages/core/src/plugin/provider/opencode.ts (MIT). No config/model routes.
const https = require('node:https');
const ORIGIN = 'https://opencode.ai/console', CLIENT_ID = 'opencode-cli';
function consoleContext(value) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).join(',') === 'orgId' && typeof value.orgId === 'string' && /^(?:wrk_|org_)[A-Za-z0-9_-]{1,100}$/.test(value.orgId) ? { orgId: value.orgId } : undefined; }
function consoleAuthURL(value) { try { const url = new URL(value, ORIGIN + '/'); if (url.origin === 'https://opencode.ai' && !url.username && !url.password && url.pathname.startsWith('/console/') && typeof value === 'string' && value.length <= 16384) return url.href; } catch { /* Fixed own-site URL only. */ } throw Error('PROVIDER_LOGIN_FAILED'); }
const tokenValid = value => typeof value === 'string' && /^[\x21-\x7e]{8,16384}$/.test(value);
function consoleCredentials(token, orgId, now = Date.now()) {
  const context = consoleContext({ orgId });
  if (!context || !tokenValid(token.access_token) || !tokenValid(token.refresh_token) || !Number.isSafeInteger(token.expires_in) || token.expires_in < 1 || token.expires_in > 31 * 86400) throw Error('PROVIDER_RESPONSE_INVALID');
  const expiresAt = new Date(now + token.expires_in * 1000).toISOString();
  return { credential: token.access_token, expiresAt, context: { console: context, deviceGrant: true, oauth: { clientId: CLIENT_ID, refreshToken: token.refresh_token, expiresAt } } };
}
function requestConsole(operation, body, { signal, request = https.request, credential } = {}) {
  const route = { init: '/auth/device/code', poll: '/auth/device/token', orgs: '/api/orgs' }[operation];
  if (!route || operation === 'orgs' && !tokenValid(credential)) return Promise.reject(Error('PROVIDER_ACTION_INVALID'));
  if (signal.aborted) return Promise.reject(Error('PROVIDER_CANCELED'));
  return new Promise((resolve, reject) => {
    let req, response, done = false, bytes = 0; const chunks = [];
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); if (error) { req?.destroy(); response?.destroy(); reject(error); } else resolve(value); };
    const abort = () => finish(Error('PROVIDER_CANCELED')), timer = setTimeout(() => finish(Error('PROVIDER_TIMEOUT')), 15000), payload = operation === 'orgs' ? null : JSON.stringify(body);
    try { req = request(ORIGIN + route, { method: payload ? 'POST' : 'GET', headers: { Accept: 'application/json', 'User-Agent': 'AgentUsage-Quota/1', ...(credential ? { Authorization: 'Bearer ' + credential } : {}), ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) } }, incoming => {
      if (done) { incoming.destroy(); return; } response = incoming;
      const status = incoming.statusCode;
      if (status !== 200 && !(operation === 'poll' && status === 400)) { finish(Error(status === 401 ? 'PROVIDER_AUTH_REQUIRED' : status === 403 ? 'PROVIDER_ACCESS_DENIED' : status === 429 ? 'PROVIDER_RATE_LIMITED' : status >= 300 && status < 400 ? 'PROVIDER_REDIRECT_REJECTED' : 'PROVIDER_REQUEST_FAILED')); return; }
      incoming.on('data', chunk => { bytes += chunk.length; if (bytes > 524288) finish(Error('PROVIDER_OUTPUT_LIMIT')); else chunks.push(chunk); });
      incoming.on('error', () => finish(Error('PROVIDER_REQUEST_FAILED'))); incoming.on('aborted', () => finish(Error('PROVIDER_REQUEST_FAILED')));
      incoming.on('end', () => { if (done) return; try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(Error('PROVIDER_RESPONSE_INVALID')); } });
    }); } catch { finish(Error('PROVIDER_REQUEST_FAILED')); return; }
    req.on('error', () => finish(Error(signal.aborted ? 'PROVIDER_CANCELED' : 'PROVIDER_REQUEST_FAILED'))); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); if (!done) req.end(payload || undefined);
  });
}
function delay(ms, signal) { return new Promise((resolve, reject) => { const abort = () => { clearTimeout(timer); reject(Error('PROVIDER_CANCELED')); }, timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); }); }
async function loginConsole(signal, open, { send = requestConsole, sleep = delay, now = Date.now } = {}) {
  if (signal.aborted) throw Error('PROVIDER_CANCELED');
  const init = await send('init', { client_id: CLIENT_ID, supports_org_scope: true }, { signal });
  if (signal.aborted) throw Error('PROVIDER_CANCELED');
  if (!tokenValid(init?.device_code) || !Number.isFinite(init.expires_in) || init.expires_in <= 0 || !Number.isFinite(init.interval) || init.interval <= 0) throw Error('PROVIDER_RESPONSE_INVALID');
  const deadline = now() + Math.min(300000, init.expires_in * 1000); let interval = Math.min(30000, Math.max(1000, init.interval * 1000));
  await open(consoleAuthURL(init.verification_uri_complete));
  while (now() < deadline) {
    await sleep(Math.min(interval, deadline - now()), signal); if (signal.aborted) throw Error('PROVIDER_CANCELED'); if (now() >= deadline) break;
    const token = await send('poll', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: init.device_code, client_id: CLIENT_ID }, { signal });
    if (signal.aborted) throw Error('PROVIDER_CANCELED'); if (now() >= deadline) break;
    if (!token || typeof token !== 'object' || Array.isArray(token)) throw Error('PROVIDER_RESPONSE_INVALID');
    if (token.error === 'authorization_pending') continue;
    if (token.error === 'slow_down') { interval = Math.min(30000, interval + 5000); continue; }
    if (token.error) throw Error('PROVIDER_LOGIN_FAILED');
    if (token.org_id != null) return consoleCredentials(token, token.org_id, now());
    const orgs = await send('orgs', null, { signal, credential: token.access_token });
    if (!Array.isArray(orgs) || orgs.length > 100) throw Error('PROVIDER_RESPONSE_INVALID');
    if (orgs.length !== 1) throw Error('PROVIDER_ORGANIZATION_REQUIRED');
    if (signal.aborted) throw Error('PROVIDER_CANCELED'); return consoleCredentials(token, orgs[0].id, now());
  }
  throw Error('PROVIDER_LOGIN_TIMEOUT');
}
module.exports = { loginConsole, consoleContext, consoleAuthURL, consoleCredentials };
