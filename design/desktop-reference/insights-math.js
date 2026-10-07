'use strict';
// Pure aggregation for the composition and habits views. Unknown stays null; a
// field a source never records is "not recorded", not missing and never zero.
(function attach(root) {
  const COST_FIELDS = ['inputUncached', 'output', 'cacheRead', 'cacheWrite'];
  const known = value => value !== null && value !== undefined && Number.isFinite(value);
  const sum = (rows, read) => rows.reduce((total, row) => total + read(row), 0);

  // A source records a field when any of its rows ever reported it.
  function recordedFields(allRows) {
    const seen = new Map();
    for (const row of allRows) {
      if (!seen.has(row.agent)) seen.set(row.agent, new Set());
      for (const field of ['inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning']) {
        if (row.knownRecords ? row.knownRecords[field] > 0 : known(row[field])) seen.get(row.agent).add(field);
      }
    }
    return (agent, field) => seen.get(agent)?.has(field) === true;
  }

  // One tile per token category. States: value, partial (a lower bound), combined
  // (contained in another tile), not-recorded (the source has no such field), unknown.
  function categoryView(rows, recorded) {
    const measure = (subset, field) => {
      if (!subset.length) return { value: null, state: rows.length ? 'not-recorded' : 'unknown' };
      if (subset.every(row => known(row[field]))) return { value: sum(subset, row => row[field]), state: 'value' };
      const reported = subset.filter(row => row.knownRecords?.[field] > 0);
      return reported.length ? { value: sum(reported, row => row.knownUsage[field]), state: 'partial' } : { value: null, state: 'unknown' };
    };
    const tile = (key, label, field, subset = rows.filter(row => recorded(row.agent, field))) => ({ key, label, ...measure(subset, field) });
    const split = rows.filter(row => recorded(row.agent, 'reasoning')), unsplit = rows.length - split.length;
    let output, reasoning;
    if (!unsplit) {
      // Every source separates reasoning: output tile excludes it, as before.
      const plain = split.every(row => known(row.output) && known(row.reasoning) && row.reasoning <= row.output);
      const reported = split.filter(row => row.knownRecords?.outputPlain > 0);
      output = { key: 'outputPlain', label: '输出（不含推理）', ...(plain ? { value: sum(split, row => row.output - row.reasoning), state: split.length ? 'value' : 'unknown' } : reported.length ? { value: sum(reported, row => row.knownUsage.outputPlain), state: 'partial' } : { value: null, state: 'unknown' }) };
      reasoning = tile('reasoning', '推理', 'reasoning', split);
    } else {
      output = tile('output', '输出（含推理）', 'output', rows);
      reasoning = split.length ? { ...tile('reasoning', '推理', 'reasoning', split), state: 'partial', note: '部分来源未单独记录推理' } : { key: 'reasoning', label: '推理', value: null, state: 'combined', note: '已含在输出中，来源未拆分' };
    }
    return [tile('inputUncached', '输入（不含缓存）', 'inputUncached'), output, tile('cacheRead', '缓存读取', 'cacheRead'), tile('cacheWrite', '缓存写入', 'cacheWrite'), reasoning];
  }

  // Share of cache reads among input-side tokens. A source that does not record
  // cache writes counts them inside its uncached input, so they add nothing here.
  function cacheHitRate(rows, recorded) {
    let read = 0, input = 0;
    for (const row of rows) {
      const write = recorded(row.agent, 'cacheWrite') ? row.cacheWrite : 0;
      if (!known(row.inputUncached) || !known(row.cacheRead) || !known(write)) continue;
      read += row.cacheRead; input += row.inputUncached + row.cacheRead + write;
    }
    return input ? read / input : null;
  }

  function costDestination(rows, recorded) {
    const priced = rows.filter(row => row.costParts);
    const values = COST_FIELDS.map(field => sum(priced, row => row.costParts[field] || 0)), total = values.reduce((a, b) => a + b, 0);
    const tokens = sum(rows, row => row.totalTokens), pricedTokens = sum(rows, row => row.pricedTokens || 0);
    return {
      total: priced.length ? total : null,
      parts: COST_FIELDS.map((field, i) => ({ key: field, value: priced.length ? values[i] : null, share: total > 0 ? values[i] / total : null })),
      savings: priced.length ? sum(priced, row => row.cacheSavingsUsd || 0) : null,
      hitRate: cacheHitRate(rows, recorded),
      pricedShare: tokens ? pricedTokens / tokens : null
    };
  }

  // Ranked shares by agent or model; the tail beyond `limit` is one "other" item.
  function shares(rows, by, limit = 6) {
    const groups = new Map();
    for (const row of rows) {
      const key = row[by] ?? 'unknown', group = groups.get(key) || { key, tokens: 0, cost: 0, priced: false };
      group.tokens += row.totalTokens; if (known(row.estimatedCostUsd)) { group.cost += row.estimatedCostUsd; group.priced = true; }
      groups.set(key, group);
    }
    const ranked = [...groups.values()].sort((a, b) => b.tokens - a.tokens || String(a.key).localeCompare(String(b.key)));
    const items = ranked.length > limit + 1 ? [...ranked.slice(0, limit), ranked.slice(limit).reduce((other, item) => ({ key: null, count: other.count + 1, tokens: other.tokens + item.tokens, cost: other.cost + item.cost, priced: other.priced || item.priced }), { key: null, count: 0, tokens: 0, cost: 0, priced: false })] : ranked;
    const tokens = sum(ranked, item => item.tokens), cost = sum(ranked, item => item.cost);
    return items.map(item => ({ ...item, cost: item.priced ? item.cost : null, tokenShare: tokens ? item.tokens / tokens : 0, costShare: item.priced && cost > 0 ? item.cost / cost : null }));
  }

  // Weekday (Monday first) x local hour. Each cell keeps tokens, records and the
  // number of distinct dates that contributed, so averages are honest.
  function weekHour(hourlyRows) {
    const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ tokens: 0, records: 0, dates: new Set() })));
    for (const row of hourlyRows) {
      const weekday = (new Date(row.date + 'T12:00:00Z').getUTCDay() + 6) % 7, cell = cells[weekday][row.hour];
      cell.tokens += row.totalTokens; cell.records += row.records || 0; if (row.totalTokens > 0) cell.dates.add(row.date);
    }
    let max = 0, peak = null, active = 0;
    const hours = Array(24).fill(0), days = Array(7).fill(0);
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
      const cell = cells[d][h]; cell.days = cell.dates.size; delete cell.dates;
      hours[h] += cell.tokens; days[d] += cell.tokens; if (cell.tokens > 0) active++;
      if (cell.tokens > max) { max = cell.tokens; peak = { weekday: d, hour: h }; }
    }
    const best = (list) => list.some(v => v > 0) ? list.indexOf(Math.max(...list)) : null;
    return { cells, max, peak, active, peakHour: best(hours), peakWeekday: best(days), hours, days };
  }

  function efficiency(rows, recorded) {
    const tokens = sum(rows, row => row.totalTokens), records = sum(rows, row => row.records || 0);
    const priced = rows.filter(row => known(row.estimatedCostUsd)), cost = sum(priced, row => row.estimatedCostUsd), pricedTokens = sum(rows, row => row.pricedTokens || 0);
    const activeDays = new Set(rows.filter(row => row.totalTokens > 0).map(row => row.date)).size;
    return {
      activeDays, tokens, records,
      costPerDay: priced.length && activeDays ? cost / activeDays : null,
      tokensPerRecord: records ? tokens / records : null,
      costPerMillion: priced.length && pricedTokens ? cost / pricedTokens * 1e6 : null,
      hitRate: cacheHitRate(rows, recorded)
    };
  }

  // Relative change against a comparable earlier window; null when not comparable.
  function change(current, previous) { return known(current) && known(previous) && previous > 0 ? (current - previous) / previous : null; }

  const api = { recordedFields, categoryView, cacheHitRate, costDestination, shares, weekHour, efficiency, change };
  if (typeof module === 'object') module.exports = api; else root.insightsMath = api;
})(typeof window === 'object' ? window : null);
