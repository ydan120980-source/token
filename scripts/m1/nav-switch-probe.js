'use strict';
/* global document, requestAnimationFrame, MutationObserver, innerHeight */
// What a page switch costs a person, measured from inside the page.
//
// The earlier figures came from `page.locator(...).click()`, and that click is not free: Playwright
// waits for the button to be stable and hit-testable, and its own waits poll `getAnimations()` on the
// same thread that is drawing. A person pressing a real button pays none of that, so this probe
// dispatches the click from inside the page and the page records its own timeline. Each mark is named
// for exactly what it observes, because none of them is "usable" on its own:
//
//   viewAttributeMs  the shell's view attribute flipped (React committed the new page)
//   pageRootMs       the new page's own root element exists in the document
//   tenthFrameMs     ten frames have been drawn since the click
//   contentVisibleMs the page root is present and painted, with nothing left undrawn in it
//   controlResponseMs after that, a real pointer wheel over the page's own scroll region moves it
//
// The last one is the acceptance the first four cannot give: a control on the visible page answers a
// real pointer event. Synthetic home only.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron: electron } = require('playwright');
const { seed, CODEX_ID } = require('../../tests/m1/sessions-reader-fixture');
const { Store, atomic } = require('../../src/m1/store');
const { roots } = require('../../src/m1/policy');
const { showView, settle, until, isolatePointer, cleanup } = require('./ui-settle');

const VIEWS = ['quota', 'usage', 'cost', 'sessions', 'sources', 'settings'];
const PAGES = { cost: '[data-cost-page]', sessions: '[data-sessions-page]', usage: '#usage', quota: '#quota', sources: '#sources', settings: '#settings' };

async function run() {
  const turns = Number(process.env.NAV_TURNS || 60);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-switch-'));
  const out = path.resolve(process.env.NAV_OUTPUT || 'artifacts/perf-20261103/nav-switch');
  fs.mkdirSync(out, { recursive: true });
  const seeded = await seed(root), { home, usage } = seeded;
  const producer = new Store(usage, roots(home)), now = Date.now();
  producer.state.sequence++; atomic(path.join(usage, 'statistics.json'), producer.state); producer.setEnabled(false);
  const rows = [{ timestamp: new Date(now - 600000).toISOString(), type: 'session_meta', payload: { id: CODEX_ID, cwd: 'C:/synthetic/nav-switch', originator: 'codex_cli_rs' } }, { type: 'turn_context', payload: { model: 'gpt-4.1' } }];
  for (let i = 0; i < turns; i++) {
    const timestamp = new Date(now - 600000 + i * 1000).toISOString();
    rows.push(
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '合成导航问题 ' + i }] } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '合成导航回复 ' + i + '。' + '说明段落。'.repeat(40) }] } },
      { timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: (i + 1) * 100, output_tokens: (i + 1) * 20, total_tokens: (i + 1) * 120 } } } });
  }
  fs.writeFileSync(seeded.codexFile, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const report = { schemaVersion: 'NavSwitchProbeV2', turns, syntheticOnly: true, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE),
    measurement: 'in-page click; view attribute, page root, ten frames, visible page, and a real pointer wheel over the page\'s own scroll region, all recorded by the page itself', views: [], revisits: [], pairs: [], errors: [] };
  let app;
  const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  const stats = values => { if (!values.length) return { count: 0, medianMs: 0, p95Ms: 0, maxMs: 0 };
    const sorted = values.toSorted((a, b) => a - b);
    return { count: values.length, medianMs: Math.round(sorted[Math.floor(sorted.length / 2)]), p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)]), maxMs: Math.round(sorted.at(-1)) }; };
  try {
    // Startup is timed from the launch call itself, so nothing is hidden behind a later await.
    const launchAt = Date.now();
    app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [
      ...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', path.join(root, 'quota'), '--m1-fixture-root', home], timeout: 60000 });
    const launchedMs = Date.now() - launchAt;
    await isolatePointer(app);
    const windowAt = Date.now();
    const page = await app.firstWindow();
    const windowMs = Date.now() - windowAt;
    await page.waitForURL(/^file:/); await page.waitForLoadState('load');
    const loadMs = Date.now() - launchAt;
    page.on('pageerror', error => report.errors.push(error.message));
    await until(page, () => window.usageData.ready());
    const readyMs = Date.now() - launchAt;
    await settle(page);
    report.startup = { launchedMs, windowMs, loadMs, readyMs, settledMs: Date.now() - launchAt };
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    const counters = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics
      .filter(m => /^(LayoutCount|RecalcStyleCount|LayoutDuration|RecalcStyleDuration|ScriptDuration|TaskDuration|Nodes)$/.test(m.name)).map(m => [m.name, m.value]));
    // After the page is on screen, drive it with real input and wait for the page to answer. Two answers
    // count, and which one applies is a property of the page, not of the probe:
    //   wheel — the page is taller than the window, so a real wheel has to move it;
    //   hover — the page fits the window, so there is nothing to scroll and the nearest real control has
    //           to take the pointer instead. Either way the person's input reaches the page they see.
    const respond = async (marker) => {
      const region = await page.evaluate(sel => {
        const root = document.querySelector(sel);
        if (!root) return null;
        const box = root.getBoundingClientRect();
        const inner = [root, ...root.querySelectorAll('*')].find(element => element.scrollHeight > element.clientHeight + 24 && element.clientHeight > 120);
        const scrollable = Math.round(window.scrollY) !== Math.round(Math.max(0, document.documentElement.scrollHeight - innerHeight)) || document.documentElement.scrollHeight > innerHeight + 24;
        const control = inner ? null : [...root.querySelectorAll('button, a[href], input, [role="button"]')].find(element => {
          const at = element.getBoundingClientRect();
          return at.width > 8 && at.height > 8 && at.top >= box.top - 2 && at.bottom <= box.bottom + 2;
        });
        const anchor = inner || control;
        const at = anchor?.getBoundingClientRect();
        return {
          x: Math.round(at ? at.left + Math.min(at.width / 2, 120) : box.left + box.width / 2),
          y: Math.round(at ? at.top + Math.min(at.height / 2, 120) : box.top + Math.min(box.height / 2, 200)),
          windowPosition: Math.round(window.scrollY),
          innerBefore: inner ? Math.round(inner.scrollTop) : null,
          scrollable,
          region: inner ? (inner.id || inner.className?.toString().split(' ')[0] || inner.tagName.toLowerCase()) : (control ? (control.getAttribute('data-control') || control.tagName.toLowerCase()) : 'window')
        };
      }, marker);
      if (!region) return { skipped: 'no page root' };
      const began = Date.now();
      await page.mouse.move(region.x, region.y, { steps: 4 });
      if (region.scrollable) {
        await page.mouse.wheel(0, 320);
        const moved = await page.waitForFunction(before => Math.round(window.scrollY) !== before.windowPosition
          || [...document.querySelectorAll('*')].some(element => element.scrollHeight > element.clientHeight + 24 && Math.round(element.scrollTop) !== (before.innerBefore ?? -1) && Math.round(element.scrollTop) !== 0), region, { timeout: 5000, polling: 'raf' }).then(() => true).catch(() => false);
        return { kind: 'wheel', region: region.region, moved, ms: Date.now() - began };
      }
      // Nothing scrolls here, so the page answers through the control under the cursor: the browser only
      // reports :hover for a node that is really painted there and really received the pointer.
      const hovered = await page.waitForFunction(({ x, y }) => {
        const at = document.elementFromPoint(x, y);
        return Boolean(at && at.closest(':hover') && document.querySelectorAll(':hover').length > 1);
      }, { x: region.x, y: region.y }, { timeout: 5000, polling: 'raf' }).then(() => true).catch(() => false);
      return { kind: 'hover', region: region.region, moved: hovered, ms: Date.now() - began };
    };
    const moved = async (from, to) => {
      if (from) await showView(page, from);
      await settle(page);
      const before = await counters();
      const seen = await page.evaluate(({ view, marker }) => {
        const main = document.getElementById('main'), out = { viewAt: null, rootAt: null, visibleAt: null, frames: [], longTasks: [] };
        const started = performance.now();
        return new Promise(resolve => {
          const long = new PerformanceObserver(list => { for (const entry of list.getEntries()) out.longTasks.push(Math.round(entry.duration)); });
          long.observe({ entryTypes: ['longtask'] });
          const observer = new MutationObserver(() => { if (out.viewAt === null && main.dataset.currentView === view) out.viewAt = Math.round(performance.now() - started); });
          observer.observe(main, { attributes: true, attributeFilter: ['data-current-view', 'class'] });
          const step = () => {
            const at = performance.now() - started;
            const root = document.querySelector(marker);
            if (out.rootAt === null && root) out.rootAt = Math.round(at);
            // The page is on screen when its own root is laid out and no windowed item in it is still
            // a placeholder: that is the first frame a person could read, not the tenth.
            if (out.visibleAt === null && root) {
              const box = root.getBoundingClientRect();
              if (box.width > 0 && box.height > 0 && root.querySelectorAll('[data-windowed-drawn="false"]').length === 0) out.visibleAt = Math.round(at);
            }
            out.frames.push(Math.round(at));
            if (out.frames.length < 10) requestAnimationFrame(step);
            else { observer.disconnect(); long.disconnect(); resolve(out); }
          };
          requestAnimationFrame(step);
          document.querySelector('[data-view="' + view + '"]').click();
        });
      }, { view: to, marker: PAGES[to] });
      const after = await counters(), delta = key => after[key] - before[key];
      const gaps = seen.frames.slice(1).map((at, index) => at - seen.frames[index]);
      // What a person sees, read again after the tenth frame: the page root is in the document at a
      // real size and nothing inside it is still a placeholder.
      const visible = await page.evaluate(sel => {
        const root = document.querySelector(sel);
        if (!root) return { present: false };
        const box = root.getBoundingClientRect();
        return { present: true, width: Math.round(box.width), height: Math.round(box.height), undrawn: root.querySelectorAll('[data-windowed-drawn="false"]').length };
      }, PAGES[to]);
      const response = await respond(PAGES[to]);
      return { from: from || null, to,
        viewAttributeMs: seen.viewAt, pageRootMs: seen.rootAt, tenthFrameMs: seen.frames.at(-1),
        contentVisibleMs: seen.visibleAt,
        visible, control: response,
        frameGaps: stats(gaps), longTasks: seen.longTasks.length ? { count: seen.longTasks.length, totalMs: seen.longTasks.reduce((a, b) => a + b, 0), maxMs: Math.max(...seen.longTasks) } : { count: 0, totalMs: 0, maxMs: 0 },
        layoutCount: Math.round(delta('LayoutCount')), recalcStyleCount: Math.round(delta('RecalcStyleCount')),
        layoutMs: Math.round(delta('LayoutDuration') * 1000), recalcStyleMs: Math.round(delta('RecalcStyleDuration') * 1000),
        scriptMs: Math.round(delta('ScriptDuration') * 1000), taskMs: Math.round(delta('TaskDuration') * 1000), nodes: Math.round(delta('Nodes')) };
    };
    for (const view of VIEWS) { const entry = await moved(null, view); report.views.push(entry); console.log(JSON.stringify(entry)); save(); }
    for (const view of VIEWS) { const entry = await moved(null, view); report.revisits.push(entry); console.log(JSON.stringify(entry)); save(); }
    for (const [from, to] of [['sessions', 'cost'], ['cost', 'sessions'], ['sessions', 'usage'], ['usage', 'sessions'], ['usage', 'cost'], ['cost', 'usage'], ['quota', 'sessions'], ['sessions', 'quota']]) {
      const entry = await moved(from, to); report.pairs.push(entry); console.log(JSON.stringify(entry)); save();
    }
    const all = [...report.views, ...report.revisits, ...report.pairs];
    const answered = all.filter(entry => entry.control && entry.control.moved === true);
    report.summary = {
      viewAttribute: stats(all.map(entry => entry.viewAttributeMs).filter(Number.isFinite)),
      pageRoot: stats(all.map(entry => entry.pageRootMs).filter(Number.isFinite)),
      tenthFrame: stats(all.map(entry => entry.tenthFrameMs).filter(Number.isFinite)),
      controlResponse: stats(answered.map(entry => entry.control.ms)),
      controlAnswered: answered.length,
      controlSkipped: all.filter(entry => entry.control && entry.control.skipped).length,
      controlUnanswered: all.filter(entry => entry.control && entry.control.moved === false).map(entry => entry.to),
      longTaskMaxMs: Math.max(...all.map(entry => entry.longTasks.maxMs)),
      longTaskTotal: all.map(entry => entry.longTasks.totalMs).reduce((a, b) => a + b, 0),
      longTasksOver50: all.reduce((total, entry) => total + (entry.longTasks.count || 0), 0),
    };
    report.ok = report.summary.controlUnanswered.length === 0;
    save();
    console.log(JSON.stringify(report.summary, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    report.failed = { message: error.message }; save(); throw error;
  } finally { if (app) await app.close(); await cleanup(root); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });

