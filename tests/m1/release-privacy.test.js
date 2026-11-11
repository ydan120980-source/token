'use strict';
// The repository is public: a path from someone's machine must not reach a tracked file. Fixtures use the invented homes below.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const INVENTED = 'demo|Synthetic|private|you|name|user|fixture|example|explicit|test|tester';
const MACHINE_PATH = new RegExp('\\b[A-Za-z]:[\\\\/]+(?:project[\\\\/]|Users[\\\\/]+(?![\\\\/]|(?:' + INVENTED + ')\\b))', 'i');
const SKIP = /^design\/desktop-reference\/ui\/|\.(png|jpe?g|webp|gif|ico|woff2?|ttf|exe|node|wasm)$/i;

test('no tracked file carries a path from a real machine', () => {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 1e8 }).split('\n').filter(file => file && !SKIP.test(file));
  const found = [];
  for (const file of files) {
    let text; try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, at) => { const hit = MACHINE_PATH.exec(line); if (hit) found.push(file + ':' + (at + 1) + ' ' + line.slice(hit.index, hit.index + 48)); });
  }
  assert.deepEqual(found, []);
});
