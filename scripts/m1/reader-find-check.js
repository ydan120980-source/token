'use strict';
/* global document */
// The find chain as a person uses it: the real keyboard shortcut, a phrase that lives only in a turn the
// window has not drawn, and text that sits past the preview the window was given. Synthetic records only.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron: electron } = require('playwright');
const { showView, settle, until, keepVisible, isolatePointer, cleanup } = require('./ui-settle');
const ROOT = path.resolve(process.env.FIND_OUTPUT || path.join('artifacts', 'perf-20261103', 'find-chain'));
const MARK = 'FAR-MARK-', TAIL = '-TAIL-END';

// Each assistant reply of the synthetic long session gains its own marker at the very end, past the
// 1200-character preview the reading window receives, so a hit can only be shown by reading the record again.
function stamp(file) {
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  let turn = 0;
  for (const row of rows) {
    const payload = row.payload;
    if (row.type !== 'response_item' || payload?.type !== 'message' || payload.role !== 'assistant') continue;
    const part = payload.content?.[0];
    if (part && typeof part.text === 'string') part.text += '\n\n' + MARK + turn + TAIL;
    turn++;
  }
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  return turn;
}

(async () => {
  fs.mkdirSync(ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-find-'));
  const report = { syntheticOnly: true, checks: [], timings: {}, errors: [] };
  const check = (name, ok, detail) => { report.checks.push({ name, ok: Boolean(ok), detail }); if (!ok) report.failed = report.failed || name; };
  let app;
  try {
    const seeded = await require('../../tests/m1/multi-reader-memory-fixture').seedMemory(root);
    const { home, usage, longFiles, longIds } = seeded;
    const turns = stamp(longFiles[0]);
    report.fixture = { turns, fileBytes: fs.statSync(longFiles[0]).size };

    app = await electron.launch({
      executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'),
      args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', path.join(root, 'quota'), '--m1-fixture-root', home],
      timeout: 60000
    });
    await isolatePointer(app);
    const page = await app.firstWindow();
    await keepVisible(app);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.waitForURL(/^file:/);
    await until(page, () => window.usageData.ready(), 60000);
    await showView(page, 'sessions');
    await page.getByRole('tablist', { name: '会话时间范围', exact: true }).getByRole('tab', { name: '全部', exact: true }).click();
    await until(page, () => Boolean(window.sessionsHost.get().list) && !window.sessionsHost.get().loading, 60000);

    // The session the fixture's ledger knows: 300 turns of long text.
    await page.evaluate(ids => { const host = window.sessionsHost, list = host.get().list.sessions; host.read(list.find(row => row.id === ids[0])); }, longIds);
    await page.locator('[data-reader-page]').waitFor();
    await page.waitForFunction(() => (document.querySelector('[data-reader-header]')?.textContent || '').includes('300 轮'), null, { timeout: 90000 });
    await settle(page);
    await until(page, () => document.querySelectorAll('[data-reader-turn]').length > 0, 60000);

    const mountState = () => page.evaluate(() => {
      const frames = [...document.querySelectorAll('[data-reader-turn-frame]')];
      const drawn = frames.filter(frame => frame.getAttribute('data-windowed-drawn') === 'true');
      return { frames: frames.length, drawn: drawn.length, drawnIndexes: drawn.map(frame => Number(frame.getAttribute('data-windowed-item'))) };
    });
    const before = await mountState();
    report.before = before;
    check('window mounts fewer bodies than turns', before.frames >= 30, JSON.stringify(before));

    // Real shortcut with the page focused, as a person would: click into the reading column, then Ctrl+F.
    await page.locator('[data-reader-scroll]').click({ position: { x: 40, y: 120 } });
    await page.keyboard.press('Control+f');
    const openedAt = Date.now();
    await page.locator('[data-reader-find]').waitFor({ timeout: 5000 });
    report.timings.shortcutToFindBar = Date.now() - openedAt;
    const focusedInFind = await page.evaluate(() => document.activeElement?.closest('[data-reader-find]') !== null);
    check('Ctrl+F opens the find bar', true, report.timings.shortcutToFindBar + ' ms');
    check('Ctrl+F leaves the caret in the find field', focusedInFind);

    // A phrase that only exists in turn 285, and only past the preview the window received.
    const askedAt = Date.now();
    await page.keyboard.type(MARK + '285' + TAIL, { delay: 8 });
    await page.locator('[data-reader-hits]').filter({ hasText: '1 / 1' }).waitFor({ timeout: 30000 });
    report.timings.typeToHits = Date.now() - askedAt;
    check('a phrase past the preview is found', true, report.timings.typeToHits + ' ms');

    // Enter moves to the hit, as the find bar promises.
    const jumpAt = Date.now();
    await page.keyboard.press('Enter');
    await page.locator('[data-reader-turn="285"] [data-find-current]').waitFor({ timeout: 30000 });
    report.timings.enterToMarkedHit = Date.now() - jumpAt;
    await settle(page);
    const landed = await page.evaluate(() => {
      const marked = document.querySelector('[data-find-current]');
      const turn = document.querySelector('[data-reader-turn="285"]');
      const frame = turn?.closest('[data-windowed-item]') ?? turn;
      const scroller = document.querySelector('[data-reader-scroll]');
      if (!marked || !turn || !scroller) return { found: false };
      const box = marked.getBoundingClientRect(), view = scroller.getBoundingClientRect();
      const frameBox = frame.getBoundingClientRect();
      return {
        found: true,
        drawn: frame.getAttribute?.('data-windowed-drawn') ?? null,
        markerText: marked.textContent,
        inViewport: box.top >= view.top - 2 && box.bottom <= view.bottom + 2,
        viewportHeight: view.height,
        markedTop: box.top - view.top,
        frameHeight: frameBox.height,
        frameHeightStyle: frame.getAttribute('style'),
        scrollTop: scroller.scrollTop
      };
    });
    report.landed = landed;
    check('the far turn is drawn, not a placeholder', landed.drawn === 'true', JSON.stringify(landed));
    check('the marked hit is inside the reading viewport', landed.inViewport, JSON.stringify({ top: landed.markedTop, height: landed.viewportHeight }));
    check('the marked text is the phrase searched for', landed.markerText === MARK + '285' + TAIL, landed.markerText);
    const after = await mountState();
    report.after = after;
    check('the jump did not draw every turn body', after.drawn < 120, JSON.stringify({ drawn: after.drawn, frames: after.frames }));

    // Next and previous stay in the same chain; the outline's own place comes along.
    await page.keyboard.press('Enter');
    await page.locator('[data-reader-hits]').filter({ hasText: '1 / 1' }).waitFor();
    check('a second Enter keeps one hit selected', true);

    // Escape in the field empties the query first — the field's own contract — and the next Escape closes
    // the find. Either way the conversation stays where it is.
    await page.keyboard.press('Escape');
    await until(page, () => (document.querySelector('[data-reader-find] input')?.value ?? '') === '', 5000);
    check('Escape in the field clears the query first', true);
    const stillOpen = await page.locator('[data-reader-find]').count();
    check('an emptied query leaves the find bar open', stillOpen === 1);
    await page.keyboard.press('Escape');
    await page.locator('[data-reader-find]').waitFor({ state: 'detached', timeout: 5000 });
    const stillThere = await page.evaluate(() => Boolean(document.querySelector('[data-reader-turn="285"]')));
    check('Escape closes the find bar', true);
    check('closing the find leaves the turn in place', stillThere);

    // A second pane: the shortcut belongs to the pane in use, not to both.
    await page.evaluate(ids => { const host = window.sessionsHost, list = host.get().list.sessions; host.readAlso(list.find(row => row.id === ids[1])); }, longIds);
    await page.locator('[data-reader-panes="2"]').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[data-reader-page] [data-reader-turn]').length > 0, null, { timeout: 90000 });
    await settle(page);
    await page.locator('[data-reader-page]').nth(1).locator('[data-reader-scroll]').click({ position: { x: 40, y: 120 } });
    await page.keyboard.press('Control+f');
    await page.locator('[data-reader-page]').nth(1).locator('[data-reader-find]').waitFor({ timeout: 5000 });
    const bars = await page.locator('[data-reader-find]').count();
    check('the shortcut opens the find in one pane only', bars === 1, bars + ' bars');
    const secondHasFocus = await page.evaluate(() => document.querySelectorAll('[data-reader-page]')[1]?.contains(document.activeElement) ?? false);
    check('the caret sits in the pane in use', secondHasFocus);

    // Keys typed into the find field are text, not reader shortcuts.
    await page.keyboard.type('j', { delay: 8 });
    const afterTyping = await page.evaluate(() => document.querySelector('[data-reader-find] input')?.value ?? '');
    check('typing a shortcut letter does not jump', afterTyping.endsWith('j'), afterTyping.slice(-3));

    report.maximumPrivateMiB = null;
    fs.writeFileSync(path.join(ROOT, 'results.json'), JSON.stringify(report, null, 2));
    const bad = report.checks.filter(item => !item.ok);
    console.log('checks: ' + report.checks.length + ', failed: ' + bad.length);
    if (bad.length) { console.log(JSON.stringify(bad, null, 2)); process.exitCode = 1; }
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
