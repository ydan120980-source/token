'use strict';
// Calculation only: no filesystem, Store, source readers or process execution.
const {catalog,evaluate,lowerBound,isIdentifier}=require('./pricing');
const runtimeCatalog=require('./runtime-catalog');
const registry=require('./source-registry');
const UNVERIFIED=['reference-unverified','official-thirdparty-unverified'];
// Two sources disagreeing, or a record contradicting itself, gives no field to trust: never a floor.
const NO_FLOOR=['conflict','invalid-cache','invalid-reasoning'];
function createPricing({overrides,modelCatalog,billing}) {
  let caseCatalog;
  // The person's fallback model only prices what has no usable price of its own; it never replaces one.
  function resolvePrice(record) {
    const own = resolveOwn(record);
    if (!billing.fallback || (own.rates && !UNVERIFIED.includes(own.rates.provenance))) return own;
    const rates = overrides[billing.fallback] ? {...overrides[billing.fallback],provenance:'manual'} : modelCatalog[billing.fallback];
    return rates ? {rates,origin:'fallback',target:billing.fallback} : own;
  }
  function resolveOwn(record) {
    const key = record.provider + '/' + record.model, defaults = billing.defaults[record.agent];
    if (overrides[key]) return {rates:{...overrides[key],provenance:'manual'},origin:'manual',target:key};
    const target = billing.mappings[key] || (defaults?.mode === 'default' ? defaults.model : null);
    if (target) return {rates:overrides[target] ? {...overrides[target],provenance:'manual'} : modelCatalog[target],origin:billing.mappings[key] ? 'mapped' : 'default-model',target};
    if (modelCatalog[key] && modelCatalog[key].provenance !== 'reference-unverified') return {rates:modelCatalog[key],origin:modelCatalog[key].provenance,target:key};
    if (registry.CUSTOM_ID.test(record.agent)) return {rates:null,origin:'unpriced',target:key};
    // Exact original-vendor model id, including models logged by another client.
    // Never fuzzy-match versions or guess what an auto/free route resolved to.
    const vendor = /^(gpt-|o[1-9])/i.test(record.model) ? 'openai' : /^claude-/i.test(record.model) ? 'anthropic' : /^gemini-/i.test(record.model) ? 'google' : /^mimo-/i.test(record.model) ? 'xiaomi' : /^deepseek-/i.test(record.model) ? 'deepseek' : /^glm-/i.test(record.model) ? 'zai' : /^minimax-/i.test(record.model) ? 'minimax' : /^hy[0-9]/i.test(record.model) ? 'tencent-tokenhub' : /^space-bunny/i.test(record.model) ? 'opencode-go' : null;
    let candidate = modelCatalog[record.model] ? record.model : vendor && vendor + '/' + record.model;
    if(candidate && !modelCatalog[candidate]) {
      if(!caseCatalog){caseCatalog=new Map();for(const id of Object.keys(modelCatalog)){const lower=id.toLowerCase();caseCatalog.set(lower,caseCatalog.has(lower)?null:id);}}
      candidate=caseCatalog.get(candidate.toLowerCase()) || candidate;
    }
    const rates = candidate && modelCatalog[candidate];
    return rates && rates.provenance !== 'reference-unverified' ? {rates,origin:'model-id',target:candidate} : {rates:modelCatalog[key],origin:modelCatalog[key]?.provenance || 'unpriced',target:key};
  }
  function estimate(record) {
    const resolved = resolvePrice(record);
    let estimate = resolved.rates ? evaluate(record, {}, {...resolved.rates,billingProvider:resolved.target?.split('/')[0] || record.provider}) : {reason:'model-unpriced',lower:null,upper:null};
    if (billing.partialLowerBound && estimate.reason === 'usage-incomplete' && !NO_FLOOR.includes(estimate.cause)) {
      const floor = lowerBound(record, resolved.rates);
      if (floor !== null) estimate = {lower:floor,upper:floor,reason:'usage-lower-bound',cause:estimate.cause,lowerBound:true};
    }
    if (resolved.origin === 'fallback' && estimate.lower !== null) estimate.fallback = true;
    const multiplier = billing.defaults[record.agent]?.multiplier ?? 1;
    if (estimate.lower !== null) {
      estimate.lower *= multiplier; estimate.upper *= multiplier;
      // The lower estimate is allocated to token categories by count x unit rate,
      // so the parts always sum to it; savings price cache reads at the uncached rate.
      const rates = resolved.rates, rate = field => Number.isFinite(rates[field]) ? rates[field] : 0;
      const weights = Object.fromEntries(['inputUncached', 'output', 'cacheRead', 'cacheWrite'].map(field => [field, (record[field] ?? 0) * rate(field)]));
      const weight = Object.values(weights).reduce((sum, value) => sum + value, 0);
      estimate.parts = Object.fromEntries(Object.entries(weights).map(([field, value]) => [field, weight > 0 ? estimate.lower * value / weight : 0]));
      estimate.savings = (record.cacheRead ?? 0) * Math.max(0, rate('inputUncached') - rate('cacheRead')) * multiplier;
    }
    return estimate;
  }
  return {resolvePrice,estimate};
}
function validPriceTarget(key, overrides, models) {
    return typeof key === 'string' && (Object.hasOwn(overrides,key) || Object.hasOwn(models,key)) && !['reference-unverified','official-thirdparty-unverified'].includes((overrides[key] || models[key]).provenance);
  }
function checkPriceReferences(billing, current, next) {
    const targets = [...Object.values(billing.mappings), ...Object.values(billing.defaults).filter(entry => entry.mode === 'default').map(entry => entry.model), ...billing.fallback ? [billing.fallback] : []];
    if (targets.some(key => validPriceTarget(key, current.overrides, current.modelCatalog) && !validPriceTarget(key, next.overrides, next.modelCatalog))) throw new Error('PRICE_TARGET_IN_USE');
  }
function validateBilling(value, {overrides,modelCatalog,agents}, allowMissing = false) {
    if (!value || typeof value.autoSync !== 'boolean' || !value.defaults || typeof value.defaults !== 'object' || Array.isArray(value.defaults) || !value.mappings || typeof value.mappings !== 'object' || Array.isArray(value.mappings) || Object.keys(value.mappings).length > 5000) throw new Error('PRICE_SETTING_INVALID');
    const defaults = {}, mappings = {};
    const validTarget = key => validPriceTarget(key,overrides,modelCatalog) || allowMissing && typeof key === 'string' && key.includes('/') && isIdentifier(key.slice(0,key.indexOf('/'))) && isIdentifier(key.slice(key.indexOf('/')+1));
    for (const [agent, entry] of Object.entries(value.defaults)) {
      if (!Object.hasOwn(agents,agent) || !['actual','default'].includes(entry?.mode) || !Number.isFinite(entry.multiplier) || entry.multiplier < 0 || entry.multiplier > 1000 || entry.mode === 'default' && !validTarget(entry.model)) throw new Error('PRICE_SETTING_INVALID');
      defaults[agent] = {mode:entry.mode,multiplier:entry.multiplier,model:entry.mode === 'default' ? entry.model : null};
    }
    for (const [key, target] of Object.entries(value.mappings)) {
      const cut = key.indexOf('/');
      if (!isIdentifier(key.slice(0,cut)) || !isIdentifier(key.slice(cut+1)) || !validTarget(target)) throw new Error('PRICE_MAPPING_INVALID');
      mappings[key] = target;
    }
    if (value.fallback !== undefined && value.fallback !== null && !validTarget(value.fallback)) throw new Error('PRICE_SETTING_INVALID');
    if (value.partialLowerBound !== undefined && typeof value.partialLowerBound !== 'boolean') throw new Error('PRICE_SETTING_INVALID');
    return {autoSync:value.autoSync,defaults,mappings,...value.fallback ? {fallback:value.fallback} : {},...value.partialLowerBound ? {partialLowerBound:true} : {}};
  }

/** What these rules would do to these records, written nowhere: how much counts, what it costs, and what stays out and why. */
function coverageOf(pricing, records) {
  const value = {records:records.length,tokens:0,counted:0,lower:null,upper:null,fallbackTokens:0,fallbackUsd:0,floorTokens:0,floorUsd:0}, left = new Map();
  for (const record of records) {
    const estimate = pricing.estimate(record); value.tokens += record.totalTokens;
    if (estimate.lower === null) { const key = estimate.reason + '|' + (estimate.cause || ''), row = left.get(key) || {reason:estimate.reason,cause:estimate.cause || null,tokens:0,records:0}; row.tokens += record.totalTokens; row.records++; left.set(key, row); continue; }
    value.counted += record.totalTokens; value.lower = (value.lower ?? 0) + estimate.lower; value.upper = (value.upper ?? 0) + estimate.upper;
    if (estimate.fallback) { value.fallbackTokens += record.totalTokens; value.fallbackUsd += estimate.lower; }
    if (estimate.lowerBound) { value.floorTokens += record.totalTokens; value.floorUsd += estimate.lower; }
  }
  return {...value,left:[...left.values()].sort((a, b) => b.tokens - a.tokens)};
}
function priceBasis({modelCatalog,overrides,remoteCatalog,billing}) {
  return {version:remoteCatalog?catalog.version+'+models-dev/1':catalog.version,obtainedAt:remoteCatalog?.obtainedAt||catalog.obtainedAt,sha256:runtimeCatalog.hash(modelCatalog),overrideSha256:runtimeCatalog.hash(overrides),billingSha256:runtimeCatalog.hash(billing),currency:'USD',kind:'API-equivalent-estimate',source:remoteCatalog?.source||catalog.source,basis:catalog.basis};
}
module.exports={createPricing,coverageOf,validPriceTarget,checkPriceReferences,validateBilling,priceBasis};
