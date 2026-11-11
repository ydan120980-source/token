'use strict';
// Device authorization protocol adapted from XDTrees/dsh-xdpool 2def4d0
// vendor/channel-pack (MIT; upstream iJetLi/deepseek-harness-codearts).
const https = require('node:https');
const { randomBytes, randomUUID } = require('node:crypto');
const ORIGIN = 'https://zcode.z.ai', VERSION = '3.14.3';
function zcodeContext(value) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === 'deviceMid,userId' && /^[a-f0-9-]{36}$/.test(value.deviceMid || '') && typeof value.userId === 'string' && /^[A-Za-z0-9._|@-]{1,256}$/.test(value.userId) ? { deviceMid: value.deviceMid, userId: value.userId } : undefined; }
function authURL(value) { try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password && !url.port && value.length <= 16384 && ['zcode.z.ai', 'open.bigmodel.cn', 'bigmodel.cn', 'z.ai', 'chat.z.ai'].includes(url.hostname)) return url.href; } catch { /* Untrusted response URL. */ } throw Error('PROVIDER_LOGIN_FAILED'); }
function requestJSON(operation, secret, body, { signal, request = https.request } = {}) {
  if (operation !== 'init' && !/^poll\/[A-Za-z0-9_-]{1,256}$/.test(operation) || typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) return Promise.reject(Error('PROVIDER_ACTION_INVALID'));
  if (signal?.aborted) return Promise.reject(Error('PROVIDER_CANCELED'));
  return new Promise((resolve, reject) => {
    let done = false, req, response, bytes = 0; const chunks = [];
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); if (error) { req?.destroy(); response?.destroy(); reject(error); } else resolve(value); };
    const abort = () => finish(Error('PROVIDER_CANCELED')), timer = setTimeout(() => finish(Error('PROVIDER_TIMEOUT')), 15000), payload = operation === 'init' ? JSON.stringify(body) : null;
    try { req = request(ORIGIN + '/api/v1/oauth/cli/' + operation, { method: payload ? 'POST' : 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + secret, 'User-Agent': 'ZCode/' + VERSION, 'X-ZCode-App-Version': VERSION, 'HTTP-Referer': ORIGIN, 'X-Platform': 'win32', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) } }, incoming => {
      if (done) { incoming.destroy(); return; }
      response = incoming;
      if (incoming.statusCode !== 200) { finish(Error(incoming.statusCode >= 300 && incoming.statusCode < 400 ? 'PROVIDER_REDIRECT_REJECTED' : incoming.statusCode === 429 ? 'PROVIDER_RATE_LIMITED' : incoming.statusCode === 401 || incoming.statusCode === 403 ? 'PROVIDER_AUTH_REQUIRED' : 'PROVIDER_REQUEST_FAILED')); return; }
      incoming.on('data', chunk => { bytes += chunk.length; if (bytes > 524288) finish(Error('PROVIDER_OUTPUT_LIMIT')); else chunks.push(chunk); });
      incoming.on('error', () => finish(Error('PROVIDER_REQUEST_FAILED'))); incoming.on('aborted', () => finish(Error('PROVIDER_REQUEST_FAILED')));
      incoming.on('end', () => { if (done) return; try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(Error('PROVIDER_RESPONSE_INVALID')); } });
    }); } catch { finish(Error('PROVIDER_REQUEST_FAILED')); return; }
    req.on('error', () => finish(Error(signal?.aborted ? 'PROVIDER_CANCELED' : 'PROVIDER_REQUEST_FAILED'))); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    if (payload) req.end(payload); else req.end();
  });
}
function delay(ms, signal) { return new Promise((resolve, reject) => { const abort = () => { clearTimeout(timer); reject(Error('PROVIDER_CANCELED')); }, timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); }); }
async function loginZcode(signal, open, { send = requestJSON, sleep = delay, now = Date.now } = {}) {
  const stageRequest = async (operation, ...args) => { try { return await send(operation, ...args); } catch (error) { if (error.message === 'PROVIDER_REQUEST_FAILED') throw Error(operation === 'init' ? 'PROVIDER_ZCODE_INIT_FAILED' : 'PROVIDER_ZCODE_POLL_FAILED', { cause: error }); throw error; } };
  if (signal.aborted) throw Error('PROVIDER_CANCELED'); const secret = randomBytes(32).toString('hex'), init = await stageRequest('init', secret, { provider: 'bigmodel' }, { signal }), flow = init?.data;
  if (init?.code !== 0 || !/^[A-Za-z0-9_-]{1,256}$/.test(flow?.flow_id || '')) throw Error('PROVIDER_RESPONSE_INVALID');
  const url = authURL(flow.authorize_url), expires = typeof flow.expires_at === 'number' && Number.isFinite(flow.expires_at) ? flow.expires_at * 1000 : now() + 300000, deadline = Math.min(now() + 300000, expires);
  if (deadline <= now()) throw Error('PROVIDER_LOGIN_TIMEOUT');
  if (signal.aborted) throw Error('PROVIDER_CANCELED'); await open(url);
  const interval = typeof flow.poll_interval_sec === 'number' && Number.isFinite(flow.poll_interval_sec) ? Math.min(10000, Math.max(1000, flow.poll_interval_sec * 1000)) : 2000;
  while (now() < deadline) {
    await sleep(Math.min(interval, deadline - now()), signal); if (signal.aborted) throw Error('PROVIDER_CANCELED'); if (now() >= deadline) break;
    const result = await stageRequest('poll/' + flow.flow_id, secret, null, { signal });
    if (result?.code !== 0 || !result.data) throw Error('PROVIDER_RESPONSE_INVALID');
    if (result.data.status === 'pending') continue;
    if (result.data.status === 'failed') throw Error('PROVIDER_LOGIN_FAILED');
    const data = result.data, userId = data.user?.user_id || data.user?.id;
    if (data.status !== 'ready' || typeof data.token !== 'string' || !/^[A-Za-z0-9_.-]{8,16384}$/.test(data.token) || !zcodeContext({ userId, deviceMid: '11111111-2222-4333-8444-555555555555' })) throw Error('PROVIDER_RESPONSE_INVALID');
    if (signal.aborted) throw Error('PROVIDER_CANCELED');
    let expiresAt = null; try { const exp = JSON.parse(Buffer.from(data.token.split('.')[1], 'base64url')).exp; if (Number.isSafeInteger(exp) && exp > 0 && exp < 8640000000000) { if (exp * 1000 <= now()) throw Error('PROVIDER_AUTH_REQUIRED'); expiresAt = new Date(exp * 1000).toISOString(); } } catch (error) { if (error.message === 'PROVIDER_AUTH_REQUIRED') throw error; }
    return { credential: data.token, expiresAt, context: { zcode: { userId, deviceMid: randomUUID() } } };
  }
  throw Error('PROVIDER_LOGIN_TIMEOUT');
}
module.exports = { loginZcode, zcodeContext, requestJSON, authURL, VERSION };
