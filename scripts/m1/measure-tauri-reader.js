'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');
const { desktopReadiness } = require('./desktop-readiness');

const [exe, output, ...args] = process.argv.slice(2);
if (!exe || !output || args.join(' ') !== '--real-sources codex,claude') {
  console.error('Usage: node scripts/m1/measure-tauri-reader.js <exe> <report.json> --real-sources codex,claude');
  process.exit(2);
}

const report = {
  schemaVersion: 'TauriReaderMemoryV1', realData: true, rawContentSaved: false,
  samplePeriodMs: 100, trayBudgetBytes: 15000000, activeBudgetMiB: 500, stages: {}
};
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'quotadock-tauri-probe-'));
const python = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const reportPath = path.resolve(output);
const stopFile = path.join(scratch, 'stop');
const memory = [];
let app, sampler, browser, endpoint;
let step = 'desktop';

async function waitFor(check, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (app && app.exitCode !== null) throw Error('APP_EXITED');
    const result = await check();
    if (result) return result;
    await delay(150);
  }
  throw Error('WAIT_TIMEOUT');
}

function profilePort() {
  for (const name of fs.readdirSync(scratch)) {
    if (!name.startsWith('quotadock-reader-')) continue;
    for (const folder of ['WebView2/EBWebView', 'WebView2']) {
      const file = path.join(scratch, name, folder, 'DevToolsActivePort');
      if (fs.existsSync(file)) return Number(fs.readFileSync(file, 'utf8').split(/\r?\n/)[0]);
    }
  }
  return 0;
}

async function attach() {
  endpoint = await waitFor(async () => {
    const port = profilePort();
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return false;
    const url = 'http://127.0.0.1:' + port;
    try {
      const response = await fetch(url + '/json/version', { signal: AbortSignal.timeout(400) });
      return response.ok && url;
    } catch { return false; }
  }, 150000);
  browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw Error('WEBVIEW_PAGE_MISSING');
  page.on('pageerror', error => {
    report.pageErrors = (report.pageErrors || 0) + 1;
    const match = /\b(agent-ui|preview|sessions-host|sources-host)\.js:(\d+):(\d+)/.exec(error.stack || '');
    if (match) (report.errorLocations ??= []).push([match[1], Number(match[2]), Number(match[3])]);
  });
  page.setDefaultTimeout(15000);
  await page.waitForFunction(() => Boolean(window.usageTransport && window.sessionsHost));
  return page;
}

function summarize(samples) {
  if (samples.length < 5) throw Error('MEMORY_SAMPLES_MISSING');
  const peak = field => Math.round(Math.max(...samples.map(row => row[field])) * 100) / 100;
  return {
    samples: samples.length,
    processes: Math.max(...samples.map(row => row.pids.length)),
    peakPrivateWorkingMiB: peak('privateWorkingMiB'),
    peakPrivateCommitMiB: peak('privateMiB'),
    peakHostWorkingMiB: Math.round(100 * Math.max(...samples.map(row =>
      row.processes.find(process => process.pid === app.pid).privateWorkingMiB))) / 100
  };
}

function processRoles(pids) {
  const filter = pids.filter(pid => Number.isInteger(pid) && pid > 0).map(pid => 'ProcessId=' + pid).join(' OR ');
  if (!filter) return [];
  const command = `Get-CimInstance Win32_Process -Filter '${filter}' -ErrorAction Stop | ForEach-Object {
    if ($_.Name -eq 'quotadock-desktop.exe') { 'host' }
    elseif ($_.Name -in @('conhost.exe','OpenConsole.exe')) { 'console' }
    elseif ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match '--type=crashpad-handler(?:\\s|$)') { 'webview2-crash-reporter' }
    elseif ($_.Name -eq 'msedgewebview2.exe') { 'webview2' }
    else { 'other' }
  }`;
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true, encoding: 'utf8', timeout: 8000
    }).trim().split(/\r?\n/).filter(Boolean);
  } catch { return []; }
}

async function stage(name, run) {
  step = name;
  const at = Date.now(), started = performance.now();
  const result = await run();
  const actionMs = Math.round(performance.now() - started);
  await delay(1700);
  report.stages[name] = { ...result, ...summarize(memory.filter(row => row.complete && row.at >= at)), actionMs };
}

async function openSessions(page) {
  await page.locator('[data-view="sessions"]').click();
  await page.waitForFunction(() => {
    const state = window.sessionsHost.get();
    return Boolean(state.list && !state.loading && !state.error);
  });
  await page.getByRole('tab', { name: '全部', exact: true }).click();
  await page.waitForFunction(() => {
    const state = window.sessionsHost.get();
    return state.range === 'all' && !state.loading && !state.error;
  });
}

async function readSessions(page, paneCount) {
  const selected = await page.evaluate(count => {
    const host = window.sessionsHost;
    const rows = host.list().sessions.filter(row => host.readable(row.agent));
    const sorted = rows.toSorted((a, b) => records(b) - records(a));
    const picked = count === 3
      ? [...sorted.filter(row => row.agent === 'claude').slice(0, 2), ...sorted.filter(row => row.agent === 'codex').slice(0, 1)]
      : sorted.slice(0, count);
    function records(row) { return row.days.reduce((sum, day) => sum + day.records, 0); }
    if (picked.length !== count) return [];
    host.read(picked[0]);
    for (const row of picked.slice(1)) host.readAlso(row);
    return picked.map(row => ({ agent: row.agent, ledgerRecords: records(row) }));
  }, paneCount);
  if (selected.length !== paneCount) throw Error('REAL_SESSION_MISSING');
  const drawn = await page.waitForFunction(count => {
    const root = window.document.querySelector('[data-reader-panes="' + count + '"]');
    if (!root || [...root.querySelectorAll('[data-reader-scroll]')]
      .filter(pane => pane.querySelector('[data-reader-turn]')).length !== count) return false;
    return root.querySelectorAll('[data-reader-turn]').length;
  }, paneCount, { timeout: 90000 });
  return { selected, visibleTurns: await drawn.jsonValue() };
}

async function closeMain(page) {
  await page.evaluate(() => {
    setTimeout(() => void window.__TAURI__.core.invoke('probe_close').catch(() => {}), 25);
  }).catch(() => {});
  await waitFor(async () => {
    let endpointGone = false;
    try { await fetch(endpoint + '/json/version', { signal: AbortSignal.timeout(400) }); }
    catch { endpointGone = true; }
    report.afterClose = { endpointGone, pageClosed: page.isClosed() };
    return endpointGone && page.isClosed();
  });
  if (browser.isConnected()) await browser.close();
  const closedAt = Date.now();
  await waitFor(() => {
    const samples = memory.slice(-10);
    if (Date.now() - closedAt > 15000) return true;
    return samples.length === 10 && samples.every(row => row.at >= closedAt && row.complete && row.pids.length === 1);
  }, 17000);
}

async function main() {
  report.desktopStart = desktopReadiness();
  if (!report.desktopStart.eligible) throw Error('DESKTOP_NOT_ELIGIBLE');
  step = 'launch';
  app = spawn(path.resolve(exe), ['--probe', ...args], {
    stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true,
    env: { ...process.env, TMP: scratch, TEMP: scratch }
  });
  // Store only controlled error codes. Browser/driver diagnostics can contain session data.
  const codes = [];
  readline.createInterface({ input: app.stderr }).on('line', line => {
    if (/^READER_[A-Z_]+$/.test(line)) codes.push(line);
  });
  report.hostErrors = codes;
  await once(app, 'spawn');
  sampler = spawn(python, [path.join(__dirname, 'windows-memory-sampler.py'), '--pid',
    String(app.pid), '--stop-file', stopFile], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  readline.createInterface({ input: sampler.stdout }).on('line', line => {
    try { memory.push(JSON.parse(line)); } catch { /* An incomplete sample is excluded. */ }
  });
  await once(sampler, 'spawn');
  let page = await attach();
  report.display = await page.evaluate(() => ({
    scale: window.devicePixelRatio, contentWidth: window.innerWidth, contentHeight: window.innerHeight
  }));
  report.cold = summarize(memory.filter(row => row.complete));
  await stage('overview', async () => {
    await page.locator('[data-app-root] [data-view="sessions"]').waitFor();
    const status = await page.evaluate(async () => {
      const state = await window.usageTransport.get();
      return { schema: state.snapshot?.schemaVersion, rows: state.snapshot?.daily?.length ?? 0 };
    });
    if (status.schema !== 'LocalUsagePreviewV1' || !status.rows) throw Error('REAL_USAGE_EMPTY');
    return { usageRows: status.rows };
  });
  await stage('sessions', async () => openSessions(page));
  await stage('readerOne', async () => readSessions(page, 1));
  await stage('readerThree', async () => {
    await page.locator('[data-reader-back] button').click();
    return readSessions(page, 3);
  });
  await stage('returnToList', async () => {
    await page.locator('[data-reader-back] button').click();
    await page.locator('[data-sessions-page]').waitFor();
  });
  step = 'destroy';
  await closeMain(page);
  await stage('tray', async () => ({ webviewGone: true, roles: processRoles(memory.at(-1).pids) }));
  report.trayTargetPassed = report.stages.tray.roles.length === 1 && report.stages.tray.roles[0] === 'host' &&
    report.stages.tray.processes === 1 &&
    report.stages.tray.peakPrivateWorkingMiB <= report.trayBudgetBytes / 1048576;
  await stage('reopen', async () => {
    app.stdin.write('open\n');
    page = await attach();
    await openSessions(page);
    return readSessions(page, 1);
  });
  report.activeTargetPassed = Object.entries(report.stages).filter(([name]) => name !== 'tray')
    .every(([, stage]) => stage.peakPrivateWorkingMiB <= report.activeBudgetMiB);
  report.desktopEnd = desktopReadiness();
  step = 'reopen-close';
  await closeMain(page);
  report.runComplete = true;
}

async function stop(child, command, timeout) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (command) child.stdin.end(command);
  await Promise.race([once(child, 'exit'), delay(timeout)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await once(child, 'exit');
  }
}

main().catch(() => {
  report.failedStage = step;
  if (memory.filter(row => row.complete).length >= 5) report.observed = summarize(memory.filter(row => row.complete));
  process.exitCode = 1;
}).finally(async () => {
  await stop(app, 'quit\n', 8000);
  fs.writeFileSync(stopFile, '');
  await stop(sampler, null, 2000);
  try {
    const owned = fs.realpathSync(scratch);
    if (path.dirname(owned) !== fs.realpathSync(os.tmpdir()) ||
        !path.basename(owned).startsWith('quotadock-tauri-probe-')) throw Error('PROBE_PATH_INVALID');
    fs.rmSync(owned, { recursive: true, maxRetries: 20, retryDelay: 100 });
    report.scratchRemoved = true;
  } catch (error) {
    report.scratchRemoved = false;
    report.cleanupCode = ['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES', 'ENOENT'].includes(error.code) ? error.code : 'PROBE_CLEANUP_FAILED';
    process.exitCode = 1;
  }
  report.measurementEligible = Boolean(report.runComplete && report.desktopEnd?.eligible &&
    !report.pageErrors && !report.hostErrors?.length && report.scratchRemoved && app?.exitCode === 0);
  if (!report.measurementEligible) process.exitCode = 1;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
});
