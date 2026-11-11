'use strict';
/* global document */
// Where one find request's time goes inside the running app: the IPC channels the reading page calls,
// with the parse cost and the queue cost separated. Synthetic records only.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron: electron } = require('playwright');
const { showView, settle, until, keepVisible, isolatePointer, cleanup } = require('./ui-settle');
const ROOT = path.resolve(process.env.CHANNEL_OUTPUT || path.join('artifacts', 'perf-20261103', 'channels'));

// Record how long each usage channel takes, without changing what it returns.
const hook = ({ ipcMain }) => {
  const handlers = ipcMain._invokeHandlers, log = [];
  globalThis.__channels = log;
  for (const [channel, fn] of handlers) {
    if (!channel.startsWith('usage:')) continue;
    handlers.set(channel, async (...args) => {
      const began = performance.now();
      try { return await fn(...args); }
      finally { log.push({ channel, ms: +(performance.now() - began).toFixed(1) }); }
    });
  }
};

(async () => {
  fs.mkdirSync(ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-channels-'));
  const report = { syntheticOnly: true, requests: {}, errors: [] };
  let app;
  try {
    const seeded = await require('../../tests/m1/multi-reader-memory-fixture').seedMemory(root);
    const { home, usage, longIds } = seeded;
    app = await electron.launch({
      executablePath: require('electron'),
      args: ['src/quota/main.js', '--usage-data-dir', usage, '--quota-data-dir', path.join(root, 'quota'), '--m1-fixture-root', home],
      timeout: 60000
    });
    await app.evaluate(hook);
    await isolatePointer(app);
    const page = await app.firstWindow();
    await keepVisible(app);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.waitForURL(/^file:/);
    await until(page, () => window.usageData.ready(), 60000);
    await showView(page, 'sessions');
    await page.getByRole('tablist', { name: '会话时间范围', exact: true }).getByRole('tab', { name: '全部', exact: true }).click();
    await until(page, () => Boolean(window.sessionsHost.get().list) && !window.sessionsHost.get().loading, 60000);

    const drain = () => app.evaluate(() => globalThis.__channels.splice(0).length);
    await drain();
    await page.evaluate(ids => { const host = window.sessionsHost, list = host.get().list.sessions; host.read(list.find(row => row.id === ids[0])); }, longIds);
    await page.locator('[data-reader-page]').waitFor();
    await page.waitForFunction(() => (document.querySelector('[data-reader-header]')?.textContent || '').includes('300 轮'), null, { timeout: 90000 });
    await settle(page);
    report.open = await app.evaluate(() => globalThis.__channels.splice(0));
    report.readerMs = await page.evaluate(() => {
      const host = window.sessionsHost, panes = host.get().panes ?? host.panes?.() ?? [];
      return { panes: panes.length };
    });

    // The three calls the reading page makes back to back, timed on their own.
    const call = async (name, script) => {
      await drain();
      const began = Date.now();
      const value = await page.evaluate(script);
      await settle(page);
      const channels = await app.evaluate(() => globalThis.__channels.splice(0));
      report.requests[name] = { totalMs: Date.now() - began, channels, value };
    };
    await call('transcript', async () => { const key = window.sessionsHost.get().reading.key; const t = await window.usageBridge.transcript(key); return { stamp: t.stamp, items: t.items.length }; });
    await call('transcriptFind', async () => { const key = window.sessionsHost.get().reading.key; const t = await window.usageBridge.transcript(key); const began = performance.now(); const f = await window.usageBridge.transcriptFind(key, { stamp: t.stamp, query: '合成内存测量段落' }); return { ms: +(performance.now() - began).toFixed(1), hits: f.hits.length, total: f.total }; });
    await call('transcriptPart', async () => { const key = window.sessionsHost.get().reading.key; const t = await window.usageBridge.transcript(key); const index = t.items.findIndex(item => typeof item.text === 'string' && item.text.length > 1200); const began = performance.now(); const p = await window.usageBridge.transcriptPart(key, { stamp: t.stamp, index, field: 'text', offset: 0 }); return { ms: +(performance.now() - began).toFixed(1), total: p.total }; });
    const idle = await app.evaluate(() => globalThis.__channels.splice(0).length);
    report.diagnostics = await page.evaluate(() => window.usageBridge.statisticsDiagnostics?.() ?? null);
    console.log(JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(ROOT, 'results.json'), JSON.stringify(report, null, 2));
    if (idle) console.log('leftover channel calls: ' + idle);
  } catch (error) {
    report.error = error.message;
    console.error(error);
    fs.writeFileSync(path.join(ROOT, 'results.json'), JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    if (app) await app.close().catch(() => {});
    await cleanup(root);
  }
})();
