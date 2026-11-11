'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { plans, version, newer } = require('../../../src/quota/agent-install-plans');
const { receive, allowed } = require('../../../src/quota/agent-install-http');
const { makeProxyAgent } = require('./proxy');
async function localReceive(url, options) {
  const agent=makeProxyAgent('claude-residential',options.signal);
  try { return await receive(url,{...options,proxy:null,agent}); } finally { agent.destroy(); }
}
const { fingerprint } = require('../../../src/quota/executable-pin');
const { runWindowsJob, runWindowsInstallerJob } = require('../../../src/quota/windows-job');
const { extract } = require('../../../src/quota/agent-install-tar');
const sha = file => { const descriptor = fs.openSync(file, 'r'), hash = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(65536); try { let bytes; while ((bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, bytes)); return hash.digest('hex'); } finally { fs.closeSync(descriptor); } };
const safeHash = file => { try { return sha(file); } catch { return null; } };
function own(root, file) {
  const target = path.resolve(file), relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('INSTALL_PATH_REJECTED');
  for (let current = target; ; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('INSTALL_PATH_REJECTED');
    if (current === path.dirname(current)) break;
  }
  return target;
}
function readJSON(file, maximum = 1024 * 1024) { for (let current = path.resolve(file); ; current = path.dirname(current)) { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('INSTALL_METADATA_INVALID'); if (current === path.dirname(current)) break; } if (fs.statSync(file).size > maximum) throw new Error('INSTALL_METADATA_INVALID'); return JSON.parse(fs.readFileSync(file, 'utf8')); }
function makeEngine({ root, environment, report = () => {}, signal, http = localReceive, job = runWindowsJob, installJob = runWindowsInstallerJob, allowGoverned = false }) {
  fs.mkdirSync(root, { recursive: true }); root = path.resolve(root); own(path.dirname(root), root);
  const stage = (value, extra = {}) => report({ stage: value, ...extra });
  const canceled = () => { if (signal?.aborted) throw new Error('INSTALL_CANCELED'); };
  const systemPowerShell = path.join(environment.systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const env = { SystemRoot: environment.systemRoot, WINDIR: environment.systemRoot, TEMP: environment.temp, TMP: environment.temp };
  // Installer/version probes never inherit the account's home or configuration.
  // The original environment is used only by bounded metadata discovery.
  const privateHome = own(root, path.join(root, 'runtime-home'));
  fs.mkdirSync(privateHome, { recursive: true });
  const privateEnv = { HOME: privateHome, USERPROFILE: privateHome, APPDATA: path.join(privateHome, 'AppData/Roaming'), LOCALAPPDATA: path.join(privateHome, 'AppData/Local') };
  let policyCache;
  const governedEnv = { HTTP_PROXY: 'http://127.0.0.1:17898', HTTPS_PROXY: 'http://127.0.0.1:17898', ALL_PROXY: 'http://127.0.0.1:17898', NO_PROXY: 'localhost,127.0.0.1,::1' };
  const work = () => { const directory = own(root, path.join(root, 'tasks', crypto.randomUUID())); fs.mkdirSync(directory, { recursive: true }); return directory; };
  const execute = async (executable, args, cwd, timeoutMs = 10000, processEnv = env, installing = false, finishing = false) => {
    if (!finishing) canceled(); const result = await (installing ? installJob : job)(fingerprint(executable), args, { cwd, timeoutMs, maxOutputBytes: 524288, env: processEnv, signal: finishing ? undefined : signal });
    if (result.reaped !== true) throw new Error('INSTALL_CLEANUP_UNCONFIRMED');
    if (result.canceled || !finishing && signal?.aborted) throw new Error('INSTALL_CANCELED');
    if (result.timedOut) throw new Error('INSTALL_TIMEOUT');
    if (result.overflow) throw new Error('INSTALL_OUTPUT_LIMIT');
    if (result.errorCode || result.code !== 0) throw new Error('INSTALL_PROCESS_FAILED');
    return result.stdout;
  };
  async function host(mode, input, cwd, finishing = false) {
    const requestFile = own(root, path.join(cwd, crypto.randomUUID() + '.json')); fs.writeFileSync(requestFile, JSON.stringify(input), { flag: 'wx', mode: 0o600 });
    const helper = path.join(__dirname, 'host.ps1');
    return JSON.parse(await execute(systemPowerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helper, '-Mode', mode, '-InputFile', requestFile], cwd, mode === 'expand' ? 120000 : 15000, env, mode === 'expand', finishing));
  }
  async function claudePolicy(refresh = false) {
    if (!policyCache || refresh) { try { policyCache = await host('claude-governance', { appData: environment.appData }, work()); } catch (error) { throw new Error('INSTALL_GOVERNANCE_REQUIRED', { cause: error }); } }
    const target = path.join(environment.appData, 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe');
    if (typeof policyCache.present !== 'boolean' || typeof policyCache.ready !== 'boolean') throw new Error('INSTALL_GOVERNANCE_REQUIRED');
    const required = own(root, path.join(root, 'claude/governance-required.json'));
    if (!policyCache.present && fs.existsSync(required)) throw new Error('INSTALL_GOVERNANCE_REQUIRED');
    if (policyCache.present && (path.resolve(policyCache.target) !== path.resolve(target) || !policyCache.ready || !version(policyCache.version))) throw new Error('INSTALL_GOVERNANCE_REQUIRED');
    if (policyCache.present) { policyCache.version = version(policyCache.version).replace(/^(\d+\.\d+\.\d+)\.0$/, '$1'); fs.mkdirSync(path.dirname(required), { recursive: true }); fs.writeFileSync(required, '{"required":true}', { mode: 0o600 }); policyCache.selectedHash ||= sha(target); }
    return policyCache;
  }
  async function text(url, scope, proxy = null) { return (await http(url, { scope, signal, proxy, limit: 2 * 1024 * 1024 })).text; }
  async function json(url, scope, proxy = null) { try { return JSON.parse(await text(url, scope, proxy)); } catch (error) { if (/^INSTALL_/.test(error?.message)) throw error; throw new Error('INSTALL_METADATA_INVALID', { cause: error }); } }
  async function metadata(agent) {
    const plan = agent === 'claude' ? plans.claude : null; if (!plan) throw new Error('INSTALL_AGENT_REJECTED');
    if (plan.package) {
      const policy = await claudePolicy();if(!policy.present)throw new Error('INSTALL_GOVERNANCE_REQUIRED');
      const value = await json('https://registry.npmjs.org/' + plan.package + '/latest', 'registry', policy?.present ? 'claude-residential' : null);
      if (value.name !== plan.package || !version(value.version)) throw new Error('INSTALL_METADATA_INVALID');
      return { version: version(value.version), source: 'npmjs', package: plan.package };
    }
    throw new Error('INSTALL_AGENT_REJECTED');
  }
  async function platformPackage(agent, latest) {
    const name = agent === 'codex' ? '@openai/codex' : plans[agent].platform(environment.arch);
    const target = agent === 'codex' ? latest.version + '-win32-' + environment.arch : latest.version;
    const policy = agent === 'claude' ? await claudePolicy() : null;
    const value = await json('https://registry.npmjs.org/' + name + '/' + target, 'registry', policy?.present ? 'claude-residential' : null);
    const integrity = /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(value.dist?.integrity || '');
    if (value.name !== name || value.version !== target || !integrity || !allowed(value.dist.tarball, 'registry') || !Array.isArray(value.os) || !value.os.includes('win32') || !Array.isArray(value.cpu) || !value.cpu.includes(environment.arch)) throw new Error('INSTALL_METADATA_INVALID');
    return { name, version: target, url: value.dist.tarball, hash: Buffer.from(integrity[1], 'base64').toString('hex') };
  }
  async function nativePackage(agent, latest, generation) {
    const selected = await platformPackage(agent, latest), archive = own(root, path.join(generation, 'platform.tgz'));
    const policy = agent === 'claude' ? await claudePolicy() : null;
    let result;
    for (let attempt = 1; attempt <= 3; attempt++) {
      canceled(); stage('downloading', { attempt });
      try { result = await http(selected.url, { scope: 'registry', signal, proxy: policy?.present ? 'claude-residential' : null, file: archive, hash: 'sha512', resume: true, limit: 768 * 1024 * 1024, progress: data => stage('downloading', { ...data, attempt }) }); break; }
      catch (error) { if (attempt === 3 || !['INSTALL_TIMEOUT', 'INSTALL_DOWNLOAD_FAILED'].includes(error?.message) || signal?.aborted) throw error; }
    }
    stage('verifying'); if (result.hash !== selected.hash) throw new Error('INSTALL_CHECKSUM_FAILED');
    const folder = own(root, path.join(generation, 'package')); stage('extracting'); await extract(archive, folder, { signal, confine: own });
    const pkg = readJSON(path.join(folder, 'package.json')); if (pkg.name !== selected.name || pkg.version !== selected.version) throw new Error('INSTALL_METADATA_INVALID');
    return findBinary(folder, [agent === 'codex' ? 'codex.exe' : plans[agent].binary, plans[agent].alternate].filter(Boolean));
  }
  function writeGoverned(record) { const file = own(root, path.join(root, 'claude/governed.json')), temporary = own(root, file + '.tmp'); fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 }); fs.renameSync(temporary, file); }
  async function replaceClaude(source, target, expectedOld, expectedNew, cwd) {
    own(root, source); if (sha(source) !== expectedNew) throw new Error('INSTALL_CHECKSUM_FAILED');
    const staged = target + '.agentusage-' + crypto.randomUUID() + '.tmp';
    // This is the sole external write exception: the existing fixed, firewall-
    // covered Claude binary. No metadata/config/PATH or policy files are changed.
    try {
      fs.copyFileSync(source, staged, fs.constants.COPYFILE_EXCL);
      await host('claude-replace', { appData: environment.appData, target, staged, expectedOld, expectedNew }, cwd, true);
      if (sha(target) !== expectedNew) throw new Error('INSTALL_TARGET_CHANGED');
      policyCache = undefined;
    } finally { try { if (fs.existsSync(staged) && sha(staged) === expectedNew) fs.unlinkSync(staged); } catch { /* Keep an unexpected file for inspection. */ } }
  }
  async function governedInstall(source, latest, policy, cwd) {
    const current = await claudePolicy(true); if (current.selectedHash !== policy.selectedHash) throw new Error('INSTALL_TARGET_CHANGED');
    const backup = own(root, path.join(root, 'claude/backups', crypto.randomUUID(), 'claude.exe')); fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(policy.target, backup, fs.constants.COPYFILE_EXCL); if (sha(backup) !== policy.selectedHash) throw new Error('INSTALL_TARGET_CHANGED');
    const record = { schemaVersion: 'ClaudeGovernedInstallV1', target: policy.target, version: latest.version, installedHash: sha(source), source, backup, backupHash: policy.selectedHash, backupVersion: version(policy.version), stage: 'prepared' };
    writeGoverned(record); canceled(); stage('installing');
    try {
      await replaceClaude(source, record.target, record.backupHash, record.installedHash, cwd);
      stage('postcheck'); await probe({ executable: record.target, version: record.version, governed: true }, cwd, true);
    } catch (error) {
      if (safeHash(record.target) === record.installedHash) {
        stage('rolling-back'); try { await replaceClaude(backup, record.target, record.installedHash, record.backupHash, cwd); await probe({ executable: record.target, version: record.backupVersion, governed: true }, cwd, true); } catch (restore) { record.stage = 'rollback-required'; writeGoverned(record); throw new Error('INSTALL_ROLLBACK_REQUIRED', { cause: restore }); }
      } else if (safeHash(record.target) !== record.backupHash) { record.stage = 'rollback-required'; writeGoverned(record); throw new Error('INSTALL_ROLLBACK_REQUIRED', { cause: error }); }
      record.stage = 'restored'; writeGoverned(record); throw new Error('INSTALL_GOVERNED_UPDATE_FAILED', { cause: error });
    }
    record.stage = 'complete'; writeGoverned(record); return { installed: true, governed: true, version: record.version };
  }
  async function rollback(agent) {
    if (agent !== 'claude' || !allowGoverned) throw new Error('INSTALL_GOVERNANCE_CONFIRM_REQUIRED');
    const policy = await claudePolicy(), cwd = work(), record = readJSON(own(root, path.join(root, 'claude/governed.json')));
    if (!policy.present || record.schemaVersion !== 'ClaudeGovernedInstallV1' || record.target !== policy.target || sha(policy.target) !== record.installedHash || !version(record.backupVersion) || sha(own(root, record.backup)) !== record.backupHash || sha(own(root, record.source)) !== record.installedHash) throw new Error('INSTALL_TARGET_CHANGED');
    canceled(); stage('rolling-back');
    try { await replaceClaude(record.backup, record.target, record.installedHash, record.backupHash, cwd); await probe({ executable: record.target, version: record.backupVersion, governed: true }, cwd, true); }
    catch (error) { if (safeHash(record.target) === record.backupHash) { try { await replaceClaude(record.source, record.target, record.backupHash, record.installedHash, cwd); } catch (restore) { throw new Error('INSTALL_ROLLBACK_REQUIRED', { cause: restore }); } } else if (safeHash(record.target) !== record.installedHash) throw new Error('INSTALL_ROLLBACK_REQUIRED', { cause: error }); throw new Error('INSTALL_GOVERNED_UPDATE_FAILED', { cause: error }); }
    record.stage = 'rolled-back'; writeGoverned(record); return { rolledBack: true, governed: true, version: record.backupVersion };
  }
  async function probe(saved, cwd, finishing = false) {
    const args = saved.js ? [saved.entry, '--version'] : ['--version'];
    const stdout = await execute(saved.executable, args, cwd, 10000, { ...env, ...privateEnv, ...(saved.governed ? governedEnv : {}), PATH: path.dirname(saved.executable) + path.delimiter + path.join(environment.systemRoot, 'System32') }, false, finishing);
    const matches = stdout.length <= 4096 ? stdout.match(/\b\d{1,4}\.\d{1,9}\.\d{1,9}(?:\.\d{1,9})?(?:-[a-zA-Z0-9.-]+)?\b/g) : null;
    if (!matches?.some(value => version(value) && newer(value, saved.version) === false && newer(saved.version, value) === false)) throw new Error('INSTALL_VERSION_UNVERIFIED');
    return true;
  }
  async function inspect(agent, remote) {
    if(agent!=='claude')throw new Error('INSTALL_AGENT_REJECTED');
    const policy=await claudePolicy();
    if(!policy.present)throw new Error('INSTALL_GOVERNANCE_REQUIRED');
    const local={state:'installed',version:policy.version,managed:false,governed:true,runnable:null};
    try {await probe({executable:policy.target,version:local.version,governed:true},work());local.runnable=true;}catch{local.state='broken';local.runnable=false;}
    try {const record=readJSON(own(root,path.join(root,'claude/governed.json')));local.canRollback=record.target===policy.target&&record.installedHash===sha(policy.target)&&sha(own(root,record.backup))===record.backupHash;}catch{local.canRollback=false;}
    return {...local,latest:remote?(await metadata(agent)).version:null};
  }
  function findBinary(directory, names) {
    const pending = [directory]; let checked = 0;
    while (pending.length) { const current = own(root, pending.pop()); for (const entry of fs.readdirSync(current, { withFileTypes: true })) { if (++checked > 5000) throw new Error('INSTALL_LAYOUT_UNSUPPORTED'); const file = own(root, path.join(current, entry.name)); if (entry.isSymbolicLink()) continue; if (entry.isDirectory()) pending.push(file); else if (names.includes(entry.name.toLowerCase())) return file; } }
    throw new Error('INSTALL_LAYOUT_UNSUPPORTED');
  }
  async function install(agent) {
    if(agent!=='claude'||!allowGoverned)throw new Error('INSTALL_GOVERNANCE_CONFIRM_REQUIRED');
    if(!['x64','arm64'].includes(environment.arch)||process.platform!=='win32')throw new Error('INSTALL_PLATFORM_UNSUPPORTED');
    const policy=await claudePolicy();if(!policy.present)throw new Error('INSTALL_GOVERNANCE_REQUIRED');
    stage('resolving');const latest=await metadata(agent),cwd=work();canceled();
    const generation=own(root,path.join(root,agent,crypto.randomUUID()));fs.mkdirSync(generation,{recursive:true});
    return governedInstall(await nativePackage(agent,latest,generation),latest,policy,cwd);
  }
  return {inspect,install,metadata,rollback};
}
module.exports = { makeEngine };
