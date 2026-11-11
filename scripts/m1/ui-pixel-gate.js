'use strict';
/* global document, innerWidth, innerHeight, NodeFilter */
// Pixel gate for renderer work (docs/m2/UI-LAYOUT-GATE-20261027.md).
//
//   node scripts/m1/ui-pixel-gate.js capture <checkout> <out> [--views a,b] [--themes light,dark] [--size 1180x850 --clock ISO]
//                                            [--scenes scenes.json --side before|after] [--executable app.exe]
//   node scripts/m1/ui-pixel-gate.js compare <before> <after> <out> [--budget 0.002] [--approved file.json]
//
// capture launches the app from any checkout (main for the baseline, a topic branch for the
// candidate) on one synthetic home and ledger, with the renderer and the fixtures on one frozen
// clock, the quota read handlers returning tests/m1/quota-hero-fixture.js, collection disabled
// and motion off. Each view and theme gives two images: the window as it opens (top.png) and the
// whole page in one tall viewport (page.png), so fixed elements are drawn where they really are.
// compare counts the pixels whose colour differs by more than a small anti-aliasing tolerance,
// writes a diff image per pair and fails when a pair differs by more than the budget, unless the
// pair is listed in the approved-differences file with the reason the owner or Claude accepted.
// A scenes file adds interactive states: each scene names a view and, for each side, the steps
// that reach the state on that side's DOM (the legacy page and its React replacement differ):
//   { "scenes": [ { "name": "day-detail", "view": "usage",
//       "before": [ { "click": "#overviewWeek .week-day:last-child" } ],
//       "after":  [ { "click": "[data-usage-day]:last-child" } ] } ] }
// Steps: { click: selector } (the first match), { press: key }, { scroll: selector } (to the top of
// the window), { wait: ms } (at most 2000). Each scene starts from a freshly loaded view and is
// captured at the window size as <theme>-scene-<name>.png.
// Capture-only source discovery checkedAt and temporary fixture mtimes use FIXED_TIME
// (owner-approved UI-MIG-M8-PIXEL-CLOCK-GAP-20261027.md). Existing date-time masks stay unchanged.
// Both sides pin screenshot rendering to sRGB (UI-MIG-M8-PIXEL-COLOR-PROFILE-GAP-20261028.md).
// No credentials, provider requests, real sources or quota cache writes.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { freezeFixtureTimes, installSourceClock } = require('./ui-pixel-clock');

const VIEWS = ['quota', 'usage', 'cost', 'sessions', 'sources', 'settings'];
let FIXED_TIME = Date.parse('2026-10-26T11:51:00Z');
const TALL_LIMIT = 6000;
// A channel difference at or below this is anti-aliasing or sub-pixel text noise, not a change.
const TOLERANCE = 24;
const MASK_COLOR = '#ff00ff';

// Covers each run of date-time text (10/26 14:01, 2026-10-26 14:01:05, 14:01) with a box.
async function maskClockText(page) {
  await page.evaluate(color => {
    document.querySelectorAll('[data-gate-mask]').forEach(box => box.remove());
    const pattern = /(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\s*)?(\d{1,2}[/月]\d{1,2}日?\s+)?\d{1,2}:\d{2}(:\d{2})?/g;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), boxes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.parentElement || node.parentElement.closest('[hidden], script, style')) continue;
      for (const match of node.data.matchAll(pattern)) {
        const range = document.createRange(); range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
        for (const rect of range.getClientRects()) if (rect.width && rect.height) boxes.push(rect);
      }
    }
    for (const rect of boxes) {
      const box = document.createElement('div'); box.dataset.gateMask = '';
      box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:' + color + ';left:' + (rect.left - 1) + 'px;top:' + (rect.top - 1) + 'px;width:' + (rect.width + 2) + 'px;height:' + (rect.height + 2) + 'px';
      document.documentElement.appendChild(box);
    }
  }, MASK_COLOR);
}

function options(argv) {
  const named = {}, positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { named[argv[i].slice(2)] = argv[i + 1]; i++; } else positional.push(argv[i]);
  }
  return { named, positional };
}

function withFrozenClock(fn) {
  const NativeDate = Date;
  global.Date = class extends NativeDate {
    constructor(...args) { if (args.length) super(...args); else super(FIXED_TIME); }
    static now() { return FIXED_TIME; }
  };
  try { return fn(); } finally { global.Date = NativeDate; }
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) copyTree(path.join(from, entry.name), path.join(to, entry.name));
    else fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
  }
}

async function capture(checkout, out, named) {
  if (named.clock) { const time = Date.parse(named.clock); if (!Number.isFinite(time)) throw new Error('INVALID_CAPTURE_CLOCK'); FIXED_TIME = time; }
  checkout = path.resolve(checkout); out = path.resolve(out);
  const tools = path.resolve(__dirname, '../..');
  const { _electron: electron } = require(require.resolve('playwright', { paths: [tools] }));
  const { seed } = require(path.join(tools, 'tests/m1/ui-style-fixture'));
  const { fixture } = require(path.join(tools, 'tests/m1/quota-hero-fixture'));
  const { keepVisible, isolatePointer, settle, showView, until, cleanup } = require(path.join(tools, 'scripts/m1/ui-settle'));
  const views = (named.views || VIEWS.join(',')).split(','), themes = (named.themes || 'light,dark').split(',');
  const [width, height] = (named.size || '1180x850').split('x').map(Number);
  const scenes = named.scenes ? JSON.parse(fs.readFileSync(named.scenes, 'utf8')).scenes : [], side = named.side || 'before';
  if (scenes.length && !['before', 'after'].includes(side)) throw new Error('--side is before or after');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-pixel-gate-')), home = path.join(root, 'home'), ledger = path.join(root, 'ledger');
  withFrozenClock(() => seed(home, ledger));
  const fixtureClock = freezeFixtureTimes(home, root, FIXED_TIME);
  const quotaData = fixture(FIXED_TIME);
  let head = 'unknown';
  try { head = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  const dirty = (() => { try { return execFileSync('git', ['-C', checkout, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0; } catch { return null; } })();
  fs.mkdirSync(out, { recursive: true });
  const manifest = { checkout, head, dirty, clock: new Date(FIXED_TIME).toISOString(), fixtureClock,
    sourceTimeFields: ['SourceDiscoveryV1.checkedAt', 'fixture file mtime → sources[].latest / paths[].latest'],
    window: { width, height }, motion: 'off', colorProfile: { name: 'srgb', argument: '--force-color-profile=srgb' }, shots: [] };
  manifest.bundleSha256 = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(checkout, 'design/desktop-reference/ui/agent-ui.js'))).digest('hex');
  if(named.executable){manifest.executable=path.resolve(named.executable);manifest.asarSha256=require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(path.dirname(manifest.executable),'resources/app.asar'))).digest('hex');}
  try {
    for (const theme of themes) for (const view of views) {
      const dir = path.join(root, theme + '-' + view), usage = path.join(dir, 'usage'), quota = path.join(dir, 'quota');
      copyTree(ledger, usage); fs.mkdirSync(quota, { recursive: true });
      const app = await electron.launch({ cwd: checkout, executablePath: manifest.executable || require(require.resolve('electron', { paths: [checkout, tools] })),
        args: [...(manifest.executable?[]:[path.join(checkout, 'src/quota/main.js')]), '--usage-data-dir', usage, '--quota-data-dir', quota, '--m1-fixture-root', home, '--force-device-scale-factor=1', '--force-color-profile=srgb'], timeout: 60000 });
      const errors = [];
      try {
        await keepVisible(app); await isolatePointer(app);
        const page = await app.firstWindow();
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.addInitScript(ms => {
          const RealDate = Date;
          window.Date = class extends RealDate {
            constructor(...args) { if (args.length) super(...args); else super(ms); }
            static now() { return ms; }
          };
        }, FIXED_TIME);
        await app.evaluate(({ ipcMain }, data) => {
          const handlers = ipcMain._invokeHandlers, wrap = (channel, edit) => { const original = handlers.get(channel); handlers.set(channel, async (...args) => { const result = await original(...args); if (result?.ok) edit(result.state); return result; }); };
          wrap('quota:providers', state => { state.accounts = data.providers; });
          wrap('quota:getV2', state => { state.accounts = [data.v2]; });
          wrap('quota:get', state => { state.accounts = [data.v1]; state.executableAvailable = true; });
        }, quotaData);
        await app.evaluate(installSourceClock, FIXED_TIME);
        const open = async () => {
          await page.reload({ waitUntil: 'load' });
          await page.setViewportSize({ width, height });
          await until(page, () => window.usageData?.ready?.() === true);
          await page.evaluate(value => { window.settingsHost?.theme.set(value); window.uiMotion.setPreference('off'); }, theme);
          await showView(page, view);
          if (view === 'quota') await until(page, () => (window.quotaHost?.model?.gridView?.().shown.length ?? document.querySelectorAll('#quotaCards .quota-card').length) >= 5);
          await page.evaluate(() => window.scrollTo(0, 0)); await page.mouse.move(1, 1);
          await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(600); await settle(page);
        };
        await open();
        const name = theme + '-' + view;
        await maskClockText(page);
        await page.screenshot({ path: path.join(out, name + '-top.png') });
        const tall = await page.evaluate(limit => Math.min(limit, Math.max(document.documentElement.scrollHeight, innerHeight)), TALL_LIMIT);
        // Allow for scrollbar removal changing wrapping at the tall viewport.
        // Otherwise a near-exact height can retain an 8px scrollbar on one side.
        await page.setViewportSize({ width, height: Math.min(tall+64,TALL_LIMIT) }); await page.waitForTimeout(300); await settle(page);
        await maskClockText(page);
        await page.screenshot({ path: path.join(out, name + '-page.png') });
        const facts = await page.evaluate(() => ({ view: document.getElementById('main').dataset.currentView, dark: document.body.classList.contains('dark'), motion: document.body.dataset.motion, width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
        manifest.shots.push({ name, view, theme, tall, facts, errors });
        for (const scene of scenes.filter(item => item.view === view)) {
          const steps = scene[side];
          if (!Array.isArray(steps)) throw new Error('SCENE_SIDE_MISSING ' + scene.name + ' ' + side);
          await open();
          for (const step of steps) {
            if (step.click) await page.locator(step.click).first().click();
            else if (step.hover) await page.locator(step.hover).first().hover();
            else if (step.focus) { const target = page.locator(step.focus).first(); await target.scrollIntoViewIfNeeded(); await target.focus(); }
            else if (step.press) await page.keyboard.press(step.press);
            else if (step.scroll) { const block = step.block ?? 'start'; if (!['start', 'center', 'end', 'nearest'].includes(block)) throw new Error('SCENE_SCROLL_BLOCK_UNKNOWN'); await page.locator(step.scroll).first().evaluate((element, block) => element.scrollIntoView({ block }), block); }
            else if (step.wait) await page.waitForTimeout(Math.min(2000, Number(step.wait) || 0));
            else throw new Error('SCENE_STEP_UNKNOWN ' + JSON.stringify(step));
          }
          if (!steps.some(step => step.hover || step.focus)) await page.mouse.move(1, 1); await page.waitForTimeout(300); await settle(page);
          await maskClockText(page);
          await page.screenshot({ path: path.join(out, theme + '-scene-' + scene.name + '.png') });
          manifest.shots.push({ name: theme + '-scene-' + scene.name, view, theme, scene: scene.name, side, facts: await page.evaluate(() => ({ view: document.getElementById('main').dataset.currentView, width: innerWidth, scrollWidth: document.documentElement.scrollWidth })), errors });
        }
      } finally { await app.close(); }
    }
  } finally { await cleanup(root); }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const failed = manifest.shots.filter(shot => shot.errors.length || shot.facts.view !== shot.view || shot.facts.scrollWidth > shot.facts.width);
  process.stdout.write('captured ' + manifest.shots.length + ' views from ' + head.slice(0, 7) + (dirty ? ' (uncommitted changes)' : '') + ' into ' + out + '\n');
  for (const shot of failed) process.stdout.write('  check ' + shot.name + ': ' + JSON.stringify({ errors: shot.errors, facts: shot.facts }) + '\n');
  return failed.length ? 1 : 0;
}

function compare(before, after, out, named) {
  const { PNG } = require(require.resolve('playwright-core/lib/utilsBundle', { paths: [path.resolve(__dirname, '../..')] }));
  const budget = Number(named.budget ?? 0.002);
  const approved = named.approved ? JSON.parse(fs.readFileSync(named.approved, 'utf8')) : {};
  fs.mkdirSync(out, { recursive: true });
  const names = fs.readdirSync(before).filter(name => name.endsWith('.png') && fs.existsSync(path.join(after, name))).sort();
  const missing = fs.readdirSync(before).filter(name => name.endsWith('.png') && !fs.existsSync(path.join(after, name)));
  const rows = [];
  for (const name of names) {
    const a = PNG.sync.read(fs.readFileSync(path.join(before, name))), b = PNG.sync.read(fs.readFileSync(path.join(after, name)));
    const width = Math.max(a.width, b.width), height = Math.max(a.height, b.height), diff = new PNG({ width, height });
    let changed = 0, top = height, bottom = -1, left = width, right = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4, inA = x < a.width && y < a.height, inB = x < b.width && y < b.height;
      const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4;
      let delta = 255;
      if (inA && inB) delta = Math.max(Math.abs(a.data[ia] - b.data[ib]), Math.abs(a.data[ia + 1] - b.data[ib + 1]), Math.abs(a.data[ia + 2] - b.data[ib + 2]));
      const grey = inA ? Math.round((a.data[ia] + a.data[ia + 1] + a.data[ia + 2]) / 3 * 0.25 + 191) : 255;
      if (delta > TOLERANCE) {
        changed++; diff.data[at] = 230; diff.data[at + 1] = 40; diff.data[at + 2] = 60; diff.data[at + 3] = 255;
        if (y < top) top = y; if (y > bottom) bottom = y; if (x < left) left = x; if (x > right) right = x;
      } else { diff.data[at] = grey; diff.data[at + 1] = grey; diff.data[at + 2] = grey; diff.data[at + 3] = 255; }
    }
    fs.writeFileSync(path.join(out, name.replace(/\.png$/, '-diff.png')), PNG.sync.write(diff));
    const ratio = changed / (width * height), sizeChanged = a.width !== b.width || a.height !== b.height;
    const accepted = approved[name] || null, pass = !sizeChanged && ratio <= budget || Boolean(accepted);
    rows.push({ name, ratio: Number(ratio.toFixed(5)), changed, before: [a.width, a.height], after: [b.width, b.height], box: bottom < 0 ? null : [left, top, right, bottom], accepted, pass });
  }
  const report = { before: path.resolve(before), after: path.resolve(after), budget, tolerance: TOLERANCE, missing, rows };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const lines = ['| 图 | 差异像素比例 | 尺寸 前→后 | 差异范围 | 结论 |', '|---|---|---|---|---|'];
  for (const row of rows) lines.push('| ' + row.name + ' | ' + (row.ratio * 100).toFixed(3) + '% | ' + row.before.join('×') + ' → ' + row.after.join('×') + ' | ' + (row.box ? row.box.join(', ') : '无') + ' | ' + (row.pass ? row.accepted ? '已批准：' + row.accepted : '通过' : '**不通过**') + ' |');
  if (missing.length) lines.push('', '缺少的图：' + missing.join('、'));
  fs.writeFileSync(path.join(out, 'report.md'), lines.join('\n') + '\n');
  const failed = rows.filter(row => !row.pass);
  process.stdout.write(rows.length + ' pairs, ' + failed.length + ' over budget ' + budget + (missing.length ? ', ' + missing.length + ' missing' : '') + '\n');
  for (const row of failed) process.stdout.write('  ' + row.name + ' ' + (row.ratio * 100).toFixed(3) + '% box ' + JSON.stringify(row.box) + '\n');
  return failed.length || missing.length ? 1 : 0;
}

(async () => {
  const [command, ...rest] = process.argv.slice(2), { named, positional } = options(rest);
  let code = 2;
  if (command === 'capture' && positional.length === 2) code = await capture(positional[0], positional[1], named);
  else if (command === 'compare' && positional.length === 3) code = compare(positional[0], positional[1], positional[2], named);
  else process.stdout.write('usage: ui-pixel-gate.js capture <checkout> <out> | compare <before> <after> <out>\n');
  process.exitCode = code;
})().catch(error => { process.stderr.write(String(error && error.stack || error) + '\n'); process.exitCode = 1; });
