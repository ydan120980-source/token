'use strict';
const path = require('node:path');
function passiveInstructions(root, executable, sourceDirectory, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('PROVIDER_ACTION_INVALID');
  const host = path.join(sourceDirectory.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'), 'claude-statusline-export.ps1');
  const script = path.join(sourceDirectory, 'provider-passive-export.js');
  const quote = value => { if (!path.isAbsolute(value) || /["%\r\n]/.test(value)) throw new Error('PROVIDER_ACTION_INVALID'); return '"' + value + '"'; };
  const command = 'powershell.exe -NoLogo -NoProfile -NonInteractive -File ' + quote(host) + ' -Executable ' + quote(executable) + ' -Script ' + quote(script) + ' -Connection ' + id + ' -Directory ' + quote(root);
  return JSON.stringify({ statusLine: { type: 'command', command } }, null, 2);
}
module.exports = { passiveInstructions };
