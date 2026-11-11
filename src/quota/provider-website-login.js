'use strict';
const { normalizeCredential } = require('./provider-credentials');
const sites = Object.freeze({
  'gemini-web': { name: 'Gemini app', url: 'https://gemini.google.com/usage', domains: ['google.com', 'gemini.google.com'], names: null, required: [], navigation: ['gemini.google.com', 'accounts.google.com', 'myaccount.google.com', 'consent.google.com'] },
  'opencode-web': { name: 'OpenCode', url: 'https://opencode.ai/auth', domains: ['opencode.ai'], names: ['auth', '__Host-auth', '__Host-console_session'], required: [], navigation: ['opencode.ai', 'auth.opencode.ai', 'github.com', 'accounts.google.com'] },
  'deepseek-web': { name: 'DeepSeek API 平台', url: 'https://platform.deepseek.com', domains: ['platform.deepseek.com'], names: [], required: [], navigation: ['platform.deepseek.com', 'open.weixin.qq.com', 'accounts.google.com'] },
  'claude-web': { name: 'Claude', url: 'https://claude.ai/login', domains: ['claude.ai'], names: ['sessionKey'], required: ['sessionKey'], navigation: ['claude.ai', 'accounts.google.com', 'appleid.apple.com'] },
  'workbuddy-web': { name: 'WorkBuddy', url: 'https://www.workbuddy.cn/profile/plans-usage', domains: ['workbuddy.cn', 'www.workbuddy.cn'], names: null, required: [], navigation: ['www.workbuddy.cn', 'workbuddy.cn', 'accounts.google.com', 'github.com', 'open.weixin.qq.com', 'xui.ptlogin2.qq.com', 'ssl.ptlogin2.qq.com', 'graph.qq.com', 'login.workbuddy.cn'] },
  'cursor-web': { name: 'Cursor', url: 'https://cursor.com/dashboard', domains: ['cursor.com'], names: ['WorkosCursorSessionToken', '__Secure-next-auth.session-token', 'next-auth.session-token'], required: [], navigation: ['cursor.com', 'authenticator.cursor.sh', 'accounts.x.ai', 'accounts.spacex.ai', 'auth.x.ai', 'auth.grok.com', 'auth.grokusercontent.com', 'auth.grokipedia.com', 'accounts.google.com', 'github.com'] },
  'mimo-web': { name: 'MiMo', url: 'https://platform.xiaomimimo.com', domains: ['platform.xiaomimimo.com', 'xiaomimimo.com'], names: ['api-platform_serviceToken', 'userId', 'api-platform_ph', 'api-platform_slh'], required: ['api-platform_serviceToken', 'userId'], navigation: ['platform.xiaomimimo.com', 'account.xiaomi.com', 'account.xiaomi.net', 'passport.xiaomi.com'] }
});
function allowedNavigation(adapter, value) { try { const url = new URL(value); return Boolean(sites[adapter] && url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && sites[adapter].navigation.includes(url.hostname)); } catch { return false; } }
function allowedSubframe(adapter, value) {
  if (allowedNavigation(adapter, value)) return true;
  try { const url = new URL(value); return Boolean(sites[adapter] && url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && (url.hostname === 'challenges.cloudflare.com' || ['www.google.com', 'recaptcha.google.com', 'www.recaptcha.net'].includes(url.hostname) && url.pathname.startsWith('/recaptcha/'))); } catch { return false; }
}
function selectWebsiteCookies(adapter, cookies, now = Date.now()) {
  const site = sites[adapter]; if (!site || !Array.isArray(cookies) || cookies.length > 200) return null;
  const selected = new Map(); let expiry = Infinity;
  for (const cookie of cookies) {
    if (!cookie || site.names && !site.names.includes(cookie.name) || typeof cookie.value !== 'string' || !site.domains.includes(String(cookie.domain).replace(/^\./, '')) || cookie.secure !== true || cookie.expirationDate !== undefined && (!Number.isFinite(cookie.expirationDate) || cookie.expirationDate * 1000 <= now || cookie.expirationDate * 1000 > 8640000000000000)) continue;
    if (selected.has(cookie.name)) return null;
    selected.set(cookie.name, cookie.value); if (cookie.expirationDate !== undefined) expiry = Math.min(expiry, cookie.expirationDate * 1000);
  }
  if (site.required.some(name => !selected.has(name))) return null;
  const credential = normalizeCredential(adapter, [...selected].map(([name, value]) => name + '=' + value).join('; '));
  return credential ? { credential, expiresAt: expiry === Infinity ? null : new Date(expiry).toISOString() } : null;
}
// Website login uses an ordinary external Chrome tab. The descriptors and
// normalization helpers also support previously encrypted session credentials.
module.exports = { sites, allowedNavigation, allowedSubframe, selectWebsiteCookies };
function selectPlatformToken(raw) {
  if (typeof raw !== 'string' || raw.length > 32768) return null;
  let value = raw; try { value = JSON.parse(raw); } catch { /* Plain token is also an observed representation. */ }
  const token = typeof value === 'string' ? value : ['value', 'token', 'access_token', 'accessToken', 'userToken'].map(key => value?.[key]).find(item => typeof item === 'string');
  const credential = normalizeCredential('deepseek-web', token); return credential ? { credential, expiresAt: null } : null;
}
module.exports.selectPlatformToken = selectPlatformToken;
