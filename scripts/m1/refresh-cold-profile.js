'use strict';
// A CPU profile of one cold collection inside the worker's own functions. The stage timings say how
// long each phase takes; the profile says which functions inside them actually spend the time, so an
// optimization is chosen from evidence rather than from the shape of the code.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const inspector = require('node:inspector');
const build = require('./collection-benchmark-fixture');

const ROWS = Number(process.env.PROFILE_ROWS || 2000);
const TURNS = Number(process.env.PROFILE_TURNS || 20);
const OUTPUT = process.env.PROFILE_OUTPUT || path.join('artifacts', 'perf-20261103', 'refresh', 'cold.cpuprofile');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-profile-'));
  const { roots } = build(root, ROWS, TURNS);
  const { survey, sourceStamp, refreshCache, scanSources } = require('../../src/m1/sources');
  const { verifyProjection } = require('../../src/m1/native');
  const { ParseCache } = require('../../src/m1/parse-cache');
  const audit = { reads: 0, sourceWrites: 0, authenticationReads: 0, networkAttempts: 0 };
  const salt = 'profile';
  const cache = { salt, files: new ParseCache(), fingerprints: new Map(), seen: new Set(), listing: null };
  const session = new inspector.Session();
  session.connect();
  const post = (method, params) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
  try {
    await post('Profiler.enable');
    await post('Profiler.start');
    const walk = survey(roots, audit);
    sourceStamp(roots, salt, audit, walk);
    await refreshCache(roots, salt, audit, cache, walk);
    const scan = await scanSources(roots, salt, audit, { cache, report: { failures: 0 }, prepared: walk });
    const records = Object.values(scan).flatMap(entry => entry.records);
    await verifyProjection(records, path.join(root, 'usage'), () => {});
    const { profile } = await post('Profiler.stop');
    fs.mkdirSync(path.dirname(path.resolve(OUTPUT)), { recursive: true });
    fs.writeFileSync(path.resolve(OUTPUT), JSON.stringify(profile));
    console.log(JSON.stringify({ nodes: profile.nodes.length, samples: profile.samples.length, records: records.length, output: OUTPUT }));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    for (let attempt = 0; attempt < 5; attempt += 1) { try { fs.rmSync(root, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); } }
    process.exit(process.exitCode || 0);
  }
})();
