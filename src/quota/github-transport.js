'use strict';
// The real connection to GitHub. Codex implements it (owner 2026-11-04, docs/m2/GITHUB-AND-UPDATE-20261104.md); until then
// the app reports "not configured" and makes no request. github-service.js holds the rest and only ever calls these:
//
//   startDevice(signal)                → { deviceCode, userCode, verificationUri, expiresIn, interval }
//   pollDevice(deviceCode, signal)     → { status: 'pending' | 'slow_down' | 'denied' | 'expired' } or { status: 'authorized', token, refreshToken?, expiresAt? }
//   refresh(refreshToken, signal)      → { token, refreshToken?, expiresAt? }
//   user(token, signal)                → { login, name, avatar } with avatar a data: URL (the window's policy loads no remote image)
//   privateRepositories(token, signal) → [{ fullName }] only those the app can write and that are private
//   put(token, repository, path, text, signal) → { committedAt }
//
// Application updates are not part of this transport: they need no GitHub account and are read by electron-updater
// from the release feed beside a packaged build (src/quota/update-service.js).
//
// A failure throws one of GITHUB_OFFLINE, GITHUB_RATE_LIMITED, GITHUB_AUTH_REQUIRED, GITHUB_FORBIDDEN, GITHUB_REQUEST_FAILED.
// The transport keeps no state and never logs a token or a response body.
function create() { return null; }
module.exports = { create };
