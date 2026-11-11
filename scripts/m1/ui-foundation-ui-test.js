'use strict';
/* global document, getComputedStyle, requestAnimationFrame */
// The React layer foundation in the real app (docs/m2/UI-REACT-FOUNDATION-20261025.md): the bundle
// loads under the app's CSP, an island mounts and unmounts, popups portal into [data-ui-portal],
// both themes resolve the React tokens, the app's motion setting reaches Motion, React elements
// carry no legacy class, and mounting changes no legacy element. Synthetic homes only.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { until, settle, showView } = require('./ui-settle');
const { launch, setTheme, isolationViolations, semanticViolations, styleOf, cleanRoomDiff } = require('./ui-smoke');

const output = process.env.UI_FOUNDATION_EVIDENCE_DIR || 'artifacts/ui-foundation';
fs.mkdirSync(output, { recursive: true });
const version = require('../../package.json').version;

// Approved Apple window grounds (UI-SURFACES-20261028.md, tokens.css --ff-surface-1).
const EXPECTED = { light: { background: 'rgb(236, 236, 238)', foreground: 'rgb(36, 36, 38)' }, dark: { background: 'rgb(17, 17, 18)', foreground: 'rgb(245, 245, 245)' } };

(async () => {
  const session = await launch();
  const { app, page, errors } = session;
  try {
    await showView(page, 'usage');
    const api = await page.evaluate(() => ({ version: window.agentUi.version, islands: [...window.agentUi.islands], frozen: Object.isFrozen(window.agentUi) }));
    assert.deepEqual(api, { version, islands: ['probe', 'kit-gallery', 'settings', 'quota', 'quota-after', 'widgets', 'title-readout', 'cost', 'usage', 'sessions', 'sources'], frozen: true });

    // Legacy elements before any island exists, to prove mounting leaves them alone.
    // M7 retired #periods and M5 the session range; the shell's own elements still verify the isolation contract.
    const legacy = ['.topbar nav button', '#main', 'body'];
    const legacyStyle = () => page.evaluate(selectors => selectors.map(selector => { const s = getComputedStyle(document.querySelector(selector)); return [s.fontFamily, s.fontSize, s.padding, s.margin, s.borderRadius, s.backgroundColor, s.color, s.display, s.lineHeight].join('|'); }), legacy);

    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme); await settle(page);
      const before = await legacyStyle();
      await page.evaluate(() => {
        const host = document.createElement('div'); host.id = 'uiProbeHost';
        Object.assign(host.style, { position: 'fixed', right: '24px', bottom: '24px', zIndex: 40, width: '360px' });
        document.body.appendChild(host);
        window.uiProbe = window.agentUi.mount('probe', host);
      });
      await page.locator('#uiProbeHost [data-probe]').waitFor();
      assert.equal(await page.locator('#uiProbeHost').getAttribute('data-ui-root'), '');
      assert.deepEqual(await legacyStyle(), before, 'mounting an island changes no legacy element');

      // Tokens resolve per theme inside the React root.
      const probe = await styleOf(page, '#uiProbeHost [data-probe]', ['background-color', 'color', 'font-family']);
      assert.equal(probe['background-color'], EXPECTED[theme].background, theme + ' background');
      assert.equal(probe.color, EXPECTED[theme].foreground, theme + ' foreground');
      assert.match(probe['font-family'], /^Inter/, 'the React layer uses the app font');

      // Legacy element rules do not reach React controls (legacy button rules set padding and radius).
      const button = await styleOf(page, '#uiProbeHost [data-probe-open]', ['font-family', 'border-top-width']);
      assert.match(button['font-family'], /^Inter/); assert.equal(button['border-top-width'], '0px');
      // Strictest form: the island looks exactly as it does in a window without any legacy stylesheet.
      await page.mouse.move(4, 4); await settle(page); // no hover state on either side
      const diff = await cleanRoomDiff(app, page, { island: 'probe', rootSelector: '#uiProbeHost', width: 360, dark: theme === 'dark', motion: await page.evaluate(() => document.body.dataset.motion) });
      assert.deepEqual(diff, [], 'no legacy style reaches the island (' + theme + ')');

      // Select: the popup renders in the shared portal root and the choice applies.
      await page.locator('#uiProbeHost [data-probe-select]').click();
      await page.locator('[data-ui-portal] [role="option"]').filter({ hasText: 'Claude Code' }).waitFor();
      await page.screenshot({ path: path.join(output, 'select-' + theme + '.png') });
      await page.locator('[data-ui-portal] [role="option"]').filter({ hasText: 'Claude Code' }).click();
      await until(page, () => document.querySelector('#uiProbeHost [data-probe-select]').textContent.includes('Claude Code'));

      // Dialog: portalled, focus moves inside, Escape closes and returns focus.
      await page.locator('#uiProbeHost [data-probe-open]').click();
      await page.locator('[data-ui-portal] [role="dialog"]').waitFor();
      await until(page, () => document.querySelector('[data-ui-portal] [role="dialog"]')?.contains(document.activeElement));
      await page.waitForTimeout(400); await page.screenshot({ path: path.join(output, 'dialog-' + theme + '.png') });
      assert.deepEqual(await isolationViolations(page), [], 'React elements carry no legacy class');
      assert.deepEqual(await semanticViolations(page), []);
      await page.keyboard.press('Escape');
      await until(page, () => !document.querySelector('[data-ui-portal] [role="dialog"]'));
      assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-probe-open')), true, 'focus returns to the trigger');

      await page.evaluate(() => { window.uiProbe.unmount(); document.getElementById('uiProbeHost').remove(); });
      assert.deepEqual(await legacyStyle(), before);
    }

    // The app's motion setting reaches Motion: "off" lands a dialog on its first frame.
    await page.evaluate(() => { document.body.dataset.motion = 'off'; const host = document.createElement('div'); host.id = 'uiProbeHost'; document.body.appendChild(host); window.uiProbe = window.agentUi.mount('probe', host); });
    await page.locator('#uiProbeHost [data-probe-open]').click();
    const opacity = await page.locator('[data-ui-portal] [role="dialog"]').evaluate(element => new Promise(resolve => requestAnimationFrame(() => resolve(getComputedStyle(element).opacity))));
    assert.equal(opacity, '1', 'motion off: no fade');
    await page.keyboard.press('Escape'); await page.evaluate(() => window.uiProbe.unmount());

    assert.deepEqual(errors, [], 'no console or page errors (including CSP violations)');
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ version, themes: ['light', 'dark'], packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), errors }, null, 2));
    console.log('PASS: React layer foundation — bundle, island lifecycle, portals, tokens in both themes, motion setting, isolation.');
  } finally { await session.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
