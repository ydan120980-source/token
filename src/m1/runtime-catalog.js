'use strict';
const crypto = require('node:crypto');
const { FIELDS, validate, isIdentifier, catalog } = require('./pricing');
const embedded = require('./models-dev-prices.json');
const URL = 'https://models.dev/api.json';
const costFields = { inputUncached:'input', output:'output', cacheRead:'cache_read', cacheWrite:'cache_write' };
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Only explicit token prices for text-output models. Absent cost is never free.
function parse(text, obtainedAt = new Date().toISOString()) {
  if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('PRICE_DOWNLOAD_SIZE');
  const data = JSON.parse(text), models = {}, skipped = { missing:0, invalid:0, modality:0 };
  if (!data || Array.isArray(data) || typeof data !== 'object' || Object.keys(data).length > 600) throw new Error('PRICE_DOWNLOAD_SCHEMA');
  let seen = 0;
  for (const [provider, group] of Object.entries(data)) {
    if (!/^[a-zA-Z0-9._-]{1,99}$/.test(provider) || !group || typeof group.models !== 'object') continue;
    for (const [model, entry] of Object.entries(group.models || {})) {
      if (++seen > 40000) throw new Error('PRICE_DOWNLOAD_SCHEMA');
      if (!entry || !isIdentifier(model)) { skipped.invalid++; continue; }
      if (!entry.modalities?.output?.includes('text')) { skipped.modality++; continue; }
      const cost = entry.cost;
      if (!cost || cost.input == null || cost.output == null) { skipped.missing++; continue; }
      try {
        const value = validate({ provider, model, ...Object.fromEntries(FIELDS.map(f => [f, cost[costFields[f]] ?? null])) });
        const contextTiers = (Array.isArray(cost.tiers) ? cost.tiers : []).filter(t=>t?.tier?.type === 'context' && Number.isSafeInteger(t.tier.size) && t.tier.size>0).sort((a,b)=>a.tier.size-b.tier.size).map(t=>{if(t.reasoning!=null && (!Number.isFinite(t.reasoning)||t.reasoning<0||t.reasoning>100000))throw new Error('PRICE_RATE_INVALID');return {threshold:t.tier.size,rates:{...validate({provider,model,...Object.fromEntries(FIELDS.map(f=>[f,t[costFields[f]] ?? null]))}).rates,reasoning:t.reasoning==null?null:t.reasoning/1e6}};});
        if(contextTiers.length>12 || new Set(contextTiers.map(t=>t.threshold)).size !== contextTiers.length) throw new Error('PRICE_TIERS_INVALID');
        if(cost.reasoning != null && (!Number.isFinite(cost.reasoning) || cost.reasoning<0 || cost.reasoning>100000)) throw new Error('PRICE_RATE_INVALID');
        const tier=contextTiers[0];
        models[provider + '/' + model] = { ...value.rates, provenance:'models-dev', source:URL, ...(cost.reasoning != null ? {reasoning:cost.reasoning/1e6} : {}), ...(tier ? {contextTiers,longContext:tier.rates,longContextThreshold:tier.threshold} : {}) };
      } catch { skipped.invalid++; }
    }
  }
  if (Object.keys(models).length < 1) throw new Error('PRICE_DOWNLOAD_EMPTY');
  return { version:'models-dev/1', obtainedAt, source:URL, sha256:hash(models), models, skipped };
}
function verify(value) {
  if (value?.version !== 'models-dev/1' || !Number.isFinite(Date.parse(value.obtainedAt)) || !value.models || Object.keys(value.models).length > 40000 || value.sha256 !== hash(value.models)) throw new Error('PRICE_CACHE_INVALID');
  for (const [key, rates] of Object.entries(value.models)) {
    const cut = key.indexOf('/');
    validate({provider:key.slice(0,cut),model:key.slice(cut+1),...Object.fromEntries(FIELDS.map(f=>[f,rates[f] == null ? null : rates[f]*1e6]))});
    if (rates.longContext) {
      if (!Number.isFinite(rates.longContextThreshold) || rates.longContextThreshold <= 0) throw new Error('PRICE_CACHE_INVALID');
      validate({provider:key.slice(0,cut),model:key.slice(cut+1),...Object.fromEntries(FIELDS.map(f=>[f,rates.longContext[f] == null ? null : rates.longContext[f]*1e6]))});
    }
    if(rates.reasoning != null && (!Number.isFinite(rates.reasoning) || rates.reasoning<0 || rates.reasoning>.1)) throw new Error('PRICE_CACHE_INVALID');
    if(rates.contextTiers){
      if(!Array.isArray(rates.contextTiers) || rates.contextTiers.length>12) throw new Error('PRICE_CACHE_INVALID');
      let previous=0;
      for(const tier of rates.contextTiers){if(!Number.isSafeInteger(tier.threshold)||tier.threshold<=previous)throw new Error('PRICE_CACHE_INVALID');previous=tier.threshold;validate({provider:key.slice(0,cut),model:key.slice(cut+1),...Object.fromEntries(FIELDS.map(f=>[f,tier.rates[f]==null?null:tier.rates[f]*1e6]))});if(tier.rates.reasoning!=null&&(!Number.isFinite(tier.rates.reasoning)||tier.rates.reasoning<0||tier.rates.reasoning>.1))throw new Error('PRICE_CACHE_INVALID');}
    }
    if (rates.provenance !== 'models-dev' || rates.source !== URL) throw new Error('PRICE_CACHE_INVALID');
  }
  return value;
}
function merged(remote) {
  const models = { ...(remote?.models || {}) };
  for (const [key, value] of Object.entries(catalog.models)) {
    // Last reviewed catalog is the offline fallback; explicitly published
    // directory prices take effect after a successful, validated download.
    if (!models[key] && (!remote || !['reference-unverified','official-thirdparty-unverified'].includes(value.provenance))) models[key] = value;
  }
  return models;
}
module.exports = { URL, parse, verify, merged, hash, embedded };
