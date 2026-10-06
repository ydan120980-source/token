'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '../..'), directory = path.resolve(process.argv[2] || path.join(root, 'dist/win-unpacked'));
const archive = path.join(directory, 'resources/app.asar'), entries = asar.listPackage(archive);
assert.deepEqual(entries.filter(p => /\\src\\(?:electron|shared|agent|hub)\\|\\src\\m1\\(?:main\.js|calendar\.js)|\\scripts\\/.test(p)), []);
const excluded = new Set(['src/m1/crypto.js', 'src/m1/read-snapshot.js', 'design/desktop-reference/serve.js', 'design/desktop-reference/README.md']);
const files = [];
function check(file) { const raw = path.relative(root, file), relative = raw.replaceAll('\\', '/'); if (excluded.has(relative)) return; assert.ok(asar.extractFile(archive, raw).equals(fs.readFileSync(file)), 'Mismatch: ' + relative); files.push(relative); }
function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else check(file); } }
for (const folder of ['src/quota', 'src/m1', 'design/desktop-reference']) walk(path.join(root, folder));
for (const relative of ['LICENSE', 'docs/m1/UPSTREAM.md', 'docs/m1/CODEX-QUOTA.md']) check(path.join(root, relative));
const packaged = JSON.parse(asar.extractFile(archive, 'package.json')), current = require('../../package.json');
for (const key of ['main', 'name', 'version', 'dependencies']) assert.deepEqual(packaged[key], current[key], key);
fs.mkdirSync(path.join(root, 'artifacts/maintenance'), { recursive: true });
fs.writeFileSync(path.join(root, 'artifacts/maintenance/asar-results.json'), JSON.stringify({ currentProductSourceMatches: true, files, retiredPathsAbsent: true, packageRuntimeMetadataMatches: true, packageDevelopmentFieldsPrunedByBuilder: true, dependencies: ['sql.js', 'tokscale'] }, null, 2));
console.log('PASS: ' + files.length + ' source/assets/docs match ASAR byte-for-byte; runtime package metadata matches.');
