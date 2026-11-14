'use strict';
// Runs in the GitHub child. Endpoints and upload paths are fixed here.
const { REPOSITORY } = require('./github-errors');

const API = 'https://api.github.com';
const GITHUB = 'https://github.com';
const DEVICE = GITHUB + '/login/device';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,1024}$/.test(value);
const validLogin = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(value);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const owned = (name, login) => typeof name === 'string' && REPOSITORY.test(name) && same(name.split('/')[0], login);

function checkStatus(response) {
  const { status, headers } = response;
  if (status === 401) throw Error('GITHUB_AUTH_REQUIRED');
  if (status === 429 || status === 403 && (headers.has('retry-after') || headers.get('x-ratelimit-remaining') === '0')) throw Error('GITHUB_RATE_LIMITED');
  if (status === 403 || status === 404) throw Error('GITHUB_FORBIDDEN');
  if (status === 409) throw Error('GITHUB_SYNC_CONFLICT');
  throw Error('GITHUB_REQUEST_FAILED');
}

async function readBytes(response, limit) {
  const chunks = [];
  let size = 0;
  for await (const bytes of response.body ?? []) {
    size += bytes.length;
    if (size > limit) throw Error('GITHUB_REQUEST_FAILED');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

function tokenValue(value, now) {
  if (!validToken(value?.access_token)) throw Error('GITHUB_REQUEST_FAILED');
  if (value.expires_in == null) return { token: value.access_token };
  if (!Number.isSafeInteger(value.expires_in) || value.expires_in < 1 || value.expires_in > 86400 || !validToken(value.refresh_token)) throw Error('GITHUB_REQUEST_FAILED');
  return { token: value.access_token, refreshToken: value.refresh_token, expiresAt: new Date(now() + value.expires_in * 1000).toISOString() };
}

function githubApi(clientId, { request = fetch, now = Date.now } = {}) {
  if (typeof clientId !== 'string' || !/^[A-Za-z0-9_.-]{8,128}$/.test(clientId)) throw Error('GITHUB_NOT_CONFIGURED');
  async function send(url, { token, method = 'GET', body, accept = 'application/json', contentType, allowed = [], limit = MAX_RESPONSE_BYTES } = {}) {
    if (token !== undefined && (!validToken(token) || new URL(url).origin !== API)) throw Error('GITHUB_AUTH_REQUIRED');
    let response;
    try {
      response = await request(url, {
        method, body, redirect: 'manual', signal: AbortSignal.timeout(15000),
        headers: {
          Accept: accept, 'User-Agent': 'Agent-Usage-Quota',
          ...(token ? { Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' } : {}),
          ...(contentType ? { 'Content-Type': contentType } : {}),
        },
      });
    } catch {
      throw Error('GITHUB_OFFLINE');
    }
    if (!response.ok && !allowed.includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      checkStatus(response);
    }
    if (response.status === 404) {
      await response.body?.cancel().catch(() => {});
      return { status: 404, value: null };
    }
    const bytes = await readBytes(response, limit);
    return { status: response.status, headers: response.headers, bytes };
  }
  async function json(url, options) {
    const response = await send(url, options);
    if (response.status === 404) return response;
    try { return { ...response, value: JSON.parse(response.bytes.toString('utf8')) }; }
    catch { throw Error('GITHUB_REQUEST_FAILED'); }
  }
  async function oauth(route, fields) {
    const { value } = await json(GITHUB + route, {
      method: 'POST', contentType: 'application/x-www-form-urlencoded',
      body: new URLSearchParams({ client_id: clientId, ...fields }).toString(), allowed: [400],
    });
    return value;
  }
  async function* pages(route, key, token) {
    for (let page = 1; ; page++) {
      const { value, headers } = await json(API + route + '?per_page=100&page=' + page, { token });
      if (!Array.isArray(value?.[key])) throw Error('GITHUB_REQUEST_FAILED');
      yield* value[key];
      if (!/(?:^|,)\s*<[^>]+>;\s*rel="next"/.test(headers.get('link') ?? '')) return;
    }
  }
  async function avatar(value) {
    try {
      const url = new URL(value);
      if (url.origin !== 'https://avatars.githubusercontent.com' || url.username || url.password || !/^\/u\/\d+$/.test(url.pathname)) return null;
      url.search = '?s=96';
      const { bytes, headers } = await send(url.href, { accept: 'image/png,image/jpeg,image/webp', limit: 192 * 1024 });
      const mime = headers.get('content-type');
      if (/^image\/(?:png|jpeg|webp)$/.test(mime) && bytes.length) return 'data:' + mime + ';base64,' + bytes.toString('base64');
    } catch { /* The displayed initials remain usable. */ }
    return null;
  }
  return {
    async startDevice() {
      const data = await oauth('/login/device/code', { scope: 'offline_access' });
      if (!validToken(data?.device_code) || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(data.user_code) ||
          data.verification_uri !== DEVICE || !Number.isSafeInteger(data.expires_in) || data.expires_in < 1 ||
          data.expires_in > 3600 || !Number.isSafeInteger(data.interval) || data.interval < 1 || data.interval > 60) throw Error('GITHUB_REQUEST_FAILED');
      return { deviceCode: data.device_code, userCode: data.user_code, verificationUri: DEVICE, expiresIn: data.expires_in, interval: data.interval };
    },
    async pollDevice(deviceCode) {
      if (!validToken(deviceCode)) throw Error('GITHUB_REQUEST_FAILED');
      const data = await oauth('/login/oauth/access_token', { device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
      const codes = { authorization_pending: 'pending', slow_down: 'slow_down', access_denied: 'denied', expired_token: 'expired' };
      if (Object.hasOwn(codes, data?.error)) return { status: codes[data.error] };
      return { status: 'authorized', ...tokenValue(data, now) };
    },
    async refresh(refreshToken) {
      if (!validToken(refreshToken)) throw Error('GITHUB_AUTH_REQUIRED');
      const data = await oauth('/login/oauth/access_token', { refresh_token: refreshToken, grant_type: 'refresh_token' });
      if (['bad_refresh_token', 'invalid_grant', 'expired_token', 'invalid_refresh_token'].includes(data?.error)) throw Error('GITHUB_AUTH_REQUIRED');
      return tokenValue(data, now);
    },
    async user(token) {
      if (!validToken(token)) throw Error('GITHUB_AUTH_REQUIRED');
      const { value } = await json(API + '/user', { token });
      if (!validLogin(value?.login)) throw Error('GITHUB_REQUEST_FAILED');
      return { login: value.login, name: value.name, avatar: await avatar(value.avatar_url) };
    },
    async privateRepositories(token, login) {
      if (!validToken(token) || !validLogin(login)) throw Error('GITHUB_AUTH_REQUIRED');
      const matches = [];
      for await (const installation of pages('/user/installations', 'installations', token)) {
        if (!Number.isSafeInteger(installation?.id) || installation.id < 1 || installation.suspended_at ||
            !same(installation.account?.login, login) || installation.permissions?.contents !== 'write') continue;
        for await (const repo of pages('/user/installations/' + installation.id + '/repositories', 'repositories', token)) {
          if (repo?.private === true && !repo.archived && !repo.disabled && repo.permissions?.push === true && owned(repo.full_name, login)) {
            matches.push({ fullName: repo.full_name });
            if (matches.length === 500) return matches;
          }
        }
      }
      return matches;
    },
    async put(token, repository, path, text, login) {
      if (!validToken(token) || !validLogin(login)) throw Error('GITHUB_AUTH_REQUIRED');
      if (!owned(repository, login) || typeof path !== 'string' || !/^agent-usage\/[a-f0-9-]{36}\.json$/.test(path) || typeof text !== 'string') throw Error('GITHUB_REPOSITORY_INVALID');
      const base = API + '/repos/' + repository;
      const { value: repo } = await json(base, { token });
      if (repo?.private !== true || repo.archived || repo.disabled || repo.permissions?.push !== true ||
          !same(repo.owner?.login, login) || !same(repo.full_name, repository)) throw Error('GITHUB_REPOSITORY_INVALID');
      const route = base + '/contents/' + path;
      // Read file metadata without copying the previous JSON into the child.
      const { status, value } = await json(route, { token, accept: 'application/vnd.github.object+json', allowed: [404] });
      const sha = status === 404 ? undefined : value?.sha;
      if (status !== 404 && (value?.type !== 'file' || value.path !== path || !/^[a-f0-9]{40}$/.test(sha ?? ''))) throw Error('GITHUB_SYNC_CONFLICT');
      await json(route, {
        token, method: 'PUT', contentType: 'application/json',
        body: JSON.stringify({ message: 'Sync Agent Usage daily totals', content: Buffer.from(text, 'utf8').toString('base64'), ...(sha ? { sha } : {}) }),
      });
    },
  };
}

module.exports = { githubApi };
