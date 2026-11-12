'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../design/desktop-reference/usage-data.js'), 'utf8');
function load(transport) {
  let decodes = 0;
  const window = { usageTransport: transport, snapshotCodec: { unpack(value) { decodes++; return value.snapshot; } } };
  vm.runInNewContext(source, { window, TextDecoder, performance: { now: () => 0, clearMeasures() {}, measure() {} } });
  return { bridge: window.usageBridge, decodes: () => decodes };
}
function packed(snapshotRevision, baseRevision) {
  const encoded = {
    codec: baseRevision === undefined ? 'LocalUsageColumnsV1' : 'LocalUsageDeltaV1',
    baseRevision, snapshot: { revision: snapshotRevision },
  };
  return { snapshotRevision, snapshotBytes: new TextEncoder().encode(JSON.stringify(encoded)).buffer };
}

test('manual refresh and push share an already decoded revision and ignore delayed old bytes', async () => {
  let reply = packed(2);
  const { bridge, decodes } = load({ get: async () => reply, refresh: async () => reply });
  const [manual, pushed] = await Promise.all([bridge.refresh(1), bridge.get(1)]);
  assert.equal(manual.snapshot, pushed.snapshot);
  assert.equal(decodes(), 1);
  reply = packed(1);
  assert.equal((await bridge.get(2)).snapshot, null);
  reply = { snapshotRevision: 2, snapshotBytes: null };
  assert.equal((await bridge.get(2)).snapshot, null);
  assert.equal(decodes(), 1);
});

test('concurrent deltas without their base share one full snapshot recovery', async () => {
  let fullRequests = 0, resolve;
  const full = new Promise(done => { resolve = done; });
  const { bridge, decodes } = load({
    get: async revision => {
      if (revision !== null) return packed(3, 2);
      fullRequests++;
      return full;
    },
    refresh: async () => packed(3, 2),
  });
  const manual = bridge.refresh(1), pushed = bridge.get(1);
  await new Promise(setImmediate);
  resolve(packed(3));
  const [a, b] = await Promise.all([manual, pushed]);
  assert.equal(a.snapshot, b.snapshot);
  assert.equal(a.snapshot.revision, 3);
  assert.equal(fullRequests, 1);
  assert.equal(decodes(), 1);
});
