'use strict';
// Validate the current product graph, not the removed upstream implementation.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..'), pkg = require('../../package.json');
assert.equal(pkg.main, 'src/quota/main.js'); assert.equal(pkg.build.appId, 'local.agentusage.quota');
assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['sql.js', 'tokscale']);
const seen = new Set(), external = new Set(), queue = [pkg.main, 'src/m1/worker.js', 'src/m1/price-fetch-worker.js', 'src/quota/preload.js'];
for (const file of fs.readdirSync(path.join(root, 'design/desktop-reference'))) if (file.endsWith('.js') && !['serve.js', 'local-snapshot.js'].includes(file)) queue.push('design/desktop-reference/' + file);
while (queue.length) {
  const relative = queue.pop(), file = path.resolve(root, relative);
  if (seen.has(file)) continue; seen.add(file); assert.ok(fs.existsSync(file), 'Missing module: ' + relative);
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/require(?:\.resolve)?\(['"]([^'"]+)['"]\)/g)) {
    const name = match[1];
    if (name.startsWith('.')) { const target = path.resolve(path.dirname(file), name); queue.push(path.relative(root, path.extname(target) ? target : target + '.js')); }
    else if (!name.startsWith('node:')) { require.resolve(name, { paths: [path.dirname(file)] }); external.add(name); }
  }
}
for (const relative of ['src/agent', 'src/hub', 'src/shared', 'src/electron', 'native', 'site', 'worker', 'src/m1/main.js', 'src/m1/calendar.js', 'quota-builder.json']) assert.equal(fs.existsSync(path.join(root, relative)), false, 'Retired path remains: ' + relative);
assert.ok([...seen].every(file => !file.startsWith(path.join(root, 'scripts') + path.sep)), 'Product imports a development script');
const renderer = path.join(root, 'design/desktop-reference');
for (const match of fs.readFileSync(path.join(renderer, 'index.html'), 'utf8').matchAll(/(?:src|href)="([^"#]+)"/g)) if (!/^(?:https?:|data:)/.test(match[1])) assert.ok(fs.existsSync(path.resolve(renderer, match[1])), 'Missing UI asset: ' + match[1]);
for (const name of ['style.css', 'nowdex.css', 'quota.css']) for (const match of fs.readFileSync(path.join(renderer, name), 'utf8').matchAll(/url\(['"]?([^'"()]+)['"]?\)/g)) if (!/^(?:data:|#)/.test(match[1])) assert.ok(fs.existsSync(path.resolve(renderer, match[1])), 'Missing CSS asset: ' + match[1]);
fs.mkdirSync(path.join(root, 'artifacts/maintenance'), { recursive: true });
const result = { entry: pkg.main, modules: [...seen].map(file => path.relative(root, file).replaceAll('\\', '/')).sort(), external: [...external].sort(), retiredPathsAbsent: true, noDevelopmentScriptInProduct: true, uiAssetsExist: true };
fs.writeFileSync(path.join(root, 'artifacts/maintenance/runtime-audit.json'), JSON.stringify(result, null, 2));
console.log('PASS: ' + seen.size + ' reachable product modules; one entry, no retired paths/development imports, local UI assets present.');
