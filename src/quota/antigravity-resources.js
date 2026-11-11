'use strict';
const { createHash } = require('node:crypto');
const { projectResources, instant, identifier, text } = require('./resource-contract');
const { MAX_OUTPUT_BYTES, supportedVersion, version } = require('./antigravity-command');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => { throw new Error(code); };
const COUNTERS = ['input_tokens', 'output_tokens', 'thinking_tokens', 'cache_read_tokens', 'total_tokens'];
function modelTurn(value) {
  if (!record(value)) return false;
  return typeof value.num_turns === 'number' && value.num_turns > 0 || typeof value.conversation_id === 'string' && value.conversation_id.length > 0 || record(value.usage) && Object.values(value.usage).some(v => typeof v === 'number' && v > 0);
}
function envelopes(stdout) {
  if (typeof stdout !== 'string') fail('AGY_PROTOCOL_INVALID');
  if (Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT_BYTES) fail('AGY_OUTPUT_LIMIT');
  // Whole JSON is preferred. NDJSON may contain harmless non-JSON startup logs;
  // inspect every JSON record, including records after a valid quota response.
  const trimmed = stdout.trim();
  try { return [JSON.parse(trimmed)]; } catch { /* Try line-delimited records. */ }
  const result = [];
  for (const line of trimmed.split('\n')) {
    const value = line.trim();
    if (!value.startsWith('{') && !value.startsWith('[')) continue;
    try { result.push(JSON.parse(value)); } catch { fail('AGY_PROTOCOL_INVALID'); }
  }
  if (!result.length) fail('AGY_PROTOCOL_INVALID');
  return result;
}
function fromAntigravity(stdout, fetchedAt, cliVersion) {
  if (!supportedVersion(cliVersion)) fail('AGY_VERSION_UNSUPPORTED');
  if (!instant(fetchedAt)) fail('AGY_PROTOCOL_INVALID');
  const records = envelopes(stdout);
  if (records.some(modelTurn)) fail('AGY_MODEL_TURN_DETECTED');
  if (records.some(v => !record(v))) fail('AGY_PROTOCOL_INVALID');
  if (records.some(v => Object.hasOwn(v, 'num_turns') && v.num_turns !== 0 || Object.hasOwn(v, 'conversation_id') && v.conversation_id !== '')) fail('AGY_NO_TURN_UNVERIFIED');
  if (records.some(v => Object.hasOwn(v, 'status') && v.status !== 'SUCCESS')) fail('AGY_REQUEST_FAILED');
  const replies = records.filter(v => record(v) && v.command?.name === 'usage');
  if (replies.length !== 1) fail('AGY_PROTOCOL_INVALID');
  const reply = replies[0];
  if (reply.status !== 'SUCCESS') fail('AGY_REQUEST_FAILED');
  // A command name alone cannot prove that the CLI avoided inference.
  if (reply.num_turns !== 0 || reply.conversation_id !== '' || !record(reply.usage) || COUNTERS.some(key => reply.usage[key] !== 0) || Object.values(reply.usage).some(v => v !== 0)) fail('AGY_NO_TURN_UNVERIFIED');
  const data = reply.command.data;
  if (!record(data) || !Array.isArray(data.groups) || data.groups.length > 100 || data.partial === true || data.has_more === true || Object.hasOwn(data, 'next_page_token') && data.next_page_token !== null && data.next_page_token !== '') fail('AGY_PROTOCOL_INVALID');
  const ids = new Set(), pools = [];
  let count = 0;
  for (const group of data.groups) {
    if (!record(group) || !text(group.name) || group.partial === true || group.has_more === true || !Array.isArray(group.buckets) || !group.buckets.length || (count += group.buckets.length) > 200) fail('AGY_PROTOCOL_INVALID');
    const windows = group.buckets.map(bucket => {
      if (!record(bucket) || !identifier(bucket.id) || ids.has(bucket.id) || bucket.disabled !== undefined && typeof bucket.disabled !== 'boolean') fail('AGY_PROTOCOL_INVALID');
      ids.add(bucket.id);
      const fraction = bucket.remaining_fraction;
      const valid = typeof fraction === 'number' && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1;
      const issues = fraction !== undefined && fraction !== null && !valid ? ['INVALID_PERCENT'] : [];
      return { id: bucket.id, label: text(bucket.name) || text(bucket.window), unit: 'percent', role: 'other', cadence: 'unknown',
        durationMins: bucket.window === 'weekly' ? 10080 : bucket.window === '5h' ? 300 : null,
        usedPercent: valid ? (1 - fraction) * 100 : null, resetsAt: bucket.reset_time,
        availability: bucket.disabled === true ? 'disabled' : 'unknown', requiresEntitlement: true, issues };
    });
    // The protocol has bucket IDs but no stable group ID. Use the bucket set;
    // labels/order never bind accounts or split Claude and GPT into new pools.
    const id = 'group:' + createHash('sha256').update(JSON.stringify(windows.map(w => w.id).sort())).digest('hex');
    pools.push({ id, label: group.name, scope: 'unknown', modelIds: [], windows, balances: [] });
  }
  const quota = projectResources({ schemaVersion: 'AccountQuotaV2', provider: 'antigravity', fetchedAt, provenance: { kind: 'official-cli', version: version(cliVersion) },
    entitlement: { state: 'unknown', observedAt: fetchedAt }, pools });
  if (!quota) fail('AGY_PROTOCOL_INVALID');
  return quota;
}
module.exports = { fromAntigravity, envelopes, modelTurn };
