'use strict';
/* global document, getComputedStyle, CSS, innerWidth, innerHeight */
// Every page at the default window: a child sitting in its parent's corner is concentric with it, inner radius = outer radius
// minus the padding between them (docs/m2/UI-AUDIT-20261104.md). Synthetic home only. Screenshots go to artifacts/ui-audit.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { roots } = require('../../src/m1/policy');
const { scanSources } = require('../../src/m1/sources');
const { Store } = require('../../src/m1/store');
const { settle, showView, keepVisible, isolatePointer, cleanup } = require('./ui-settle');
const output = path.resolve(process.env.UI_AUDIT_EVIDENCE_DIR || path.join('artifacts', 'ui-audit')); fs.mkdirSync(output, { recursive: true });
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const FILLER = '这是一段合成的回复，不来自任何真实会话。'.repeat(8);
const say = (role, text, at) => ({ timestamp: ago(at), type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
const usage = (total, at) => ({ timestamp: ago(at), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total, output_tokens: 120, cached_input_tokens: 40, total_tokens: total + 120 } } } });
function codex(selected, id, name, cwd, at) {
  const rows = [{ timestamp: ago(at), type: 'session_meta', payload: { id, cwd, originator: 'codex_cli_rs' } }, { type: 'turn_context', payload: { model: 'gpt-6.1-sol', cwd } }, say('user', '合成问题', at), say('assistant', FILLER, at - .2), usage(4000 + at, at - .3)];
  write(path.join(selected.codex[0], '2026', '11', '03', 'rollout-2026-11-03T09-00-00-' + id + '.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  return JSON.stringify({ id, thread_name: name, updated_at: ago(at) });
}
const measure = () => {
  const parseR = element => parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
  const surface = element => { const s = getComputedStyle(element); return (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') || s.boxShadow !== 'none' || parseFloat(s.borderTopWidth) > 0; };
  const label = element => (element.tagName.toLowerCase() + ' ' + [...element.classList].filter(c => !/^(flex|grid|min-|w-|h-|size-|items|justify|gap|shrink|relative|absolute|overflow|inline|p[xytblr]?-|m[xytblr]?-|text-|font-|transition|duration|ease|cursor|select|outline|focus|hover|group|z-|top-|left-|right-|bottom-|inset|self-|flex-|truncate|whitespace|tabular|leading|tracking|opacity|pointer|has-|data-|aria-|peer|\*\*)/.test(c)).slice(0, 5).join('.')).slice(0, 70);
  const out = new Map(), visible = [...document.querySelectorAll('main *, [data-ui-portal] *, .app-titlebar *')].filter(element => { const box = element.getBoundingClientRect(); return box.width > 8 && box.height > 8 && box.bottom > 0 && box.top < innerHeight; });
  for (const child of visible) {
    const r = parseR(child); if (!r || r > 40 || !surface(child)) continue;
    let parent = child.parentElement; while (parent && !(parseR(parent) && surface(parent))) parent = parent.parentElement;
    if (!parent) continue;
    const R = parseR(parent); if (R > 40) continue;
    const a = child.getBoundingClientRect(), b = parent.getBoundingClientRect();
    // Only a child sitting in a corner of its parent has a concentric relation with it.
    const gaps = [[a.left - b.left, a.top - b.top], [b.right - a.right, a.top - b.top], [a.left - b.left, b.bottom - a.bottom], [b.right - a.right, b.bottom - a.bottom]].filter(([x, y]) => x >= -.5 && y >= -.5 && Math.abs(x - y) <= 1.5 && x < R);
    if (!gaps.length) continue;
    const gap = Math.round(gaps[0][0]), want = Math.max(0, R - gap);
    // A child far from the corner has nothing to be concentric with: a radius of 0-3 would read as a mistake.
    if (want < 4 || Math.abs(r - want) <= 1) continue;
    const key = label(child) + ' in ' + label(parent) + ' R' + R + ' gap' + gap + ' r' + r + ' want' + want;
    out.set(key, (out.get(key) || 0) + 1);
  }
  const sizes = {}, heights = {}, radii = {};
  for (const element of visible) {
    const s = getComputedStyle(element); const direct = [...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
    if (direct) sizes[s.fontSize + '/' + s.fontWeight] = (sizes[s.fontSize + '/' + s.fontWeight] || 0) + 1;
    if (element.matches('button, [role="tab"], [role="radio"], input')) { const h = Math.round(element.getBoundingClientRect().height); heights[h] = (heights[h] || 0) + 1; }
    const r = parseR(element); if (r && surface(element)) radii[r] = (radii[r] || 0) + 1;
  }
  return { nested: [...out].sort((x, y) => y[1] - x[1]).map(([k, v]) => v + '× ' + k), sizes, heights, radii };
};
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-audit-')), home = path.join(root, 'home'), usageDir = path.join(root, 'usage'), quotaDir = path.join(root, 'quota');
  try {
    const selected = roots(home); for (const dir of Object.values(selected).flat()) fs.mkdirSync(dir, { recursive: true });
    const id = n => '019a7c2e-0000-4000-8000-' + String(n).padStart(12, '0'), index = [];
    for (let n = 1; n <= 8; n++) index.push(codex(selected, id(n), '合成会话 ' + n, 'C:/fixtures/' + (n % 2 ? 'alpha' : 'beta'), 60 * n));
    write(path.join(path.dirname(selected.codex[0]), 'session_index.jsonl'), index.join('\n') + '\n');
    const store = new Store(usageDir, selected); store.ingest(await scanSources(selected, store.state.salt, { reads: 0 }), { status: 'not-run' }); store.setEnabled(false);
    const app = await electron.launch({ executablePath: require('electron'), args: ['src/quota/main.js', '--usage-data-dir', usageDir, '--quota-data-dir', quotaDir, '--m1-fixture-root', home], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } }).catch(error => { throw error; });
    const page = await app.firstWindow(); await page.waitForURL(/^file:/, { timeout: 30000 }); await keepVisible(app); await isolatePointer(app); await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.setSize(1480, 960); }); await page.waitForTimeout(1500);
    const report = { window: await page.evaluate(() => [innerWidth, innerHeight]), corner: await page.evaluate(() => CSS.supports('corner-shape', 'superellipse(1.25)')) };
    for (const view of ['quota', 'usage', 'cost', 'sessions', 'sources', 'settings']) {
      try { await showView(page, view); await settle(page); } catch (error) { report[view] = 'NAV ' + error.message.slice(0, 80); continue; }
      await page.waitForTimeout(900); await page.screenshot({ path: path.join(output, view + '.png') }); report[view] = await page.evaluate(measure);
    }
    await showView(page, 'sessions'); await settle(page);
    await page.evaluate(() => { const host = window.sessionsHost, list = host.get().list; if (list) host.read(list.sessions.find(item => host.readable(item.agent))); });
    try { await page.locator('[data-reader-page]').waitFor({ timeout: 8000 }); await page.waitForTimeout(1200); report.reader = await page.evaluate(measure); await page.screenshot({ path: path.join(output, 'reader.png') }); await page.locator('[data-reader-tools] button').nth(1).click(); await page.waitForTimeout(400); report.menu = await page.evaluate(measure); await page.keyboard.press('Escape'); } catch (error) { report.reader = 'READER ' + error.message.slice(0, 80); }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 1));
    for (const [name, value] of Object.entries(report)) if (typeof value === 'string') throw Error(name + ': ' + value);
    assert.equal(report.corner, true, 'continuous corners are available');
    const nested = Object.entries(report).flatMap(([name, value]) => (value.nested ?? []).map(line => name + ': ' + line));
    assert.deepEqual(nested, [], 'every child in a corner is concentric');
    assert.notEqual(await page.locator('[data-reader-page]').evaluate(element => getComputedStyle(element).getPropertyValue('corner-shape')), 'round', 'the panes use them');
    console.log('PASS: every page is concentric at the default window, with continuous corners.');
    await app.close();
  } finally { await cleanup(root); }
})().catch(error => { console.error(error); process.exitCode = 1; });
