'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { githubApi } = require('../../src/quota/github-api');
const apiBase = 'https://api.github.com';
const oauth = 'https://github.com/login/oauth/access_token';
const token = 'ghu_demo_public_fixture';
const path = 'agent-usage/12345678-1234-1234-1234-123456789abc.json';
const repo = { full_name: 'me/private', owner: { login: 'me' }, private: true, permissions: { push: true } };

function github(replies) {
  const calls = [];
  const api = githubApi('Iv1.demoClient', { now: () => 0, request: async (url, options) => {
    calls.push({ url, ...options });
    const next = replies.shift();
    assert.ok(next, 'unexpected request');
    assert.equal(url, next.url);
    assert.equal(options.redirect, 'manual');
    return Response.json(next.body, { status: next.status ?? 200, headers: next.headers });
  } });
  return { api, calls };
}

test('device code, pending response and rotating tokens use GitHub device flow without an application secret', async () => {
  const grant = { access_token: token, refresh_token: 'ghr_refresh_fixture', expires_in: 28800 };
  const { api, calls } = github([
    { url: 'https://github.com/login/device/code', body: { device_code: 'fixture42', user_code: 'DEMO-CODE', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 } },
    { url: oauth, body: { error: 'authorization_pending' }, status: 400 },
    { url: oauth, body: grant },
    { url: oauth, body: grant },
    { url: oauth, body: { error: 'bad_refresh_token' }, status: 400 },
  ]);
  const device = await api.startDevice();
  assert.equal(device.userCode, 'DEMO-CODE');
  assert.deepEqual(await api.pollDevice(device.deviceCode), { status: 'pending' });
  const authorized = await api.pollDevice(device.deviceCode);
  assert.equal(authorized.token, token);
  assert.equal(authorized.expiresAt, new Date(28800000).toISOString());
  assert.equal((await api.refresh(authorized.refreshToken)).token, token);
  await assert.rejects(api.refresh(authorized.refreshToken), /GITHUB_AUTH_REQUIRED/);
  for (const call of calls) {
    const form = new URLSearchParams(call.body);
    assert.equal(form.get('client_id'), 'Iv1.demoClient');
    assert.equal(form.has('client_secret'), false);
    assert.equal(call.headers.Authorization, undefined);
  }
  assert.equal(new URLSearchParams(calls[0].body).get('scope'), 'offline_access');
  assert.equal(new URLSearchParams(calls[3].body).get('grant_type'), 'refresh_token');
});

test('repository discovery follows pagination and restricts results to writable personal private repositories', async () => {
  const route = apiBase + '/user/installations';
  const repositories = route + '/7/repositories?per_page=100&page=';
  const { api } = github([
    { url: route + '?per_page=100&page=1', body: { installations: [
      { id: 6, account: { login: 'org' }, permissions: { contents: 'write' } },
      { id: 7, account: { login: 'me' }, permissions: { contents: 'write' } },
    ] } },
    { url: repositories + '1', headers: { Link: '<https://api.github.com/user/installations/7/repositories?page=2>; rel="next"' }, body: { repositories: [
      { ...repo, private: false }, { ...repo, archived: true }, { ...repo, permissions: { push: false } },
    ] } },
    { url: repositories + '2', body: { repositories: [repo] } },
  ]);
  assert.deepEqual(await api.privateRepositories(token, 'me'), [{ fullName: 'me/private' }]);
});

test('sync refuses changed privacy and updates only the per-device file using its GitHub blob SHA', async () => {
  const base = apiBase + '/repos/me/private';
  const url = base + '/contents/' + path;
  const sha = 'a'.repeat(40);
  const { api, calls } = github([
    { url: base, body: { ...repo, private: false } },
    { url: base, body: repo },
    { url, body: { type: 'file', path, sha } },
    { url, body: { commit: {} } },
    { url: base, body: repo },
    { url, body: {}, status: 404 },
    { url, body: {}, status: 409 },
  ]);
  await assert.rejects(api.put(token, 'other/private', path, '{}', 'me'), /GITHUB_REPOSITORY_INVALID/);
  await assert.rejects(api.put(token, 'me/private', path, '{}', 'me'), /GITHUB_REPOSITORY_INVALID/);
  await api.put(token, 'me/private', path, '{"days":[]}', 'me');
  assert.equal(calls[3].method, 'PUT');
  const body = JSON.parse(calls[3].body);
  assert.equal(body.sha, sha);
  assert.equal(Buffer.from(body.content, 'base64').toString(), '{"days":[]}');
  await assert.rejects(api.put(token, 'me/private', path, '{}', 'me'), /GITHUB_SYNC_CONFLICT/);
  assert.equal(JSON.parse(calls[6].body).sha, undefined);
});
