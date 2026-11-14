'use strict';
const { fork } = require('node:child_process');
const { githubError } = require('./github-errors');

function create(clientId = process.env.AGENT_USAGE_GITHUB_CLIENT_ID ?? require('../../package.json').githubAppClientId) {
  if (typeof clientId !== 'string' || !/^[A-Za-z0-9_.-]{8,128}$/.test(clientId)) return null;

  const children = new Map();
  let closed = false;
  function run(action, args, signal) {
    if (closed || signal?.aborted) return Promise.reject(Error('GITHUB_REQUEST_FAILED'));
    return new Promise((resolve, reject) => {
      const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
      env.ELECTRON_RUN_AS_NODE = '1';
      let child;
      try {
        child = fork(require.resolve('./github-worker.js'), [], {
          env, execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });
      } catch {
        reject(Error('GITHUB_REQUEST_FAILED'));
        return;
      }
      let reply;
      const stop = () => child.kill();
      const timer = setTimeout(stop, 60000);
      signal?.addEventListener('abort', stop, { once: true });
      const drained = new Promise(done => {
        child.once('message', value => { reply = value; });
        child.on('error', stop);
        child.once('close', code => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', stop);
          children.delete(child);
          done();
          if (code === 0 && reply?.ok === true && !closed && !signal?.aborted) resolve(reply.value);
          else reject(Error(githubError(reply?.error)));
        });
      });
      children.set(child, drained);
      child.send({ clientId, action, args }, error => { if (error) stop(); });
      if (signal?.aborted) stop();
    });
  }

  return {
    startDevice: signal => run('startDevice', [], signal),
    pollDevice: (code, signal) => run('pollDevice', [code], signal),
    refresh: token => run('refresh', [token]),
    user: (token, signal) => run('user', [token], signal),
    privateRepositories: (token, login) => run('privateRepositories', [token, login]),
    put: (token, repository, file, text, login) => run('put', [token, repository, file, text, login]),
    async close() {
      closed = true;
      for (const child of children.keys()) child.kill();
      await Promise.all(children.values());
    },
  };
}

module.exports = { create };
