'use strict';
// The design server accepts only this statistics whitelist, never a raw Store state.
const sourceTypes = new Set(require('./agent-catalog').sources);
const sourceErrors = new Set(['SOURCE_USAGE_REGRESSION','SOURCE_USAGE_CONFLICT','SOURCE_PATH_REJECTED','SOURCE_LIMIT','SOURCE_UNREADABLE','SOURCE_SYMLINK_REJECTED','SOURCE_ALIAS_REJECTED','SOURCE_SIZE_OR_LINK','SOURCE_BUSY','SOURCE_TIMEOUT','SOURCE_PARSE_FAILED','SOURCE_ROW_INVALID','USAGE_UNREPORTED','DATABASE_FORMAT_UNSUPPORTED','DATABASE_SCHEMA_UNSUPPORTED','WAL_HEADER_INVALID','WAL_PAGE_INVALID','WAL_CHECKSUM_INVALID','WAL_SIZE_LIMIT','DEEPSEEK_FORMAT_UNSUPPORTED','DEEPSEEK_SEED_INVALID','DEEPSEEK_ENCODING_CONFLICT','DEEPSEEK_LOG_INCOMPLETE','SOURCE_COMPRESSION_UNSUPPORTED','SOURCE_COMPRESSION_INVALID','CURSOR_CSV_INVALID','CURSOR_CSV_SCHEMA','CURSOR_SOURCE_MODE_CONFLICT']);
const fields = ['totalTokens', 'inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'records', 'pricedTokens', 'estimatedCostUsd', 'partialRecords'];
function text(value, fallback = null) { return typeof value === 'string' && value.length <= 180 ? value : fallback; }
function count(value, nullable = true) { if (value === null && nullable) return null; if (!Number.isFinite(value) || value < 0) throw new Error('INVALID_STATISTIC'); return value; }
function selectSnapshot(snapshot) {
  if (!['UsageSnapshotV1', 'LocalUsagePreviewV1'].includes(snapshot?.schemaVersion) || !Array.isArray(snapshot.daily) || snapshot.daily.length > 100000) throw new Error('INVALID_USAGE_SNAPSHOT');
  if (snapshot.hourly !== undefined && (!Array.isArray(snapshot.hourly) || snapshot.hourly.length > 50000)) throw new Error('INVALID_USAGE_SNAPSHOT');
  const select = (row, hourly) => {
    if (!sourceTypes.has(row.agent) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || hourly && !(Number.isInteger(row.hour) && row.hour >= 0 && row.hour <= 23)) throw new Error('INVALID_USAGE_ROW');
    const selected = { date: row.date, ...(hourly ? { hour: row.hour } : {}), agent: row.agent, entry: ['desktop', 'cli', 'sdk', 'export', 'harness'].includes(row.entry) ? row.entry : 'unknown', provider: text(row.provider, 'unknown'), model: text(row.model, '模型未记录') };
    for (const field of fields) selected[field] = count(row[field] === undefined ? field === 'partialRecords' ? 0 : null : row[field], !['totalTokens', 'records', 'pricedTokens', 'partialRecords'].includes(field));
    selected.estimatedCostUpperUsd = count(row.estimatedCostUpperUsd ?? row.estimatedCostUsd ?? null);
    selected.boundedTokens = count(row.boundedTokens ?? 0, false);
    selected.pricingReasons = Object.fromEntries(Object.entries(row.pricingReasons || {}).filter(([key, value]) => ['exact', 'long-context', 'cache-write-unreported', 'model-unpriced', 'price-unverified', 'usage-incomplete', 'rate-missing', 'context-unreported', 'reasoning-unreported', 'time-tariff-unreported'].includes(key) && Number.isSafeInteger(value) && value > 0));
    for (const name of ['knownUsage', 'knownRecords']) selected[name] = Object.fromEntries(Object.entries(row[name] || {}).filter(([key, value]) => ['inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'outputPlain'].includes(key) && Number.isFinite(value) && value >= 0));
    return selected;
  };
  const daily = snapshot.daily.map(row => select(row, false)), hourly = (snapshot.hourly || []).map(row => select(row, true));
  const sources = (snapshot.sources || []).filter(s => sourceTypes.has(s.agent)).map(s => ({ agent: s.agent, status: ['verified', 'partial', 'unverified', 'not-detected', 'error'].includes(s.status) ? s.status : 'unverified', realSampleVerified: s.realSampleVerified === true, errors: (Array.isArray(s.errors) ? s.errors : []).filter(v => sourceErrors.has(v)).slice(0, 12), lastSuccess: text(s.lastSuccess), observedRecords: Number.isFinite(s.observedRecords) ? Math.max(0, s.observedRecords) : 0, qualityIssues: Object.fromEntries(Object.entries(s.qualityIssues || {}).filter(([key, value]) => /^[a-z-]+$/.test(key) && Number.isSafeInteger(value) && value > 0)) }));
  return { schemaVersion: 'LocalUsagePreviewV1', sourceSchemaVersion: 'UsageSnapshotV1', sequence: count(snapshot.sequence, false), collectedAt: text(snapshot.collectedAt), timezone: text(snapshot.timezone, 'Asia/Shanghai'), today: /^\d{4}-\d{2}-\d{2}$/.test(snapshot.today) ? snapshot.today : null, coverageStart: daily.map(r => r.date).sort()[0] || null, daily, hourly, sources, priceCatalog: { version: text(snapshot.priceCatalog?.version, 'unknown'), obtainedAt: text(snapshot.priceCatalog?.obtainedAt), sha256: text(snapshot.priceCatalog?.sha256), overrideSha256: text(snapshot.priceCatalog?.overrideSha256), billingSha256: text(snapshot.priceCatalog?.billingSha256), source: text(snapshot.priceCatalog?.source), basis: text(snapshot.priceCatalog?.basis), currency: 'USD', kind: 'API-equivalent-estimate' } };
}
module.exports = { selectSnapshot };
