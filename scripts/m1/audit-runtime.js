'use strict';
// Validate the current product graph, not the removed upstream implementation.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..'), pkg = require('../../package.json');
assert.equal(pkg.main, 'src/quota/main.js'); assert.equal(pkg.build.appId, 'local.agentusage.quota');
assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@modelcontextprotocol/sdk', 'electron-updater', 'sql.js', 'tokscale']);
const seen = new Set(), external = new Set(), queue = [pkg.main, 'src/m1/query-entry.js', 'src/m1/config-health-entry.js', 'src/m1/usage-math.js', 'src/m1/insights-math.js', 'src/m1/worker.js', 'src/m1/price-fetch-worker.js', 'src/quota/preload.js'];
for (const file of fs.readdirSync(path.join(root, 'design/desktop-reference'))) if (file.endsWith('.js') && file !== 'serve.js') queue.push('design/desktop-reference/' + file);
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
// Layering: the main process and the statistics library never depend on the renderer.
const renderer = path.join(root, 'design/desktop-reference');
for (const file of ['legacy.css', 'motion.js', 'interactions.js', 'detail-interactions.js', 'morph.js', 'window-shell.js', 'scroll-fade.js', 'focus.js', 'segmented.js', 'select-ui.js']) assert.ok(!fs.existsSync(path.join(renderer, file)), 'Retired renderer remains: ' + file);
assert.ok(!/@layer\s+(?:legacy|ui-reset)/.test(fs.readFileSync(path.join(renderer, 'ui/agent-ui.css'), 'utf8')), 'Retired CSS layer remains');
const adapterRoot = path.join(root, 'src/quota/provider-adapters') + path.sep;
for (const file of seen) if (file.startsWith(adapterRoot)) {
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
    assert.ok(['node:crypto', '../provider-adapter-helpers', '../resource-contract', '../workbuddy-package-contract'].includes(match[1]), 'Provider adapter must use injected transport and own no filesystem/process/network capability: ' + path.relative(root, file));
  }
}
for (const file of seen) if (!file.startsWith(renderer + path.sep)) for (const match of fs.readFileSync(file, 'utf8').matchAll(/require(?:\.resolve)?\(['"]([^'"]+)['"]\)/g)) assert.ok(!match[1].startsWith('.') || !path.resolve(path.dirname(file), match[1]).startsWith(renderer + path.sep), path.relative(root, file) + ' requires the renderer: ' + match[1]);
for (const match of fs.readFileSync(path.join(renderer, 'index.html'), 'utf8').matchAll(/(?:src|href)="([^"#]+)"/g)) if (!/^(?:https?:|data:)/.test(match[1])) assert.ok(fs.existsSync(path.resolve(renderer, match[1])), 'Missing UI asset: ' + match[1]);
// Current bundled stylesheets and their local assets.
const sheets = [...fs.readFileSync(path.join(renderer, 'index.html'), 'utf8').matchAll(/<link rel="stylesheet" href="([^"]+\.css)">/g)].map(match => path.resolve(renderer, match[1])), checked = new Set();
while (sheets.length) {
  const sheet = sheets.pop(); if (checked.has(sheet)) continue; checked.add(sheet);
  for (const match of fs.readFileSync(sheet, 'utf8').matchAll(/url\(['"]?([^'"()]+)['"]?\)/g)) if (!/^(?:data:|#)/.test(match[1])) { const asset = path.resolve(path.dirname(sheet), match[1]); assert.ok(fs.existsSync(asset), 'Missing CSS asset: ' + match[1]); if (asset.endsWith('.css')) sheets.push(asset); }
}
// The React layer bundle is one classic script: no module loading, eval or runtime code generation (CSP script-src 'self').
const bundle = fs.readFileSync(path.join(renderer, 'ui/agent-ui.js'), 'utf8');
assert.ok(!/\beval\(|new Function\(|\bimport\(|\brequire\(/.test(bundle), 'React layer bundle must not load or generate code at runtime');
fs.mkdirSync(path.join(root, 'artifacts/maintenance'), { recursive: true });
const result = { entry: pkg.main, modules: [...seen].map(file => path.relative(root, file).replaceAll('\\', '/')).sort(), external: [...external].sort(), retiredPathsAbsent: true, noDevelopmentScriptInProduct: true, uiAssetsExist: true };
fs.writeFileSync(path.join(root, 'artifacts/maintenance/runtime-audit.json'), JSON.stringify(result, null, 2));
console.log('PASS: ' + seen.size + ' reachable product modules; one entry, no retired paths/development imports, local UI assets present.');
