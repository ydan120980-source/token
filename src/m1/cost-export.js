'use strict';
// The cost page's CSV, rebuilt from the main process's own statistics snapshot. The
// window names only the grouping and the date windows; every number and name in the
// file comes from the snapshot, never from the request.
const costTable = require('./cost-table');
const { agents } = require('./agent-catalog');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function window(from, to) {
  if (from === null && to === null) return null;
  if (typeof from !== 'string' || typeof to !== 'string' || !DATE.test(from) || !DATE.test(to) || from > to) throw new Error('EXPORT_REJECTED');
  return { from, to };
}
function costExport(snapshot, request) {
  if (!request || typeof request !== 'object' || !['model', 'agent'].includes(request.by)) throw new Error('EXPORT_REJECTED');
  const range = window(request.from ?? null, request.to ?? null), previous = window(request.previousFrom ?? null, request.previousTo ?? null);
  const inside = span => row => !span || row.date >= span.from && row.date <= span.to;
  const daily = Array.isArray(snapshot?.daily) ? snapshot.daily : [];
  const items = costTable.table(daily.filter(inside(range)), { by: request.by, previousRows: previous ? daily.filter(inside(previous)) : null });
  const label = range ? (range.from === range.to ? range.from : range.from + ' 至 ' + range.to) : '累计';
  const csv = costTable.csv(items, { by: request.by, range: label, agentName: id => snapshot.sourceCatalog?.[id]?.name || agents[id]?.name || id, modelName: model => model === 'unknown' ? '模型未记录' : model });
  return { csv, rows: items.length, fileName: 'AgentUsage-cost-' + (range ? range.from + '_' + range.to : 'all') + '.csv' };
}
module.exports = { costExport };
