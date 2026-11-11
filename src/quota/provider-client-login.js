'use strict';
const fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { normalizeCredential } = require('./provider-credentials');
const { readActiveRuntime, own } = require('./agent-install-engine');
const { fingerprint } = require('./executable-pin');
const { discoverAgentRuntime } = require('./agent-runtime-discovery');
const { discoverAntigravity } = require('./antigravity-discovery');
const { runWindowsJob, runWindowsLoginJob } = require('./windows-job');
const { inspectAntigravity } = require('./antigravity-probe');
const { pinnedAntigravityRun } = require('./antigravity-windows-run');
const { readBounded } = require('./client-files');
const { createWorkBuddyReader } = require('./workbuddy-client');
const { readCursor } = require('./cursor-client');
const { runDeviceLogin } = require('./provider-device-login');
// Fixed contracts only, read solely after an explicit Connect action. Symlinks,
// oversized files, scripts and executable configuration are never evaluated.
function readClientCredential(adapter, home, environment = {}) {
  let credential, expiresAt = null;
  if (adapter === 'claude-oauth') {
    const oauth = readBounded(path.join(home, '.claude/.credentials.json'))?.claudeAiOauth;
    if (Array.isArray(oauth?.scopes) && !oauth.scopes.includes('user:profile')) return null;
    credential = oauth?.accessToken;
    if (Number.isSafeInteger(oauth?.expiresAt) && oauth.expiresAt > 0 && oauth.expiresAt <= 8640000000000000) expiresAt = new Date(oauth.expiresAt).toISOString();
  } else if (adapter === 'gemini-code-assist') {
    const oauth = readBounded(path.join(home, '.gemini/oauth_creds.json')); credential = oauth?.access_token;
    if (Number.isSafeInteger(oauth?.expiry_date) && oauth.expiry_date > 0 && oauth.expiry_date <= 8640000000000000) expiresAt = new Date(oauth.expiry_date).toISOString();
  } else {
    const names = { 'deepseek-api': ['DEEPSEEK_API_KEY', 'DEEPSEEK_KEY'], 'opencode-go': ['OPENCODE_API_KEY'], 'zai-global': ['Z_AI_API_KEY'], 'zai-cn': ['BIGMODEL_API_KEY', 'ZHIPU_API_KEY', 'ZHIPUAI_API_KEY', 'GLM_API_KEY'] }[adapter] || [];
    credential = names.map(name => environment[name]).find(value => normalizeCredential(adapter, value));
    if (!credential && adapter === 'opencode-go') for (const file of [path.join(home, '.local/share/opencode/auth.json'), ...(environment.LOCALAPPDATA ? [path.join(environment.LOCALAPPDATA, 'opencode/auth.json')] : [])]) { const value = readBounded(file)?.['opencode-go']; if (value?.type === 'api' && normalizeCredential(adapter, value.key)) { credential = value.key; break; } }
    if (!credential && adapter === 'zai-cn') for (const relative of ['.coding-relay/glm-api-key', '.config/bigmodel/api_key', '.config/zhipu/api_key']) { credential = readBounded(path.join(home, relative), false)?.split(/\r?\n/)[0]?.trim(); if (normalizeCredential(adapter, credential)) break; }
  }
  credential = normalizeCredential(adapter, credential);
  return credential && (!expiresAt || Date.parse(expiresAt) > Date.now() + 30000) ? { credential, expiresAt, context: adapter === 'gemini-code-assist' ? { discover: true } : null } : null;
}
function createClientLogin({ root, toolsRoot, environment, fixture = false, job = runWindowsJob, loginJob = runWindowsLoginJob, read = readClientCredential, renew = null, desktop = createWorkBuddyReader({ environment, job }), openBrowser = async () => { throw Error('PROVIDER_BROWSER_FAILED'); }, deviceLogin = runDeviceLogin }) {
  const guarded = () => { if (fixture) throw new Error('PROVIDER_FIXTURE_BLOCKED'); };
  async function runtime(agent) {
    const installed = readActiveRuntime(toolsRoot, agent); if (installed) return installed;
    const scan = agent === 'antigravity' ? await discoverAntigravity(environment()) : await discoverAgentRuntime(agent, environment());
    const entries = agent === 'antigravity' ? scan.candidates?.map(value => value.executable) : scan.entries?.filter(value => value.kind === 'executable').map(value => value.path);
    const selected = [...new Set(entries || [])]; if (selected.length !== 1) throw new Error('PROVIDER_CLIENT_MISSING');
    return { executable: selected[0], js: false };
  }
  function isolated(agent, id) {
    if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('PROVIDER_ACTION_INVALID');
    fs.mkdirSync(root, { recursive: true }); const home = own(root, path.join(root, agent, id)); fs.mkdirSync(home, { recursive: true });
    const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'), PATH: path.join(process.env.SystemRoot, 'System32'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'), GEMINI_CLI_HOME: home });
    // agy's documented switch. Its background self-update (every 15 minutes per home) starts a child with a new console, and
    // Windows hands that to the default terminal: a window on the person's screen, whatever we start agy with. It also replaces the pinned program.
    if (agent === 'antigravity') env.AGY_CLI_DISABLE_AUTO_UPDATE = 'true';
    for (const directory of [env.APPDATA, env.LOCALAPPDATA]) fs.mkdirSync(directory, { recursive: true });
    return { home, cwd: home, env, timeoutMs: 600000, maxOutputBytes: 524288 };
  }
  async function login(adapter, signal, _id, context, { credential: existingCredential, fresh = false } = {}) {
    guarded(); if (signal.aborted) throw new Error('PROVIDER_CANCELED');
    if (adapter === 'workbuddy-desktop') return desktop.read(signal);
    if (adapter === 'cursor-web') return readCursor(environment(), signal);
    const agent = adapter === 'claude-oauth' ? 'claude' : adapter === 'gemini-code-assist' ? 'gemini' : adapter === 'antigravity-cli' ? 'antigravity' : null;
    if (!fresh && context?.oauth && normalizeCredential(adapter, existingCredential)) {
      return await prepare(adapter, existingCredential, signal, context) || { credential: existingCredential, expiresAt: context.oauth.expiresAt, context };
    }
    if (adapter === 'zcode-device' || adapter === 'opencode-zen') return deviceLogin(adapter, signal, openBrowser);
    // An already logged-in supported client or configured API key needs no new
    // browser authorization. Imported values are copied into our encrypted vault.
    const previous = fresh || adapter === 'antigravity-cli' ? null : read(adapter, context?.clientHome && agent ? isolated(agent, context.clientHome).home : environment().home, context?.clientHome ? {} : process.env);
    if (previous) return { ...previous, context: context?.clientHome ? { ...previous.context, clientHome: context.clientHome } : previous.context };
    if (!agent) throw new Error('PROVIDER_CLIENT_CREDENTIAL_MISSING');
    const selected = await runtime(agent);
    if (!fresh && agent === 'antigravity' && context?.clientHome) { const options = isolated(agent, context.clientHome); options.env.SSH_TTY = 'agentusage-scoped'; try { return { credential: 'official-owned-login', expiresAt: null, quota: await reportWith(selected, options, signal), context }; } catch (error) { if (signal.aborted) throw error; } }
    const loginHome = randomUUID(), options = isolated(agent, loginHome), pin = fingerprint(selected.executable);
    try {
    if (selected.js && (!selected.entry || !readActiveRuntime(toolsRoot, agent))) throw new Error('PROVIDER_CLIENT_MISSING');
    const prefix = selected.js ? [selected.entry] : [];
    // Version checks are separate bounded, noninteractive executions. No npm
    // shims or arbitrary shell command strings are accepted for login.
    const version = await job(pin, [...prefix, '--version'], { ...options, timeoutMs: 10000, signal });
    if (version.reaped !== true || version.errorCode || version.code !== 0 || version.overflow || version.timedOut) throw new Error('PROVIDER_CLIENT_UNSUPPORTED');
    if (agent === 'antigravity') {
      const { version: parse, supportedVersion } = require('./antigravity-command');
      if (!supportedVersion(parse(version.stdout))) throw new Error('PROVIDER_CLIENT_UNSUPPORTED');
      options.env.SSH_TTY = 'agentusage-scoped'; // Official CLI's file-token mode, never the global keyring.
    }
    const result = await loginJob(pin, [...prefix, ...(agent === 'claude' ? ['auth', 'login', '--claudeai'] : [])], { ...options, signal, ...(agent === 'antigravity' ? { onAuthUrl: url => openBrowser(require('./google-cli-auth-url').googleCliAuthURL(url)) } : {}) });
    if (result.browserError) throw Error(result.browserError);
    if (signal.aborted || result.canceled) throw new Error('PROVIDER_CANCELED');
    if (!result.reaped || result.errorCode || result.timedOut || result.code !== 0) throw new Error('PROVIDER_LOGIN_FAILED');
    if (agent === 'antigravity') return { credential: 'official-owned-login', expiresAt: null, quota: await reportWith(selected, options, signal), context: { clientHome: loginHome } };
    const value = read(adapter, options.home); if (!value) throw new Error('PROVIDER_CLIENT_CREDENTIAL_MISSING');
    const oauth = ownedGrant(agent, options.home, selected);
    return { ...value, context: { ...value.context, clientHome: loginHome, ...(oauth ? { oauth } : {}) } };
    } catch (error) { forget(adapter, { clientHome: loginHome }); throw error; }
  }
  async function reportWith(selected, options, signal) {
    const token = readBounded(path.join(options.home, '.gemini/antigravity-cli/antigravity-oauth-token'))?.token;
    if (!normalizeCredential('antigravity-cli', token?.access_token)) throw new Error('PROVIDER_AUTH_REQUIRED');
    const result = await inspectAntigravity({ executable: selected.executable, run: pinnedAntigravityRun(fingerprint(selected.executable), { cwd: options.cwd, env: options.env }), signal });
    if (!result.ok) throw new Error(result.errorCode === 'AGY_VERSION_UNSUPPORTED' ? 'PROVIDER_CLIENT_UNSUPPORTED' : signal.aborted ? 'PROVIDER_CANCELED' : 'PROVIDER_REQUEST_FAILED'); return result.quota;
  }
  async function report(signal, context) { guarded(); const selected = await runtime('antigravity'), options = isolated('antigravity', context?.clientHome); options.env.SSH_TTY = 'agentusage-scoped'; return reportWith(selected, options, signal); }
  function forget(adapter, context) {
    const agent = { 'claude-oauth': 'claude', 'gemini-code-assist': 'gemini', 'antigravity-cli': 'antigravity' }[adapter];
    if (!agent || !/^[a-f0-9-]{36}$/.test(context?.clientHome || '')) return;
    const target = own(root, path.join(root, agent, context.clientHome)); fs.rmSync(target, { recursive: true, force: true });
  }
  async function prepare(adapter, _credential, signal, context, { force = false } = {}) {
    if (adapter === 'cursor-web' && context?.cursor) {
      guarded(); const next = await readCursor(environment(), signal);
      if (next.context.cursor.subject !== context.cursor.subject) throw Error('PROVIDER_CLIENT_ACCOUNT_CHANGED');
      return next;
    }
    if (adapter === 'workbuddy-desktop' && context?.desktop) {
      guarded(); const next = await desktop.read(signal);
      if (next.context.desktop.uid !== context.desktop.uid || next.context.desktop.domain !== context.desktop.domain || next.context.desktop.enterpriseId !== context.desktop.enterpriseId) throw Error('PROVIDER_CLIENT_ACCOUNT_CHANGED');
      return next;
    }
    const grant = (context?.clientHome || adapter === 'opencode-zen' && context?.deviceGrant === true) && context.oauth;
    if (!grant || !force && Date.parse(grant.expiresAt) > Date.now() + 60000) return null;
    guarded(); if (!renew) throw new Error('PROVIDER_AUTH_REQUIRED');
    const value = await renew(adapter, grant.refreshToken, signal, { clientId: grant.clientId, ...(adapter === 'opencode-zen' ? { orgId: context.console.orgId } : {}), ...(grant.clientSecret ? { clientSecret: grant.clientSecret } : {}) });
    return { credential: value.credential, expiresAt: value.expiresAt, context: { ...context, oauth: { ...grant, refreshToken: value.refreshToken, expiresAt: value.expiresAt } } };
  }
  return { login, report, forget, prepare };
}
function ownedGrant(agent, home, runtime) {
  if (agent === 'claude') {
    const value = readBounded(path.join(home, '.claude/.credentials.json'))?.claudeAiOauth;
    return normalizeCredential('claude-oauth', value?.refreshToken) && Number.isSafeInteger(value?.expiresAt) && value.expiresAt > 0 && value.expiresAt <= 8640000000000000 ? { clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e', refreshToken: value.refreshToken, expiresAt: new Date(value.expiresAt).toISOString() } : null;
  }
  if (agent === 'gemini' && runtime.js && runtime.entry) {
    const value = readBounded(path.join(home, '.gemini/oauth_creds.json')); if (!normalizeCredential('gemini-code-assist', value?.refresh_token) || !Number.isSafeInteger(value?.expiry_date) || value.expiry_date <= 0 || value.expiry_date > 8640000000000000) return null;
    const base = path.resolve(runtime.entry, '../..');
    for (const suffix of ['node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js', '../gemini-cli-core/dist/src/code_assist/oauth2.js']) {
      const source = readBounded(path.resolve(base, suffix), false); if (!source) continue;
      const clientId = /\bOAUTH_CLIENT_ID\s*=\s*['"]([A-Za-z0-9_.:-]{8,256})['"]/.exec(source)?.[1], clientSecret = /\bOAUTH_CLIENT_SECRET\s*=\s*['"]([A-Za-z0-9_:-]{8,256})['"]/.exec(source)?.[1];
      if (clientId && clientSecret) return { clientId, clientSecret, refreshToken: value.refresh_token, expiresAt: new Date(value.expiry_date).toISOString() };
    }
  }
  return null;
}
module.exports = { readBounded, readClientCredential, createClientLogin, ownedGrant };
