'use strict';
const path = require('node:path');
const MIN_VERSION = '1.1.11', MAX_REVIEWED_VERSION = '1.4.2';
const MAX_OUTPUT_BYTES = 512 * 1024;
function version(text) {
  if (typeof text !== 'string' || text.length > 120) return null;
  const match = /^(?:(?:Antigravity(?: CLI)?|agy)\s+)?(?:version\s+|v)?(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\s*$/i.exec(text.trim());
  return match ? match.slice(1).join('.') : null;
}
function supportedVersion(value) {
  const parsed = version(value);
  if (!parsed) return false;
  const number = v => v.split('.').reduce((sum, part) => sum * 10000 + Number(part), 0);
  return number(parsed) >= number(MIN_VERSION) && number(parsed) <= number(MAX_REVIEWED_VERSION);
}
function commandPlan(executable) {
  // A selected/discovered Windows executable; never resolve a bare PATH
  // command at spawn time, execute a shell, or run an npm shim.
  if (typeof executable !== 'string' || executable.length > 32760 || !/^[A-Za-z]:[\\/]/.test(executable) || /[\x00-\x1f"<>|?*]/.test(executable) || !/\.exe$/i.test(executable) || executable.slice(2).includes(':') || executable.split(/[\\/]/).some(v => v === '..' || /[. ]$/.test(v))) throw new Error('AGY_EXECUTABLE_REQUIRED');
  const selected = path.win32.normalize(executable);
  return Object.freeze({ schemaVersion: 'AntigravityCommandPlanV1', executable: selected,
    version: Object.freeze({ args: Object.freeze(['--version']), timeoutMs: 5000, maxOutputBytes: MAX_OUTPUT_BYTES }),
    usage: Object.freeze({ args: Object.freeze(['-p', '/usage', '--output-format', 'json', '--print-timeout', '20s']), timeoutMs: 30000, maxOutputBytes: MAX_OUTPUT_BYTES }),
    shell: false, windowsHide: true, identityScope: 'cli-current-account-unverified', liveEnabled: false });
}
module.exports = { version, supportedVersion, commandPlan, MIN_VERSION, MAX_REVIEWED_VERSION, MAX_OUTPUT_BYTES };
