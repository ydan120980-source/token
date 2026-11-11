'use strict';
// Application updates against a fake updater; no test here reaches GitHub, downloads a file or installs anything.
// The real electron-updater needs electron.app and electron.net, so it is replaced by a small stand-in that emits the
// same events and records what the service asked it to do.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider');
const { UpdateService, describe, CODES } = require('../../src/quota/update-service');

class FakeUpdater {
  constructor() { this.listeners = new Map(); this.autoDownload = true; this.autoInstallOnAppQuit = true; this.allowPrerelease = false; this.calls = []; }
  on(name, listener) { const list = this.listeners.get(name) ?? []; list.push(listener); this.listeners.set(name, list); }
  off(name, listener) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(item => item !== listener)); }
  emit(name, value) { for (const listener of this.listeners.get(name) ?? []) listener(value); }
  async checkForUpdates() { this.calls.push('check'); return this.result ?? { isUpdateAvailable: false }; }
  downloadUpdate(token) { this.calls.push('download'); this.token = token; return this.transfer ?? Promise.resolve([]); }
  quitAndInstall(isSilent, isForceRunAfter) { this.calls.push('install'); this.installed = { isSilent, isForceRunAfter }; }
}

const INFO = { version: '0.2.0', releaseDate: '2026-11-08T00:00:00.000Z' };
function setup(t, { packaged = true, feed = true, updater = new FakeUpdater(), options = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configFile = path.join(dir, 'app-update.yml');
  if (feed) fs.writeFileSync(configFile, 'provider: github\nowner: demo-owner\nrepo: demo-repo\nupdaterCacheDirName: demo-updater\n', 'utf8');
  const app = { isPackaged: packaged, getVersion: () => '0.1.0' };
  const seen = [];
  const service = new UpdateService({ autoUpdater: updater, app, configFile, onChange: () => seen.push({ ...service.state }), startupDelay: 5, interval: 5, ...options });
  t.after(() => service.close());
  return { service, updater, seen, dir, configFile };
}

test('a development run or a build without update metadata says so instead of opening a connection', async t => {
  for (const options of [{ packaged: false }, { packaged: true, feed: false }]) {
    const { service, updater } = setup(t, options);
    assert.equal(service.supported, false);
    const state = service.stateNow();
    assert.equal(state.status, 'unconfigured'); assert.equal(state.current, '0.1.0');
    await assert.rejects(service.check(), /UPDATE_NOT_CONFIGURED/);
    assert.deepEqual(updater.calls, [], 'nothing was asked of the updater');
  }
});

test('a configured build reads its feed, checks, downloads on its own and offers a restart', async t => {
  const { service, updater, seen } = setup(t);
  assert.equal(service.supported, true);
  assert.equal(service.stateNow().status, 'idle');
  assert.equal(updater.autoDownload, false, 'the download starts here, not inside the check');
  assert.equal(updater.autoInstallOnAppQuit, false, 'nothing installs on quit');
  assert.equal(updater.allowPrerelease, true, 'this project ships preview builds');

  let finish;
  updater.transfer = new Promise(resolve => { finish = resolve; });
  updater.result = { isUpdateAvailable: true, updateInfo: INFO };
  updater.checkForUpdates = async () => { updater.calls.push('check'); updater.emit('update-available', INFO); return updater.result; };
  const afterCheck = await service.check();
  assert.equal(afterCheck.status, 'downloading');
  assert.equal(afterCheck.latest.version, '0.2.0');
  assert.equal(afterCheck.latest.url, 'https://github.com/demo-owner/demo-repo/releases/tag/v0.2.0');
  assert.equal(afterCheck.latest.publishedAt, '2026-11-08T00:00:00.000Z');
  assert.deepEqual(updater.calls, ['check', 'download']);

  updater.emit('download-progress', { percent: 41.6, transferred: 1048576, total: 2621440, bytesPerSecond: 524288 });
  const downloading = service.stateNow();
  assert.equal(downloading.status, 'downloading');
  assert.deepEqual(downloading.progress, { percent: 42, transferred: 1048576, total: 2621440, bytesPerSecond: 524288 });

  updater.emit('update-downloaded', INFO);
  const downloaded = service.stateNow();
  assert.equal(downloaded.status, 'downloaded');
  assert.equal(downloaded.progress.percent, 100);
  assert.match(downloaded.downloadedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert(seen.length > 0, 'every change was published to the window');

  await service.install();
  assert.deepEqual(updater.installed, { isSilent: true, isForceRunAfter: true }, 'silent install that starts the new version again');
  finish([]);
});

test('an out-of-date-free build reports the latest version, and an empty repository is not a failure', async t => {
  const { service, updater } = setup(t);
  updater.emit('update-not-available');
  assert.equal(service.stateNow().status, 'latest');
  assert.equal(service.stateNow().latest, null);
  const offline = Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' });
  updater.emit('error', offline);
  assert.equal(service.stateNow().error, 'UPDATE_OFFLINE');
  updater.emit('error', Object.assign(new Error('No published versions on GitHub'), { code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' }));
  assert.equal(service.stateNow().status, 'latest', 'a repository without a release answers latest, not an error');
  assert.equal(service.stateNow().error, null);
});

test('cancelling a download keeps the version available, and nothing installs before it is downloaded', async t => {
  const { service, updater } = setup(t);
  await assert.rejects(service.install(), /UPDATE_NOT_READY/);
  assert.deepEqual(updater.calls, []);
  updater.result = { isUpdateAvailable: true, updateInfo: INFO };
  updater.checkForUpdates = async () => { updater.emit('update-available', INFO); return updater.result; };
  let reject;
  updater.transfer = new Promise((_resolve, fail) => { reject = fail; });
  await service.check();
  assert.equal(service.stateNow().status, 'downloading');
  await assert.rejects(service.check(), /UPDATE_BUSY/, 'one transfer at a time');
  const cancelled = service.cancel();
  assert.equal(cancelled.status, 'available');
  assert.equal(updater.token.cancelled, true);
  assert.throws(() => service.cancel(), /UPDATE_NOT_READY/, 'there is nothing left to cancel');
  // The transfer rejects after the token was released. That late rejection is this
  // download's own cancellation, not a failure: the version stays available.
  reject(Object.assign(new Error('cancelled'), { code: 'CancellationError' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.stateNow().status, 'available', 'a cancelled download does not become an error');
  assert.equal(service.stateNow().error, null);
});

test('a retry waits for cancellation to settle before starting the replacement', async t => {
  const { service, updater } = setup(t);
  updater.result = { isUpdateAvailable: true, updateInfo: INFO };
  updater.checkForUpdates = async () => { updater.emit('update-available', INFO); return updater.result; };
  let failFirst;
  updater.transfer = new Promise((_resolve, fail) => { failFirst = fail; });
  await service.check();
  const first = updater.token;
  service.cancel();
  updater.transfer = new Promise(() => {});
  // The old promise is still owned even after cancel: starting another download
  // now would attach a new token to electron-updater's existing downloadPromise.
  service.download();
  assert.equal(updater.token, first, 'nothing starts before cancellation finishes');
  const retry = service.check();
  failFirst(Object.assign(new Error('late failure'), { code: 'ECONNRESET' }));
  await retry;
  assert.notEqual(updater.token, first, 'the second download has its own token');
  assert.equal(service.stateNow().status, 'downloading');
  assert.equal(service.stateNow().error, null);
});

test('cancel and immediate recheck use two transfers with the real updater promise lifecycle', async t => {
  const { AppUpdater } = require('electron-updater/out/AppUpdater');
  const updater = new FakeUpdater();
  updater.downloadUpdate = AppUpdater.prototype.downloadUpdate;
  updater._logger = { info() {}, warn() {} };
  updater.updateInfoAndProvider = { info: { files: [{ url: 'synthetic-installer.exe' }] }, provider: {} };
  updater.computeRequestHeaders = () => ({});
  updater.dispatchError = error => updater.emit('error', error);
  let endCancellation;
  const cancelled = new Promise(resolve => { endCancellation = resolve; });
  let transfers = 0;
  updater.doDownloadUpdate = ({ cancellationToken }) => {
    transfers += 1;
    return cancellationToken.createPromise(() => {}).catch(async error => {
      await cancelled;
      updater.emit('update-cancelled');
      throw error;
    });
  };
  updater.result = { isUpdateAvailable: true, updateInfo: INFO };
  const { service } = setup(t, { updater });
  await service.check();
  service.cancel();
  const retry = service.check();
  updater.emit('download-progress', { percent: 99, transferred: 99, total: 100 });
  updater.emit('update-downloaded', INFO);
  updater.emit('error', Object.assign(new Error('cancelled transfer'), { code: 'ECONNRESET' }));
  assert.equal(transfers, 1);
  assert.equal(service.stateNow().status, 'available', 'cancelled transfer events cannot restore downloading or downloaded');
  assert.equal(service.stateNow().error, null);
  endCancellation();
  await retry;
  assert.equal(transfers, 2, 'the retry starts after the real updater releases its old promise');
  assert.equal(service.stateNow().status, 'downloading');
  assert.equal(service.stateNow().error, null);
});

test('the restart waits for this app to finish its own shutdown before the installer starts', async t => {
  const order = [];
  let release;
  const stopped = new Promise(resolve => { release = resolve; });
  const { service, updater } = setup(t, { options: { beforeInstall: async () => { order.push('shutdown-start'); await stopped; order.push('shutdown-done'); } } });
  updater.emit('update-downloaded', INFO);
  assert.equal(service.stateNow().status, 'downloaded');
  const installing = service.install();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['shutdown-start'], 'the installer has not started yet');
  assert.equal(updater.installed, undefined, 'no installer while services are still closing');
  await assert.rejects(service.install(), /UPDATE_BUSY/, 'one install at a time');
  release();
  await installing;
  assert.deepEqual(order, ['shutdown-start', 'shutdown-done']);
  assert.deepEqual(updater.installed, { isSilent: true, isForceRunAfter: true }, 'then the installer starts');
});

test('a shutdown that never finishes stopping this app does not start the installer', async t => {
  const { service, updater } = setup(t, { options: { beforeInstall: async () => { throw new Error('close failed'); } } });
  updater.emit('update-downloaded', INFO);
  await assert.rejects(service.install(), /UPDATE_INSTALL_FAILED/);
  assert.equal(updater.installed, undefined, 'nothing is replaced when the shutdown did not finish');
  const state = service.stateNow();
  assert.equal(state.status, 'downloaded', 'the downloaded update stays usable for another try');
  assert.equal(state.error, 'UPDATE_INSTALL_FAILED');
  assert.equal(service.installing, false, 'the guard is released so the person may try again');
});

test('installer error events keep the verified download retryable', async t => {
  const { service, updater } = setup(t);
  updater.emit('update-downloaded', INFO);
  updater.quitAndInstall = () => updater.emit('error', new Error('installer launch failed'));
  await assert.rejects(service.install(), /UPDATE_INSTALL_FAILED/);
  assert.equal(service.stateNow().status, 'downloaded');
  assert.equal(service.stateNow().error, 'UPDATE_INSTALL_FAILED');
  assert.equal(service.installing, false);
  updater.quitAndInstall = () => {};
  await service.install();
  updater.emit('error', new Error('late installer launch failure'));
  assert.equal(service.stateNow().status, 'downloaded');
  assert.equal(service.stateNow().error, 'UPDATE_INSTALL_FAILED');
  assert.equal(service.installing, false, 'an asynchronous launch failure also permits retry');
});

test('the release page comes from the feed beside the build, and only a plausible version becomes a link', async t => {
  const { service } = setup(t);
  assert.equal(service.releaseUrl('0.2.0'), 'https://github.com/demo-owner/demo-repo/releases/tag/v0.2.0');
  for (const bad of ['', 'latest', null, '../../etc', '<script>']) assert.equal(service.releaseUrl(bad), null, String(bad));
  const unconfigured = setup(t, { feed: false }).service;
  assert.equal(unconfigured.releaseUrl('0.2.0'), null, 'no feed means no page to offer');
});

test('an empty GitHub release feed reports no update and malformed entries still fail', async t => {
  const { service, updater } = setup(t);
  const provider = new GitHubProvider({ owner: 'demo-owner', repo: 'demo-repo' },
    { allowPrerelease: true, currentVersion: '0.1.0' },
    { platform: 'win32', executor: { request: async () => '<feed xmlns="http://www.w3.org/2005/Atom"/>' } });
  updater.checkForUpdates = () => provider.getLatestVersion();
  const state = await service.check();
  assert.equal(state.status, 'latest');
  assert.equal(state.error, null);
  assert.ok(state.checkedAt);

  updater.checkForUpdates = async () => {
    throw Object.assign(new Error('No element "link"'), { code: 'ERR_XML_MISSED_ELEMENT' });
  };
  const failure = await service.check();
  assert.equal(failure.status, 'error');
  assert.equal(failure.error, 'UPDATE_REQUEST_FAILED');
});

test('failure codes stay in the updater vocabulary and never read as a provider failure', () => {
  assert.match(describe({ code: 'ERR_UPDATER_INVALID_SIGNATURE' }), /^UPDATE_VERIFY_FAILED$/);
  assert.equal(describe({ code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' }), 'UPDATE_NOT_PUBLISHED');
  assert.equal(describe({ code: 'ERR_INTERNET_DISCONNECTED' }), 'UPDATE_OFFLINE');
  assert.equal(describe({ code: 'ETIMEDOUT' }), 'UPDATE_OFFLINE');
  assert.equal(describe({ code: 'ERR_UPDATER_INVALID_RELEASE_FEED' }), 'UPDATE_OFFLINE');
  assert.equal(describe({ message: 'boom' }), 'UPDATE_REQUEST_FAILED');
  for (const code of ['UPDATE_NOT_CONFIGURED', 'UPDATE_NOT_PUBLISHED', 'UPDATE_OFFLINE', 'UPDATE_REQUEST_FAILED', 'UPDATE_VERIFY_FAILED', 'UPDATE_BUSY', 'UPDATE_NOT_READY', 'UPDATE_INSTALL_FAILED']) assert(CODES.has(code), code);
});

test('the scheduled check waits for the window, runs once per interval and stops when the app closes', async t => {
  const updater = new FakeUpdater();
  let checks = 0;
  updater.checkForUpdates = async () => { checks += 1; return { isUpdateAvailable: false }; };
  const { service } = setup(t, { updater, options: { startupDelay: 5, interval: 100000 } });
  service.start(); service.start();
  assert.equal(checks, 0, 'nothing starts before the delay');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(checks, 1, 'the first check ran once, even though start was asked twice');
  service.close();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(checks, 1, 'closing stops the timer');
});

test('an unattended check skips a download already running instead of rejecting', async t => {
  // The window may be open before the start-up check fires; a person clicking
  // "check for updates" in that first second must not turn the timer into an
  // unhandled UPDATE_BUSY rejection.
  const rejections = [];
  const onRejection = error => rejections.push(error);
  process.on('unhandledRejection', onRejection);
  t.after(() => process.off('unhandledRejection', onRejection));

  const updater = new FakeUpdater();
  updater.result = { isUpdateAvailable: true, updateInfo: INFO };
  updater.checkForUpdates = async () => { updater.emit('update-available', INFO); return updater.result; };
  updater.transfer = new Promise(() => {});
  const { service } = setup(t, { updater, options: { startupDelay: 5, interval: 100000 } });
  service.start();
  await service.check();
  assert.equal(service.stateNow().status, 'downloading');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(service.stateNow().status, 'downloading', 'the timer left the running download alone');
  assert.deepEqual(rejections, [], 'no unhandled rejection escaped');
  service.close();
});
