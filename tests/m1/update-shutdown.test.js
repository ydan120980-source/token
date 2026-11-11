'use strict';
// Exercise the actual main-process shutdown and before-quit wiring without
// starting Electron, opening a source directory, or running an installer.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { UpdateService } = require('../../src/quota/update-service');
const main = fs.readFileSync(path.join(__dirname, '../../src/quota/main.js'), 'utf8');

function setup(t, stops) {
  const events = [], app = new EventEmitter();
  app.quit = () => events.push('quit');
  const context = vm.createContext({
    quitting: false, app, desktopShell: { close: () => events.push('tray-closed') },
    readHistory: null, github: null, service: null, usage: null, priceSync: null, installers: null, providerQuota: null, configHealth: null,
    dialog: { showErrorBox: () => events.push('shutdown-error') }, ...stops,
  });
  const start = main.indexOf('let stopping = null'), end = main.indexOf('if (!app.requestSingleInstanceLock())');
  assert(start >= 0 && end > start, 'the production shutdown block is present');
  vm.runInContext(main.slice(start, end), context);
  const updater = new EventEmitter();
  updater.quitAndInstall = (...args) => { events.push('install'); updater.installed = args; };
  const updates = new UpdateService({
    autoUpdater: updater, supported: true, app: { getVersion: () => '0.1.0' },
    beforeInstall: () => vm.runInContext('shutdown()', context),
  });
  context.updates = updates;
  t.after(() => updates.close());
  updater.emit('update-downloaded', { version: '0.1.1' });
  const quitStart = main.lastIndexOf("  app.on('before-quit', event => {");
  assert(quitStart >= 0, 'the actual application quit handler is present');
  vm.runInContext(main.slice(quitStart, main.lastIndexOf('\n}')), context);
  return { updates, updater, context, events, app };
}

test('main waits for every close, propagates failure and retries only failed owners', async t => {
  let finishSlow, tries = 0, slowCloses = 0;
  const slow = new Promise(resolve => { finishSlow = resolve; });
  const { updates, updater, events } = setup(t, {
    service: { close: () => { if (++tries === 1) throw new Error('synthetic close failure'); } },
    usage: { close: () => { slowCloses += 1; return slow; } },
  });
  const install = updates.install();
  const rejected = assert.rejects(install, /UPDATE_INSTALL_FAILED/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updater.installed, undefined);
  assert.equal(updates.installing, true, 'other closes are still awaited after the first failed');
  finishSlow();
  await rejected;
  assert.equal(updater.installed, undefined, 'a failed shutdown never starts the installer');
  assert.equal(updates.stateNow().status, 'downloaded');
  assert.equal(updates.stateNow().error, 'UPDATE_INSTALL_FAILED');
  assert.equal(updates.closing, false, 'the update bridge is still live');
  assert.equal(events.includes('tray-closed'), false, 'the person can still exit through the tray');
  await updates.install();
  assert.deepEqual(updater.installed, [true, true]);
  assert.equal(tries, 2);
  assert.equal(slowCloses, 1, 'a successfully stopped owner is not closed twice');
});

test('before-quit cannot bypass failed preparation and closes the update bridge only on actual exit', async t => {
  let tries = 0;
  const { updates, events, app } = setup(t, { service: { close: () => { if (++tries === 1) return Promise.reject(new Error('synthetic close failure')); } } });
  let prevented = 0;
  const event = { preventDefault: () => { prevented += 1; } };
  app.emit('before-quit', event);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, 1);
  assert.equal(events.includes('quit'), false);
  assert.equal(events.includes('shutdown-error'), true);
  assert.equal(updates.closing, false);
  app.emit('before-quit', event);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, 2, 'quitting=true cannot bypass a failed close');
  assert.equal(events.filter(value => value === 'quit').length, 1);
  app.emit('before-quit', event);
  assert.equal(prevented, 2, 'a completed preparation may exit');
  assert.equal(updates.closing, true);
  assert.equal(events.includes('tray-closed'), true);
});
