'use strict';
const fs = require('node:fs/promises');
const path = require('node:path').win32;
const MAX_PATH_CHARS = 65536, MAX_DIRECTORIES = 128, MAX_PROBES = 512;
function localPath(value) {
  return typeof value === 'string' && value.length <= 32760 && /^[A-Za-z]:[\\/]/.test(value) && !/[\x00-\x1f"<>|?*%]/.test(value) && !value.slice(2).includes(':') ? path.normalize(value) : null;
}
async function discoverAntigravity(environment, io = fs, budgetMs = 2000) {
  const issues = new Set(), candidates = new Map(), launchers = [], desktops = [];
  let checkedPaths = 0, complete = true, selectionUnsafe = false;
  const result = () => {
    const found = [...candidates.values()];
    const selection = !complete || selectionUnsafe ? 'incomplete' : found.length > 1 ? 'ambiguous' : found.length === 1 ? 'single-candidate' : 'none';
    return { schemaVersion: 'AntigravityDiscoveryV1', provider: 'antigravity', checkedAt: new Date().toISOString(), status: !complete ? 'partial' : selectionUnsafe ? 'candidate-rejected' : found.length ? 'candidates-found' : desktops.length ? 'desktop-only' : launchers.length ? 'launcher-only' : 'not-found',
      candidates: found, launchers, desktops, selection: { state: selection, executable: selection === 'single-candidate' ? found[0].executable : null, verificationRequired: true },
      coverage: { checkedPaths, complete, issues: [...issues].sort() }, effects: { executedCli: false, readCredentials: false, readConfiguration: false, requestedQuota: false } };
  };
  if (environment?.platform !== 'win32') { complete = false; issues.add('PLATFORM_UNSUPPORTED'); return result(); }
  if (!Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 2000) throw new Error('RUNTIME_DISCOVERY_INVALID');
  const home = localPath(environment.home), local = localPath(environment.localAppData), program = localPath(environment.programFiles), programX86 = localPath(environment.programFilesX86);
  if (!home || !local) { complete = false; issues.add('ROOT_UNAVAILABLE'); }
  const directories = new Map(), probes = [], seenPaths = new Set();
  const addDirectory = (value, origin) => { const safe = localPath(value); if (safe && !directories.has(safe.toLowerCase())) directories.set(safe.toLowerCase(), { path: safe, origin }); };
  if (local) addDirectory(path.join(local, 'agy/bin'), 'official-default');
  if (home) for (const suffix of ['.local/bin', '.antigravity/bin']) addDirectory(path.join(home, suffix), 'conventional');
  if (program) addDirectory(path.join(program, 'agy/bin'), 'conventional');
  if (programX86) addDirectory(path.join(programX86, 'agy/bin'), 'conventional');
  if (local) addDirectory(path.join(local, 'Microsoft/WinGet/Links'), 'conventional');
  let searchPath = typeof environment.path === 'string' ? environment.path : '';
  if (searchPath.length > MAX_PATH_CHARS) { searchPath = ''; complete = false; issues.add('PATH_LIMIT'); }
  const variables = { USERPROFILE: home, LOCALAPPDATA: local, PROGRAMFILES: program, 'PROGRAMFILES(X86)': programX86 };
  let pathDirectories = 0;
  for (let entry of searchPath.split(';')) {
    entry = entry.trim(); if (!entry) continue;
    if (entry.startsWith('"') && entry.endsWith('"')) entry = entry.slice(1, -1);
    entry = entry.replace(/%([^%]+)%/g, (match, name) => variables[name.toUpperCase()] || match);
    if (!localPath(entry)) { issues.add('PATH_ENTRY_SKIPPED'); continue; }
    if (directories.has(localPath(entry).toLowerCase())) continue;
    if (++pathDirectories > MAX_DIRECTORIES) { complete = false; issues.add('DIRECTORY_LIMIT'); break; }
    addDirectory(entry, 'path');
  }
  for (const directory of directories.values()) for (const name of ['agy.exe', 'agy.cmd', 'agy.ps1']) probes.push({ file: path.join(directory.path, name), origin: directory.origin, kind: name.endsWith('.exe') ? 'executable' : 'launcher' });
  for (const root of [local && path.join(local, 'Programs/Antigravity'), program && path.join(program, 'Antigravity'), programX86 && path.join(programX86, 'Antigravity')].filter(Boolean)) probes.push({ file: path.join(root, 'Antigravity.exe'), origin: 'desktop-install', kind: 'desktop' });
  const deadline = Date.now() + budgetMs;
  const metadata = async operation => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('SCAN_TIMEOUT');
    let timer;
    try { return await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SCAN_TIMEOUT')), remaining); })]); }
    finally { clearTimeout(timer); }
  };
  for (const probe of probes) {
    if (checkedPaths >= MAX_PROBES) { complete = false; issues.add('PROBE_LIMIT'); break; }
    if (seenPaths.has(probe.file.toLowerCase())) continue;
    seenPaths.add(probe.file.toLowerCase()); checkedPaths++;
    try {
      const stat = await metadata(() => io.lstat(probe.file));
      if (!stat.isFile() && !stat.isSymbolicLink()) continue;
      if (probe.kind === 'desktop') { desktops.push({ path: probe.file, origin: probe.origin, capability: 'desktop-presence-only' }); continue; }
      if (probe.kind === 'launcher') { launchers.push({ path: probe.file, origin: probe.origin, status: 'unsupported-launcher' }); continue; }
      // Resolve metadata aliases only; never read a shim, executable, settings,
      // auth file or arbitrary directory contents during discovery.
      const resolved = localPath(await metadata(() => io.realpath(probe.file)));
      if (!resolved || path.basename(resolved).toLowerCase() !== 'agy.exe') { selectionUnsafe = true; issues.add('CANDIDATE_TARGET_REJECTED'); continue; }
      const target = await metadata(() => io.lstat(resolved));
      if (!target.isFile() || target.isSymbolicLink()) { selectionUnsafe = true; issues.add('CANDIDATE_TARGET_REJECTED'); continue; }
      const key = resolved.toLowerCase(), existing = candidates.get(key);
      if (existing) { if (!existing.origins.includes(probe.origin)) existing.origins.push(probe.origin); }
      else candidates.set(key, { executable: resolved, origins: [probe.origin], trust: 'unverified', linked: stat.isSymbolicLink(), status: 'verification-required' });
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') continue;
      complete = false; issues.add(error?.message === 'SCAN_TIMEOUT' ? 'SCAN_TIMEOUT' : 'METADATA_UNAVAILABLE');
      if (error?.message === 'SCAN_TIMEOUT') break;
    }
  }
  return result();
}
module.exports = { discoverAntigravity };
