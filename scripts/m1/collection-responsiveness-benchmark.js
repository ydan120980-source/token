'use strict';
/* global document */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const build = require('./collection-benchmark-fixture');
const { cleanup, isolatePointer, showView, until } = require('./ui-settle');
const { desktopReadiness } = require('./desktop-readiness');
const { measureCollection, measureIdleNavigation } = require('./collection-interaction');
const { Store } = require('../../src/m1/store');

async function run() {
  const source = path.resolve(process.env.PERF_SOURCE_ROOT || '.');
  const output = path.resolve(process.env.PERF_OUTPUT || 'artifacts/collection-responsiveness-benchmark');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collection-responsiveness-'));
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const report = {
    syntheticOnly: true, desktopAdmission: desktopReadiness(), samples: {}, errors: [],
    inputs: Object.fromEntries([__filename, require.resolve('./collection-interaction'), require.resolve('./collection-benchmark-fixture')].map(file => [path.basename(file), hash(file)])),
    source: Object.fromEntries(['design/desktop-reference/preview.js', 'design/desktop-reference/ui/agent-ui.js', 'design/desktop-reference/ui/agent-ui.css', 'src/m1/worker.js', 'src/m1/service.js', 'src/m1/store.js', 'src/m1/native.js', 'src/m1/sources.js', 'src/m1/statistics-worker.js'].map(file => [file, hash(path.join(source, file))])),
  };
  fs.mkdirSync(output, { recursive: true });
  const save = () => fs.writeFileSync(path.join(output, 'collection.json'), JSON.stringify(report, null, 2));
  let app;
  try {
    assert(report.desktopAdmission.eligible, 'DESKTOP_UNAVAILABLE');
    const fixture = build(root, 2000), usage = path.join(root, 'usage');
    new Store(usage, fixture.roots).setEnabled(false);
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(source, 'src/quota/main.js'), '--usage-data-dir', usage, '--quota-data-dir', path.join(root, 'quota'), '--m1-fixture-root', fixture.home], timeout: 60000 });
    const page = await app.firstWindow();
    page.on('pageerror', () => report.errors.push('RENDERER_ERROR'));
    await page.waitForURL(/^file:/);
    await until(page, () => window.usageData?.ready());
    await isolatePointer(app);
    report.display = await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0], display = screen.getDisplayMatching(win.getBounds());
      let losses = 0; win.on('blur', () => losses++);
      globalThis.collectionWindowState = () => ({ focused: win.isFocused(), visible: win.isVisible(), losses });
      return { ...globalThis.collectionWindowState(), scale: display.scaleFactor, refresh: display.displayFrequency, window: win.getBounds() };
    });
    await showView(page, 'usage');
    const take = async (name, expected, tokens, overlap = false) => {
      const interaction = await measureCollection(page, { expected: name === 'quiet' ? null : expected, overlap });
      const { owner } = await page.evaluate(() => window.usageBridge.statisticsDiagnostics());
      const ledger = JSON.parse(fs.readFileSync(path.join(usage, 'statistics.json'), 'utf8'));
      const records = Object.values(ledger.records);
      assert(!interaction.statusError);
      assert.equal(records.length, expected);
      assert.equal(records.reduce((total, record) => total + record.totalTokens, 0), tokens);
      for (const agent of ['codex', 'claude']) assert.equal(ledger.statuses[agent].nativeVerification, 'passed');
      const hash = crypto.createHash('sha256');
      for (const row of records.map(record => JSON.stringify([record.agent, record.entry, record.timestamp, record.model, record.totalTokens, record.inputUncached, record.output, record.cacheRead, record.cacheWrite, record.reasoning, record.quality])).sort()) hash.update(row + '\n');
      const view = await page.evaluate(() => {
        const rows = window.usageData.rows();
        return { readout: document.querySelector('[data-usage-total-tokens]')?.textContent?.length > 0, rows: rows.length, pricedRows: rows.filter(row => Number.isFinite(row.estimatedCostUsd)).length, cost: rows.reduce((n, row) => n + (row.estimatedCostUsd ?? 0), 0) };
      });
      assert(view.readout && view.rows > 0);
      report.samples[name] = { ...interaction, records: expected, tokens, semantic: hash.digest('hex'), view, stages: owner.collectionStages, storage: owner.storage, projection: owner.projection };
      save();
    };
    await take('cold', fixture.usageRows, fixture.usageRows * 120, true);
    report.idleNavigation = await measureIdleNavigation(page);
    assert(!report.idleNavigation.collecting);
    await take('quiet', fixture.usageRows, fixture.usageRows * 120);
    fs.appendFileSync(fixture.oneFile, JSON.stringify({
      timestamp: '2026-11-04T00:00:00Z', type: 'event_msg', payload: { type: 'token_count', info: { model: 'gpt-5-codex',
        total_token_usage: { input_tokens: 9000, output_tokens: 900 }, last_token_usage: { input_tokens: 90, output_tokens: 9, cached_input_tokens: 0 } } },
    }) + '\n');
    await take('incremental', fixture.usageRows + 1, fixture.usageRows * 120 + 99, true);
    report.windowEnd = await app.evaluate(() => globalThis.collectionWindowState());
    report.desktopEnd = desktopReadiness();
    report.measurementEligible = report.display.focused && report.windowEnd.focused && report.windowEnd.visible && report.windowEnd.losses === 0 && report.desktopEnd.eligible && !report.errors.length;
    console.log(JSON.stringify({ measurementEligible: report.measurementEligible, cold: report.samples.cold.ready, quiet: report.samples.quiet.ready, incremental: report.samples.incremental.ready }));
  } catch (error) {
    report.failure = error.message;
    throw error;
  } finally {
    save();
    await app?.close();
    await cleanup(root);
  }
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
