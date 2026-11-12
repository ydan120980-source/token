'use strict';
// The cost page's sections beyond the table, from statistics snapshot daily rows: the
// composition (what the money and the tokens went to), the monthly statement with a
// projection for the current month, the subscription comparison, what is left out and
// the cache. Shared by the window (window.costInsights) and unit tests. Unknown stays
// null: a month, part or ratio without priced usage is never filled with zero.
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pricing-labels'));
  else root.costInsights = factory(root.pricingLabels);
})(typeof window === 'undefined' ? this : window, function(labels) {
  const PARTS = ['inputUncached', 'output', 'cacheRead', 'cacheWrite'];
  const RANGED = ['cache-write-unreported', 'context-unreported', 'reasoning-unreported', 'time-tariff-unreported'];
  const known = value => value !== null && value !== undefined && Number.isFinite(value);
  const DAY = 86400000;
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  const at = date => Date.parse(date + 'T00:00:00Z');
  const shift = (date, days) => iso(at(date) + days * DAY);
  const days = (from, to) => Math.round((at(to) - at(from)) / DAY) + 1;
  const monthStart = date => date.slice(0, 8) + '01';
  const monthEnd = date => { const [y, m] = date.split('-').map(Number); return iso(Date.UTC(y, m, 0)); };
  const previousMonth = date => { const [y, m] = date.split('-').map(Number); return iso(Date.UTC(y, m - 2, 1)); };

  // Lower and upper bounds of the priced rows; null when nothing in them is priced.
  function total(rows) {
    let lower = 0, upper = 0, priced = false, tokens = 0, pricedTokens = 0; const used = new Set();
    for (const row of rows) {
      tokens += row.totalTokens || 0; pricedTokens += row.pricedTokens || 0;
      if (row.totalTokens > 0) used.add(row.date);
      if (known(row.estimatedCostUsd)) { priced = true; lower += row.estimatedCostUsd; upper += known(row.estimatedCostUpperUsd) ? row.estimatedCostUpperUsd : row.estimatedCostUsd; }
    }
    return { lower: priced ? lower : null, upper: priced ? upper : null, tokens, pricedTokens, coverage: tokens ? pricedTokens / tokens : null, usageDays: used.size };
  }
  const within = (rows, from, to) => rows.filter(row => row.date >= from && row.date <= to);

  /**
   * One entry per calendar month from the first recorded month to today's, newest first.
   * A change is shown only against a month the records fully cover; the current month is
   * compared with the same days of the previous one. The projection for the current month
   * keeps its pace of days with usage: the estimate per day with usage, times the days with
   * usage the rest of the month would have at the rate seen so far.
   */
  function months(rows, { today, coverageStart = null, minimumDays = 7 } = {}) {
    if (!today) return [];
    const first = coverageStart || rows.reduce((min, row) => !min || row.date < min ? row.date : min, null) || today;
    const byMonth = new Map();
    for (const row of rows) {
      const key = row.date.slice(0, 7);
      let list = byMonth.get(key);
      if (!list) byMonth.set(key, list = []);
      list.push(row);
    }
    const out = [];
    for (let start = monthStart(today); start >= monthStart(first); start = previousMonth(start)) {
      const end = monthEnd(start), from = start < first ? first : start, to = end > today ? today : end, current = end >= today;
      const sum = total(within(byMonth.get(start.slice(0, 7)) || [], from, to)), started = from === start;
      let delta = null, deltaKind = null;
      const before = previousMonth(start), beforeCovered = before >= first;
      if (started && beforeCovered && sum.lower !== null) {
        const beforeTo = current ? (() => { const same = shift(before, days(start, today) - 1); return same > monthEnd(before) ? monthEnd(before) : same; })() : monthEnd(before);
        const previous = total(within(byMonth.get(before.slice(0, 7)) || [], before, beforeTo));
        if (previous.lower) { delta = (sum.lower - previous.lower) / previous.lower; deltaKind = current ? 'same-days' : 'month'; }
      }
      let projection = null;
      const elapsed = days(from, to), remaining = current ? days(today, end) - 1 : 0;
      if (current && remaining > 0 && elapsed >= minimumDays && sum.lower !== null && sum.usageDays > 0) {
        const expected = remaining * sum.usageDays / elapsed;
        projection = { lower: sum.lower + sum.lower / sum.usageDays * expected, upper: sum.upper + sum.upper / sum.usageDays * expected, elapsed, remaining, usageDays: sum.usageDays };
      }
      out.push({ month: start.slice(0, 7), from, to, current, started, ...sum, delta, deltaKind, projection });
    }
    return out;
  }

  // Counts that add up to `cells` (largest remainder), from fractions; unknown counts as none.
  function waffle(fractions, cells = 100) {
    const raw = fractions.map(f => known(f) && f > 0 ? f * cells : 0), sum = raw.reduce((a, b) => a + b, 0);
    if (!sum) return raw.map(() => 0);
    const scaled = raw.map(v => v / sum * cells), base = scaled.map(Math.floor);
    let left = cells - base.reduce((a, b) => a + b, 0);
    scaled.map((v, i) => [v - base[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0) { base[i]++; left--; } });
    return base;
  }

  /**
   * What the money went to. Costs are every priced row's parts (they add up to the lower
   * bound). Tokens per part, and the price per million, come only from rows priced in full
   * with every part reported, so tokens and money describe the same usage.
   */
  function composition(rows, { bucket = 'week', from = null } = {}) {
    const sum = total(rows), cost = Object.fromEntries(PARTS.map(part => [part, 0]));
    const full = { tokens: Object.fromEntries(PARTS.map(part => [part, 0])), cost: Object.fromEntries(PARTS.map(part => [part, 0])) };
    const counts = {}, buckets = new Map(), origin = from || rows.reduce((min, row) => !min || row.date < min ? row.date : min, null);
    const bucketDates = new Map(), originTime = origin ? at(origin) : 0;
    const keyOf = date => {
      if (bucket === 'day' || !origin) return date;
      let key = bucketDates.get(date);
      if (key === undefined) {
        key = shift(origin, Math.floor((at(date) - originTime) / DAY / 7) * 7);
        bucketDates.set(date, key);
      }
      return key;
    };
    for (const row of rows) {
      if (!row.costParts) continue;
      for (const part of PARTS) cost[part] += row.costParts[part] || 0;
      const key = keyOf(row.date); let slot = buckets.get(key);
      if (!slot) buckets.set(key, slot = Object.fromEntries(PARTS.map(part => [part, 0])));
      for (const part of PARTS) slot[part] += row.costParts[part] || 0;
      if (row.pricedTokens === row.totalTokens && PARTS.every(part => known(row[part]))) for (const part of PARTS) { full.tokens[part] += row[part]; full.cost[part] += row.costParts[part] || 0; }
      if (known(row.estimatedCostUpperUsd) && known(row.estimatedCostUsd) && row.estimatedCostUpperUsd > row.estimatedCostUsd) for (const code of RANGED) if (row.pricingReasons?.[code] > 0) counts[code] = (counts[code] || 0) + row.pricingReasons[code];
    }
    const keys = [...buckets.keys()].sort(), fullTokens = PARTS.reduce((n, part) => n + full.tokens[part], 0);
    const spread = sum.lower === null ? null : sum.upper - sum.lower;
    return {
      lower: sum.lower, upper: sum.upper, spread, tokens: sum.tokens, pricedTokens: sum.pricedTokens, coverage: sum.coverage, fullTokens,
      reasons: Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code, records]) => ({ code, records, text: labels.REASONS[code] || code })),
      parts: PARTS.map(part => ({
        key: part, cost: sum.lower === null ? null : cost[part], share: sum.lower ? cost[part] / sum.lower : null,
        tokens: fullTokens ? full.tokens[part] : null, tokenShare: fullTokens ? full.tokens[part] / fullTokens : null,
        perMillion: full.tokens[part] > 0 ? full.cost[part] / full.tokens[part] * 1e6 : null,
        series: keys.map(key => ({ date: key, cost: buckets.get(key)[part] }))
      })),
      buckets: keys
    };
  }

  // The API-equivalent estimate of each Agent in a window against its monthly fee.
  function subscriptions(rows, { from, to, fees = {}, agents = [] } = {}) {
    const span = from && to ? within(rows, from, to) : rows, ids = [...new Set([...agents, ...span.map(row => row.agent)])];
    return ids.map(agent => {
      const sum = total(span.filter(row => row.agent === agent)), fee = known(fees[agent]) && fees[agent] > 0 ? fees[agent] : null;
      return { agent, ...sum, fee, ratioLower: fee && sum.lower !== null ? sum.lower / fee : null, ratioUpper: fee && sum.upper !== null ? sum.upper / fee : null };
    }).filter(entry => entry.tokens > 0 || entry.fee !== null);
  }

  // What is left out, across models (items from cost-table), heaviest first; then the range.
  const TITLES = { 'model-unpriced': '没有价格', 'price-unverified': '价格待核实', 'rate-missing': '缺少部分费率', incomplete: '来源没有报告完整' };
  function coverage(items) {
    const groups = new Map(); let tokens = 0, pricedTokens = 0, spread = 0; const reasons = {}, ranged = [];
    for (const item of items) {
      tokens += item.tokens; pricedTokens += item.pricedTokens;
      for (const gap of item.gaps) {
        const code = gap.kind === 'cause' || gap.code === 'usage-incomplete' ? 'incomplete' : gap.code;
        let group = groups.get(code);
        if (!group) groups.set(code, group = { code, title: TITLES[code] || labels.REASONS[code] || code, tokens: 0, fixable: gap.fixable, models: new Map() });
        group.tokens += gap.tokens; group.models.set(item.key, (group.models.get(item.key) || 0) + gap.tokens);
      }
      if (item.spread > 0) { spread += item.spread; ranged.push({ key: item.key, model: item.model, spread: item.spread }); for (const reason of item.spreadReasons) reasons[reason.code] = (reasons[reason.code] || 0) + reason.records; }
    }
    return {
      tokens, pricedTokens, coverage: tokens ? pricedTokens / tokens : null, unpricedTokens: tokens - pricedTokens,
      gaps: [...groups.values()].map(group => ({ ...group, share: tokens ? group.tokens / tokens : null, models: [...group.models].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, value]) => ({ key, tokens: value })) }))
        .sort((a, b) => b.tokens - a.tokens || a.code.localeCompare(b.code)),
      range: spread > 0 ? { spread, models: ranged.sort((a, b) => b.spread - a.spread), reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code, records]) => ({ code, records, text: labels.REASONS[code] || code })) } : null
    };
  }

  // Cache per model: the hit rate where both buckets are reported in full, and what it saved.
  function cache(items) {
    let read = 0, input = 0, savings = 0, saved = false;
    const models = items.map(item => {
      if (item.hitRate !== null) { read += item.fields.cacheRead.value; input += item.fields.inputUncached.value; }
      if (item.savings !== null) { savings += item.savings; saved = true; }
      return { key: item.key, model: item.model, tokens: item.tokens, users: item.users, hitRate: item.hitRate, savings: item.savings, priced: item.lower !== null, reported: item.hitRate !== null };
    });
    return { hitRate: read + input > 0 ? read / (read + input) : null, savings: saved ? savings : null, models };
  }

  return Object.freeze({ total, PARTS, months, waffle, composition, subscriptions, coverage, cache, monthEnd, shift });
});
