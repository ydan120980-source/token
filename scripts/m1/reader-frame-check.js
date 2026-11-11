'use strict';
/* global document, requestAnimationFrame, innerWidth, innerHeight, devicePixelRatio */
// How much one frame costs while a long conversation is read. Synthetic home only.
// Measures rAF gaps and the main-thread style/layout counters around real wheel
// input, so a change can be compared on the same machine and the same seed.
// No forced GC, no GPU overrides, no synthetic clock.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { seed, CODEX_ID } = require('../../tests/m1/sessions-reader-fixture');
const { Store, atomic } = require('../../src/m1/store');
const { roots } = require('../../src/m1/policy');
const { showView, settle, until, isolatePointer, cleanup } = require('./ui-settle');

const stats = values => {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b), at = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { samples: values.length, medianMs: at(.5), p95Ms: at(.95), p99Ms: at(.99), maxMs: sorted.at(-1),
    over16_7: values.filter(n => n > 16.7).length, over33: values.filter(n => n > 33.4).length,
    over50: values.filter(n => n > 50).length, over100: values.filter(n => n > 100).length };
};
const COUNTERS = /^(LayoutCount|RecalcStyleCount|LayoutDuration|RecalcStyleDuration|ScriptDuration|TaskDuration|Nodes|JSHeapUsedSize)$/;

async function run() {
  const turns = Number(process.env.READER_TURNS || 300);
  assert(Number.isSafeInteger(turns) && turns > 0 && turns <= 2000, 'INVALID_TURN_COUNT');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-frame-'));
  const out = path.resolve(process.env.READER_FRAME_OUTPUT || 'artifacts/explore-20261102/frames');
  fs.mkdirSync(out, { recursive: true });
  const seeded = await seed(root), { home, usage } = seeded;
  const producer = new Store(usage, roots(home)), now = Date.now();
  producer.state.sequence++; atomic(path.join(usage, 'statistics.json'), producer.state); producer.setEnabled(false);
  const longReply = '```js\n' + Array.from({ length: 40 }, (_, i) => 'const item' + i + ' = ' + i + ';').join('\n') + '\n```\n\n' + '合成内存测量段落。'.repeat(40);
  const longRows = [{ timestamp: new Date(now - 600000).toISOString(), type: 'session_meta', payload: { id: CODEX_ID, cwd: 'C:/synthetic/reader-frame', originator: 'codex_cli_rs' } }, { type: 'turn_context', payload: { model: 'gpt-4.1' } }];
  for (let i = 0; i < turns; i++) {
    const timestamp = new Date(now - 600000 + i * 1000).toISOString();
    longRows.push(
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '合成长会话问题 ' + i }] } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: longReply }] } },
      { timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: (i + 1) * 100, output_tokens: (i + 1) * 20, total_tokens: (i + 1) * 120 }, last_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } } } });
  }
  fs.writeFileSync(seeded.codexFile, longRows.map(row => JSON.stringify(row)).join('\n') + '\n');

  const report = { schemaVersion: 'ReaderFrameCheckV1', turns, syntheticOnly: true, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE),
    measurement: 'rAF gaps from real page.mouse.wheel input at a 16ms pace through the reader scroller; style/layout counters are CDP Performance deltas over the same window; main thread busy = (TaskDuration - ScriptDuration) / wall',
    noForcedGC: true, noSyntheticClock: true, scopes: {}, errors: [] };
  let app;
  const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  try {
    app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [
      ...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', path.join(root, 'quota'), '--m1-fixture-root', home], timeout: 60000 });
    await isolatePointer(app);
    const page = await app.firstWindow(); await page.waitForURL(/^file:/); await page.waitForLoadState('load');
    await until(page, () => window.usageData.ready());
    page.on('pageerror', error => report.errors.push(error.message));
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    const counters = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.filter(m => COUNTERS.test(m.name)).map(m => [m.name, m.value]));
    const startSampler = () => page.evaluate(() => { const s = window.readerFrames = { running: true, frames: [], previous: null };
      s.tick = at => { if (!s.running) return; if (s.previous !== null) s.frames.push(at - s.previous); s.previous = at; requestAnimationFrame(s.tick); }; requestAnimationFrame(s.tick); });
    const stopSampler = () => page.evaluate(() => { const s = window.readerFrames; s.running = false; return s.frames; });
    const measure = async (label, work) => {
      const before = await counters(), began = Date.now();
      await startSampler(); await page.waitForFunction(() => window.readerFrames.frames.length >= 2);
      await work();
      const frames = await stopSampler(), after = await counters(), wallMs = Date.now() - began;
      const delta = key => Number(((after[key] ?? 0) - (before[key] ?? 0)).toFixed(6));
      const scope = { label, wallMs, frames: stats(frames), layoutCount: delta('LayoutCount'), recalcStyleCount: delta('RecalcStyleCount'),
        layoutMs: Math.round(delta('LayoutDuration') * 1000), recalcStyleMs: Math.round(delta('RecalcStyleDuration') * 1000),
        taskMs: Math.round(delta('TaskDuration') * 1000), scriptMs: Math.round(delta('ScriptDuration') * 1000),
        nodes: after.Nodes, heapMiB: Math.round(after.JSHeapUsedSize / 1048576 * 10) / 10 };
      report.scopes[label] = scope; save(); console.log(JSON.stringify(scope)); return scope;
    };
    // Same path the reading check takes: the real session list, a search, its row.
    await showView(page, 'sessions');
    await page.getByRole('tablist', { name: '会话时间范围', exact: true }).getByRole('tab', { name: '全部', exact: true }).click();
    await until(page, () => !!window.sessionsHost.get().list && !window.sessionsHost.get().loading);
    const key = await page.evaluate(id => window.sessionsHost.get().list.sessions.find(row => row.id === id)?.key, CODEX_ID);
    assert(key, 'SEEDED_SESSION_MISSING');
    await page.getByRole('textbox', { name: '搜索会话', exact: true }).fill(CODEX_ID); await settle(page);
    const closedGroups = page.locator('[data-session-group] [data-fold-head] button[aria-expanded=false]');
    while (await closedGroups.count()) { await closedGroups.first().click(); await settle(page); }
    await page.locator('[data-session="' + key + '"] [data-fold-cell="tokens"]').click();
    await page.locator('[data-reader-turn]').first().waitFor(); await settle(page); await page.waitForTimeout(1200);
    assert.match(await page.locator('[data-reader-page] header').textContent(), new RegExp(turns + ' 轮'));
    report.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
    const scroller = page.locator('[data-reader-scroll]');
    await scroller.hover();
    const wheel = async (steps, delta) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, delta); await page.waitForTimeout(16); } };
    // Mount every turn first: the worst case is the whole document mounted, which is
    // what a person reaches by scrolling to the end of a long conversation.
    await page.locator('[data-outline-item="' + (turns - 1) + '"]').click();
    await page.locator('[data-reader-turn="' + (turns - 1) + '"]').waitFor(); await page.waitForTimeout(1500); await settle(page);
    report.mountedTurns = await page.locator('[data-reader-turn]').count();
    report.domNodes = await page.evaluate(() => document.querySelectorAll('*').length);
    // Warm the layout so the first measured frame is not the cold one.
    await measure('warmup', async () => { await wheel(10, 600); });
    await page.evaluate(() => { document.querySelector('[data-reader-scroll]').scrollTop = 4000; });
    await page.waitForTimeout(800);
    await measure('scroll-steady', async () => { await wheel(60, 240); });
    await measure('scroll-fast', async () => { await wheel(30, 1600); });
    await measure('jump-far', async () => { await page.locator('[data-outline-item="40"]').click(); await page.waitForTimeout(900); await page.locator('[data-outline-item="' + (turns - 2) + '"]').click(); await page.waitForTimeout(900); });
    await measure('scroll-back-up', async () => { await wheel(40, -600); });
    report.finalDomNodes = await page.evaluate(() => document.querySelectorAll('*').length);
    report.mountedTurnsAtEnd = await page.locator('[data-reader-turn]').count();
    if (report.errors.length) throw Error('RENDERER_ERRORS');
    report.ok = true; save();
  } catch (error) {
    report.failed = { message: error.message }; save();
    if (app) await app.firstWindow().then(page => page.screenshot({ path: path.join(out, 'failure.png') })).catch(() => {});
    throw error;
  } finally { if (app) await app.close(); await cleanup(root); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
