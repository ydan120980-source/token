'use strict';
// The cost page's table, from statistics snapshot daily rows: per model (provider/model)
// or per Agent. Shared by the window (window.costTable) and the main process, which
// rebuilds the CSV export from its own snapshot. Unknown stays null: an unreported
// field, an unpriced estimate or a missing comparison is never filled with zero.
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pricing-labels'));
  else root.costTable = factory(root.pricingLabels);
})(typeof window === 'undefined' ? this : window, function(labels) {
  const FIELDS = ['inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];
  const PARTS = ['inputUncached', 'output', 'cacheRead', 'cacheWrite'];
  // Reasons an estimate is a range rather than one number.
  const RANGED = ['cache-write-unreported', 'context-unreported', 'reasoning-unreported', 'time-tariff-unreported'];
  const known = value => value !== null && value !== undefined && Number.isFinite(value);
  const modelKey = row => (row.provider || 'unknown') + '/' + row.model;
  const keyOf = (row, by) => by === 'agent' ? row.agent : modelKey(row);

  function group(key) {
    return { key, tokens: 0, records: 0, lower: 0, upper: 0, priced: false, pricedTokens: 0, boundedTokens: 0, savings: 0, hasSavings: false,
      fields: Object.fromEntries(FIELDS.map(field => [field, { sum: 0, known: 0, unknown: 0 }])), costParts: Object.fromEntries(PARTS.map(field => [field, 0])),
      unpriced: {}, incomplete: {}, ranged: {}, users: new Map(), series: new Map(), dayCost: new Map() };
  }
  function addCost(target, row) {
    target.tokens += row.totalTokens || 0; target.pricedTokens += row.pricedTokens || 0;
    if (known(row.estimatedCostUsd)) { target.priced = true; target.lower += row.estimatedCostUsd; target.upper += known(row.estimatedCostUpperUsd) ? row.estimatedCostUpperUsd : row.estimatedCostUsd; }
  }
  const cost = target => target.priced ? { lower: target.lower, upper: target.upper } : { lower: null, upper: null };

  // Why tokens are left out: incomplete usage by its cause, every other reason as itself,
  // heaviest first. `fixable` marks the ones a price or a mapping can close.
  function gaps(unpriced, incomplete) {
    const list = Object.entries(incomplete).map(([code, tokens]) => ({ code, kind: 'cause', tokens, fixable: false, text: labels.CAUSES[code] || labels.REASONS['usage-incomplete'] }));
    const causeTokens = list.reduce((n, item) => n + item.tokens, 0);
    for (const [code, tokens] of Object.entries(unpriced)) {
      const rest = code === 'usage-incomplete' ? tokens - causeTokens : tokens;
      if (rest > 0) list.push({ code, kind: 'reason', tokens: rest, fixable: labels.FIXABLE.includes(code), text: labels.REASONS[code] || code });
    }
    return list.sort((a, b) => b.tokens - a.tokens || a.code.localeCompare(b.code));
  }

  /**
   * One entry per model or Agent, heaviest (by tokens) first. `previousRows` is the
   * comparable earlier window, or null when there is none (then delta stays null).
   */
  function table(rows, { by = 'model', previousRows = null } = {}) {
    const groups = new Map(); let total = 0;
    for (const row of rows) {
      const key = keyOf(row, by); let item = groups.get(key);
      if (!item) groups.set(key, item = Object.assign(group(key), by === 'agent' ? { agent: row.agent } : { provider: row.provider || 'unknown', model: row.model }));
      total += row.totalTokens || 0; addCost(item, row); item.records += row.records || 0; item.boundedTokens += row.boundedTokens || 0;
      if (row.costParts) for (const field of PARTS) item.costParts[field] += row.costParts[field] || 0;
      if (known(row.cacheSavingsUsd)) { item.savings += row.cacheSavingsUsd; item.hasSavings = true; }
      // A day's field is null when any of its records left it out; such days make the sum partial.
      for (const field of FIELDS) { const slot = item.fields[field]; if (known(row[field])) { slot.sum += row[field]; slot.known++; } else slot.unknown++; }
      for (const [code, tokens] of Object.entries(row.unpricedTokens || {})) item.unpriced[code] = (item.unpriced[code] || 0) + tokens;
      for (const [code, tokens] of Object.entries(row.incompleteTokens || {})) item.incomplete[code] = (item.incomplete[code] || 0) + tokens;
      if (known(row.estimatedCostUpperUsd) && known(row.estimatedCostUsd) && row.estimatedCostUpperUsd > row.estimatedCostUsd) for (const code of RANGED) if (row.pricingReasons?.[code] > 0) item.ranged[code] = (item.ranged[code] || 0) + row.pricingReasons[code];
      const userKey = by === 'agent' ? modelKey(row) : row.agent;
      let user = item.users.get(userKey);
      if (!user) item.users.set(userKey, user = Object.assign({ key: userKey, tokens: 0, lower: 0, upper: 0, priced: false, pricedTokens: 0 }, by === 'agent' ? { provider: row.provider || 'unknown', model: row.model } : { agent: row.agent }));
      addCost(user, row);
      item.series.set(row.date, (item.series.get(row.date) || 0) + (row.totalTokens || 0));
      { const day = item.dayCost.get(row.date) ?? { lower: null, upper: null, priced: 0 };
        if (known(row.estimatedCostUsd)) { day.lower = (day.lower ?? 0) + row.estimatedCostUsd; day.upper = (day.upper ?? 0) + (known(row.estimatedCostUpperUsd) ? row.estimatedCostUpperUsd : row.estimatedCostUsd); }
        day.priced += row.pricedTokens || 0; item.dayCost.set(row.date, day); }
    }
    let before = null;
    if (previousRows) { before = new Map(); for (const row of previousRows) { const key = keyOf(row, by); before.set(key, (before.get(key) || 0) + (row.totalTokens || 0)); } }
    return [...groups.values()].map(item => {
      const fields = Object.fromEntries(FIELDS.map(field => { const slot = item.fields[field]; return [field, { value: slot.known ? slot.sum : null, partial: slot.known > 0 && slot.unknown > 0 }]; }));
      const read = fields.cacheRead, input = fields.inputUncached;
      const complete = read.value !== null && input.value !== null && !read.partial && !input.partial && read.value + input.value > 0;
      const { lower, upper } = cost(item), previous = before ? before.get(item.key) || 0 : null;
      return {
        key: item.key, agent: item.agent ?? null, provider: item.provider ?? null, model: item.model ?? null,
        tokens: item.tokens, records: item.records, share: total ? item.tokens / total : 0,
        lower, upper, pricedTokens: item.pricedTokens, boundedTokens: item.boundedTokens, coverage: item.tokens ? item.pricedTokens / item.tokens : null,
        // Per million of the tokens the estimate covers, not of all tokens.
        perMillion: lower !== null && item.pricedTokens > 0 ? lower / item.pricedTokens * 1e6 : null,
        fields, costParts: item.priced ? { ...item.costParts } : null, spread: lower !== null ? upper - lower : null,
        // Why the estimate is a range (by records), so the range is not attributed to one field.
        spreadReasons: Object.entries(item.ranged).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code, records]) => ({ code, records, text: labels.REASONS[code] || code })),
        savings: item.priced && item.hasSavings ? item.savings : null, hitRate: complete ? read.value / (read.value + input.value) : null,
        gaps: gaps(item.unpriced, item.incomplete),
        users: [...item.users.values()].map(user => ({ ...user, ...cost(user), share: item.tokens ? user.tokens / item.tokens : 0, coverage: user.tokens ? user.pricedTokens / user.tokens : null }))
          .sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key)),
        series: [...item.series].sort((a, b) => a[0].localeCompare(b[0])).map(([date, tokens]) => { const day = item.dayCost.get(date); return { date, tokens, cost: day.lower, costUpper: day.upper, partial: day.priced < tokens }; }),
        previousTokens: previous, delta: previous ? (item.tokens - previous) / previous : null, isNew: previous === 0 && item.tokens > 0
      };
    }).sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key));
  }

  // Token order, or estimate order with what is not counted after it (heaviest first).
  function sort(items, by = 'tokens') {
    const byTokens = (a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key);
    return [...items].sort(by === 'cost' ? (a, b) => (a.lower === null) - (b.lower === null) || (b.lower ?? 0) - (a.lower ?? 0) || byTokens(a, b) : byTokens);
  }

  // The first `top` entries and one "other" entry for the rest (only when it would hold two or more).
  function fold(items, top = 6) {
    if (items.length <= top + 1) return items;
    const rest = items.slice(top), priced = rest.filter(item => item.lower !== null), tokens = rest.reduce((n, item) => n + item.tokens, 0);
    const pricedTokens = rest.reduce((n, item) => n + item.pricedTokens, 0);
    return [...items.slice(0, top), { key: null, other: true, count: rest.length, members: rest.map(item => item.key), tokens, share: rest.reduce((n, item) => n + item.share, 0),
      lower: priced.length ? priced.reduce((n, item) => n + item.lower, 0) : null, upper: priced.length ? priced.reduce((n, item) => n + item.upper, 0) : null,
      pricedTokens, coverage: tokens ? pricedTokens / tokens : null }];
  }

  // At most `max` points: consecutive days merge into equal buckets.
  function points(series, max = 90) {
    if (series.length <= max) return series;
    const size = Math.ceil(series.length / max), out = [];
    for (let i = 0; i < series.length; i += size) { const chunk = series.slice(i, i + size); out.push({ date: chunk[0].date, tokens: chunk.reduce((n, p) => n + p.tokens, 0) }); }
    return out;
  }

  // CSV for a spreadsheet: UTF-8 with BOM, one header row, unknown left empty. Names come
  // from logs, so a text cell that a spreadsheet would read as a formula is prefixed with '.
  const HEADER = ['范围', '分组', '名称', '服务商', '使用方', 'Token', '占比', '估算下限 (USD)', '估算上限 (USD)', '已计入 Token', '计价覆盖', '每百万 Token (USD)', '较前期', '未计入原因'];
  function cell(value, untrusted = false) {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (untrusted && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }
  const percent = value => value === null || value === undefined ? null : (value * 100).toFixed(1) + '%';
  const usd = value => value === null || value === undefined ? null : value.toFixed(4);
  function csv(items, { by = 'model', range = '累计', agentName = id => id, modelName = model => model } = {}) {
    const lines = [HEADER.map(text => cell(text)).join(',')];
    for (const item of items) {
      const name = by === 'agent' ? agentName(item.agent) : modelName(item.model);
      const users = item.users.map(user => by === 'agent' ? modelName(user.model) : agentName(user.agent)).join(' / ');
      // A signed percentage a spreadsheet reads as a number; the cell is generated here, not from logs.
      const delta = item.isNew ? '新增' : item.delta === null ? null : (item.delta >= 0 ? '+' : '-') + Math.abs(item.delta * 100).toFixed(1) + '%';
      const reasons = item.gaps.map(gap => gap.text + '（' + gap.tokens + ' Token）').join('；');
      lines.push([cell(range), cell(by === 'agent' ? 'Agent' : '模型'), cell(name, true), cell(by === 'agent' ? null : item.provider, true), cell(users, true), cell(item.tokens), cell(percent(item.share)),
        cell(usd(item.lower)), cell(usd(item.upper)), cell(item.pricedTokens), cell(percent(item.coverage)), cell(usd(item.perMillion)), cell(delta), cell(reasons || null)].join(','));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  return Object.freeze({ FIELDS, PARTS, RANGED, table, sort, fold, points, csv, HEADER });
});
