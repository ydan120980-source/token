'use strict';
// What one ledger digest and one ingest of 40k records actually cost, split by the steps inside them,
// plus how much of the normalizer's HMAC can be recovered by reusing the keyed inner state.
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const salt = 'bench-salt';
const ROWS = Number(process.env.HMAC_ROWS || 80000);

function median(values) { const sorted = [...values].sort((a, b) => a - b); return +sorted[Math.floor(sorted.length / 2)].toFixed(1); }
function time(label, action, runs = 5) {
  const samples = [];
  for (let run = 0; run < runs; run += 1) { const began = performance.now(); action(); samples.push(performance.now() - began); }
  return [label, median(samples)];
}

// 1. createHmac per value, as normalize() does today.
const direct = time('createHmac per value', () => {
  for (let i = 0; i < ROWS; i += 1) crypto.createHmac('sha256', salt).update('codex:row-' + i).digest('hex');
});

// 2. The same HMAC computed from a copied inner state. HMAC(K,m) = H(opad || H(ipad || m)), so the
//    inner hash can absorb the padded key once and be copied per message.
const block = (() => {
  const key = Buffer.alloc(64);
  Buffer.from(salt).copy(key);
  const ipad = Buffer.from(key.map(byte => byte ^ 0x36)), opad = Buffer.from(key.map(byte => byte ^ 0x5c));
  return { ipad, opad };
})();
const inner = crypto.createHash('sha256').update(block.ipad);
const shared = time('copied inner state', () => {
  for (let i = 0; i < ROWS; i += 1) {
    const copy = inner.copy();
    copy.update('codex:row-' + i);
    const middle = copy.digest();
    crypto.createHash('sha256').update(block.opad).update(middle).digest('hex');
  }
});

// Correctness: identical bytes to createHmac.
const reference = crypto.createHmac('sha256', salt).update('codex:row-7').digest('hex');
const copy = inner.copy(); copy.update('codex:row-7');
const rebuilt = crypto.createHash('sha256').update(block.opad).update(copy.digest()).digest('hex');

console.log(JSON.stringify({ rows: ROWS, direct, shared, sameDigest: reference === rebuilt }));
