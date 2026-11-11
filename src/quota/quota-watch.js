'use strict';
// Which windows of account quota are running out or about to come back, and the person's one notice for each
// (docs/m2/DESKTOP-SHELL-20261105.md). It reads only the readings the app already holds; it never asks a provider.
const fs = require('node:fs');
const path = require('node:path');
const { agents } = require('../m1/agent-catalog');

// A service may report one reset a little differently from read to read.
const SOON_MS = 10 * 60000, SAME_RESET_MS = 30 * 60000, QUIET_STATES = new Set(['disabled', 'unlimited', 'unavailable']), DEFAULTS = Object.freeze({ enabled: true, low: 20, reset: true }), LOWS = [10, 20, 30];
const DURATIONS = { 60: '每小时', 300: '5 小时', 1440: '每天', 10080: '每周', 43200: '每月' };
function percentOf(item) {
  if (Number.isFinite(item.remainingPercent)) return item.remainingPercent;
  const remaining = Number(item.remaining), total = Number(item.total);
  return item.remaining !== null && item.total !== null && Number.isFinite(remaining) && Number.isFinite(total) && total > 0 ? Math.max(0, Math.min(100, remaining / total * 100)) : null;
}
const nameOf = (item, pool) => (item.durationMins && DURATIONS[item.durationMins] && (!item.label || /^(?:5h|week|weekly)$/i.test(item.label)) ? DURATIONS[item.durationMins] : null) ?? item.label ?? DURATIONS[item.durationMins] ?? pool.label ?? '额度';
// Every window of every connection that reports how much is left, tightest first. A balance has no limit to fall towards, so
// it is not here; a value the service did not report never counts as nothing left.
function windowRows(accounts) {
  const rows = [];
  for (const account of accounts ?? []) {
    const quota = account?.quota, agent = account?.provider ?? quota?.provider; if (!quota || !agent) continue;
    for (const pool of quota.pools ?? []) for (const item of pool.windows ?? []) {
      const remaining = percentOf(item);
      if (remaining === null || QUIET_STATES.has(item.state)) continue;
      rows.push({ key: account.id + '/' + pool.id + '/' + item.id, account: account.id, agent, agentName: agents[agent]?.name ?? agent, alias: account.alias ?? null, window: nameOf(item, pool), remaining: Math.round(remaining), resetsAt: item.resetsAt ?? null, fresh: item.freshness?.state === 'fresh' || item.freshness?.state === 'cached', fetchedAt: item.observedAt ?? quota.fetchedAt ?? null });
    }
  }
  return rows.sort((a, b) => a.remaining - b.remaining || String(a.resetsAt).localeCompare(String(b.resetsAt)));
}
function untilText(ms) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return minutes + ' 分钟';
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours < 24 ? hours + ' 小时' + (rest ? ' ' + rest + ' 分钟' : '') : Math.round(hours / 24) + ' 天';
}
// The notices one look at the readings gives, and the marks that keep each from repeating. A window that has been told about
// stays told until it comes back, across restarts too.
function evaluate(rows, marks, settings, now) {
  const notices = [], next = {}, seen = new Set();
  for (const row of rows) {
    seen.add(row.key);
    const mark = { ...marks[row.key] }, resets = row.resetsAt ? Date.parse(row.resetsAt) : null, label = row.agentName + ' ' + row.window;
    // A reading that is out of date tells nothing new; what is known about it stays as it was.
    if (!row.fresh) { next[row.key] = mark; continue; }
    if (mark.low && row.remaining > settings.low) {
      if (settings.reset) notices.push({ kind: 'back', title: label + ' 已恢复', body: '现在剩余 ' + row.remaining + '%', agent: row.agent });
      delete mark.low; delete mark.soon;
    } else if (!mark.low && row.remaining <= settings.low) {
      mark.low = true;
      notices.push({ kind: 'low', title: label + ' 只剩 ' + row.remaining + '%', body: resets && resets > now ? untilText(resets - now) + '后重置' : '重置时间未知', agent: row.agent });
    }
    if (mark.low && settings.reset && resets && resets > now && resets - now <= SOON_MS && !(mark.soon && Math.abs(Date.parse(mark.soon) - resets) < SAME_RESET_MS)) {
      mark.soon = row.resetsAt;
      notices.push({ kind: 'soon', title: label + ' ' + untilText(resets - now) + '后重置', body: '现在剩余 ' + row.remaining + '%', agent: row.agent });
    }
    if (Object.keys(mark).length) next[row.key] = mark;
  }
  return { notices, marks: next };
}
// Several at once read as one notice rather than a stack.
function bundled(notices) {
  if (notices.length <= 2) return notices;
  return [{ kind: 'many', title: notices.length + ' 项额度有变化', body: notices.slice(0, 3).map(item => item.title).join('\n'), agent: null }];
}
class QuotaWatch {
  constructor(root, { accounts, show, now = Date.now, changed = () => {} }) {
    this.file = path.join(root, 'quota-watch.json'); this.accounts = accounts; this.show = show; this.now = now; this.changed = changed;
    let saved = {}; try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* First run, or a damaged file: start from the defaults. */ }
    this.settings = { ...DEFAULTS, ...this.clean(saved.settings ?? {}) };
    this.marks = saved.marks && typeof saved.marks === 'object' ? saved.marks : {};
    this.rows = [];
  }
  clean(patch) {
    const out = {};
    if (typeof patch.enabled === 'boolean') out.enabled = patch.enabled;
    if (typeof patch.reset === 'boolean') out.reset = patch.reset;
    if (LOWS.includes(patch.low)) out.low = patch.low;
    return out;
  }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify({ settings: this.settings, marks: this.marks })); } catch { /* A notice may repeat after a restart; nothing else depends on it. */ } }
  set(patch) { this.settings = { ...this.settings, ...this.clean(patch) }; this.save(); this.check(); return this.settings; }
  check() {
    this.rows = windowRows(this.accounts());
    const { notices, marks } = evaluate(this.rows, this.marks, this.settings, this.now());
    const moved = JSON.stringify(marks) !== JSON.stringify(this.marks);
    this.marks = marks;
    if (moved) this.save();
    if (this.settings.enabled) for (const notice of bundled(notices)) this.show(notice);
    this.changed(this.rows);
    return this.rows;
  }
}
module.exports = { QuotaWatch, windowRows, evaluate, bundled, untilText, DEFAULTS, LOWS };
