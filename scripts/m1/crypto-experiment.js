'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
function peer(input) { return new Promise((resolve, reject) => { const p = spawn(process.execPath, [path.join(__dirname, 'crypto-peer.js')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }); let output = ''; p.stdout.on('data', chunk => { output += chunk; }); p.on('error', reject); p.on('close', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error('CRYPTO_PEER_FAILED'))); p.stdin.end(JSON.stringify(input)); }); }
(async () => {
  const key = crypto.randomBytes(32).toString('base64'), snapshot = { schemaVersion: 'UsageSnapshotV1', deviceId: 'synthetic-vector-device', sequence: 2, timezone: 'Asia/Shanghai', daily: [{ date: '2026-10-01', agent: 'codex', totalTokens: 123 }] };
  const envelope = await peer({ mode: 'seal', key, snapshot });
  const tampered = structuredClone(envelope); tampered.ciphertext = Buffer.alloc(20).toString('base64');
  const header = structuredClone(envelope); header.header.sequence = 3;
  const older = await peer({ mode: 'seal', key, snapshot: { ...snapshot, sequence: 1 } });
  const results = await peer({ mode: 'open', key, deviceId: snapshot.deviceId, envelopes: [tampered, header, envelope, envelope, older] });
  assert.deepEqual(results.map(r => r.accepted), [false, false, true, false, false]);
  assert.equal((await peer({ mode: 'open', key: crypto.randomBytes(32).toString('base64'), deviceId: snapshot.deviceId, envelopes: [envelope] }))[0].accepted, false);
  // Ciphertext vector has no key: reproducible keyed vectors are generated per run.
  fs.mkdirSync('artifacts', { recursive: true }); fs.writeFileSync('artifacts/crypto-vector.json', JSON.stringify({ envelope, expectedPlaintext: snapshot, results, keyPersisted: false }, null, 2));
  console.log('PASS: separate sender/receiver processes; wrong key, tampering, replay and duplicate rejected; key kept in memory only.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
