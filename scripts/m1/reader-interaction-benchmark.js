'use strict';
/* global document, requestAnimationFrame */
// Browser plugin not available for this Electron surface. Synthetic-only trusted
// pointer/wheel input; numeric receipts, no transcript dumps or pixel comparisons.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { seedReaderPerformance } = require('../../tests/m1/reader-performance-fixture');
const { showView, until, isolatePointer, cleanup } = require('./ui-settle');
const { desktopReadiness } = require('./desktop-readiness');
async function run() {
  const source = path.resolve(process.env.PERF_SOURCE_ROOT || '.'), out = path.resolve(process.env.PERF_OUTPUT || 'artifacts/reader-interaction');
  fs.mkdirSync(out, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-interaction-')), diagnostic = process.env.READER_DIAGNOSTIC === '1' || process.env.READER_LAYOUT === '1';
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const files = ['design/desktop-reference/ui/agent-ui.js', 'design/desktop-reference/sessions-model.js', 'design/desktop-reference/sessions-host.js', 'src/m1/transcript.js'];
  const report = { schemaVersion: 'ReaderInteractionV1', syntheticOnly: true, diagnostic, source: Object.fromEntries(files.map(file => [file, hash(path.join(source, file))])), probe: hash(__filename), fixture: hash(require.resolve('../../tests/m1/reader-performance-fixture')), phases: [], errors: [] };
  const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  let app, layout;
  try {
    report.desktopAdmission = desktopReadiness(); assert(report.desktopAdmission.eligible, 'DESKTOP_UNAVAILABLE');
    const { home, usage, ids } = await seedReaderPerformance(root), facts = fs.readFileSync(path.join(usage, 'statistics.json'));
    app = await electron.launch({ executablePath: require('electron'), cwd: source, args: ['src/quota/main.js', '--usage-data-dir', usage, '--quota-data-dir', path.join(root, 'quota'), '--m1-fixture-root', home], timeout: 60000 });
    const page = await app.firstWindow(); await isolatePointer(app);
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); });
    await page.waitForURL(/^file:/); await until(page, () => window.usageData.ready(), 60000);
    page.on('pageerror', error => report.errors.push(error.name + ':' + (error.message.match(/Minified React error #(\d+)/)?.[1] || 'RENDER_ERROR')));
    report.display = await app.evaluate(({ screen, BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0], display = screen.getDisplayMatching(win.getBounds()); let lost = 0; win.on('blur', () => lost++); globalThis.readerFocusLosses = () => lost; return { refresh: display.displayFrequency, scale: display.scaleFactor, bounds: win.getBounds(), focused: win.isFocused() }; });
    await showView(page, 'sessions');
    await page.getByRole('tablist', { name: '会话时间范围', exact: true }).getByRole('tab', { name: '全部', exact: true }).click();
    await until(page, () => Boolean(window.sessionsHost.list()) && !window.sessionsHost.get().loading, 60000);
    report.sessionCount = await page.evaluate(() => window.sessionsHost.list().sessions.length); assert(report.sessionCount >= 8000);
    await page.evaluate(({ ids, diagnostic }) => {
      localStorage.setItem('agentusage.reader.side.v1', 'open'); localStorage.setItem('agentusage.reader.nav.v1', 'open');
      const state = window.__readerPerf = { phase: 'setup', timeline: [], frames: [], events: [], tasks: [], calls: {}, previous: 0 };
      const phaseAt = at => state.timeline.findLast(row => row.at <= at)?.name || 'setup';
      new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.interactionId) state.events.push({ phase: phaseAt(entry.startTime), type: entry.name, duration: entry.duration, delay: entry.processingStart - entry.startTime, processing: entry.processingEnd - entry.processingStart }); }).observe({ type: 'event', durationThreshold: 16 });
      new PerformanceObserver(list => { for (const entry of list.getEntries()) state.tasks.push({ phase: phaseAt(entry.startTime), duration: entry.duration }); }).observe({ type: 'longtask' });
      const frame = at => { if (!window.__readerPerf) return; if (state.previous) state.frames.push({ phase: state.phase, duration: at - state.previous }); state.previous = at; requestAnimationFrame(frame); }; requestAnimationFrame(frame);
      if (diagnostic) { const original = window.sessionsModel; window.sessionsModel = { ...original, create(...args) { const model = original.create(...args); return Object.fromEntries(Object.entries(model).map(([key, value]) => [key, typeof value === 'function' ? (...params) => { const count = state.calls[state.phase] ||= {}; count[key] = (count[key] || 0) + 1; return value(...params); } : value])); } }; }
      window.__readerTargets = ids.map(id => window.sessionsHost.list().sessions.find(row => row.id === id));
      window.sessionsHost.read(window.__readerTargets[0]);
    }, { ids, diagnostic });
    await page.waitForFunction(() => document.querySelectorAll('[data-rail-mark]').length === 37, null, { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(700);
    const cdp = diagnostic ? await page.context().newCDPSession(page) : null;
    if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); }
    if (process.env.READER_LAYOUT === '1') layout = await require('./local-layout-profile').start(cdp);
    const phase = async (name, action, ready) => {
      await page.evaluate(name => { const state = window.__readerPerf; state.phase = name; performance.mark('local-perf:' + state.timeline.length + ':' + name); state.timeline.push({ name, at: performance.now() }); }, name);
      if (cdp) await cdp.send('Profiler.start');
      const started = performance.now(); await action(); if (ready) await ready();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      report.phases.push({ name, driverReadyMs: performance.now() - started }); await page.waitForTimeout(250);
      if (cdp) {
        const profile = (await cdp.send('Profiler.stop')).profile, counts = new Map(), nodes = new Map(profile.nodes.map(node => [node.id, node])), parents = new Map(profile.nodes.flatMap(node => (node.children || []).map(child => [child, node.id])));
        for (const id of profile.samples || []) counts.set(id, (counts.get(id) || 0) + 1);
        const location = node => ({ function: node.callFrame.functionName || '(anonymous)', script: path.basename(node.callFrame.url.split('?')[0]), line: node.callFrame.lineNumber + 1, column: node.callFrame.columnNumber + 1 });
        report.phases.at(-1).cpu = profile.nodes.filter(node => counts.has(node.id)).map(node => { const stack = []; for (let at = node; at && stack.length < 7; at = nodes.get(parents.get(at.id))) stack.push(location(at)); return { ...location(node), samples: counts.get(node.id), stack }; }).sort((a, b) => b.samples - a.samples).slice(0, 30);
      }
      save();
    };
    const scroll = async selector => { const region = page.locator(selector).first(); await region.hover(); const before = await region.evaluate(node => node.scrollTop); for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 180); await page.waitForTimeout(35); } assert(await region.evaluate(node => node.scrollTop) > before, 'SCROLL_DID_NOT_MOVE'); };
    await phase('body-scroll-with-facts', () => scroll('[data-reader-scroll]'));
    const tabs = page.getByRole('tablist', { name: '这次会话的内容', exact: true });
    for (const label of ['命令', '文件', '概况', '命令', '概况']) await phase('side-' + label + '-' + report.phases.length, () => tabs.getByRole('tab', { name: label, exact: true }).click(), () => page.locator('[data-reader-side][data-tab="' + ({ '命令': 'commands', '文件': 'files', '概况': 'facts' })[label] + '"]').waitFor());
    await phase('nav-sessions', () => page.getByRole('tablist', { name: '左栏内容', exact: true }).getByRole('tab', { name: '会话', exact: true }).click(), () => page.locator('[data-reader-sessions]').waitFor());
    await phase('nav-hover', async () => { const rows = page.locator('[data-nav-session]'); const count = Math.min(await rows.count(), 6); assert(count >= 2); for (let i = 0; i < count; i++) { await rows.nth(i).hover(); await page.waitForTimeout(50); } });
    const target = await page.evaluate(() => window.__readerTargets[1].key);
    const row = page.locator('[data-nav-open="' + target + '"]'); assert.equal(await row.count(), 1);
    await phase('nav-open-long', () => row.click(), () => page.waitForFunction(() => document.querySelectorAll('[data-rail-mark]').length === 180));
    await phase('body-scroll-long-with-facts', () => scroll('[data-reader-scroll]'));
    await phase('nav-outline', () => page.getByRole('tablist', { name: '左栏内容', exact: true }).getByRole('tab', { name: '目录', exact: true }).click(), () => page.locator('[data-reader-outline] [data-outline]').waitFor());
    await phase('outline-jump', () => page.locator('[data-reader-outline] [data-outline-item="90"]').click(), () => page.waitForFunction(() => document.querySelector('[data-reader-turn="90"]')));
    await page.waitForTimeout(800);
    report.rendered = await page.evaluate(() => ({ turns: document.querySelectorAll('[data-rail-mark]').length, drawn: document.querySelectorAll('[data-reader-turn]').length, nodes: document.querySelectorAll('*').length })); assert.equal(report.rendered.turns, 180);
    await phase('return-to-list', () => page.locator('[data-reader-back] button').click(), () => page.locator('[data-sessions-page]').waitFor());
    await page.waitForTimeout(300);
    report.interaction = await page.evaluate(() => { const state = window.__readerPerf; window.__readerPerf = null; const frames = name => { const a = state.frames.filter(row => row.phase === name).map(row => row.duration).sort((a, b) => a - b); return { count: a.length, p95: a[Math.floor(a.length * .95)], max: a.at(-1), over16: a.filter(n => n > 16).length, over50: a.filter(n => n > 50).length }; }; return { events: state.events, tasks: state.tasks, calls: state.calls, frames: Object.fromEntries(state.timeline.map(row => [row.name, frames(row.name)])) }; });
    if (layout) { report.layout = await layout.stop(); layout = null; }
    if (process.env.READER_CHECKS === '1') {
      // Functional checks run after timing has stopped. They must not turn a
      // reduced DOM into silently missing commands, lost focus or stale cards.
      report.checks = [];
      const check = (name, detail) => report.checks.push({ name, ok: true, detail });
      await page.evaluate(() => window.sessionsHost.read(window.__readerTargets[0]));
      await page.waitForFunction(() => document.querySelectorAll('[data-rail-mark]').length === 37);
      await page.getByRole('tablist', { name: '这次会话的内容', exact: true }).getByRole('tab', { name: '命令', exact: true }).click();
      const commands = page.locator('[data-reader-side-list="commands"]'), side = page.locator('[data-reader-side-body]');
      await page.waitForTimeout(300);
      const first = await commands.evaluate(node => ({ frames: node.querySelectorAll('[data-windowed-item]').length, drawn: node.querySelectorAll('[data-windowed-drawn="true"]').length }));
      assert.equal(first.frames, 200); assert(first.drawn > 0 && first.drawn < 150); check('long-commands-windowed', first);
      await side.focus(); await page.keyboard.press('End');
      await until(page, () => { const root = document.querySelector('[data-reader-side-body]'); return root.scrollTop > 1000; });
      await page.waitForTimeout(300);
      const visible = await commands.evaluate(node => { const root = node.closest('[data-reader-side-body]'), box = root.getBoundingClientRect(); const frames = [...node.querySelectorAll('[data-windowed-item]')].filter(item => { const at = item.getBoundingClientRect(); return at.bottom > box.top + 1 && at.top < box.bottom - 1; }); return { count: frames.length, blank: frames.filter(item => item.dataset.windowedDrawn !== 'true').length }; });
      assert(visible.count > 0); assert.equal(visible.blank, 0); check('commands-visible-at-end', visible);
      await commands.getByRole('button', { name: /^再显示 200 条/ }).click();
      assert.equal(await commands.locator('[data-windowed-item]').count(), 400); check('commands-more-keeps-all-entries', { frames: 400 });
      await side.focus(); await page.keyboard.press('Home'); await page.waitForTimeout(250);
      const copy = commands.getByRole('button', { name: '复制这条命令', exact: true }).first(); await copy.focus();
      assert(await copy.evaluate(node => node === document.activeElement));
      await side.evaluate(node => { node.scrollTop = node.scrollHeight; }); await page.waitForTimeout(300);
      assert(await copy.evaluate(node => node === document.activeElement && Boolean(node.closest('[data-windowed-drawn="true"]')))); check('command-focus-survives-windowing', {});
      await commands.getByRole('textbox', { name: '筛选命令', exact: true }).fill('synthetic-step-71');
      await until(page, () => document.querySelectorAll('[data-command-text]').length === 37);
      assert.equal(await commands.locator('[data-command-text]').count(), 37); check('search-covers-undrawn-commands', { matches: 37 });
      await page.getByRole('tablist', { name: '这次会话的内容', exact: true }).getByRole('tab', { name: '文件', exact: true }).click(); await page.waitForTimeout(300);
      const files = page.locator('[data-reader-side-list="files"]');
      const fileWindow = await files.evaluate(node => ({ frames: node.querySelectorAll('[data-windowed-item]').length, drawn: node.querySelectorAll('[data-file-name]').length }));
      assert(fileWindow.frames > fileWindow.drawn && fileWindow.drawn > 0 && fileWindow.drawn < 200); check('file-tree-windowed', fileWindow);
      await files.getByRole('textbox', { name: '筛选文件', exact: true }).fill('module-36-70');
      await until(page, () => document.querySelectorAll('[data-file-name]').length === 1);
      await files.getByRole('button', { name: 'module-36-70.js，修改', exact: true }).click();
      await page.locator('[data-reader-file]').waitFor(); assert((await page.locator('[data-reader-file]').textContent()).includes('module-36-70.js')); check('file-filter-reaches-past-first-page', {});
      await page.locator('[data-reader-file]').getByRole('button', { name: '显示全部', exact: true }).click();
      await page.getByRole('tablist', { name: '左栏内容', exact: true }).getByRole('tab', { name: '会话', exact: true }).click();
      const row = page.locator('[data-nav-open]').first(); await row.focus();
      await page.getByRole('tooltip').waitFor(); await page.keyboard.press('Escape');
      await page.getByRole('tooltip').waitFor({ state: 'hidden' }); check('session-card-focus-and-escape', {});
      await page.getByRole('tablist', { name: '这次会话的内容', exact: true }).getByRole('tab', { name: '概况', exact: true }).click();
      if (process.env.READER_CURRENT_SCREENSHOT === '1') { await page.waitForTimeout(700); await page.screenshot({ path: path.join(out, 'reader-current.png') }); }
    }
    report.windowEnd = await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; return { focused: win.isFocused(), visible: win.isVisible(), minimized: win.isMinimized(), focusLosses: globalThis.readerFocusLosses() }; });
    report.desktopEnd = desktopReadiness(); assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), facts);
    report.ok = report.errors.length === 0 && report.desktopEnd.eligible; report.measurementEligible = report.ok && !diagnostic && report.display.focused && report.windowEnd.focused && report.windowEnd.focusLosses === 0; save(); assert(report.ok);
    console.log(JSON.stringify({ ok: report.ok, measurementEligible: report.measurementEligible, output: out }));
  } catch (error) { report.ok = false; report.measurementEligible = false; report.failure = /^[A-Z_]+$/.test(error.message) ? error.message : 'READER_BENCHMARK_FAILED'; save(); throw error; }
  finally { if (layout) await layout.stop().catch(() => {}); await app?.close(); await cleanup(root); }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
