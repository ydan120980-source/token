'use strict';
/* global document, innerWidth, innerHeight, devicePixelRatio */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium, _electron: electron } = require('playwright');
const { desktopReadiness } = require('./desktop-readiness');
const { seed } = require('./memory-gate-fixture');

const [runtime, executable, output, scenario = 'reader'] = process.argv.slice(2);
assert(['tauri', 'electron'].includes(runtime) && executable && output,
  'Usage: node scripts/m1/measure-memory-gate.js tauri|electron <exe> <output-directory> [reader|empty|cold]');
assert(['reader', 'empty', 'cold'].includes(scenario), 'INVALID_SCENARIO');
const exe = path.resolve(executable);
const out = path.resolve(output);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'quotadock-memory-gate-'));
const home = path.join(scratch, 'home');
const stopFile = path.join(scratch, 'stop');
const python = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const exec = promisify(execFile);
const memory = [], hostReplies = [];
const report = { runtime, scenario, syntheticOnly: true, sampleMs: 100, nativeDpi: true, stages: {}, pageErrors: 0 };
const motionOff = process.env.QUOTADOCK_MEMORY_GATE_MOTION === 'off';
let app, child, sampler, browser, page, cdp, pid, step, endpoint;

async function waitFor(test, code, timeout = 25_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await test();
    if (value) return value;
    if (child && child.exitCode !== null) throw Error('PROCESS_EXITED');
    await delay(100);
  }
  throw Error(code);
}

async function sampleHost(withRegions = false) {
  let state;
  if (runtime === 'tauri') {
    const next = hostReplies.length;
    child.stdin.write('memory\n');
    state = await waitFor(() => hostReplies[next], 'HOST_PROBE_TIMEOUT', 5000);
  } else {
    state = await app.evaluate(({ app: host, BrowserWindow }) => ({
      windows: BrowserWindow.getAllWindows().length,
      visible: BrowserWindow.getAllWindows().some(w => w.isVisible()),
      heap: process.memoryUsage(),
      roles: host.getAppMetrics().map(({ pid, type }) => ({ pid, type })),
    }));
  }
  if (withRegions) {
    const regions = await exec(python, [path.join(__dirname, 'windows-memory-regions.py'), String(pid)],
      { windowsHide: true, timeout: 6000 });
    state.regions = JSON.parse(regions.stdout);
  }
  return state;
}

async function browserSample() {
  const dom = await cdp.send('Memory.getDOMCounters').catch(() => null);
  const metrics = await cdp.send('Performance.getMetrics');
  const roles = browser ? await browser.newBrowserCDPSession().then(async session => {
    try {
      const result = await session.send('SystemInfo.getProcessInfo');
      return result.processInfo.map(({ id, type }) => ({ pid: id, type }));
    } finally { await session.detach(); }
  }).catch(() => null) : null;
  const detached = await cdp.send('DOM.getDetachedDomNodes').then(result => result.detachedNodes?.length ?? null).catch(() => null);
  const ui = await page.evaluate(() => {
    const state = window.sessionsHost?.get();
    return { mountedPanes: document.querySelectorAll('[data-reader-scroll]').length,
      visibleTurns: document.querySelectorAll('[data-reader-turn]').length,
      connectedElements: document.querySelectorAll('*').length,
      listRows: state?.list?.sessions?.length ?? null,
      fullListRows: state?.all?.sessions?.length ?? null,
      reading: Boolean(state?.reading), also: state?.also?.length ?? null };
  });
  return { dom, detached, roles, ui, metrics: Object.fromEntries(metrics.metrics
    .filter(row => /^(?:JSHeapUsedSize|JSHeapTotalSize|Nodes|Documents|LayoutCount|RecalcStyleCount)$/.test(row.name))
    .map(row => [row.name, row.value])) };
}

async function listAdmission() {
  return page.evaluate(() => {
    const state = window.sessionsHost.get();
    const counts = {};
    for (const item of state.list?.sessions ?? []) counts[item.agent] = (counts[item.agent] ?? 0) + 1;
    return { counts, rows: state.list?.sessions.length ?? 0, range: state.range, loading: state.loading,
      error: state.error, visible: Boolean(document.querySelector('[data-sessions-page]')) };
  });
}

function rows(start, end) {
  const interval = memory.filter(row => row.at >= start && row.at < end);
  const valid = interval.filter(row => row.complete);
  assert(valid.length >= 5, 'COUNTER_SAMPLES_MISSING');
  const peak = key => valid.reduce((largest, row) => row[key] > largest[key] ? row : largest);
  return { samples: valid.length, incomplete: interval.length - valid.length,
    peakWorking: peak('workingMiB'), peakPrivateWorking: peak('privateWorkingMiB'),
    peakCommit: peak('privateMiB'), settled: valid.at(-1) };
}

async function stage(name, action, options = {}) {
  step = name;
  const start = Date.now();
  await action();
  const actionMs = Date.now() - start;
  await delay(options.settle ?? 2200);
  const end = Date.now();
  const sampled = rows(start, end);
  report.stages[name] = { start, end, actionMs, ...sampled,
    host: await sampleHost(options.regions),
    ...(options.browser ? { browser: await browserSample() } : {}) };
}

function startSampler() {
  sampler = spawn(python, [path.join(__dirname, 'windows-memory-sampler.py'), '--pid', String(pid),
    '--stop-file', stopFile, '--detailed'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  readline.createInterface({ input: sampler.stdout }).on('line', line => {
    try { memory.push(JSON.parse(line)); } catch { /* Corrupt samples are excluded. */ }
  });
}

async function launch() {
  fs.mkdirSync(home);
  // Electron starts collection from its hidden BrowserWindow. Its cold control
  // uses a separate empty profile so it cannot scan the reader fixture early.
  if (runtime === 'electron' && scenario === 'reader') report.fixture = seed(home);
  const env = { ...process.env, TEMP: scratch, TMP: scratch };
  if (runtime === 'tauri') {
    child = spawn(exe, ['--probe', '--fixture', '--cold-tray'],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
    readline.createInterface({ input: child.stdout }).on('line', line => {
      try { hostReplies.push(JSON.parse(line)); } catch { /* Only structured probe data. */ }
    });
    child.stderr.resume();
    await once(child, 'spawn');
    pid = child.pid;
  } else {
    app = await electron.launch({ executablePath: exe, args: ['--hidden', '--desktop-shell-test',
      '--usage-data-dir', path.join(scratch, 'usage'), '--quota-data-dir', path.join(scratch, 'quota'),
      '--m1-fixture-root', home], timeout: 50_000, env });
    pid = await app.evaluate(() => process.pid);
    page = await app.firstWindow();
    await page.waitForURL(/^file:/);
  }
  startSampler();
  await waitFor(() => memory.some(row => row.complete), 'SAMPLER_START_FAILED');
}

async function showWindow() {
  step = 'showWindow';
  if (runtime === 'tauri') {
    child.stdin.write('open\n');
    endpoint = await waitFor(async () => {
      for (const name of fs.readdirSync(scratch).filter(name => name.startsWith('quotadock-reader-'))) {
        const file = path.join(scratch, name, 'WebView2', 'EBWebView', 'DevToolsActivePort');
        if (!fs.existsSync(file)) continue;
        const port = await fs.promises.readFile(file, 'utf8').then(raw => Number(raw.split(/\r?\n/)[0])).catch(() => 0);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) continue;
        const url = 'http://127.0.0.1:' + port;
        const response = await fetch(url + '/json/version', { signal: AbortSignal.timeout(400) }).catch(() => null);
        if (response?.ok) return url;
      }
      return false;
    }, 'WEBVIEW_NOT_READY', 40_000);
    step = 'attachWebview';
    browser = await chromium.connectOverCDP(endpoint, { timeout: 15_000 });
    page = await waitFor(() => browser.contexts()[0]?.pages()[0], 'WEBVIEW_PAGE_NOT_READY');
  } else {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(1480, 960);
      window.show();
      window.focus();
    });
  }
  step = 'attachRenderer';
  page.on('pageerror', () => { report.pageErrors++; });
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.waitForFunction(() => Boolean(window.sessionsHost && window.usageBridge));
  if (motionOff) {
    await page.evaluate(() => window.uiMotion.setPreference('off'));
    await page.waitForFunction(() => document.body.dataset.motion === 'off');
  }
  report.motion = await page.evaluate(() => document.body.dataset.motion);
  report.display = await page.evaluate(() => ({ scale: devicePixelRatio, width: innerWidth, height: innerHeight }));
  const version = await cdp.send('Browser.getVersion');
  report.rendererProduct = version.product;
  if (runtime === 'electron' && (report.display.width !== 1480 || report.display.height !== 960)) {
    const target = [1480 - Math.sign(report.display.width - 1480), 960 - Math.sign(report.display.height - 960)];
    await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), target);
    await delay(300);
    report.display = await page.evaluate(() => ({ scale: devicePixelRatio, width: innerWidth, height: innerHeight }));
  }
}

async function readPane(count) {
  const picked = await page.evaluate(count => {
    const host = window.sessionsHost;
    const items = host.list().sessions.filter(row => host.readable(row.agent))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, 3);
    if (items.length < 3) return items.length;
    if (count === 1) host.read(items[0]);
    else for (const item of items.slice(1)) host.readAlso(item);
    return items.length;
  }, count);
  assert.equal(picked, 3, 'SYNTHETIC_SESSIONS_MISSING');
  await page.waitForFunction(count => {
    const panes = [...document.querySelectorAll('[data-reader-scroll]')];
    return panes.length === count && panes.every(pane => pane.querySelector('[data-reader-turn]'));
  }, count, { timeout: 60_000 });
}

async function closeMain() {
  if (runtime === 'tauri') {
    await page.evaluate(() => {
      setTimeout(() => void window.__TAURI__.core.invoke('probe_close').catch(() => {}), 25);
    });
    await waitFor(async () => {
      const web = await fetch(endpoint + '/json/version', { signal: AbortSignal.timeout(500) }).catch(() => null);
      return page.isClosed() && !web && !memory.at(-1)?.processes?.some(p => p.name === 'msedgewebview2');
    }, 'WEBVIEW_DID_NOT_EXIT');
    const after = await sampleHost();
    await waitFor(() => sampleHost().then(row => row.storeLive === false), 'STORE_DID_NOT_DROP');
    assert.equal(after.mainWindow, false);
  } else {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await waitFor(() => app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().some(window => window.isVisible())), 'ELECTRON_WINDOW_VISIBLE');
  }
}

async function main() {
  step = 'desktop';
  report.desktopStart = desktopReadiness();
  assert(report.desktopStart.eligible, 'DESKTOP_NOT_ELIGIBLE');
  report.exeSha256 = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
  step = 'launch';
  await launch();
  const coldStage = runtime === 'electron' && scenario === 'reader' ? 'trayHiddenWithFixture' : 'trayCold';
  await stage(coldStage, async () => {}, { settle: 4500, regions: true });
  if (runtime === 'tauri') {
    const { host, peakPrivateWorking } = report.stages.trayCold;
    assert(!host.mainWindow && !host.webviewProfileCreated && host.storeLive === false, 'COLD_TRAY_INVALID');
    assert(!peakPrivateWorking.processes.some(process => process.name === 'msedgewebview2'), 'COLD_TRAY_HAS_WEBVIEW');
  }
  if (scenario === 'cold') {
    report.desktopEnd = desktopReadiness();
    report.complete = true;
    return;
  }
  if (runtime === 'tauri' && scenario === 'reader') report.fixture = seed(home);
  await stage('open', showWindow, { browser: true, regions: true });
  if (scenario === 'empty') {
    step = 'close';
    await closeMain();
    await stage('trayAfterEmpty', async () => {}, { settle: 4500, regions: true });
    report.desktopEnd = desktopReadiness();
    report.complete = true;
    return;
  }
  await stage('collect', async () => {
    report.usageAdmission = await page.evaluate(async () => {
      const result = await window.usageBridge.refresh();
      const state = result.snapshot ? result : await window.usageBridge.get(null);
      return { days: state.snapshot?.daily?.length ?? null, enabled: state.enabled,
        snapshot: Boolean(state.snapshot), collecting: state.collecting, error: Boolean(state.error) };
    });
    assert(!report.usageAdmission.error, 'SYNTHETIC_COLLECTION_FAILED');
  }, { browser: true, regions: true });
  await stage('listBefore', async () => {
    await page.evaluate(() => window.usageData.view('sessions'));
    step = 'listToday';
    await waitFor(async () => {
      report.listAdmission = await listAdmission();
      return report.listAdmission.visible && !report.listAdmission.loading && !report.listAdmission.error;
    }, 'SESSION_LIST_NOT_READY');
    step = 'listRange';
    await page.evaluate(() => window.sessionsHost.drillDown('all', 'all'));
    step = 'listRecords';
    await waitFor(async () => {
      report.listAdmission = await listAdmission();
      const { rows, range, loading, error } = report.listAdmission;
      return rows >= 3 && range === 'all' && !loading && !error;
    }, 'SYNTHETIC_SESSIONS_MISSING', 60_000);
  }, { browser: true });
  await stage('readerOne', () => readPane(1), { browser: true });
  await stage('readerThree', () => readPane(3), { browser: true });
  await stage('returnToList', async () => {
    await page.locator('[data-reader-back] button').evaluate(button => button.click());
    await page.locator('[data-sessions-page]').waitFor();
    await page.waitForFunction(() => !window.sessionsHost.get().reading && !document.querySelector('[data-reader-scroll]'));
  }, { browser: true });
  await stage('listIdle', async () => {}, { browser: true, settle: 8000 });
  step = 'close';
  await closeMain();
  await stage('trayAfterRead', async () => {}, { settle: 4500, regions: true });
  report.desktopEnd = desktopReadiness();
  report.complete = true;
}

main().catch(async error => {
  report.failure = { step, code: /^[A-Z][A-Z_]+$/.test(error.message) ? error.message : error.name };
  if (pid) report.failure.host = await sampleHost().catch(() => null);
  process.exitCode = 1;
}).finally(async () => {
  if (browser?.isConnected()) await browser.close().catch(() => {});
  if (app) await app.close().catch(() => {});
  if (child && child.exitCode === null) {
    const exit = once(child, 'exit');
    child.stdin.end('quit\n');
    await Promise.race([exit, delay(8000)]);
    if (child.exitCode === null) { report.forcedExit = true; child.kill(); await exit; }
  }
  if (sampler && sampler.exitCode === null) {
    const exit = once(sampler, 'exit');
    fs.writeFileSync(stopFile, '');
    await Promise.race([exit, delay(2000)]);
    if (sampler.exitCode === null) { sampler.kill(); await exit; }
  }
  const owned = fs.realpathSync(scratch);
  try {
    assert.equal(path.dirname(owned), fs.realpathSync(os.tmpdir()));
    assert(path.basename(owned).startsWith('quotadock-memory-gate-'));
    fs.rmSync(owned, { recursive: true, maxRetries: 15, retryDelay: 100 });
    report.scratchRemoved = true;
  } catch { report.scratchRemoved = false; }
  report.eligible = Boolean(report.complete && report.desktopStart?.eligible && report.desktopEnd?.eligible &&
    report.scratchRemoved && !report.forcedExit && !report.pageErrors);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, runtime + '.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(out, runtime + '.jsonl'), memory.map(row => JSON.stringify(row)).join('\n') + '\n');
  console.log(JSON.stringify({ runtime, eligible: report.eligible, failure: report.failure, stages: Object.keys(report.stages) }));
  if (!report.eligible) process.exitCode = 1;
});
