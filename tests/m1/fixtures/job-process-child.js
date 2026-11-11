'use strict';
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const [mode, report, ...args] = process.argv.slice(2);
if (mode === 'args') process.stdout.write(JSON.stringify([report, ...args]));
else if (mode === 'env') process.stdout.write(JSON.stringify(Object.keys(process.env)));
else if (mode === 'hang') { setInterval(() => {}, 1000); }
else if (mode === 'flood') { setInterval(() => process.stderr.write('秘密'.repeat(20000)), 1); }
else if (['orphan', 'tree'].includes(mode)) {
  const child = spawn(process.execPath, [__filename, 'hang'], { detached: true, shell: false, windowsHide: true, stdio: 'ignore' });
  fs.writeFileSync(report+'.tmp', JSON.stringify({ root: process.pid, descendant: child.pid }));fs.renameSync(report+'.tmp',report); child.unref();
  if (mode === 'orphan') setTimeout(() => process.exit(0), 200);
  else setInterval(() => {}, 1000);
} else process.exitCode = 2;
