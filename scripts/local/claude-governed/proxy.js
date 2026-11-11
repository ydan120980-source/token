'use strict';
const http = require('node:http'), https = require('node:https'), tls = require('node:tls');
// This capability accepts a named policy, never a renderer-supplied proxy URL.
function makeProxyAgent(policy, signal) {
  if (policy !== 'claude-residential') throw new Error('INSTALL_GOVERNANCE_REQUIRED');
  class Agent extends https.Agent {
    createConnection(options, callback) {
      let settled = false, secure;
      const done = (error, socket) => { if (settled) return; settled = true; signal?.removeEventListener('abort', abort); callback(error, socket); };
      const request = http.request({ host: '127.0.0.1', port: 17898, method: 'CONNECT', path: options.host + ':443', headers: { Host: options.host + ':443' } });
      const abort = () => { request.destroy(new Error('INSTALL_CANCELED')); secure?.destroy(); };
      signal?.addEventListener('abort', abort, { once: true });
      request.once('connect', (response, socket, head) => {
        if (response.statusCode !== 200 || head.length) { socket.destroy(); done(new Error('INSTALL_GOVERNANCE_REQUIRED')); return; }
        secure = tls.connect({ socket, servername: options.servername || options.host, rejectUnauthorized: true }, () => done(null, secure));
        secure.setTimeout(10000, () => secure.destroy(new Error('INSTALL_GOVERNANCE_REQUIRED')));
        secure.once('error', error => done(error));
      });
      request.once('error', error => done(error)); request.setTimeout(10000, () => request.destroy(new Error('INSTALL_GOVERNANCE_REQUIRED'))); request.end();
      if (signal?.aborted) abort();
      return undefined;
    }
  }
  return new Agent({ keepAlive: false });
}
module.exports = { makeProxyAgent };
