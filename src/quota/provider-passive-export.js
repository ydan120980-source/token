'use strict';
// Explicit statusline bridge. No source/auth/config reads or network. Never
// persist or echo raw stdin, which can include session paths and identifiers.
const path = require('node:path');
const { writeSnapshot } = require('./claude-passive');
const args = process.argv.slice(2), id = args[args.indexOf('--connection') + 1], directory = args[args.indexOf('--directory') + 1];
if (args.length !== 4 || args[0] !== '--connection' || args[2] !== '--directory' || !path.isAbsolute(directory || '')) process.exit(1);
let bytes = 0; const chunks = [];
process.stdout.on('error', () => { process.exitCode = 1; });
process.stdin.on('data', chunk => { bytes += chunk.length; if (bytes > 512 * 1024) process.exit(1); chunks.push(chunk); });
process.stdin.on('error', () => process.exit(1));
process.stdin.on('end', () => { try { const quota = writeSnapshot(directory, id, JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''))); const name=quota.provider==='antigravity'?'Antigravity':'Claude';process.stdout.write(name+(quota.pools.length ? ' 额度已观测\n' : ' 额度未提供\n')); } catch { process.exitCode = 1; } });
