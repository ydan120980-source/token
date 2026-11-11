'use strict';
// This child owns only the selected fixed device authorization capability. The
// collector/main process retains disableNetwork; no ambient credentials survive.
const { loginZcode } = require('./zcode-login');
const { loginConsole } = require('./opencode-console-login');
const { loginErrorCode } = require('./provider-device-login');
const controller = new AbortController(); let started = false, browser = null;
const cancel = () => { controller.abort(); browser?.reject(Error('PROVIDER_CANCELED')); browser = null; };
process.on('disconnect', () => { cancel(); if (!started) process.exit(); });
process.on('message', async message => {
  if (message?.cancel === true) { cancel(); return; }
  if (message?.browserReady === true && browser) { browser.resolve(); browser = null; return; }
  if (started || message?.start !== true || Object.keys(message).sort().join(',') !== 'adapter,start' || !['zcode-device', 'opencode-zen'].includes(message.adapter)) return; started = true;
  try {
    const credentials = await (message.adapter === 'zcode-device' ? loginZcode : loginConsole)(controller.signal, url => new Promise((resolve, reject) => { if (!process.connected || controller.signal.aborted) { reject(Error('PROVIDER_CANCELED')); return; } browser = { resolve, reject }; process.send({ authorize: url }, error => { if (error) cancel(); }); }));
    if (process.connected && !controller.signal.aborted) process.send({ credentials });
  } catch (error) { if (process.connected) process.send({ errorCode: loginErrorCode(error) }); }
  finally { if (process.connected) process.disconnect(); }
});
