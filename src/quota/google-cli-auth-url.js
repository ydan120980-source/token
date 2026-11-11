'use strict';
// Only an authorization address emitted by our current pinned CLI login. Never
// repair a truncated address, change its state/PKCE or accept a caller callback.
function googleCliAuthURL(value) {
  if (typeof value !== 'string' || value.length > 16384 || /[^\x21-\x7e]/.test(value)) throw Error('PROVIDER_RESPONSE_INVALID');
  let url; try { url = new URL(value); } catch { throw Error('PROVIDER_RESPONSE_INVALID'); }
  if (url.origin !== 'https://accounts.google.com' || url.username || url.password || url.hash || !['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(url.pathname)) throw Error('PROVIDER_RESPONSE_INVALID');
  for (const key of url.searchParams.keys()) if (url.searchParams.getAll(key).length !== 1) throw Error('PROVIDER_RESPONSE_INVALID');
  const get = key => url.searchParams.get(key);
  if (get('response_type') !== 'code' || !/^[A-Za-z0-9_-]{8,200}\.apps\.googleusercontent\.com$/.test(get('client_id') || '') || get('redirect_uri') !== 'https://antigravity.google/oauth-callback' || get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(get('code_challenge') || '') || !/^[A-Za-z0-9_-]{16,512}$/.test(get('state') || '') || !get('scope') || get('scope').length > 8192 || url.searchParams.has('code') || url.searchParams.has('access_token') || url.searchParams.has('refresh_token')) throw Error('PROVIDER_RESPONSE_INVALID');
  return url.href;
}
module.exports = { googleCliAuthURL };
