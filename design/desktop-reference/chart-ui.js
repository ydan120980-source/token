'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.chartUi = factory();
})(typeof window === 'undefined' ? this : window, function () {
  // Coordinates are local to the plot, never fixed to the window.
  function positionTooltip(bounds, panel, point) {
    const margin = 8, gap = 14;
    const clamp = (value, max) => Math.max(margin, Math.min(value, max - margin));
    const right = point.x + gap;
    return {
      x: clamp(right + panel.width <= bounds.width - margin ? right : point.x - panel.width - gap, bounds.width - panel.width),
      y: clamp(point.y - panel.height / 2, bounds.height - panel.height)
    };
  }
  function tooltipSummary(points) {
    const known = points.filter(point => Number.isFinite(point.value));
    return {
      total: known.length ? known.reduce((sum, point) => sum + point.value, 0) : null,
      entries: known.filter(point => point.value > 0).sort((a, b) => b.value - a.value),
      zeroCount: known.filter(point => point.value === 0).length,
      unknownCount: points.length - known.length
    };
  }
  function bucketSeries(days, values, grain, display = 'daily') {
    const buckets = new Map();
    for (let i=0;i<days.length;i++) {
      const day = days[i];
      const date = new Date(day+'T12:00:00Z');
      if (grain === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay()+6)%7);
      const key = grain === 'month' ? day.slice(0,7)+'-01' : grain === 'week' ? date.toISOString().slice(0,10) : day;
      if (!buckets.has(key)) buckets.set(key,{label:key,values:[],start:day,end:day});
      const bucket = buckets.get(key); bucket.end = day; bucket.values.push(values[i]);
    }
    return [...buckets.values()].map(b=>{const known=b.values.filter(Number.isFinite);return {label:b.label,start:b.start,end:b.end,value:!known.length?null:display==='total'?b.values.at(-1):display==='average'?known.reduce((s,v)=>s+v,0)/known.length:known.reduce((s,v)=>s+v,0),partial:known.length<b.values.length};});
  }
  // A visual bridge may cross only unrecorded calendar dates. A recorded null
  // (unknown field/price) is a hard gap; no interpolation enters the ledger.
  function gapPlan(buckets, values, observedDates, coverageStart, display) {
    const blocked = [0];
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i]; let missing = display === 'daily' && bucket.start >= coverageStart;
      for (let day = bucket.start; missing && day <= bucket.end;) {
        if (observedDates.has(day)) missing = false;
        const date = new Date(day + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + 1); day = date.toISOString().slice(0,10);
      }
      blocked.push(blocked[i] + Number(!Number.isFinite(values[i]) && !missing));
    }
    return blocked;
  }
  function segmentKind(left, right, blocked, values = null) {
    const start = Math.min(left, right), end = Math.max(left, right);
    const gap = end - start > 1 || values && (!Number.isFinite(values[start]) || !Number.isFinite(values[end]));
    return !gap ? 'recorded' : blocked[end + 1] - blocked[start] > 0 ? 'unknown' : 'bridge';
  }
  return { positionTooltip, tooltipSummary, bucketSeries, gapPlan, segmentKind };
});
