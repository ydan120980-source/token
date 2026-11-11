'use strict';
// Explicit inputs and in-memory output only. Callers own persistence and caches.
const {add}=require('./aggregate');
const registry=require('./source-registry');
const {localDay}=require('./usage-math');
const day=(time,timezone)=>localDay(timezone,time);
const hourFormatters = new Map();
const semantics=Object.freeze({inputUncached:'excludes-cache',reasoning:'subset-of-output',totalTokens:'non-overlapping-source-total'});
const mapFields=['pricingReasons','unpricedTokens','incompleteTokens','knownUsage','knownRecords','costParts'];
function hourOf(time, timezone) { if (!hourFormatters.has(timezone)) { const formatter=new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }); if(hourFormatters.size>=8)hourFormatters.delete(hourFormatters.keys().next().value);hourFormatters.set(timezone,formatter); } return Number(hourFormatters.get(timezone).format(new Date(time))); }
function projectUsage({records,estimate:estimateRecord,sequence,updatedAt,deviceId,sourceCatalog,priceCatalog,statuses={},recovered=[],timezone,now}) {
  const today=day(now,timezone);
    // Hourly rows cover the whole history: single-day trends and the weekday x hour view.
    const groups = new Map(), hourGroups = new Map(), singleHours = new Map(), calendar = new Map();
    for (const record of records) {
      // Several messages commonly share an exact source timestamp. Reuse only
      // that exact conversion: no hour/day bucketing that could cross DST or a
      // half-hour timezone boundary. The per-projection cache is bounded.
      let stamp = calendar.get(record.timestamp);
      if(!stamp){stamp={date:day(record.timestamp,timezone),hour:hourOf(record.timestamp,timezone)};if(calendar.size<4096)calendar.set(record.timestamp,stamp);}
      const {date,hour} = stamp;
      const estimate = estimateRecord(record);
      const identity = [record.agent, record.entry, record.provider, record.model];
      const dailyKey=JSON.stringify([date,...identity]),hourKey=JSON.stringify([date,hour,...identity]);
      add(hourGroups,hourKey,{date,hour},record,estimate);
      // A daily group confined to one hour is the same aggregate. Keep one
      // mutable accumulator until a second hour actually requires a separate
      // day total, avoiding duplicate counter maps and additions.
      if(!groups.has(dailyKey)){groups.set(dailyKey,hourGroups.get(hourKey));singleHours.set(dailyKey,hour);}
      else if(!singleHours.has(dailyKey))add(groups,dailyKey,{date},record,estimate);
      else if(singleHours.get(dailyKey)!==hour){
        const previous=groups.get(dailyKey),daily={...previous};delete daily.hour;
        for(const field of mapFields)daily[field]={...previous[field]};
        groups.set(dailyKey,daily);singleHours.delete(dailyKey);add(groups,dailyKey,{date},record,estimate);
      }
    }
    const daily = [...groups.values()].map(row=>{if(!Object.hasOwn(row,'hour'))return row;const value={...row};delete value.hour;return value;}).sort((a, b) => a.date.localeCompare(b.date));
    const hourly = [...hourGroups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
    // Repeated counter maps are immutable read-model facts. Share common values
    // within this projection; a bounded pool does not retain old revisions.
    const pools=Object.fromEntries(mapFields.map(field=>[field,new Map()]));
    for (const row of [...daily, ...hourly]) {
      if (!row.pricedRecords) { row.estimatedCostUsd = null; row.estimatedCostUpperUsd = null; row.costParts = null; row.cacheSavingsUsd = null; }
      row.semantics=semantics;
      for(const field of mapFields){const value=row[field];if(value===null)continue;const key=JSON.stringify(value),pool=pools[field];if(pool.has(key))row[field]=pool.get(key);else if(pool.size<128)pool.set(key,Object.freeze(value));}
    }
    return {
      schemaVersion: 'UsageSnapshotV1', deviceId: deviceId, sequence: sequence,
      collectedAt: updatedAt || null, generatedAt: new Date(now).toISOString(), timezone, today,
      coverageStart: daily[0]?.date || null, daily, hourly,
      priceCatalog,
      sourceCatalog:sourceCatalog, catalogRevision:registry.revision(sourceCatalog),
      sources: Object.keys(sourceCatalog).map(agent => statuses[agent] || { agent, label: sourceCatalog[agent]?.label, status: 'unverified', lastSuccess: null, realSampleVerified: false }),
      deferred: [{ agent: 'trae', status: 'variant-and-connection-unverified' }],
      recovered: (recovered || []).map(entry => ({ ...entry }))
    };
}
module.exports={projectUsage,day};
