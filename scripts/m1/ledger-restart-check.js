'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const readline = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');
const { identifier, version } = require('../../src-tauri/tauri.conf.json');
const { validate: validatePrice } = require('../../src/m1/pricing');
const { readStatistics } = require('../../src/m1/read-statistics');
const { writeStatistics } = require('../../src/m1/write-statistics');
const { desktopReadiness } = require('./desktop-readiness');
const { seed } = require('./memory-gate-fixture');
const { seedSqlite, usageFacts, fingerprint, electronFacts } = require('./sqlite-wal-gate-fixture');

const [executable, output, slice, warmFlag] = process.argv.slice(2);
const measureWarm = slice === 'm51' && warmFlag === '--measure-warm';
assert(warmFlag === undefined || measureWarm, 'INVALID_MEASUREMENT_OPTION');
assert(executable && output, 'Usage: node scripts/m1/ledger-restart-check.js <exe> <receipt.json>');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'quotadock-ledger-restart-'));
const home = path.join(scratch, 'home');
const appData = path.join(scratch, 'fixture-app-data');
const ledger = path.join(appData, identifier, 'usage', 'statistics.json');
const legacy = path.join(appData, 'AgentUsage-M1', 'statistics.json');
const legacyBytes = Buffer.from('{"syntheticLegacySentinel":true}');
const env = { ...process.env, TEMP: scratch, TMP: scratch };
const report = { schemaVersion: 'TauriLedgerRestartV1', syntheticOnly: true };
let child, browser, endpoint;
let stage = 'admission';

async function waitFor(check, code, timeout = 45000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    assert(child?.exitCode === null && child?.signalCode === null, 'HOST_EXITED');
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw Error(code);
}

async function launch() {
  child = spawn(path.resolve(executable), ['--probe', '--fixture', '--cold-tray', '--ledger-restart'], {
    stdio: ['pipe', slice === 'm51' ? 'pipe' : 'ignore', 'pipe'], env, windowsHide: true
  });
  child.stdin.on('error', () => {});
  readline.createInterface({ input: child.stderr }).on('line', line => {
    if (/^(READER|PROVIDER)_[A-Z_]+$/.test(line)) (report.hostErrors ??= []).push(line);
  });
  await once(child, 'spawn');
}

async function open() {
  child.stdin.write('open\n');
  endpoint = await waitFor(async () => {
    for (const name of fs.readdirSync(scratch).filter(name => name.startsWith('quotadock-reader-'))) {
      const portFile = path.join(scratch, name, 'WebView2', 'EBWebView', 'DevToolsActivePort');
      const value = await fs.promises.readFile(portFile, 'utf8').catch(() => '');
      const port = Number(value.split(/\r?\n/)[0]);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) continue;
      const url = 'http://127.0.0.1:' + port;
      const response = await fetch(url + '/json/version', { signal: AbortSignal.timeout(400) }).catch(() => null);
      if (response?.ok) return url;
    }
    return false;
  }, 'WEBVIEW_NOT_READY');
  browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
  const page = await waitFor(() => browser.contexts()[0]?.pages()[0], 'WEBVIEW_PAGE_MISSING');
  await page.waitForFunction(() => Boolean(window.usageBridge), null, { timeout: 30000 });
  return page;
}

async function close(page) {
  await page.evaluate(() => {
    setTimeout(() => void window.__TAURI__.core.invoke('probe_close').catch(() => {}), 25);
  }).catch(() => {});
  await waitFor(async () => {
    const http = await fetch(endpoint + '/json/version', { signal: AbortSignal.timeout(400) }).catch(() => null);
    return page.isClosed() && !http;
  }, 'WEBVIEW_NOT_DESTROYED');
  if (browser.isConnected()) await browser.close();
  await delay(1200);
}

async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit');
  child.stdin.end('quit\n');
  const graceful = await Promise.race([exit.then(() => true), delay(12000, false, { ref: false })]);
  if (!graceful) {
    child.kill();
    await exit;
  }
  if (!graceful || child.exitCode !== 0) report.hostExit = { graceful, code: child.exitCode };
  assert(graceful && child.exitCode === 0, 'HOST_QUIT_FAILED');
}

async function warmAfterRefresh() {
  const history = path.join(appData, identifier, 'quota', 'read-history.json');
  // The website fixture has no manual refresh before this point.
  await waitFor(async () => {
    const bytes = await fs.promises.readFile(history, 'utf8').catch(() => '{}');
    const rows = Object.values(JSON.parse(bytes));
    return rows.some(lines => lines.some(line => line.ok && line.automatic));
  }, 'AUTOMATIC_TRAY_REFRESH_MISSING', 90000);
  await delay(3000);
  const stopFile = path.join(scratch, 'stop-warm-sampler');
  const python = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const sampler = spawn(python, [path.join(__dirname, 'windows-memory-sampler.py'), '--pid',
    String(child.pid), '--stop-file', stopFile, '--detailed'],
  { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const lines = readline.createInterface({ input: sampler.stdout });
  const samples = [];
  lines.on('line', line => {
    try {
      const row = JSON.parse(line);
      if (row.complete) samples.push(row);
    } catch { /* Exclude incomplete sampler output. */ }
  });
  const finished = once(sampler, 'exit');
  try {
    await waitFor(() => samples.length >= 15 || sampler.exitCode !== null, 'TRAY_COUNTERS_MISSING', 12000);
    assert(samples.length >= 15, 'TRAY_COUNTERS_MISSING');
    assert(samples.every(row => row.pids.includes(child.pid)), 'TRAY_HOST_COUNTER_MISSING');
  } finally {
    lines.close();
    fs.writeFileSync(stopFile, '');
    if (!await Promise.race([finished.then(() => true), delay(3000, false, {ref: false})])) {
      sampler.kill();
      await finished;
    }
  }
  const peak = key => samples.reduce((largest, row) => row[key] > largest[key] ? row : largest);
  const webviews = new Map();
  for (const { processes } of samples) {
    for (const process of processes) {
      if (/^msedgewebview2(?:\.exe)?$/i.test(process.name)) webviews.set(process.pid, process);
    }
  }
  return {
    samples: samples.length,
    peakPrivateWorking: peak('privateWorkingMiB'),
    peakPrivateCommit: peak('privateMiB'),
    settled: samples.at(-1),
    webviewProcesses: [...webviews.values()],
    afterAutomaticRefresh: true,
  };
}

function published(page) {
  return page.evaluate(async () => {
    const usage = await window.usageBridge.get(null);
    const list = await window.usageBridge.sessions({ range: 'all' });
    const labels = await window.usageBridge.sessionLabels();
    return { revision: usage.snapshotRevision, daily: usage.snapshot?.daily ?? [], rows: list.sessions.length, labels };
  });
}

async function sqliteWalScenario() {
  const file = seedSqlite(scratch, home);
  const before = await fingerprint(file);
  const oracle = await electronFacts(file);
  assert.equal(oracle.length, 2, 'ELECTRON_WAL_FACTS_MISSING');
  report.sqlite = { files: before, electronRecords: oracle.length };
  await launch();
  const page = await open();
  await page.evaluate(() => window.usageBridge.setRefreshInterval(0));

  const python = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const helper = path.join(__dirname, 'windows-sqlite-source-guard.py');
  const locks = spawn(python, [helper, file], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const lockDone = once(locks, 'exit');
  let locked = false;
  locks.stdin.on('error', () => {});
  const lockOutput = readline.createInterface({ input: locks.stdout });
  lockOutput.on('line', line => { if (line === 'ready') locked = true; });
  const stopFile = path.join(scratch, 'stop-sqlite-sampler');
  const sampler = spawn(python, [path.join(__dirname, 'windows-memory-sampler.py'), '--pid',
    String(child.pid), '--stop-file', stopFile, '--detailed'],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const sampleDone = once(sampler, 'exit');
  const samples = [];
  const lines = readline.createInterface({ input: sampler.stdout });
  lines.on('line', line => {
    try { const row = JSON.parse(line); if (row.complete) samples.push(row); }
    catch { /* Partial or invalid samples are discarded. */ }
  });
  let readStart, readEnd, warmStart;
  try {
    stage = 'sqlite-source-guard';
    await waitFor(() => locked || locks.exitCode !== null, 'SQLITE_SOURCE_GUARD_NOT_READY', 8000);
    assert(locked, 'SQLITE_SOURCE_GUARD_FAILED');
    await waitFor(() => samples.length >= 5, 'SQLITE_COUNTERS_MISSING', 8000);
    stage = 'sqlite-read';
    readStart = Date.now();
    const state = await page.evaluate(() => window.usageBridge.refresh());
    readEnd = Date.now();
    assert.equal(state.error, null, 'SQLITE_COLLECTION_FAILED');
    const native = readStatistics(ledger);
    assert.deepEqual(usageFacts(Object.values(native.records)), oracle, 'SQLITE_WAL_GOLDEN_CHANGED');
    assert(!fs.readFileSync(ledger).includes('SQLITE_PRIVATE_FIXTURE_CONTENT'), 'SQLITE_PRIVATE_TEXT_PERSISTED');
    report.sqlite.parity = true;
    report.sqlite.protectedRead = true;
    report.sqlite.durationMs = readEnd - readStart;
    stage = 'sqlite-warm-tray';
    await close(page);
    await delay(4000);
    warmStart = Date.now();
    await waitFor(() => samples.filter(row => row.at >= warmStart).length >= 15, 'SQLITE_COUNTERS_MISSING', 10000);
  } finally {
    lockOutput.close();
    locks.stdin.end();
    const terminated = await Promise.race([lockDone.then(() => true), delay(3000, false, { ref: false })]);
    if (!terminated) { locks.kill(); await lockDone; }
    fs.writeFileSync(stopFile, '');
    const stopped = await Promise.race([sampleDone.then(() => true), delay(3000, false, { ref: false })]);
    if (!stopped) { sampler.kill(); await sampleDone; }
    lines.close();
  }
  const peak = (rows, key) => rows.reduce((max, row) => row[key] > max[key] ? row : max);
  const read = samples.filter(row => row.at >= readStart && row.at <= readEnd + 200);
  const warm = samples.filter(row => row.at >= warmStart);
  assert(read.length >= 3 && warm.length >= 15, 'SQLITE_COUNTERS_MISSING');
  report.sqlite.memory = {
    readPeak: peak(read, 'privateWorkingMiB'), readCommitPeak: peak(read, 'privateMiB'),
    warmPeak: peak(warm, 'privateWorkingMiB'), warmSettled: warm.at(-1),
    curve: samples.filter(row => row.at >= readStart).map(row => [row.at - readStart, row.privateWorkingMiB, row.privateMiB]),
  };
  report.sqlite.noWebview = warm.every(row => row.processes.every(process => !/^msedgewebview2(?:\.exe)?$/i.test(process.name)));
  execFileSync(python, [helper, file, '--verify-released'], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
  report.sqlite.handlesReleasedWhileInTray = true;
  assert.deepEqual(await fingerprint(file), before, 'SQLITE_SOURCE_BYTES_CHANGED');
  report.sqlite.sourceUnchanged = true;
  const snapshots = fs.readdirSync(scratch).filter(name => name.startsWith('quotadock-sqlite-'));
  report.sqlite.snapshotsRemainingWhileInTray = snapshots.length;
  assert.equal(snapshots.length, 0, 'SQLITE_TEMP_SNAPSHOT_REMAINS');
  report.sqlite.warmGate = report.sqlite.noWebview && report.sqlite.memory.warmPeak.privateWorkingMiB <= 35;
  await stop();
}

async function main() {
  assert(desktopReadiness().eligible, 'DESKTOP_NOT_ELIGIBLE');
  if (slice === 'sqlite-wal') {
    stage = 'sqlite-fixture';
    await sqliteWalScenario();
    return;
  }
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, legacyBytes);
  seed(home, ['m42', 'm43', 'usage', 'github', 'update'].includes(slice) ? [1, 1, 1] : undefined);
  if (slice === 'm43') {
    fs.writeFileSync(path.join(home, '.codex', 'AGENTS.md'), 'Synthetic original instruction');
    fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(home, '.local', 'bin', 'claude.exe'), 'synthetic metadata, no executable image');
  }
  stage = 'collect';
  await launch();
  let page = await open();
  await page.evaluate(async () => {
    await window.usageBridge.refresh();
    const list = await window.usageBridge.sessions({ range: 'all' });
    if (!list.sessions[0]?.key) throw Error('SYNTHETIC_SESSIONS_MISSING');
    await window.usageBridge.setSessionLabel(list.sessions[0].key, { alias: 'Ledger restart fixture' });
  });
  if (slice === 'usage') {
    stage = 'usage-diagnostics-and-cadence';
    report.usageDiagnostics = await page.evaluate(async () => {
      const usage = window.usageBridge;
      const initial = await usage.get(null);
      const before = await usage.performanceState();
      let rejected = false;
      try { await usage.setRefreshInterval(1); }
      catch (error) { rejected = /REFRESH_INTERVAL_INVALID/.test(String(error)); }
      const diagnostics = await usage.statisticsDiagnostics();
      const saved = await usage.setRefreshInterval(5000);
      return {
        defaultCadence: initial.refreshIntervalMs === 15000,
        rejected,
        scheduled: saved.refreshIntervalMs === 5000,
        owned: before.workerPresent && before.workerStarts === 1 && before.completed > 0,
        safeDiagnostics: diagnostics.lifecycle.rejected > 0 && !!diagnostics.owner?.storage
          && !/synthetic|statistics\.json|deviceId|sourceRoots/i.test(JSON.stringify(diagnostics.owner)),
      };
    });
    assert(Object.values(report.usageDiagnostics).every(Boolean), 'USAGE_DIAGNOSTICS_CHANGED');
    const before = readStatistics(ledger).sequence;
    seed(home, [1, 1, 2]);
    await waitFor(() => readStatistics(ledger).sequence > before, 'USAGE_TIMER_DID_NOT_COLLECT', 16000);
    report.usageCadenceCollected = true;
    const off = await page.evaluate(() => window.usageBridge.setRefreshInterval(0));
    assert(off.refreshIntervalMs === 0, 'USAGE_TIMER_DID_NOT_STOP');
  }
  if (slice === 'github') {
    stage = 'github-ipc';
    report.github = await page.evaluate(async () => {
      const github = window.githubBridge;
      const state = await github.get();
      const connect = await github.connect();
      const cancel = await github.cancel();
      const list = await github.repositories();
      const set = await github.setSync({ enabled: true, repository: 'fixture-user/sample' });
      const sync = await github.syncNow();
      const disconnected = await github.disconnect();
      return {
        schema: state.ok && state.state.schemaVersion === 'GithubStateV1' && !state.state.configured,
        offline: !connect.ok && connect.error === 'GITHUB_NOT_CONFIGURED',
        cancel: cancel.ok && cancel.state.connection.device === null,
        repositories: list.ok && list.state.sync.error === 'GITHUB_NOT_CONFIGURED',
        prefs: !set.ok && set.error === 'GITHUB_NOT_CONNECTED',
        sync: !sync.ok && sync.error === 'GITHUB_REPOSITORY_INVALID',
        disconnect: disconnected.ok && disconnected.state.connection.status === 'none',
        clipboard: !await github.copyCode(),
        links: !await github.open('https://example.invalid/login/device'),
      };
    });
    assert(Object.values(report.github).every(Boolean), 'GITHUB_IPC_CONTRACT_CHANGED');
  }
  if (slice === 'update') {
    stage = 'update-ipc';
    report.update = await page.evaluate(async () => {
      const updater = window.updateBridge;
      const state = await updater.get();
      const check = await updater.check();
      const cancel = await updater.cancel();
      const install = await updater.install();
      return {
        schema: state.ok && state.state.status === 'unconfigured' && !state.state.supported
          && state.state.current && state.state.latest === null && state.state.progress === null,
        check: !check.ok && check.error === 'UPDATE_NOT_CONFIGURED' && check.state.status === 'unconfigured',
        cancel: !cancel.ok && cancel.error === 'UPDATE_NOT_CONFIGURED',
        install: !install.ok && install.error === 'UPDATE_NOT_CONFIGURED',
        links: !await updater.open('https://example.invalid/installer.exe'),
      };
    });
    assert(Object.values(report.update).every(Boolean), 'UPDATE_IPC_CONTRACT_CHANGED');
  }
  if (['m42', 'm43'].includes(slice)) {
    stage = 'price-custom-ipc';
    const key = { provider: 'openai', model: 'gpt-4.1' };
    const entry = { ...key, inputUncached: 1, output: 2, cacheRead: 0, cacheWrite: 0 };
    const expectedRates = validatePrice(entry).rates;
    report.m42 = await page.evaluate(async ({ key, entry, expectedRates }) => {
      const bridge = window.usageBridge;
      const pricing = await bridge.pricing();
      const saved = await bridge.savePrice(entry);
      const probe = await bridge.probePrice(entry);
      await bridge.resetPrice(key);
      const tried = await bridge.tryPrice({ key: 'openai/gpt-4.1', targets: [] });
      const plan = await bridge.pricePlan({});
      const repriced = await bridge.reprice();
      const setting = await bridge.autoPrices(false);
      const fee = await bridge.setSubscription('codex', 24.128);
      const noFee = await bridge.setSubscription('codex', null);
      const offline = await bridge.syncPrices().then(() => false, error => String(error).includes('PRICE_SYNC_OFFLINE_FIXTURE'));
      const draft = await bridge.customDraft();
      const missingRoots = await bridge.customPreview(draft.token, draft.definition)
        .then(() => false, error => String(error).includes('CUSTOM_ROOT_REQUIRED'));
      const config = await bridge.configState();
      const unchecked = await bridge.configCheck('codex', 'project');
      const invalid = await bridge.configCheck('unknown', 'project');
      const canceled = await bridge.configCancel();
      const missingView = await bridge.configManage('list', 'codex', 'project', 'mcp');
      const forgot = await bridge.configForget('codex', 'project');
      return {
        configIdle: !config.busy && config.active === null && Object.keys(config.selections).length === 0,
        configNeedsGrant: unchecked.error === 'CONFIG_ROOT_NOT_SELECTED' && missingView.error === unchecked.error,
        configInvalidSelection: invalid.error === 'CONFIG_SELECTION_INVALID',
        configIdleCancel: !canceled.state.busy,
        configForget: Object.keys(forgot.state.selections).length === 0,
        syncInitial: Boolean(pricing.sync), priceSaved: pricing.overrideSha256 !== saved.overrideSha256,
        probe: Object.entries(expectedRates).every(([field, rate]) => probe.rates[field] === rate), tried: tried.key === 'openai/gpt-4.1', plan: Boolean(plan.before),
        repriced: repriced.recalculated === true, autoDisabled: !setting.enabled,
        subscription: fee.subscriptions.codex === 24.13 && !Object.hasOwn(noFee.subscriptions, 'codex'),
        fixtureOffline: offline, draft: Boolean(draft.id), noRoots: missingRoots
      };
    }, { key, entry, expectedRates });
    assert(Object.values(report.m42).every(Boolean), 'M42_IPC_CONTRACT_MISMATCH');
  }
  if (slice === 'm43') {
    stage = 'agent-and-installer-ipc';
    report.m43 = await page.evaluate(async () => {
      const bridge = window.usageBridge;
      const initial = await bridge.agents('state');
      const checked = await bridge.agents('check');
      const item = checked.inventory?.items.find(item => item.agent === 'codex' && item.kind === 'instruction');
      if (!item) throw Error('AGENT_INSTRUCTION_MISSING');
      const old = await bridge.agents('instruction', item.id);
      const draft = await bridge.agents('preview', { id: item.id, action: 'text', revision: old.revision, text: 'Synthetic edited instruction' });
      const written = await bridge.agents('apply', draft.preview.id);
      const updated = await bridge.agents('instruction', item.id);
      const history = await bridge.agents('history');
      const restored = await bridge.agents('restore', written.record);
      const original = await bridge.agents('instruction', item.id);
      const rejected = await bridge.agents('locate', { id: 'unknown', action: 'reveal' });
      const plan = await bridge.agents('plan');
      const repair = await bridge.agents('repair', []);
      const undo = await bridge.agents('undoRepair');
      const use = await bridge.agentUse({ offset: 0 });

      const setup = await bridge.agentSetup('claude');
      const scan = await bridge.agentSetupAction({ agent: 'claude', actionId: 'rescan', revision: setup.state.revision });
      const agy = await window.quotaBridge.discoverAntigravity();
      const agySetup = await window.quotaBridge.antigravitySetup();
      const agyScan = await window.quotaBridge.antigravitySetupAction({ actionId: 'rescan', revision: agySetup.state.revision });

      const installers = await bridge.installers();
      let event = false;
      const unlisten = bridge.onInstallUpdate(() => { event = true; });
      const requested = await bridge.installerAction({ agent: 'codex', action: 'check', revision: installers.state.revision });
      let terminal = null;
      try {
        for (let tries = 0; tries < 40; tries++) {
          terminal = (await bridge.installers()).state.rows.find(row => row.agent === 'codex');
          if (event && terminal?.errorCode === 'INSTALL_FIXTURE_BLOCKED') break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } finally { unlisten(); }
      return {
        inventoryLazy: initial.inventory === null && initial.checkedAt === null,
        inventoryChecked: checked.inventory.schemaVersion === 'AgentInventoryV1' && checked.checkedAt !== null,
        instructionRead: old.text === 'Synthetic original instruction',
        instructionChanged: updated.text === 'Synthetic edited instruction' && written.applied,
        history: history.records.some(record => record.id === written.record && record.restorable),
        restored: restored.restored && original.text === old.text && original.revision === old.revision,
        unknownRefused: rejected.error === 'INVENTORY_ITEM_UNKNOWN',
        repairs: Array.isArray(plan.rows) && Array.isArray(repair.done) && undo.left === 0,
        agentUse: use.schemaVersion === 'AgentUseV1' && Array.isArray(use.rows),
        setup: setup.ok && scan.ok && scan.state.runtime.effects.executedCli === false && scan.state.reason === 'entry-found',
        agyDiscovery: agy.ok && agy.discovery.effects.requestedQuota === false,
        agySetup: agyScan.ok && agyScan.state.reason === 'cli-missing',
        installers: installers.ok && installers.state.rows.length === 10 && requested.ok && event
          && terminal?.errorCode === 'INSTALL_FIXTURE_BLOCKED' && !terminal?.busy,
      };
    });
    assert(Object.values(report.m43).every(Boolean), 'M43_IPC_CONTRACT_MISMATCH');
  }
  if (slice === 'm51') {
    stage = 'webview-login-fixture';
    report.m51Bridge = await page.evaluate(async () => {
      const quota = window.quotaBridge;
      const id = '00000000-0000-4000-8000-000000000000';
      const website = await quota.providerWebsiteLogin({ adapter: 'claude-web', alias: 'Synthetic', id: null, consent: true });
      const client = await quota.providerClientLogin({ adapter: 'opencode-zen', alias: 'Synthetic', id: null, consent: true });
      const webCancel = await quota.providerWebsiteCancel();
      const passive = await quota.providerPassiveGuide(id);
      const guide = await quota.providerGuide('claude-web');
      const codexLogin = await quota.login('Synthetic');
      const codexCancel = await quota.cancel();
      const choose = await quota.chooseExecutable();
      const refresh = await quota.refresh(id);
      const remove = await quota.remove(id);
      return {
        websiteBound: website.errorCode === 'PROVIDER_FIXTURE_BLOCKED',
        websiteCancelBound: webCancel.ok && webCancel.state.pendingWebsiteLogin === null,
        clientBound: client.errorCode === 'PROVIDER_FIXTURE_BLOCKED',
        providerGuideBound: guide.errorCode === 'PROVIDER_FIXTURE_BLOCKED',
        codexLoginBound: codexLogin.errorCode === 'PROVIDER_FIXTURE_BLOCKED',
        passiveGuideBound: passive.errorCode === 'ACCOUNT_NOT_FOUND',
        codexCancelBound: codexCancel.ok && codexCancel.state.pendingLogin === null,
        codexChooseBound: choose.errorCode === 'PROVIDER_FIXTURE_BLOCKED',
        codexRefreshBound: refresh.errorCode === 'ACCOUNT_NOT_FOUND',
        codexRemoveBound: remove.errorCode === 'ACCOUNT_NOT_FOUND',
      };
    });
    assert(Object.values(report.m51Bridge).every(Boolean), 'M51_IPC_CONTRACT_MISMATCH');
    report.workbuddy = await page.evaluate(async () => {
      const quota = window.quotaBridge;
      const caps = await quota.getV2();
      const findWorkBuddy = items => items.find(row => row.provider === 'workbuddy');
      const seeded = await quota.providerExperimental(true);
      const result = await quota.providerConnect({
        adapter: 'workbuddy-credit', alias: 'Synthetic API', credential: 'synthetic-workbuddy-api-token', remember: true,
      });
      const rejected = await quota.providerConnect({
        adapter: 'workbuddy-web', alias: 'No browser user agent', credential: 'quotaFixture=synthetic-workbuddy-cookie', remember: true,
      });
      const browser = await quota.providerConnect({
        adapter: 'workbuddy-web', alias: 'Synthetic website', credential: 'quotaFixture=synthetic-workbuddy-cookie',
        userAgent: 'QuotaDock synthetic WebView2', remember: true,
      });
      const state = (await quota.providers()).state;
      const credit = state.accounts.find(row => row.adapter === 'workbuddy-credit');
      const web = state.accounts.find(row => row.adapter === 'workbuddy-web');
      const webBalances = web?.quota?.pools?.[0]?.balances ?? [];
      const exposesAuthorizedRoutes = provider => provider?.login?.mode === 'api-key'
        && provider.adapters.some(row => row.id === 'workbuddy-web')
        && provider.adapters.some(row => row.id === 'workbuddy-credit')
        && !provider.adapters.some(row => row.id === 'workbuddy-desktop');
      return {
        bothBridgesExposeAuthorizedRoutes: exposesAuthorizedRoutes(findWorkBuddy(state.capabilities))
          && exposesAuthorizedRoutes(findWorkBuddy(caps.state.providerCapabilities)),
        creditVerifiedAndSaved: result.ok && credit?.remembered === true
          && credit?.quota?.pools?.[0]?.balances?.[0]?.remaining === '75',
        browserContextRequired: seeded.ok && !rejected.ok
          && !state.accounts.some(row => row.alias === 'No browser user agent'),
        browserQuotaKeepsPrecision: browser.ok && web?.remembered === true
          && webBalances[0]?.total === '9007199254740993.125' && webBalances[0]?.remaining === '20.125'
          && webBalances[0]?.used === null && webBalances[1]?.remaining === '1.1',
        noCredentialInProjection: !JSON.stringify({caps, state, result, browser}).includes('synthetic-workbuddy-'),
      };
    });
    assert(Object.values(report.workbuddy).every(Boolean), 'WORKBUDDY_IPC_CONTRACT_MISMATCH');
    report.quotaScheduleSaved = await page.evaluate(async () => {
      const changed = await window.quotaBridge.setAutoRefresh('1min');
      return changed.ok && changed.state.autoRefresh === '1min' && Number.isFinite(Date.parse(changed.state.nextAutoAt));
    });
    assert(report.quotaScheduleSaved, 'QUOTA_SCHEDULE_WRITE_FAILED');
    report.codexBatchBridge = await page.evaluate(async () => {
      const reply = await window.quotaBridge.refreshAll();
      return reply.ok && reply.state.lastBatch?.success === 0 && reply.state.lastBatch.failed === 0
        && reply.state.lastBatch.skipped === 0 && reply.state.lastProviderBatch === null;
    });
    assert(report.codexBatchBridge, 'CODEX_BATCH_CONTRACT_MISMATCH');
    report.shellBridge = await page.evaluate(async () => {
      const shell = window.shellBridge;
      const prefs = await shell.set({ guided: true, closeToTray: true, watch: { low: 30 } });
      const quota = window.quotaBridge;
      const accounts = (await quota.providers()).state.accounts;
      const id = accounts.find(row => row.adapter === 'workbuddy-credit')?.id;
      await quota.providerAction({ id, action: 'refresh' });
      await quota.providerAction({ id, action: 'refresh' });
      const rows = await shell.readHistory(id);
      return {
        preferencesSaved: prefs.tray && prefs.guided && prefs.closeToTray && prefs.watch.low === 30,
        consecutiveReadsCoalesce: rows.length === 1 && rows[0].ok && rows[0].count === 2 && !rows[0].automatic,
        privateTextAbsent: !JSON.stringify(rows).includes('synthetic-workbuddy-'),
      };
    });
    assert(Object.values(report.shellBridge).every(Boolean), 'SHELL_BRIDGE_CONTRACT_MISMATCH');
    const results = readline.createInterface({ input: child.stdout });
    try {
      const signal = AbortSignal.timeout(30000);
      const next = once(results, 'line', { signal });
      child.stdin.write('website-fixture\n');
      const [line] = await next;
      const ready = JSON.parse(line);
      assert(!ready.loginFixtureError, ready.loginFixtureError);
      assert.deepEqual(ready.loginFixture, {
        separateProfileCreated: true, cookieIsolated: true, profileRemoved: true, dpapiRestart: true,
      });
      report.m51 = ready.loginFixture;
    } finally {
      results.close();
    }
  }
  const baseline = await published(page);
  assert(baseline.revision > 0 && baseline.rows === 3 && baseline.daily.length > 0, 'LEDGER_EMPTY');
  assert(Object.values(baseline.labels).some(label => label.alias === 'Ledger restart fixture'), 'LABEL_NOT_SAVED');

  stage = 'electron-golden';
  const bytes = fs.readFileSync(ledger);
  const info = await page.evaluate(() => window.usageBridge.dataInfo());
  assert(info.version === version && path.resolve(info.path) === path.dirname(ledger), 'DATA_INFO_PATH_CHANGED');
  assert(info.bytes >= bytes.length, 'DATA_INFO_MISSING_LEDGER_BYTES');
  report.dataInfo = true;
  const state = readStatistics(ledger);
  const chunks = [];
  writeStatistics(state, chunk => chunks.push(chunk));
  assert(bytes.equals(Buffer.from(chunks.join(''))), 'ELECTRON_GOLDEN_BYTES_CHANGED');
  assert(Object.values(state.records).some(row => row.cacheRead === null || row.reasoning === null), 'UNKNOWN_FILLED');
  assert(['合成问题', '合成答复', 'synthetic line'].every(marker => !bytes.includes(marker)), 'PRIVATE_SOURCE_TEXT_PERSISTED');
  report.electronGolden = true;
  report.privateTextAbsent = true;
  report.unknownPreserved = true;
  report.ledgerSha256 = crypto.createHash('sha256').update(bytes).digest('hex');

  // The second and third reads must succeed from the saved ledger alone.
  fs.renameSync(home, path.join(scratch, 'sources-removed'));
  stage = 'window-rebuild';
  await close(page);
  if (measureWarm) {
    stage = 'warm-tray-after-refresh';
    report.warmTray = await warmAfterRefresh();
    assert(report.warmTray.webviewProcesses.length === 0, 'TRAY_WEBVIEW_STILL_RUNNING');
    stage = 'window-rebuild';
  }
  page = await open();
  assert(JSON.stringify(await published(page)) === JSON.stringify(baseline), 'REBUILT_WINDOW_CHANGED_LEDGER');
  if (slice === 'm51') {
    report.workbuddyWindowRebuild = await page.evaluate(async () => {
      const response = await window.quotaBridge.providers();
      const rows = response.state.accounts.filter(row => row.provider === 'workbuddy');
      return response.ok && rows.length === 2 && rows.every(row => row.status === 'ready');
    });
    assert(report.workbuddyWindowRebuild, 'WORKBUDDY_WINDOW_REBUILD_CHANGED');
  }
  await close(page);
  await stop();
  report.windowRebuild = true;

  const abandoned = ledger + '.tmp-000000000001';
  fs.writeFileSync(abandoned, '{"incomplete":');
  stage = 'cold-restart';
  await launch();
  page = await open();
  assert(JSON.stringify(await published(page)) === JSON.stringify(baseline), 'COLD_RESTART_CHANGED_LEDGER');
  assert(fs.readFileSync(ledger).equals(bytes), 'COLD_RESTART_CHANGED_BYTES');
  assert(fs.readFileSync(legacy).equals(legacyBytes), 'LEGACY_LEDGER_CHANGED');
  if (slice === 'usage') {
    report.usageCadenceRestart = await page.evaluate(async () =>
      (await window.usageBridge.get(null)).refreshIntervalMs === 0);
    assert(report.usageCadenceRestart, 'USAGE_TIMER_NOT_PERSISTED');
  }
  if (slice === 'm51') {
    stage = 'workbuddy-cold-restart';
    report.quotaScheduleRestart = await page.evaluate(async () => {
      const quota = window.quotaBridge;
      const saved = await quota.get();
      const dueIn = Date.parse(saved.state.nextAutoAt) - Date.now();
      const off = await quota.setAutoRefresh('off');
      return saved.ok && saved.state.autoRefresh === '1min' && dueIn > 0 && dueIn <= 60000
        && off.ok && off.state.autoRefresh === 'off' && off.state.nextAutoAt === null;
    });
    assert(report.quotaScheduleRestart, 'QUOTA_SCHEDULE_RESTART_FAILED');
    report.shellRestart = await page.evaluate(async expectedReadCount => {
      const settings = await window.shellBridge.get();
      const accounts = (await window.quotaBridge.providers()).state.accounts;
      const id = accounts.find(row => row.adapter === 'workbuddy-credit')?.id;
      const history = await window.shellBridge.readHistory(id);
      return settings.guided && settings.closeToTray && settings.watch.low === 30
        && history.length === 1 && history[0].ok && !history[0].automatic
        && history[0].count === expectedReadCount;
    }, measureWarm ? 3 : 2);
    assert(report.shellRestart, 'SHELL_RESTART_CHANGED');
    report.workbuddyRestart = await page.evaluate(async () => {
      const quota = window.quotaBridge;
      const rows = (await quota.providers()).state.accounts.filter(row => row.provider === 'workbuddy');
      const credentialsRestored = rows.length === 2
        && rows.every(row => row.status === 'cached' && row.credentialReady && row.remembered);
      const results = [];
      for (const row of rows) results.push(await quota.providerAction({id: row.id, action: 'refresh'}));
      const current = (await quota.providers()).state.accounts.filter(row => row.provider === 'workbuddy');
      return {
        credentialsRestored,
        refreshAfterRestart: results.length === 2 && results.every(result => result.ok)
          && current.every(row => row.status === 'ready'),
      };
    });
    const cache = fs.readFileSync(path.join(appData, identifier, 'quota', 'quota-accounts.json'));
    report.workbuddyRestart.vaultHasNoPlaintext = !cache.includes('synthetic-workbuddy-')
      && !cache.includes('QuotaDock synthetic WebView2');
    assert(Object.values(report.workbuddyRestart).every(Boolean), 'WORKBUDDY_COLD_RESTART_CHANGED');
  }
  if (slice === 'm51') {
    stage = 'shell-quit-on-close';
    const exit = once(child, 'exit');
    await page.evaluate(async () => {
      const preferences = await window.shellBridge.set({ closeToTray: false });
      if (preferences.closeToTray) throw Error('SHELL_CLOSE_SETTING_REJECTED');
      setTimeout(() => void window.__TAURI__.core.invoke('probe_close').catch(() => {}), 25);
    });
    const grace = await Promise.race([exit.then(([code]) => code === 0), delay(12000, false, { ref: false })]);
    assert(grace, 'SHELL_CLOSE_DID_NOT_EXIT');
    report.shellCloseQuits = true;
  } else {
    await close(page);
    await stop();
  }
  report.coldRestart = true;
  report.interruptedWriteIgnored = true;
  report.legacyIsolated = true;
  report.rows = baseline.rows;
  report.revision = baseline.revision;
}

main().catch(error => {
  report.failure = { stage, code: /^[A-Z][A-Z_]+$/.test(error.message) ? error.message : error.name };
  process.exitCode = 1;
}).finally(async () => {
  if (browser?.isConnected()) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page && !page.isClosed()) await close(page).catch(() => {});
    if (browser.isConnected()) await browser.close().catch(() => {});
  }
  try { await stop(); } catch { process.exitCode = 1; }
  try {
    const owned = fs.realpathSync(scratch);
    assert(path.dirname(owned) === fs.realpathSync(os.tmpdir()) && path.basename(owned).startsWith('quotadock-ledger-restart-'));
    fs.rmSync(owned, { recursive: true, maxRetries: 20, retryDelay: 100 });
    report.scratchRemoved = true;
  } catch (error) {
    report.scratchRemoved = false;
    report.cleanupCode = error.code ?? error.name;
    process.exitCode = 1;
  }
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
});
