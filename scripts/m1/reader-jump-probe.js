'use strict';
/* global document, requestAnimationFrame, Element */
// What a jump actually asks the browser for, frame by frame: the offset the loop sees, the scroll it asks for
// and where the target sits afterwards. The window fills in below a jump, so a jump that looks landed on one
// frame can be carried away on the next. Synthetic records only.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron: electron } = require('playwright');
const { roots } = require('../../src/m1/policy');
const { scanSources } = require('../../src/m1/sources');
const { Store, atomic } = require('../../src/m1/store');
const { showView, settle, until, keepVisible, isolatePointer, cleanup } = require('./ui-settle');
const ROOT = path.resolve(process.env.JUMP_OUTPUT || path.join('artifacts', 'perf-20261103', 'jump-probe'));
const SESSION = '019a7c2e-1101-4000-8000-000000000021';
const TURNS = Number(process.env.WINDOW_TURNS || 90);
const MIDDLE = Number(process.env.JUMP_TURN || Math.floor(TURNS / 2));
const TALL = 3;

function build(home) {
  const selected = roots(home), started = Date.now() - 600000, rows = [], time = n => new Date(started + n * 1000).toISOString();
  rows.push({ timestamp: time(0), type: 'session_meta', payload: { id: SESSION, originator: 'codex_cli_rs', cwd: 'C:\\synthetic\\window' } }, { type: 'turn_context', payload: { model: 'gpt-4.1' } });
  for (let n = 0; n < TURNS; n++) {
    rows.push({ timestamp: time(n), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '问题 ' + n + ' WINDOW_QUESTION_' + n }] } });
    for (let k = 0; k < 2; k++) rows.push({ timestamp: time(n), type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c' + n + '-' + k, arguments: JSON.stringify({ command: 'echo step ' + n + '-' + k }) } },
      { timestamp: time(n), type: 'response_item', payload: { type: 'function_call_output', call_id: 'c' + n + '-' + k, output: 'WINDOW_OUTPUT_' + n + '\n' + '合成输出。'.repeat(40) } });
    const reply = n === TALL ? 'WINDOW_REPLY_' + n + '\n\n' + '合成长段落。'.repeat(1500) + '\n\nWINDOW_TALL_TAIL' : 'WINDOW_REPLY_' + n + '\n\n' + '合成段落。'.repeat(30);
    rows.push({ timestamp: time(n), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply }] } });
    rows.push({ timestamp: time(n), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: (n + 1) * 100, output_tokens: (n + 1) * 20, total_tokens: (n + 1) * 120 }, last_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } } } });
  }
  const file = path.join(selected.codex[0], '2026', '11', '02', 'rollout-window-' + SESSION + '.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const usage = path.join(path.dirname(home), 'usage'), store = new Store(usage, selected);
  return { selected, file, usage, store };
}

(async () => {
  fs.mkdirSync(ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-jump-'));
  const report = { syntheticOnly: true, turns: TURNS, middle: MIDDLE, runs: [] };
  let app;
  try {
    const home = path.join(root, 'home'), built = build(home), { usage, store } = built;
    store.ingest(await scanSources(built.selected, store.state.salt, { reads: 0 }), { status: 'not-run' }); store.setEnabled(false);
    atomic(path.join(usage, 'statistics.json'), store.state);
    app = await electron.launch({
      executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'),
      args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', path.join(root, 'quota'), '--m1-fixture-root', home],
      timeout: 60000
    });
    await isolatePointer(app);
    const page = await app.firstWindow();
    await keepVisible(app);
    await page.waitForURL(/^file:/);
    await until(page, () => window.usageData.ready(), 60000);
    await showView(page, 'sessions');
    await page.getByRole('tablist', { name: '会话时间范围', exact: true }).getByRole('tab', { name: '全部', exact: true }).click();
    await until(page, () => Boolean(window.sessionsHost.get().list) && !window.sessionsHost.get().loading, 60000);
    await page.evaluate(id => { const host = window.sessionsHost; host.read(host.get().list.sessions.find(row => row.id === id)); }, SESSION);
    await page.locator('[data-reader-page]').waitFor();
    await page.waitForFunction(n => (document.querySelector('[data-reader-header]')?.textContent || '').includes(n + ' 轮'), TURNS, { timeout: 90000 });
    await settle(page);
    await until(page, () => document.querySelectorAll('[data-reader-turn]').length > 0, 60000);
    await page.evaluate(() => document.fonts.ready);

    // Instrument from the page: every scrollIntoView call and every frame's offset, from before the click until
    // the place stops moving. Inside the page, so nothing of the measurement itself is a click.
    await page.evaluate(turn => {
      window.__jump = { calls: [], frames: [], landing: null };
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function patched(...args) {
        const root = this.closest('[data-reader-scroll]');
        const before = root ? Math.round(root.scrollTop) : null;
        const box = this.getBoundingClientRect(), at = root ? root.getBoundingClientRect() : null;
        const value = original.apply(this, args);
        if (root) window.__jump.calls.push({ t: Math.round(performance.now()), before, after: Math.round(root.scrollTop), top: Math.round(box.top - at.top), block: args[0]?.block ?? null });
        return value;
      };
      const root = document.querySelector('[data-reader-scroll]');
      let last = null, frames = 0;
      const tick = () => {
        const frame = document.querySelector('[data-reader-turn-frame="' + turn + '"]');
        if (frame && root) {
          const box = frame.getBoundingClientRect(), at = root.getBoundingClientRect();
          const top = Math.round(box.top - at.top), scrollTop = Math.round(root.scrollTop), scrollHeight = Math.round(root.scrollHeight);
          if (top !== last) { last = top; window.__jump.frames.push({ t: Math.round(performance.now()), top, scrollTop, scrollHeight, drawn: frame.getAttribute('data-windowed-drawn') }); }
        }
        if (++frames < 240) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, MIDDLE);
    const started = Date.now();
    await page.locator('[data-reader-outline] [data-outline-item="' + MIDDLE + '"]').click();
    await page.waitForTimeout(2500);
    const after = await page.evaluate(turn => {
      const frame = document.querySelector('[data-reader-turn-frame="' + turn + '"]'), root = document.querySelector('[data-reader-scroll]');
      const box = frame?.getBoundingClientRect(), at = root?.getBoundingClientRect();
      return { top: box && at ? Math.round(box.top - at.top) : null, scrollTop: Math.round(root.scrollTop), scrollHeight: Math.round(root.scrollHeight),
        calls: window.__jump.calls.length, frames: window.__jump.frames.length };
    }, MIDDLE);
    const trace = await page.evaluate(() => window.__jump);
    report.runs.push({ wallMs: Date.now() - started, after, calls: trace.calls.slice(0, 40), frames: trace.frames.slice(0, 40) });
    const landed = after.top !== null && after.top >= -4 && after.top < 160;
    report.landed = landed;
    fs.writeFileSync(path.join(ROOT, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ landed, top: after.top, calls: after.calls, frames: after.frames }));
    if (!landed) process.exitCode = 1;
  } catch (error) {
    report.error = error.message;
    fs.writeFileSync(path.join(ROOT, 'results.json'), JSON.stringify(report, null, 2));
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (app) await app.close().catch(() => {});
    await cleanup(root);
  }
})();
