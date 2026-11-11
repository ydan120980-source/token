'use strict';
/* global document, innerWidth */
// Text the app itself words must show in full, on every page, at the default display (125%, the window it opens at on that screen).
// What a person or an Agent named (a session title, a path, a project) may run long and is cut with its full text in a tooltip;
// such places are listed in ALLOWED with why. Invented data only.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { launch } = require('./ui-smoke');
const { showView, settle } = require('./ui-settle');
const { clippedText } = require('./text-fit');
const output = process.env.TEXT_CLIP_EVIDENCE_DIR || 'artifacts/text-clip-20261104';
// Long by nature, chosen by a person or an Agent, with the whole text a hover or a click away.
const ALLOWED = '[data-session], [data-session-title], [data-reader-root] [data-transcript], [data-source-path], [data-config-path], code, pre';
const PAGES = ['quota', 'usage', 'cost', 'sessions', 'sources', 'settings'];
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const report = {};
  for (const [width, height] of [[1480, 880], [1180, 800], [800, 600]]) {
    const session = await launch({ scale: 1.25, size: [width, height] }), { page, errors } = session;
    try {
      for (const view of PAGES) {
        await showView(page, view); await settle(page); await new Promise(resolve => setTimeout(resolve, 500));
        const found = await page.evaluate(`(${clippedText.toString()})('#${view === 'quota' ? 'quota' : view}, [data-view="${view}"], [data-ui-root]', { skip: ${JSON.stringify(ALLOWED)} })`);
        if (found.length) report[view + ' ' + width] = found;
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (overflow > 0) report[view + ' ' + width + ' page scrolls sideways'] = [{ why: 'overflow', width, box: 'page', text: overflow + 'px' }];
        await page.screenshot({ path: path.join(output, view + '-' + width + '.png') });
      }
      assert.deepEqual(errors, []);
    } finally { await session.close(); }
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 1));
  for (const [key, found] of Object.entries(report)) { console.log('==', key); for (const item of found) console.log(' ', item.why, item.width + 'px', item.box, '|', item.text); }
  assert.deepEqual(report, {}, 'text that does not show in full');
  console.log('text clip passed');
})().catch(error => { console.error(String(error.message).split('\n')[0]); process.exit(1); });
