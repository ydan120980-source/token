'use strict';
(function attach(root) {
  function localDay(timezone, time = Date.now()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
  }
  function shift(date, days) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
  function startFor(today, period, coverageStart) { return period === 'all' ? coverageStart || today : period === 'today' ? today : shift(today, 1 - Number(period)); }
  function series(rows, model, days, display, metric, coverageStart, observedDates = null) {
    return seriesByModel(rows, [model], days, display, metric, coverageStart, observedDates).get(model);
  }
  // Index rows once and share calendar/coverage work across every model curve.
  // Keep the 30-day sums in calendar order (no prefix-subtraction rounding drift).
  function seriesByModel(rows, models, days, display, metric, coverageStart, observedDates = null) {
    const grouped = new Map(models.map(model => [model, { daily: new Map(), observed: new Set() }]));
    for (const row of rows) {
      const group = grouped.get(row.model); if (!group) continue;
      group.observed.add(row.date);
      const value = metric === 'cost' ? row.estimatedCostUsd : row.totalTokens;
      if (value !== null) group.daily.set(row.date, (group.daily.get(row.date) || 0) + value);
    }
    const plan = [...days].sort().map(day => {
      const start = display === 'average' ? shift(day, -29) : day, window = [];
      let covered = day >= coverageStart && start >= coverageStart;
      if (display !== 'total' && covered) {
        for (let date = start; date <= day; date = shift(date, 1)) {
          window.push(date); if (observedDates && !observedDates.has(date)) covered = false;
        }
      }
      return { day, window, covered };
    });
    return new Map([...grouped].map(([model, { daily, observed }]) => {
      let running = 0, known = false;
      const values = new Map(plan.map(({ day, window, covered }) => {
        if (!covered) return [day, null];
        if (display === 'total') {
          if (daily.has(day)) { running += daily.get(day); known = true; }
          return [day, metric === 'cost' && !known ? null : running];
        }
        let sum = 0, priced = false, hasRows = false;
        for (const date of window) { sum += daily.get(date) || 0; priced ||= daily.has(date); hasRows ||= observed.has(date); }
        return [day, metric === 'cost' && hasRows && !priced ? null : sum / (display === 'average' ? 30 : 1)];
      }));
      return [model, days.map(day => values.get(day))];
    }));
  }
  function disjointMix(rows) {
    const fields = ['inputUncached', 'outputPlain', 'cacheRead', 'cacheWrite', 'reasoning'];
    const sum = (items, key) => items.reduce((n, row) => n + (row[key] ?? 0), 0);
    const complete = rows.filter(r => [r.inputUncached, r.output, r.cacheRead, r.cacheWrite, r.reasoning].every(v => Number.isFinite(v)) && r.reasoning <= r.output && r.inputUncached + r.output + r.cacheRead + r.cacheWrite === r.totalTokens);
    const total = sum(complete, 'totalTokens');
    const values = fields.map(field => field === 'outputPlain' ? sum(complete, 'output') - sum(complete, 'reasoning') : sum(complete, field));
    const partialValues = fields.map(field => rows.some(row => (row.knownRecords?.[field] ?? row.records) < row.records));
    const displayValues = fields.map((field, index) => {
      const required = field === 'outputPlain' ? ['output', 'reasoning'] : [field];
      if (rows.some(r => required.some(key => r[key] === null || r[key] === undefined) || field === 'outputPlain' && r.reasoning > r.output)) {
        const observed = rows.filter(row => row.knownRecords?.[field] > 0);
        partialValues[index] = true; return observed.length ? observed.reduce((n,row) => n + row.knownUsage[field],0) : null;
      }
      return field === 'outputPlain' ? sum(rows, 'output') - sum(rows, 'reasoning') : sum(rows, field);
    });
    return { total, values, displayValues, partialValues, incomplete: complete.length !== rows.length, coverage: sum(rows, 'totalTokens') ? total / sum(rows, 'totalTokens') : null };
  }
  const api = { localDay, shift, startFor, series, seriesByModel, disjointMix };
  if (typeof module === 'object') module.exports = api; else root.usageMath = api;
})(typeof window === 'object' ? window : null);
