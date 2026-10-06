'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SOURCES, LABELS, roots, localPath } = require('./policy');
const { catalog, price, evaluate, validate, isIdentifier, FIELDS } = require('./pricing');
const runtimeCatalog = require('./runtime-catalog');
const {csvIdentity} = require('./extended-sources');
const {digest} = require('./normalize');
const {selectUsageSnapshot,keepIdentity} = require('./usage-snapshot');
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp-' + crypto.randomBytes(6).toString('hex');
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temporary, file);
}
function load(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('LOCAL_STORAGE_INVALID', { cause: error }); return fallback; }
}
const dayFormatters = new Map();
function day(time, timezone) { if (!dayFormatters.has(timezone)) dayFormatters.set(timezone, new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })); return dayFormatters.get(timezone).format(new Date(time)); }
class Store {
  constructor(dir, defaults = roots()) {
    this.dir = dir;
    const own = localPath(dir).toLowerCase();
    function checkRoots(selected) { for (const list of Object.values(selected)) for (const source of list) { const normalized = localPath(source).toLowerCase(); if (normalized === own || normalized.startsWith(own + path.sep) || own.startsWith(normalized + path.sep)) throw new Error('SOURCE_PRODUCT_OVERLAP'); } }
    checkRoots(defaults);
    this.state = load(path.join(dir, 'statistics.json'), { version: 1, deviceId: crypto.randomUUID(), salt: crypto.randomBytes(32).toString('hex'), sequence: 0, records: {}, statuses: {} });
    this.settings = load(path.join(dir, 'preferences.json'), { enabled: true, roots: defaults });
    // Add newly supported default roots in memory; preserve every saved choice
    // (including an intentionally empty list), pause setting and old ledger.
    this.settings.roots = {...defaults, ...this.settings.roots};
    checkRoots(this.settings.roots);
    this.validation = load(path.join(dir, 'validation.json'), {});
    this.overrides = load(path.join(dir, 'pricing.json'), {});
    this.billing = load(path.join(dir, 'billing.json'), { autoSync:true, defaults:{}, mappings:{} });
    this.downloadedCatalog = false;
    try { const saved = load(path.join(dir,'model-pricing.json'), null); this.remoteCatalog = runtimeCatalog.verify(saved || runtimeCatalog.embedded); this.downloadedCatalog = Boolean(saved); } catch { this.remoteCatalog = runtimeCatalog.verify(runtimeCatalog.embedded); }
    this.modelCatalog = runtimeCatalog.merged(this.remoteCatalog);
    this.modelCatalogHash = runtimeCatalog.hash(this.modelCatalog);
    if (this.state.version !== 1 || !this.state.deviceId || typeof this.state.salt !== 'string' || !this.state.records || !this.state.statuses || !Number.isSafeInteger(this.state.sequence)) throw new Error('LOCAL_STORAGE_INVALID');
    this.state.duplicateIds ||= {};
    // Keep the original records recoverable; suppress proven historical copies.
    const shared = new Map(); let migrated = false;
    const migrate = () => { if (!migrated) atomic(path.join(dir,'backups','statistics-before-dedupe-' + this.state.sequence + '.json'), this.state); migrated = true; };
    // Object insertion order is the retained ledger's first-save order, including
    // suppressed originals. Agent catalog order cannot establish historical ownership.
    for (const record of Object.values(this.state.records)) if (record.sharedKey) {
      const ownerId = shared.get(record.sharedKey);
      if (ownerId) {
        const owner = this.state.records[ownerId], choice = selectUsageSnapshot(owner,record);
        if (this.state.duplicateIds[record.id] !== ownerId || choice.record !== owner) {
          migrate(); this.state.duplicateIds[record.id] = ownerId;
          this.state.records[ownerId] = keepIdentity(owner,choice.record);
        }
        if (choice.issue === 'SOURCE_USAGE_CONFLICT') for (const agent of [owner.agent,record.agent]) {
          const status = this.state.statuses[agent] || {agent,label:LABELS[agent],lastSuccess:null};
          this.state.statuses[agent] = {...status,status:status.status === 'not-detected' ? status.status : 'partial',errors:[...new Set([...(status.errors || []),choice.issue])]};
        }
      } else {
        if (this.state.duplicateIds[record.id] && this.state.records[this.state.duplicateIds[record.id]]?.sharedKey === record.sharedKey) { migrate(); delete this.state.duplicateIds[record.id]; }
        shared.set(record.sharedKey,record.id);
      }
    }
    const exports = new Map();
    for (const record of this.records()) if (record.agent === 'cursor' && record.entry === 'export' && record.csvIdentity === undefined) {
      if (!migrated) atomic(path.join(dir,'backups','statistics-before-dedupe-' + this.state.sequence + '.json'), this.state);
      migrated = true;
      const signature = csvIdentity(record), occurrence = exports.get(signature) || 0; exports.set(signature,occurrence + 1);
      record.csvIdentity = digest(this.state.salt,'cursor-export/2:' + signature + ':' + occurrence);
    }
    atomic(path.join(dir, 'statistics.json'), this.state);
  }
  records() { return Object.values(this.state.records).filter(record => !this.state.duplicateIds?.[record.id]); }
  ingest(scan, native) {
    const at = new Date().toISOString();
    const shared = new Map(this.records().filter(r => r.sharedKey).map(r => [r.sharedKey,r.id]));
    const exports = new Map(this.records().filter(r => r.csvIdentity).map(r => [r.csvIdentity,r.id]));
    const recordOrder = new Map(Object.keys(this.state.records).map((id,index)=>[id,index]));
    const previousSuccess = new Map(Object.entries(this.state.statuses).map(([agent,status])=>[agent,status.lastSuccess]));
    const conflicts = new Set();
    let backedUp = false;
    const backup = () => { if (!backedUp) { atomic(path.join(this.dir,'backups','statistics-before-identity-' + this.state.sequence + '.json'),this.state); backedUp = true; } };
    if (this.state.statuses.codex?.parserVersion !== 'm1-projection/2 + tokscale/4.17.0' && Object.values(this.state.records).some(r => r.agent === 'codex')) atomic(path.join(this.dir, 'backups', 'statistics-before-parser2-' + at.replaceAll(':', '-') + '.json'), this.state);
    const detailed = new Set(scan.workbuddy.records.filter(r => r.accountingKind !== 'session-aggregate').map(r => r.sessionKey));
    if (detailed.size) for (const [id, old] of Object.entries(this.state.records)) if (old.agent === 'workbuddy' && old.accountingKind === 'session-aggregate' && detailed.has(old.sessionKey)) delete this.state.records[id];
    for (const agent of SOURCES) {
      let result = scan[agent];
      if (agent === 'cursor') {
        const modes = new Set(Object.values(this.state.records).filter(r => r.agent === 'cursor').map(r => r.entry));
        for (const record of result.records) modes.add(record.entry);
        if (modes.size > 1) result = {...result, records:[], partial:true, errors:[...new Set([...result.errors,'CURSOR_SOURCE_MODE_CONFLICT'])]};
      }
      const errors = new Set(result.errors);
      for (const record of result.records) {
        let ownerId = this.state.duplicateIds[record.id] || record.id;
        if (record.csvIdentity) {
          ownerId = exports.get(record.csvIdentity) || ownerId;
          exports.set(record.csvIdentity,ownerId);
          if (ownerId !== record.id) { backup(); this.state.duplicateIds[record.id] = ownerId; this.state.records[record.id] ||= record; }
        }
        if (record.sharedKey) {
          const identities = new Set(record.sharedRecordIds || []);
          if (shared.has(record.sharedKey)) identities.add(shared.get(record.sharedKey));
          if (this.state.records[ownerId]) identities.add(ownerId);
          const existing = [...identities].filter(id=>this.state.records[id]).sort((a,b)=>(recordOrder.get(a) ?? Infinity)-(recordOrder.get(b) ?? Infinity));
          ownerId = existing[0] || ownerId;
          if (this.state.duplicateIds[ownerId]) { backup(); delete this.state.duplicateIds[ownerId]; }
          for (const id of existing) if (id !== ownerId) {
            backup();
            const candidate = this.state.records[id], owner = this.state.records[ownerId];
            const choice = selectUsageSnapshot(owner,candidate);
            this.state.records[ownerId] = keepIdentity(owner,choice.record);
            if (choice.issue === 'SOURCE_USAGE_CONFLICT') { errors.add(choice.issue); conflicts.add(owner.agent); }
            this.state.duplicateIds[id] = ownerId;
          }
          if (ownerId !== record.id) { backup(); this.state.duplicateIds[record.id] = ownerId; this.state.records[record.id] ||= record; }
          shared.set(record.sharedKey,ownerId);
        }
        const old = this.state.records[ownerId];
        const choice = selectUsageSnapshot(old,record);
        if (choice.issue) errors.add(choice.issue);
        if (choice.issue === 'SOURCE_USAGE_CONFLICT') conflicts.add(old?.agent || record.agent);
        if (old?.sharedKey && old.sharedKey !== record.sharedKey) backup();
        const saved = old ? keepIdentity(old,choice.record) : choice.record;
        if (record.sharedKey) { saved.sharedKey = record.sharedKey; saved.sharedRecordIds = record.sharedRecordIds; }
        if (record.csvIdentity) saved.csvIdentity = record.csvIdentity;
        this.state.records[ownerId] = saved;
        if (!recordOrder.has(ownerId)) recordOrder.set(ownerId,recordOrder.size);
      }
      result = {...result, errors:[...errors], partial:result.partial || errors.size > 0};
      const previous = this.state.statuses[agent];
      const times = result.records.map(r => r.timestamp).sort();
      const fieldSupport = Object.fromEntries(['inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning'].map(field => {
        const known = result.records.filter(r => !r.usageConflict && r[field] !== null).length;
        return [field, !known ? 'unobserved' : known === result.records.length ? 'observed-all-records' : 'observed-some-records'];
      }));
      this.state.statuses[agent] = {
        schemaVersion: 'SourceCapability',
        agent, label: LABELS[agent], detected: result.detected, observedRecords: result.records.length, fileCount: result.fileCount,
        status: !result.detected ? 'not-detected' : result.errors.length && !result.records.length ? 'error' : result.partial || result.records.some(r => r.quality !== 'measured') ? 'partial' : this.validation[agent]?.verified && (agent !== 'codex' || this.validation[agent]?.parserVersion === 'm1-projection/2') ? 'verified' : 'unverified',
        lastAttempt: at, lastSuccess: result.errors.length || result.partial ? previous?.lastSuccess || null : at,
        errors: result.errors, malformedLines: result.skipped, durationMs: result.durationMs,
        qualityIssues: Object.fromEntries([...new Set(result.records.filter(r => r.quality !== 'measured').map(r => r.quality))].map(quality => [quality, result.records.filter(r => r.quality === quality).length])),
        parserVersion: (agent === 'codex' ? 'm1-projection/2' : 'm1-projection/1') + ' + tokscale/4.17.0', realSampleVerified: this.validation[agent]?.verified === true && (agent !== 'codex' || this.validation[agent]?.parserVersion === 'm1-projection/2'),
        coverageStart: times[0] || previous?.coverageStart || null, coverageEnd: times.at(-1) || previous?.coverageEnd || null,
        fields: { totalTokens: result.records.length ? 'observed' : 'unobserved', ...fieldSupport, accountQuota: false, actualBill: false },
        nativeVerification: native.status
      };
    }
    // A later Agent can expose ambiguity in an earlier owner's observation.
    for (const agent of conflicts) {
      const status = this.state.statuses[agent];
      status.errors = [...new Set([...status.errors,'SOURCE_USAGE_CONFLICT'])];
      status.status = status.detected ? 'partial' : 'not-detected';
      status.lastSuccess = previousSuccess.get(agent) || null;
    }
    this.state.sequence++; this.state.updatedAt = at;
    atomic(path.join(this.dir, 'statistics.json'), this.state);
    return this.snapshot();
  }
  snapshot() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (this._snapshot?.sequence === this.state.sequence && this._snapshot.timezone === timezone) return this._snapshot;
    const groups = new Map();
    for (const record of this.records()) {
      const date = day(record.timestamp, timezone);
      const key = JSON.stringify([date, record.agent, record.entry, record.provider, record.model]);
      let row = groups.get(key);
      if (!row) {
        row = { date, agent: record.agent, entry: record.entry, provider: record.provider, model: record.model, totalTokens: 0, inputUncached: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, records: 0, pricedRecords: 0, pricedTokens: 0, estimatedCostUsd: 0, estimatedCostUpperUsd: 0, boundedTokens: 0, pricingReasons: {}, knownUsage: {}, knownRecords: {}, partialRecords: 0 };
        groups.set(key, row);
      }
      row.totalTokens += record.totalTokens; row.records++;
      if (record.quality !== 'measured' || record.usageConflict) row.partialRecords++;
      for (const field of ['inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning']) row[field] = row[field] === null || record[field] === null || record.usageConflict ? null : row[field] + record[field];
      for (const field of ['inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'outputPlain']) {
        const count = field === 'outputPlain' ? record.output !== null && record.reasoning !== null && record.reasoning <= record.output ? record.output - record.reasoning : null : record[field];
        if (!record.usageConflict && Number.isFinite(count)) { row.knownUsage[field] = (row.knownUsage[field] || 0) + count; row.knownRecords[field] = (row.knownRecords[field] || 0) + 1; }
      }
      const resolved = this.resolvePrice(record);
      const estimate = resolved.rates ? evaluate(record, {}, {...resolved.rates,billingProvider:resolved.target?.split('/')[0] || record.provider}) : {reason:'model-unpriced',lower:null,upper:null};
      const multiplier = this.billing.defaults[record.agent]?.multiplier ?? 1;
      if (estimate.lower !== null) { estimate.lower *= multiplier; estimate.upper *= multiplier; }
      row.pricingReasons[estimate.reason] = (row.pricingReasons[estimate.reason] || 0) + 1;
      if (estimate.lower !== null) { row.estimatedCostUsd += estimate.lower; row.estimatedCostUpperUsd += estimate.upper; row.pricedRecords++; row.pricedTokens += record.totalTokens; if (estimate.upper > estimate.lower) row.boundedTokens += record.totalTokens; }
    }
    const daily = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
    for (const row of daily) { if (!row.pricedRecords) { row.estimatedCostUsd = null; row.estimatedCostUpperUsd = null; } row.semantics = { inputUncached: 'excludes-cache', reasoning: 'subset-of-output', totalTokens: 'non-overlapping-source-total' }; }
    return this._snapshot = {
      schemaVersion: 'UsageSnapshotV1', deviceId: this.state.deviceId, sequence: this.state.sequence,
      collectedAt: this.state.updatedAt || null, generatedAt: new Date().toISOString(), timezone,
      coverageStart: daily[0]?.date || null, daily,
      priceCatalog: { version: this.remoteCatalog ? catalog.version + '+models-dev/1' : catalog.version, obtainedAt: this.remoteCatalog?.obtainedAt || catalog.obtainedAt, sha256: this.catalogHash(), overrideSha256: this.overrideHash(), billingSha256:runtimeCatalog.hash(this.billing), currency: 'USD', kind: 'API-equivalent-estimate', source: this.remoteCatalog?.source || catalog.source, basis: catalog.basis },
      sources: SOURCES.map(agent => this.state.statuses[agent] || { agent, label: LABELS[agent], status: 'unverified', lastSuccess: null, realSampleVerified: false }),
      deferred: [{ agent: 'trae', status: 'variant-and-connection-unverified' }]
    };
  }
  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('INVALID_SETTING');
    this.settings.enabled = enabled; atomic(path.join(this.dir, 'preferences.json'), this.settings);
  }
  catalogHash() { return this.modelCatalogHash; }
  overrideHash() { return crypto.createHash('sha256').update(JSON.stringify(this.overrides || {})).digest('hex'); }
  pricing() {
    const models = new Map(Object.entries(this.modelCatalog).map(([key, rates]) => [key, { provider: key.slice(0, key.indexOf('/')), model: key.slice(key.indexOf('/') + 1), rates, origin: rates.provenance || 'reference-unverified', source: rates.source || catalog.source }]));
    // Models that only ever appear in collected records: listed so a gap is visible
    // instead of silently absent. Their identifier is data, so it can be anything
    // the log contained; `numbered` narrows it to identifiers the editor accepts.
    for (const record of this.records()) {
      const key = record.provider + '/' + record.model;
      if (!models.has(key)) models.set(key, { provider: record.provider, model: record.model, rates: {}, origin: 'unpriced', source: null, numbered: isIdentifier(record.model) && isIdentifier(record.provider) });
      const row = models.get(key), resolved = this.resolvePrice(record);
      row.observed = true;
      if (resolved.rates && resolved.rates.provenance !== 'reference-unverified') { row.rates = resolved.rates; row.origin = resolved.origin; row.target = resolved.target; }
    }
    for (const [key, rates] of Object.entries(this.overrides || {})) models.set(key, { ...models.get(key), provider: key.slice(0, key.indexOf('/')), model: key.slice(key.indexOf('/') + 1), rates, origin: 'manual', source: null, numbered: true });
    return {
      version: this.remoteCatalog ? catalog.version + '+models-dev/1' : catalog.version, obtainedAt: this.remoteCatalog?.obtainedAt || catalog.obtainedAt, sha256: this.catalogHash(), overrideSha256: this.overrideHash(),
      basis: catalog.basis, source: catalog.source, currencies: ['USD'],
      tiers: catalog.tiers || {},
      billing: this.billing,
      observed: [...models.values()].filter(row => row.observed).map(row=>({provider:row.provider,model:row.model,target:row.target||null,priced:row.origin !== 'unpriced' && row.origin !== 'reference-unverified'})),
      counts: {
        models: models.size,
        priced: [...models.values()].filter(row => !['unpriced','reference-unverified','official-thirdparty-unverified'].includes(row.origin) && Number.isFinite(row.rates.inputUncached) && Number.isFinite(row.rates.output)).length,
        unpriced: [...models.values()].filter(row => row.origin === 'unpriced').length,
        manual: [...models.values()].filter(row => row.origin === 'manual').length
      },
      models: [...models.values()].map(row => ({ ...row, rates: Object.fromEntries(FIELDS.map(field => [field, Number.isFinite(row.rates[field]) ? row.rates[field] * 1e6 : null])) }))
    };
  }
  /**
   * Dry-run an edit: report what it would cost and how many stored records it
   * would touch, without writing anything. `probe` never mutates.
   */
  probe(entry) {
    const value = validate(entry), key = value.provider + '/' + value.model;
    const previous = this.overrides[key] || this.modelCatalog[key] || null;
    let affectedRecords = 0, affectedTokens = 0;
    for (const record of this.records()) {
      if (record.provider + '/' + record.model !== key) continue;
      affectedRecords++; affectedTokens += record.totalTokens;
    }
    const sample = this.records().find(record => record.provider + '/' + record.model === key);
    const pricing = sample ? evaluate(sample, {}, { ...value.rates, provenance:'manual', billingProvider:value.provider }) : null;
    if(pricing?.lower !== null && pricing) { const multiplier=this.billing.defaults[sample.agent]?.multiplier ?? 1; pricing.lower*=multiplier; pricing.upper*=multiplier; }
    return {
      key, provider: value.provider, model: value.model, rates: value.rates,
      origin: this.overrides[key] ? 'manual' : previous ? previous.provenance || 'reference-unverified' : 'unpriced',
      previous: previous ? Object.fromEntries(FIELDS.map(field => [field, Number.isFinite(previous[field]) ? previous[field] * 1e6 : null])) : null,
      affectedRecords, affectedTokens,
      sample: pricing ? { reason: pricing.reason, lower: pricing.lower, upper: pricing.upper } : null
    };
  }
  setPrice(entry, remove = false) {
    const value = validate(entry), key = value.provider + '/' + value.model;
    const next = { ...this.overrides }; if (remove) delete next[key]; else next[key] = value.rates;
    atomic(path.join(this.dir, 'pricing.json'), next); this.overrides = next; this._snapshot = null;
    return this.pricing();
  }
  resolvePrice(record) {
    const key = record.provider + '/' + record.model, defaults = this.billing.defaults[record.agent];
    if (this.overrides[key]) return {rates:{...this.overrides[key],provenance:'manual'},origin:'manual',target:key};
    const target = this.billing.mappings[key] || (defaults?.mode === 'default' ? defaults.model : null);
    if (target) return {rates:this.overrides[target] ? {...this.overrides[target],provenance:'manual'} : this.modelCatalog[target],origin:this.billing.mappings[key] ? 'mapped' : 'default-model',target};
    if (this.modelCatalog[key] && this.modelCatalog[key].provenance !== 'reference-unverified') return {rates:this.modelCatalog[key],origin:this.modelCatalog[key].provenance,target:key};
    // Exact original-vendor model id, including models logged by another client.
    // Never fuzzy-match versions or guess what an auto/free route resolved to.
    const vendor = /^(gpt-|o[1-9])/i.test(record.model) ? 'openai' : /^claude-/i.test(record.model) ? 'anthropic' : /^gemini-/i.test(record.model) ? 'google' : /^mimo-/i.test(record.model) ? 'xiaomi' : /^deepseek-/i.test(record.model) ? 'deepseek' : /^glm-/i.test(record.model) ? 'zai' : /^minimax-/i.test(record.model) ? 'minimax' : /^hy[0-9]/i.test(record.model) ? 'tencent-tokenhub' : null;
    let candidate = this.modelCatalog[record.model] ? record.model : vendor && vendor + '/' + record.model;
    if(candidate && !this.modelCatalog[candidate]) {
      if(!this.caseCatalog){this.caseCatalog=new Map();for(const id of Object.keys(this.modelCatalog)){const lower=id.toLowerCase();this.caseCatalog.set(lower,this.caseCatalog.has(lower)?null:id);}}
      candidate=this.caseCatalog.get(candidate.toLowerCase()) || candidate;
    }
    const rates = candidate && this.modelCatalog[candidate];
    return rates && rates.provenance !== 'reference-unverified' ? {rates,origin:'model-id',target:candidate} : {rates:this.modelCatalog[key],origin:this.modelCatalog[key]?.provenance || 'unpriced',target:key};
  }
  installCatalog(value) {
    runtimeCatalog.verify(value); atomic(path.join(this.dir,'model-pricing.json'),value);
    this.remoteCatalog = value; this.downloadedCatalog = true; this.modelCatalog = runtimeCatalog.merged(value); this.caseCatalog = null; this.modelCatalogHash = runtimeCatalog.hash(this.modelCatalog); this._snapshot = null;
  }
  setBilling(value) {
    if (!value || typeof value.autoSync !== 'boolean' || !value.defaults || !value.mappings || Object.keys(value.mappings).length > 5000) throw new Error('PRICE_SETTING_INVALID');
    const defaults = {}, mappings = {};
    const validTarget = key => typeof key === 'string' && Boolean(this.overrides[key] || this.modelCatalog[key]) && !['reference-unverified','official-thirdparty-unverified'].includes((this.overrides[key] || this.modelCatalog[key]).provenance);
    for (const [agent, entry] of Object.entries(value.defaults)) {
      if (!SOURCES.includes(agent) || !['actual','default'].includes(entry?.mode) || !Number.isFinite(entry.multiplier) || entry.multiplier < 0 || entry.multiplier > 1000 || entry.mode === 'default' && !validTarget(entry.model)) throw new Error('PRICE_SETTING_INVALID');
      defaults[agent] = {mode:entry.mode,multiplier:entry.multiplier,model:entry.mode === 'default' ? entry.model : null};
    }
    for (const [key, target] of Object.entries(value.mappings)) {
      const cut = key.indexOf('/');
      if (!isIdentifier(key.slice(0,cut)) || !isIdentifier(key.slice(cut+1)) || !validTarget(target)) throw new Error('PRICE_MAPPING_INVALID');
      mappings[key] = target;
    }
    const next = {autoSync:value.autoSync,defaults,mappings};
    atomic(path.join(this.dir,'billing.json'),next); this.billing = next; this._snapshot = null;
    return this.pricing();
  }
  clear() { this.state.records = {}; this.state.duplicateIds = {}; this.state.statuses = {}; this.state.sequence++; this.state.updatedAt = null; atomic(path.join(this.dir, 'statistics.json'), this.state); }
}
module.exports = { Store, atomic, price }; // load/day 仅为模块内部使用，不再导出
