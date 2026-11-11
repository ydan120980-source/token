'use strict';
const https = require('node:https');
const { normalizeCredential } = require('./provider-credentials');
// OAuth renewal is distinct from quota GET. Only app-owned official CLI grants
// enter here; imported external CLI refresh tokens are never copied or rotated.
function renewOAuth(adapter, refreshToken, grant, { signal, post = https.request, timeoutMs = 15000 } = {}) {
  const url = { 'claude-oauth': 'https://platform.claude.com/v1/oauth/token', 'gemini-code-assist': 'https://oauth2.googleapis.com/token', 'opencode-zen': 'https://opencode.ai/console/auth/device/token' }[adapter];
  if (!url || !normalizeCredential(adapter, refreshToken) || !grant || typeof grant.clientId !== 'string' || !/^[A-Za-z0-9_.:-]{8,256}$/.test(grant.clientId) || grant.clientSecret !== undefined && (typeof grant.clientSecret !== 'string' || !/^[\x21-\x7e]{8,256}$/.test(grant.clientSecret))) return Promise.reject(new Error('PROVIDER_ACTION_INVALID'));
  if (signal?.aborted) return Promise.reject(new Error('PROVIDER_CANCELED'));
  if (adapter === 'opencode-zen' && (grant.clientId !== 'opencode-cli' || !require('./opencode-console-login').consoleContext({ orgId: grant.orgId }))) return Promise.reject(Error('PROVIDER_ACTION_INVALID'));
  return new Promise((resolve, reject) => {
    let timer, request, response, finished = false, bytes = 0; const chunks = [];
    const finish = (error, value) => { if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); if (error) { request?.destroy(); response?.destroy(); reject(error); } else resolve(value); };
    const abort = () => finish(new Error('PROVIDER_CANCELED'));
    const fields = { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: grant.clientId, ...(grant.clientSecret ? { client_secret: grant.clientSecret } : {}) }, body = adapter === 'opencode-zen' ? JSON.stringify(fields) : new URLSearchParams(fields).toString();
    request = post(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': adapter === 'opencode-zen' ? 'application/json' : 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'AgentUsage-Quota/1' } }, incoming => {
      response = incoming;
      if (finished) { incoming.destroy(); return; }
      if (incoming.statusCode !== 200) { finish(new Error(incoming.statusCode === 400 || incoming.statusCode === 401 ? 'PROVIDER_AUTH_REQUIRED' : incoming.statusCode === 429 ? 'PROVIDER_RATE_LIMITED' : incoming.statusCode >= 300 && incoming.statusCode < 400 ? 'PROVIDER_REDIRECT_REJECTED' : 'PROVIDER_REQUEST_FAILED')); return; }
      incoming.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) finish(new Error('PROVIDER_OUTPUT_LIMIT')); else chunks.push(chunk); });
      incoming.on('error', () => finish(new Error('PROVIDER_REQUEST_FAILED'))); incoming.on('aborted', () => finish(new Error('PROVIDER_REQUEST_FAILED')));
      incoming.on('end', () => { try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')), credential = normalizeCredential(adapter, value.access_token); if (adapter === 'opencode-zen' && value.org_id != null && value.org_id !== grant.orgId) { finish(Error('PROVIDER_CLIENT_ACCOUNT_CHANGED')); return; } if (!credential || !Number.isSafeInteger(value.expires_in) || value.expires_in < 1 || value.expires_in > 31 * 86400 || value.refresh_token !== undefined && !normalizeCredential(adapter, value.refresh_token)) throw new Error(); finish(null, { credential, expiresAt: new Date(Date.now() + value.expires_in * 1000).toISOString(), refreshToken: value.refresh_token || refreshToken }); } catch { finish(new Error('PROVIDER_RESPONSE_INVALID')); } });
    });
    request.on('error', () => finish(new Error(signal?.aborted ? 'PROVIDER_CANCELED' : 'PROVIDER_REQUEST_FAILED'))); signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new Error('PROVIDER_TIMEOUT')), timeoutMs); if (signal?.aborted) abort(); if (!finished) request.end(body);
  });
}
module.exports = { renewOAuth };
