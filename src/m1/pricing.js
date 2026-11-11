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
// Why a record's usage cannot be priced: the record's own quality, a conflict between
// sources, or the first field the price needs that the source did not report.
function incomplete(cause) { return { reason: 'usage-incomplete', cause, lower: null, upper: null }; }
function qualityCause(record) {
  if (record.usageConflict) return 'conflict';
  if (record.quality !== 'partial') return record.quality || 'partial';
  const missing = ['inputUncached', 'output', 'reasoning'].find(field => record[field] === null || record[field] === undefined);
  return missing ? 'missing-' + missing : 'partial';
}
function evaluate(record, overrides = {}, resolved = null) {
  const key = record.provider + '/' + record.model, manual = overrides[key], rates = resolved || manual || catalog.models[key];
  if (!rates) return { reason: 'model-unpriced', lower: null, upper: null };
  const isManual = Boolean(manual) || rates.provenance === 'manual';
  if (!manual && ['reference-unverified','official-thirdparty-unverified'].includes(rates.provenance)) return { reason: 'price-unverified', lower: null, upper: null };
  if (record.quality !== 'measured' || record.usageConflict) return incomplete(qualityCause(record));
  const tiers = !isManual && rates.contextTiers;
  if(tiers?.length && Number.isFinite(record.requestInputTokens)){
    const tier=[...tiers].reverse().find(t=>record.requestInputTokens>t.threshold);
    if(tier){const value=evaluate(record,overrides,{...rates,...tier.rates,contextTiers:null,longContext:null});return {...value,reason:value.reason==='exact'?'long-context':value.reason};}
  }
  let lower = 0, upper = 0, bounded = false, reasoningBounded = false;
  for (const field of FIELDS) {
    let count = record[field], rate = rates[field];
    if (count == null) {
      const vendor = [rates.billingProvider, record.provider], model = typeof record.model === 'string' ? record.model : '';
      const writeFree = vendor.includes('openai') || vendor.includes('deepseek') || model.includes('deepseek') || vendor.includes('google') || model.includes('gemini');
      // Codex and Antigravity report every input token in the uncached, cache-read
      // or output buckets, so an unreported write lies inside the uncached input.
      const writeInInput = (record.agent === 'codex' && writeFree) || (record.agent === 'antigravity' && (writeFree || vendor.includes('anthropic')));
      // A write the billing vendor prices at exactly zero costs nothing whatever
      // its unreported count, including routes such as workbuddy-xdpool -> deepseek.
      if (field === 'cacheWrite' && rates.cacheWrite === 0) { count = 0; }
      else if (field === 'cacheWrite' && writeInInput) {
        // OpenAI, DeepSeek and Google do not charge writes separately; Anthropic
        // does, so a missing Anthropic write rate stays unknown.
        if (rate == null && !isManual && writeFree) { count = 0; rate = 0; }
        else if (Number.isFinite(rate) && rate > 0 && Number.isFinite(rates.inputUncached)) {
          bounded = true; continue;
        } else return incomplete('missing-cacheWrite');
      }
      else return incomplete('missing-' + field);
    }
    if (count > 0 && !Number.isFinite(rate)) return { reason: 'rate-missing', lower: null, upper: null };
    if(field==='output' && Number.isFinite(rates.reasoning) && rates.reasoning!==rate){
      if(record.reasoning==null){lower+=count*Math.min(rate,rates.reasoning);upper+=count*Math.max(rate,rates.reasoning);reasoningBounded=true;}
      else{if(record.reasoning>count)return incomplete('invalid-reasoning');lower+=(count-record.reasoning)*rate+record.reasoning*rates.reasoning;upper=lower;}
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
// What the fields a record did report would cost at these rates: a floor, not the price. Only used when the person
// has turned on lower-bound estimates; a field the source never wrote adds nothing and stays unknown in the ledger.
function lowerBound(record, rates) {
  let total = 0, any = false;
  for (const field of FIELDS) { const count = record[field], rate = rates[field]; if (Number.isFinite(count) && count > 0 && Number.isFinite(rate)) { total += count * rate; any = true; } }
  return any ? total : null;
}
function price(record, overrides) { const value = evaluate(record, overrides); return value.lower === value.upper ? value.lower : null; }
module.exports = { FIELDS, validate, evaluate, lowerBound, price, identifier, isIdentifier, catalog };
