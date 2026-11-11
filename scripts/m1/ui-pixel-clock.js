'use strict';
// Capture-only clock preparation. Never imported by product code.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

function freezeFixtureTimes(home, temporaryRoot, fixedTime) {
  const root = fs.realpathSync(temporaryRoot), target = path.resolve(home);
  if (!Number.isFinite(fixedTime) || path.dirname(root) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(root).startsWith('ui-pixel-gate-') ||
      target !== path.join(root, 'home')) throw new Error('PIXEL_FIXTURE_ROOT_REJECTED');
  let files = 0;
  const walk = directory => {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || fs.realpathSync(directory) !== directory) throw new Error('PIXEL_FIXTURE_LINK_REJECTED');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name), item = fs.lstatSync(file);
      if (item.isSymbolicLink()) throw new Error('PIXEL_FIXTURE_LINK_REJECTED');
      if (item.isDirectory()) walk(file);
      else if (item.isFile()) { fs.utimesSync(file, item.atime, new Date(fixedTime)); files++; }
    }
  };
  walk(target);
  return { files, mtime: new Date(fixedTime).toISOString() };
}

// Standalone so Playwright can serialize it into Electron's test main process.
// usage:sources returns SourceDiscoveryV1 directly, not the quota state envelope.
function installSourceClock({ ipcMain }, fixedTime) {
  const handlers = ipcMain._invokeHandlers, original = handlers.get('usage:sources');
  if (typeof original !== 'function' || !Number.isFinite(fixedTime)) throw new Error('PIXEL_SOURCE_CLOCK_REJECTED');
  handlers.set('usage:sources', async (...args) => {
    const report = await original(...args);
    if (report?.schemaVersion !== 'SourceDiscoveryV1' || typeof report.checkedAt !== 'string') return report;
    return { ...report, checkedAt: new Date(fixedTime).toISOString() };
  });
}

module.exports = { freezeFixtureTimes, installSourceClock };
