'use strict';
/* global document */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium, _electron: electron } = require('playwright');
const { cleanup, keepVisible, isolatePointer, settle, showView, until } = require('./ui-settle');

const [host, executable, directory, scaleText = '1', fixture = 'empty'] = process.argv.slice(2);
const size = { width: 1480, height: 960 };
const scale = Number(scaleText);
const views = ['quota', 'usage', 'cost', 'sessions', 'sources', 'settings'];
const fixedTime = Date.parse(fixture === 'populated' ? '2026-11-18T16:20:00Z' : '2026-11-18T15:15:00Z');

function seed(home) {
  const timestamp = new Date(fixedTime).toISOString();
  const uuid = 'f0da4298-c672-4359-b5cc-4182dbb6f0a4';
  const project = 'E:\\synthetic-workspace\\应用验收';
  const logs = [
    [path.join(home, '.codex', 'sessions', 'session.jsonl'), [
      { type: 'session_meta', payload: { id: uuid, originator: 'codex_cli_rs', cwd: project } },
      { type: 'turn_context', payload: { model: 'gpt-4.1' } },
      { type: 'event_msg', timestamp, payload: { type: 'token_count', info: {
        last_token_usage: { input_tokens: 82000, output_tokens: 2600, cached_input_tokens: 40000, total_tokens: 84600 },
        total_token_usage: { input_tokens: 82000, output_tokens: 2600, cached_input_tokens: 40000, total_tokens: 84600 }
      } } }
    ]],
    [path.join(home, '.claude', 'projects', 'project', uuid + '.jsonl'), [
      { type: 'user', uuid: 'user-1', sessionId: uuid, timestamp, cwd: project,
        message: { role: 'user', content: '核对应用截图' } },
      { type: 'assistant', uuid: 'reply-1', sessionId: uuid, timestamp, cwd: project,
        message: { id: 'reply-1', model: 'claude-sonnet-4-20250514', role: 'assistant',
          content: [{ type: 'text', text: '这是合成会话，用于核对文字、布局和会话状态。' }],
          usage: { input_tokens: 24000, output_tokens: 1400, cache_read_input_tokens: 9000, cache_creation_input_tokens: 2200 } } }
    ]]
  ];
  for (const [file, rows] of logs) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    fs.utimesSync(file, new Date(fixedTime), new Date(fixedTime));
  }
}

function nativeCapture(pid, file, hwnd) {
  const python = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const result = spawnSync(python, [path.join(__dirname, 'capture-desktop-window.py'), String(pid), file, ...(hwnd ? [hwnd] : [])],
    { windowsHide: true, timeout: 12000, encoding: 'utf8' });
  return result.status === 0 ? JSON.parse(result.stdout) : { error: result.stderr?.trim() || 'NATIVE_CAPTURE_FAILED' };
}

async function findWebview(profileRoot, child) {
  const end = Date.now() + 45000;
  while (Date.now() < end && child.exitCode === null) {
    for (const name of fs.readdirSync(profileRoot)) {
      if (!name.startsWith('quotadock-reader-')) continue;
      const file = path.join(profileRoot, name, 'WebView2', 'EBWebView', 'DevToolsActivePort');
      if (!fs.existsSync(file)) continue;
      const port = Number(fs.readFileSync(file, 'utf8').split(/\r?\n/)[0]);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) continue;
      const url = 'http://127.0.0.1:' + port;
      try {
        if ((await fetch(url + '/json/version', { signal: AbortSignal.timeout(400) })).ok) return url;
      } catch { /* WebView2 has started but CDP is not ready. */ }
    }
    await delay(100);
  }
  throw Error('TAURI_WEBVIEW_NOT_READY');
}

async function main() {
  assert(['electron', 'tauri'].includes(host) && executable && directory && [1, 1.25, 1.5].includes(scale)
      && ['empty', 'populated'].includes(fixture),
    'Usage: node scripts/m1/desktop-pixel-parity.js electron|tauri <exe> <output> [1|1.25|1.5] [empty|populated]');
  const exe = path.resolve(executable);
  const output = path.resolve(directory);
  fs.mkdirSync(output, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'quotadock-pixel-'));
  let app, child, browser, page;
  const records = [], errors = [];
  const home = path.join(scratch, 'home');
  fs.mkdirSync(home);
  if (fixture === 'populated') seed(home);
  try {
    if (host === 'electron') {
      app = await electron.launch({
        executablePath: exe,
        args: ['--usage-data-dir', path.join(scratch, 'usage'), '--quota-data-dir',
          path.join(scratch, 'quota'), '--m1-fixture-root', home, '--force-device-scale-factor=' + scale],
        timeout: 60000
      });
      await keepVisible(app);
      await isolatePointer(app);
      await app.evaluate(({ BrowserWindow }, { width, height }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setContentSize(width, height);
        window.show();
        window.focus();
      }, size);
      page = await app.firstWindow();
    } else {
      child = spawn(exe, ['--probe', '--fixture'], {
        windowsHide: true, stdio: ['pipe', 'ignore', 'inherit'],
        env: { ...process.env, TEMP: scratch, TMP: scratch }
      });
      await once(child, 'spawn');
      browser = await chromium.connectOverCDP(await findWebview(scratch, child));
      page = browser.contexts()[0].pages()[0];
      await page.waitForURL('**/design/desktop-reference/index.html', { waitUntil: 'domcontentloaded' });
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: scale, mobile: false });
    const freezeTime = time => {
      const RealDate = Date;
      window.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [time])); }
        static now() { return time; }
      };
    };
    await page.evaluate(freezeTime, fixedTime);
    page.on('pageerror', error => errors.push(error.message));
    await until(page, () => window.usageData?.ready());
    if (fixture === 'populated') {
      if (host === 'electron') await page.evaluate(() => window.usageBridge.refresh());
      await until(page, async () => (await window.usageBridge.get()).snapshot?.daily?.length > 0);
    }
    const browserInfo = await cdp.send('Browser.getVersion');
    const nativeWindow = host === 'electron' && process.env.DESKTOP_PIXEL_CAPTURE_NATIVE === '1'
      ? await app.evaluate(({ BrowserWindow }) => ({ pid: process.pid,
        hwnd: BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE(0).toString() }))
      : { pid: child?.pid };

    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => {
        window.settingsHost.theme.set(value);
        window.uiMotion.setPreference('off');
      }, theme);
      for (const view of fixture === 'populated' ? [...views, 'reader'] : views) {
        await showView(page, view === 'reader' ? 'sessions' : view);
        if (view === 'sessions' || view === 'reader') {
          await page.evaluate(() => window.sessionsHost.read(null));
          await until(page, () => !window.sessionsHost.get().loading);
        }
        if (view === 'reader') {
          await until(page, () => window.sessionsHost.list()?.sessions.some(row => row.agent === 'claude'));
          await page.evaluate(() => {
            const session = window.sessionsHost.list().sessions.find(row => row.agent === 'claude');
            window.sessionsHost.read(session);
          });
          await page.locator('[data-reader-turn]').first().waitFor();
        }
        await page.mouse.move(0, size.height - 1);
        const geometry = await page.evaluate(async () => {
          await document.fonts.ready;
          window.scrollTo(0, 0);
          const bounds = selector => {
            const node = document.querySelector(selector);
            if (!node || node.hidden) return null;
            const { x, y, width, height } = node.getBoundingClientRect();
            return { x, y, width, height };
          };
          return { width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio,
            titlebar: bounds('#appTitlebar'), panel: bounds('main'), summary: bounds('#summaryPanel') };
        });
        await settle(page);
        const file = theme + '-' + view + '.png';
        await page.screenshot({ path: path.join(output, file), animations: 'disabled', caret: 'hide' });
        const record = { theme, view, file, geometry };
        if (process.env.DESKTOP_PIXEL_CAPTURE_NATIVE === '1') {
          const native = 'native-' + file;
          record.native = nativeCapture(nativeWindow.pid, path.join(output, native), nativeWindow.hwnd);
          if (!record.native.error) record.native.file = native;
        }
        records.push(record);
      }
    }
    if (host === 'tauri') {
      const maximize = page.locator('[data-caption="toggleMaximize"]');
      await maximize.click();
      await until(page, async () => (await window.windowBridge.state()).maximized);
      await maximize.click();
      await until(page, async () => !(await window.windowBridge.state()).maximized);
    }
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({
      host, scale, fixture, syntheticOnly: true, fixedTime, browser: browserInfo.product,
      executableSha256: crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex'),
      records, errors
    }, null, 2) + '\n');
    assert.deepEqual(errors, []);
  } finally {
    if (app) await app.close();
    if (child?.pid && child.exitCode === null) {
      if (page && !page.isClosed()) {
        await page.evaluate(() => { setTimeout(() => void window.__TAURI__.core.invoke('probe_close').catch(() => {}), 20); }).catch(() => {});
        await Promise.race([page.waitForEvent('close', { timeout: 3000 }).catch(() => {}), delay(3200)]);
        if (browser?.isConnected()) await browser.close();
        await delay(2500);
      }
      child.stdin.end('quit\n');
      await Promise.race([once(child, 'exit'), delay(8000)]);
      if (child.exitCode === null) child.kill();
    }
    await cleanup(scratch);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
