'use strict';

/**
 * Regenerate the built-in price catalog (src/m1/prices.json) from an OpenAI
 * pricing snapshot that is already on disk.
 *
 *   fetch (human / CI)  ->  research/agent-usage/pricing/openai-pricing-20261004.md  ->  src/m1/prices.json
 *
 * The fetch step is deliberately outside this script: the catalog is built from
 * a reviewed snapshot, so the running application never needs the network, and a
 * regeneration is reproducible from the exact bytes that were reviewed.
 *
 * Guarantees:
 *   - no network: only node:fs / node:path / node:crypto are required
 *   - the source snapshot hash is recorded, so the catalog can be traced back
 *   - a table is read only when its header row matches a known signature
 *     exactly; every other table is ignored rather than guessed at
 *   - every value must parse; one unreadable cell aborts before anything is
 *     written
 *   - non-openai entries are carried over byte-identical, including their own
 *     provenance, so regenerating can never silently re-price another provider
 *
 * Usage:
 *   node scripts/m1/pricing-sync.js [--source <md>] [--out <json>]
 *     [--date YYYY-MM-DD] [--obtained-at <ISO>] [--check] [--dry-run] [--quiet]
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_URL = 'https://developers.openai.com/api/docs/pricing';
const BASIS = 'Current Standard API equivalent; no invoice, historical tier, tool fees or subscription cost';
const PROVIDER = 'openai';
const FIELDS = ['inputUncached', 'cacheRead', 'cacheWrite', 'output'];
const DEFAULT_SOURCE = path.join('research', 'agent-usage', 'pricing', 'openai-pricing-20261004.md');
const DEFAULT_OUT = path.join('src', 'm1', 'prices.json');

/** Flagship tables: short-context rates then the long-context rates used above 272K request tokens. */
const FLAGSHIP_HEADER = ['Model', 'Short context input', 'Short context cached input', 'Short context cache writes', 'Short context output', 'Long context input', 'Long context cached input', 'Long context cache writes', 'Long context output'];
/** Specialized tables: one Standard-equivalent rate set, no long context, no cache-write price. */
const SPECIALIZED_HEADER = ['Category', 'Model', 'Input', 'Cached input', 'Output'];
/**
 * Section headings whose flagship tables are catalog sources. Both are published
 * as current Standard-equivalent list prices: the flagship table and the
 * Cyber/Daybreak table. Batch / Flex / Fast / Ultrafast are separate tiers and
 * are never used as the basis.
 */
const FLAGSHIP_SECTIONS = ['standard pricing data', 'grouped pricing table data'];
/** Specialized categories that bill per token for chat usage; the rest are not token-priced. */
const BILLABLE_CATEGORIES = new Set(['Codex', 'ChatGPT', 'Search', 'Life Sciences']);
/** Tier labels that may precede a table inside a section that repeats per tier. */
const TIERS = ['Standard', 'Batch', 'Flex', 'Fast', 'Ultrafast'];
/** Trailing annotations that are not part of the model identifier. */
const ANNOTATION = /\s*\([^)]*\)\s*$/;
/** Model names OpenAI does not price on their own; they are billed at the base model rates. */
const ALIASES = [
  { alias: 'gpt-5.1-codex', base: 'gpt-5.1' },
  { alias: 'gpt-5.1-codex-max', base: 'gpt-5.1' },
  { alias: 'gpt-5.1-codex-mini', base: 'gpt-5-mini' },
  { alias: 'gpt-5.2-codex', base: 'gpt-5.2' }
];

function fail(message) { throw new Error(message); }
function cells(line) { return line.slice(1, -1).split('|').map(cell => cell.trim()); }
function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/** `$5.00` -> 5, `-` -> null, `Free` -> 0. Anything else is a hard error. */
function money(text, context) {
  const value = String(text).trim();
  if (value === '-' || value === '') return null;
  if (/^free$/i.test(value)) return 0;
  const match = /^\$([0-9][0-9,]*(?:\.[0-9]+)?)$/.exec(value);
  if (!match) fail('PRICING_SOURCE_UNREADABLE: ' + context + ' -> ' + JSON.stringify(value));
  return Number(match[1].replace(/,/g, ''));
}

/** USD per million tokens -> USD per token, `null` meaning "not published". */
function scaled(rates) { return Object.fromEntries(FIELDS.map(field => [field, rates[field] === null ? null : rates[field] / 1e6])); }

/** The `### ...` heading a table sits under, lowercased. */
function headingOf(lines, index) {
  for (let i = index - 1; i >= 0 && i >= index - 12; i--) {
    const heading = /^###\s+(.+?)\s*$/.exec(lines[i]);
    if (heading) return heading[1].toLowerCase();
  }
  return 'unknown';
}

/**
 * Every markdown table that starts with `Model` or `Category`, together with
 * the section heading above it and the tier label in force at that point (some
 * sections repeat the same table once per tier).
 */
function tables(lines) {
  const found = [];
  let label = 'unknown';
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (TIERS.includes(trimmed)) label = trimmed;
    const header = cells(lines[i]);
    if (!['Model', 'Category'].includes(header[0])) continue;
    if (!/^\|[\s:|-]+\|$/.test((lines[i + 1] || '').trim())) continue;
    const rows = [];
    let j = i + 2;
    while (j < lines.length && lines[j].startsWith('|')) {
      const row = cells(lines[j]);
      if (row.length === header.length) rows.push({ row, line: j + 1 });
      j++;
    }
    found.push({ header, rows, line: i + 1, label, heading: headingOf(lines, i) });
    i = j - 1;
  }
  return found;
}

/** Flagship rows: short-context rates plus the optional long-context rates. */
function flagship(table, markdown) {
  const entries = {};
  for (const { row, line } of table.rows) {
    const name = row[0].replace(ANNOTATION, '');
    if (name === '') continue;
    const at = markdown + ':' + line + ' (' + name + ')';
    const short = { inputUncached: money(row[1], at), cacheRead: money(row[2], at), cacheWrite: money(row[3], at), output: money(row[4], at) };
    const long = { inputUncached: money(row[5], at), cacheRead: money(row[6], at), cacheWrite: money(row[7], at), output: money(row[8], at) };
    if (short.inputUncached === null || short.output === null) fail('PRICING_SOURCE_INCOMPLETE: ' + at);
    const hasLong = FIELDS.some(field => long[field] !== null);
    if (hasLong && (long.inputUncached === null || long.output === null)) fail('PRICING_SOURCE_INCOMPLETE: long context ' + at);
    entries[PROVIDER + '/' + name] = { ...scaled(short), source: SOURCE_URL, provenance: 'official-current-standard', ...(hasLong ? { longContext: scaled(long) } : {}) };
  }
  return entries;
}

/** Specialized rows: one Standard-equivalent rate set; other fields stay unknown. */
function specialized(table, markdown, notes) {
  const entries = {};
  for (const { row, line } of table.rows) {
    const [category, name] = [row[0], row[1]];
    if (!BILLABLE_CATEGORIES.has(category)) { notes.push('skipped ' + category + ' row ' + name); continue; }
    const at = markdown + ':' + line + ' (' + name + ')';
    const rates = { inputUncached: money(row[2], at), cacheRead: money(row[3], at), cacheWrite: null, output: money(row[4], at) };
    if (rates.inputUncached === null || rates.output === null) fail('PRICING_SOURCE_INCOMPLETE: ' + at);
    entries[PROVIDER + '/' + name] = { ...scaled(rates), source: SOURCE_URL, provenance: 'official-current-standard' };
  }
  return entries;
}

/**
 * Record a parsed entry. The same model legitimately appears in more than one
 * flagship table (the Cyber section repeats its Standard rows); identical rows
 * collapse, conflicting rows abort instead of silently picking a winner.
 */
function claim(entries, key, row) {
  const existing = entries[key];
  if (!existing) { entries[key] = row; return; }
  if (!same(existing, row)) fail('PRICING_SOURCE_CONFLICT: ' + key + ' ' + JSON.stringify(existing) + ' vs ' + JSON.stringify(row));
}

/** Parse a snapshot into model entries plus a report of what was read and skipped. */
function parseSnapshot(markdown, notes = []) {
  const lines = markdown.split(/\r?\n/);
  const entries = {}, skipped = [];
  for (const table of tables(lines)) {
    const signature = table.header.join(' | ');
    if (same(table.header, FLAGSHIP_HEADER)) {
      if (!FLAGSHIP_SECTIONS.includes(table.heading)) { skipped.push(signature + ' (line ' + table.line + ', ' + table.heading + ')'); continue; }
      for (const [key, row] of Object.entries(flagship(table, markdown))) claim(entries, key, row);
    } else if (same(table.header, SPECIALIZED_HEADER)) {
      if (table.label !== 'Standard') { skipped.push(signature + ' (line ' + table.line + ', ' + table.label + ')'); continue; }
      for (const [key, row] of Object.entries(specialized(table, markdown, notes))) claim(entries, key, row);
    } else {
      skipped.push(signature + ' (line ' + table.line + ', ' + table.heading + ')');
    }
  }
  return { entries, skipped };
}

/** Codex model names aliased onto the base model OpenAI actually prices. */
function aliases(entries) {
  const result = {};
  for (const { alias, base } of ALIASES) {
    const parent = entries[PROVIDER + '/' + base];
    if (!parent) fail('PRICING_ALIAS_UNKNOWN: ' + alias + ' -> ' + base);
    result[PROVIDER + '/' + alias] = {
      ...Object.fromEntries(FIELDS.map(field => [field, parent[field]])),
      ...(parent.longContext ? { longContext: parent.longContext } : {}),
      source: SOURCE_URL.replace(/\/pricing$/, '/models/' + alias),
      provenance: 'official-current-standard',
      aliasOf: base
    };
  }
  return result;
}

/**
 * Assemble the catalog: non-openai entries keep their position and their bytes,
 * the openai block is rebuilt in place at the position it already occupied.
 */
function build({ previous, markdown, date, obtainedAt }) {
  const notes = [];
  const parsed = parseSnapshot(markdown, notes);
  const openai = { ...parsed.entries, ...aliases(parsed.entries) };
  const carried = Object.entries(previous.models || {}).filter(([key]) => !key.startsWith(PROVIDER + '/'));
  const models = {};
  let placed = false;
  for (const [key, value] of Object.entries(previous.models || {})) {
    if (key.startsWith(PROVIDER + '/')) { if (!placed) { Object.assign(models, openai); placed = true; } continue; }
    models[key] = value;
  }
  if (!placed) Object.assign(models, openai);
  for (const [key, value] of carried) {
    if (!same(models[key], value)) fail('PRICING_CARRYOVER_DRIFT: ' + key);
  }
  if (Object.keys(models).length !== carried.length + Object.keys(openai).length) fail('PRICING_CATALOG_LENGTH: ' + Object.keys(models).length);
  const catalog = {
    version: 'official-review-' + date, obtainedAt, source: SOURCE_URL, sourceSha256: sha256(markdown), basis: BASIS,
    // Which published tier the rates below are, and which other tiers the source
    // lists but this catalog deliberately does not use as its basis.
    tiers: { basis: 'standard', available: ['standard', 'batch', 'flex', 'fast', 'ultrafast'], longContextThreshold: 272000, currency: 'USD', unit: 'per-million-tokens' },
    models, sha256: sha256(JSON.stringify(models))
  };
  return { catalog, notes: notes.concat(parsed.skipped.map(entry => 'ignored ' + entry)) };
}

function parseArgs(argv) {
  const options = { source: DEFAULT_SOURCE, out: DEFAULT_OUT, date: new Date().toISOString().slice(0, 10), obtainedAt: null, check: false, dryRun: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--source') options.source = argv[++i];
    else if (flag === '--out') options.out = argv[++i];
    else if (flag === '--date') options.date = argv[++i];
    else if (flag === '--obtained-at') options.obtainedAt = argv[++i];
    else if (flag === '--check') options.check = true;
    else if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--quiet') options.quiet = true;
    else fail('PRICING_ARGUMENT_UNKNOWN: ' + flag);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) fail('PRICING_ARGUMENT_DATE: ' + options.date);
  if (options.obtainedAt !== null && Number.isNaN(Date.parse(options.obtainedAt))) fail('PRICING_ARGUMENT_OBTAINED_AT: ' + options.obtainedAt);
  return options;
}

function summary(catalog, previous) {
  const counts = { total: 0, openai: 0, alias: 0, longContext: 0 };
  for (const [key, value] of Object.entries(catalog.models)) {
    counts.total += 1;
    if (key.startsWith(PROVIDER + '/')) counts.openai += 1;
    if (value.aliasOf) counts.alias += 1;
    if (value.longContext) counts.longContext += 1;
  }
  const before = new Set(Object.keys(previous.models || {})), after = new Set(Object.keys(catalog.models));
  return { counts, added: [...after].filter(key => !before.has(key)), removed: [...before].filter(key => !after.has(key)) };
}

function main(argv) {
  const options = parseArgs(argv);
  const markdown = fs.readFileSync(options.source, 'utf8');
  const previous = JSON.parse(fs.readFileSync(options.out, 'utf8'));
  // `obtainedAt` describes the snapshot, not this run: default to the moment the
  // reviewed snapshot was last written so the recorded provenance is the fetch.
  const obtainedAt = options.obtainedAt || fs.statSync(options.source).mtime.toISOString();
  const { catalog, notes } = build({ previous, markdown, date: options.date, obtainedAt });
  const report = summary(catalog, previous);
  if (options.check) {
    const drift = !same(catalog.models, previous.models) || catalog.sha256 !== previous.sha256;
    if (!options.quiet) console.log((drift ? 'DRIFT' : 'OK') + ': rebuilt ' + catalog.version + ' sha256 ' + catalog.sha256 + ' (' + report.counts.total + ' models, ' + report.counts.openai + ' openai)');
    return drift ? 1 : 0;
  }
  if (options.dryRun) {
    if (!options.quiet) {
      console.log('DRY-RUN: ' + report.counts.total + ' models, +' + report.added.length + ' / -' + report.removed.length);
      if (report.added.length) console.log('added: ' + report.added.join(', '));
      if (report.removed.length) console.log('removed: ' + report.removed.join(', '));
      for (const note of notes) console.log('note: ' + note);
    }
    return 0;
  }
  const temporary = options.out + '.tmp-' + crypto.randomBytes(6).toString('hex');
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(catalog, null, 2) + '\n', { mode: 0o644 });
  fs.renameSync(temporary, options.out);
  if (!options.quiet) {
    console.log('WROTE ' + options.out + ' version ' + catalog.version + ' sha256 ' + catalog.sha256);
    console.log('models ' + report.counts.total + ' (openai ' + report.counts.openai + ', aliases ' + report.counts.alias + ', long context ' + report.counts.longContext + ')');
    if (report.added.length) console.log('added: ' + report.added.join(', '));
    if (report.removed.length) console.log('removed: ' + report.removed.join(', '));
    for (const note of notes) console.log('note: ' + note);
  }
  return 0;
}

module.exports = { build, parseSnapshot, parseArgs, summary, main, money, SOURCE_URL, BASIS, ALIASES, FIELDS, DEFAULT_SOURCE, DEFAULT_OUT };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
