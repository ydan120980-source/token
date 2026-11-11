'use strict';
/* global document, getComputedStyle */
// Shared checks for the smoke test of each page that moved to the React layer
// (docs/m2/UI-STACK-MIGRATION-20261024.md, "测试门槛"). Synthetic homes and isolated stores only.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron: electron } = require('playwright');
const { seed } = require('../../tests/m1/ui-style-fixture');
const { keepVisible, isolatePointer, cleanup } = require('./ui-settle');

const DESIGN = path.resolve(__dirname, '../../design/desktop-reference');

// Launches the app (source mode, or the packaged build named by QUOTA_PACKAGED_EXE) on a fresh
// synthetic home, usage and quota directory. Console errors and page errors are collected.
async function launch({ scale = 1, size = [1280, 900], seed: seedOptions, prepare, args = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-smoke-')), home = path.join(root, 'home'), usage = path.join(root, 'usage'), quota = path.join(root, 'quota');
  // prepare: the suite writes its own synthetic home and lets the app collect it, instead of a seeded store.
  if (prepare) prepare(home); else seed(home, usage, seedOptions);
  const packaged = process.env.QUOTA_PACKAGED_EXE;
  const app = await electron.launch({ executablePath: packaged || require('electron'), args: [...(packaged ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', quota, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale, ...args], timeout: 60000 });
  const errors = [];
  try {
    await keepVisible(app); await isolatePointer(app);
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setSize(width, height), size);
    await page.waitForFunction(() => document.readyState === 'complete' && Boolean(window.agentUi), null, { timeout: 30000 });
    return { app, page, errors, root, async close() { await app.close(); await cleanup(root); } };
  } catch (error) { await app.close(); await cleanup(root); throw error; }
}

async function setTheme(page, theme) {
  // The settings page's appearance choice goes through the shell's interface (M3).
  await page.evaluate(value => window.settingsHost.theme.set(value), theme);
  await page.waitForFunction(dark => document.body.classList.contains('dark') === dark, theme === 'dark');
}

// Current shell/account-card leaf class names must not enter page or portal scopes.
function legacyClassNames() {
  const names = new Set();
  for (const file of fs.readdirSync(DESIGN)) {
    if (!file.endsWith('.css') || file === 'legacy.css') continue;
    for (const match of fs.readFileSync(path.join(DESIGN, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) names.add(match[1]);
  }
  for (const file of ['app-layout.css', 'shell.css']) {
    const css = fs.readFileSync(path.resolve(DESIGN, '../../ui/src/theme', file), 'utf8');
    for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) names.add(match[1]);
  }
  return [...names];
}

// Shared names. sr-only: the legacy rule and Tailwind's utility both hide content visually
// (clip, 1px box, no wrap), so carrying it changes nothing.
// ff-scroll-fade appears in legacy motion.css only to exempt the React edge fade from motion off.
const SHARED = ['sr-only', 'ff-scroll-fade'];
async function isolationViolations(page) {
  return page.evaluate(legacy => {
    const styled = new Set(legacy), out = [];
    for (const element of document.querySelectorAll('[data-ui-root] *, [data-ui-portal] *')) {
      for (const name of element.classList) if (styled.has(name)) out.push(name + ' on <' + element.tagName.toLowerCase() + '>');
    }
    return out;
  }, legacyClassNames().filter(name => !SHARED.includes(name)));
}

// Data rules every migrated page keeps (CONTRIBUTING.md "数据语义铁律"): a value marked
// data-value="unknown" never reads as zero, and nothing marked data-agent-total exists (no sum across
// Agents). Returns the offending texts.
async function semanticViolations(page) {
  return page.evaluate(() => {
    const out = [], zero = /^[\s¥$€£]*[0０]([.,]0+)?\s*(%|积分|美元|元|tokens?)?\s*$/i;
    for (const element of document.querySelectorAll('[data-ui-root] [data-value="unknown"], [data-ui-portal] [data-value="unknown"]')) if (zero.test(element.textContent) || !element.textContent.trim()) out.push('unknown shown as "' + element.textContent + '"');
    for (const element of document.querySelectorAll('[data-ui-root] [data-agent-total], [data-ui-portal] [data-agent-total]')) out.push('sum across Agents: ' + element.textContent.trim());
    return out;
  });
}

// A computed style of an element inside the React layer, for token checks.
async function styleOf(page, selector, properties) {
  return page.locator(selector).first().evaluate((element, names) => Object.fromEntries(names.map(name => [name, getComputedStyle(element).getPropertyValue(name)])), properties);
}

// The properties compared between the app and a clean room.
const LOOK = ['display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'border-top-width', 'border-top-style', 'border-top-color', 'border-top-left-radius', 'background-color', 'background-image', 'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'opacity', 'box-shadow', 'outline-style', 'gap', 'align-items', 'justify-content', 'cursor', 'vertical-align', 'white-space'];

// Every element of a mounted island, as a list of computed looks keyed by position in the tree.
async function lookOf(page, rootSelector) {
  return page.evaluate(([selector, names]) => {
    const root = document.querySelector(selector), out = {};
    const walk = (element, key) => {
      const style = getComputedStyle(element);
      out[key] = Object.fromEntries(names.map(name => [name, style.getPropertyValue(name)]));
      [...element.children].forEach((child, i) => walk(child, key + '/' + i + ':' + child.tagName.toLowerCase()));
    };
    [...root.children].forEach((child, i) => walk(child, i + ':' + child.tagName.toLowerCase()));
    return out;
  }, [rootSelector, LOOK]);
}

// Mounts the same island in a clean room (a window with only tokens.css and the React layer, no
// legacy stylesheet) and returns every property that differs from the app: anything listed is legacy
// CSS reaching a React element. The app copy must be mounted at `rootSelector` already, in the same
// theme and motion mode, inside a host of `width` px.
async function cleanRoomDiff(app, page, { island, props = {}, rootSelector, width, dark, motion = 'off' }) {
  const viewport = await page.evaluate(() => [window.innerWidth, window.innerHeight, window.innerWidth - document.documentElement.clientWidth, window.innerHeight - document.documentElement.clientHeight]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ui-clean-room-')), 'room.html');
  const url = name => 'file:///' + path.join(DESIGN, name).split(path.sep).join('/');
  // The current font faces, with their URLs made absolute for the isolated room.
  const faces = [...fs.readFileSync(path.join(DESIGN, 'fonts.css'), 'utf8').matchAll(/@font-face\s*\{[^}]*\}/g)].map(match => match[0].replace(/url\('([^']+)'\)/g, (_, file) => "url('" + url(file) + "')")).join('');
  // Only the outer document geometry is calibrated: default body margin and
  // native scrollbar gutters otherwise change dvh/dvw and container widths.
  // No legacy colours, element rules or inner scrollbar styles enter the room.
  const environment = 'body{margin:0}html::-webkit-scrollbar{width:' + viewport[2] + 'px;height:' + viewport[3] + 'px}';
  fs.writeFileSync(file, '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="' + url('tokens.css') + '"><link rel="stylesheet" href="' + url('ui/agent-ui.css') + '"><style>' + faces + environment + '</style></head>' +
    '<body class="' + (dark ? 'dark' : '') + '" data-motion="' + motion + '"><div id="room" style="width:' + width + 'px"></div><script src="' + url('ui/agent-ui.js') + '"></script></body></html>');
  const opened = app.waitForEvent('window');
  // Compare the same CSS viewport. The app is frameless, whereas this room's
  // native frame used to subtract its title/menu height from 900 (812px here).
  // That mismatch becomes observable for the authorised viewport-edge controls.
  await app.evaluate(({ BrowserWindow }, [target, [width, height]]) => { const win = new BrowserWindow({ show: false, width, height, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true } }); void win.loadFile(target); }, [file, viewport]);
  const room = await opened;
  try {
    await room.waitForFunction(() => Boolean(window.agentUi), null, { timeout: 30000 });
    await room.waitForFunction(([width, height]) => window.innerWidth === width && window.innerHeight === height, viewport);
    // The App presentation module now owns initial motion policy. Apply the
    // same explicit mode before mounting fixtures, rather than only an HTML attribute.
    await room.evaluate(mode => window.uiMotion.setPreference(mode === "full" ? "system" : mode), motion);
    // Fonts first: controls that measure their labels at mount (the tab indicator) must see the real font.
    await room.evaluate(() => Promise.all(['Inter', 'Noto Sans SC', 'Geist Mono'].map(family => document.fonts.load('400 13px "' + family + '"', family === 'Noto Sans SC' ? '用量' : undefined))));
    await room.evaluate(([name, value]) => { window.agentUi.mount(name, document.getElementById('room'), value); }, [island, props]);
    await room.waitForFunction(() => document.getElementById('room').children.length > 0);
    const [inApp, inRoom] = [await lookOf(page, rootSelector), await lookOf(room, '#room')];
    const out = [];
    for (const key of new Set([...Object.keys(inApp), ...Object.keys(inRoom)])) {
      if (!inApp[key] || !inRoom[key]) { out.push(key + ': only in ' + (inApp[key] ? 'app' : 'clean room')); continue; }
      for (const name of LOOK) if (inApp[key][name] !== inRoom[key][name]) out.push(key + ' ' + name + ': app ' + inApp[key][name] + ' / clean ' + inRoom[key][name]);
    }
    return out;
  } finally { await room.close(); fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
}

module.exports = { launch, setTheme, legacyClassNames, isolationViolations, semanticViolations, styleOf, cleanRoomDiff };
