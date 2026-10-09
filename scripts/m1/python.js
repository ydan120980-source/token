'use strict';
// Locate a Python 3 interpreter without assuming this development host's layout.
// Resolution order: explicit override, then PATH, then the legacy bundled runtime
// path some development machines used. Fails with a controlled code so callers can
// report a missing prerequisite instead of an ENOENT from spawnSync.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LEGACY = path.join(
  os.homedir(),
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
);

function works(candidate) {
  if (!candidate) return false;
  const probe = spawnSync(candidate, ['-X', 'utf8', '-c', 'import sys;print(sys.version_info[0])'], {
    encoding: 'utf8',
    windowsHide: true
  });
  return probe.status === 0 && String(probe.stdout).trim() === '3';
}

let cached = null;

function python() {
  if (cached) return cached;
  const candidates = [process.env.PYTHON, process.env.PYTHON3, ...(process.platform === 'win32' ? ['python.exe', 'python3.exe', 'py.exe'] : ['python3', 'python']), LEGACY];
  for (const candidate of candidates) {
    if (!candidate) continue;
    // Only absolute overrides are existence-checked; bare names are resolved by PATH.
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
    if (works(candidate)) {
      cached = candidate;
      return cached;
    }
  }
  throw new Error('PYTHON_RUNTIME_MISSING');
}

module.exports = { python };
