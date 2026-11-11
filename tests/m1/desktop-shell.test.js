'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { QuotaWatch, windowRows, evaluate, bundled, untilText, DEFAULTS } = require('../../src/quota/quota-watch');
const { ReadHistory, KEEP } = require('../../src/quota/read-history');
const { ringBitmap, trayText, cardRows, cardPlace, CARD_ROWS } = require('../../src/quota/desktop-shell');

const NOW = Date.parse('2026-10-01T08:00:00.000Z'), later = ms => new Date(NOW + ms).toISOString();
const window = (id, usedPercent, extra = {}) => ({ id, unit: 'percent', usedPercent, remainingPercent: 100 - usedPercent, remaining: null, total: null, state: 'available', resetsAt: later(4 * 3600000), durationMins: 300, freshness: { state: 'fresh' }, ...extra });
const account = (id, provider, windows, balances = []) => ({ id, provider, alias: provider, quota: { provider, fetchedAt: later(0), pools: [{ id: 'p', label: provider, windows, balances }] } });
const dir = t => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-shell-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; };

test('rows: tightest first; unknown and balances are never read as nothing left', () => {
  const rows = windowRows([account('a', 'codex', [window('w', 62), window('h', 90, { durationMins: 10080 })], [{ id: 'money', remaining: '0' }]), account('b', 'claude', [{ ...window('none', 0), remainingPercent: null, usedPercent: null }, window('off', 99, { state: 'disabled' })]), { id: 'c', provider: 'gemini', quota: null }]);
  assert.deepEqual(rows.map(row => [row.agent, row.window, row.remaining]), [['codex', '每周', 10], ['codex', '5 小时', 38]]);
  // A window counted in credits reports how much of its total is left.
  assert.equal(windowRows([account('d', 'workbuddy', [{ ...window('cycle', 0), remainingPercent: null, usedPercent: null, remaining: '500', total: '2000', label: '周期积分' }])])[0].remaining, 25);
});

test('a window that runs low says so once, reset soon once, back once, and starts over', () => {
  const look = (remaining, resetIn, marks, settings = DEFAULTS) => evaluate(windowRows([account('a', 'codex', [window('w', 100 - remaining, { resetsAt: later(resetIn) })])]), marks, settings, NOW);
  const HOUR = 3600000;
  let step = look(50, HOUR, {}); assert.deepEqual(step.notices, []); assert.deepEqual(step.marks, {});
  step = look(18, HOUR, step.marks); assert.deepEqual(step.notices.map(notice => [notice.kind, notice.title]), [['low', 'Codex 5 小时 只剩 18%']]); assert.equal(step.notices[0].body, '1 小时后重置');
  step = look(12, HOUR, step.marks); assert.deepEqual(step.notices, [], 'falling further is not a new notice');
  step = look(12, 8 * 60000, step.marks); assert.deepEqual(step.notices.map(notice => notice.kind), ['soon']);
  step = look(12, 7 * 60000, step.marks); assert.deepEqual(step.notices, [], 'one reset, one reminder');
  step = look(100, 5 * HOUR, step.marks); assert.deepEqual(step.notices.map(notice => notice.kind), ['back']); assert.deepEqual(step.marks, {});
  step = look(15, HOUR, step.marks); assert.deepEqual(step.notices.map(notice => notice.kind), ['low'], 'the next window can warn again');
});

test('the person\'s threshold and reset switch are respected; an out-of-date reading tells nothing new', () => {
  const rows = low => windowRows([account('a', 'codex', [window('w', 100 - low, { resetsAt: later(5 * 60000) })])]);
  assert.deepEqual(evaluate(rows(25), {}, { ...DEFAULTS, low: 30 }, NOW).notices.map(notice => notice.kind), ['low', 'soon']);
  assert.deepEqual(evaluate(rows(25), {}, { ...DEFAULTS, low: 10 }, NOW).notices, []);
  assert.deepEqual(evaluate(rows(5), {}, { ...DEFAULTS, reset: false }, NOW).notices.map(notice => notice.kind), ['low']);
  const old = windowRows([account('a', 'codex', [window('w', 95, { freshness: { state: 'stale' } })])]);
  assert.deepEqual(evaluate(old, {}, DEFAULTS, NOW).notices, []);
  assert.deepEqual(evaluate(old, { [old[0].key]: { low: true } }, DEFAULTS, NOW).marks, { [old[0].key]: { low: true } }, 'an old reading does not forget what was said');
});

test('several at once read as one; times read as a person says them', () => {
  const one = { kind: 'low', title: 'a', body: 'x', agent: 'codex' };
  assert.equal(bundled([one, one]).length, 2);
  const many = bundled([one, one, one, one]); assert.equal(many.length, 1); assert.equal(many[0].title, '4 项额度有变化');
  assert.equal(untilText(30 * 1000), '1 分钟'); assert.equal(untilText(90 * 60000), '1 小时 30 分钟'); assert.equal(untilText(3 * 86400000), '3 天');
});

test('the watch keeps its marks across restarts and stays silent when switched off', t => {
  const root = dir(t), shown = [], accounts = () => [account('a', 'codex', [window('w', 90)])];
  const first = new QuotaWatch(root, { accounts, show: notice => shown.push(notice), now: () => NOW });
  first.check(); first.check(); assert.equal(shown.length, 1);
  new QuotaWatch(root, { accounts, show: notice => shown.push(notice), now: () => NOW }).check();
  assert.equal(shown.length, 1, 'a restart does not repeat it');
  const silent = [], root2 = dir(t), off = new QuotaWatch(root2, { accounts, show: notice => silent.push(notice), now: () => NOW });
  off.set({ enabled: false }); off.check(); assert.deepEqual(silent, []);
  off.set({ low: 7, enabled: 'yes', reset: 3 }); assert.deepEqual(off.settings, { ...DEFAULTS, enabled: false }, 'only known values are kept');
  fs.writeFileSync(path.join(root2, 'quota-watch.json'), '{broken');
  assert.deepEqual(new QuotaWatch(root2, { accounts, show() {}, now: () => NOW }).settings, DEFAULTS, 'a damaged file means defaults');
});

test('read history: reads with one outcome share a line, failures stay findable, the record holds times and codes only', t => {
  const root = dir(t); let now = NOW;
  const history = new ReadHistory(root, { now: () => now }), tick = () => { now += 60000; };
  for (let index = 0; index < 500; index++) { history.record('a', { ok: true, automatic: true }); tick(); }
  history.record('a', { ok: false, code: 'PROVIDER_TIMEOUT', automatic: true, quiet: true }); tick();
  history.record('a', { ok: false, code: 'PROVIDER_TIMEOUT', automatic: true, quiet: true }); tick();
  history.record('a', { ok: true, automatic: true });
  const lines = history.list('a');
  assert.deepEqual(lines.map(line => [line.ok, line.count ?? 1]), [[true, 1], [false, 2], [true, 500]], 'newest first');
  assert.equal(lines[1].code, 'PROVIDER_TIMEOUT'); assert.equal(lines[1].quiet, true);
  history.close();
  assert.deepEqual(new ReadHistory(root).list('a'), lines, 'kept across a restart');
  for (let index = 0; index < KEEP * 2; index++) { history.record('b', { ok: false, code: 'E' + index }); }
  assert.equal(history.list('b').length, KEEP);
  history.forget('b'); assert.deepEqual(history.list('b'), []);
  history.close();
  fs.writeFileSync(path.join(root, 'read-history.json'), '[]');
  assert.deepEqual(new ReadHistory(root).list('a'), []);
});

test('tray pieces: the ring shows what is left, an unknown reads full, and the card stays on screen', () => {
  const lit = bitmap => { let count = 0; for (let at = 3; at < bitmap.length; at += 4) if (bitmap[at] === 255) count++; return count; };
  const quarter = ringBitmap(0.25, [1, 2, 3]), half = ringBitmap(0.5, [1, 2, 3]), full = ringBitmap(1, [1, 2, 3]);
  assert.equal(quarter.length, 32 * 32 * 4);
  assert.ok(lit(quarter) < lit(half) && lit(half) < lit(full));
  assert.equal(lit(ringBitmap(NaN, [1, 2, 3])), lit(full), 'unknown is not drawn as empty');
  assert.equal(trayText([]), 'Agent Usage');
  assert.equal(trayText([{ agentName: 'Codex', window: '每周', remaining: 7 }]), 'Agent Usage · Codex 每周 剩余 7%');
  assert.ok(trayText([{ agentName: 'x'.repeat(200), window: 'y', remaining: 1 }]).length <= 127, 'Windows cuts a tooltip past 127');
  const many = Array.from({ length: CARD_ROWS + 3 }, (_, index) => ({ agent: 'codex', agentName: 'Codex', window: String(index), remaining: index, key: 'secret', account: 'secret' }));
  const card = cardRows(many); assert.equal(card.rows.length, CARD_ROWS); assert.equal(card.more, 3); assert.equal(card.rows[0].account, undefined, 'the card gets what it shows and no ids');
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(cardPlace({ x: 1800, y: 1045, width: 24, height: 30 }, area, 340, 300), { x: 1572, y: 732, width: 340, height: 300 }, 'above a tray at the bottom, inside the right edge');
  assert.equal(cardPlace({ x: 1000, y: 0, width: 24, height: 24 }, { x: 0, y: 30, width: 1920, height: 1040 }, 340, 300).y, 38, 'below a tray at the top');
});
