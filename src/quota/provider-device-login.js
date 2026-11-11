'use strict';
const { fork } = require('node:child_process');
const { authURL, zcodeContext } = require('./zcode-login');
const { consoleAuthURL, consoleCredentials } = require('./opencode-console-login');
const { normalizeCredential } = require('./provider-credentials');
const CODES = new Set(['PROVIDER_CANCELED', 'PROVIDER_LOGIN_TIMEOUT', 'PROVIDER_LOGIN_FAILED', 'PROVIDER_TIMEOUT', 'PROVIDER_AUTH_REQUIRED', 'PROVIDER_ACCESS_DENIED', 'PROVIDER_ORGANIZATION_REQUIRED', 'PROVIDER_RATE_LIMITED', 'PROVIDER_REDIRECT_REJECTED', 'PROVIDER_REQUEST_FAILED', 'PROVIDER_RESPONSE_INVALID', 'PROVIDER_OUTPUT_LIMIT', 'PROVIDER_CHROME_MISSING', 'PROVIDER_BROWSER_FAILED', 'PROVIDER_ZCODE_INIT_FAILED', 'PROVIDER_ZCODE_POLL_FAILED']);
const code = error => CODES.has(error?.message) ? error.message : 'PROVIDER_LOGIN_FAILED';
function runDeviceLogin(adapter, signal, open, { forkProcess = fork, timeoutMs = 330000 } = {}) {
  if (!['zcode-device', 'opencode-zen'].includes(adapter)) return Promise.reject(Error('PROVIDER_ACTION_INVALID'));
  if (signal.aborted) return Promise.reject(Error('PROVIDER_CANCELED'));
  return new Promise((resolve, reject) => {
    let child, outcome, failure, closed = false, stopping = false, browserOpened = false, timer, killTimer;
    const send = message => { if (child?.connected) child.send(message, error => { if (error && !closed) stop('PROVIDER_LOGIN_FAILED'); }); };
    const stop = value => { if (closed || stopping) return; stopping = true; failure ||= value; send({ cancel: true }); killTimer = setTimeout(() => child.kill(), 3000); };
    const abort = () => stop('PROVIDER_CANCELED');
    const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]])); env.ELECTRON_RUN_AS_NODE = '1';
    try { child = forkProcess(require.resolve('./provider-device-login-worker.js'), [], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); }
    catch { reject(Error('PROVIDER_LOGIN_FAILED')); return; }
    child.on('message', message => {
      if (closed || failure || outcome) return;
      if (typeof message?.authorize === 'string' && Object.keys(message).length === 1 && !browserOpened) {
        let url; try { url = (adapter === 'zcode-device' ? authURL : consoleAuthURL)(message.authorize); } catch { stop('PROVIDER_RESPONSE_INVALID'); return; } browserOpened = true;
        Promise.resolve().then(() => { if (closed || failure || signal.aborted) throw Error('PROVIDER_CANCELED'); return open(url); }).then(() => { if (!closed && !failure) send({ browserReady: true }); }, error => stop(code(error))); return;
      }
      if (typeof message?.errorCode === 'string' && Object.keys(message).length === 1) { failure = CODES.has(message.errorCode) ? message.errorCode : 'PROVIDER_LOGIN_FAILED'; return; }
      const value = message?.credentials;
      if (!browserOpened || !value || Object.keys(message).length !== 1 || !normalizeCredential(adapter, value.credential) || value.expiresAt !== null && (!Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now())) { stop('PROVIDER_RESPONSE_INVALID'); return; }
      if (adapter === 'zcode-device') { if (!zcodeContext(value.context?.zcode)) { stop('PROVIDER_RESPONSE_INVALID'); return; } outcome = { credential: value.credential, expiresAt: value.expiresAt, context: { zcode: zcodeContext(value.context.zcode) } }; }
      else { try { if (value.context?.deviceGrant !== true) throw Error(); outcome = consoleCredentials({ access_token: value.credential, refresh_token: value.context?.oauth?.refreshToken, expires_in: Math.floor((Date.parse(value.expiresAt) - Date.now()) / 1000) }, value.context?.console?.orgId); } catch { stop('PROVIDER_RESPONSE_INVALID'); } }
    });
    child.on('error', () => stop('PROVIDER_LOGIN_FAILED'));
    child.once('close', () => { if (closed) return; closed = true; clearTimeout(timer); clearTimeout(killTimer); signal.removeEventListener('abort', abort); if (signal.aborted) reject(Error('PROVIDER_CANCELED')); else if (failure || !outcome) reject(Error(failure || 'PROVIDER_LOGIN_FAILED')); else resolve(outcome); });
    timer = setTimeout(() => stop('PROVIDER_LOGIN_TIMEOUT'), timeoutMs); signal.addEventListener('abort', abort, { once: true }); send({ start: true, adapter }); if (signal.aborted) abort();
  });
}
module.exports = { runDeviceLogin, loginErrorCode: code };
