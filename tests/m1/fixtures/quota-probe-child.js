'use strict';
// Only synthetic Node processes; never load or launch a provider CLI.
const { spawn } = require('node:child_process');
const { response } = require('./antigravity-quota');
const [mode, ...args] = process.argv.slice(2);
if (mode === 'version') process.stdout.write('Antigravity CLI v1.2.11\n');
else if (mode === 'usage') process.stdout.write(JSON.stringify(response()));
else if (mode === 'error') { process.stderr.write('PRIVATE_CREDENTIAL_AND_PATH'); process.exitCode = 1; }
else if (mode === 'flood') { setInterval(() => process.stderr.write('秘密'.repeat(20000)), 1); }
else if (mode === 'tree') {
  const child = spawn(process.execPath, [__filename, 'hang'], { shell: false, windowsHide: true, stdio: 'ignore' });
  process.stdout.write(String(child.pid) + '\n'); setInterval(() => {}, 1000);
} else if (mode === 'hang') { setInterval(() => {}, 1000); }
else if (mode === 'args') process.stdout.write(JSON.stringify(args));
else process.exitCode = 2;
