'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname,'../..'), files = [];
function walk(dir) { for (const entry of fs.readdirSync(dir,{withFileTypes:true})) { const file = path.join(dir,entry.name); if (entry.isDirectory()) walk(file); else if (entry.isFile()) files.push(file); } }
for (const folder of ['src/m1','src/quota','design/desktop-reference','scripts/m1','tests/m1']) walk(path.join(root,folder));
for (const name of ['package.json','package-lock.json','eslint.config.js','AGENTS.md','docs/m2/AGENT-INTEGRATION-CONTRACT-20261005.md']) files.push(path.join(root,name));
const entries = files.sort().map(file => ({file:path.relative(root,file).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
const sha256 = crypto.createHash('sha256').update(entries.map(e => e.file + '\0' + e.sha256 + '\n').join('')).digest('hex');
const output = path.resolve(root,process.argv[2] || 'artifacts/m2-agents/source-fingerprint.json');
if (!output.startsWith(path.join(root,'artifacts')+path.sep)) throw new Error('FINGERPRINT_OUTPUT_REJECTED');
fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,JSON.stringify({at:new Date().toISOString(),sha256,files:entries.length,entries},null,2)); console.log(JSON.stringify({sha256,files:entries.length}));
