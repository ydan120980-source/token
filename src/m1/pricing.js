'use strict';
const catalog = require('./prices.json');
const FIELDS = ['inputUncached', 'output', 'cacheRead', 'cacheWrite'];
function identifier(value) { if (!isIdentifier(value)) throw new Error('PRICE_IDENTIFIER_INVALID'); return value; }
/** Non-throwing form: used to describe stored identifiers without rejecting them. */
function isIdentifier(value) { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/.test(value); }
function validate(entry) {
  const provider = identifier(entry?.provider), model = identifier(entry?.model), rates = {};
  if (!/^[a-zA-Z0-9._-]{1,99}$/.test(provider)) throw new Error('PRICE_IDENTIFIER_INVALID');
  for (const field of FIELDS) {
    const value = entry[field];
    if (value === null || value === '') { rates[field] = null; continue; }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000) throw new Error('PRICE_RATE_INVALID');
    rates[field] = value / 1e6;
  }
  if (rates.inputUncached === null || rates.output === null) throw new Error('PRICE_RATE_INVALID');
  return { provider, model, rates };
}
function evaluate(record, overrides = {}, resolved = null) {
  const key = record.provider + '/' + record.model, manual = overrides[key], rates = resolved || manual || catalog.models[key];
  if (!rates) return { reason: 'model-unpriced', lower: null, upper: null };
  const isManual = Boolean(manual) || rates.provenance === 'manual';
  if (!manual && ['reference-unverified','official-thirdparty-unverified'].includes(rates.provenance)) return { reason: 'price-unverified', lower: null, upper: null };
  if (record.quality !== 'measured' || record.usageConflict) return { reason: 'usage-incomplete', lower: null, upper: null };
  const tiers = !isManual && rates.contextTiers;
  if(tiers?.length && Number.isFinite(record.requestInputTokens)){
    const tier=[...tiers].reverse().find(t=>record.requestInputTokens>t.threshold);
    if(tier){const value=evaluate(record,overrides,{...rates,...tier.rates,contextTiers:null,longContext:null});return {...value,reason:value.reason==='exact'?'long-context':value.reason};}
  }
  let lower = 0, upper = 0, bounded = false, reasoningBounded = false;
  for (const field of FIELDS) {
    let count = record[field], rate = rates[field];
    if (count == null) {
      // Older OpenAI models have no separately charged writes. Do not apply
      // this exception to Claude/unknown routing or to GPT-5.6+.
      if (field === 'cacheWrite' && record.agent === 'codex' && (rates.billingProvider || record.provider) === 'openai') {
        if (rate == null && !isManual) { count = 0; rate = 0; }
        else if (Number.isFinite(rate) && Number.isFinite(rates.inputUncached)) {
          bounded = true; continue;
        } else return { reason: 'usage-incomplete', lower: null, upper: null };
      // A write the billing vendor prices at exactly zero costs nothing whatever
      // its unreported count, including routes such as workbuddy-xdpool -> deepseek.
      } else if (field === 'cacheWrite' && rates.cacheWrite === 0 && !isManual) { count = 0; }
      else return { reason: 'usage-incomplete', lower: null, upper: null };
    }
    if (count > 0 && !Number.isFinite(rate)) return { reason: 'rate-missing', lower: null, upper: null };
    if(field==='output' && Number.isFinite(rates.reasoning) && rates.reasoning!==rate){
      if(record.reasoning==null){lower+=count*Math.min(rate,rates.reasoning);upper+=count*Math.max(rate,rates.reasoning);reasoningBounded=true;}
      else{if(record.reasoning>count)return {reason:'usage-incomplete',lower:null,upper:null};lower+=(count-record.reasoning)*rate+record.reasoning*rates.reasoning;upper=lower;}
      continue;
    }
    lower += count * (rate || 0); upper += count * (rate || 0);
  }
  if (bounded) {
    const difference = record.inputUncached * (rates.cacheWrite - rates.inputUncached);
    lower += Math.min(0, difference); upper += Math.max(0, difference);
  }
  if(tiers?.length && !Number.isFinite(record.requestInputTokens)){
    const estimates=tiers.map(t=>evaluate(record,overrides,{...rates,...t.rates,contextTiers:null,longContext:null}));
    if(estimates.some(v=>v.lower===null))return {reason:'rate-missing',lower:null,upper:null};
    return {lower:Math.min(lower,...estimates.map(v=>v.lower)),upper:Math.max(upper,...estimates.map(v=>v.upper)),reason:'context-unreported'};
  }
  const long = !isManual && !tiers?.length && rates.longContext;
  // Cumulative deltas can combine several requests; only a projected last
  // request lets us apply the per-request long-context threshold.
  if (long && record.requestInputTokens > (rates.longContextThreshold || 272000)) {
    const old = evaluate(record, overrides, { ...rates, ...long, longContext:null });
    return { ...old, reason: old.reason === 'exact' ? 'long-context' : old.reason };
  }
  if (long && !Number.isFinite(record.requestInputTokens)) {
    const high = evaluate(record, overrides, { ...rates, ...long, longContext:null });
    if (high.lower === null) return high;
    return { lower:Math.min(lower,high.lower), upper:Math.max(upper,high.upper), reason: 'context-unreported' };
  }
  if (!isManual && rates.offPeakMultiplier) return { lower: lower * rates.offPeakMultiplier, upper, reason: 'time-tariff-unreported' };
  return { lower, upper, reason: reasoningBounded ? 'reasoning-unreported' : bounded ? 'cache-write-unreported' : 'exact' };
}
function price(record, overrides) { const value = evaluate(record, overrides); return value.lower === value.upper ? value.lower : null; }
module.exports = { FIELDS, validate, evaluate, price, identifier, isIdentifier, catalog };
