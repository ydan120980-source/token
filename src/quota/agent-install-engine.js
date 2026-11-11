'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { plans, version, newer } = require('./agent-install-plans');
const { receive, allowed } = require('./agent-install-http');
const { fingerprint } = require('./executable-pin');
const { runWindowsJob, runWindowsInstallerJob } = require('./windows-job');
const { discoverAgentRuntime } = require('./agent-runtime-discovery');
const { discoverAntigravity } = require('./antigravity-discovery');
const { extract } = require('./agent-install-tar');
const packagePath = (prefix, name) => path.join(prefix, 'node_modules', ...name.split('/'));
const sha = file => { const descriptor = fs.openSync(file, 'r'), hash = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(65536); try { let bytes; while ((bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, bytes)); return hash.digest('hex'); } finally { fs.closeSync(descriptor); } };
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
function readActiveRuntime(root, agent) {
  try { const saved = readJSON(own(root, path.join(root, agent, 'active.json'))); if (saved.agent !== agent || !version(saved.version) || typeof saved.executable !== 'string') return null;
    for (const key of ['entry', 'executable']) if (saved[key]) { own(root, saved[key]); if (!/^[a-f0-9]{64}$/.test(saved[key + 'Hash']) || sha(saved[key]) !== saved[key + 'Hash']) return null; }
    if (saved.binDirectory) own(root, saved.binDirectory); return saved;
  } catch { return null; }
}
function makeEngine({ root, environment, report = () => {}, signal, http = receive, job = runWindowsJob, installJob = runWindowsInstallerJob }) {
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
    const helper = path.join(__dirname.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'), 'agent-install-host.ps1');
    return JSON.parse(await execute(systemPowerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helper, '-Mode', mode, '-InputFile', requestFile], cwd, mode === 'expand' ? 120000 : 15000, env, mode === 'expand', finishing));
  }
  function localMaintenance(agent) {
    return agent==='claude'&&['governance-required.json','governed.json'].some(name=>fs.existsSync(own(root,path.join(root,'claude',name))));
  }
  function requireProductRoute(agent) { if(localMaintenance(agent))throw new Error('INSTALL_LOCAL_MAINTENANCE_REQUIRED'); }
  async function text(url, scope) { return (await http(url, { scope, signal, limit: 2 * 1024 * 1024 })).text; }
  async function json(url, scope) { try { return JSON.parse(await text(url, scope)); } catch (error) { if (/^INSTALL_/.test(error?.message)) throw error; throw new Error('INSTALL_METADATA_INVALID', { cause: error }); } }
  async function metadata(agent) {
    requireProductRoute(agent);
    const plan = plans[agent]; if (!plan) throw new Error('INSTALL_AGENT_REJECTED');
    if (plan.package) {
      const value = await json('https://registry.npmjs.org/' + plan.package + '/latest', 'registry');
      if (value.name !== plan.package || !version(value.version)) throw new Error('INSTALL_METADATA_INVALID');
      return { version: version(value.version), source: 'npmjs', package: plan.package };
    }
    if (agent === 'antigravity') {
      const value = await json('https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/windows_' + (environment.arch === 'arm64' ? 'arm64' : 'amd64') + '.json', agent);
      if (!version(value.version) || !/^[a-f0-9]{128}$/i.test(value.sha512) || !allowed(value.url, agent)) throw new Error('INSTALL_METADATA_INVALID');
      return { version: version(value.version), url: value.url, hash: value.sha512.toLowerCase(), algorithm: 'sha512', source: 'official-manifest' };
    }
    if (agent === 'workbuddy') {
      const value = await json('https://www.workbuddy.cn/v2/update?platform=workbuddy-win32-x64-user', agent);
      if (!version(value.productVersion || value.version) || !/^[a-f0-9]{64}$/i.test(value.sha256hash) || !allowed(value.url, agent)) throw new Error('INSTALL_METADATA_INVALID');
      return { version: version(value.productVersion || value.version), url: value.url, hash: value.sha256hash.toLowerCase(), algorithm: 'sha256', source: 'official-manifest' };
    }
    if (agent === 'cursor') {
      const value = await json('https://api2.cursor.sh/updates/api/update/win32-' + environment.arch + '-user/cursor/0.0.0', agent);
      if (!version(value.productVersion || value.version) || !allowed(value.url, agent)) throw new Error('INSTALL_METADATA_INVALID');
      return { version: version(value.productVersion || value.version), url: value.url, hash: /^[a-f0-9]{64}$/i.test(value.sha256hash) ? value.sha256hash.toLowerCase() : null, algorithm: 'sha256', source: 'official-manifest' };
    }
    const page = (await text('https://zcode.z.ai', agent)).replaceAll('\\/', '/');
    const expression = new RegExp('https://cdn-zcode\\.z\\.ai/zcode/electron/releases/(\\d+\\.\\d+\\.\\d+)/windows-' + environment.arch + '/ZCode-[0-9.]+-win-' + environment.arch + '\\.exe', 'g');
    const match = expression.exec(page);
    if (!match || !version(match[1])) throw new Error('INSTALL_METADATA_INVALID');
    return { version: match[1], url: match[0], hash: null, algorithm: 'sha256', source: 'official-page-and-signature' };
  }
  async function platformPackage(agent, latest) {
    const name = agent === 'codex' ? '@openai/codex' : plans[agent].platform(environment.arch);
    const target = agent === 'codex' ? latest.version + '-win32-' + environment.arch : latest.version;
    const value = await json('https://registry.npmjs.org/' + name + '/' + target, 'registry');
    const integrity = /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(value.dist?.integrity || '');
    if (value.name !== name || value.version !== target || !integrity || !allowed(value.dist.tarball, 'registry') || !Array.isArray(value.os) || !value.os.includes('win32') || !Array.isArray(value.cpu) || !value.cpu.includes(environment.arch)) throw new Error('INSTALL_METADATA_INVALID');
    return { name, version: target, url: value.dist.tarball, hash: Buffer.from(integrity[1], 'base64').toString('hex') };
  }
  async function nativePackage(agent, latest, generation) {
    const selected = await platformPackage(agent, latest), archive = own(root, path.join(generation, 'platform.tgz'));
    let result;
    for (let attempt = 1; attempt <= 3; attempt++) {
      canceled(); stage('downloading', { attempt });
      try { result = await http(selected.url, { scope: 'registry', signal, file: archive, hash: 'sha512', resume: true, limit: 768 * 1024 * 1024, progress: data => stage('downloading', { ...data, attempt }) }); break; }
      catch (error) { if (attempt === 3 || !['INSTALL_TIMEOUT', 'INSTALL_DOWNLOAD_FAILED'].includes(error?.message) || signal?.aborted) throw error; }
    }
    stage('verifying'); if (result.hash !== selected.hash) throw new Error('INSTALL_CHECKSUM_FAILED');
    const folder = own(root, path.join(generation, 'package')); stage('extracting'); await extract(archive, folder, { signal, confine: own });
    const pkg = readJSON(path.join(folder, 'package.json')); if (pkg.name !== selected.name || pkg.version !== selected.version) throw new Error('INSTALL_METADATA_INVALID');
    return findBinary(folder, [agent === 'codex' ? 'codex.exe' : plans[agent].binary, plans[agent].alternate].filter(Boolean));
  }
  function load(agent) {
    return readActiveRuntime(root, agent);
  }
  async function probe(saved, cwd, finishing = false) {
    const args = saved.js ? [saved.entry, '--version'] : ['--version'];
    const stdout = await execute(saved.executable, args, cwd, 10000, { ...env, ...privateEnv, PATH: path.dirname(saved.executable) + path.delimiter + path.join(environment.systemRoot, 'System32') }, false, finishing);
    const matches = stdout.length <= 4096 ? stdout.match(/\b\d{1,4}\.\d{1,9}\.\d{1,9}(?:\.\d{1,9})?(?:-[a-zA-Z0-9.-]+)?\b/g) : null;
    if (!matches?.some(value => version(value) && newer(value, saved.version) === false && newer(saved.version, value) === false)) throw new Error('INSTALL_VERSION_UNVERIFIED');
    return true;
  }
  async function inspect(agent, remote) {
    const cwd = work(), managed = load(agent); let local;
    if(localMaintenance(agent))return {state:'unverified',version:null,managed:false,runnable:null,localMaintenanceRequired:true,latest:null,checkError:'INSTALL_LOCAL_MAINTENANCE_REQUIRED'};
    if (managed) {
      try { await probe(managed, cwd); const quote = value => "'" + value.replaceAll("'", "''") + "'"; local = { state: 'installed', version: managed.version, managed: true, path: managed.entry || managed.executable, runnable: true, searchDirectory: managed.binDirectory || path.dirname(managed.executable), launchCommand: '& ' + quote(managed.executable) + (managed.js ? ' ' + quote(managed.entry) : '') }; }
      catch { local = { state: 'broken', version: managed.version, managed: true, runnable: false }; }
    } else if (fs.existsSync(path.join(root, agent, 'active.json'))) { local = { state: 'broken', version: null, managed: true, runnable: false }; }
    else {
      const found = agent === 'antigravity' ? await discoverAntigravity(environment) : await discoverAgentRuntime(agent, environment);
      const files = agent === 'antigravity' ? found.candidates.map(row => row.executable) : found.entries.filter(row => row.kind === 'executable').map(row => row.path);
      const info = await host('metadata', { files, executable: plans[agent].executable || '' }, cwd);
      const versions = (info.entries || []).map(row => ({ path: row.path, version: version(row.version) })).filter(row => row.version);
      // npm package metadata is installation metadata, never npmrc/auth/config.
      if (plans[agent].package) {
        try { const file = packagePath(path.join(environment.appData, 'npm'), plans[agent].package) + path.sep + 'package.json'; const pkg = readJSON(file); if (pkg.name === plans[agent].package && version(pkg.version)) versions.push({ version: version(pkg.version), path: path.dirname(file) }); } catch {}
      }
      const hasEntry = agent === 'antigravity' ? found.candidates.length || found.launchers.length : found.entries.length;
      local = versions.length === 1 ? { state: 'installed', ...versions[0], managed: false, runnable: null } : versions.length > 1 ? { state: 'multiple', version: null, managed: false, runnable: null } : { state: !found.coverage.complete ? 'incomplete' : hasEntry ? 'unverified' : 'missing', version: null, managed: false, runnable: null };
    }
    let latest = null, checkError = null;
    if (remote) { try { stage('checking'); latest = (await metadata(agent)).version; } catch (error) { checkError = /^INSTALL_[A-Z_]+$/.test(error?.message) ? error.message : 'INSTALL_CHECK_FAILED'; } }
    return { ...local, latest, checkError };
  }
  async function nodeRuntime(cwd) {
    const manifest = own(root, path.join(root, 'node', 'active.json'));
    try { const saved = readJSON(manifest); own(root, saved.executable); if (sha(saved.executable) === saved.hash) return saved.executable; } catch {}
    stage('dependency');
    const sums = await text('https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt', 'node');
    const match = new RegExp('^([a-f0-9]{64})\\s+(node-v24\\.[0-9.]+-win-' + environment.arch + '\\.zip)\\s*$', 'm').exec(sums);
    if (!match) throw new Error('INSTALL_DEPENDENCY_FAILED');
    const zip = own(root, path.join(cwd, 'node.zip'));
    const downloaded = await http('https://nodejs.org/dist/latest-v24.x/' + match[2], { scope: 'node', signal, file: zip, limit: 150 * 1024 * 1024, progress: data => stage('dependency', data) });
    if (downloaded.hash !== match[1]) throw new Error('INSTALL_CHECKSUM_FAILED');
    const destination = own(root, path.join(root, 'node', crypto.randomUUID())); await host('expand', { source: zip, destination }, cwd);
    const executable = own(root, path.join(destination, match[2].slice(0, -4), 'node.exe'));
    if (!/^v24\./.test((await execute(executable, ['--version'], cwd)).trim())) throw new Error('INSTALL_DEPENDENCY_FAILED');
    const saved = { executable, hash: sha(executable) }; fs.mkdirSync(path.dirname(manifest), { recursive: true }); fs.writeFileSync(manifest + '.tmp', JSON.stringify(saved), { mode: 0o600 }); fs.renameSync(manifest + '.tmp', manifest); return executable;
  }
  function findBinary(directory, names) {
    const pending = [directory]; let checked = 0;
    while (pending.length) { const current = own(root, pending.pop()); for (const entry of fs.readdirSync(current, { withFileTypes: true })) { if (++checked > 5000) throw new Error('INSTALL_LAYOUT_UNSUPPORTED'); const file = own(root, path.join(current, entry.name)); if (entry.isSymbolicLink()) continue; if (entry.isDirectory()) pending.push(file); else if (names.includes(entry.name.toLowerCase())) return file; } }
    throw new Error('INSTALL_LAYOUT_UNSUPPORTED');
  }
  async function install(agent) {
    if (!['x64', 'arm64'].includes(environment.arch) || process.platform !== 'win32') throw new Error('INSTALL_PLATFORM_UNSUPPORTED');
    requireProductRoute(agent);
    const plan = plans[agent], cwd = work(); stage('resolving'); let latest;
    try { latest = await metadata(agent); } catch (error) {
      if (agent !== 'cursor' || signal?.aborted) throw error;
      latest = { version: null, url: 'https://cursor.com/api/download?platform=win32-' + environment.arch + '&releaseTrack=stable', hash: null, algorithm: 'sha256', source: 'official-download-and-signature' };
    }
    canceled();
    const generation = own(root, path.join(root, agent, crypto.randomUUID())); fs.mkdirSync(generation, { recursive: true });
    if (agent === 'codex' || agent === 'claude') {
      const executable = await nativePackage(agent, latest, generation);
      const saved = { agent, version: latest.version, executable, executableHash: sha(executable), js: false, binDirectory: path.dirname(executable) };
      stage('postcheck'); await probe(saved, cwd); canceled(); activate(agent, saved); return { installed: true, version: saved.version };
    }
    if (plan.kind === 'desktop' || plan.kind === 'binary') {
      const file = own(root, path.join(generation, plan.binary || 'installer.exe')); stage('downloading');
      const download = await http(latest.url, { scope: agent, signal, file, hash: latest.algorithm, limit: 1024 * 1024 * 1024, progress: data => stage('downloading', data) });
      stage('verifying'); if (latest.hash && download.hash !== latest.hash) throw new Error('INSTALL_CHECKSUM_FAILED');
      if (plan.kind === 'desktop') {
        const signature = await host('signature', { file, publisher: plan.publisher }, cwd); if (!signature.valid) throw new Error('INSTALL_SIGNATURE_FAILED');
        const targetVersion = latest.version || version(signature.version); if (!targetVersion) throw new Error('INSTALL_VERSION_UNVERIFIED');
        return { awaitingInstaller: true, path: file, sha256: sha(file), version: targetVersion };
      }
      const saved = { agent, version: latest.version, executable: file, executableHash: sha(file), js: false }; stage('postcheck'); await probe(saved, cwd); canceled(); activate(agent, saved); return { installed: true, version: saved.version };
    }
    const node = await nodeRuntime(cwd), prefix = own(root, path.join(generation, 'prefix'));
    const packageName = plan.kind === 'npm-native' ? plan.platform(environment.arch) : plan.package;
    // A clean prefix repairs missing optional binaries without uninstalling an
    // existing installation. No lifecycle scripts or arbitrary npmrc are used.
    const config = own(root, path.join(cwd, 'empty-user.npmrc')), globalConfig = own(root, path.join(cwd, 'empty-global.npmrc')); fs.writeFileSync(config, '', { flag: 'wx' }); fs.writeFileSync(globalConfig, '', { flag: 'wx' });
    const npm = path.join(path.dirname(node), 'node_modules/npm/bin/npm-cli.js');
    const processEnv = { ...env, ...privateEnv, PATH: path.dirname(node) + path.delimiter + path.join(environment.systemRoot, 'System32'), npm_config_cache: own(root, path.join(root, 'npm-cache')), npm_config_update_notifier: 'false' };
    stage('installing'); await execute(node, [npm, 'install', '--global', '--prefix', prefix, '--registry=https://registry.npmjs.org', '--userconfig=' + config, '--globalconfig=' + globalConfig, '--ignore-scripts', '--include=optional', '--no-audit', '--no-fund', '--no-progress', packageName + '@' + latest.version], cwd, 600000, processEnv, true);
    const folder = packagePath(prefix, packageName), pkg = readJSON(path.join(folder, 'package.json')); if (pkg.name !== packageName || pkg.version !== latest.version) throw new Error('INSTALL_METADATA_INVALID');
    const entry = plan.js ? own(root, path.join(folder, plan.entry)) : findBinary(folder, [plan.binary, plan.alternate].filter(Boolean));
    const saved = { agent, version: latest.version, executable: plan.js ? node : entry, executableHash: sha(plan.js ? node : entry), entry: plan.js ? entry : null, entryHash: plan.js ? sha(entry) : null, js: plan.js === true, binDirectory: plan.js ? prefix : path.dirname(entry) };
    stage('postcheck'); await probe(saved, cwd); canceled(); activate(agent, saved); return { installed: true, version: saved.version };
  }
  function activate(agent, saved) {
    const active = own(root, path.join(root, agent, 'active.json')); fs.writeFileSync(active + '.tmp', JSON.stringify(saved), { mode: 0o600 }); fs.renameSync(active + '.tmp', active);
  }
  return { inspect, install, metadata };
}
module.exports = { makeEngine, own, readActiveRuntime };
