'use strict';
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const python = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const result = spawnSync(python, ['-X', 'utf8', path.join(__dirname, 'governance.py')], { encoding: 'utf8', windowsHide: true });
if (result.status !== 0) throw new Error('GOVERNANCE_FAILED');
process.stdout.write(result.stdout);
