'use strict';
// Antigravity (Google) local conversations, under each product's directory:
//   <product>/brain/<conversation>/.system_generated/logs/transcript_full.jsonl
//   <product>/conversations/<conversation>.db
//   <product>/conversation_summaries.db
// Usage per model call comes from the transcript's PLANNER_RESPONSE rows: uncached
// input, output and cache reads, as disjoint buckets. The transcript carries no
// model; the conversation database records one generation per call (gen_metadata,
// ordered by idx), whose field 1.19 is the model ID. Only that field is decoded.
// The working directory is the conversation's single workspace URI in the summary
// database; only conversation_id and workspace_uris are read there.
// Contract: AGENT-INTEGRATION-CONTRACT-20261005.md, section "Antigravity".
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const sessions = require('./sessions');
const { normalize, number } = require('./normalize');
const { readDatabase, query } = require('./sqlite-memory');
const FULL = 'transcript_full.jsonl', PLAIN = 'transcript.jsonl';
const ENTRY = { antigravity: 'desktop', 'antigravity-ide': 'desktop', 'antigravity-cli': 'cli' };
function locate(file) {
  const conversation = path.dirname(path.dirname(path.dirname(file))), product = path.dirname(path.dirname(conversation));
  return { id: path.basename(conversation), product: path.basename(product), database: path.join(product, 'conversations', path.basename(conversation) + '.db'), summaries: path.join(product, 'conversation_summaries.db') };
}
// Both transcripts list the same model calls; the full one is read when present.
function canonical(files) {
  const listed = new Set(files);
  return files.filter(file => !(path.basename(file) === PLAIN && listed.has(path.join(path.dirname(file), FULL))));
}
function allowed(file) {
  const parts = file.split(path.sep);
  return [FULL, PLAIN].includes(parts.at(-1)) && parts.at(-2) === 'logs' && parts.at(-3) === '.system_generated' && parts.at(-5) === 'brain';
}
// Protocol buffer wire format: field number -> values (varints as numbers,
// length-delimited fields as bytes). Malformed input throws.
function message(bytes) {
  const fields = new Map(); let i = 0;
  const varint = () => { let value = 0, scale = 1; for (let n = 0; n < 10; n++) { if (i >= bytes.length) throw new Error('ANTIGRAVITY_METADATA_INVALID'); const byte = bytes[i++]; value += (byte & 127) * scale; if (!(byte & 128)) return value; scale *= 128; } throw new Error('ANTIGRAVITY_METADATA_INVALID'); };
  while (i < bytes.length) {
    const key = varint(), field = Math.floor(key / 8), wire = key % 8; let value;
    if (wire === 0) value = varint();
    else if (wire === 2) { const length = varint(); if (i + length > bytes.length) throw new Error('ANTIGRAVITY_METADATA_INVALID'); value = bytes.subarray(i, i + length); i += length; }
    else if (wire === 1 || wire === 5) { i += wire === 1 ? 8 : 4; continue; }
    else throw new Error('ANTIGRAVITY_METADATA_INVALID');
    if (!fields.has(field)) fields.set(field, []);
    fields.get(field).push(value);
  }
  if (i !== bytes.length) throw new Error('ANTIGRAVITY_METADATA_INVALID');
  return fields;
}
// The model ID of a generation; undefined for a well-formed generation without one
// (a failed attempt such as 429 RESOURCE_EXHAUSTED), null when the row cannot be decoded.
function modelOf(blob) {
  try {
    const generation = message(blob).get(1)?.[0];
    if (!(generation instanceof Uint8Array)) return null;
    const name = message(generation).get(19)?.[0];
    return name instanceof Uint8Array ? Buffer.from(name).toString('utf8') : undefined;
  } catch { return null; }
}
// One model per recorded generation, in call order; null when the database is
// missing or unreadable. Failed attempts are left out; an undecodable row stays in
// the list so the counts disagree instead of shifting every later pairing.
async function models(file, audit) {
  const { database } = locate(file);
  if (!fs.existsSync(database)) return null;
  try { return await readDatabase(database, audit, db => query(db, 'SELECT data FROM gen_metadata ORDER BY idx').map(row => modelOf(Buffer.from(row.data))).filter(name => name !== undefined)); }
  catch { return null; }
}
// The conversation's working directory, or null when there is not exactly one local
// file URI for it.
// The conversation's working directory and its own title from conversation_summaries;
// the preview column is never read.
async function workspace(file, audit) {
  const { id, summaries } = locate(file), none = { cwd: null, title: null };
  if (!/^[\w-]{1,80}$/.test(id) || !fs.existsSync(summaries)) return none;
  try {
    const rows = await readDatabase(summaries, audit, db => { const columns = new Set(query(db, 'PRAGMA table_info("conversation_summaries")').map(row => row.name)); return query(db, "SELECT workspace_uris" + (columns.has('title') ? ', title' : '') + " FROM conversation_summaries WHERE conversation_id = '" + id + "'"); });
    if (rows.length !== 1) return none;
    let cwd = null;
    try { const uris = JSON.parse(rows[0].workspace_uris); cwd = Array.isArray(uris) && uris.length === 1 && typeof uris[0] === 'string' && uris[0].startsWith('file:///') ? fileURLToPath(uris[0]) : null; } catch { cwd = null; }
    return { cwd, title: typeof rows[0].title === 'string' ? rows[0].title : null };
  } catch { return none; }
}
async function parse(objects, file, salt, audit) {
  const { id, product } = locate(file);
  const calls = objects.filter(row => row && typeof row === 'object' && row.type === 'PLANNER_RESPONSE' && number(row.input_tokens) !== null && Number.isSafeInteger(row.step_index)).sort((a, b) => a.step_index - b.step_index);
  const names = calls.length ? await models(file, audit) : null;
  // Calls and generations pair by position only when both lists have the same
  // length; otherwise no call gets a model rather than possibly the wrong one. A
  // call still in flight (in the transcript before its generation is committed)
  // pairs on the next scan, because a database change re-reads the transcript.
  const paired = Array.isArray(names) && names.length === calls.length;
  const records = calls.flatMap((call, index) => {
    const record = normalize('antigravity', { input_tokens: call.input_tokens, output_tokens: call.output_tokens, cached_input_tokens: call.cache_read_tokens },
      { id: id + ':' + call.step_index, session: id, model: paired && names[index] ? names[index] : 'unknown', time: call.created_at, entry: ENTRY[product] || 'unknown' }, salt, 'exclusive');
    return record ? [record] : [];
  });
  if (calls.length && !paired) records.warnings = ['ANTIGRAVITY_MODEL_UNPAIRED'];
  const place = calls.length ? await workspace(file, audit) : null, entry = place ? sessions.observe('antigravity', id, place.cwd, salt, place.title) : null;
  records.sessions = entry ? [entry] : [];
  return records;
}
module.exports = { allowed, canonical, companions: file => { const { database, summaries } = locate(file); return [database, summaries]; }, message, parse };
