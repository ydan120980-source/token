'use strict';
const crypto = require('node:crypto');
function number(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
function timestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) value = value < 1e11 ? value * 1000 : value;
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}
function provider(model, explicit) {
  if (typeof explicit === 'string' && /^[a-zA-Z0-9._-]{1,99}$/.test(explicit)) return explicit;
  if (/^(gpt|o[134]-)/i.test(model)) return 'openai';
  if (/^claude-/i.test(model)) return 'anthropic';
  if (/^mimo-/i.test(model)) return 'mimo';
  if (/^glm-/i.test(model)) return 'zai';
  if (/^deepseek-/i.test(model)) return 'deepseek';
  if (/^gemini-/i.test(model)) return 'google';
  return 'unknown';
}
function digest(salt, value) { return crypto.createHmac('sha256', salt).update(value).digest('hex'); }
function normalize(agent, usage, info, salt, semantics = 'inclusive') {
  const input = number(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? usage.input);
  const rawOutput = number(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? usage.output);
  const read = number(usage.cached_input_tokens ?? usage.cache_read_input_tokens ?? usage.cacheReadTokens ?? usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.cache?.read);
  const write = number(usage.cache_creation_input_tokens ?? usage.cache_write_tokens ?? usage.cacheWriteTokens ?? usage.prompt_tokens_details?.cache_write_tokens ?? usage.cache?.write);
  const reasoning = number(usage.reasoning_output_tokens ?? usage.reasoningTokens ?? usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning);
  // OpenCode/MiMo persist disjoint visible-output and reasoning buckets.
  // The public contract normalizes output to include reasoning, as Codex does.
  const disjointReasoning = agent === 'opencode' || agent === 'mimo' || info.outputExcludesReasoning === true;
  const output = rawOutput === null ? null : rawOutput + (disjointReasoning ? (reasoning ?? 0) : 0);
  let uncached = input;
  if (semantics === 'inclusive' && input !== null) uncached = Math.max(0, input - (read ?? 0) - (write ?? 0));
  const reported = number(usage.total_tokens ?? usage.totalTokens ?? usage.total);
  const computed = input !== null && output !== null ? input + output + (semantics === 'exclusive' ? (read ?? 0) + (write ?? 0) : 0) : null;
  const total = computed ?? reported;
  const time = timestamp(info.time);
  if (!time || total === null || !Number.isSafeInteger(total)) return null;
  const model = typeof info.model === 'string' && /^[a-zA-Z0-9._:/-]{1,179}$/.test(info.model) && !/^(?:[/\\]|[a-zA-Z]:[/\\])/.test(info.model) ? info.model : 'unknown';
  const key = info.id || JSON.stringify([info.time, info.session, model, usage]);
  return {
    id: digest(salt, agent + ':' + key), sessionKey: info.session ? digest(salt, agent + ':session:' + info.session) : null, agent, entry: info.entry || 'unknown', model,
    provider: provider(model, info.provider), timestamp: time,
    inputUncached: uncached, output, cacheRead: read, cacheWrite: write, reasoning,
    totalTokens: total, semantics: { input: semantics, sourceOutput: disjointReasoning ? 'excludes-reasoning' : 'includes-reasoning', reasoning: 'subset-of-normalized-output' },
    // A call's identity is independent of property order and growing counters.
    // Counterpart HMACs link old agent-specific ledger IDs without retaining IDs.
    sharedKey: (agent === 'opencode' || agent === 'mimo') && info.id ? digest(salt, JSON.stringify(['shared-opencode-schema/2', info.id, time, model])) : null,
    sharedRecordIds: (agent === 'opencode' || agent === 'mimo') && info.id ? ['opencode','mimo'].map(source => digest(salt, source + ':' + key)) : null,
    quality: semantics === 'inclusive' && input !== null && (read ?? 0) + (write ?? 0) > input ? 'invalid-cache' : !disjointReasoning && output !== null && reasoning !== null && reasoning > output ? 'invalid-reasoning' : computed !== null && reported !== null && computed !== reported ? 'total-mismatch' : (input === null || output === null || (disjointReasoning && reasoning === null) ? 'partial' : 'measured')
  };
}
module.exports = { number, timestamp, provider, digest, normalize };
