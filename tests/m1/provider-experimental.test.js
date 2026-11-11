'use strict';
// Experimental quota routes are off until the person turns them on (owner 2026-11-04).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { ProviderQuotaService } = require('../../src/quota/provider-service');
const { routes, capabilities, experimental } = require('../../src/quota/provider-catalog');
function service(t, options) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'experimental-')); const value = new ProviderQuotaService(root, options); t.after(async () => { await value.close(); fs.rmSync(root, { recursive: true, force: true }); }); return { root, value }; }

test('official routes are not experimental; website, internal and unpublished ones are, and say so', () => {
  for (const id of ['deepseek-api', 'workbuddy-credit', 'claude-statusline', 'antigravity-statusline']) assert.equal(experimental(routes[id]), false, id);
  for (const id of ['claude-web', 'cursor-web', 'gemini-code-assist', 'opencode-go', 'workbuddy-desktop', 'mimo-web']) assert.equal(experimental(routes[id]), true, id);
  for (const row of capabilities()) for (const route of row.adapters) if (route.experimental) { assert.match(route.name, /试验/, route.id); assert.doesNotMatch(route.name, /推荐/, route.id); }
});

test('off by default: a new connection is refused before anything happens, and turning it on is remembered', async t => {
  const { root, value } = service(t, { run: () => assert.fail('NO_NETWORK') });
  assert.equal(value.state().experimentalEnabled, false);
  await assert.rejects(value.connect({ adapter: 'mimo-web', alias: 'demo', credential: 'demo', consent: true }), /PROVIDER_EXPERIMENTAL_OFF/);
  await assert.rejects(value.loginWebsite({ adapter: 'cursor-web', alias: 'demo', consent: true, id: null }, true), /PROVIDER_EXPERIMENTAL_OFF/);
  assert.equal(value.state().accounts.length, 0);
  assert.equal(value.setExperimental(true).experimentalEnabled, true);
  const again = new ProviderQuotaService(root); t.after(() => again.close());
  assert.equal(again.state().experimentalEnabled, true);
  assert.throws(() => value.setExperimental('yes'), /PROVIDER_ACTION_INVALID/);
  // An official route is not gated.
  value.setExperimental(false);
  await assert.rejects(value.connect({ adapter: 'deepseek-api', alias: 'demo', credential: '', consent: true }), error => error.message !== 'PROVIDER_EXPERIMENTAL_OFF');
});

test('a connection the person already has stays allowed', t => {
  const { value } = service(t);
  assert.doesNotThrow(() => value.allowed('cursor-web', 'b1f0c0de-0000-4000-8000-000000000001'));
  assert.throws(() => value.allowed('cursor-web', null), /PROVIDER_EXPERIMENTAL_OFF/);
});
