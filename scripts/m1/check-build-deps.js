'use strict';
// Runs before electron-builder. When node_modules (or @tokscale inside it) is a
// junction or symbolic link, electron-builder silently leaves @tokscale out of the
// package; audit:package then fails after a full build. Stop here instead, and
// check the native binary the package will copy against its pinned version and hash.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../..'));
const linked = ['node_modules', 'node_modules/@tokscale'].filter(dir => {
  try { return fs.lstatSync(path.join(root, dir)).isSymbolicLink(); } catch { return false; }
});
if (linked.length) {
  console.error('FAIL: ' + linked.join(', ') + ' is a junction or symbolic link; electron-builder would drop @tokscale from the package.\n' +
    'Build from a directory whose node_modules is a real copy (npm ci, or robocopy /E from another tree).');
  process.exit(1);
}
const { TOKSCALE, trustedBinary } = require('../../src/m1/native');
const native = path.join(root, 'node_modules/@tokscale/cli-win32-x64-msvc');
const version = JSON.parse(fs.readFileSync(path.join(native, 'package.json'), 'utf8')).version;
if (version !== TOKSCALE.version) {
  console.error('FAIL: node_modules has tokscale ' + version + ', src/m1/native.js pins ' + TOKSCALE.version + '.');
  process.exit(1);
}
trustedBinary(path.join(native, 'bin/tokscale.exe'));
console.log('PASS: node_modules is a real directory; tokscale ' + TOKSCALE.version + ' matches its pinned SHA-256.');
