'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./store');
const runtimeCatalog = require('./runtime-catalog');
const { selectSnapshot } = require('../../design/desktop-reference/local-snapshot');
function readSavedSnapshot(file = path.join(process.env.APPDATA, 'AgentUsage-M1', 'statistics.json')) {
  // A constructor persists state. This reader only projects existing statistics.
  const store = Object.create(Store.prototype);
  store.state = JSON.parse(fs.readFileSync(file, 'utf8'));
  store.overrides = {};
  store.billing = {autoSync:true,defaults:{},mappings:{}};
  for (const [name, property] of [['billing.json','billing'],['model-pricing.json','remoteCatalog']]) {
    try { store[property] = JSON.parse(fs.readFileSync(path.join(path.dirname(file),name),'utf8')); } catch(error) { if(error.code !== 'ENOENT') throw error; }
  }
  store.remoteCatalog = runtimeCatalog.verify(store.remoteCatalog || runtimeCatalog.embedded);
  store.modelCatalog = runtimeCatalog.merged(store.remoteCatalog); store.modelCatalogHash = runtimeCatalog.hash(store.modelCatalog);
  try { store.overrides = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'pricing.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return selectSnapshot(store.snapshot());
}
module.exports = { readSavedSnapshot };
