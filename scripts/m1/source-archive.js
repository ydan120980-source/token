'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { python } = require('./python');
const result = spawnSync(python(), ['-X', 'utf8', path.join(__dirname, 'package-quota.py'), '--source-only'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error('SOURCE_ARCHIVE_FAILED');
process.stdout.write(result.stdout);
