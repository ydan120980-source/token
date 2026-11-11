'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { renewOAuth } = require('../../src/quota/provider-oauth');
const { readProvider } = require('../../src/quota/provider-http');
function post(status, value, calls) { return (url, options, callback) => { const request = Object.assign(new EventEmitter(), { destroy() {}, end(body) { calls.push({ url, options, body }); setImmediate(() => { const response = Object.assign(new EventEmitter(), { statusCode: status, destroy() {} }); callback(response); if (status === 200) { response.emit('data', Buffer.from(JSON.stringify(value))); response.emit('end'); } }); } }); return request; }; }
test('owned OAuth renewals use fixed token endpoints, form-encode secrets, retain rotated grants and bound lifetimes', async () => {
  const calls = [], grant = { clientId: 'SYNTHETIC_CLIENT_ID', clientSecret: 'SYNTHETIC_CLIENT_SECRET' };
  const result = await renewOAuth('claude-oauth', 'SYNTHETIC_REFRESH+&=%', grant, { post: post(200, { access_token: 'SYNTHETIC_NEW_ACCESS', refresh_token: 'SYNTHETIC_ROTATED', expires_in: 3600 }, calls) });
  assert.equal(calls[0].url, 'https://platform.claude.com/v1/oauth/token'); assert.equal(new URLSearchParams(calls[0].body).get('refresh_token'), 'SYNTHETIC_REFRESH+&=%'); assert.equal(calls[0].options.headers.Authorization, undefined); assert.equal(result.refreshToken, 'SYNTHETIC_ROTATED'); assert(Date.parse(result.expiresAt) > Date.now());
  await renewOAuth('gemini-code-assist', 'SYNTHETIC_REFRESH', grant, { post: post(200, { access_token: 'SYNTHETIC_ACCESS', expires_in: 100 }, calls) }); assert.equal(calls[1].url, 'https://oauth2.googleapis.com/token');
  for (const status of [302, 400, 401, 429, 500]) await assert.rejects(renewOAuth('claude-oauth', 'SYNTHETIC_REFRESH', grant, { post: post(status, { secret: 'PRIVATE_BODY' }, []) }), error => /^PROVIDER_/.test(error.message) && !error.message.includes('PRIVATE'));
  await assert.rejects(renewOAuth('claude-oauth', 'SYNTHETIC_REFRESH', grant, { post: post(200, { access_token: 'SYNTHETIC_ACCESS', expires_in: 1e12 }, []) }), /RESPONSE_INVALID/);
  await assert.rejects(renewOAuth('https://evil.invalid', 'SYNTHETIC_REFRESH', grant), /ACTION_INVALID/);
  const signal = AbortSignal.abort(); await assert.rejects(renewOAuth('claude-oauth', 'SYNTHETIC_REFRESH', grant, { signal }), /CANCELED/);
});
test('new quota routes bind website UA, organization/workspace and OAuth metadata to fixed destinations', async () => {
  const calls = [], cookie = 'owned_session=SYNTHETIC_ONLY';
  await readProvider('workbuddy-web', cookie, { project: { userAgent: 'SYNTHETIC_BROWSER/1' }, post: post(200, { code: 0, data: { Packages: [] } }, calls) });
  assert.equal(calls[0].url, 'https://www.workbuddy.cn/billing/meter/get-user-resource-summary'); assert.equal(calls[0].options.headers.Cookie, cookie); assert.equal(calls[0].options.headers['User-Agent'], 'SYNTHETIC_BROWSER/1'); assert.equal(calls[0].options.headers.Authorization, undefined); assert.deepEqual(JSON.parse(calls[0].body), {});
  await assert.rejects(readProvider('workbuddy-web', cookie), /ACTION_INVALID/);
  await assert.rejects(readProvider('workbuddy-web', cookie, { project: { userAgent: 'x\r\nAuthorization: PRIVATE' } }), /ACTION_INVALID/);
  await readProvider('gemini-code-assist', 'SYNTHETIC_OAUTH', { part: 'bootstrap', post: post(200, {}, calls) }); assert.equal(calls[1].url, 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'); assert.deepEqual(JSON.parse(calls[1].body), { metadata: { ideType: 'GEMINI_CLI', pluginType: 'GEMINI' } });
  const get = (url, options, callback) => { const value = post(200, {}, calls)(url, options, callback); value.end(''); return value; };
  const organization = '11111111-2222-4333-8444-555555555555'; await readProvider('claude-web', 'sessionKey=SYNTHETIC_ONLY', { organization, get }); assert.equal(calls[2].url, 'https://claude.ai/api/organizations/' + organization + '/usage');
  await readProvider('claude-oauth', 'SYNTHETIC_OAUTH', { get }); assert.equal(calls[3].options.headers['anthropic-beta'], 'oauth-2025-04-20'); assert.equal(calls[3].options.headers.Cookie, undefined);
  await readProvider('opencode-web', '__Host-auth=SYNTHETIC_ONLY', { part: 'usage', project: { workspace: 'org_SYNTHETIC' }, get }); assert.equal(calls[4].url, 'https://opencode.ai/console/api/go/status'); assert.equal(calls[4].options.headers['x-org-id'], 'org_SYNTHETIC');
  await assert.rejects(readProvider('opencode-web', '__Host-auth=SYNTHETIC_ONLY', { part: 'usage', project: { workspace: 'https://evil.invalid' }, get }), /ACTION_INVALID/);
  await assert.rejects(readProvider('claude-web', 'sessionKey=SYNTHETIC_ONLY', { organization: '../other', get }), /ACTION_INVALID/); assert.equal(calls.length, 5);
});
