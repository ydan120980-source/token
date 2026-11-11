'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { tgz } = require('./agent-install-fixture'), { remove } = require('./temp');
const { extract } = require('../../src/quota/agent-install-tar'), { makeEngine, own } = require('../../src/quota/agent-install-engine');
const success = stdout => ({ code: 0, reaped: true, stdout, stderr: '', errorCode: null });
test('native tar extraction bounds files/bytes and rejects traversal, links and truncated gzip', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '原生包 with spaces-')); t.after(() => remove(root));
  for (const [index, entry] of [{ name: 'package/../escape', bytes: 'BAD' }, { name: 'package/vendor/link', type: '2' }, { name: 'package/C:evil', bytes: 'BAD' }, { name: 'package/CON.exe', bytes: 'BAD' }].entries()) {
    const file = path.join(root, index + '.tgz'); fs.writeFileSync(file, tgz([entry])); await assert.rejects(extract(file, path.join(root, 'bad' + index), { confine: own }), /INSTALL_ARCHIVE_REJECTED/);
  }
  const file = path.join(root, 'valid.tgz'); fs.writeFileSync(file, tgz([{ name: 'package/vendor/程序.exe', bytes: 'OFFICIAL_FIXTURE' }])); await extract(file, path.join(root, 'good'), { confine: own }); assert.equal(fs.readFileSync(path.join(root, 'good/vendor/程序.exe'), 'utf8'), 'OFFICIAL_FIXTURE');
  await assert.rejects(extract(file, path.join(root, 'size'), { confine: own, maxBytes: 1 }), /INSTALL_ARCHIVE_REJECTED/);
  const broken = path.join(root, 'truncated.tgz'); fs.writeFileSync(broken, fs.readFileSync(file).subarray(0, -8)); await assert.rejects(extract(broken, path.join(root, 'short'), { confine: own })); assert.equal(fs.existsSync(path.join(root, 'escape')), false);
});
function fixture(t, governed = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-cli-')); t.after(() => remove(root)); const home = path.join(root, 'home'), appData = path.join(home, 'AppData/Roaming'), target = path.join(appData, 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe'), systemRoot = path.join(root, 'Windows'), ps = path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'); fs.mkdirSync(path.dirname(ps), { recursive: true }); fs.writeFileSync(ps, 'PS_FIXTURE'); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, 'OLD_1.0.0');
  let failures = 1, failProbe = false, ready = true; const calls = [], events = [], routes = [], archives = new Map();
  const http = async (url, options) => {
    routes.push({ url, proxy: options.proxy });
    if (options.file) { if (failures-- > 0) { fs.writeFileSync(options.file, 'PARTIAL'); throw Error('INSTALL_DOWNLOAD_FAILED'); } const data = archives.get(url); fs.writeFileSync(options.file, data); options.progress?.({ downloadedBytes: data.length, totalBytes: data.length }); return { hash: crypto.createHash('sha512').update(data).digest('hex') }; }
    const name = url.includes('anthropic') ? url.includes('/latest') ? '@anthropic-ai/claude-code' : '@anthropic-ai/claude-code-win32-x64' : '@openai/codex';
    if (url.endsWith('/latest')) return { text: JSON.stringify({ name, version: '2.0.0' }) };
    const version = name === '@openai/codex' ? '2.0.0-win32-x64' : '2.0.0', binary = name.includes('claude') ? 'claude.exe' : 'codex.exe';
    const tarball = 'https://registry.npmjs.org/native-' + binary + '.tgz', data = tgz([{ name: 'package/package.json', bytes: JSON.stringify({ name, version }) }, { name: 'package/vendor/' + binary, bytes: 'NEW_2.0.0' }]); archives.set(tarball, data);
    return { text: JSON.stringify({ name, version, os: ['win32'], cpu: ['x64'], dist: { tarball, integrity: 'sha512-' + crypto.createHash('sha512').update(data).digest('base64') } }) };
  };
  const job = async (pin, args, options) => {
    calls.push({ pin, args, options });
    if (pin.executable === ps) {
      const mode = args[args.indexOf('-Mode') + 1], data = JSON.parse(fs.readFileSync(args[args.indexOf('-InputFile') + 1], 'utf8'));
      if (mode === 'claude-governance') return success(JSON.stringify({ present: governed, ready, target, version: fs.readFileSync(target, 'utf8').includes('OLD') ? '1.0.0' : '2.0.0' }));
      if (mode === 'claude-replace') { assert.equal(crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'), data.expectedOld); fs.renameSync(data.staged, target); return success('{"replaced":true}'); }
      return success('{"entries":[]}');
    }
    const text = fs.readFileSync(pin.executable, 'utf8'); if (failProbe && text.includes('NEW')) return { ...success(''), code: 1 };
    return success(text.includes('OLD') ? '1.0.0' : '2.0.0');
  };
  const factory=governed?require('../../scripts/local/claude-governed/engine').makeEngine:makeEngine;
  const engine = factory({ root: path.join(root, 'tools'), environment: { home, appData, localAppData: path.join(home, 'AppData/Local'), systemRoot, temp: root, arch: 'x64', platform: 'win32', path: '' }, http, job, installJob: job, allowGoverned: governed, report: e => events.push(e) });
  return { engine, calls, events, routes, target, root, failProbe: () => { failProbe = true; }, policyDown: () => { ready = false; } };
}
test('Codex downloads required native platform archive with retry/progress instead of optional npm wrapper; activation requires probe', async t => {
  const f = fixture(t); assert.equal((await f.engine.install('codex')).installed, true); assert.equal((await f.engine.inspect('codex', false)).runnable, true); assert(f.events.some(row => row.attempt === 2)); assert(f.events.some(row => row.stage === 'extracting')); assert(f.calls.every(row => !row.args.includes('install'))); assert(f.routes.every(row => !row.url.includes('nodejs.org')));
});
test('public Claude install stays app-owned without governance reads, proxy policy or replacing an external executable',async t=>{
  const f=fixture(t),before=fs.readFileSync(f.target);await f.engine.install('claude');
  const row=await f.engine.inspect('claude',false);assert.equal(row.managed,true);assert.equal(row.runnable,true);
  assert.deepEqual(fs.readFileSync(f.target),before);assert(f.routes.every(row=>!row.proxy));
  assert(f.calls.every(row=>!row.args.some(arg=>/claude-(governance|replace)/.test(arg))&&row.pin.executable!==f.target));
  assert.equal(f.engine.rollback,undefined);
});
test('legacy app-owned maintenance marker blocks metadata/install without network, external reads or probes',async t=>{
  for(const name of ['governance-required.json','governed.json']){
    const f=fixture(t),directory=path.join(f.root,'tools/claude');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,name),'INVALID_DO_NOT_PARSE');
    const row=await f.engine.inspect('claude',true);assert.equal(row.localMaintenanceRequired,true);
    await assert.rejects(f.engine.metadata('claude'),/INSTALL_LOCAL_MAINTENANCE_REQUIRED/);await assert.rejects(f.engine.install('claude'),/INSTALL_LOCAL_MAINTENANCE_REQUIRED/);
    assert.equal(f.calls.length,0);assert.equal(f.routes.length,0);assert.equal(fs.readFileSync(f.target,'utf8'),'OLD_1.0.0');
  }
});
test('local-only governed Claude replaces only fixed covered executable, uses residential downloads/probe, and provides verified rollback', async t => {
  const f = fixture(t, true), before = fs.readFileSync(f.target); assert.equal((await f.engine.install('claude')).governed, true); assert.equal(fs.readFileSync(f.target, 'utf8'), 'NEW_2.0.0'); assert(f.routes.every(row => row.proxy === 'claude-residential')); assert(f.calls.filter(row => row.pin.executable === f.target).every(row => row.options.env.HTTPS_PROXY === 'http://127.0.0.1:17898'));
  const installed = await f.engine.inspect('claude', false); assert.equal(installed.canRollback, true); assert.equal(installed.runnable, true); assert.equal(installed.version, '2.0.0');
  assert.equal((await f.engine.rollback('claude')).rolledBack, true); assert.deepEqual(fs.readFileSync(f.target), before); assert.equal((await f.engine.inspect('claude', false)).runnable, true);
});
test('local-only governed Claude postcheck failure restores original bytes and missing governance never falls back to normal network', async t => {
  const f = fixture(t, true), before = fs.readFileSync(f.target); f.failProbe(); await assert.rejects(f.engine.install('claude'), /INSTALL_GOVERNED_UPDATE_FAILED/); assert.deepEqual(fs.readFileSync(f.target), before);
  const blocked = fixture(t, true); blocked.policyDown(); await assert.rejects(blocked.engine.install('claude'), /INSTALL_GOVERNANCE_REQUIRED/); assert.equal(blocked.routes.length, 0);
});
