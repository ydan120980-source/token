'use strict';
/* global document, requestAnimationFrame, getComputedStyle */
// What the window gives a person, not what it leaves in the DOM: the turns they can see are drawn with their real
// text, the rest keep a stable height, and every way of moving through the conversation lands where the outline,
// the find bar and the follow button promise. Synthetic records only.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron: electron } = require('playwright');
const { roots } = require('../../src/m1/policy');
const { scanSources } = require('../../src/m1/sources');
const { Store, atomic } = require('../../src/m1/store');
const { showView, settle, until, keepVisible, isolatePointer, cleanup } = require('./ui-settle');
const ROOT = path.resolve(process.env.WINDOW_OUTPUT || path.join('artifacts', 'perf-20261103', 'window-list'));
const SESSION = '019a7c2e-1101-4000-8000-000000000021';
const TURNS = Number(process.env.WINDOW_TURNS || 90);
// Turn 3 is much taller than the rest, so the estimated height of an undrawn turn cannot match every turn.
const TALL = 3;

function build(home) {
  const selected = roots(home), started = Date.now() - 600000, rows = [], time = n => new Date(started + n * 1000).toISOString();
  rows.push({ timestamp: time(0), type: 'session_meta', payload: { id: SESSION, originator: 'codex_cli_rs', cwd: 'C:\\synthetic\\window' } }, { type: 'turn_context', payload: { model: 'gpt-4.1' } });
  for (let n = 0; n < TURNS; n++) {
    rows.push({ timestamp: time(n), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '问题 ' + n + ' WINDOW_QUESTION_' + n }] } });
    // A run of tool calls folds into one process line that the person can open, which changes the turn's height.
    // What the Agent says between its steps stays on the page.
    for (let k = 0; k < 2; k++) rows.push(...(n === 5 && k === 1 ? [{ timestamp: time(n), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'WINDOW_NOTE_5' }] } }] : []), { timestamp: time(n), type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c' + n + '-' + k, arguments: JSON.stringify({ command: 'echo step ' + n + '-' + k }) } },
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-window-'));
  const report = { syntheticOnly: true, turns: TURNS, checks: [], timings: {}, errors: [] };
  const check = (name, ok, detail) => { report.checks.push({ name, ok: Boolean(ok), detail }); if (!ok) report.failed = report.failed || name; };
  let app;
  try {
    const home = path.join(root, 'home'), built = build(home), { file, usage, store } = built;
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
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.waitForURL(/^file:/);
    await until(page, () => window.usageData.ready(), 60000);
    await showView(page, 'sessions');
    await page.getByRole('tablist', { name: '会话时间范围', exact: true }).getByRole('tab', { name: '全部', exact: true }).click();
    await until(page, () => Boolean(window.sessionsHost.get().list) && !window.sessionsHost.get().loading, 60000);
    await page.evaluate(id => {
      window.__readerRevealBounds = [];
      const tick = () => {
        if (!window.__readerRevealBounds) return;
        for (const node of document.querySelectorAll('[data-reader-reveal]')) {
          const opacity = Number(getComputedStyle(node).opacity);
          if (opacity <= 0 || opacity >= .999) continue;
          const scroll = node.querySelector('[data-reader-scroll]');
          if (scroll) window.__readerRevealBounds.push({ opacity, height: node.getBoundingClientRect().height, viewport: scroll.clientHeight, scrollHeight: scroll.scrollHeight });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const host = window.sessionsHost; host.read(host.get().list.sessions.find(row => row.id === id));
    }, SESSION);
    await page.locator('[data-reader-page]').waitFor();
    await page.waitForFunction(n => (document.querySelector('[data-reader-header]')?.textContent || '').includes(n + ' 轮'), TURNS, { timeout: 90000 });
    await settle(page);
    await until(page, () => document.querySelectorAll('[data-reader-turn]').length > 0, 60000);
    await page.evaluate(() => document.fonts.ready);

    // Reading the window: which frames exist, which are drawn, and what a person would see at the top.
    const mount = () => page.evaluate(() => {
      const scroller = document.querySelector('[data-reader-scroll]');
      const frames = [...document.querySelectorAll('[data-reader-turn-frame]')];
      const at = scroller.getBoundingClientRect();
      const drawn = frames.filter(frame => frame.getAttribute('data-windowed-drawn') === 'true');
      const visible = frames.filter(frame => { const box = frame.getBoundingClientRect(); return box.bottom > at.top + 2 && box.top < at.bottom - 2; });
      const undrawnVisible = visible.filter(frame => frame.getAttribute('data-windowed-drawn') !== 'true');
      return {
        frames: frames.length, drawn: drawn.length, drawnIndexes: drawn.map(frame => Number(frame.getAttribute('data-windowed-item'))),
        visible: visible.map(frame => Number(frame.getAttribute('data-windowed-item'))), undrawnVisible: undrawnVisible.map(frame => Number(frame.getAttribute('data-windowed-item'))),
        scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, viewport: at.height,
        heights: Object.fromEntries(frames.slice(0, 6).map(frame => [frame.getAttribute('data-windowed-item'), Math.round(frame.getBoundingClientRect().height)])),
        hasText: visible.length > 0 && visible.every(frame => (frame.textContent || '').length > 0)
      };
    });
    const topOf = index => page.evaluate(i => {
      const frame = document.querySelector('[data-reader-turn-frame="' + i + '"]'), scroller = document.querySelector('[data-reader-scroll]');
      if (!frame || !scroller) return null;
      return Math.round(frame.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
    }, index);

    // 1. Opening a long conversation does not draw it, and the turns it has mounted are all frames.
    const opened = await mount();
    report.opened = opened;
    const revealBounds = await page.evaluate(() => { const rows = window.__readerRevealBounds; window.__readerRevealBounds = null; return rows; });
    report.reveal = { samples: revealBounds.length, opacityRange: [Math.min(1, ...revealBounds.map(row => row.opacity)), Math.max(0, ...revealBounds.map(row => row.opacity))], maximumHeight: Math.max(0, ...revealBounds.map(row => row.height)), maximumScrollHeight: Math.max(0, ...revealBounds.map(row => row.scrollHeight)) };
    check('the real opening animation covers only the viewport, not the long scroll surface', revealBounds.length > 1 && report.reveal.opacityRange[1] - report.reveal.opacityRange[0] > .1 && revealBounds.every(row => row.height <= row.viewport + 2) && revealBounds.some(row => row.scrollHeight > row.viewport * 3), JSON.stringify(report.reveal));
    check('opening mounts a page of turns, not the whole conversation', opened.frames >= 30 && opened.frames < TURNS, JSON.stringify({ frames: opened.frames, turns: TURNS }));
    check('opening draws only the turns near the top', opened.drawn < 20, JSON.stringify({ drawn: opened.drawn, indexes: opened.drawnIndexes }));
    check('what is on screen is drawn, never a placeholder', opened.undrawnVisible.length === 0 && opened.hasText, JSON.stringify({ undrawnVisible: opened.undrawnVisible }));
    check('an undrawn turn keeps a height instead of collapsing', Object.values(opened.heights).every(height => height > 100), JSON.stringify(opened.heights));

    // 2. Scrolling to a middle turn draws it, and coming back keeps the same anchor.
    const scroller = page.locator('[data-reader-scroll]').first();
    await scroller.hover();
    for (let step = 0; step < 12; step++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(60); }
    await settle(page);
    const midway = await mount();
    report.midway = midway;
    check('a mid-conversation view draws what is in it', midway.undrawnVisible.length === 0, JSON.stringify({ undrawnVisible: midway.undrawnVisible, drawn: midway.drawn }));
    check('scrolling down does not draw the whole conversation', midway.drawn < 30, JSON.stringify({ drawn: midway.drawn }));
    const anchorIndex = midway.visible[0];
    const anchorBefore = await topOf(anchorIndex);
    for (let step = 0; step < 12; step++) { await page.mouse.wheel(0, -900); await page.waitForTimeout(60); }
    for (let step = 0; step < 12; step++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(60); }
    await settle(page);
    const anchorAfter = await topOf(anchorIndex);
    report.anchor = { index: anchorIndex, before: anchorBefore, after: anchorAfter };
    check('returning to a place puts the same turn back under the eye', anchorBefore !== null && anchorAfter !== null && Math.abs(anchorAfter - anchorBefore) < 120, JSON.stringify(report.anchor));

    // Switching what is shown and back still reaches the end of the conversation (owner 2026-11-05: it used to stop at 30 turns).
    const views = page.getByRole('tablist', { name: '显示内容', exact: true });
    await views.getByRole('tab', { name: '只看对话', exact: true }).click(); await settle(page);
    await views.getByRole('tab', { name: '全部', exact: true }).click(); await settle(page);
    for (let at = 0; at < 40 && await page.locator('[data-reader-turn-frame]').count() < TURNS; at++) {
      await page.evaluate(() => { const scroller = document.querySelector('[data-reader-scroll]'); scroller.scrollTop = scroller.scrollHeight; });
      await page.waitForTimeout(120);
    }
    check('after switching views every turn can still be reached', await page.locator('[data-reader-turn-frame]').count() === TURNS, String(await page.locator('[data-reader-turn-frame]').count()));
    await page.evaluate(() => { document.querySelector('[data-reader-scroll]').scrollTop = 0; }); await settle(page);
    const noted = page.locator('[data-reader-turn="5"]');
    await page.locator('[data-reader-outline] [data-outline-item="5"]').click().catch(() => {});
    await noted.waitFor({ timeout: 10000 }).catch(() => {}); await settle(page);
    check('what the Agent said between its steps reads without opening anything', (await noted.innerText().catch(() => '')).includes('WINDOW_NOTE_5'));
    await page.evaluate(() => { document.querySelector('[data-reader-scroll]').scrollTop = 0; }); await settle(page);

    // 3. A turn that grows — a process opened, and a reply read in full — keeps the turns around it still.
    const beforeGrowth = await mount();
    const target = beforeGrowth.visible.find(index => index !== TALL && index !== 5) ?? beforeGrowth.visible[0];
    const grew = await page.evaluate(index => {
      const turn = document.querySelector('[data-reader-turn="' + index + '"]'), summary = turn?.querySelector('[data-reader-process] button');
      const before = turn?.getBoundingClientRect().height ?? 0;
      summary?.click();
      return { before, clicked: Boolean(summary) };
    }, target);
    await page.waitForTimeout(400); await settle(page);
    const afterGrowth = await page.evaluate(index => {
      const turn = document.querySelector('[data-reader-turn="' + index + '"]');
      return { after: turn?.getBoundingClientRect().height ?? 0, drawn: turn?.closest('[data-windowed-item]')?.getAttribute('data-windowed-drawn') ?? null };
    }, target);
    report.growth = { target, ...grew, ...afterGrowth };
    check('opening a folded process grows the turn that was opened', grew.clicked && afterGrowth.after > grew.before + 20, JSON.stringify(report.growth));
    check('the grown turn stays drawn', afterGrowth.drawn === 'true', String(afterGrowth.drawn));
    const grownMount = await mount();
    check('the grown turn keeps its neighbours drawn', grownMount.undrawnVisible.length === 0, JSON.stringify({ undrawnVisible: grownMount.undrawnVisible }));

    // 4. Reading a long reply in full, asynchronously, keeps the turn it belongs to drawn and readable.
    const tallDrawn = await page.evaluate(() => Boolean(document.querySelector('[data-reader-turn="3"]')));
    if (!tallDrawn) {
      await page.locator('[data-reader-outline] [data-outline-item="3"]').click().catch(() => {});
      await page.waitForTimeout(600); await settle(page);
    }
    const asyncStart = await page.evaluate(() => {
      const turn = document.querySelector('[data-reader-turn="3"]');
      const button = [...(turn?.querySelectorAll('button') ?? [])].find(node => /显示全部|继续显示/.test(node.textContent || ''));
      const before = turn?.getBoundingClientRect().height ?? 0;
      button?.click();
      return { found: Boolean(button), before, text: turn?.textContent?.length ?? 0 };
    });
    await page.waitForTimeout(800); await settle(page);
    const asyncEnd = await page.evaluate(() => {
      const turn = document.querySelector('[data-reader-turn="3"]');
      return { text: turn?.textContent?.length ?? 0, height: turn?.getBoundingClientRect().height ?? 0, drawn: turn?.closest('[data-windowed-item]')?.getAttribute('data-windowed-drawn') ?? null, tail: (turn?.textContent || '').includes('WINDOW_TALL_TAIL') };
    });
    report.asyncContent = { ...asyncStart, ...asyncEnd };
    check('a long reply is read in full where it stands', !asyncStart.found || asyncEnd.text > asyncStart.text, JSON.stringify(report.asyncContent));
    check('a reply read in full stays drawn', asyncEnd.drawn === 'true', String(asyncEnd.drawn));

    // 5. A narrow window re-flows the text; the turn under the eye stays under it.
    const narrowAnchor = await mount();
    const narrowIndex = narrowAnchor.visible[0];
    const narrowBefore = await topOf(narrowIndex);
    await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.setSize(900, 850); });
    await page.waitForTimeout(700); await settle(page);
    const narrow = await mount();
    report.resize = { index: narrowIndex, before: narrowBefore, after: await topOf(narrowIndex), drawn: narrow.drawn, undrawnVisible: narrow.undrawnVisible };
    check('a narrower column re-flows without leaving the view blank', narrow.undrawnVisible.length === 0, JSON.stringify(report.resize));
    check('a narrower column keeps the turn under the eye close by', Math.abs(report.resize.after - narrowBefore) < 400, JSON.stringify(report.resize));
    await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.setSize(1180, 850); });
    await page.waitForTimeout(700); await settle(page);

    // 6. A far jump: the outline names turn 89 from the top of a conversation whose heights are only estimated.
    await page.evaluate(() => { const scroller = document.querySelector('[data-reader-scroll]'); scroller.scrollTop = 0; });
    await settle(page);
    const jumpAt = Date.now();
    const outline = page.locator('[data-reader-outline] [data-outline-item="' + (TURNS - 1) + '"]');
    if (await outline.count()) await outline.click();
    await page.locator('[data-reader-turn="' + (TURNS - 1) + '"]').waitFor({ timeout: 20000 });
    await page.waitForFunction(last => {
      const frame = document.querySelector('[data-reader-turn-frame="' + last + '"]'), scroller = document.querySelector('[data-reader-scroll]');
      if (!frame || !scroller) return false;
      const box = frame.getBoundingClientRect(), at = scroller.getBoundingClientRect();
      return frame.getAttribute('data-windowed-drawn') === 'true' && box.top >= at.top - 4 && box.top < at.bottom;
    }, TURNS - 1, { timeout: 20000 }).catch(() => {});
    report.timings.jumpToLast = Date.now() - jumpAt;
    const far = await mount();
    const farTop = await topOf(TURNS - 1);
    report.far = { ...far, targetTop: farTop };
    check('a far jump draws its destination', far.drawnIndexes.includes(TURNS - 1), JSON.stringify({ drawn: far.drawnIndexes }));
    // The last turn cannot sit at the top edge — there is no paper below it to scroll — so it must be fully in view.
    const farBox = await page.evaluate(last => {
      const frame = document.querySelector('[data-reader-turn-frame="' + last + '"]'), scroller = document.querySelector('[data-reader-scroll]');
      const box = frame.getBoundingClientRect(), at = scroller.getBoundingClientRect();
      return { top: Math.round(box.top - at.top), bottom: Math.round(box.bottom - at.top), viewport: at.height };
    }, TURNS - 1);
    report.far.end = farBox;
    check('a far jump leaves its destination wholly on screen', farBox.top >= -4 && farBox.bottom <= farBox.viewport + 8, JSON.stringify(farBox));
    check('a far jump does not draw the turns it passed', far.drawn < 30, JSON.stringify({ drawn: far.drawn }));
    check('a far jump leaves nothing on screen undrawn', far.undrawnVisible.length === 0, JSON.stringify({ undrawnVisible: far.undrawnVisible }));

    // A jump into the middle of the conversation does land its turn at the top edge.
    const middle = Math.floor(TURNS / 2);
    // Watch what the jump does between the click and where it stops: the offset it sees and the scroll it asks for.
    await page.evaluate(() => {
      const root = document.querySelector('[data-reader-scroll]');
      window.__jumpTrace = [];
      let last = -1;
      const tick = () => {
        const frame = document.querySelector('[data-reader-turn-frame="45"]');
        if (frame) {
          const box = frame.getBoundingClientRect(), at = root.getBoundingClientRect();
          const top = Math.round(box.top - at.top);
          if (top !== last) { last = top; window.__jumpTrace.push({ top, scrollTop: Math.round(root.scrollTop), scrollHeight: Math.round(root.scrollHeight), drawn: frame.getAttribute('data-windowed-drawn') }); }
        }
        if (window.__jumpTrace.length < 60) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.locator('[data-reader-outline] [data-outline-item="' + middle + '"]').click();
    const middleLanded = await page.waitForFunction(index => {
      const frame = document.querySelector('[data-reader-turn-frame="' + index + '"]'), scroller = document.querySelector('[data-reader-scroll]');
      if (!frame || !scroller) return false;
      const box = frame.getBoundingClientRect(), at = scroller.getBoundingClientRect();
      return frame.getAttribute('data-windowed-drawn') === 'true' && box.top >= at.top - 4 && box.top < at.bottom;
    }, middle, { timeout: 20000 }).then(() => true).catch(() => false);
    const middleTop = await topOf(middle);
    const middleState = await page.evaluate(index => {
      const frame = document.querySelector('[data-reader-turn-frame="' + index + '"]'), scroller = document.querySelector('[data-reader-scroll]');
      const box = frame?.getBoundingClientRect(), at = scroller.getBoundingClientRect();
      return { drawn: frame?.getAttribute('data-windowed-drawn') ?? null, height: box ? Math.round(box.height) : null, style: frame?.getAttribute('style') ?? null,
        scrollTop: Math.round(scroller.scrollTop), scrollHeight: Math.round(scroller.scrollHeight), viewport: Math.round(at.height), trace: window.__jumpTrace.slice(0, 30) };
    }, middle);
    report.middle = { index: middle, top: middleTop, landedInTime: middleLanded, ...middleState };
    check('a mid-conversation jump lands its turn at the top edge', middleTop !== null && middleTop >= -4 && middleTop < 160, JSON.stringify(report.middle));

    // 7. A caret inside a turn keeps that turn drawn while the reader moves away and comes back.
    // Take the turn from what is on screen now: the middle jump moved the window, so the turn the
    // far jump left under the eye is no longer mounted.
    const focusPick = await page.evaluate(() => {
      const scroller = document.querySelector('[data-reader-scroll]'), at = scroller.getBoundingClientRect();
      const shown = [...document.querySelectorAll('[data-reader-turn-frame]')].filter(frame => {
        const box = frame.getBoundingClientRect();
        return frame.getAttribute('data-windowed-drawn') === 'true' && box.top >= at.top - 4 && box.top < at.bottom - 40;
      });
      const frame = shown[0], index = frame ? Number(frame.getAttribute('data-reader-turn-frame')) : null;
      const turn = index === null ? null : document.querySelector('[data-reader-turn="' + index + '"]');
      return { index, controls: turn ? turn.querySelectorAll('button').length : 0 };
    });
    const focusTurn = focusPick.index ?? TURNS - 2;
    const focused = await page.evaluate(index => {
      const turn = document.querySelector('[data-reader-turn="' + index + '"]'), button = turn?.querySelector('button');
      button?.focus();
      return { focused: Boolean(button && document.activeElement === button), hasControl: Boolean(button), index };
    }, focusTurn);
    await page.evaluate(() => { const scroller = document.querySelector('[data-reader-scroll]'); scroller.scrollTop = 0; });
    await page.waitForTimeout(500); await settle(page);
    const keptDrawn = await page.evaluate(index => {
      const frame = document.querySelector('[data-reader-turn-frame="' + index + '"]');
      return { drawn: frame?.getAttribute('data-windowed-drawn') ?? null, stillFocused: frame?.contains(document.activeElement) ?? false };
    }, focusTurn);
    report.focusHold = { pick: focusPick, ...focused, ...keptDrawn };
    // Without the caret actually inside the turn there is nothing for the window to protect, so the
    // two halves are asserted separately: first that the control took the caret, then that the turn
    // holding it is still drawn and still holds it after the reader scrolls away.
    check('a control inside a far turn takes the caret', focused.focused === true && focused.hasControl === true, JSON.stringify(focused));
    check('a turn holding the caret is not taken away from under it', keptDrawn.stillFocused && keptDrawn.drawn === 'true', JSON.stringify(report.focusHold));

    // 8. Following appends a turn: it arrives drawn, at the end, without drawing the rest.
    await page.evaluate(() => { const scroller = document.querySelector('[data-reader-scroll]'); scroller.scrollTop = scroller.scrollHeight; });
    await page.waitForTimeout(300);
    const beforeFollow = await page.evaluate(() => {
      const scroller = document.querySelector('[data-reader-scroll]');
      return { frames: document.querySelectorAll('[data-reader-turn-frame]').length, scrollTop: Math.round(scroller.scrollTop), scrollHeight: Math.round(scroller.scrollHeight), viewport: Math.round(scroller.clientHeight) };
    });
    await page.locator('[data-reader-page]').first().getByRole('button', { name: '跟随', exact: true }).click();
    await page.waitForTimeout(400);
    const stamp = new Date().toISOString();
    fs.appendFileSync(file, [
      { timestamp: stamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'WINDOW_FOLLOW_QUESTION' }] } },
      { timestamp: stamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'WINDOW_FOLLOW_REPLY' }] } }
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    await page.waitForFunction(n => (document.querySelector('[data-reader-header]')?.textContent || '').includes(n + ' 轮'), TURNS + 1, { timeout: 90000 });
    await settle(page);
    // The header counts rounds in the record; the window only shows what it has been asked to show, so give the
    // mounted page a moment to grow with the conversation before reading what a person would see.
    const followMounted = await page.waitForFunction(frames => document.querySelectorAll('[data-reader-turn-frame]').length >= frames, TURNS + 1, { timeout: 15000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(600); await settle(page);
    const followed = await page.evaluate(() => {
      const turn = document.querySelector('[data-reader-turn="' + 90 + '"]'), frame = turn?.closest('[data-windowed-item]');
      const scroller = document.querySelector('[data-reader-scroll]');
      const header = document.querySelector('[data-reader-page] [data-reader-header]')?.textContent || '';
      return { present: Boolean(turn), drawn: frame?.getAttribute('data-windowed-drawn') ?? null, text: turn?.textContent?.includes('WINDOW_FOLLOW_REPLY') ?? false, frames: document.querySelectorAll('[data-reader-turn-frame]').length,
        header: header.replace(/\s+/g, ' ').trim().slice(0, 60), following: document.body.innerText.includes('跟随中'),
        scrollTop: Math.round(scroller.scrollTop), scrollHeight: Math.round(scroller.scrollHeight), viewport: Math.round(scroller.clientHeight), atEnd: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80 };
    });
    report.follow = { before: beforeFollow, mountedInTime: followMounted, ...followed };
    check('a followed turn arrives with its text', followed.present && followed.text, JSON.stringify(followed));
    check('a followed turn is drawn when it arrives', followed.drawn === 'true', String(followed.drawn));
    await page.locator('[data-reader-page]').first().getByRole('button', { name: '跟随中', exact: true }).click().catch(() => {});

    // 9. A request answered late cannot land in a conversation the person has already left.
    await page.locator('[data-reader-page]').first().locator('[data-reader-scroll]').click({ position: { x: 40, y: 120 } });
    await page.keyboard.press('Control+f');
    await page.locator('[data-reader-find]').waitFor({ timeout: 5000 });
    await page.keyboard.type('WINDOW_TALL_TAIL', { delay: 4 });
    await page.evaluate(() => window.sessionsHost.read(null));
    await page.locator('[data-reader-page]').waitFor({ state: 'detached', timeout: 20000 });
    await page.waitForTimeout(1200);
    const afterLeave = { pages: await page.locator('[data-reader-page]').count(), errors: report.errors.length };
    report.afterLeave = afterLeave;
    check('leaving while a read is in flight closes cleanly', afterLeave.pages === 0 && afterLeave.errors === 0, JSON.stringify(afterLeave));

    // 10. Nothing of the window survives the close.
    const residual = await page.evaluate(() => ({ frames: document.querySelectorAll('[data-reader-turn-frame]').length, drawn: document.querySelectorAll('[data-windowed-drawn="true"]').length, nodes: document.querySelectorAll('*').length }));
    report.residual = residual;
    check('closing the conversation releases every frame', residual.frames === 0 && residual.drawn === 0, JSON.stringify(residual));

    fs.writeFileSync(path.join(ROOT, 'results.json'), JSON.stringify(report, null, 2));
    const bad = report.checks.filter(item => !item.ok);
    console.log('checks: ' + report.checks.length + ', failed: ' + bad.length + (bad.length ? ' ' + JSON.stringify(bad.map(item => item.name)) : ''));
    if (bad.length) process.exitCode = 1;
  } catch (error) {
    report.failed = report.failed || error.message;
    report.error = error.message;
    fs.writeFileSync(path.join(ROOT, 'results.json'), JSON.stringify(report, null, 2));
    console.error(error);
    if (app) await app.firstWindow().then(page => page.screenshot({ path: path.join(ROOT, 'failure.png') })).catch(() => {});
    process.exitCode = 1;
  } finally {
    if (app) await app.close().catch(() => {});
    await cleanup(root);
  }
})();

