'use strict';
// Application updates: electron-updater with the NSIS installer and GitHub Releases
// (docs/m2/AUTO-UPDATE-20261108.md). Unlike the quota, public-price and installer
// channels this one cannot run in a child process — it needs electron.app and
// electron.net — so it lives in the main process behind this single module. It
// reaches the network only through electron-updater's own session partition
// ("electron-updater", no cache) and never through node:http, so the product-wide
// network guard stays in place. No GitHub account is involved: the feed address
// comes from resources/app-update.yml, which electron-builder writes only beside a
// packaged NSIS build, and a client sees a version only after the owner publishes
// the draft release.
const fs = require('node:fs');

// The updater's own vocabulary, kept apart from the quota error catalogue so an
// update failure is never reported as a provider failure.
const CODES = new Set([
  'UPDATE_NOT_CONFIGURED', 'UPDATE_NOT_PUBLISHED', 'UPDATE_OFFLINE', 'UPDATE_REQUEST_FAILED',
  'UPDATE_VERIFY_FAILED', 'UPDATE_BUSY', 'UPDATE_NOT_READY', 'UPDATE_INSTALL_FAILED',
]);

// A repository with no published release is not a failure: it is what a fresh
// project looks like before the first published version.
const UNPUBLISHED = /ERR_UPDATER_NO_PUBLISHED_VERSIONS|ERR_UPDATER_LATEST_VERSION_NOT_FOUND/;
const NO_METADATA = /ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/;

function describe(error) {
  const text = String(error?.code || '') + ' ' + String(error?.message || '');
  if (/ERR_UPDATER_INVALID_SIGNATURE|checksum|sha512/i.test(text)) return 'UPDATE_VERIFY_FAILED';
  if (NO_METADATA.test(text)) return 'UPDATE_NOT_PUBLISHED';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|net::ERR_|ERR_UPDATER_INVALID_RELEASE_FEED/i.test(text)) return 'UPDATE_OFFLINE';
  return 'UPDATE_REQUEST_FAILED';
}

function bytes(value) { return Number.isFinite(value) && value > 0 ? Math.round(value) : 0; }

class UpdateService {
  // Everything external is injected, so a test drives every state without
  // Electron, a network or an installation. autoUpdater may be a function, and
  // support may be a function returning a boolean, so a synthetic run can hand
  // in its own updater after start-up (as the GitHub fixture does).
  constructor({ autoUpdater, app, configFile, supported, beforeInstall, onChange = () => {}, now = () => Date.now(), startupDelay = 20000, interval = 6 * 60 * 60 * 1000 } = {}) {
    Object.assign(this, { source: autoUpdater ?? null, app: app ?? null, beforeInstall: beforeInstall ?? null, onChange, now, startupDelay, interval, configFile: configFile ?? null });
    this.fixed = typeof supported === 'boolean' ? supported : undefined;
    this.support = typeof supported === 'function' ? supported : null;
    this.current = this.currentVersion();
    // One download at a time, identified by its own task record: a cancelled or
    // superseded transfer must not be able to publish over a newer one, and a
    // late rejection must still be recognised as that download's cancellation.
    this.task = null;
    this.installing = false;
    this.startupTimer = null;
    this.intervalTimer = null;
    this.started = false;
    this.closing = false;
    this.changedAt = 0;
    this.listen = null;
    this.feed = this.readFeed();
    this.state = { supported: this.supported, status: this.supported ? 'idle' : 'unconfigured', current: this.current, latest: null, progress: null, downloadedAt: null, checkedAt: null, error: null };
    this.sync();
  }

  updater() {
    const value = typeof this.source === 'function' ? this.source() : this.source;
    return value ?? null;
  }

  get supported() {
    if (this.fixed !== undefined) return this.fixed;
    const forced = this.support?.();
    if (typeof forced === 'boolean') return forced;
    return this.probe();
  }

  currentVersion() {
    try { return this.app?.getVersion?.() ?? require('../../package.json').version; } catch { return null; }
  }

  // A development run, a directory build and a build without update metadata are
  // not configured; they say so instead of opening a connection.
  probe() {
    if (!this.updater() || !this.app?.isPackaged) return false;
    try { return Boolean(this.configFile) && fs.existsSync(this.configFile); } catch { return false; }
  }

  // Support can appear after start-up (a synthetic run handing in its updater)
  // and disappears with it; the window is shown what is true now.
  sync() {
    const supported = this.supported;
    if (supported) this.ensureWire();
    if (supported !== this.state.supported || this.current !== this.state.current) {
      this.state = { ...this.state, supported, current: this.current = this.currentVersion(), status: supported ? (this.state.status === 'unconfigured' ? 'idle' : this.state.status) : 'unconfigured' };
    }
    return supported;
  }

  ensureWire() {
    if (this.listen) return;
    const updater = this.updater();
    if (updater) this.listen = this.wire(updater);
  }

  // The owner and repository the build was published to, read back from the feed
  // file, so the release page link matches the installer that ships with it.
  readFeed() {
    try {
      const text = fs.readFileSync(this.configFile, 'utf8');
      const owner = /^\s*owner:\s*["']?([A-Za-z0-9-]+)["']?\s*$/m.exec(text), repo = /^\s*repo:\s*["']?([A-Za-z0-9_.-]+)["']?\s*$/m.exec(text);
      return owner && repo ? { owner: owner[1], repo: repo[1] } : null;
    } catch { return null; }
  }

  releaseUrl(version) {
    if (!this.feed || typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) return null;
    return 'https://github.com/' + this.feed.owner + '/' + this.feed.repo + '/releases/tag/v' + version;
  }

  info(source) {
    if (!source || typeof source.version !== 'string') return null;
    return { version: source.version, url: this.releaseUrl(source.version), publishedAt: typeof source.releaseDate === 'string' ? source.releaseDate : null };
  }

  wire(updater) {
    // The person decides when the app restarts, so nothing installs on quit and
    // the download starts here rather than inside the check. Prerelease versions
    // are accepted because this project ships preview builds; the channel file
    // stays latest.yml, which electron-builder writes beside every NSIS release.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = true;
    const at = () => new Date(this.now()).toISOString();
    const handlers = {
      'checking-for-update': () => { if (!this.closing && this.state.status !== 'downloading') this.publish({ status: 'checking', error: null }); },
      'update-available': info => {
        if (this.closing) return;
        this.publish({ status: 'available', latest: this.info(info) ?? this.state.latest, progress: null, error: null });
        this.download();
      },
      'update-not-available': () => { if (!this.closing) this.publish({ status: 'latest', latest: null, progress: null, checkedAt: at(), error: null }); },
      'download-progress': progress => { if (!this.closing && !this.task?.cancelled) this.track(progress, at); },
      'update-downloaded': info => { if (!this.closing && !this.task?.cancelled) this.publish({ status: 'downloaded', latest: this.info(info) ?? this.state.latest, downloadedAt: at(), progress: complete(this.state.progress), error: null }); },
      'update-cancelled': () => { if (!this.closing) this.publish({ status: 'available', progress: null, error: null }); },
      error: error => this.fail(error),
    };
    for (const [name, listener] of Object.entries(handlers)) updater.on(name, listener);
    return () => { for (const [name, listener] of Object.entries(handlers)) updater.off?.(name, listener); };
  }

  stateNow() {
    try { this.sync(); } catch { /* reading state must not fail on a broken updater */ }
    return { ...this.state, latest: this.state.latest && { ...this.state.latest }, progress: this.state.progress && { ...this.state.progress } };
  }

  // Progress arrives many times a second; a whole percent, or a quarter second
  // with a new byte count, is enough for a readout.
  track(progress, at) {
    const percent = Math.min(100, Math.max(0, Math.round(Number(progress?.percent) || 0)));
    const transferred = bytes(progress?.transferred), total = bytes(progress?.total);
    const current = this.state.progress, time = this.now();
    if (current && current.percent === percent && current.transferred === transferred && this.changedAt && time - this.changedAt < 250) return;
    this.publish({ status: 'downloading', checkedAt: this.state.checkedAt ?? at(), progress: { percent, transferred, total, bytesPerSecond: bytes(progress?.bytesPerSecond) } });
  }

  // Everything that overlaps with a check: a download of its own, or an install
  // already under way. One guard covers the window's buttons and both timers.
  get busy() { return this.state.status === 'checking' || this.task != null || this.installing; }

  fail(error) {
    if (this.closing) return;
    if (this.installing) {
      this.installing = false;
      this.publish({ status: 'downloaded', error: 'UPDATE_INSTALL_FAILED' });
      return;
    }
    if (this.task?.cancelled) return;
    const text = String(error?.code || '') + ' ' + String(error?.message || '');
    // GitHubProvider 6.8.11 looks for an Atom entry before reaching its own
    // no-releases error. Match that empty-feed error without hiding malformed entries.
    const emptyGitHubFeed = error?.code === 'ERR_XML_MISSED_ELEMENT' && error.message === 'No published versions on GitHub';
    if (emptyGitHubFeed || UNPUBLISHED.test(text)) {
      this.publish({ status: 'latest', latest: null, progress: null, checkedAt: new Date(this.now()).toISOString(), error: null });
      return;
    }
    this.publish({ status: 'error', progress: null, error: describe(error) });
  }

  publish(patch) {
    this.state = { ...this.state, ...patch, supported: this.supported, current: this.current };
    this.changedAt = this.now();
    try { this.onChange(); } catch { /* a listener must not break the updater */ }
  }

  // Manual and scheduled checks share one path; the download starts on its own
  // so a person can keep reading while it transfers.
  async check() {
    // electron-updater returns its existing downloadPromise until cancellation
    // finishes. Do not give that old promise a fresh task/token on a retry.
    if (this.task?.cancelled) await this.task.settled;
    if (this.closing) throw new Error('UPDATE_NOT_CONFIGURED');
    if (!this.supported) throw new Error('UPDATE_NOT_CONFIGURED');
    if (this.busy) throw new Error('UPDATE_BUSY');
    this.publish({ status: 'checking', error: null });
    try {
      const result = await this.updater().checkForUpdates();
      const at = new Date(this.now()).toISOString();
      if (result && result.isUpdateAvailable) {
        // The updater's own update-available event may already have started the
        // download; only a check that found the version itself falls back to it.
        if (!this.task) this.publish({ status: 'available', latest: this.info(result.updateInfo) ?? this.state.latest, checkedAt: at, error: null });
        this.download();
      } else if (this.state.status === 'checking') {
        this.publish({ status: 'latest', latest: null, progress: null, checkedAt: at, error: null });
      }
    } catch (error) { this.fail(error); }
    return this.stateNow();
  }

  download() {
    if (this.closing || this.installing || !this.supported || !this.state.latest || this.task) return this.stateNow();
    const { CancellationToken } = require('electron-updater');
    // The transfer keeps its own record, so a late rejection can tell its own
    // cancellation apart from a failure, and cannot publish over a newer one.
    const task = { token: new CancellationToken(), cancelled: false };
    this.task = task;
    this.publish({ status: 'downloading', progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 } });
    task.settled = Promise.resolve().then(() => this.updater().downloadUpdate(task.token))
      .catch(error => { if (!this.closing && !task.cancelled && this.task === task) this.fail(error); })
      .finally(() => { if (this.task === task) this.task = null; });
    return this.stateNow();
  }

  cancel() {
    if (!this.supported) throw new Error('UPDATE_NOT_CONFIGURED');
    const task = this.task;
    if (this.state.status !== 'downloading' || !task) throw new Error('UPDATE_NOT_READY');
    task.cancelled = true;
    // Retain ownership until the underlying promise settles. Late events and
    // rechecks must still belong to the transfer that is being cancelled.
    try { task.token.cancel(); } catch { /* an already finished token has nothing to cancel */ }
    this.publish({ status: 'available', progress: null, error: null });
    return this.stateNow();
  }

  // The person's click must stop this application's own work first: the installer
  // replaces files that running processes hold open, and a slow shutdown would be
  // killed by the installer's own wait. So the caller's controlled shutdown is
  // awaited here, before the installer starts — not left to the later quit.
  // Silent (/S) so no wizard appears, and --force-run so the new version starts
  // again; the assisted NSIS installer finds its previous directory in the registry.
  async install() {
    if (!this.supported) throw new Error('UPDATE_NOT_CONFIGURED');
    if (this.state.status !== 'downloaded') throw new Error('UPDATE_NOT_READY');
    if (this.installing) throw new Error('UPDATE_BUSY');
    this.installing = true;
    try {
      if (this.beforeInstall) await this.beforeInstall();
      this.updater()?.quitAndInstall(true, true);
      // BaseUpdater can report a synchronous launch failure via its error event
      // without throwing. Keep the download and return the same retryable error.
      if (!this.installing) throw new Error('UPDATE_INSTALL_FAILED');
    } catch (error) {
      // The installer never started, so this process is still running and the
      // download is still usable: keep that state and report why the restart failed.
      this.installing = false;
      this.publish({ error: 'UPDATE_INSTALL_FAILED' });
      throw new Error('UPDATE_INSTALL_FAILED', { cause: error });
    }
    return this.stateNow();
  }

  // One check shortly after start-up, then at most one every six hours while the
  // window is open. Neither timer holds the process alive, and an unattended check
  // that finds a check or a download already running just skips this turn.
  start() {
    if (!this.supported || this.started || this.closing) return this.stateNow();
    this.started = true;
    const tick = () => {
      if (this.closing || this.busy) return;
      this.check().catch(() => { /* the state it published is the report */ });
    };
    this.startupTimer = setTimeout(() => { this.startupTimer = null; tick(); }, this.startupDelay);
    this.intervalTimer = setInterval(() => { if (this.state.status === 'idle' || this.state.status === 'latest' || this.state.status === 'error') tick(); }, this.interval);
    this.startupTimer.unref?.(); this.intervalTimer.unref?.();
    return this.stateNow();
  }

  close() {
    this.closing = true;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.startupTimer = null; this.intervalTimer = null;
    const task = this.task;
    this.task = null;
    if (task) { task.cancelled = true; try { task.token.cancel(); } catch { /* an idle token has nothing to cancel */ } }
    try { this.listen?.(); } catch { /* listeners already gone */ }
  }
}

function complete(progress) {
  if (!progress) return null;
  const total = progress.total || progress.transferred;
  return { ...progress, percent: 100, transferred: total, total };
}

module.exports = { UpdateService, describe, CODES };
