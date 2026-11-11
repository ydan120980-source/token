'use strict';
// One invented reading for every Agent that has, or is about to have, a quota card. The shapes are what
// each adapter is asked to return (docs/m2/UI-QUOTA-CARDS-BATCH-20261104.md); no value comes from a real account.
const { projectResources } = require('../../src/quota/resource-contract');
const HOUR = 3600000, DAY = 24 * HOUR;
const at = ms => new Date(Date.now() + ms).toISOString();
const week = (usedPercent, id = 'week', extra = {}) => ({ id, role: 'primary', unit: 'percent', usedPercent, durationMins: 10080, resetsAt: at(3 * DAY + 6 * HOUR), availability: 'available', ...extra });
const hours = (usedPercent, id = 'five-hour', extra = {}) => ({ id, role: 'secondary', unit: 'percent', usedPercent, durationMins: 300, resetsAt: at(4 * HOUR + 30 * 60000), availability: 'available', ...extra });
const month = (usedPercent, id = 'month', extra = {}) => ({ id, role: 'other', unit: 'percent', usedPercent, durationMins: 43200, resetsAt: at(18 * DAY + 6 * HOUR), availability: 'available', ...extra });
const named = (id, label, usedPercent, extra = {}) => ({ id, label, role: 'other', unit: 'percent', usedPercent, availability: 'available', ...extra });
const pool = (id, label, windows = [], balances = [], extra = {}) => ({ id, label, scope: 'account', windows, balances, ...extra });
const money = (id, label, remaining, kind, extra = {}) => ({ id, label, unit: 'currency', currency: 'USD', remaining, kind, availability: 'available', ...extra });
const credits = (id, label, remaining, total, extra = {}) => ({ id, label, unit: 'credits', remaining, total, kind: 'subscription', availability: 'available', ...extra });

// The reference cards' figures read remaining; used is 100 minus that.
const READINGS = {
  codex: { plan: 'plus', resetCredits: 2, pools: [pool('codex', 'Codex', [hours(36), week(62)])] },
  claude: { plan: 'max', pools: [pool('claude', 'Claude', [week(62), hours(36), named('week-fable', 'Fable', 40, { durationMins: 10080 })])] },
  cursor: { plan: 'pro', pools: [pool('cursor', 'Cursor', [named('auto', '自动', 62, { role: 'primary', resetsAt: at(3 * DAY + 6 * HOUR) }), named('api', 'API', 36), named('grok', 'Grok Bot', 72)])] },
  kimi: { pools: [pool('kimi', 'Kimi', [week(62), hours(36)])] },
  zcode: { plan: 'coding plan', pools: [pool('zcode', 'ZCode', [week(62), hours(36)])] },
  opencode: { pools: [pool('go', 'Go', [week(62), hours(36), month(72)])] },
  deepseek: { pools: [pool('wallet', 'DeepSeek', [], [money('total', '总余额', '42.50', 'unknown'), money('promo', '赠送', '2.50', 'promotional'), money('topup', '充值', '40.00', 'purchased')])] },
  gemini: { pools: [pool('pro', 'Gemini Pro', [named('pro', 'Pro 模型', 38, { role: 'primary', durationMins: 1440, resetsAt: at(9 * HOUR) })], [], { modelIds: ['demo-pro'] }), pool('flash', 'Gemini Flash', [named('flash', 'Flash 模型', 12, { role: 'secondary', durationMins: 1440, resetsAt: at(9 * HOUR) })], [], { modelIds: ['demo-flash'] })] },
  antigravity: { plan: 'pro', pools: [pool('gemini-models', 'Gemini Models', [named('g', 'Gemini Models', 62, { role: 'primary', durationMins: 300, resetsAt: at(2 * HOUR) })]), pool('other-models', 'Claude and GPT models', [named('o', 'Claude and GPT models', 36, { role: 'secondary', durationMins: 10080, resetsAt: at(5 * DAY) })])] },
  mimo: { pools: [pool('plan', 'Token Plan', [], [credits('plan', 'Token Plan Credits', '1200000', '6000000', { unit: 'credits' }), money('api', 'API 余额', '12.50', 'purchased', { currency: 'CNY' })])] },
  workbuddy: { pools: [pool('cycle', '月度周期积分', [{ id: 'cycle', label: '周期积分', role: 'primary', unit: 'credits', remaining: '1300', total: '2000', durationMins: 43200, resetsAt: at(12 * DAY), availability: 'available' }]), pool('pack-a', '加量包 示例', [], [credits('pack-a', '加量包', '420', '1000', { kind: 'purchased', expiresAt: at(20 * DAY) })])] },
  'codex-single': { plan: 'pro', resetCredits: 2, pools: [pool('codex', 'Codex', [week(62)])] },
  // Waiting for their readers.
  copilot: { plan: 'pro', pools: [pool('copilot', 'GitHub Copilot', [named('premium', '高级请求', 38, { role: 'primary', durationMins: 43200, resetsAt: at(18 * DAY) }), named('chat', '对话', 12), named('completions', '补全', 4)])] },
  qwen: { pools: [pool('qwen', 'Qwen', [hours(36), week(62), month(72)])] },
  kilo: { pools: [pool('kilo', 'Kilo', [], [money('total', '总余额', '18.40', 'unknown'), money('pass', 'Kilo Pass', '15.00', 'subscription', { expiresAt: at(20 * DAY) }), money('credits', '积分', '3.40', 'purchased')])] },
  cline: { pools: [pool('cline', 'Cline', [], [money('credits', '账户余额', '7.25', 'purchased')])] },
};

// The longest things each kind of card has to show whole.
const LONG = {
  antigravity: { plan: 'enterprise ultra annual', pools: [pool('a', 'Claude and GPT models with a long group name', [named('a', 'Claude and GPT models with a long group name', 62, { role: 'primary', durationMins: 300, resetsAt: at(2 * HOUR) })]), pool('b', 'Gemini Models of another long group name', [named('b', 'Gemini Models of another long group name', 36, { role: 'secondary', durationMins: 10080, resetsAt: at(5 * DAY) })])] },
  cursor: { plan: 'ultra', pools: [pool('cursor', 'Cursor', [named('auto', '自动与混合模型额度', 62, { role: 'primary', resetsAt: at(3 * DAY) }), named('api', 'API 按需额度上限', 36), named('grok', 'Grok Bot Enterprise', 72)])] },
  mimo: { pools: [pool('plan', 'Token Plan', [], [credits('plan', 'Token Plan Credits', '123456789012.5', '987654321098.5'), money('api', 'API 余额（按量计费）', '9007199254740993.125', 'purchased', { currency: 'CNY' }), credits('gift', '活动赠送的限时积分', '1200', '6000')])] },
  deepseek: { pools: [pool('wallet', 'DeepSeek', [], [money('total', '总余额', '9007199254740993.125', 'unknown'), money('promo', '赠送余额（活动）', '1234567.50', 'promotional'), money('topup', '充值余额（长期有效）', '9007199253506425.625', 'purchased')])] },
  claude: { plan: 'max 20x annual', pools: [pool('claude', 'Claude', [week(100), hours(100, 'five-hour', { resetsAt: at(-HOUR) }), named('week-fable', 'Fable', 40, { durationMins: 10080 }), named('week-opus', 'Opus', 80, { durationMins: 10080 })])] },
  kilo: { pools: [pool('kilo', 'Kilo', [], [money('total', '总余额', '1234567890.40', 'unknown'), money('pass', 'Kilo Pass 年度订阅额度', '1234567875.40', 'subscription', { expiresAt: at(2 * DAY) }), money('credits', '赠送积分', '15.00', 'purchased')])] },
  copilot: { plan: 'enterprise', pools: [pool('copilot', 'GitHub Copilot', [named('premium', '高级请求（含编码代理）', 38, { role: 'primary', durationMins: 43200, resetsAt: at(18 * DAY) }), named('chat', '对话与内联建议额度', 12), named('completions', '代码补全额度', 4)])] },
  opencode: { pools: [pool('go', 'Go', [week(100), hours(0), month(72)])] },
};

// The fullest shapes a card has at ordinary lengths: three windows with two-word names, and two slips with long names. These still have to stay square.
const CROWDED = {
  antigravity: { plan: 'pro', pools: [pool('g', 'Gemini Models', [named('g', 'Gemini Models', 4, { role: 'primary', durationMins: 10080, resetsAt: at(6 * DAY) }), named('g5', 'Gemini Models', 0, { role: 'secondary', durationMins: 300, resetsAt: at(2 * HOUR) })]), pool('o', 'Claude and GPT models', [named('o', 'Claude and GPT models', 12, { role: 'secondary', durationMins: 10080, resetsAt: at(5 * DAY) })])] },
  workbuddy: { pools: ['甲', '乙', '丙'].map((tag, index) => pool('pack-' + index, '个人版季度活动赠送积分包' + tag, [], [credits('pack-' + index, '个人版季度活动赠送积分包' + tag, String(500 - index * 100), '1000', { kind: 'purchased', expiresAt: at((20 + index) * DAY) })])) },
  claude: READINGS.claude,
};

function quotaOf(provider, reading = READINGS[provider], fetchedAt = new Date(Date.now() - 8 * 60000).toISOString()) {
  const raw = { schemaVersion: 'AccountQuotaV2', provider, fetchedAt, provenance: { kind: 'synthetic' }, entitlement: { plan: reading.plan ?? null, state: 'active', observedAt: fetchedAt }, pools: reading.pools, resetCredits: reading.resetCredits };
  const projected = projectResources(raw); if (!projected) throw Error('fixture does not fit the contract: ' + provider);
  return projected;
}
module.exports = { READINGS, LONG, CROWDED, quotaOf };
