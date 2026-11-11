'use strict';
// No Store, filesystem or source-policy dependency. Inputs belong to one stable
// saved cohort; the caller owns reading and reconciliation before construction.
const runtimeCatalog = require('./runtime-catalog');
const registry = require('./source-registry');
const {createPricing,validateBilling,priceBasis} = require('./valuation');
const {projectUsage} = require('./usage-projection');
function createReadModel({state,overrides,remoteCatalog,billing}) {
  const modelCatalog=runtimeCatalog.merged(remoteCatalog),agents=registry.catalog(state);
  const settings=validateBilling(billing,{overrides,modelCatalog,agents},true);
  const pricing=createPricing({overrides,modelCatalog,billing:settings});
  const basis=priceBasis({overrides,modelCatalog,remoteCatalog,billing:settings});
  const records=Object.freeze(Object.values(state.records).filter(record=>!state.duplicateIds[record.id]));
  return Object.freeze({
    records:()=>records,
    catalog:()=>agents,
    snapshot:()=>projectUsage({records,estimate:pricing.estimate,sequence:state.sequence,updatedAt:state.updatedAt,sourceCatalog:agents,priceCatalog:basis,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,now:Date.now()})
  });
}
module.exports={createReadModel};
