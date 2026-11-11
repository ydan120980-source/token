'use strict';
// M6: exact resource/identity/decimal projections extracted from quota-cards.js. No DOM, I/O or provider reads.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.quotaModel=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>{
function parsePrefs(raw){return create({prefs:{}},{}).parsePrefs(raw);}
function create(context,window){
function parsePrefs(raw) {
    const blank = { names: {}, hidden: [], order: [], measure: 'remaining', range: '7d', filter: 'all', slide: 'now' };
    try {
      const saved = JSON.parse(raw || 'null'); if (!saved || typeof saved !== 'object') return blank;
      const names = {}; for (const [key, value] of Object.entries(saved.names || {})) if (typeof value === 'string' && value.trim()) names[key] = value.trim().slice(0, 32);
      const keys = list => Array.isArray(list) ? [...new Set(list.filter(value => typeof value === 'string' && value.length <= 200))] : [];
      return { names, hidden: keys(saved.hidden), order: keys(saved.order), measure: saved.measure === 'used' ? 'used' : 'remaining', range: Object.hasOwn(RANGES, saved.range) ? saved.range : '7d', filter: Object.hasOwn(FILTERS, saved.filter) ? saved.filter : 'all', slide: ['now', 'next', 'wallets'].includes(saved.slide) ? saved.slide : 'now' };
    } catch { return blank; }
  }
const logo = agent => 'assets/' + (window.agentCatalog.agents[agent]?.icon || 'ui/layout-grid') + '.svg';
const dateFormat = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const at = value => value && Number.isFinite(Date.parse(value)) ? dateFormat.format(new Date(value)) : '未提供';
const LIFECYCLE = { available: '可用', exhausted: '已耗尽', unknown: '状态未知', disabled: '已禁用', unlimited: '服务明确无限', unavailable: '服务不可用', expired: '已到期', 'not-yet-valid': '尚未生效' };
const FRESHNESS = { fresh: '新鲜观测', stale: '已过重置时间 · 需刷新', cached: '缓存 · 待核验', missing: '观测未知' };
const BLOCKING = new Set(['exhausted', 'disabled', 'unavailable', 'expired', 'not-yet-valid']);
const UNITS = { credits: '积分', requests: '次请求', tokens: 'Token' };
const NAMES = { 'purchased-credits': '购买的积分' };
const KINDS = { purchased: '充值余额', promotional: '赠送余额', subscription: '套餐额度' };
const DAY = 86400000;
const STALE_AFTER = DAY;
const RANGES = { '1d': { label: '24 小时', span: DAY }, '7d': { label: '7 天', span: 7 * DAY }, '30d': { label: '30 天', span: 30 * DAY } };
const FILTERS = { all: { label: '全部', match: () => true }, action: { label: '需要处理', match: item => Boolean(item.warn) }, ready: { label: '正常', match: item => !item.warn }, idle: { label: '未连接', match: () => false } };
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const unitOf = item => item.unit === 'currency' ? item.currency || '' : UNITS[item.unit] || '';
const known = value => value !== null && value !== undefined && value !== '';
const exactAmount = item => amount(item, true);
const remainingText = item => item.state === 'unlimited' ? '无限' : known(item.remaining) ? decimal(item.remaining, item.unit === 'currency') + (unitOf(item) ? ' ' + unitOf(item) : '') : '未知';
const short = label => String(label ?? '').split(/ · |（|\(/)[0].trim();
const itemName = item => short(item.label) || NAMES[item.id] || KINDS[item.kind] || item.id;
const ROLE = { primary: 0, secondary: 1 };
const isStale = item => item.freshness?.state === 'stale' || Boolean(item.resetsAt) && Date.parse(item.resetsAt) <= Date.now();
const SPENDABLE = item => item.unit === 'credits' && !['expired', 'disabled', 'not-yet-valid', 'unavailable'].includes(item.state) && item.availability !== 'unavailable' && item.id !== 'frozen';
const expiryOf = entry => Number.isFinite(Date.parse(entry.item.expiresAt)) ? Date.parse(entry.item.expiresAt) : Infinity;
const usable = entry => !BLOCKING.has(entry.item.state) && entry.item.availability !== 'unavailable';
const outdated = quota => Date.now() - Date.parse(quota?.fetchedAt) > STALE_AFTER;
const brief = text => String(text || '').split(/[，,。；;]/)[0].trim() || String(text || '');
const idleKey = provider => 'agent:' + provider;
const displayName = (key, fallback) => context.prefs.names[key] || fallback;
const withUnit = (value, unit) => value + (unit ? ' ' + unit : '');
function decimal(value, currency) {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? '').trim()); if (!match) return String(value ?? '');
    let [, sign, whole, fraction = ''] = match;
    if (fraction.length > 2) {
      const digits = (whole + fraction.slice(0, 2)).split('').map(Number);
      if (Number(fraction[2]) >= 5) { let i = digits.length - 1; for (; i >= 0 && digits[i] === 9; i--) digits[i] = 0; if (i < 0) digits.unshift(1); else digits[i]++; }
      const all = digits.join(''); whole = all.slice(0, -2); fraction = all.slice(-2);
    }
    fraction = currency ? fraction.padEnd(2, '0') : fraction.replace(/0+$/, '');
    whole = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (sign && /[1-9]/.test(whole + fraction) ? '-' : '') + whole + (fraction ? '.' + fraction : '');
  }
function amount(item, exact) {
    if (item.state === 'unlimited') return '无限';
    const unit = unitOf(item), show = value => exact ? String(value) : decimal(value, item.unit === 'currency');
    if (!known(item.remaining)) return '未知' + (known(item.total) ? ' / ' + show(item.total) + (unit ? ' ' + unit : '') : '');
    return show(item.remaining) + (known(item.total) ? ' / ' + show(item.total) : '') + (unit ? ' ' + unit : '');
  }
function duration(mins) {
    if (!Number.isFinite(mins) || mins <= 0) return null;
    return mins === 10080 ? '每周' : mins === 1440 ? '每天' : mins % 1440 === 0 ? mins / 1440 + ' 天' : mins % 60 === 0 ? mins / 60 + ' 小时' : mins + ' 分钟';
  }
function clock(value, now = Date.now()) {
    const date = new Date(value); if (!Number.isFinite(date.getTime())) return '时间未知';
    const time = timeFormat.format(date), today = new Date(now); today.setHours(0, 0, 0, 0);
    const days = Math.floor((date - today) / DAY);
    return days === 0 ? '今天 ' + time : days === 1 ? '明天 ' + time : days > 1 && days < 7 ? WEEKDAYS[date.getDay()] + ' ' + time : date.getMonth() + 1 + ' 月 ' + date.getDate() + ' 日';
  }
function windowLabel(window, pool, index, pools = 1) {
    const span = duration(window.durationMins), prefix = index > 0 || pools > 1 ? short(pool.label) : '';
    // A window with a name of its own (a model, 高级请求) says it; one that only describes its span ("7 天订阅窗口") says the span.
    const own = short(window.label).replace(/\s*周窗口$/, '');
    if (own && !/小时|每[周天月]|\d\s*天|窗口/.test(own) && pools <= 1) return own;
    const base = span || (pool.modelIds?.length ? pool.modelIds.join(' · ') : '') || short(window.label) || short(pool.label) || '额度';
    return span && prefix ? prefix + ' · ' + span : base;
  }
function fromV1(quota, plan) {
    if (!quota) return null;
    return { fetchedAt: quota.fetchedAt, resetCredits: quota.resetCredits ?? null, partial: false, entitlement: { plan: plan || null, validUntil: null, verificationRequired: false },
      pools: [{ id: 'codex', label: 'Codex', modelIds: [], balances: [], windows: (quota.windows || []).map((w, i) => ({ id: 'w' + i, label: w.name === 'codex' ? null : w.name, role: i ? 'secondary' : 'primary', durationMins: w.durationMins ?? null, unit: 'percent', remainingPercent: w.remainingPercent ?? null, usedPercent: w.usedPercent ?? null, resetsAt: w.resetsAt ?? null, state: Number.isFinite(w.remainingPercent) ? 'available' : 'unknown', freshness: null })) }] };
  }
function parts(quota) {
    const percent = [], money = [], pools = quota?.pools || [];
    pools.forEach((pool, index) => {
      const named = pools.length > 1 && short(pool.label);
      const label = item => named ? named : itemName(item);
      // A recurring amount says when it resets, which already tells it from a one-off package.
      for (const window of pool.windows || []) (window.unit === 'percent' ? percent.push({ pool, index, item: window, label: windowLabel(window, pool, index, pools.length) }) : money.push({ pool, index, item: window, label: named || windowLabel(window, pool, index), detail: named && !window.resetsAt ? itemName(window) : '' }));
      for (const balance of pool.balances || []) money.push({ pool, index, item: balance, label: label(balance), detail: named ? itemName(balance) : '' });
    });
    percent.sort((a, b) => (ROLE[a.item.role] ?? 2) - (ROLE[b.item.role] ?? 2) || a.index - b.index);
    return { percent, money };
  }
function percentOf(item) {
    if (item.state === 'unlimited') return { text: '无限', value: 100, unknown: false, word: context.prefs.measure === 'used' ? '已用' : '剩余' };
    const remaining = Number.isFinite(item.remainingPercent) ? item.remainingPercent : null;
    const value = context.prefs.measure === 'used' ? (Number.isFinite(item.usedPercent) ? item.usedPercent : remaining === null ? null : 100 - remaining) : remaining;
    const word = context.prefs.measure === 'used' ? '已用' : '剩余';
    return Number.isFinite(value) ? { text: value.toLocaleString('zh-CN', { maximumFractionDigits: 1 }), value: Math.max(0, Math.min(100, value)), unknown: false, word, low: remaining !== null && remaining < 20 } : { text: '未知', value: null, unknown: true, word };
  }
function windowNote(item) {
    if (isStale(item)) return '待刷新';
    if (item.state === 'exhausted' && item.resetsAt) return '已耗尽 · ' + clock(item.resetsAt) + ' 恢复';
    if (BLOCKING.has(item.state)) return LIFECYCLE[item.state];
    return item.resetsAt ? window.displayValues.reset(item.resetsAt) : '';
  }
function moneyNote(entry) {
    const item = entry.item;
    if (BLOCKING.has(item.state)) return LIFECYCLE[item.state];
    if (item.availability === 'unavailable') return '不可用';
    if (item.resetsAt) { const mins = (Date.parse(item.resetsAt) - Date.now()) / 60000; return mins >= 1440 ? Math.floor(mins / 1440) + ' 天后重置' : windowNote(item); }
    if (item.expiresAt && Number.isFinite(Date.parse(item.expiresAt))) { const date = new Date(item.expiresAt); return date.getMonth() + 1 + ' 月 ' + date.getDate() + ' 日到期'; }
    return '';
  }
function timeLeft(item) {
    const reset = Date.parse(item.resetsAt), span = item.durationMins * 60000;
    if (!Number.isFinite(reset) || !(span > 0) || reset <= Date.now()) return null;
    return Math.max(0, Math.min(1, (reset - Date.now()) / span));
  }
function pace(item) {
    if (item.state === 'unlimited' || BLOCKING.has(item.state) || isStale(item) || !Number.isFinite(item.remainingPercent)) return null;
    const left = timeLeft(item); if (left === null || left > .9) return null;
    const time = Math.round(left * 100), diff = item.remainingPercent - time;
    return { word: diff >= -5 ? '节奏充裕' : diff < -15 ? '节奏偏快' : '节奏正常', title: '估算：按本窗口至今的平均速度，时间还剩 ' + time + '%，额度还剩 ' + item.remainingPercent.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + '%' };
  }
function addDecimals(values) {
    const parsed = values.map(value => /^(\d+)(?:\.(\d+))?$/.exec(String(value).trim()));
    if (parsed.some(match => !match)) return null;
    const scale = Math.max(0, ...parsed.map(match => (match[2] || '').length));
    const sum = parsed.reduce((total, match) => total + BigInt(match[1] + (match[2] || '').padEnd(scale, '0')), 0n).toString().padStart(scale + 1, '0');
    return scale ? sum.slice(0, -scale) + '.' + sum.slice(-scale) : sum;
  }
function creditTotal(account, money) {
    if (account.agent !== 'workbuddy' || new Set(money.map(entry => entry.pool.id)).size < 2) return null;
    const counted = money.filter(entry => SPENDABLE(entry.item)), reported = counted.filter(entry => known(entry.item.remaining));
    if (!reported.length) return null;
    const remaining = addDecimals(reported.map(entry => entry.item.remaining)); if (remaining === null) return null;
    const total = reported.every(entry => known(entry.item.total)) ? addDecimals(reported.map(entry => entry.item.total)) : null;
    const unknown = counted.length - reported.length;
    const complete = account.row?.adapter === 'workbuddy-desktop' && account.quota?.incomplete === false, scope = complete ? '本次读取范围内的 ' : '已返回的 ';
    return { pool: { id: 'sum' }, item: { id: 'sum', unit: 'credits', state: 'available', remaining, total, label: scope + reported.length + ' 个积分包合计' + (complete ? '（分页已读完）' : '') + (unknown ? '，另有 ' + unknown + ' 个余量未知未计入' : '') + (money.length > counted.length ? '；冻结、已到期或不可用的积分不计入' : '') }, label: '可用积分', detail: '可用积分 · ' + (complete ? '' : '已返回的 ') + reported.length + ' 个积分包' + (unknown ? ' · ' + unknown + ' 个未知' : ''), reported };
  }
function figureOf(money) {
    if (money.length === 1) return money[0];
    const pools = new Set(money.map(entry => entry.pool.id));
    return pools.size === 1 ? money.find(entry => entry.item.id === 'total') || null : null;
  }
function age(quota) {
    const fetched = Date.parse(quota?.fetchedAt);
    if (!Number.isFinite(fetched)) return '未更新';
    if (fetched > Date.now() + 60000) return '时间异常';
    const mins = Math.max(0, Math.floor((Date.now() - fetched) / 60000));
    return mins < 1 ? '刚刚' : mins < 60 ? mins + ' 分钟前' : mins < 1440 ? Math.floor(mins / 60) + ' 小时前' : Math.floor(mins / 1440) + ' 天前';
  }
function providerStatus(row) {
    if (row.busy) return { text: '正在读取' };
    if (row.errorMessage) return { text: '需要处理', title: row.errorMessage, warn: true };
    if (row.credentialReady === false) return { text: '需重新提供凭据', warn: true };
    if (row.duplicateKnown) return { text: '重复连接 · 额度不可叠加' };
    return { text: ['ready', 'cached'].includes(row.status) ? window.connectionState.quotaLabel(window.connectionState.quotaFreshness(row)) : '已保存连接' };
  }
function capabilities() {
    const saved = window.providerQuotaUi?.state()?.capabilities;
    if (saved) return saved;
    return Object.entries(window.agentCatalog.agents).filter(([, meta]) => !meta.custom).map(([provider, meta]) => ({ provider, name: meta.name, mode: provider === 'codex' ? 'official-cli' : 'not-connected', adapters: [], reason: provider === 'codex' ? '通过官方 CLI 独立授权连接。' : '界面预览 · 未读取账号连接。' }));
  }
function accounts() {
    // Codex rows come from both reads: the V2 row carries the resources, the V1 row (when the
    // control read has it) the latest busy and error state. Either alone is enough for a card.
    const quota = window.quotaUi, v2 = new Map((window.providerQuotaUi?.codex() || []).map(row => [row.id, row])), v1 = new Map((quota?.state().accounts || []).map(row => [row.id, row]));
    const codex = [...new Set([...v1.keys(), ...v2.keys()])].map(id => { const row = { ...v2.get(id), ...v1.get(id) }, status = quota.accountStatus(row); return { agent: 'codex', id, alias: row.alias, plan: row.plan, row, quota: v2.get(id)?.quota || fromV1(row.quota, row.plan), status: { text: status, warn: Boolean(row.errorCode) || ['login-required', 'login-failed'].includes(row.status), title: row.errorCode ? status : null }, busy: Boolean(row.busy),
      refresh: { disabled: quota.disabledRefresh(row) } }; });
    const others = (window.providerQuotaUi?.state()?.accounts || []).map(row => ({ agent: row.provider, id: row.id, alias: row.alias, plan: row.quota?.entitlement?.plan, row, quota: row.quota, status: providerStatus(row), busy: Boolean(row.busy),
      refresh: { disabled: row.busy || !row.credentialReady && !row.credentialRetryable || Date.parse(row.nextRefreshAt) > Date.now() } }));
    return [...codex, ...others];
  }
function cardsOf(list) {
    const byId = new Map(list.map(account => [account.id, account])), seen = new Set(), out = [];
    for (const account of list) {
      if (seen.has(account.id)) continue;
      const members = [account]; seen.add(account.id);
      if (account.row?.duplicateKnown) for (const id of account.row.duplicateAccountIds || []) { const peer = byId.get(id); if (peer && !seen.has(id)) { members.push(peer); seen.add(id); } }
      const fetched = member => Date.parse(member.quota?.fetchedAt) || 0;
      const lead = [...members].sort((a, b) => Number(a.status.warn) - Number(b.status.warn) || fetched(b) - fetched(a))[0];
      // The earliest connection names the card, so its name, place and visibility survive the group
      // splitting again (identity is unknown after a restart until each connection reads once).
      const key = account.id;
      const warned = members.filter(member => member.status.warn).length;
      const status = members.length < 2 ? lead.status : warned === members.length ? lead.status : warned ? { text: warned + ' / ' + members.length + ' 个连接需要处理', warn: true, title: members.filter(member => member.status.warn).map(member => (member.alias || member.agent) + '：' + (member.status.title || member.status.text)).join('；') } : { text: '同一账号 · ' + members.length + ' 个连接' };
      out.push({ ...lead, key, members, status, lead });
    }
    return out;
  }
function duplicateNote(account) {
    if (!account.row.duplicateKnown) return '';
    const ids = new Set(account.row.duplicateAccountIds || []);
    const peers = accounts().filter(other => other.agent === account.agent && other.id !== account.id && ids.has(other.id)).map(other => displayName(other.id, other.alias || '账号'));
    return (account.row.identityStatus === 'credential-match' ? '相同凭据及读取范围的重复连接' : '同一账号的重复连接') + (peers.length ? '：' + peers.join('、') : '') + '。额度不可叠加。';
  }
function sharedNote(item) {
    if (item.members.length < 2) return duplicateNote(item);
    return (item.lead.row.identityStatus === 'credential-match' ? '相同凭据及读取范围的 ' : '同一账号的 ') + item.members.length + ' 个连接：' + item.members.map(member => displayName(member.id, member.alias || '账号')).join('、') + '。额度不可叠加。';
  }
function ordered(cards) {
    const place = new Map(context.prefs.order.map((key, index) => [key, index])), rank = item => context.prefs.order.length ? 0 : item.warn ? 0 : 1;
    return cards.map((value, index) => ({ ...value, index })).sort((a, b) => rank(a) - rank(b) || (place.get(a.key) ?? context.prefs.order.length + a.index) - (place.get(b.key) ?? context.prefs.order.length + b.index));
  }
function span(ms) {
    const mins = Math.max(1, Math.ceil(ms / 60000)), days = Math.floor(mins / 1440), hours = Math.floor(mins % 1440 / 60), rest = mins % 60;
    return days ? days + ' 天' + (hours ? ' ' + hours + ' 小时' : '') : hours ? hours + ' 小时' + (rest ? ' ' + rest + ' 分' : '') : rest + ' 分钟';
  }
function lanesOf(shown, names) {
    const now = Date.now(), lanes = [], silent = [];
    for (const item of shown) {
      const { percent, money } = parts(item.quota), before = lanes.length, name = names(item), stale = percent.filter(entry => isStale(entry.item));
      if (stale.length) lanes.push({ item, name, label: stale.length > 1 ? stale.length + ' 个窗口' : stale[0].label, kind: 'stale' });
      for (const entry of percent) {
        if (isStale(entry.item)) continue;
        const reset = Date.parse(entry.item.resetsAt); if (!Number.isFinite(reset) || entry.item.state === 'unlimited') continue;
        lanes.push({ item, name, label: entry.label, kind: BLOCKING.has(entry.item.state) || entry.item.remainingPercent === 0 ? 'out' : 'window', value: percentOf(entry.item), at: reset });
      }
      const ends = money.filter(entry => usable(entry) && Number.isFinite(Date.parse(entry.item.expiresAt)) && Date.parse(entry.item.expiresAt) > now);
      if (ends.length) {
        const byDay = new Map(); for (const entry of ends) { const day = new Date(entry.item.expiresAt); day.setHours(0, 0, 0, 0); const list = byDay.get(+day) || []; list.push(entry); byDay.set(+day, list); }
        const sum = creditTotal(item, money), unit = unitOf(ends[0].item);
        // What stays after each day's expiry: the summed packages that end later or never.
        const marks = [...byDay].sort((a, b) => a[0] - b[0]).map(([, list]) => {
          const at = Math.max(...list.map(expiryOf)), value = addDecimals(list.filter(entry => known(entry.item.remaining)).map(entry => entry.item.remaining));
          const after = sum ? addDecimals(sum.reported.filter(entry => expiryOf(entry) > at).map(entry => entry.item.remaining)) : null;
          return { at, count: list.length, value, text: value ? decimal(value) : list.length + ' 个', after, unit };
        });
        lanes.push({ item, name, label: '到期', kind: 'expiry', marks, sum, unit });
      }
      for (const entry of money.filter(entry => Number.isFinite(Date.parse(entry.item.resetsAt)) && Date.parse(entry.item.resetsAt) > now)) lanes.push({ item, name, label: entry.label, kind: 'amount', at: Date.parse(entry.item.resetsAt), entry });
      if (lanes.length === before) silent.push(item);
    }
    return { lanes, silent };
  }
function ticksOf(range) {
    const now = Date.now(), span = RANGES[range].span, ticks = [];
    if (range === '1d') { const t = new Date(now); t.setMinutes(0, 0, 0); t.setHours(Math.ceil((t.getHours() + 1) / 6) * 6); for (let time = +t; time < now + span; time += 6 * 3600000) ticks.push([time, new Date(time).getHours() === 0 ? WEEKDAYS[new Date(time).getDay()] : new Date(time).getHours() + ':00']); }
    else { const t = new Date(now); t.setHours(24, 0, 0, 0); const step = range === '7d' ? 1 : 7; for (let time = +t; time < now + span; time += step * DAY) { const d = new Date(time); ticks.push([time, range === '7d' ? WEEKDAYS[d.getDay()] : d.getMonth() + 1 + '/' + d.getDate()]); } }
    return ticks;
  }
function heroWindow(entry, pooled) {
    const item = entry.item, p = percentOf(item), stale = isStale(item), unlimited = item.state === 'unlimited', out = !stale && (BLOCKING.has(item.state) || item.remainingPercent === 0), left = stale ? null : timeLeft(item), reset = Date.parse(item.resetsAt);
    const label = pooled ? duration(item.durationMins) || short(item.label) || entry.label : entry.label;
    return { label, state: stale ? 'stale' : unlimited ? 'unlimited' : p.unknown ? 'unknown' : out ? 'out' : 'ok', value: stale || p.unknown ? null : p.value, number: stale || p.unknown || unlimited ? null : p.text,
      text: stale ? '待刷新' : p.unknown ? '未知' : unlimited ? '无限' : p.text + '%', time: left === null ? null : context.prefs.measure === 'used' ? 1 - left : left, at: !stale && Number.isFinite(reset) && reset > Date.now() ? reset : null, pace: pace(item), remaining: Number.isFinite(item.remainingPercent) ? item.remainingPercent : null };
  }
function tileOf(item) {
    const { percent, money } = parts(item.quota);
    if (!item.quota) return { value: null, unit: '', note: '还没有读到额度', empty: true };
    if (!money.length) return percent.length ? null : { value: '没有额度项', unit: '', note: '没有额度项', title: '服务没有返回额度项，这不代表额度为 0', empty: true };
    const sum = creditTotal(item, money), lead = sum || figureOf(money) || money.find(usable) || money[0], it = lead.item, unit = unitOf(it);
    const value = it.state === 'unlimited' ? '无限' : known(it.remaining) ? decimal(it.remaining, it.unit === 'currency') : null, blocked = BLOCKING.has(it.state) || it.availability === 'unavailable';
    const note = blocked ? LIFECYCLE[it.state] || '不可用' : known(it.total) ? '共 ' + withUnit(decimal(it.total, it.unit === 'currency'), unit) : money.length > 1 && !sum ? '另 ' + (money.length - 1) + ' 项' : moneyNote(lead);
    let ladderParts = null;
    if (sum) {
      const now = Date.now(), groups = [[], [], [], []];
      for (const entry of sum.reported) { const end = expiryOf(entry); groups[end === Infinity ? 3 : end - now <= 7 * DAY ? 0 : end - now <= 30 * DAY ? 1 : 2].push(entry.item.remaining); }
      ladderParts = groups.map((list, i) => ({ kind: ['soon', 'month', 'later', 'open'][i], w: list.length ? Number(addDecimals(list)) || 0 : 0 })).filter(part => part.w > 0);const all=ladderParts.reduce((n,p)=>n+p.w,0);ladderParts=ladderParts.map(p=>({...p,fraction:all?p.w/all:0}));
    }
    return { value, unit: known(it.remaining) && it.state !== 'unlimited' ? unit : '', note, warn: blocked, title: (lead.detail || lead.label) + ' ' + amount(it), ladder: ladderParts && ladderParts.length > 1 ? ladderParts : null };
  }
function heroModel(caps, shown) {
    if (!shown.length) return null;
    const names = new Map(caps.map(capability => [capability.provider, capability.name])), name = item => displayName(item.key, names.get(item.agent) || item.agent);
    const who = item => ({ agent: item.agent, account: item.id, logo: logo(item.agent), name: name(item) });
    // 现在: one dial per pool of percentage windows.
    const dials = [];
    for (const item of shown) {
      const pools = new Map(); for (const entry of parts(item.quota).percent) { const list = pools.get(entry.pool.id) || []; list.push(entry); pools.set(entry.pool.id, list); }
      // Pools of one window each (Gemini's models) share one dial, a ring per pool; pools with several
      // windows (Antigravity's model groups) get a dial each.
      if (pools.size > 1 && [...pools.values()].every(list => list.length === 1)) dials.push({ ...who(item), sub: '', windows: [...pools.values()].slice(0, 3).map(([entry]) => ({ ...heroWindow(entry, false), label: short(entry.pool.label) || entry.label })) });
      else for (const list of pools.values()) dials.push({ ...who(item), sub: pools.size > 1 ? short(list[0].pool.label) : '', windows: list.slice(0, 3).map(entry => heroWindow(entry, pools.size > 1)) });
    }
    let lead = null;
    dials.forEach((d, di) => d.windows.forEach((w, wi) => {
      const rank = w.state === 'out' && w.at ? [0, w.at] : w.state === 'ok' && w.remaining !== null ? [1, w.remaining] : [2, 0];
      if (!lead || rank[0] < lead.rank[0] || rank[0] === lead.rank[0] && rank[1] < lead.rank[1]) lead = { dial: di, window: wi, rank, tag: rank[0] === 0 ? '最快恢复' : rank[0] === 1 ? '最紧' : '' };
    }));
    const tiles = shown.map(item => { const tile = tileOf(item); return tile && { ...who(item), ...tile, title: name(item) + ' · ' + (tile.title || tile.note) }; }).filter(Boolean);
    const pills = shown.filter(item => !parts(item.quota).percent.length).map(item => { const tile = tiles.find(t => t.account === item.id); return { ...who(item), text: tile.empty ? tile.note : withUnit(tile.value, tile.unit), warn: tile.warn, title: tile.title }; });
    const old = shown.filter(item => item.quota && outdated(item.quota)).length;
    const nowSlide = dials.length ? { dials, lead, pills, stats: { agents: new Set(shown.map(item => item.agent)).size, total: caps.length, old } } : null;
    // 接下来: the lanes of a card stay together, the card with the most urgent lane first.
    const { lanes, silent } = lanesOf(shown, name), urgency = lane => lane.kind === 'out' ? -Infinity : lane.kind === 'stale' ? Infinity : lane.kind === 'expiry' ? lane.marks[0].at : lane.at;
    const groups = [];
    for (const lane of lanes) { const last = groups.at(-1); if (last && last.item === lane.item) last.lanes.push(lane); else groups.push({ item: lane.item, lanes: [lane] }); }
    for (const group of groups) { group.lanes.sort((a, b) => urgency(a) - urgency(b)); group.rank = urgency(group.lanes[0]); }
    groups.sort((a, b) => a.rank - b.rank);
    const LIMIT = 7; let count = 0; const visible = [], hidden = [];
    for (const group of groups) { if (context.allLanes || !visible.length || count + group.lanes.length <= LIMIT) { visible.push(group); count += group.lanes.length; } else hidden.push(group); }
    const full = context.prefs.measure === 'used' ? '0%' : '100%';
    const heroLane = (lane, first) => {
      const base = { ...who(lane.item), first, sub: lane.label, kind: lane.kind };
      if (lane.kind === 'stale') return base;
      if (lane.kind === 'expiry') return { ...base, sub: '积分到期', figure: lane.sum ? withUnit(decimal(lane.sum.item.remaining), lane.unit) : null, marks: lane.marks.map(mark => ({ at: mark.at, text: withUnit(mark.text, mark.value ? mark.unit : ''), after: mark.after === null ? null : withUnit(decimal(mark.after), mark.unit) })) };
      if (lane.kind === 'amount') return { ...base, at: lane.at, value: remainingText(lane.entry.item), after: known(lane.entry.item.total) ? withUnit(decimal(lane.entry.item.total, lane.entry.item.unit === 'currency'), unitOf(lane.entry.item)) : '已重置' };
      return { ...base, at: lane.at, value: lane.kind === 'out' ? '已耗尽' : lane.value.unknown ? '未知' : lane.value.text + '%', after: full };
    };
    const nextSlide = lanes.length ? { span: RANGES[context.prefs.range].span, ticks: ticksOf(context.prefs.range), ranges: Object.entries(RANGES).map(([key, range]) => ({ key, label: range.label, pressed: key === context.prefs.range })),
      lanes: visible.flatMap(group => group.lanes.map((lane, i) => heroLane(lane, i === 0))), silent: silent.map(who),
      more: hidden.length || context.allLanes && groups.length > 1 && count > LIMIT ? { open: Boolean(context.allLanes), count: hidden.reduce((n, group) => n + group.lanes.length, 0), faces: hidden.slice(0, 4).map(group => who(group.item)) } : null } : null;
    // 余额: one tile per balance; the credits of an account that expire step down on a chart.
    const credits = lanes.filter(lane => lane.kind === 'expiry' && lane.sum).map(lane => {
      const floor = addDecimals(lane.sum.reported.filter(entry => expiryOf(entry) === Infinity).map(entry => entry.item.remaining));
      let before = Number(lane.sum.item.remaining);
      // Expiries closer than about a diamond's width on the chart are one step.
      const end = Math.max(Date.now() + 30 * DAY, lane.marks.at(-1).at + 7 * DAY), near = (end - Date.now()) / 20, steps = [];
      for (const mark of lane.marks) { const last = steps.at(-1); if (last && mark.at - last.at < near) last.list.push(mark); else steps.push({ at: mark.at, list: [mark] }); }
      return { ...who(lane.item), unit: lane.unit, label: '按到期日递减', end, now: before, nowText: decimal(lane.sum.item.remaining), floor: Number(floor) || 0,
        marks: steps.map(({ at, list }) => { const last = list.at(-1), value = addDecimals(list.map(mark => mark.value || '0')), after = Number(last.after), entry = { at, until: list.length > 1 ? last.at : null, count: list.reduce((n, mark) => n + mark.count, 0), text: value ? decimal(value) : '', before, after, afterText: withUnit(decimal(last.after), lane.unit) }; before = after; return entry; }) };
    });
    const walletsSlide = tiles.length ? { tiles, credits } : null;
    return { now: nowSlide, next: nextSlide, wallets: walletsSlide, word: context.prefs.measure === 'used' ? '已用' : '剩余', slide: context.prefs.slide,
      clock, span, day: time => { const d = new Date(time); return d.getMonth() + 1 + '/' + d.getDate(); }, short: value => value >= 1e6 ? (value / 1e6).toFixed(1) + 'M' : value >= 1e4 ? Math.round(value / 1e3) + 'K' : Math.round(value).toLocaleString('zh-CN') };
  }
function summary() {
    const caps = new Map(capabilities().map(capability => [capability.provider, capability])), lines = [];
    for (const { key, item } of context.live || []) {
      if (context.prefs.hidden.includes(key) && !context.showHidden) continue;
      const { percent, money } = parts(item.quota), name = displayName(key, caps.get(item.agent)?.name || item.agent);
      const values = [...percent.map(entry => { const p = percentOf(entry.item), note = windowNote(entry.item); return entry.label + ' ' + (p.unknown ? '未知' : p.word + ' ' + p.text + (entry.item.state === 'unlimited' ? '' : '%')) + (note ? '（' + note + '）' : ''); }), ...money.map(entry => (entry.detail ? entry.label + ' ' + entry.detail : entry.label) + ' ' + amount(entry.item))];
      const sum = creditTotal(item, money); if (sum) values.unshift(sum.item.label + ' ' + amount(sum.item));
      if (item.members.length > 1 || item.row.duplicateKnown) values.push(sharedNote(item));
      lines.push(name + (item.members.length < 2 && item.alias && item.alias !== name ? ' · ' + item.alias : '') + '：' + (values.join('；') || '尚无额度观测') + ' — ' + age(item.quota));
    }
    return lines.length ? '额度摘要 · ' + new Date().toLocaleString('zh-CN', { hour12: false }) + '\n' + lines.join('\n') : '';
  }

function ladderView(sum){
 const now=Date.now(),groups=[[],[],[],[]];
 for(const entry of sum.reported){const end=expiryOf(entry);groups[end===Infinity?3:end-now<=7*DAY?0:end-now<=30*DAY?1:2].push(entry.item.remaining);}
 const counts=groups.map(list=>list.length),values=groups.map(list=>list.length?addDecimals(list):'0'),names=['7 天内到期','30 天内到期','更久','不限期'];
 const width=value=>Number(value)||0,all=values.reduce((total,value)=>total+width(value),0),soon=width(values[0])?decimal(values[0]):null;
 const title=values.map((value,i)=>names[i]+' '+decimal(value)).join(' · ');
 return{values,counts,names,width,all,soon,title,fractions:values.map(value=>all?width(value)/all:0)};
}
function resourceView(entry,grouped=false){
 const item=entry.item,p=item.unit==='percent'?percentOf(item):null,value=p?(p.unknown||item.state==='unlimited'?p.text:p.word+' '+p.text+'%'):exactAmount(item);
 const facts=[grouped&&entry.detail?entry.detail:null,LIFECYCLE[item.state]||'状态未知',FRESHNESS[item.freshness?.state],item.resetsAt?'重置 '+at(item.resetsAt):null,item.expiresAt?'有效至 '+at(item.expiresAt):null].filter(Boolean).join(' · ');
 const share=p?(p.unknown?null:p.value):known(item.remaining)&&known(item.total)&&Number(item.total)>0?Math.max(0,Math.min(100,Number(item.remaining)/Number(item.total)*100)):null;
 return{item,p,value,facts,share,fraction:share===null?null:share/100};
}
function factsView(account){
 const {percent,money}=parts(account.quota),now=Date.now(),total=figureOf(money)||creditTotal(account,money),leadPercent=percent[0]&&percentOf(percent[0].item);
 const leading=percent[0]?[percent[0].label,leadPercent.unknown||percent[0].item.state==='unlimited'?leadPercent.text:leadPercent.word+' '+leadPercent.text+'%']:total?[total.detail||total.label,remainingText(total.item)]:['额度',account.quota?'没有额度项':'尚未读取'];
 const events=[...percent.filter(entry=>!isStale(entry.item)&&Date.parse(entry.item.resetsAt)>now).map(entry=>({at:Date.parse(entry.item.resetsAt),text:entry.label+(BLOCKING.has(entry.item.state)?' 恢复':' 重置')})),...money.filter(entry=>Date.parse(entry.item.resetsAt)>now).map(entry=>({at:Date.parse(entry.item.resetsAt),text:entry.label+' 重置'})),...money.filter(entry=>usable(entry)&&expiryOf(entry)>now&&expiryOf(entry)<Infinity).map(entry=>({at:expiryOf(entry),text:entry.label+' 到期'}))].sort((a,b)=>a.at-b.at);
 return{leading,events};
}
function bodyView(account,compact){
 const quota=account.quota;if(!quota)return{kind:'unknown',more:0};const {percent,money}=parts(quota);
 if(!percent.length&&!money.length)return{kind:'empty',more:0};
 if(percent.length){
  if(compact)return{kind:'windows',meters:percent.slice(0,1),rows:[],more:percent.length-1+money.length};
  if(account.agent==='opencode'&&percent.length>=2)return{kind:'rings',rings:percent.slice(0,2),third:percent[2],more:Math.max(0,percent.length-3)+money.length};
  // A model's own limit inside a window (Claude's Fable in 每周) is a line under that window, not another bar.
  const spanOnly=entry=>entry.label===duration(entry.item.durationMins),inside=percent.filter(entry=>!spanOnly(entry)&&entry.item.durationMins&&percent.some(other=>spanOnly(other)&&other.item.durationMins===entry.item.durationMins)).slice(0,2);
  const rest=percent.filter(entry=>!inside.includes(entry)),timed=rest.every(entry=>entry.item.durationMins),sorted=timed?[...rest].sort((a,b)=>b.item.durationMins-a.item.durationMins):rest;
  if(sorted.length===1&&!inside.length&&!money.length)return{kind:'single',entry:sorted[0],resetCredits:quota.resetCredits??null,more:0};
  const meters=(sorted.length>2?sorted.slice(0,1):sorted.slice(0,2)).map(entry=>({...entry,inside:inside.filter(part=>part.item.durationMins===entry.item.durationMins)})),rows=sorted.length>2?sorted.slice(1,3):[],extra=rows.length?null:money[0];
  return{kind:'windows',thick:account.agent==='zcode',meters,rows,extra,more:percent.length-inside.length-meters.length-rows.length+money.length-(extra?1:0)};
 }
 const sum=creditTotal(account,money),total=figureOf(money)||sum,rest=money.filter(entry=>entry!==total);
 if(!total){const rows=rest.slice(0,compact?1:3);return{kind:'money-rows',rows,more:rest.length-rows.length};}
 const tickets=compact?[]:rest.filter(entry=>usable(entry)||!usable(total)).sort((a,b)=>expiryOf(a)-expiryOf(b)).slice(0,2);
 const filled=tickets.filter(part=>Number(part.item.remaining)>0),all=filled.reduce((n,part)=>n+Number(part.item.remaining),0),composition={title:'组成：'+tickets.map(part=>part.label+' '+remainingText(part.item)).join('，'),segments:filled.map(part=>({key:part.pool.id+'/'+part.item.id,value:all?Number(part.item.remaining)/all:0,label:part.label+' '+remainingText(part.item)}))};return{kind:'wallet',sum,total,tickets,composition,more:rest.length-tickets.length};
}
function resourcesView(account,capability){
 const all=parts(account.quota),entries=[...all.percent,...all.money];if(!entries.length)return[];
 if(!all.percent.length&&all.money.length>6){
  const now=Date.now(),soon=[],open=[],closed=[];for(const entry of all.money)(!usable(entry)||entry.item.id==='frozen'?closed:expiryOf(entry)-now<=7*DAY?soon:open).push(entry);
  const byEnd=(a,b)=>expiryOf(a)-expiryOf(b);soon.sort(byEnd);open.sort(byEnd);
  const sum=items=>{const value=items.every(entry=>known(entry.item.remaining))?addDecimals(items.map(entry=>entry.item.remaining)):null;return items.length+' 个'+(value===null?'':' · '+decimal(value)+(unitOf(items[0].item)?' '+unitOf(items[0].item):''));};
  return[{title:'7 天内到期',items:soon,limit:6},{title:'可用',items:open,limit:5},{title:'已到期、冻结或不可用 · '+closed.length+' 个',items:closed,limit:closed.length,closed:true}].filter(g=>g.items.length).map(g=>({...g,grouped:true,summary:g.closed?null:sum(g.items)}));
 }
 const byPool=new Map();for(const entry of entries){if(!byPool.has(entry.pool.id))byPool.set(entry.pool.id,{pool:entry.pool,items:[]});byPool.get(entry.pool.id).items.push(entry);}
 return[...byPool.values()].map(group=>({title:group.pool.label===capability.provider?capability.name:group.pool.label||group.pool.id,items:group.items,limit:8,grouped:false}));
}
function gridView(){
 const caps=capabilities(),list=accounts(),connected=[],idle=[];
 for(const capability of caps){const items=cardsOf(list.filter(account=>account.agent===capability.provider));if(items.length)for(const item of items)connected.push({key:item.key,warn:Boolean(item.status.warn),item,capability,many:items.length>1});else idle.push({key:idleKey(capability.provider),capability});}
 const live=ordered(connected),visible=item=>context.showHidden||!context.prefs.hidden.includes(item.key),hiddenCount=[...live,...idle].filter(item=>context.prefs.hidden.includes(item.key)).length,shown=live.filter(visible),filtered=shown.filter(FILTERS[context.prefs.filter].match);
 return{caps,list,live,idle,hiddenCount,shown,filtered,visibleIdle:idle.filter(visible),hero:heroModel(caps,shown.map(e=>e.item)),warned:list.filter(account=>account.status.warn)};
}
function mergeOrder(live,shownKeys){const set=new Set(shownKeys),queue=[...shownKeys];return live.map(item=>set.has(item.key)?queue.shift():item.key);}
function needleView(m,at){let resets=0,expiring=0;const now=Date.now(),offset=Math.max(0,Math.min(m.next.span,at-now)),rows=m.next.lanes.map(lane=>{let big,small,done=false;if(lane.kind==='stale'){big='待刷新';small='';}else if(lane.kind==='expiry'){const gone=lane.marks.filter(mark=>mark.at<=at);expiring+=gone.length;const next=lane.marks.find(mark=>mark.at>at);big=gone.length?gone.at(-1).after??null:lane.figure??null;small=next?m.clock(next.at)+' −'+next.text:'没有更多到期';done=gone.length>0;}else if(lane.at<=at){resets++;done=true;big=lane.after;small=m.clock(lane.at);}else{big=lane.value;small=m.span(lane.at-at)+'后';}return{big,small,done};});return{rows,resets,expiring,big:offset<60000?'现在':'+'+m.span(offset),sub:m.clock(at),valueText:(offset<60000?'现在':m.clock(at))+'，'+resets+' 个窗口已重置'};}
function stepLabels(m,c,now=Date.now()){const top=Math.max(c.now,1);return{ticks:[0,.5,1].map(f=>({value:top*f,label:m.short(top*f)})),axis:Array.from({length:5},(_,i)=>{const at=now+(c.end-now)*i/4;return{at,label:i===0?'今天':m.day(at)};})};}
function creditRead(m,c,index){const mark=index===null?null:c.marks[index],first=c.marks[0];return{number:mark?mark.text:c.nowText,unit:mark?c.unit+'到期':c.unit,when:mark?m.clock(mark.at)+(mark.until?' – '+m.day(mark.until):''):first?m.clock(first.at):'',note:mark?mark.count+' 个 · 之后 '+mark.afterText:first?'−'+first.text:''};}
function fixView(account,capability){if(account.agent==='codex')return{action:'details',label:'查看'};if(account.row.passive)return{action:'passive-guide',label:'复制状态栏配置'};if(account.row.credentialRetryable)return{action:'refresh',label:'重试恢复'};if(account.row.credentialReady===false)return{action:'credential',label:capability?.adapters?.some(adapter=>adapter.clientLogin||adapter.websiteLogin)?'重新连接':'重新提供凭据'};return{action:'refresh',label:'重试'};}
function toolbarView(snapshot){const {state,providerBatch}=snapshot,codexBatch=state.accounts.length?state.lastBatch:null,otherBatch=state.lastProviderBatch||providerBatch,batch=codexBatch||otherBatch?['success','failed','skipped'].reduce((sum,key)=>({...sum,[key]:(codexBatch?.[key]||0)+(otherBatch?.[key]||0)}),{}):null;return{batch};}

// Original quota-cards bar/meter and quota-hero readNow projections, without DOM.
function barView(entry,mini=false){const item=entry.item,p=percentOf(item),stale=isStale(item),left=mini?null:timeLeft(item),percent=left===null?null:context.prefs.measure==='used'?100-left*100:left*100;return{item,p,stale,left,fraction:p.unknown?null:p.value/100,tickAt:percent===null?null:Number(percent.toFixed(1))/100,tickLabel:percent===null?null:'时间'+(context.prefs.measure==='used'?'已过 ':'还剩 ')+Math.round(percent)+'%'};}
function meterView(entry){const item=entry.item,p=percentOf(item),rhythm=pace(item),note=windowNote(item),stale=note==='待刷新',blocked=BLOCKING.has(item.state),word=p.unknown||item.state==='unlimited';return{item,p,rhythm,note,stale,blocked,word,noteTitle:item.resetsAt?'重置 '+at(item.resetsAt):note};}
function nowView(m,w){return{until:w.at===null?'':m.span(w.at-Date.now()),when:w.at===null?'':m.clock(w.at)+(w.state==='out'?' 恢复':' 重置'),timePercent:w.time===null?null:w.time*100,timeFraction:w.time,quotaFraction:w.value===null?null:w.value/100,timeText:w.time===null?'':Math.round(w.time*100)+'%'};}

return Object.freeze({parsePrefs,logo,dateFormat,timeFormat,at,LIFECYCLE,FRESHNESS,BLOCKING,UNITS,NAMES,KINDS,DAY,STALE_AFTER,RANGES,FILTERS,WEEKDAYS,unitOf,known,exactAmount,remainingText,short,itemName,ROLE,isStale,SPENDABLE,expiryOf,usable,outdated,brief,idleKey,displayName,withUnit,decimal,amount,duration,clock,windowLabel,fromV1,parts,percentOf,windowNote,moneyNote,timeLeft,pace,addDecimals,creditTotal,figureOf,age,providerStatus,capabilities,accounts,cardsOf,duplicateNote,sharedNote,ordered,span,lanesOf,ticksOf,heroWindow,tileOf,heroModel,summary,ladderView,resourceView,factsView,bodyView,resourcesView,gridView,mergeOrder,needleView,stepLabels,creditRead,fixView,toolbarView,barView,meterView,nowView});}
function createControls(context,window){const {example,bridge}=context;
const statuses = { ready: '已更新', cached: '上次缓存', refreshing: '正在刷新', error: '读取失败 · 保留上次结果', 'login-required': '需要重新登录', 'login-failed': '登录未完成', connecting: '等待官方授权' };
const errors = { LOGIN_REQUIRED: '需要重新登录', CODEX_REQUEST_TIMEOUT: '读取超时', RATE_LIMITED: '服务限流 · 15 分钟冷却', CODEX_EXECUTABLE_REQUIRED: '请选择官方 CLI', CODEX_PROCESS_UNAVAILABLE: 'CLI 无法启动', SYSTEM_CREDENTIAL_STORE_REQUIRED: '系统凭据存储不可用', CODEX_PROTOCOL_INVALID: '服务响应无效', CODEX_PROTOCOL_LIMIT: '服务响应超限', CODEX_REQUEST_FAILED: '服务读取失败 · 60 秒冷却' };
function accountStatus(account) {
    return account.errorCode ? errors[account.errorCode] || '操作未完成' : account.duplicateKnown ? '重复连接 · 额度不可叠加' : ['ready', 'cached'].includes(account.status) ? window.connectionState.quotaLabel(window.connectionState.quotaFreshness(account)) : statuses[account.status] || '待连接';
  }
function disabledRefresh(account) { return !bridge || example || account.busy || Date.parse(account.nextRefreshAt) > Date.now() || account.status === 'connecting'; }
return Object.freeze({accountStatus,disabledRefresh});}
return Object.freeze({create,parsePrefs,createControls});
});
