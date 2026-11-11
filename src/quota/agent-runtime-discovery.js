'use strict';
const fs = require('node:fs/promises');
const path = require('node:path').win32;
const catalog = require('./agent-setup-catalog');
function local(value) {
  return typeof value === 'string' && value.length <= 32760 && /^[a-z]:[\\/]/i.test(value) && !/[\x00-\x1f"<>|?*%]/.test(value) && !value.slice(2).includes(':') && !value.split(/[\\/]/).some(part => part === '..' || /[. ]$/.test(part)) ? path.normalize(value) : null;
}
async function discoverAgentRuntime(agent, environment, io = fs, budgetMs = 2000) {
  if (!Object.hasOwn(catalog, agent) || agent === 'antigravity') throw new Error('SETUP_AGENT_REJECTED');
  const definition = catalog[agent], entries = [], issues = new Set(), directories = new Map(), seen = new Set();
  let complete = true, checkedPaths = 0;
  const result = () => ({ schemaVersion: 'AgentRuntimeDiscoveryV1', agent, checkedAt: new Date().toISOString(), entries, coverage: { complete, checkedPaths, issues: [...issues] }, effects: { executedCli: false, readCredentials: false, readConfiguration: false, requestedQuota: false } });
  if (environment.platform !== 'win32') { complete = false; issues.add('PLATFORM_UNSUPPORTED'); return result(); }
  const home = local(environment.home), appData = local(environment.appData), localAppData = local(environment.localAppData);
  const add = value => { const safe = local(value); if (safe) directories.set(safe.toLowerCase(), safe); };
  if (!home || !localAppData || !appData) { complete = false; issues.add('ROOT_UNAVAILABLE'); }
  if (home) for (const suffix of definition.home || []) add(path.join(home, suffix));
  if (localAppData) for (const suffix of definition.local || []) add(path.join(localAppData, suffix));
  for (const root of [local(environment.programFiles), local(environment.programFilesX86)].filter(Boolean)) for (const suffix of definition.local || []) if (suffix.startsWith('Programs/')) add(path.join(root, suffix.slice('Programs/'.length)));
  if (appData && !definition.desktop) add(path.join(appData, 'npm'));
  if (home) add(path.join(home, 'scoop/shims'));
  let search = typeof environment.path === 'string' ? environment.path : '';
  if (search.length > 65536) { search = ''; complete = false; issues.add('PATH_LIMIT'); }
  const variables = { USERPROFILE: home, APPDATA: appData, LOCALAPPDATA: localAppData, PROGRAMFILES: local(environment.programFiles), 'PROGRAMFILES(X86)': local(environment.programFilesX86) };
  for (let entry of search.split(';')) {
    entry = entry.trim(); if (!entry) continue;
    if (entry.startsWith('"') && entry.endsWith('"')) entry = entry.slice(1, -1);
    entry = entry.replace(/%([^%]+)%/g, (match, key) => variables[key.toUpperCase()] || match);
    if (!local(entry)) { issues.add('PATH_ENTRY_SKIPPED'); continue; }
    if (directories.has(local(entry).toLowerCase())) continue;
    if (directories.size >= 128) { complete = false; issues.add('DIRECTORY_LIMIT'); break; }
    add(entry);
  }
  const deadline = Date.now() + budgetMs;
  for (const directory of directories.values()) for (const name of definition.names) {
    const file = path.join(directory, name), key = file.toLowerCase(); if (seen.has(key)) continue;
    seen.add(key);
    if (checkedPaths >= 1024 || Date.now() >= deadline) { complete = false; issues.add('SCAN_LIMIT'); return result(); }
    checkedPaths++; let timer;
    try {
      const stat = await Promise.race([io.lstat(file), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SCAN_TIMEOUT')), Math.max(1, deadline - Date.now())); })]);
      if (stat.isFile() || stat.isSymbolicLink()) entries.push({ path: file, kind: stat.isSymbolicLink() ? 'link' : /\.exe$/i.test(name) ? 'executable' : 'launcher', trust: 'unverified' });
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') { complete = false; issues.add(error?.message === 'SCAN_TIMEOUT' ? 'SCAN_TIMEOUT' : 'METADATA_UNAVAILABLE'); }
      if (error?.message === 'SCAN_TIMEOUT') return result();
    } finally { clearTimeout(timer); }
  }
  return result();
}
module.exports = { discoverAgentRuntime };
