'use strict';
// The React layer's committed build and its boundary with the legacy renderer
// (docs/m2/UI-REACT-FOUNDATION-20261025.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { report, layerBody } = require('../../scripts/m1/ui-layer-boundary');

const ROOT = path.resolve(__dirname, '../..');
const DESIGN = path.join(ROOT, 'design/desktop-reference');
const BUILT = ['agent-ui.js', 'agent-ui.css', 'agent-ui.LICENSES.txt'];

test('the committed React layer bundle is exactly what ui/ builds to', { timeout: 180000 }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ui-build-'));
  try {
    const vite = path.join(path.dirname(require.resolve('vite/package.json', { paths: [ROOT] })), 'bin/vite.js');
    const run = spawnSync(process.execPath, [vite, 'build', '--config', 'ui/vite.config.ts', '--logLevel', 'error'], { cwd: ROOT, env: { ...process.env, AGENT_UI_OUT: out }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.deepEqual(fs.readdirSync(out).sort(), BUILT.slice().sort());
    for (const file of BUILT) assert.ok(fs.readFileSync(path.join(out, file)).equals(fs.readFileSync(path.join(DESIGN, 'ui', file))), file + ' is stale: run npm run build:ui and commit the result');
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('every utility applies only inside React roots and portals', async () => {
  const { SCOPE, splitSelectors } = await import(pathToFileURL(path.join(ROOT, 'ui/scripts/scope-utilities.mjs')).href);
  const utilities = layerBody(fs.readFileSync(path.join(DESIGN, 'ui/agent-ui.css'), 'utf8'), 'utilities');
  const selectors = [];
  // Rule heads at any nesting depth (inside @media / @supports too); at-rules and keyframe steps are skipped.
  for (const match of utilities.matchAll(/(?:^|[{}])([^{}@]+)\{/g)) if (!/^(from|to|\d+%)/.test(match[1].trim())) selectors.push(...splitSelectors(match[1]));
  assert.ok(selectors.length > 100);
  assert.deepEqual(selectors.filter(selector => !selector.startsWith(SCOPE + ' ')), []);
});

test('the bundle does not shadow the document host token names', () => {
  const found = report();
  assert.deepEqual(found.keyframes, []);
  // --ease-out: Tailwind declares it on :root, tokens.css on body; shell elements keep the body value.
  assert.deepEqual(found.variables.filter(name => name !== '--ease-out'), []);
});

test('the page loads current fonts/tokens and the single App bundle, without legacy layers', () => {
  const html = fs.readFileSync(path.join(DESIGN, 'index.html'), 'utf8');
  assert.deepEqual([...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(match => match[1]), ['fonts.css', 'tokens.css', 'ui/agent-ui.css']);
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  assert.equal(scripts[0], 'ui/agent-ui.js', 'App mounts the shell before data hosts initialize');
  assert.equal(scripts.filter(file => file === 'ui/agent-ui.js').length, 1);
  assert.ok(!scripts.includes('islands.js') && !scripts.includes('window-shell.js'), 'App owns production page and shell composition');
  assert.deepEqual(fs.readdirSync(DESIGN).filter(file => file.endsWith('.css')).sort(), ['fonts.css', 'tokens.css']);
  const css = fs.readFileSync(path.join(DESIGN, 'ui/agent-ui.css'), 'utf8');
  assert.doesNotMatch(css, /@layer\s+legacy|ui-reset/);
  for (const file of ['motion.js', 'morph.js', 'segmented.js', 'select-ui.js', 'focus.js', 'scroll-fade.js', 'interactions.js', 'detail-interactions.js', 'window-shell.js', 'islands.js']) {
    assert.equal(fs.existsSync(path.join(DESIGN, file)), false, file + ' is retired');
    assert.ok(!scripts.includes(file));
  }
});

test('React dependencies are build-time only: the packaged app ships the bundle, not node_modules', () => {
  const pkg = require('../../package.json');
  for (const name of ['react', 'react-dom', 'motion', 'tailwindcss', 'vite']) {
    assert.equal(pkg.dependencies[name], undefined, name + ' must not be a runtime dependency');
    assert.match(pkg.devDependencies[name], /^\d+\.\d+\.\d+$/, name + ' is pinned to an exact version');
  }
  assert.ok(pkg.build.files.includes('design/desktop-reference/**/*'));
  assert.ok(!pkg.build.files.some(entry => entry.startsWith('ui/')), 'React sources are not packaged');
});
