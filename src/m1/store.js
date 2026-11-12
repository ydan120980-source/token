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
const {projectName,resumeCommand} = require('./sessions');
const scope = require('./source-scope');
const registry = require('./source-registry');
const {addSession} = require('./session-aggregate');
const workbench = require('./workbench');
const { OperationMetrics } = require('./operation-metrics');
function sessionSelection(selection = {}) {
  const {range = 'all', recent = false} = selection || {};
  if (!selection || typeof selection !== 'object' || Array.isArray(selection) || Object.keys(selection).some(key => !['range','recent'].includes(key)) || !['today','7','30','all'].includes(range) || typeof recent !== 'boolean') throw Error('SESSION_SELECTION_INVALID');
  return {range,recent,key:JSON.stringify([range,recent])};
}
function atomic(file, value, ledger = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp-' + crypto.randomBytes(6).toString('hex');
  try {
    if(ledger){const fd=fs.openSync(temporary,'w',0o600);try{require('./write-statistics').writeStatistics(value,text=>fs.writeFileSync(fd,text));}finally{fs.closeSync(fd);}}
    else fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temporary, file);
  }
  catch (error) { try { fs.unlinkSync(temporary); } catch {} throw error; }
}
/**
 * Move a damaged file aside instead of failing the whole application. The bytes
 * stay on disk for a human to inspect, and the next start no longer trips over
 * them. The caller keeps the empty fallback either way, so this is best effort.
 */
function quarantineFile(file, code = 'INVALID_JSON') {
  const name = path.basename(file);
  const directory = path.join(path.dirname(file), 'quarantine');
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const target = path.join(directory, name.replace(/\.json$/, '') + '-' + stamp + '.json');
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.renameSync(file, target);
    return { file: name, quarantined: path.posix.join('quarantine', path.basename(target)), code };
  } catch { return { file: name, quarantined: null, code: code === 'INVALID_JSON' ? 'QUARANTINE_FAILED' : code }; }
}
function freshState() { return { version: 1, deviceId: crypto.randomUUID(), salt: crypto.randomBytes(32).toString('hex'), sequence: 0, records: {}, statuses: {} }; }
function validState(state) { return Boolean(state) && state.version === 1 && typeof state.deviceId === 'string' && state.deviceId.length > 0 && typeof state.salt === 'string' && state.records && typeof state.records === 'object' && state.statuses && typeof state.statuses === 'object' && Number.isSafeInteger(state.sequence) && require('./jsonl-adapter').validSaved(state.customSources); }
function load(file, fallback, recovered, ledger = false) {
  if(ledger)try{return require('./read-statistics').readStatistics(file);}catch(error){if(error.code==='ENOENT')return fallback;if(recovered){recovered.push(quarantineFile(file));return fallback;}throw new Error('LOCAL_STORAGE_INVALID',{cause:error});}
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    if (recovered) { recovered.push(quarantineFile(file)); return fallback; }
    throw new Error('LOCAL_STORAGE_INVALID', { cause: error });
  }
  try { return JSON.parse(text); } catch (error) {
    if (recovered) { recovered.push(quarantineFile(file)); return fallback; }
    throw new Error('LOCAL_STORAGE_INVALID', { cause: error });
  }
}
const valuation = require('./valuation');
const {FIXABLE}=require('./pricing-labels');
const {projectUsage,day} = require('./usage-projection');
class Store {
  constructor(dir, defaults = roots()) {
    this.dir = dir; this.recovered = [];
    this._metrics = new OperationMetrics(['clone', 'digest', 'persist', 'projection'], ['snapshotHit', 'initial', 'ledger', 'timezone', 'day', 'invalidated']);
    const own = localPath(dir).toLowerCase();
    this.checkRoots = selected => { for (const list of Object.values(selected)) for (const source of list) { const normalized = localPath(source).toLowerCase(); if (normalized === own || normalized.startsWith(own + path.sep) || own.startsWith(normalized + path.sep)) throw new Error('SOURCE_PRODUCT_OVERLAP'); } };
    this.checkRoots(defaults);
    this.defaults = defaults;
    const statistics = path.join(dir, 'statistics.json');
    this.state = load(statistics, freshState(), this.recovered, true);
    const saved = load(path.join(dir, 'preferences.json'), { enabled: true }, this.recovered);
    const { roots: savedRoots, sources: savedScope, ...settings } = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : { enabled: true };
    // The saved scope holds only the user's changes; automatic locations, including
    // ones added by later versions, are recomputed on every start. A preferences file
    // from before the scope existed is migrated from its full per-Agent lists.
    this.settings = { ...settings, sources: scope.sanitize(savedScope) || scope.migrate(savedRoots, defaults) };
    this.checkRoots(this.sourceRoots());
    this.validation = load(path.join(dir, 'validation.json'), {}, this.recovered);
    this.overrides = load(path.join(dir, 'pricing.json'), {}, this.recovered);
    this.billing = load(path.join(dir, 'billing.json'), { autoSync:true, defaults:{}, mappings:{} }, this.recovered);
    const workbenchFile=path.join(dir,'workbench.json');
    try { this.workbenchSettings=workbench.settings(load(workbenchFile,workbench.emptySettings(),this.recovered)); }
    catch { this.recovered.push(quarantineFile(workbenchFile,'LOCAL_STORAGE_INVALID')); this.workbenchSettings=workbench.emptySettings(); }
    this.downloadedCatalog = false; this.persistedDigest = null;
    try { const saved = load(path.join(dir,'model-pricing.json'), null, this.recovered); this.remoteCatalog = runtimeCatalog.verify(saved || runtimeCatalog.embedded); this.downloadedCatalog = Boolean(saved); } catch { this.remoteCatalog = runtimeCatalog.verify(runtimeCatalog.embedded); }
    this.modelCatalog = runtimeCatalog.merged(this.remoteCatalog);
    this.modelCatalogHash = runtimeCatalog.hash(this.modelCatalog);
    if (!validState(this.state)) { this.recovered.push(quarantineFile(statistics, 'LOCAL_STORAGE_INVALID')); this.state = freshState(); }
    const needsSave = !fs.existsSync(statistics) || !this.state.duplicateIds || !this.state.sessions;
    this.state.duplicateIds ||= {};
    this.state.sessions ||= {};
    require('./saved-string-sharing').shareSavedStrings(this.state);
    // Keep the original records recoverable; suppress proven historical copies.
    let migrated = false;
    const migrate = () => { if (!migrated) atomic(path.join(dir,'backups','statistics-before-dedupe-' + this.state.sequence + '.json'), this.state); migrated = true; };
    // Keep first-save ownership and complete snapshot selection identical in readers.
    require('./ledger-view').reconcile(this.state,migrate,LABELS);
    const exports = new Map();
    for (const record of this.records()) if (record.agent === 'cursor' && record.entry === 'export' && record.csvIdentity === undefined) {
      if (!migrated) atomic(path.join(dir,'backups','statistics-before-dedupe-' + this.state.sequence + '.json'), this.state);
      migrated = true;
      const signature = csvIdentity(record), occurrence = exports.get(signature) || 0; exports.set(signature,occurrence + 1);
      record.csvIdentity = digest(this.state.salt,'cursor-export/2:' + signature + ':' + occurrence);
    }
    if (needsSave || migrated) atomic(statistics, this.state, true);
  }
  catalog() { return registry.catalog(this.state); }
  workbench(selection) {
    const value=workbench.request(selection),snapshot=this.snapshot(),key=JSON.stringify(value);
    if(this._workbench?.snapshot!==snapshot||this._workbench.settings!==this.workbenchSettings||this._workbench.scope!==this.settings.sources)this._workbench={snapshot,settings:this.workbenchSettings,scope:this.settings.sources,views:new Map()};
    if(!this._workbench.views.has(key)){
      if(this._workbench.views.size>=8)this._workbench.views.clear();
      const calendar=this._projectionCalendar;
      this._workbench.views.set(key,workbench.build(this,value,{snapshot,cachedDate:calendar?.timezone===snapshot.timezone?calendar.at.cachedDate:undefined}));
    }
    return this._workbench.views.get(key);
  }
  saveWorkbench(value) {
    const next=workbench.change(this,value);
    atomic(path.join(this.dir,'workbench.json'),next);this.workbenchSettings=next;
    try { return this.workbench({project:value.project,period:value.period}); }
    catch(error){
      // A removed project's saved budget can still be acknowledged/deleted. The
      // mutation succeeded; return the same period's overview instead of an error.
      if(error.message!=='WORKBENCH_SCOPE_INVALID')throw error;
      return this.workbench({project:'all',period:value.period});
    }
  }
  reprice() {
    this._snapshot=null;this._sessions=null;
    return {recalculated:true,records:this.records().length,sequence:this.state.sequence,priceBasis:this.snapshot().priceCatalog};
  }
  diagnostics() { return this._metrics.state(); }
  collectionWrite(file,value) { return this._metrics.measure('persist',()=>atomic(file,value,true)); }
  collectionState() {
    // Ingest replaces whole observations and session/status objects. Only these
    // dictionaries are mutated; retained records and unknown saved fields stay
    // shared and read-only until replaced. Failed drafts never touch live facts.
    return {...this.state,records:{...this.state.records},duplicateIds:{...this.state.duplicateIds},sessions:{...this.state.sessions},statuses:structuredClone(this.state.statuses)};
  }
  ingestCollection(scan,native,custom) {
    return this.commitCollection(this.prepareCollection(scan,native,custom));
  }
  prepareCollection(scan,native,custom) {
    // Build the complete fact batch off to the side. Existing per-source drafts
    // retain missing observations; only the final ledger is made visible/durable.
    if(!scan&&!Object.entries(custom||{}).some(([id,result])=>{
      const source=this.state.customSources?.[id];
      return source?.enabled&&!source.archived&&JSON.stringify(source)!==JSON.stringify({...source,files:result.files,diagnostics:result.diagnostics,fileCount:result.fileCount});
    }))return null;
    const draft=Object.create(this),writes=[],ledger=path.join(this.dir,'statistics.json');
    draft.state=this._metrics.measure('clone',()=>this.collectionState());draft._snapshot=null;draft._sessions=null;draft._collectionStaging=true;
    draft._collectionPrevious={state:this.state,snapshot:this._snapshot};
    draft.collectionWrite=(file,value)=>writes.push(file===ledger?{file}:{file,value:value===draft.state?draft.collectionState():value});
    if(scan)draft.ingestDraft(scan,native);
    draft.ingestCustom(custom);
    // ingestDraft already hashed the complete built-in draft. Custom changes
    // clear persistedDigest, so only those need a fresh final hash. Reusing the
    // staged digest avoids serializing the entire unchanged ledger twice.
    const digest=draft.persistedDigest ?? draft.digest(),changed=writes.some(row=>row.file===ledger)&&digest!==this.persistedDigest;
    draft.state.sequence=this.state.sequence+(changed?1:0);
    let snapshot;
    if(changed){
      // Calculate before persistence: a failed projection must not leave disk and
      // memory disagreeing after an otherwise successful atomic rename.
      draft.state.updatedAt=new Date().toISOString();draft._snapshot=null;
      snapshot=draft.snapshot();
    }
    return { draft, writes, ledger, digest, changed, scan, snapshot };
  }
  commitCollection(batch, verifiedAt = null) {
    if (!batch) return this.snapshot();
    const { draft, writes, ledger, digest, changed, scan, snapshot } = batch;
    if (verifiedAt) {
      // A draft built alongside the native check becomes current only when
      // the check succeeds. Attempt timestamps do not participate in digest().
      for (const agent of SOURCES) {
        const status = draft.state.statuses[agent];
        status.lastAttempt = verifiedAt;
        if (!status.errors.length && !scan[agent].partial) status.lastSuccess = verifiedAt;
      }
      if (changed) {
        draft.state.updatedAt = verifiedAt;
        snapshot.collectedAt = verifiedAt;
        snapshot.generatedAt = verifiedAt;
      }
    }
    if(changed){
      for(const row of writes)if(row.file!==ledger)atomic(row.file,row.value,true);
      this.collectionWrite(ledger,draft.state);
      this.state=draft.state;this._snapshot=snapshot;this._projectionBasis=draft._projectionBasis;this._projectionCalendar=draft._projectionCalendar;this._sessions=null;this._workbench=null;this.persistedDigest=digest;
    }else if(scan){this.state=draft.state;}
    return this.snapshot();
  }
  commitCustom(source, records) {
    const old = this.state.customSources?.[source.id];
    if (JSON.stringify(old) === JSON.stringify(source)) return false;
    const state = { ...this.state, customSources: {...this.state.customSources,[source.id]:source}, records: {...this.state.records}, statuses:{...this.state.statuses}, sequence:this.state.sequence+1, updatedAt:new Date().toISOString() };
    for (const [key,record] of Object.entries(state.records)) if (record.agent === source.id) delete state.records[key];
    for (const record of records) state.records[record.id] = record;
    const d=source.diagnostics || {}, errors=[...(d.errors || [])]; if(d.invalid) errors.push('SOURCE_ROW_INVALID'); if(d.unsupported) errors.push('CUSTOM_COUNTER_UNSUPPORTED'); if(d.conflicts) errors.push('SOURCE_USAGE_CONFLICT'); if(d.retained) errors.push('CUSTOM_HISTORY_RETAINED');
    state.statuses[source.id]={agent:source.id,status:errors.length || records.some(r=>r.quality !== 'measured') ? 'partial' : 'unverified',lastSuccess:errors.length ? this.state.statuses[source.id]?.lastSuccess || null : state.updatedAt,observedRecords:records.length,realSampleVerified:false,errors,parserVersion:'custom-jsonl/1:'+source.version};
    if(source.previous && old?.version !== source.version) this.collectionWrite(path.join(this.dir,'backups','custom-'+source.id+'-'+state.sequence+'.json'),old);
    if (!Object.keys(this.state.customSources || {}).length) this.collectionWrite(path.join(this.dir,'backups','statistics-before-custom-v1-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex')+'.json'),this.state);
    this.collectionWrite(path.join(this.dir,'statistics.json'),state); this.state=state; this._snapshot=null; this.persistedDigest=null; return true;
  }
  ingestCustom(results) {
    for(const [id,result] of Object.entries(results || {})) { const source=this.state.customSources?.[id]; if(source && source.enabled && !source.archived) this.commitCustom({...source,files:result.files,diagnostics:result.diagnostics,fileCount:result.fileCount},result.records); }
  }
  records() { return Object.values(this.state.records).filter(record => !this.state.duplicateIds?.[record.id]); }
  ingest(scan, native) {
    // Collection is one ledger transaction. Failed persistence must not expose
    // uncommitted records, statuses or sequence numbers to queries or retries.
    const previous = {state:this.state,snapshot:this._snapshot,digest:this.persistedDigest};
    this.state = this._metrics.measure('clone',()=>this.collectionState());
    try { return this.ingestDraft(scan,native); }
    catch (error) { this.state=previous.state; this._snapshot=previous.snapshot; this.persistedDigest=previous.digest; throw error; }
  }
  ingestDraft(scan, native) {
    const at = new Date().toISOString();
    const initialKeys=Object.keys(this.state.records),retained=[];
    for(const id of initialKeys){const record=this.state.records[id];if(!this.state.duplicateIds?.[record.id])retained.push(record);}
    const shared = new Map(retained.filter(r => r.sharedKey).map(r => [r.sharedKey,r.id]));
    const exports = new Map(retained.filter(r => r.csvIdentity).map(r => [r.csvIdentity,r.id]));
    // Build the full order index only when two existing identities actually
    // compete. Ordinary scans must not allocate 100k temporary [id,index] pairs.
    let recordOrder=null;const processed=[];
    const position=id=>{if(!recordOrder){recordOrder=new Map();for(let i=0;i<initialKeys.length;i++)recordOrder.set(initialKeys[i],i);for(const key of processed)if(!recordOrder.has(key))recordOrder.set(key,recordOrder.size);}return recordOrder.get(id)??Infinity;};
    const previousSuccess = new Map(Object.entries(this.state.statuses).map(([agent,status])=>[agent,status.lastSuccess]));
    const conflicts = new Set();
    let backedUp = false;
    const backup = () => { if (!backedUp) { this.collectionWrite(path.join(this.dir,'backups','statistics-before-identity-' + this.state.sequence + '.json'),this.state); backedUp = true; } };
    if (this.state.statuses.codex?.parserVersion !== 'm1-projection/2 + tokscale/4.17.0' && Object.values(this.state.records).some(r => r.agent === 'codex')) this.collectionWrite(path.join(this.dir, 'backups', 'statistics-before-parser2-' + at.replaceAll(':', '-') + '.json'), this.state);
    // Missing files retain history. Their detailed records still supersede a
    // session aggregate reported by a later scan (including after a restart).
    const detailed=new Set();for(const r of retained)if(r.agent==='workbuddy'&&r.accountingKind!=='session-aggregate'&&r.sessionKey)detailed.add(r.sessionKey);
    for(const r of scan.workbuddy.records)if(r.agent==='workbuddy'&&r.accountingKind!=='session-aggregate'&&r.sessionKey)detailed.add(r.sessionKey);
    if (detailed.size) for (const id of initialKeys){const old=this.state.records[id];if (old.agent === 'workbuddy' && old.accountingKind === 'session-aggregate' && detailed.has(old.sessionKey)) delete this.state.records[id];}
    for (const agent of SOURCES) {
      let result = scan[agent];
      if (agent === 'copilot') {
        const modes = new Set(Object.values(this.state.records).filter(r => r.agent === agent).map(r => r.entry));
        for (const record of result.records) modes.add(record.entry);
        if (modes.size > 1) result = {...result, records:[], partial:true, errors:[...new Set([...result.errors,'COPILOT_SOURCE_MODE_CONFLICT'])]};
        else if (result.records.some(record => record.entry === 'cli')) {
          const previous = retained.filter(record => record.agent === agent && record.entry === 'cli');
          const intervals = require('./batch1-sources').copilotIntervals([...previous,...result.records]);
          result = {...result,records:intervals,partial:result.partial || intervals.warnings.length > 0,errors:[...new Set([...result.errors,...intervals.warnings])]};
          const next = new Map(intervals.map(record => [record.id,record]));
          const corrected = previous.filter(record => !next.has(record.id) || JSON.stringify(record) !== JSON.stringify(next.get(record.id)));
          if (corrected.length) backup();
          // Recomputed intervals can shrink when an older checkpoint arrives.
          // The original cumulative facts, rather than the old interval maxima,
          // own that correction. All of this still runs inside the staged batch.
          for (const record of corrected) delete this.state.records[record.id];
        }
      }
      if (agent === 'cursor') {
        const modes = new Set(Object.values(this.state.records).filter(r => r.agent === 'cursor').map(r => r.entry));
        for (const record of result.records) modes.add(record.entry);
        if (modes.size > 1) result = {...result, records:[], partial:true, errors:[...new Set([...result.errors,'CURSOR_SOURCE_MODE_CONFLICT'])]};
      }
      const errors = new Set(result.errors);
      for (const record of result.records) {
        if (agent === 'workbuddy' && record.accountingKind === 'session-aggregate' && detailed.has(record.sessionKey)) continue;
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
          const existing = [...identities].filter(id=>this.state.records[id]).sort((a,b)=>position(a)-position(b));
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
        let saved = old ? choice.record===old?old:keepIdentity(old,choice.record) : choice.record;
        if (record.sharedKey&&(saved.sharedKey!==record.sharedKey||JSON.stringify(saved.sharedRecordIds)!==JSON.stringify(record.sharedRecordIds))) { saved={...saved,sharedKey:record.sharedKey,sharedRecordIds:record.sharedRecordIds}; }
        if (record.csvIdentity&&saved.csvIdentity!==record.csvIdentity) saved={...saved,csvIdentity:record.csvIdentity};
        this.state.records[ownerId] = saved;
        if(recordOrder){if(!recordOrder.has(ownerId))recordOrder.set(ownerId,recordOrder.size);}else processed.push(ownerId);
      }
      result = {...result, errors:[...errors], partial:result.partial || errors.size > 0};
      // A new observation replaces the session's metadata completely.
      for (const entry of result.sessions || []) this.state.sessions[entry.key] = { agent, id: entry.id, cwd: entry.cwd ?? null, ...(entry.title ? { title: entry.title } : {}), ...(entry.at ? { at: entry.at } : {}) };
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
    // A rescan that reproduces the stored ledger changes nothing durable: skip the
    // full rewrite and keep the sequence so the snapshot is not rebuilt.
    const digest = this.digest();
    if (digest !== this.persistedDigest) {
      this.state.sequence++; this.state.updatedAt = at;
      this.collectionWrite(path.join(this.dir, 'statistics.json'), this.state); this.persistedDigest = digest;
    }
    return this._collectionStaging?null:this.snapshot();
  }
  // API-equivalent estimate of one record, with its billing multiplier applied.
  priceContext() { return {overrides:this.overrides,modelCatalog:this.modelCatalog,billing:this.billing,remoteCatalog:this.remoteCatalog}; }
  pricingCore() {
    if (!this._pricingCore || this._pricingCore.overrides !== this.overrides || this._pricingCore.models !== this.modelCatalog || this._pricingCore.billing !== this.billing) this._pricingCore = {overrides:this.overrides,models:this.modelCatalog,billing:this.billing,value:valuation.createPricing(this.priceContext())};
    return this._pricingCore.value;
  }
  estimate(record) { return this.pricingCore().estimate(record); }
  // Ledger content without per-attempt timing, which changes on every scan.
  digest() {
    const statuses = Object.fromEntries(Object.entries(this.state.statuses).map(([agent, status]) => {
      const durable = { ...status }; delete durable.lastAttempt; delete durable.lastSuccess; delete durable.durationMs;
      return [agent, durable];
    }));
    return this._metrics.measure('digest',()=>{const hash=crypto.createHash('sha256');require('./write-statistics').writeStatistics({...this.state,sequence:0,updatedAt:null,statuses},text=>hash.update(text));return hash.digest('hex');});
  }
  snapshot() {
    const now = Date.now(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone, today = day(now, timezone);
    if (this._snapshot?.sequence === this.state.sequence && this._snapshot.timezone === timezone && this._snapshot.today === today) {
      this._metrics.count('snapshotHit');
      return this._snapshot;
    }
    const previous = this._projectionBasis;
    const reason = !previous ? 'initial' : previous.sequence !== this.state.sequence ? 'ledger' : previous.timezone !== timezone ? 'timezone' : previous.today !== today ? 'day' : 'invalidated';
    this._metrics.count(reason);
    const snapshot = this._metrics.measure('projection', () => {
      if (this._projectionCalendar?.timezone !== timezone) {
        const { projectionCalendar } = require('./usage-projection');
        this._projectionCalendar = { timezone, at: projectionCalendar(timezone, 65536) };
      }
      const options={records:this.records(),estimate:record=>this.estimate(record),sequence:this.state.sequence,updatedAt:this.state.updatedAt,deviceId:this.state.deviceId,sourceCatalog:this.catalog(),priceCatalog:valuation.priceBasis(this.priceContext()),statuses:this.state.statuses,recovered:this.recovered,timezone,now,calendar:this._projectionCalendar.at};
      const incremental=this._collectionPrevious?require('./usage-projection-incremental').projectIncremental(options,{...this._collectionPrevious,currentRecords:this.state.records,currentDuplicates:this.state.duplicateIds}):null;
      this._collectionPrevious=null;return incremental||projectUsage(options);
    });
    this._projectionBasis = { sequence: this.state.sequence, timezone, today };
    this._snapshot = snapshot;
    // A page may never request these again after a refresh. Do not retain its
    // old snapshot and aggregates until that page happens to be opened.
    this._sessions = null; this._workbench = null;
    return snapshot;
  }
  // Per-session totals by local day, joined with the locally kept session metadata.
  // Only for the session page: never part of UsageSnapshotV1 or its export.
  sessionList(selection = {}) {
    const selected = sessionSelection(selection),{key}=selected;
    const snapshot = this.snapshot();
    const cached=this._sessions?.snapshot===snapshot&&this._sessions.key===key?this._sessions:null;
    const held=cached?.value?.deref();if(held)return held;
    const projection=this._sessionProjection(selected,snapshot),value={...projection,sessions:[...projection.sessions]};
    this._sessions = { snapshot, key, value:new WeakRef(value),bytes:cached?.bytes };
    return value;
  }
  _sessionProjection({range,recent},snapshot) {
    const groups = new Map(), unattributed = {}, records = this.records(), dates = new Map();
    const calendar = this._projectionCalendar?.timezone === snapshot.timezone ? this._projectionCalendar.at : null;
    const dateOf = timestamp => {
      const saved = calendar?.cachedDate(timestamp) ?? dates.get(timestamp);
      if (saved !== undefined) return saved;
      const date = day(timestamp,snapshot.timezone);
      if (dates.size < 4096) dates.set(timestamp,date);
      return date;
    };
    const start = range === 'all' ? '0000-01-01' : require('./usage-math').startFor(snapshot.today,range,null);
    for (const record of records) {
      if (!record.sessionKey) { const date = dateOf(record.timestamp); if(range==='all'||date>=start&&date<=snapshot.today){const counts = unattributed[record.agent] ||= {}; counts[date] = (counts[date] || 0) + 1;} continue; }
      let session = groups.get(record.sessionKey);
      if (!session) groups.set(record.sessionKey, session = { agent: record.agent, start: record.timestamp, end: record.timestamp });
      if (record.timestamp < session.start) session.start = record.timestamp;
      if (record.timestamp > session.end) session.end = record.timestamp;
      if (!recent) (session.records ??= []).push(record);
    }
    // A session its Agent lists with no usage tied to it (Continue): a row with no records, which reads as unknown, never 0.
    if (!recent) for (const [key, meta] of Object.entries(this.state.sessions)) {
      if (!meta?.at || groups.has(key)) continue;
      const date = dateOf(meta.at);
      groups.set(key, { agent: meta.agent, start: meta.at, end: meta.at, entries: new Set(), models: new Set(), days: new Map(range === 'all' || date >= start && date <= snapshot.today ? [[date, { date }]] : []) });
    }
    // The largest recent widget needs five sessions per Agent, never the full ledger.
    let selected = groups;
    if(recent){selected=new Map();const agents=new Map();for(const [id,session] of [...groups].sort((a,b)=>b[1].end.localeCompare(a[1].end))){const count=agents.get(session.agent)||0;if(count<5){selected.set(id,session);agents.set(session.agent,count+1);}}}
    // Group only references to existing observations. Aggregate and encode one
    // session at a time, instead of retaining Sets/Maps and full rows for all.
    if (recent) for (const record of records) {
      const session = selected.get(record.sessionKey);
      if (session) (session.records ??= []).push(record);
    }
    const store=this;
    function* sessions(){
      for(const [key,session]of selected){
        const entries=new Set(),models=new Set(),days=new Map(session.days);
        for(const record of session.records??[]){entries.add(record.entry);models.add(record.model);const date=dateOf(record.timestamp);if(range==='all'||date>=start&&date<=snapshot.today)addSession(days,date,record,store.estimate(record));}
        session.records=null;
        const saved=store.state.sessions[key],meta=saved?.agent===session.agent?saved:null;
        yield {key,agent:session.agent,entries:[...entries].sort(),models:[...models].sort(),start:session.start,end:session.end,
          id:meta?.id??null,cwd:meta?.cwd??null,title:meta?.title??null,project:projectName(meta?.cwd??null),resumable:resumeCommand(session.agent,meta)!==null,days:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date))};
      }
    }
    return {schemaVersion:'SessionListV1',sequence:snapshot.sequence,timezone:snapshot.timezone,today:snapshot.today,sessions:sessions(),unattributed};
  }
  sessionListPacked(selection = {}) {
    const selected=sessionSelection(selection),{key}=selected,snapshot=this.snapshot();
    const cached=this._sessions?.snapshot===snapshot&&this._sessions.key===key?this._sessions:null;
    if(!cached?.bytes){
      const list=cached?.value?.deref()||this._sessionProjection(selected,snapshot);
      const bytes=require('./session-list-codec').packIterable(list,this.catalog()).sessionBytes;
      this._sessions={snapshot,key,value:cached?.value,bytes};
    }
    // The existing single-selection cache retains encoded saved facts instead
    // of a second full list. Transfer only a copy so the cached bytes stay owned.
    return {schemaVersion:'SessionListBytesV1',sessionBytes:this._sessions.bytes.slice(0)};
  }
  // The resume command for one listed session, built from the saved metadata only.
  resume(key) {
    const meta = this.state.sessions[key];
    return meta ? resumeCommand(meta.agent, meta) : null;
  }
  // One session's conversation, read from its own file now and never kept (SESSIONS-READER-20261101.md).
  async transcript(key, request) {
    const meta = typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) ? this.state.sessions[key] : null;
    if (!meta?.id) throw new Error('TRANSCRIPT_NOT_FOUND');
    if (request !== undefined) require('./transcript-continuation').validate(request);
    const args = [meta.agent, meta.id, this.sourceRoots()[meta.agent] || []];
    if (request !== undefined) args.push(request);
    return require('./transcript-tasks').run('transcript', args);
  }
  // One item of an open conversation in full (a page of text or output, or an image), and where a
  // phrase appears in it; both re-read the record and refuse when it changed since it was shown.
  async transcriptStamp(key) {
    const meta = typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) ? this.state.sessions[key] : null;
    if (!meta?.id) throw new Error('TRANSCRIPT_NOT_FOUND');
    return { stamp: await require('./transcript').stampNow(meta.agent, meta.id, this.sourceRoots()[meta.agent] || []) };
  }
  async transcriptFacts(key) {
    const meta = typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) ? this.state.sessions[key] : null;
    if (!meta?.id) throw new Error('TRANSCRIPT_NOT_FOUND');
    return require('./transcript-tasks').run('facts', [meta.agent, meta.id, this.sourceRoots()[meta.agent] || []]);
  }
  async transcriptPart(key, request) { return this.transcriptCall('part', key, request, ['stamp', 'index', 'field', 'offset']); }
  async transcriptFind(key, request) { return this.transcriptCall('find', key, request, ['stamp', 'query']); }
  async transcriptMarkdown(key, request) { return this.transcriptCall('markdown', key, request, ['stamp', 'from', 'to', 'plain']); }
  async transcriptCall(name, key, request, fields) {
    const meta = typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) ? this.state.sessions[key] : null;
    if (!meta?.id) throw new Error('TRANSCRIPT_NOT_FOUND');
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(field => !fields.includes(field))) throw new Error('TRANSCRIPT_PART_INVALID');
    return require('./transcript-tasks').run(name, [meta.agent, meta.id, this.sourceRoots()[meta.agent] || [], request]);
  }
  // Cross-session search: the listed sessions of a range (and one Agent, or all), newest
  // first, from offset on; their files are scanned now and nothing is kept.
  _sessionReferences() {
    // These operations need identity and newest time only. Do not price and
    // materialize every session's daily facts merely to locate its source file.
    const groups=new Map();
    for(const record of this.records()){
      if(!record.sessionKey)continue;
      const old=groups.get(record.sessionKey);
      if(!old)groups.set(record.sessionKey,{key:record.sessionKey,agent:record.agent,end:record.timestamp});
      else if(record.timestamp>old.end)old.end=record.timestamp;
    }
    for(const [key,meta]of Object.entries(this.state.sessions))if(meta?.at&&!groups.has(key))groups.set(key,{key,agent:meta.agent,end:meta.at});
    return [...groups.values()];
  }
  async searchTranscripts(request) {
    const { query, range = 'all', agent = 'all', offset = 0 } = request && typeof request === 'object' && !Array.isArray(request) ? request : {};
    const phrase = typeof query === 'string' ? query.trim() : '';
    if (!phrase || phrase.length > 120 || /[\0-\x1f\x7f]/.test(phrase) || typeof agent !== 'string' || !Number.isInteger(offset) || offset < 0 || Object.keys(request).some(key => !['query', 'range', 'agent', 'offset'].includes(key))) throw new Error('TRANSCRIPT_SEARCH_INVALID');
    const { READERS } = require('./transcript'), roots = this.sourceRoots();
    try { sessionSelection({range}); } catch { throw new Error('TRANSCRIPT_SEARCH_INVALID'); }
    const entries = this._sessionReferences().filter(session => (agent === 'all' || session.agent === agent) && READERS.has(session.agent) && this.state.sessions[session.key]?.id)
      .sort((a, b) => String(b.end).localeCompare(String(a.end)))
      .map(session => ({ key: session.key, agent: session.agent, id: this.state.sessions[session.key].id }));
    const { results, scanned } = await require('./transcript-tasks').run('search', [entries.slice(offset), roots, phrase]);
    const next = offset + scanned < entries.length ? offset + scanned : null;
    return { schemaVersion: 'TranscriptSearchV1', results, searched: offset + scanned, total: entries.length, next };
  }
  // Which other listed sessions changed a file: their records are scanned now, newest first, from offset on; nothing is kept.
  async transcriptFileHistory(request) {
    const { key, path: file, offset = 0 } = request && typeof request === 'object' && !Array.isArray(request) ? request : {}, meta = typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) ? this.state.sessions[key] : null;
    if (!meta?.id) throw new Error('TRANSCRIPT_NOT_FOUND');
    if (typeof file !== 'string' || !file.trim() || file.length > 1000 || /[\0-\x1f\x7f]/.test(file) || !Number.isInteger(offset) || offset < 0 || Object.keys(request).some(name => !['key', 'path', 'offset'].includes(name))) throw new Error('TRANSCRIPT_SEARCH_INVALID');
    const { READERS } = require('./transcript'), roots = this.sourceRoots();
    const entries = this._sessionReferences().filter(session => session.key !== key && READERS.has(session.agent) && this.state.sessions[session.key]?.id)
      .sort((a, b) => String(b.end).localeCompare(String(a.end)))
      .map(session => ({ key: session.key, agent: session.agent, id: this.state.sessions[session.key].id, cwd: this.state.sessions[session.key].cwd || null }));
    const { results, scanned } = await require('./transcript-tasks').run('fileHistory', [entries.slice(offset), roots, { path: file, cwd: meta.cwd || null }]);
    return { schemaVersion: 'TranscriptFileHistoryV1', results, searched: offset + scanned, total: entries.length, next: offset + scanned < entries.length ? offset + scanned : null };
  }
  // How often each MCP server and Skill was used: listed sessions scanned now, newest first, from offset on; only names and counts come back, and nothing is kept.
  async agentUse(request) {
    const { offset = 0 } = request && typeof request === 'object' && !Array.isArray(request) ? request : {};
    if (!Number.isInteger(offset) || offset < 0) throw new Error('TRANSCRIPT_SEARCH_INVALID');
    const { READERS } = require('./transcript'), sessions = this._sessionReferences().filter(session => READERS.has(session.agent) && this.state.sessions[session.key]?.id).sort((a, b) => String(b.end).localeCompare(String(a.end)));
    const entries = sessions.map(session => ({ key: session.key, agent: session.agent, id: this.state.sessions[session.key].id, cwd: null })), about = new Map(sessions.map(session => [session.key, session]));
    const { results, scanned } = await require('./transcript-tasks').run('toolUse', [entries.slice(offset), this.sourceRoots(), null]);
    const rows = new Map();
    for (const found of results) {
      const session = about.get(found.key);
      for (const [kind, names] of [['mcp', found.mcp], ['skill', found.skill]]) for (const [name, calls] of Object.entries(names)) {
        const id = session.agent + '|' + kind + '|' + name, row = rows.get(id) ?? { agent: session.agent, kind, name, calls: 0, sessions: 0, last: null };
        row.calls += calls; row.sessions++; if (session.end && (!row.last || session.end > row.last)) row.last = session.end; rows.set(id, row);
      }
    }
    return { schemaVersion: 'AgentUseV1', rows: [...rows.values()], searched: offset + scanned, total: entries.length, next: offset + scanned < entries.length ? offset + scanned : null };
  }
  // The working directory for one listed session, if recorded.
  directory(key) {
    const meta = this.state.sessions[key];
    return meta?.cwd || null;
  }
  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('INVALID_SETTING');
    this.savePreferences({ ...this.settings, enabled });
  }
  // The roots the next scan reads.
  sourceRoots() { return scope.effective(this.settings.sources, this.defaults); }
  // Applies one scope change (see source-scope.js `change`) after checking that the
  // result never reads this application's own data directory.
  changeSources(name, ...args) {
    if (!Object.hasOwn(scope.change, name)) throw new Error('INVALID_SETTING');
    const next = scope.change[name](this.settings.sources, ...(['add', 'remove'].includes(name) ? [this.defaults] : []), ...args);
    this.checkRoots(scope.effective(next, this.defaults));
    this.savePreferences({ ...this.settings, sources: next });
  }
  // `roots` is written alongside the scope so an older version that only reads full
  // lists still collects from the same places.
  savePreferences(next = this.settings) {
    atomic(path.join(this.dir, 'preferences.json'), { ...next, roots: scope.effective(next.sources, this.defaults) });
    this.settings = next;
  }
  catalogHash() { return this.modelCatalogHash; }
  overrideHash() { return crypto.createHash('sha256').update(JSON.stringify(this.overrides || {})).digest('hex'); }
  pricing(view) {
    if (view === 'coverage') {
      return this.billing.fallback || this.billing.partialLowerBound ? valuation.coverageOf(this.pricingCore(), this.records()) : null;
    }
    if (view !== undefined) throw Error('PRICE_SETTING_INVALID');
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
      suggestions: require('./model-aliases').suggest([...models.values()].filter(row=>row.observed),this.modelCatalog,this.overrides),
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
    const coverage = valuation.coverageOf(valuation.createPricing({...this.priceContext(),overrides:{...this.overrides,[key]:value.rates}}), this.records().filter(record => record.provider + '/' + record.model === key));
    const sample = this.records().find(record => record.provider + '/' + record.model === key);
    const pricing = sample ? evaluate(sample, {}, { ...value.rates, provenance:'manual', billingProvider:value.provider }) : null;
    if(pricing?.lower !== null && pricing) { const multiplier=this.billing.defaults[sample.agent]?.multiplier ?? 1; pricing.lower*=multiplier; pricing.upper*=multiplier; }
    return {
      key, provider: value.provider, model: value.model, rates: value.rates,
      origin: this.overrides[key] ? 'manual' : previous ? previous.provenance || 'reference-unverified' : 'unpriced',
      previous: previous ? Object.fromEntries(FIELDS.map(field => [field, Number.isFinite(previous[field]) ? previous[field] * 1e6 : null])) : null,
      affectedRecords, affectedTokens, coverage,
      sample: pricing ? { reason: pricing.reason, lower: pricing.lower, upper: pricing.upper } : null
    };
  }
  /** Dry runs for the price sheet: what each mapping target would count of this model's records. Writes nothing. */
  priceTry(request) {
    const key = request?.key, targets = request?.targets;
    if (typeof key !== 'string' || !Array.isArray(targets) || targets.length > 16 || targets.some(target => !valuation.validPriceTarget(target, this.overrides, this.modelCatalog))) throw new Error('PRICE_SETTING_INVALID');
    const records = this.records().filter(record => record.provider + '/' + record.model === key), context = this.priceContext();
    const run = target => valuation.coverageOf(valuation.createPricing({...context,billing:{...this.billing,mappings:{...this.billing.mappings,[key]:target}}}), records);
    return {key,manual:Boolean(this.overrides[key]),current:valuation.coverageOf(this.pricingCore(), records),results:targets.map(target => ({target,coverage:run(target)}))};
  }
  /**
   * What one click would do, written nowhere: A maps every model whose candidates all give one price and leave
   * nothing a price could still close; B prices what is left with the person's fallback model; C adds the red
   * lower-bound option. Each step is on top of the one before, so `after` is exactly what applying this choice does.
   */
  pricePlan(request = {}) {
    const auto = request.auto !== false, partial = request.partial === true, fallback = request.fallback ?? null, context = this.priceContext();
    if (fallback !== null && !valuation.validPriceTarget(fallback, this.overrides, this.modelCatalog)) throw new Error('PRICE_SETTING_INVALID');
    const groups = new Map(); for (const record of this.records()) { const key = record.provider + '/' + record.model, list = groups.get(key) || []; list.push(record); groups.set(key, list); }
    const observed = [...groups.values()].map(list => ({provider:list[0].provider,model:list[0].model})), suggestions = require('./model-aliases').suggest(observed, this.modelCatalog, this.overrides);
    const rules = billing => valuation.createPricing({...context,billing}), closable = coverage => coverage.left.filter(row => FIXABLE.includes(row.reason)).reduce((sum, row) => sum + row.tokens, 0);
    const base = {...this.billing}; delete base.fallback; delete base.partialLowerBound;
    const start = rules(base), agentsOf = list => [...new Set(list.map(record => record.agent))];
    const matched = [], undecided = [];
    for (const [key, list] of groups) {
      const current = valuation.coverageOf(start, list), open = closable(current);
      if (!open) continue;
      const candidates = this.overrides[key] ? [] : suggestions[key]?.candidates || [];
      const whole = candidates.map(candidate => ({candidate,coverage:valuation.coverageOf(rules({...base,mappings:{...base.mappings,[key]:candidate.target}}), list)})).filter(item => closable(item.coverage) === 0 && item.coverage.counted > current.counted);
      const prices = new Set(whole.map(item => JSON.stringify(item.candidate.rates)));
      if (prices.size === 1) matched.push({key,target:whole[0].candidate.target,tokens:whole[0].coverage.counted - current.counted,lower:whole[0].coverage.lower,agents:agentsOf(list)});
      else undecided.push({key,tokens:open,agents:agentsOf(list),candidates:candidates.length,why:this.overrides[key] ? 'manual-incomplete' : prices.size > 1 ? 'several-prices' : candidates.length ? 'no-whole-candidate' : 'no-candidate'});
    }
    const mappings = auto ? Object.fromEntries(matched.map(item => [item.key, item.target])) : {}, stepA = {...base,mappings:{...base.mappings,...mappings}}, stepB = fallback ? {...stepA,fallback} : stepA, stepC = {...stepB,partialLowerBound:true};
    const lefts = auto ? undecided : [...matched.map(({key, tokens, agents}) => ({key,tokens,agents,candidates:1,why:'auto-off'})), ...undecided], all = this.records();
    const gain = (from, to) => { const models = []; let tokens = 0, usd = 0; for (const [key, list] of groups) { const a = valuation.coverageOf(from, list), b = valuation.coverageOf(to, list), more = b.counted - a.counted; if (more > 0) { const added = (b.lower ?? 0) - (a.lower ?? 0); models.push({key,tokens:more,lower:added,agents:agentsOf(list)}); tokens += more; usd += added; } } return {models:models.sort((x, y) => y.tokens - x.tokens),tokens,lower:usd}; };
    const final = rules(partial ? stepC : stepB);
    return {
      before:valuation.coverageOf(this.pricingCore(), all), matched, undecided:lefts,
      fallback:fallback ? {target:fallback,...gain(rules(stepA), rules(stepB))} : null, floor:gain(rules(stepB), rules(stepC)), after:valuation.coverageOf(final, all),
      mappings,
    };
  }
  setPrice(entry, remove = false) {
    const value = validate(remove ? {...entry,inputUncached:0,output:0,cacheRead:null,cacheWrite:null} : entry), key = value.provider + '/' + value.model;
    const next = { ...this.overrides }; if (remove) delete next[key]; else next[key] = value.rates;
    this.checkPriceReferences(next, this.modelCatalog);
    atomic(path.join(this.dir, 'pricing.json'), next); this.overrides = next; this._snapshot = null;
    return this.pricing();
  }
  resolvePrice(record) { return this.pricingCore().resolvePrice(record); }
  installCatalog(value) {
    runtimeCatalog.verify(value);
    const models = runtimeCatalog.merged(value), hash = runtimeCatalog.hash(models);
    this.checkPriceReferences(this.overrides, models);
    atomic(path.join(this.dir,'model-pricing.json'),value);
    this.remoteCatalog = value; this.downloadedCatalog = true; this.modelCatalog = models; this.modelCatalogHash = hash; this._snapshot = null;
  }
  checkPriceReferences(overrides, modelCatalog) { valuation.checkPriceReferences(this.billing, this.priceContext(), {overrides,modelCatalog}); }
  validateBilling(value, allowMissing = false) { return valuation.validateBilling(value, {...this.priceContext(),agents:this.catalog()}, allowMissing); }
  setBilling(value) {
    const next = this.validateBilling(value);
    atomic(path.join(this.dir,'billing.json'),next); this.billing = next; this._snapshot = null;
    return this.pricing();
  }
  clear() {
    const next = { ...this.state, records: {}, duplicateIds: {}, sessions: {}, statuses: {}, sequence: this.state.sequence + 1, updatedAt: null };
    if (this.state.customSources) next.customSources = Object.fromEntries(Object.entries(this.state.customSources).map(([id,source]) => [id,{ ...source, files: {}, previous: null }]));
    atomic(path.join(this.dir, 'statistics.json'), next);
    this.state = next; this._snapshot = null; this._sessions = null; this.persistedDigest = null;
  }
}
module.exports = { Store, atomic, price }; // load/day 仅为模块内部使用，不再导出
