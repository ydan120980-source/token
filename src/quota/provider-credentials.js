'use strict';
const { routes } = require('./provider-catalog');
function normalizeCredential(adapter, value) {
  if (!Object.hasOwn(routes, adapter) || typeof value !== 'string' || value.length < 8 || value.length > 16384 || /[\x00-\x1f\x7f-\uffff]/.test(value)) return null;
  const route = routes[adapter];
  if (route.kind !== 'cookie') return /\s/.test(value) ? null : value;
  const required = route.provider === 'mimo' ? ['api-platform_serviceToken', 'userId'] : route.provider === 'claude' ? ['sessionKey'] : [], allowed = route.provider === 'mimo' ? [...required, 'api-platform_ph', 'api-platform_slh'] : route.provider === 'claude' ? ['sessionKey'] : route.provider === 'opencode' ? ['auth', '__Host-auth', '__Host-console_session'] : ['workbuddy', 'gemini'].includes(route.provider) ? null : ['WorkosCursorSessionToken', '__Secure-next-auth.session-token', 'next-auth.session-token'];
  const selected = new Map();
  for (const part of value.replace(/^Cookie:\s*/i, '').split(';')) {
    const index = part.indexOf('='); if (index < 1) continue;
    const name = part.slice(0, index).trim(), token = part.slice(index + 1).trim(); if (allowed ? !allowed.includes(name) : !/^[A-Za-z0-9_!#$%&'*+.^`|~-]{1,100}$/.test(name)) continue;
    if (!token || /[\s;,"\\]/.test(token) || selected.has(name)) return null; selected.set(name, token);
  }
  if (required.some(name => !selected.has(name)) || !selected.size || selected.size > 64 || route.provider === 'cursor' && selected.size !== 1) return null;
  return [...selected].map(([name, token]) => name + '=' + token).join('; ');
}
module.exports = { normalizeCredential };
