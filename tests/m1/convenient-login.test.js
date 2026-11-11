'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { EventEmitter } = require('node:events');
const { cursorCredential, readCursor } = require('../../src/quota/cursor-client');
const { sql } = require('../../src/m1/sqlite-memory');
const { loginZcode, requestJSON, authURL } = require('../../src/quota/zcode-login');
const { fromProvider } = require('../../src/quota/provider-resources');
const { quotaJSON } = require('../../src/quota/quota-json');
const { capabilities } = require('../../src/quota/provider-catalog');
const { createClientLogin } = require('../../src/quota/provider-client-login');
const token = (sub = 'auth0|SYNTHETIC_USER', exp = Math.floor(Date.now() / 1000) + 3600) => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ sub, exp })).toString('base64url') + '.SYNTHETIC_SIGNATURE';
test('Cursor client sessions use exact derived cookie spelling, handle UTF16 blobs and reject expiry/malformed identities', () => {
  const jwt = token(), value = cursorCredential(jwt); assert.equal(value.credential, 'WorkosCursorSessionToken=SYNTHETIC_USER%3A%3A' + jwt); assert.equal(value.context.cursor.subject, 'SYNTHETIC_USER');
  assert.equal(cursorCredential(Buffer.from(jwt, 'utf16le')).credential, value.credential); assert.equal(cursorCredential(Buffer.from(jwt)).credential, value.credential);
  assert.throws(() => cursorCredential(token('bad\r\ninjection')), /CREDENTIAL_MISSING/); assert.throws(() => cursorCredential(token('x', 1)), /AUTH_REQUIRED/); assert.throws(() => cursorCredential('malformed'), /CREDENTIAL_MISSING/);
});
test('Cursor reads only fixed client auth key using an in-memory SQLite image and never writes source files', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-login-')); t.after(() => fs.rmSync(home, { recursive: true, force: true })); const file = path.join(home, 'Cursor/User/globalStorage/state.vscdb'); fs.mkdirSync(path.dirname(file), { recursive: true });
  const SQL = await sql(), db = new SQL.Database(), jwt = token(); db.run('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)'); db.run('INSERT INTO ItemTable VALUES (?, ?)', ['cursorAuth/accessToken', Buffer.from(jwt, 'utf16le')]); db.run('INSERT INTO ItemTable VALUES (?, ?)', ['private-unrelated-key', 'DO_NOT_RETURN']); fs.writeFileSync(file, Buffer.from(db.export())); db.close(); const before = fs.readFileSync(file), names = fs.readdirSync(path.dirname(file));
  const value = await readCursor({ appData: home }, new AbortController().signal); assert.equal(value.context.cursor.subject, 'SYNTHETIC_USER'); assert(!JSON.stringify(value).includes('DO_NOT_RETURN')); assert.deepEqual(fs.readFileSync(file), before); assert.deepEqual(fs.readdirSync(path.dirname(file)), names);
  const canceled = new AbortController(); canceled.abort(); await assert.rejects(readCursor({ appData: home }, canceled.signal), /CANCELED/);
});
test('ZCode external browser authorization binds one random flow and keeps unrelated returned tokens out of the vault result', async () => {
  const calls = [], urls = [], signal = new AbortController().signal;
  const value = await loginZcode(signal, async url => urls.push(url), { sleep: async () => {}, send: async (operation, secret, body) => { calls.push({ operation, secret, body }); return operation === 'init' ? { code: 0, data: { flow_id: 'SYNTHETIC_FLOW', authorize_url: 'https://zcode.z.ai/authorize?flow=SYNTHETIC', poll_interval_sec: 1 } } : { code: 0, data: { status: 'ready', token: 'SYNTHETIC_ZCODE_TOKEN', user: { user_id: 'SYNTHETIC_USER' }, zai: { access_token: 'DO_NOT_COPY_OTHER_TOKEN' } } }; } });
  assert.equal(calls.length, 2); assert.equal(calls[0].secret, calls[1].secret); assert.match(calls[0].secret, /^[a-f0-9]{64}$/); assert.deepEqual(calls[0].body, { provider: 'bigmodel' }); assert.equal(calls[1].operation, 'poll/SYNTHETIC_FLOW'); assert.equal(urls.length, 1); assert.equal(value.credential, 'SYNTHETIC_ZCODE_TOKEN'); assert(!JSON.stringify(value).includes('DO_NOT_COPY')); assert(value.context.zcode.deviceMid); assert(!JSON.stringify(value).includes(calls[0].secret));
});
test('ZCode rejects foreign authorization URLs, denial, cancellation, expiry and late authorization completion', async () => {
  assert.throws(() => authURL('https://evil.invalid/login'), /LOGIN_FAILED/); assert.throws(() => authURL('https://zcode.z.ai@evil.invalid/'), /LOGIN_FAILED/); assert.throws(() => authURL('http://zcode.z.ai/'), /LOGIN_FAILED/);
  let opens = 0; await assert.rejects(loginZcode(new AbortController().signal, async () => { opens++; }, { send: async () => ({ code: 0, data: { flow_id: 'SYNTHETIC', authorize_url: 'https://evil.invalid' } }) }), /LOGIN_FAILED/); assert.equal(opens, 0);
  const init = { code: 0, data: { flow_id: 'SYNTHETIC', authorize_url: 'https://zcode.z.ai/authorize', expires_at: 10 } }; let at = 0, sends = 0;
  await assert.rejects(loginZcode(new AbortController().signal, async () => {}, { now: () => at, sleep: async ms => { at += ms; }, send: async () => { sends++; return init; } }), /RESPONSE_INVALID/);
  at = 0; sends = 0; await assert.rejects(loginZcode(new AbortController().signal, async () => {}, { now: () => at, sleep: async () => { at = 10001; }, send: async () => { sends++; return init; } }), /LOGIN_TIMEOUT/); assert.equal(sends, 1);
  const canceled = new AbortController(); await assert.rejects(loginZcode(canceled.signal, async () => { canceled.abort(); }, { send: async () => ({ ...init, data: { ...init.data, expires_at: undefined } }) }), /CANCELED/);
  await assert.rejects(loginZcode(new AbortController().signal, async () => {}, { sleep: async () => {}, send: async operation => operation === 'init' ? { ...init, data: { ...init.data, expires_at: undefined } } : { code: 0, data: { status: 'failed' } } }), /LOGIN_FAILED/);
});
test('ZCode auth transport fixes endpoint and strips error bodies, rejects redirect credential forwarding', async () => {
  const calls = [];
  const request = (url, options, callback) => { calls.push({ url, options }); const req = new EventEmitter(); req.destroy = () => {}; req.end = () => setImmediate(() => { const res = new EventEmitter(); res.statusCode = 302; res.destroy = () => {}; callback(res); }); return req; };
  await assert.rejects(requestJSON('init', 'a'.repeat(64), { provider: 'bigmodel' }, { request }), /REDIRECT_REJECTED/); assert.equal(calls[0].url, 'https://zcode.z.ai/api/v1/oauth/cli/init'); assert.equal(calls[0].options.method, 'POST'); await assert.rejects(requestJSON('poll/../../other', 'a'.repeat(64), null, { request }), /ACTION_INVALID/); assert.equal(calls.length, 1);
});
test('ZCode token buckets retain exact available/book amounts and explicit unknown units, without claiming rewards', () => {
  const value = fromProvider('zcode-device', quotaJSON('{"code":0,"data":{"balances":[{"unit_type":"token","total_units":9007199254740993.125,"remaining_units":"20","available_units":"18","expires_at":1790000000},{"unit_type":"unknown-new-unit","remaining_units":"0"}]}}'), new Date().toISOString()); assert.equal(value.provider, 'zcode'); assert.equal(value.pools[0].balances[0].total, '9007199254740993.125'); assert.equal(value.pools[0].balances[1].remaining, '18'); assert.equal(value.pools[1].balances[0].unit, 'unknown');
});
test('all existing client routes are preferred to manual website routes; new device flows obey fixture gate', async () => {
  const all = capabilities(); for (const provider of ['claude', 'gemini', 'opencode', 'deepseek', 'workbuddy', 'cursor', 'zcode']) assert.equal(all.find(row => row.provider === provider).adapters[0].clientLogin, true);
  for (const adapter of ['zcode-device', 'workbuddy-desktop', 'cursor-web']) { let calls = 0; const login = createClientLogin({ fixture: true, environment: () => { calls++; return {}; }, desktop: { read: () => { calls++; } }, deviceLogin: () => { calls++; } }); await assert.rejects(login.login(adapter, new AbortController().signal), /FIXTURE_BLOCKED/); assert.equal(calls, 0); }
  assert.equal(all.find(row => row.provider === 'workbuddy').adapters[0].clientOnly, true);
});
