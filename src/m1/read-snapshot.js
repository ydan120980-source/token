'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createReadModel } = require('./usage-read-model');
const { validate } = require('./pricing');
const runtimeCatalog = require('./runtime-catalog');
const { selectSnapshot } = require('./local-snapshot');
const { reconcile } = require('./ledger-view');
const FILES = ['statistics.json', 'billing.json', 'model-pricing.json', 'pricing.json'];
function defaultFile() {
  if (!process.env.APPDATA) throw new Error('QUERY_DIRECTORY_REQUIRED');
  return path.join(process.env.APPDATA, 'AgentUsage-M1', 'statistics.json');
}
function readGroup(directory) {
  return FILES.map((name, index) => {
    try {
      const file = path.join(directory, name), info = fs.lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > (index === 0 ? 128 : 16) * 1024 * 1024) throw new Error();
      const bytes=fs.readFileSync(file);
      if(bytes.length>(index===0?128:16)*1024*1024)throw new Error();
      return bytes;
    } catch (error) { if (error.code === 'ENOENT') return null; throw new Error('QUERY_STORAGE_INVALID', {cause:error}); }
  });
}
function readSavedModel(file = defaultFile()) {
  const directory = path.dirname(file);
  if (path.basename(file) !== FILES[0]) throw new Error('QUERY_DIRECTORY_INVALID');
  let saved;
  for (let attempt = 0; attempt < 3; attempt++) {
    const first = readGroup(directory), second = readGroup(directory);
    if (first.every((bytes, i) => bytes === null ? second[i] === null : second[i] !== null && bytes.equals(second[i]))) { saved = first; break; }
  }
  if (!saved) throw new Error('QUERY_SNAPSHOT_BUSY');
  if (!saved[0]) throw new Error('QUERY_SNAPSHOT_MISSING');
  try {
    const [state, billing, remote, overrides] = saved.map(bytes => bytes === null ? null : JSON.parse(bytes.toString('utf8')));
    if (state?.version !== 1 || !state.records || typeof state.records!=='object' || Array.isArray(state.records) || !Number.isSafeInteger(state.sequence) || state.sequence < 0) throw new Error();
    for(const [i,value] of [[1,billing],[2,remote],[3,overrides]])if(saved[i]&&(value===null||typeof value!=='object'||Array.isArray(value)))throw new Error();
    if(state.duplicateIds!==undefined&&(!state.duplicateIds||typeof state.duplicateIds!=='object'||Array.isArray(state.duplicateIds)))throw new Error();
    // Never use sessions (raw ID/cwd), preferences, source mappings or file indexes.
    const facts = {version:1,sequence:state.sequence,updatedAt:state.updatedAt,records:state.records,duplicateIds:state.duplicateIds||{},statuses:{},customSources:Object.fromEntries(Object.keys(state.customSources||{}).map(id=>[id,{name:id}]))};
    reconcile(facts);
    for (const [key, rates] of Object.entries(overrides || {})) { const cut=key.indexOf('/'); validate({provider:key.slice(0,cut),model:key.slice(cut+1),...Object.fromEntries(['inputUncached','output','cacheRead','cacheWrite'].map(f=>[f,rates[f]==null?null:rates[f]*1e6]))}); }
    return createReadModel({state:facts,overrides:overrides||{},remoteCatalog:runtimeCatalog.verify(remote||runtimeCatalog.embedded),billing:billing||{autoSync:true,defaults:{},mappings:{}}});
  } catch { throw new Error('QUERY_STORAGE_INVALID'); }
}
function readSavedSnapshot(file) { const model=readSavedModel(file);return selectSnapshot(model.snapshot(),model.catalog()); }
module.exports = { readSavedSnapshot, readSavedModel, defaultFile };
