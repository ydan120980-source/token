'use strict';
const { githubError } = require('./github-errors');
const { githubApi } = require('./github-api');

process.once('message', async message => {
  let response;
  try {
    const api = githubApi(message.clientId);
    if (!Object.hasOwn(api, message.action) || !Array.isArray(message.args)) throw Error('GITHUB_REQUEST_FAILED');
    response = { ok: true, value: await api[message.action](...message.args) };
  } catch (error) {
    response = { ok: false, error: githubError(error?.message) };
  }
  if (process.connected) process.send(response, () => process.disconnect());
});
process.on('disconnect', () => process.exit(0));
