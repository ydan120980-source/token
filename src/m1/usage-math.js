'use strict';
(function attach(root) {
  const dayFormatters=new Map();
  function localDay(timezone, time = Date.now()) {
    if(!dayFormatters.has(timezone)) {
      const formatter=new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
      if(dayFormatters.size>=8)dayFormatters.delete(dayFormatters.keys().next().value);
      dayFormatters.set(timezone,formatter);
    }
    return dayFormatters.get(timezone).format(new Date(time));
  }
  function shift(date, days) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
  function startFor(today, period, coverageStart) { return period === 'all' ? coverageStart || today : period === 'today' ? today : shift(today, 1 - Number(period)); }
  function series(rows, model, days, display, metric, coverageStart, observedDates = null) {
    return seriesByModel(rows, [model], days, display, metric, coverageStart, observedDates).get(model);
  }
  // The 30-day average is the mean of the recorded days among the last 30 calendar days,
  // the same rule as the overview's daily average: an unrecorded day is unknown, so it is
  // left out rather than counted as zero. Fewer than AVERAGE_MIN recorded days show nothing.
  const AVERAGE_MIN = 7;
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
      if (display === 'average') {
        const window = [];
        for (let date = shift(day, -29); date <= day; date = shift(date, 1)) if (date >= coverageStart && (!observedDates || observedDates.has(date))) window.push(date);
        return { day, window, covered: day >= coverageStart && window.length >= AVERAGE_MIN };
      }
      const window = [day];
      return { day, window, covered: day >= coverageStart && (display === 'total' || !observedDates || observedDates.has(day)) };
    });
    return new Map([...grouped].map(([model, { daily, observed }]) => {
      let running = 0, known = false;
      const values = new Map(plan.map(({ day, window, covered }) => {
        if (!covered) return [day, null];
        if (display === 'total') {
          if (daily.has(day)) { running += daily.get(day); known = true; }
          return [day, metric === 'cost' && !known ? null : running];
        }
        let sum = 0, priced = false, hasRows = false, knownDays = 0;
        // A recorded day without this series' rows is a known zero; rows whose value is
        // unknown (an unpriced cost) leave that day out of the average's count.
        for (const date of window) { sum += daily.get(date) || 0; priced ||= daily.has(date); hasRows ||= observed.has(date); if (daily.has(date) || !observed.has(date)) knownDays++; }
        if (metric === 'cost' && hasRows && !priced) return [day, null];
        if (display !== 'average') return [day, sum];
        return [day, knownDays >= AVERAGE_MIN ? sum / knownDays : null];
      }));
      return [model, days.map(day => values.get(day))];
    }));
  }
  function disjointMix(rows) {
    let completeTotalTokens = 0, completeCount = 0;
    let completeInputUncached = 0, completeOutput = 0, completeReasoning = 0, completeCacheRead = 0, completeCacheWrite = 0;
    let allTotalTokens = 0;
    let allInputUncached = 0, allOutput = 0, allReasoning = 0, allCacheRead = 0, allCacheWrite = 0;
    let hasNullInputUncached = false, hasNullOutput = false, hasNullReasoning = false, hasNullCacheRead = false, hasNullCacheWrite = false;
    let invalidReasoning = false;
    let observedInputUncached = 0, countInputUncached = 0;
    let observedOutputPlain = 0, countOutputPlain = 0;
    let observedCacheRead = 0, countCacheRead = 0;
    let observedCacheWrite = 0, countCacheWrite = 0;
    let observedReasoning = 0, countReasoning = 0;
    const partialValues = [false, false, false, false, false];

    for (const r of rows) {
      const u = r.inputUncached, o = r.output, cr = r.cacheRead, cw = r.cacheWrite, re = r.reasoning, tt = r.totalTokens || 0;
      allTotalTokens += tt;

      const isComplete = Number.isFinite(u) && Number.isFinite(o) && Number.isFinite(cr) && Number.isFinite(cw) && Number.isFinite(re) && re <= o && (u + o + cr + cw === tt);
      if (isComplete) {
        completeCount++;
        completeTotalTokens += tt;
        completeInputUncached += u;
        completeOutput += o;
        completeReasoning += re;
        completeCacheRead += cr;
        completeCacheWrite += cw;
      }

      if (u === null || u === undefined) hasNullInputUncached = true; else allInputUncached += u;
      if (o === null || o === undefined) hasNullOutput = true; else allOutput += o;
      if (re === null || re === undefined) hasNullReasoning = true; else allReasoning += re;
      if (cr === null || cr === undefined) hasNullCacheRead = true; else allCacheRead += cr;
      if (cw === null || cw === undefined) hasNullCacheWrite = true; else allCacheWrite += cw;
      if (re !== null && re !== undefined && o !== null && o !== undefined && re > o) invalidReasoning = true;

      const rec = r.records || 0;
      if (r.knownRecords) {
        if ((r.knownRecords.inputUncached ?? rec) < rec) partialValues[0] = true;
        if ((r.knownRecords.outputPlain ?? rec) < rec) partialValues[1] = true;
        if ((r.knownRecords.cacheRead ?? rec) < rec) partialValues[2] = true;
        if ((r.knownRecords.cacheWrite ?? rec) < rec) partialValues[3] = true;
        if ((r.knownRecords.reasoning ?? rec) < rec) partialValues[4] = true;

        if (r.knownRecords.inputUncached > 0) { countInputUncached++; observedInputUncached += (r.knownUsage?.inputUncached || 0); }
        if (r.knownRecords.outputPlain > 0) { countOutputPlain++; observedOutputPlain += (r.knownUsage?.outputPlain || 0); }
        if (r.knownRecords.cacheRead > 0) { countCacheRead++; observedCacheRead += (r.knownUsage?.cacheRead || 0); }
        if (r.knownRecords.cacheWrite > 0) { countCacheWrite++; observedCacheWrite += (r.knownUsage?.cacheWrite || 0); }
        if (r.knownRecords.reasoning > 0) { countReasoning++; observedReasoning += (r.knownUsage?.reasoning || 0); }
      }
    }

    const values = [
      completeInputUncached,
      completeOutput - completeReasoning,
      completeCacheRead,
      completeCacheWrite,
      completeReasoning
    ];

    const displayValues = [
      hasNullInputUncached ? (countInputUncached ? observedInputUncached : null) : allInputUncached,
      (hasNullOutput || hasNullReasoning || invalidReasoning) ? (countOutputPlain ? observedOutputPlain : null) : (allOutput - allReasoning),
      hasNullCacheRead ? (countCacheRead ? observedCacheRead : null) : allCacheRead,
      hasNullCacheWrite ? (countCacheWrite ? observedCacheWrite : null) : allCacheWrite,
      hasNullReasoning ? (countReasoning ? observedReasoning : null) : allReasoning
    ];
    if (hasNullInputUncached) partialValues[0] = true;
    if (hasNullOutput || hasNullReasoning || invalidReasoning) partialValues[1] = true;
    if (hasNullCacheRead) partialValues[2] = true;
    if (hasNullCacheWrite) partialValues[3] = true;
    if (hasNullReasoning) partialValues[4] = true;

    return {
      total: completeTotalTokens,
      values,
      displayValues,
      partialValues,
      incomplete: completeCount !== rows.length,
      coverage: allTotalTokens ? completeTotalTokens / allTotalTokens : null
    };
  }
  const api = { localDay, shift, startFor, series, seriesByModel, disjointMix, AVERAGE_MIN };
  if (typeof module === 'object') module.exports = api; else root.usageMath = api;
})(typeof window === 'object' ? window : null);
