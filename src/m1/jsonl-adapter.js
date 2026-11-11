'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {normalize, number, digest} = require('./normalize');
const {filesUnder, localPath} = require('./policy');
const {selectUsageSnapshot} = require('./usage-snapshot');
const FIELDS = ['id','session','time','model','provider','input','output','cacheRead','cacheWrite','reasoning','total'];
const TOKENS = ['input','output','cacheRead','cacheWrite','reasoning','total'];
const STANDARD = {id:'id',session:'sessionId',time:'timestamp',model:'model',provider:'provider',input:'inputTokens',output:'outputTokens',cacheRead:'cacheReadTokens',cacheWrite:'cacheWriteTokens',reasoning:'reasoningTokens',total:'totalTokens'};
const CLAUDE = {id:'message.id',session:'sessionId',time:'timestamp',model:'message.model',provider:'provider',input:'message.usage.input_tokens',output:'message.usage.output_tokens',cacheRead:'message.usage.cache_read_input_tokens',cacheWrite:'message.usage.cache_creation_input_tokens',reasoning:'message.usage.reasoning_output_tokens',total:'message.usage.total_tokens'};
const MAX_LINE = 1024 * 1024;
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function keys(value, allowed) { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('CUSTOM_CONFIG_INVALID'); }
function field(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || !value.split('.').every(part => /^[a-zA-Z0-9_$-]+$/.test(part) && !['__proto__','prototype','constructor'].includes(part))) throw new Error('CUSTOM_FIELD_INVALID');
  return value;
}
function get(value, dotted) {
  if (!dotted) return undefined;
  for (const part of dotted.split('.')) { if (!object(value) && !Array.isArray(value) || !Object.hasOwn(value, part)) return undefined; value = value[part]; }
  return value;
}
function definition(value) {
  keys(value, ['schemaVersion','name','template','mode','mapping','filters','timeUnit','inputSemantics','outputIncludesReasoning']);
  if (value.schemaVersion !== 'CustomSourceV1' || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 || /[\x00-\x1f\x7f]/.test(value.name) || !['claude','mapped','standard'].includes(value.template)) throw new Error('CUSTOM_CONFIG_INVALID');
  if (value.mode !== 'per-request') throw new Error('CUSTOM_COUNTER_UNSUPPORTED');
  const mapped = value.template === 'mapped';
  let mapping = value.template === 'claude' ? CLAUDE : STANDARD, filters = [];
  if (mapped) {
    keys(value.mapping, FIELDS); mapping = {};
    for (const [name, valuePath] of Object.entries(value.mapping)) if (valuePath) mapping[name] = field(valuePath);
    if (!mapping.id || !mapping.time || ![mapping.input,mapping.output,mapping.total].some(Boolean)) throw new Error('CUSTOM_FIELD_INVALID');
    if (!['inclusive','exclusive'].includes(value.inputSemantics) || typeof value.outputIncludesReasoning !== 'boolean' || !['iso','s','ms'].includes(value.timeUnit)) throw new Error('CUSTOM_CONFIG_INVALID');
    if (!Array.isArray(value.filters) || value.filters.length > 8) throw new Error('CUSTOM_CONFIG_INVALID');
    filters = value.filters.map(filter => {
      keys(filter, ['path','values']); field(filter.path);
      if (!Array.isArray(filter.values) || !filter.values.length || filter.values.length > 16 || filter.values.some(v => v !== null && !['string','number','boolean'].includes(typeof v) || typeof v === 'string' && v.length > 180 || typeof v === 'number' && !Number.isFinite(v))) throw new Error('CUSTOM_CONFIG_INVALID');
      return {path:filter.path,values:filter.values};
    });
  } else if (value.mapping !== undefined || value.filters !== undefined || value.timeUnit !== undefined || value.inputSemantics !== undefined || value.outputIncludesReasoning !== undefined) throw new Error('CUSTOM_CONFIG_INVALID');
  return {schemaVersion:'CustomSourceV1',name:value.name.trim(),template:value.template,mode:'per-request',...(mapped ? {mapping,filters,timeUnit:value.timeUnit,inputSemantics:value.inputSemantics,outputIncludesReasoning:value.outputIncludesReasoning} : {})};
}
function parserHash(config) { const {name:_name,...rules}=config;return hash(rules); }
function settings(config) { return config.template === 'mapped' ? config : {mapping:config.template === 'claude' ? CLAUDE : STANDARD,filters:[],timeUnit:'iso',inputSemantics:config.template === 'claude' ? 'exclusive' : 'inclusive',outputIncludesReasoning:true}; }
function parse(obj, source, salt) {
  const config = source.definition, options = settings(config);
  if (!object(obj)) return {invalid:true};
  if (config.template === 'claude' && (obj.type !== 'assistant' || !object(obj.message?.usage))) return {filtered:true};
  if (config.template === 'standard' && obj.schemaVersion !== 'AgentUsageEventV1') return {filtered:true};
  if (config.template === 'standard' && obj.mode !== 'per-request') return {unsupported:true};
  if (options.filters.some(filter => !filter.values.includes(get(obj,filter.path)))) return {filtered:true};
  const values = Object.fromEntries(FIELDS.map(key => [key,get(obj,options.mapping[key])]));
  if (config.template === 'claude' && !values.id) values.id = obj.uuid;
  if (typeof values.id !== 'string' || !values.id || values.id.length > 200 || /[\x00-\x1f\x7f]/.test(values.id) || values.session !== undefined && values.session !== null && (typeof values.session !== 'string' || values.session.length > 200)) return {invalid:true};
  if (TOKENS.some(key => values[key] !== undefined && values[key] !== null && number(values[key]) === null)) return {invalid:true};
  let time = values.time;
  if (options.timeUnit === 'iso') { if (typeof time !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(time)) return {invalid:true}; }
  else { if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) return {invalid:true}; time = new Date(time * (options.timeUnit === 's' ? 1000 : 1)); if (Number.isNaN(time.valueOf())) return {invalid:true}; time = time.toISOString(); }
  const usage = {input_tokens:values.input,output_tokens:values.output,cache_read_input_tokens:values.cacheRead,cache_creation_input_tokens:values.cacheWrite,reasoning_output_tokens:values.reasoning,total_tokens:values.total};
  const record = normalize(source.id, usage, {id:JSON.stringify([values.session || '',values.id]),session:values.session,time,model:values.model,provider:values.provider || 'unknown',outputExcludesReasoning:!options.outputIncludesReasoning},salt,options.inputSemantics);
  if (!record) return {invalid:true};
  return {record:{...record, requestInputTokens:options.inputSemantics === 'inclusive' ? number(values.input) : [values.input,values.cacheRead,values.cacheWrite].every(v => number(v) !== null) ? values.input + values.cacheRead + values.cacheWrite : null}};
}
function merge(files) {
  const records = new Map(); let duplicates = 0, conflicts = 0;
  for (const key of Object.keys(files).sort()) for (const record of files[key].records) {
    const old = records.get(record.id), choice = selectUsageSnapshot(old,record);
    if (old) duplicates++; if (choice.issue === 'SOURCE_USAGE_CONFLICT') conflicts++;
    records.set(record.id,choice.record);
  }
  return {records:[...records.values()],duplicates,conflicts};
}
function stamp(file) { const st = fs.statSync(file); return [st.size,st.mtimeMs,st.ino].join(':'); }
function listing(source, audit) {
  const files = new Set(), issues = new Set();
  for (const root of source.roots) {
    const found = filesUnder(source.id,root,audit);
    if (found.limited) issues.add('SOURCE_LIMIT'); if (found.aliased) issues.add('SOURCE_ALIAS_REJECTED'); if (found.unreadable) issues.add('SOURCE_UNREADABLE');
    for (const file of found) files.add(file);
  }
  return {files:[...files].sort(),issues:[...issues]};
}
function fingerprint(source) {
  const found = listing(source,{reads:0});
  return hash([source.definition,source.roots,found.issues,found.files.map(file => [file,stamp(file)])]);
}
async function readFile(file, visit, audit, {sample = false, deadline = Infinity, sampleBytes = MAX_LINE, sampleLines = 200} = {}) {
  const initial = fs.lstatSync(file);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.size > 512 * 1024 * 1024) throw new Error('SOURCE_SIZE_OR_LINK');
  const before = stamp(file); let pending = Buffer.alloc(0), bytes = 0, lines = 0;
  const stream = fs.createReadStream(file,{highWaterMark:65536,...(sample ? {end:sampleBytes-1} : {})});
  audit.reads = (audit.reads || 0) + 1;
  try {
    for await (const chunk of stream) {
      if (Date.now() > deadline) throw new Error('SOURCE_TIMEOUT');
      bytes += chunk.length; pending = Buffer.concat([pending,chunk]);
      let at;
      while ((at = pending.indexOf(10)) >= 0) {
        if (at > MAX_LINE) throw new Error('CUSTOM_LINE_LIMIT');
        const line = pending.subarray(0,at).toString('utf8').replace(/\r$/,''); pending = pending.subarray(at+1);
        if (line.trim()) visit(line);
        lines++;
        if (sample && (lines >= sampleLines || bytes >= sampleBytes)) return {bytes,lines};
      }
      if (pending.length > MAX_LINE) throw new Error('CUSTOM_LINE_LIMIT');
    }
    if (!sample && pending.length) throw new Error('CUSTOM_INCOMPLETE_LINE');
    if (stamp(file) !== before) throw new Error('SOURCE_BUSY');
    return {bytes,lines};
  } finally { stream.destroy(); }
}
async function scan(source, salt, previous = {}, audit = {reads:0}) {
  const configHash = parserHash(source.definition), version = source.version || 1, files = structuredClone(previous), diagnostics = {invalid:0,filtered:0,unsupported:0,retained:0,errors:[]};
  const deadline = Date.now() + 55000; let found;
  try { found = listing(source,audit); diagnostics.errors.push(...found.issues); }
  catch (error) { diagnostics.errors.push(error.message); found = {files:[]}; }
  const complete = new Set();
  for (const file of found.files) {
    const key = digest(salt,source.id + ':file:' + file.toLowerCase());
    if (Date.now() > deadline) { diagnostics.errors.push('SOURCE_TIMEOUT'); break; }
    try {
      const fileStamp = stamp(file);
      if (files[key]?.stamp === fileStamp && files[key]?.configHash === configHash) { complete.add(key); continue; }
      const records = []; const counts = {invalid:0,filtered:0,unsupported:0};
      await readFile(file,line => {
        let obj; try { obj = JSON.parse(line); } catch { counts.invalid++; return; }
        const outcome = parse(obj,source,salt);
        if (outcome.record) records.push(outcome.record); else if (outcome.invalid) counts.invalid++; else if (outcome.unsupported) counts.unsupported++; else counts.filtered++;
      },audit,{deadline});
      files[key] = {stamp:fileStamp,configHash,version,records,counts};
      complete.add(key);
    } catch (error) { diagnostics.errors.push(/^[A-Z_]+$/.test(error.message) ? error.message : 'SOURCE_UNREADABLE'); }
  }
  for (const [key,file] of Object.entries(files)) {
    if (!complete.has(key)) diagnostics.retained++;
    if (file.configHash !== configHash) diagnostics.mixedRules = (diagnostics.mixedRules || 0) + 1;
    for (const kind of ['invalid','filtered','unsupported']) diagnostics[kind] += file.counts?.[kind] || 0;
  }
  diagnostics.errors = [...new Set(diagnostics.errors)];
  const folded = merge(files);
  return {files,records:folded.records,diagnostics:{...diagnostics,duplicates:folded.duplicates,conflicts:folded.conflicts},fileCount:found.files.length,configHash};
}
async function sample(source, audit = {reads:0}) {
  const fields = new Map(); let rows = 0, bytes = 0;
  const walk = (obj, prefix = '', depth = 0) => {
    if (!object(obj) || depth > 12 || fields.size >= 300) return;
    for (const [key,value] of Object.entries(obj)) {
      if (!/^[a-zA-Z0-9_$-]+$/.test(key) || ['__proto__','prototype','constructor','content','text','messages','prompt','completion'].includes(key)) continue;
      const dotted = prefix ? prefix + '.' + key : key;
      if (object(value)) walk(value,dotted,depth+1);
      else {
        // Only usage counts may return values; content/IDs are structure only.
        const preview = null;
        fields.set(dotted,{path:dotted,type:value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,example:preview});
      }
    }
  };
  for (const file of listing(source,audit).files) {
    if (rows >= 200 || bytes >= MAX_LINE) break;
    const read=await readFile(file,line => { try { walk(JSON.parse(line)); } catch {} },audit,{sample:true,deadline:Date.now()+5000,sampleLines:200-rows,sampleBytes:MAX_LINE-bytes});
    rows+=read.lines;bytes+=read.bytes;
  }
  return {fields:[...fields.values()],rows,bytes};
}
function canonical(root) {
  root = localPath(root); let existing = root, tail = [];
  while (!fs.existsSync(existing)) { const parent = path.dirname(existing); if (parent === existing) break; tail.unshift(path.basename(existing)); existing = parent; }
  return path.resolve(fs.existsSync(existing) ? fs.realpathSync(existing) : existing,...tail).toLowerCase();
}
function overlaps(a,b) { const x=canonical(a), y=canonical(b); return x === y || x.startsWith(y+path.sep) || y.startsWith(x+path.sep); }
function checkRoots(source, reserved, own) {
  if (!Array.isArray(source.roots) || !source.roots.length || source.roots.length > 16) throw new Error('CUSTOM_ROOT_REQUIRED');
  for (const root of source.roots) {
    localPath(root);
    if (own.some(other => overlaps(root,other))) throw new Error('SOURCE_PRODUCT_OVERLAP');
    if (reserved.some(other => overlaps(root,other))) throw new Error('CUSTOM_SOURCE_OVERLAP');
  }
  for (let i=0;i<source.roots.length;i++) for (let j=0;j<i;j++) if (overlaps(source.roots[i],source.roots[j])) throw new Error('CUSTOM_SOURCE_OVERLAP');
}
function validSaved(sources) {
  if (sources === undefined) return true;
  if (!object(sources)) return false;
  function valid(id, source, previous = false) {
    if (!/^custom-[a-f0-9-]{36}$/.test(id) || !object(source) || source.id !== id || source.name !== definition(source.definition).name || !Number.isSafeInteger(source.version) || source.version < 1 || typeof source.enabled !== 'boolean' || typeof source.archived !== 'boolean' || !Array.isArray(source.roots) || !source.roots.length || source.roots.length > 16 || !object(source.files)) return false;
    for (const root of source.roots) localPath(root);
    if (source.reservedRoots !== undefined) { if (!Array.isArray(source.reservedRoots)) return false; for (const root of source.reservedRoots) localPath(root); }
    for (const [key,file] of Object.entries(source.files)) {
      if (!/^[a-f0-9]{64}$/.test(key) || !object(file) || !/^[a-f0-9]{64}$/.test(file.configHash) || !Number.isSafeInteger(file.version) || !Array.isArray(file.records)) return false;
      for (const record of file.records) if (record.agent !== id || !/^[a-f0-9]{64}$/.test(record.id) || number(record.totalTokens) === null || Number.isNaN(Date.parse(record.timestamp)) || ['inputUncached','output','cacheRead','cacheWrite','reasoning'].some(field => record[field] !== null && number(record[field]) === null)) return false;
    }
    return !source.previous || !previous && valid(id,source.previous,true);
  }
  try { return Object.entries(sources).every(([id,source]) => valid(id,source)); } catch { return false; }
}
module.exports = {validSaved,parserHash,overlaps,FIELDS,definition,parse,hash,merge,scan,sample,fingerprint,checkRoots,MAX_LINE};
