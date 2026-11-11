'use strict';
// Reproduction for the reviewer's [P1] finding: after a request times out, is the next request posted
// to the worker that is being terminated?
// The parser service is taken from a git revision (before) or the working tree (after), with its request
// budget read from `this.requestMs` so one request can be forced to time out and the next given a real
// budget. Synthetic records only; nothing outside a temporary directory is read or written.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execSync } = require('node:child_process');

const HERE = process.cwd();
const WORKER = path.join(HERE, 'src', 'm1', 'transcript-task-worker.js');
const OUTPUT = process.env.TIMEOUT_OUTPUT || path.join('artifacts', 'perf-20261103', 'timeout-recovery');
const BEFORE = process.env.TIMEOUT_BEFORE || '4cc3a60';

function load(revision) {
  if (revision === 'working') return { module: require(path.join(HERE, 'src', 'm1', 'transcript-tasks.js')), file: null };
  const source = execSync(`git show ${revision}:src/m1/transcript-tasks.js`, { cwd: HERE, encoding: 'utf8' })
    .replace('},90000);', '},this.requestMs||90000);')
    .replace("require.resolve('./transcript-task-worker')", JSON.stringify(WORKER))
    .replace('this.record=null;this.serial=0;', 'this.record=null;this.requestMs=90000;this.serial=0;');
  const file = path.join(os.tmpdir(), `tasks-${revision.replace(/[^a-z0-9]/gi, '')}-${process.pid}.js`);
  fs.writeFileSync(file, source);
  return { module: require(file), file };
}

async function probe(revision) {
  const loaded = load(revision);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-probe-'));
  const row = text => JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ text }] } });
  fs.writeFileSync(path.join(root, 'own-session.jsonl'), [
    JSON.stringify({ type: 'session_meta', payload: { id: 'own-session' } }),
    row('hello from a synthetic record')
  ].join('\n') + '\n');
  const tasks = new loaded.module.TranscriptTasks({ idleMs: 60000 });
  // The first read cannot finish inside one millisecond, so it times out and its worker is retired.
  tasks.requestMs = 1;
  const first = await tasks.run('transcript', ['codex', 'own-session', [root]]).then(() => 'ok', error => error.message);
  // The second read is given a real budget: it must be answered by a serviceable parser.
  tasks.requestMs = 90000;
  const second = await tasks.run('transcript', ['codex', 'own-session', [root]]).then(value => `${value.items.length} items`, error => error.message);
  const metrics = tasks.metrics();
  await tasks.close();
  const report = { revision, first, second, workers: metrics.workers, reused: metrics.reused, released: metrics.released, recovered: second !== 'TRANSCRIPT_UNREADABLE' };
  fs.rmSync(root, { recursive: true, force: true });
  if (loaded.file) { delete require.cache[require.resolve(loaded.file)]; fs.rmSync(loaded.file, { force: true }); }
  return report;
}

(async () => {
  const report = { syntheticOnly: true, before: await probe(BEFORE), after: await probe('working') };
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  if (!report.after.recovered) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
