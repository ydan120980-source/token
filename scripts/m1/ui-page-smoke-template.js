'use strict';
/* global document, getComputedStyle, requestAnimationFrame */
// Copy runPageSmoke's configuration into a migrated page suite. Running this
// file directly validates the template with the existing foundation probe and
// exercises the real data hooks in a separate, synthetic browser window.
// Browser plugin not available: use the repository's Playwright Electron path.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ts = require('typescript');
const { launch, setTheme, isolationViolations, semanticViolations } = require('./ui-smoke');
const { showView, settle, until, cleanup } = require('./ui-settle');
const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = process.env.UI_PAGE_SMOKE_EVIDENCE_DIR || path.join(ROOT, 'artifacts/ui-mig/M2');

// A real page supplies its ready selector, every dialog trigger/role selector,
// and semantic assertions from its approved inventory. No selector is guessed.
async function runPageSmoke({ view, ready, dialogs = [], prepare, dispose, assertPage, output = OUTPUT }) {
  // before/ holds the legacy page and comes from a main checkout before the migration
  // (UI-MIG-M1-M3-REVIEW-20261025.md, Q6); this run only shoots the page under test.
  fs.mkdirSync(output, { recursive: true });
  const session = await launch(), { page, errors } = session;
  try {
    assert.match(await page.url(), /^file:/);
    assert.match(await page.title(), /Agent Usage/);
    await showView(page, view);
    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme); await settle(page);
      if (prepare) await prepare(page);
      await page.locator(ready).waitFor();
      assert.equal(await page.locator('vite-error-overlay, nextjs-portal').count(), 0, 'no framework error overlay');
      assert.equal(await page.locator(ready).evaluate(element => element.textContent.trim().length > 0), true, 'meaningful page content');
      assert.deepEqual(await isolationViolations(page), []);
      assert.deepEqual(await semanticViolations(page), []);
      if (assertPage) await assertPage(page, theme);
      await page.screenshot({ path: path.join(output, view + '-' + theme + '.png') });
      for (const [index, { trigger, dialog, before }] of dialogs.entries()) {
        if (before) await before(page);
        const control = page.locator(trigger);
        await control.click(); await page.locator(dialog).waitFor();
        await page.waitForFunction(selector => document.querySelector(selector)?.contains(document.activeElement), dialog);
        await page.keyboard.press('Tab');
        assert.equal(await page.locator(dialog).evaluate(element => element.contains(document.activeElement)), true);
        await page.screenshot({ path: path.join(output, 'dialog-' + index + '-' + theme + '.png') });
        await page.keyboard.press('Escape');
        await page.locator(dialog).waitFor({ state: 'hidden' });
        await page.waitForFunction(element => element === document.activeElement, await control.elementHandle());
        assert.equal(await control.evaluate(element => element === document.activeElement), true, 'focus returns to trigger');
      }
      // The app's own switch (motion.js), as the settings page uses it.
      await page.evaluate(() => { if (window.uiMotion) window.uiMotion.setPreference('off'); else document.body.dataset.motion = 'off'; });
      await settle(page);
      // Exercise the off path itself, then check the next frame's final opacity.
      for (const [index, { trigger, dialog, before }] of dialogs.entries()) {
        if (before) await before(page);
        await page.locator(trigger).click(); await page.locator(dialog).waitFor();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        assert.equal(await page.locator(dialog).evaluate(element => getComputedStyle(element).opacity), '1');
        await page.screenshot({ path: path.join(output, 'dialog-off-' + index + '-' + theme + '.png') });
        await page.keyboard.press('Escape'); await page.locator(dialog).waitFor({ state: 'hidden' });
        await page.waitForFunction(element => element === document.activeElement, await page.locator(trigger).elementHandle());
        assert.equal(await page.locator(trigger).evaluate(element => element === document.activeElement), true);
      }
      await settle(page);
      assert.deepEqual(await isolationViolations(page), []);
      assert.deepEqual(await semanticViolations(page), []);
      if (assertPage) await assertPage(page, theme);
      await page.screenshot({ path: path.join(output, 'motion-off-' + theme + '.png') });
      await page.evaluate(() => { if (window.uiMotion) window.uiMotion.setPreference('system'); else document.body.dataset.motion = 'full'; }); await settle(page);
      if (dispose) await dispose(page);
    }
    assert.deepEqual(errors, [], 'no console/page/CSP errors');
    const results = { view, synthetic: true, viewport: [1280, 900], themes: ['light', 'dark'], dialogs: dialogs.length, errors };
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    return results;
  } finally { await session.close(); }
}

function interfaceInventory() {
  const read = name => ts.createSourceFile(name, fs.readFileSync(path.join(ROOT, name), 'utf8'), ts.ScriptTarget.Latest, true);
  const preload = read('src/quota/preload.js'), contracts = read('ui/src/data/bridges.ts');
  const declared = new Map(contracts.statements.filter(ts.isInterfaceDeclaration).map(node => [node.name.text, node]));
  const names = { usageTransport: 'UsageBridge', quotaBridge: 'QuotaBridge', windowBridge: 'WindowBridge' }, rows = [];
  const handlers = ['src/quota/main.js', 'src/quota/window-shell.js', 'src/quota/config-health-service.js', 'src/quota/resource-ipc.js', 'src/quota/provider-service.js', 'src/quota/agent-setup.js', 'src/quota/agent-install-service.js', 'src/quota/runtime-discovery-ipc.js', 'src/quota/antigravity-setup.js'];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'exposeInMainWorld') {
      const name = node.arguments[0]?.text, target = names[name], object = node.arguments[1]?.arguments?.[0];
      if (target && object && ts.isObjectLiteralExpression(object)) {
        const members = declared.get(target).members;
        assert.deepEqual(members.map(member => member.name.text).sort(), object.properties.map(property => property.name.text).sort(), target + ' exactly matches preload keys');
        for (const property of object.properties) {
          const member = members.find(member => member.name.text === property.name.text), method = property.initializer;
          const signature = ts.isMethodSignature(member) ? member : null;
          if (signature) assert.equal(signature.parameters.length, method.parameters.length, target + '.' + property.name.text + ' argument count');
          else assert.equal(method.parameters.length, 1, target + '.' + property.name.text + ' subscription callback argument');
          const channel = /ipcRenderer\.(?:invoke|on)\('([^']+)'/.exec(method.getText(preload))?.[1];
          let handler;
          for (const file of handlers) {
            const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/);
            const line = lines.findIndex(text => channel?.startsWith('usage:config:') ? file.endsWith('config-health-service.js') && text.includes("ipcMain.handle('usage:config:'") : text.includes("'" + channel + "'"));
            if (line >= 0) { handler = file + ':' + (line + 1); break; }
          }
          assert.ok(handler, 'existing handler/event source: ' + channel);
          rows.push({ bridge: target, method: property.name.text, channel, handler, preload: 'src/quota/preload.js:' + (preload.getLineAndCharacterOfPosition(property.getStart()).line + 1), declaration: 'ui/src/data/bridges.ts:' + (contracts.getLineAndCharacterOfPosition(member.getStart()).line + 1), type: member.getText(contracts) });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(preload); assert.equal(new Set(rows.map(row => row.bridge)).size, 3);
  fs.writeFileSync(path.join(OUTPUT, 'bridge-inventory.json'), JSON.stringify(rows, null, 2));
  return rows;
}

function globalInventory() {
  const modules = {
    displayValues: 'design/desktop-reference/display-values.js', pricingLabels: 'src/m1/pricing-labels.js', uiPricing: 'design/desktop-reference/pricing-data.js', uiPricingView: 'design/desktop-reference/pricing-view.js',
    costTable: 'src/m1/cost-table.js', costInsights: 'src/m1/cost-insights.js', costChart: 'design/desktop-reference/cost-chart.js', usageMath: 'src/m1/usage-math.js', insightsMath: 'src/m1/insights-math.js',
    agentCatalog: 'src/m1/agent-catalog.js', connectionState: 'src/quota/connection-state.js', snapshotCodec: 'src/m1/snapshot-codec.js', chartUi: 'design/desktop-reference/chart-ui.js',
    pricingEditorModel: 'design/desktop-reference/pricing-editor-model.js', profileModel: 'design/desktop-reference/profile-model.js', codexMaintenanceModel: 'design/desktop-reference/codex-maintenance-model.js'
  };
  const file = path.join(ROOT, 'ui/src/data/globals.ts'), text = fs.readFileSync(file, 'utf8'), source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const interfaces = new Map(source.statements.filter(ts.isInterfaceDeclaration).map(node => [node.name.text, node]));
  const properties = {};
  function find(node) { if (ts.isInterfaceDeclaration(node) && node.name.text === 'Window') for (const member of node.members) properties[member.name.text] = member.type; ts.forEachChild(node, find); }
  find(source);
  function memberNames(name) { const node = interfaces.get(name); return [...node.members.map(member => member.name.text), ...(node.heritageClauses || []).flatMap(clause => clause.types.flatMap(type => memberNames(type.expression.getText(source))))]; }
  const rows = [];
  for (const [name, relative] of Object.entries(modules)) {
    const api = require(path.join(ROOT, relative)), declared = memberNames(properties[name].typeName.text);
    assert.deepEqual(declared.sort(), Object.keys(api).sort(), name + ': declared members match existing module');
    rows.push({ name, source: relative, members: declared });
  }
  assert.equal(properties.usageInsights, undefined, 'M7 retired the legacy activity DOM renderer');
  assert.ok(properties.usageModels, 'usage per model declared');
  rows.push({ name: 'usageModels', source: 'design/desktop-reference/preview.js (window.usageModels, usage-models event)', members: [], kind: 'legacy-data' });
  assert.deepEqual(Object.keys(properties).sort(), rows.map(row => row.name).sort());
  fs.writeFileSync(path.join(OUTPUT, 'globals-inventory.json'), JSON.stringify(rows, null, 2));
  return rows;
}

async function hookSelfCheck() {
  const directory = path.join(ROOT, '.cache/ui-tools/m2-hook-check-' + process.pid);
  assert.equal(path.relative(path.join(ROOT, '.cache/ui-tools'), directory).startsWith('..'), false);
  fs.mkdirSync(directory, { recursive: true });
  const entry = path.join(directory, 'entry.ts');
  const moduleUrl = file => JSON.stringify(path.join(ROOT, file).replaceAll('\\', '/'));
  // Only synthetic deferred promises and DOM flags; no real bridge methods.
  fs.writeFileSync(entry, `import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useBridge, getUsageBridge } from ${moduleUrl('ui/src/data/bridges.ts')};
import { useViewActive, useDarkTheme } from ${moduleUrl('ui/src/data/shell.ts')};
import { getGlobals } from ${moduleUrl('ui/src/data/globals.ts')};
const listeners = new Set(), pending = [];
let stops = 0, reload, setOptions;
const read = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
const subscribe = listener => { listeners.add(listener); return () => { stops++; listeners.delete(listener); }; };
function Check() {
  const [options, set] = useState({ enabled: false, requestKey: 'a' }); setOptions = set;
  const state = useBridge(read, { ...options, subscribe }); reload = state.reload;
  const active = useViewActive('usage'), dark = useDarkTheme();
  return createElement('output', { id: 'state' }, JSON.stringify({ status: state.status, loading: state.loading, data: state.data, error: state.error?.message, active, dark }));
}
const root = createRoot(document.getElementById('host')); root.render(createElement(Check));
const marker = { token: 'synthetic' }; window.usageBridge = marker; window.displayValues = { usd: () => 'existing' };
window.hookCheck = { set: value => setOptions(value), notify: () => { for (const listener of listeners) listener(); }, resolve: (index, value) => pending[index].resolve(value), reject: index => pending[index].reject(Error('SYNTHETIC_FAILURE')), info: () => ({ reads: pending.length, subscriptions: listeners.size, stops }), reload: () => reload(), unmount: () => root.unmount(), identity: () => getUsageBridge() === marker && getGlobals().displayValues === window.displayValues };
`);
  const { build } = await import('vite');
  await build({ configFile: false, logLevel: 'silent', root: ROOT, define: { 'process.env.NODE_ENV': JSON.stringify('production') }, build: { outDir: path.join(directory, 'bundle'), emptyOutDir: false, lib: { entry, name: 'DataHookCheck', formats: ['iife'], fileName: () => 'check.js' }, sourcemap: false } });
  const html = path.join(directory, 'check.html');
  fs.writeFileSync(html, '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\';script-src \'self\';connect-src \'none\'"><body><main id="main" data-current-view="usage"></main><div id="host"></div><script src="bundle/check.js"></script></body>');
  const session = await launch(), { app } = session;
  let page;
  const errors = [];
  try {
    const opened = app.waitForEvent('window');
    await app.evaluate(({ BrowserWindow }, file) => { const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } }); void window.loadFile(file); }, html);
    page = await opened;
    page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.waitForFunction(() => Boolean(window.hookCheck && document.getElementById('state')));
    const state = () => page.locator('#state').evaluate(element => JSON.parse(element.textContent));
    assert.equal((await state()).status, 'idle'); assert.equal((await page.evaluate(() => window.hookCheck.info())).reads, 0);
    assert.equal(await page.evaluate(() => window.hookCheck.identity()), true, 'thin getters preserve object identity');
    await page.evaluate(() => window.hookCheck.set({ enabled: true, requestKey: 'a' }));
    await until(page, () => window.hookCheck.info().reads === 1);
    assert.equal((await state()).status, 'loading');
    await page.evaluate(() => { for (let i = 0; i < 8; i++) window.hookCheck.notify(); });
    assert.equal((await page.evaluate(() => window.hookCheck.info())).reads, 1, 'coalesce in-flight updates');
    await page.evaluate(() => window.hookCheck.resolve(0, { amount: '0.10000000000000000001', missing: null }));
    await until(page, () => window.hookCheck.info().reads === 2);
    await page.evaluate(() => window.hookCheck.resolve(1, { amount: '0.10000000000000000001', missing: null }));
    await until(page, () => JSON.parse(document.getElementById('state').textContent).status === 'ready');
    assert.deepEqual((await state()).data, { amount: '0.10000000000000000001', missing: null });
    await page.evaluate(() => { void window.hookCheck.reload(); });
    await until(page, () => window.hookCheck.info().reads === 3);
    await page.evaluate(() => window.hookCheck.reject(2));
    await until(page, () => JSON.parse(document.getElementById('state').textContent).status === 'error');
    assert.equal((await state()).error, 'SYNTHETIC_FAILURE'); assert.equal((await state()).data.missing, null, 'error keeps previous data');
    await page.evaluate(() => { void window.hookCheck.reload(); });
    await until(page, () => window.hookCheck.info().reads === 4);
    await page.evaluate(() => window.hookCheck.set({ enabled: true, requestKey: 'b' }));
    await until(page, () => window.hookCheck.info().reads === 5);
    assert.equal((await state()).data, null, 'a new request scope does not display the old scope data');
    await page.evaluate(() => { window.hookCheck.resolve(4, { generation: 'b', missing: null }); window.hookCheck.resolve(3, { generation: 'stale-a' }); });
    await until(page, () => JSON.parse(document.getElementById('state').textContent).status === 'ready');
    assert.equal((await state()).data.generation, 'b');
    await page.evaluate(() => { document.body.classList.add('dark'); document.getElementById('main').dataset.currentView = 'cost'; window.dispatchEvent(new CustomEvent('ui-view-change', { detail: 'cost' })); });
    await until(page, () => JSON.parse(document.getElementById('state').textContent).dark === true);
    assert.equal((await state()).active, false);
    await page.evaluate(() => window.hookCheck.set({ enabled: false, requestKey: 'b' }));
    await until(page, () => window.hookCheck.info().subscriptions === 0);
    assert.equal((await state()).status, 'idle');
    const before = await page.evaluate(() => window.hookCheck.info()); await page.evaluate(() => window.hookCheck.notify());
    assert.equal((await page.evaluate(() => window.hookCheck.info())).reads, before.reads);
    await page.evaluate(() => window.hookCheck.set({ enabled: true, requestKey: 'unmount' }));
    await until(page, () => window.hookCheck.info().reads === 6);
    await page.evaluate(() => { window.hookCheck.unmount(); window.hookCheck.resolve(5, { generation: 'after-unmount' }); });
    assert.equal(await page.locator('#state').count(), 0);
    const after = await page.evaluate(() => window.hookCheck.info());
    assert.equal(after.subscriptions, 0);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(OUTPUT, 'hook-results.json'), JSON.stringify({ synthetic: true, reads: after.reads, stops: after.stops, errors, checks: ['disabled-idle', 'loading', 'coalescing', 'precision-null', 'error-retains-data', 'new-scope-clears-old-data', 'stale-generation', 'theme-view', 'unsubscribe', 'unmount-with-pending-read', 'getter-identity'] }, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(OUTPUT, 'hook-failure.json'), JSON.stringify({ message: error.message, errors, dom: page ? await page.locator('body').textContent().catch(() => '') : null }, null, 2));
    throw error;
  } finally { if (page) await page.close(); await session.close(); await cleanup(directory); }
}

async function selfCheck() {
  fs.mkdirSync(OUTPUT, { recursive: true }); interfaceInventory(); globalInventory(); await hookSelfCheck();
  await runPageSmoke({ view: 'usage', ready: '#m2ProbeHost [data-probe]', dialogs: [{ trigger: '#m2ProbeHost [data-probe-open]', dialog: '[data-ui-portal] [role="dialog"]' }],
    prepare: page => page.evaluate(() => {
      const host = document.createElement('div'); host.id = 'm2ProbeHost'; Object.assign(host.style, { position: 'fixed', right: '24px', bottom: '24px', zIndex: '20', width: '360px' });
      document.body.appendChild(host); window.m2Probe = window.agentUi.mount('probe', host);
    }),
    dispose: page => page.evaluate(() => { window.m2Probe.unmount(); document.getElementById('m2ProbeHost').remove(); }),
    assertPage: async page => { assert.equal(await page.locator('#m2ProbeHost [data-value="unknown"]').textContent(), '未知'); }
  });
  console.log('PASS: M2 bridge inventory, real hook lifecycle, and page smoke template in isolated synthetic windows.');
}
module.exports = { runPageSmoke, interfaceInventory, globalInventory, hookSelfCheck };
if (require.main === module) selfCheck().catch(error => { console.error(error.stack); process.exitCode = 1; });
