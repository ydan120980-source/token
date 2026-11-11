'use strict';
const { createHmac, randomBytes } = require('node:crypto');
const { routes } = require('./provider-catalog');
const { normalizeCredential } = require('./provider-credentials');

// Evidence is accepted only after a successful, saved quota observation. No new
// profile endpoints, JWT claim guessing, credential reads or persistent hashes.
class ConnectionIdentities {
  constructor() { this.key = randomBytes(32); this.entries = new Map(); }
  forget(id) { this.entries.delete(id); }
  clear() { this.entries.clear(); this.key.fill(0); }
  observe(id, adapter, credential, context) {
    this.forget(id);
    const route = routes[adapter], token = normalizeCredential(adapter, credential);
    if (!route || !token || ['passive', 'local-report'].includes(route.kind)) return;
    let evidence, status = 'credential-match';
    if (adapter === 'workbuddy-desktop') {
      const value = require('./workbuddy-client').desktopContext(context?.desktop);
      if (!value) return;
      evidence = [value.uid, value.domain, value.enterpriseId || null]; status = 'client-bound';
    } else if (adapter === 'zcode-device') {
      const value = require('./zcode-login').zcodeContext(context?.zcode);
      if (!value) return;
      evidence = [value.userId]; status = 'server-reported';
    } else if (adapter === 'cursor-web' && context?.cursor) {
      const value = require('./cursor-client').cursorContext(context.cursor);
      if (!value) return;
      evidence = [value.subject]; status = 'client-bound';
    } else {
      // Keep account products, regions, organizations and projects separate.
      // An organization alone identifies a shared workspace, not a person.
      let scope = null;
      if (adapter === 'claude-web') { if (!/^[a-f0-9-]{36}$/i.test(context?.organization || '')) return; scope = context.organization; }
      if (adapter === 'opencode-web') { if (!/^(?:wrk_|org_)[A-Za-z0-9_-]{1,100}$/.test(context?.workspace || '')) return; scope = context.workspace; }
      if (adapter === 'opencode-zen') { const value = require('./opencode-console-login').consoleContext(context?.console); if (!value) return; scope = value.orgId; }
      if (adapter === 'gemini-code-assist') { if (!require('./provider-http').validProject(context)) return; scope = context; }
      const normalized = route.kind === 'cookie' ? token.split('; ').sort().join('; ') : token;
      evidence = [normalized, scope];
    }
    const digest = createHmac('sha256', this.key).update(JSON.stringify([adapter, status, evidence])).digest('hex');
    this.entries.set(id, { digest, status });
  }
  view(id) {
    const entry = this.entries.get(id);
    const duplicateAccountIds = entry ? [...this.entries].filter(([other, value]) => other !== id && value.digest === entry.digest).map(([other]) => other).sort() : [];
    return { identityStatus: entry?.status || 'unknown', duplicateKnown: duplicateAccountIds.length > 0, duplicateAccountIds };
  }
}
module.exports = { ConnectionIdentities };
