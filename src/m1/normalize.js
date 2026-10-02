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
  if (/^(gpt|o[134]-)/.test(model)) return 'openai';
  if (/^claude-/.test(model)) return 'anthropic';
  if (/^mimo-/.test(model)) return 'mimo';
  if (/^glm-/.test(model)) return 'zai';
  if (/^deepseek-/.test(model)) return 'deepseek';
  return 'unknown';
}
function digest(salt, value) { return crypto.createHmac('sha256', salt).update(value).digest('hex'); }
function normalize(agent, usage, info, salt, semantics = 'inclusive') {
  const input = number(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? usage.input);
  const rawOutput = number(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? usage.output);
  const read = number(usage.cached_input_tokens ?? usage.cache_read_input_tokens ?? usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.cache?.read);
  const write = number(usage.cache_creation_input_tokens ?? usage.cache?.write);
  const reasoning = number(usage.reasoning_output_tokens ?? usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning);
  // OpenCode/MiMo persist disjoint visible-output and reasoning buckets.
  // The public contract normalizes output to include reasoning, as Codex does.
  const disjointReasoning = agent === 'opencode' || agent === 'mimo';
  const output = rawOutput === null ? null : rawOutput + (disjointReasoning ? (reasoning ?? 0) : 0);
  let uncached = input;
  if (semantics === 'inclusive' && input !== null) uncached = Math.max(0, input - (read ?? 0) - (write ?? 0));
  const reported = number(usage.total_tokens ?? usage.totalTokens ?? usage.total);
  const computed = input !== null && output !== null ? input + output + (semantics === 'exclusive' ? (read ?? 0) + (write ?? 0) : 0) : null;
  const total = computed ?? reported;
  const time = timestamp(info.time);
  if (!time || total === null) return null;
  const model = typeof info.model === 'string' && /^[a-zA-Z0-9._:/-]{1,179}$/.test(info.model) && !/^(?:[/\\]|[a-zA-Z]:[/\\])/.test(info.model) ? info.model : 'unknown';
  const key = info.id || JSON.stringify([info.time, info.session, model, usage]);
  return {
    id: digest(salt, agent + ':' + key), sessionKey: info.session ? digest(salt, agent + ':session:' + info.session) : null, agent, entry: info.entry || 'unknown', model,
    provider: provider(model, info.provider), timestamp: time,
    inputUncached: uncached, output, cacheRead: read, cacheWrite: write, reasoning,
    totalTokens: total, semantics: { input: semantics, sourceOutput: disjointReasoning ? 'excludes-reasoning' : 'includes-reasoning', reasoning: 'subset-of-normalized-output' },
    sharedKey: disjointReasoning && info.id ? digest(salt, JSON.stringify(['shared-opencode-schema', info.id, time, model, usage])) : null,
    quality: semantics === 'inclusive' && input !== null && (read ?? 0) + (write ?? 0) > input ? 'invalid-cache' : !disjointReasoning && output !== null && reasoning !== null && reasoning > output ? 'invalid-reasoning' : computed !== null && reported !== null && computed !== reported ? 'total-mismatch' : (input === null || output === null || (disjointReasoning && reasoning === null) ? 'partial' : 'measured')
  };
}
module.exports = { number, timestamp, provider, digest, normalize };
