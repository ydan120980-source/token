'use strict';
const fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process');
// Launch the installed browser normally: no debug port, profile access, cookies,
// injected extension, shell command or application-owned browser window.
function findChrome(environment = process.env) {
  const candidates = [environment.ProgramW6432, environment.ProgramFiles, environment['ProgramFiles(x86)'], environment.LOCALAPPDATA].filter(Boolean).map(root => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  for (const candidate of [...new Set(candidates)]) {
    try { const stat = fs.lstatSync(candidate); if (stat.isFile() && !stat.isSymbolicLink()) return candidate; } catch { /* Continue fixed installation locations. */ }
  }
  throw new Error('PROVIDER_CHROME_MISSING');
}
function openChrome(value, { environment = process.env, launch = spawn, executable = null } = {}) {
  let url; try { url = new URL(value); } catch { return Promise.reject(new Error('PROVIDER_ACTION_INVALID')); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || value.length > 16384) return Promise.reject(new Error('PROVIDER_ACTION_INVALID'));
  return new Promise((resolve, reject) => {
    let child;
    try { child = launch(executable || findChrome(environment), ['--new-tab', url.href], { shell: false, detached: true, windowsHide: false, stdio: 'ignore' }); }
    catch (error) { reject(new Error(error.message === 'PROVIDER_CHROME_MISSING' ? error.message : 'PROVIDER_BROWSER_FAILED')); return; }
    child.once('error', () => reject(new Error('PROVIDER_BROWSER_FAILED')));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
module.exports = { findChrome, openChrome };
