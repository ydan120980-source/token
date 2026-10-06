'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const crypto = require('node:crypto'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { build, parseSnapshot, main, money, SOURCE_URL, ALIASES, FIELDS } = require('../../scripts/m1/pricing-sync');
const ROOT = path.join(__dirname, '..', '..');
const SNAPSHOT = path.join(ROOT, 'research', 'agent-usage', 'pricing', 'openai-pricing-20261004.md');

const FLAGSHIP_HEADER = '| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |';
const SPECIALIZED_HEADER = '| Category | Model | Input | Cached input | Output |';
const RULE9 = '| --- | --- | --- | --- | --- | --- | --- | --- | --- |';

const MARKDOWN = [
  '### Standard pricing data', '', FLAGSHIP_HEADER, RULE9,
  '| gpt-5.1 | $1.25 | $0.125 | - | $10.00 | - | - | - | - |',
  '| gpt-5.5 (<272K context length) | $5.00 | $0.50 | - | $30.00 | $10.00 | $1.00 | - | $45.00 |',
  '| gpt-mini | $0.25 | $0.025 | - | $2.00 | - | - | - | - |',
  '| gpt-5-mini | $0.25 | $0.025 | - | $2.00 | - | - | - | - |',
  '| gpt-5.2 | $1.75 | $0.175 | - | $14.00 | - | - | - | - |', '',
  '### Batch pricing data', '', FLAGSHIP_HEADER, RULE9,
  '| gpt-5.1 | $0.625 | $0.0625 | - | $5.00 | - | - | - | - |', '',
  '### Grouped Pricing Table data', '', FLAGSHIP_HEADER, RULE9,
  '| gpt-5.5 | $5.00 | $0.50 | - | $30.00 | $10.00 | $1.00 | - | $45.00 |',
  '| gpt-cyber | $12.50 | $1.25 | $15.625 | $75.00 | - | - | - | - |', '',
  '### Pricing Table data', '', '| Model | Price per minute |', '| --- | --- |', '| gpt-live-1 | $0.05 |', '',
  'Specialized models', '', 'Standard', '', '### Grouped Pricing Table data', '', SPECIALIZED_HEADER, '| --- | --- | --- | --- | --- |',
  '| ChatGPT | chat-latest | $5.00 | $0.50 | $30.00 |',
  '| Codex | gpt-5.3-codex | $1.75 | $0.175 | $14.00 |',
  '| Embedding | text-embedding-3-small | $0.02 | - | - |',
  '| Moderation | omni-moderation-latest | Free | - | - |', '',
  'Fast', '', '### Grouped Pricing Table data', '', SPECIALIZED_HEADER, '| --- | --- | --- | --- | --- |',
  '| Codex | gpt-5.3-codex | $3.50 | $0.35 | $28.00 |', ''
].join('\n');

const PREVIOUS = { version: 'x', models: {
  'anthropic/claude-sonnet-4-5': { inputUncached: 3e-6, output: 1.5e-5, cacheRead: 3e-7, cacheWrite: 3.75e-6, source: 'litellm', provenance: 'reference-unverified' },
  'openai/retired-model': { inputUncached: 1e-6, output: 2e-6, cacheRead: null, cacheWrite: null, source: SOURCE_URL, provenance: 'official-current-standard' },
  'deepseek/deepseek-v4.1-flash': { inputUncached: 3e-7, output: 1.2e-6, cacheRead: 6e-9, cacheWrite: 0, source: 'litellm', provenance: 'reference-unverified', offPeakMultiplier: 0.5 }
} };

test('sync reads only recognised tables and converts USD per million to USD per token', () => {
  const { entries, skipped } = parseSnapshot(MARKDOWN);
  assert.equal(entries['openai/gpt-5.1'].inputUncached, 1.25 / 1e6);
  assert.equal(entries['openai/gpt-5.1'].cacheRead, 0.125 / 1e6);
  assert.equal(entries['openai/gpt-5.1'].cacheWrite, null);
  assert.equal(entries['openai/gpt-5.1'].output, 10 / 1e6);
  assert.equal(entries['openai/gpt-5.5'].longContext.output, 45 / 1e6);
  assert.equal(entries['openai/gpt-5.5'].longContext.cacheRead, 1 / 1e6);
  assert.equal(entries['openai/gpt-mini'].longContext, undefined);
  assert.equal(entries['openai/gpt-cyber'].cacheWrite, 15.625 / 1e6);
  assert.equal(entries['openai/chat-latest'].inputUncached, 5 / 1e6);
  assert.equal(entries['openai/gpt-5.3-codex'].output, 14 / 1e6, 'Standard wins over the Fast tier');
  assert.match(skipped.join('\n'), /Price per minute/);
  assert.match(skipped.join('\n'), /batch pricing data/);
  assert.match(skipped.join('\n'), /, Fast\)$/, 'the Fast Specialized table is not a catalog source');
});

test('sync refuses an unreadable price instead of defaulting it', () => {
  const bad = MARKDOWN.replace('| gpt-mini | $0.25 |', '| gpt-mini | see website |');
  assert.throws(() => parseSnapshot(bad), /PRICING_SOURCE_UNREADABLE/);
  assert.throws(() => parseSnapshot(MARKDOWN.replace('| gpt-mini | $0.25 | $0.025 | - | $2.00 | - | - | - | - |', '| gpt-mini | - | $0.025 | - | $2.00 | - | - | - | - |')), /PRICING_SOURCE_INCOMPLETE/);
  assert.equal(money('-', 'x'), null);
  assert.equal(money('Free', 'x'), 0);
  assert.equal(money('$1,000.50', 'x'), 1000.5);
  assert.throws(() => money('$1.5 / minute', 'x'), /PRICING_SOURCE_UNREADABLE/);
});

test('sync keeps other providers byte-identical, rebuilds openai in place and appends aliases', () => {
  const { catalog } = build({ previous: PREVIOUS, markdown: MARKDOWN, date: '2026-10-04', obtainedAt: '2026-10-04T00:00:00.000Z' });
  const keys = Object.keys(catalog.models);
  assert.deepEqual(keys.slice(0, 2), ['anthropic/claude-sonnet-4-5', 'openai/gpt-5.1'], 'openai is rebuilt at the position it already occupied');
  assert.ok(keys.indexOf('openai/gpt-5.5') < keys.indexOf('deepseek/deepseek-v4.1-flash'), 'other providers keep their relative order around the openai block');
  assert.equal(JSON.stringify(catalog.models['anthropic/claude-sonnet-4-5']), JSON.stringify(PREVIOUS.models['anthropic/claude-sonnet-4-5']));
  assert.equal(JSON.stringify(catalog.models['deepseek/deepseek-v4.1-flash']), JSON.stringify(PREVIOUS.models['deepseek/deepseek-v4.1-flash']));
  assert.equal(catalog.models['openai/retired-model'], undefined, 'openai entries not in the snapshot are dropped, not guessed');
  for (const { alias, base } of ALIASES) {
    const row = catalog.models['openai/' + alias];
    assert.equal(row.aliasOf, base);
    assert.equal(row.inputUncached, catalog.models['openai/' + base].inputUncached);
    assert.equal(row.source, SOURCE_URL.replace(/\/pricing$/, '/models/' + alias));
    assert.equal(FIELDS.every(field => field in row), true);
  }
  assert.equal(catalog.version, 'official-review-2026-10-04');
  assert.equal(catalog.obtainedAt, '2026-10-04T00:00:00.000Z');
  assert.equal(catalog.sha256, crypto.createHash('sha256').update(JSON.stringify(catalog.models)).digest('hex'));
  assert.equal(catalog.sourceSha256, crypto.createHash('sha256').update(MARKDOWN).digest('hex'));
});

test('sync aborts when a table disagrees with itself rather than picking a winner', () => {
  const conflicting = MARKDOWN.replace('### Pricing Table data', '### Grouped Pricing Table data').replace('| gpt-cyber | $12.50 |', '| gpt-5.1 | $99.00 |');
  assert.throws(() => parseSnapshot(conflicting), /PRICING_SOURCE_CONFLICT/);
});

test('shipped catalog is internally consistent and reproducible from the reviewed snapshot', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'm1', 'prices.json'), 'utf8'));
  assert.equal(catalog.sha256, crypto.createHash('sha256').update(JSON.stringify(catalog.models)).digest('hex'));
  assert.match(catalog.version, /^official-review-\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isFinite(Date.parse(catalog.obtainedAt)), 'obtainedAt must be a timestamp');
  assert.match(catalog.sourceSha256, /^[0-9a-f]{64}$/);
  for (const key of Object.keys(catalog.models)) {
    assert.match(key, /^[a-z0-9.]+\/[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,179}$/, key + ' must be provider/model');
    assert.equal(typeof catalog.models[key].provenance, 'string');
  }
  if (!fs.existsSync(SNAPSHOT)) return;
  const { catalog: rebuilt } = build({ previous: catalog, markdown: fs.readFileSync(SNAPSHOT, 'utf8'), date: catalog.version.slice('official-review-'.length), obtainedAt: catalog.obtainedAt });
  assert.deepEqual(rebuilt.models, catalog.models, 're-running the sync on the shipped snapshot must be a no-op');
  assert.equal(rebuilt.sha256, catalog.sha256);
  assert.equal(rebuilt.sourceSha256, catalog.sourceSha256);
  assert.equal(rebuilt.version, catalog.version);
});

test('the sync workflow stays reachable from the documented entry points', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['pricing:check'], 'node scripts/m1/pricing-sync.js --check');
  assert.equal(pkg.scripts['pricing:sync'], 'node scripts/m1/pricing-sync.js');
  const doc = path.join(ROOT, 'docs', 'm1', 'PRICING-SYNC-20261004.md');
  assert.ok(fs.existsSync(doc), 'the snapshot workflow must stay documented');
  assert.match(fs.readFileSync(doc, 'utf8'), /pricing-sync\.js/);
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /PRICING-SYNC-20261004\.md/, 'README links the workflow document');
  assert.match(readme, /pricing:check/, 'README lists the drift check');
  assert.doesNotMatch(readme, /确认清空统计/, 'the removed clear-and-pause action is not described as current');
});

test('check mode reports drift for an unchanged and a changed snapshot, and never writes', () => {
  const out = path.join(ROOT, 'src', 'm1', 'prices.json');
  const before = fs.readFileSync(out);
  if (fs.existsSync(SNAPSHOT)) assert.equal(main(['--check', '--quiet']), 0, 'the shipped catalog matches the reviewed snapshot');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-sync-'));
  try {
    const changed = path.join(dir, 'changed.md');
    const markdown = fs.readFileSync(SNAPSHOT, 'utf8').replace('| gpt-4.1 | $2.00 |', '| gpt-4.1 | $2.01 |');
    assert.notEqual(markdown, fs.readFileSync(SNAPSHOT, 'utf8'));
    fs.writeFileSync(changed, markdown);
    assert.equal(main(['--check', '--quiet', '--source', changed]), 1, 'a changed price is drift');
    assert.equal(main(['--check', '--quiet', '--source', SNAPSHOT, '--date', '2000-01-01']), 0, 'the date alone is not model drift');
    assert.ok(before.equals(fs.readFileSync(out)), 'check mode never writes the catalog');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
