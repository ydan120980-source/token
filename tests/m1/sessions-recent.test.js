'use strict';
// The list behind the summary card and the widgets must never leave them on "正在读取会话" (owner 2026-11-02).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../../design/desktop-reference/sessions-host.js'), 'utf8');
function host() {
  const listeners = new Map(), calls = [];
  const on = (name, listener) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(listener); };
  const fire = name => { for (const listener of listeners.get(name) ?? []) listener({ detail: null }); };
  const bridge = {
    sessionLabels: async () => ({}),
    sessions: selection => new Promise((resolve, reject) => { calls.push({ selection, resolve, reject }); }),
  };
  class Event { constructor(type) { this.type = type; } }
  const window = {
    usageBridge: bridge, addEventListener: on, dispatchEvent: event => fire(event.type),
    sessionsModel: { create: () => ({ demoList: () => ({ sessions: [] }), today: () => '2026-11-02' }) },
  };
  vm.runInNewContext(SOURCE, { window, Event, location: { search: '' }, URLSearchParams, document: { getElementById: () => ({ dataset: { currentView: 'quota' } }) }, Map, Set, Promise, Object, Error, Array, Boolean, Number, String, RegExp, console });
  return { api: window.sessionsHost, calls, fire };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const recentCalls = calls => calls.filter(call => call.selection?.recent);

test('a change of the page\'s range does not void the recent list being read', async () => {
  const { api, calls } = host();
  api.wantRecent();
  void api.load('7'); await flush();
  recentCalls(calls)[0].resolve({ sessions: ['a'] }); await flush();
  assert.deepEqual(api.recent().sessions, ['a']);
});
test('new data during a read reads again instead of leaving the card empty', async () => {
  const { api, calls, fire } = host();
  api.wantRecent();
  fire('usage-data-change');
  recentCalls(calls)[0].resolve({ sessions: ['old'] }); await flush();
  assert.equal(api.recent(), null, 'that read is out of date');
  api.wantRecent(); // What the hook does on the publish that follows.
  assert.equal(recentCalls(calls).length, 2);
  recentCalls(calls)[1].resolve({ sessions: ['new'] }); await flush();
  assert.deepEqual(api.recent().sessions, ['new']);
});
test('what is on screen stays while newer data is read', async () => {
  const { api, calls, fire } = host();
  api.wantRecent(); recentCalls(calls)[0].resolve({ sessions: ['first'] }); await flush();
  fire('usage-data-change');
  assert.deepEqual(api.recent().sessions, ['first'], 'never back to reading');
  api.wantRecent(); assert.equal(recentCalls(calls).length, 2);
  assert.deepEqual(api.recent().sessions, ['first']);
  recentCalls(calls)[1].resolve({ sessions: ['second'] }); await flush();
  assert.deepEqual(api.recent().sessions, ['second']);
  api.wantRecent(); assert.equal(recentCalls(calls).length, 2, 'fresh data is not read again');
});
test('a failed read says so, does not loop, and tries again with the next data', async () => {
  const { api, calls, fire } = host();
  api.wantRecent(); recentCalls(calls)[0].reject(new Error('busy')); await flush();
  assert.equal(api.recentFailed(), true); assert.equal(api.recent(), null);
  api.wantRecent(); api.wantRecent(); assert.equal(recentCalls(calls).length, 1, 'no loop');
  fire('usage-data-change'); assert.equal(api.recentFailed(), false);
  api.wantRecent(); recentCalls(calls)[1].resolve({ sessions: ['back'] }); await flush();
  assert.deepEqual(api.recent().sessions, ['back']);
});
