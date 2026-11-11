'use strict';
const fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { own } = require('./agent-install-engine');
const { normalizeCredential } = require('./provider-credentials');
const { routes } = require('./provider-catalog');
const WEBSITE_ADAPTERS = Object.freeze(Object.keys(routes).filter(adapter => routes[adapter].websiteLogin));
function secretContext(value) {
  if (value == null) return null;
  if (typeof value === 'string') return /^[a-z][a-z0-9-]{4,98}[a-z0-9]$/.test(value) ? value : undefined;
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['userAgent', 'organization', 'workspace', 'discover', 'clientHome', 'oauth', 'desktop', 'cursor', 'zcode', 'console', 'deviceGrant'].includes(key))) return undefined;
  if (value.console !== undefined && !require('./opencode-console-login').consoleContext(value.console)) return undefined;
  if (value.deviceGrant !== undefined && (value.deviceGrant !== true || !value.console || value.oauth?.clientId !== 'opencode-cli' || value.oauth?.clientSecret !== undefined)) return undefined;
  if (value.desktop !== undefined && !require('./workbuddy-client').desktopContext(value.desktop)) return undefined;
  if (value.cursor !== undefined && !require('./cursor-client').cursorContext(value.cursor)) return undefined;
  if (value.zcode !== undefined && !require('./zcode-login').zcodeContext(value.zcode)) return undefined;
  if (value.clientHome !== undefined && (typeof value.clientHome !== 'string' || !/^[a-f0-9-]{36}$/.test(value.clientHome))) return undefined;
  if (value.discover !== undefined && value.discover !== true) return undefined;
  if (value.oauth !== undefined) {
    const grant = value.oauth;
    if (!value.clientHome && !value.deviceGrant || !grant || typeof grant !== 'object' || Array.isArray(grant) || Object.keys(grant).some(key => !['clientId', 'clientSecret', 'refreshToken', 'expiresAt'].includes(key)) || typeof grant.clientId !== 'string' || !/^[A-Za-z0-9_.:-]{8,256}$/.test(grant.clientId) || typeof grant.refreshToken !== 'string' || !/^[\x21-\x7e]{8,16384}$/.test(grant.refreshToken) || grant.clientSecret !== undefined && (typeof grant.clientSecret !== 'string' || !/^[\x21-\x7e]{8,256}$/.test(grant.clientSecret)) || typeof grant.expiresAt !== 'string' || !Number.isFinite(Date.parse(grant.expiresAt))) return undefined;
  }
  if (value.userAgent !== undefined && (typeof value.userAgent !== 'string' || value.userAgent.length > 512 || /[^\x20-\x7e]/.test(value.userAgent))) return undefined;
  if (value.organization !== undefined && (typeof value.organization !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.organization))) return undefined;
  if (value.workspace !== undefined && (typeof value.workspace !== 'string' || !/^(?:wrk_|org_)[A-Za-z0-9_-]{1,100}$/.test(value.workspace))) return undefined;
  return { ...value };
}
function storageError(stage, cause) { const error = new Error('PROVIDER_SECRET_STORAGE_FAILED'); error.stage = stage; error.storageCode = ['EACCES', 'EPERM', 'EBUSY', 'ENOSPC', 'EIO', 'EROFS'].includes(cause?.code) ? cause.code : null; return error; }
class ProviderSecretStore {
  constructor(root, storage, { platform = process.platform, now = Date.now } = {}) { Object.assign(this, { root: path.resolve(root), storage, platform, now }); }
  available() { return this.platform === 'win32' && this.storage?.isEncryptionAvailable() === true; }
  file(id) { if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('PROVIDER_ACTION_INVALID'); return own(this.root, path.join(this.root, id + '.bin')); }
  put(id, adapter, credential, expiresAt, context = null) {
    if (!this.available()) throw new Error('PROVIDER_SECURE_STORAGE_REQUIRED');
    if (!Object.hasOwn(routes, adapter) || routes[adapter].kind === 'passive' || !normalizeCredential(adapter, credential) || secretContext(context) === undefined || context?.deviceGrant && adapter !== 'opencode-zen' || expiresAt !== null && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= this.now())) throw new Error('PROVIDER_ACTION_INVALID');
    let stage = 'encrypt';
    try {
      const plain = JSON.stringify({ schemaVersion: 'ProviderSecretV2', id, adapter, credential: normalizeCredential(adapter, credential), expiresAt, context: secretContext(context) });
      const encrypted = this.storage.encryptString(plain);
      if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length > 65536) throw Error();
      stage = 'verify'; if (this.storage.decryptString(encrypted) !== plain) throw Error();
      this.writeEncrypted(id, encrypted);
    } catch (cause) { if (cause?.message === 'PROVIDER_SECRET_STORAGE_FAILED') throw cause; throw storageError(stage, cause); }
  }
  snapshot(id) {
    try { const file = this.file(id); if (!fs.existsSync(file)) return null; if (fs.statSync(file).size > 65536) throw Error(); return fs.readFileSync(file); }
    catch (cause) { throw storageError('snapshot', cause); }
  }
  restore(id, encrypted) { if (encrypted === null) return this.remove(id); this.writeEncrypted(id, encrypted); }
  writeEncrypted(id, encrypted) {
    if (!Buffer.isBuffer(encrypted) || encrypted.length > 65536) throw storageError('record');
    const file = this.file(id), temporary = own(this.root, path.join(this.root, id + '-' + randomUUID() + '.tmp')); let stage = 'write';
    try { fs.mkdirSync(this.root, { recursive: true }); fs.writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' }); stage = 'replace'; fs.renameSync(temporary, file); }
    catch (cause) { try { fs.unlinkSync(temporary); } catch { /* Encrypted temporary bytes only; preserve the old record. */ } throw storageError(stage, cause); }
  }

  get(id, adapter) {
    const file = this.file(id); if (!fs.existsSync(file)) return null;
    if (!this.available()) throw new Error('PROVIDER_SECURE_STORAGE_REQUIRED');
    let stage = 'read';
    try {
      if (!Object.hasOwn(routes, adapter) || routes[adapter].kind === 'passive' || fs.statSync(file).size > 65536) throw new Error();
      const encrypted = fs.readFileSync(file); stage = 'decrypt';
      const plain = this.storage.decryptString(encrypted); stage = 'record';
      const value = JSON.parse(plain);
      if (!['ProviderWebsiteSecretV1', 'ProviderSecretV2'].includes(value?.schemaVersion) || value.schemaVersion === 'ProviderWebsiteSecretV1' && !WEBSITE_ADAPTERS.includes(adapter) || value.id !== id || value.adapter !== adapter || value.expiresAt !== null && !Number.isFinite(Date.parse(value.expiresAt)) || secretContext(value.context) === undefined || !normalizeCredential(adapter, value.credential)) throw new Error();
      if (value.context?.deviceGrant && adapter !== 'opencode-zen') throw Error();
      if (value.expiresAt !== null && Date.parse(value.expiresAt) <= this.now() && !value.context?.clientHome && !value.context?.desktop && !value.context?.cursor && !value.context?.deviceGrant) { this.remove(id); return null; }
      return { credential: normalizeCredential(adapter, value.credential), expiresAt: value.expiresAt, ...(value.schemaVersion === 'ProviderSecretV2' ? { context: secretContext(value.context) } : {}) };
    } catch { const error = new Error('PROVIDER_SECRET_STORAGE_FAILED'); error.stage = stage; throw error; }
  }
  remove(id) { try { fs.rmSync(this.file(id), { force: true }); } catch { throw new Error('PROVIDER_SECRET_STORAGE_FAILED'); } }
}
module.exports = { ProviderSecretStore, WEBSITE_ADAPTERS };
