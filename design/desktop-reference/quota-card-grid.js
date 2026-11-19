'use strict';
// 额度监控的账号卡片（所有者 2026-10-27：卡片保持原样）。The quota page moved to the React layer, but
// its approved account cards retain their leaf DOM: this module owns card rendering and card-moving
// code, unchanged apart from where the state comes from (window.quotaHost, the same host the React
// page reads) and where the details and connection sheets open (window.quotaUi, the React page).
// Cards render into #quotaCards between the page's two React islands. Shapes, ownership rules and
// owner decisions: UI-QUOTA-V4-CARDS-20261022.md, UI-QUOTA-GROUPS-20261023.md, UI-QUOTA-PAGE-20261027.md.
(() => {
  const host = window.quotaHost; if (!host) return;
  const model = host.model, prefs = () => host.get().prefs;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => '<img src="assets/ui/' + name + '.svg" alt="">';
  const logo = model.logo;
  const at = model.at;
  const LIFECYCLE = model.LIFECYCLE;
  const BLOCKING = model.BLOCKING;
  const DAY = model.DAY;
  // Which connected cards the page shows; hidden cards stay hidden whatever the filter.

  // A reported decimal string for reading: digit groups and at most two decimals (currency always
  // two), rounded on the digits themselves so large values are never passed through a float.
  function decimal(value, currency) {return model.decimal(value,currency);}
  const unitOf = model.unitOf;
  const known = model.known;
  // "1,200 / 1,300 积分", "未知", "无限"; exact: the reported strings.
  function amount(item, exact) {return model.amount(item,exact);}
  const exactAmount = model.exactAmount;
  // Only the remaining part, for places too narrow for "remaining / total".
  const remainingText = model.remainingText;

  // Percentage windows, and every amount (amount windows and balances) in reading order. Several
  // pools of one Agent are named by their own label (WorkBuddy package names), never by pool id.
  function parts(quota) {return model.parts(quota);}
  // The figure the remaining/used switch asks for; unknown stays unknown.
  function percentOf(item) {return model.percentOf(item);}
  // Past its reset the observed value is stale, whatever it said: it needs a refresh, not a verdict.
  const isStale = model.isStale;
  // Under the window name: when it resets, or why it cannot be used.
  function windowNote(item) {return model.windowNote(item);}
  function moneyNote(entry) {return model.moneyNote(entry);}
  // How much of the window's time is left (0–1), when the service reports both its length and reset.
  function timeLeft(item) {return model.timeLeft(item);}
  // An estimate, labelled as one: the share of quota left against the share of time left, once a
  // tenth of the window has passed. It never colours usage as good or bad.
  function pace(item) {return model.pace(item);}
  // What a card is called: the short name where the catalogue's is long; all cards show their titles cleanly.
  const CARD_NAMES = { deepseek: 'DeepSeek', copilot: 'Copilot' };
  const CASH = { USD: '$', CNY: '¥' };
  // The same tones the app's other marks take (kit/data-display.tsx), so a black mark reads on a dark card.
  const MARK_TONE = { claude: ' ff-mark-claude', codex: ' ff-mark-mono', opencode: ' ff-mark-mono', cursor: ' ff-mark-mono', mimo: ' ff-mark-mono', copilot: ' ff-mark-mono', pi: ' ff-mark-mono', continue: ' ff-mark-mono' };
  const cash = item => item.unit === 'currency' && CASH[item.currency] && known(item.remaining) && item.state !== 'unlimited' ? CASH[item.currency] + decimal(item.remaining, true) : remainingText(item);
  const long = value => value.length > 16 ? ' data-long="more"' : value.length > 9 ? ' data-long' : '';
  const segments = (count, percent) => '<span class="quota-track" aria-hidden="true">' + '<i></i>'.repeat(count) + '</span><span class="quota-fill" aria-hidden="true" style="clip-path:inset(0 ' + (100 - (percent ?? 0)) + '% 0 0)">' + '<i></i>'.repeat(count) + '</span>';
  function bar(entry, count = 30, mini = false, marker = false) {
    const item = entry.item, p = percentOf(item), stale = isStale(item), solid = count === 1, left = marker ? timeLeft(item) : null;
    // The marker (on the solid bars that have one, as in the GLM reference) shows how much time is left (remaining) or has passed (used), on the same scale.
    const tick = left === null ? '' : '<span class="quota-tick" style="left:' + (prefs().measure === 'used' ? 100 - left * 100 : left * 100).toFixed(1) + '%" title="时间' + (prefs().measure === 'used' ? '已过 ' + Math.round(100 - left * 100) : '还剩 ' + Math.round(left * 100)) + '%"></span>';
    return '<div class="quota-segments' + (solid ? ' is-solid' : '') + (mini ? ' is-mini' : '') + (p.unknown ? ' unknown' : stale ? ' is-stale' : p.low && item.state !== 'unlimited' ? ' low' : '') + '" role="progressbar" aria-label="' + esc(entry.label) + ' ' + p.word + '"' + (p.unknown ? ' aria-valuetext="未知"' : ' aria-valuenow="' + p.value + '" aria-valuemin="0" aria-valuemax="100"') + ' data-percent="' + (p.value ?? '') + '">' + segments(count, p.value) + tick + '</div>';
  }
  function meter(entry, thick = false) {
    const item = entry.item, p = percentOf(item), rhythm = pace(item), note = windowNote(item), stale = note === '待刷新', blocked = BLOCKING.has(item.state), word = p.unknown || item.state === 'unlimited';
    const noteHtml = note ? '<span class="quota-reset' + (blocked || stale ? ' is-blocked' : '') + '" title="' + esc(item.resetsAt ? '重置 ' + at(item.resetsAt) : note) + '">' + (item.resetsAt && !blocked && !stale ? icon('history') : '') + '<span>' + esc(note) + '</span></span>' : '';
    // The figure reads as remaining, as in the references; the other reading says so. Pace is in the tooltip.
    const measure = prefs().measure === 'used' ? '<small>' + p.word + ' </small>' : '';
    const inside = (entry.inside || []).map(part => { const v = percentOf(part.item); return part.label + ' ' + v.word + ' ' + (v.unknown ? v.text : v.text + '%'); }).join(' · ');
    const insideHtml = inside ? '<span class="quota-inside">' + esc(inside) + '</span>' : '';
    if (thick) return '<div class="quota-meter is-thick" data-key="' + esc(entry.pool.id + '/' + item.id) + '"' + (rhythm ? ' title="' + esc(rhythm.word + ' · ' + rhythm.title) + '"' : '') + '><div class="quota-meter-head"><b>' + esc(entry.label) + '</b><strong class="quota-figure is-compact' + (stale ? ' is-muted' : '') + '">' + measure + esc(p.text) + (word ? '' : '%') + '</strong></div>' + bar(entry, 1, false, true) + noteHtml + insideHtml + '</div>';
    return '<div class="quota-meter" data-key="' + esc(entry.pool.id + '/' + item.id) + '"' + (rhythm ? ' title="' + esc(rhythm.word + ' · ' + rhythm.title) + '"' : '') + '><div class="quota-meter-head"><div class="quota-meter-name"><span class="quota-meter-title"><b>' + esc(entry.label) + '</b></span>' + noteHtml + insideHtml + '</div><strong class="quota-figure' + (word ? ' is-word' : '') + (stale ? ' is-muted' : '') + '">' + measure + esc(p.text) + (word ? '' : '<small>%</small>') + '</strong></div>' + bar(entry) + '</div>';
  }
  // A connection that reports one window: what is used and left, when it resets, and the resets it has in hand.
  function single(view) {
    const entry = view.entry, item = entry.item, p = percentOf(item), note = windowNote(item), word = p.unknown || item.state === 'unlimited', stale = note === '待刷新', blocked = BLOCKING.has(item.state);
    const remaining = Number.isFinite(item.remainingPercent) ? item.remainingPercent : null, used = Number.isFinite(item.usedPercent) ? item.usedPercent : remaining === null ? null : 100 - remaining, figure = value => value === null ? '未知' : value.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + '%';
    const fact = (name, value, warn) => '<div><dt>' + icon('history') + '<span>' + name + '</span></dt><dd' + (warn ? ' class="is-blocked"' : '') + '>' + esc(value) + '</dd></div>';
    return '<div class="quota-single" data-key="' + esc(entry.pool.id + '/' + item.id) + '"><div class="quota-meter-head"><b>' + esc(entry.label) + '</b><strong class="quota-figure is-strong' + (word ? ' is-word' : '') + (stale ? ' is-muted' : '') + '">' + (prefs().measure === 'used' ? '<small>' + p.word + ' </small>' : '') + esc(p.text) + (word ? '' : '%') + '</strong></div>' + bar(entry, 1) + (item.state === 'unlimited' ? '' : '<div class="quota-split"><span>已用<b>' + esc(figure(used)) + '</b></span><span>剩余<b>' + esc(figure(remaining)) + '</b></span></div>') + '<dl class="quota-facts">' + (note ? fact(item.resetsAt && !blocked && !stale ? '重置时间' : '状态', note, blocked || stale) : '') + (Number.isSafeInteger(view.resetCredits) ? fact('重置次数', view.resetCredits + 'x') : '') + '</dl></div>';
  }
  // Further windows as compact rows under the first (the Cursor reference's API / model rows).
  function subrow(entry) {
    const p = percentOf(entry.item);
    return '<div class="quota-subrow" data-key="' + esc(entry.pool.id + '/' + entry.item.id) + '"><span>' + esc(entry.label) + '</span>' + bar(entry, 16, true) + '<b>' + esc(p.unknown || entry.item.state === 'unlimited' ? p.text : p.text + '%') + '</b></div>';
  }
  function row(entry) {
    const note = moneyNote(entry), detail = [entry.detail, note].filter(Boolean).join(' · ');
    return '<div class="quota-wallet-row" data-key="' + esc(entry.pool.id + '/' + entry.item.id) + '"><span><em title="' + esc(entry.item.label || entry.label) + '">' + esc(entry.label) + '</em>' + (detail ? '<small>' + esc(detail) + '</small>' : '') + '</span><b title="' + esc(exactAmount(entry.item)) + '"' + (BLOCKING.has(entry.item.state) || entry.item.availability === 'unavailable' ? ' class="is-muted"' : '') + '>' + esc(amount(entry.item)) + '</b></div>';
  }
  const expiryOf = model.expiryOf;
  // How the summed credits run out: within 7 days, within 30, later, and without an end date. The
  // widths are proportions for the eye; the figures beside them are exact decimal sums.
  function ladder(sum) {
    const {values,width,all,title,soon}=model.ladderView(sum);if(!all)return'';sum.soon=soon;
    return '<span class="quota-ladder" role="img" aria-label="' + esc(title) + '" title="' + esc(title) + '">' + values.map((value, i) => width(value) ? '<i class="is-' + i + '" style="flex:' + width(value) + '"></i>' : '').join('') + '</span>';
  }
  function figure(entry, extra = '') {
    const item = entry.item, unit = CASH[item.currency] ? '' : unitOf(item), value = item.state === 'unlimited' ? '无限' : known(item.remaining) ? (CASH[item.currency] || '') + decimal(item.remaining, item.unit === 'currency') : '未知';
    const label = (entry.detail || entry.label) + (BLOCKING.has(item.state) ? ' · ' + LIFECYCLE[item.state] : '');
    return '<div class="quota-wallet-total"><small title="' + esc(item.label || entry.label) + '">' + esc(label) + '</small><strong title="' + esc(exactAmount(item)) + '"' + long(value) + '>' + esc(value) + (known(item.remaining) && unit && item.state !== 'unlimited' ? ' <small>' + esc(unit) + '</small>' : '') + '</strong>' + extra + (known(item.total) ? '<span>共 ' + esc(decimal(item.total, item.unit === 'currency')) + (unit ? ' ' + esc(unit) : '') + '</span>' : '') + '</div>';
  }
  // The pocket the slips stand in (UI-QUOTA-GROUPS-20261023.md). Its mouth dips at the centre like a
  // card holder's thumb cut, and no words sit on the curve: the first line names the total and, on
  // the right, what it covers or, when the total cannot be used, its state as a badge. Under the
  // figure a bar shows how it is made up: summed credits by when they run out, or the reported parts
  // in the slips' own colours.
  function pocketFigure(entry, account, sum, parts) {
    const item = entry.item, unit = CASH[item.currency] ? '' : unitOf(item), value = item.state === 'unlimited' ? '无限' : known(item.remaining) ? (CASH[item.currency] || '') + decimal(item.remaining, item.unit === 'currency') : '未知';
    const state = BLOCKING.has(item.state) ? LIFECYCLE[item.state] : item.availability === 'unavailable' ? '不可用' : '';
    const complete = account.row?.adapter === 'workbuddy-desktop' && account.quota?.incomplete === false;
    // 2026-10-27 (owner): no explanatory small print on cards. A partial list still says so; the
    // details sheet lists what expires.
    const meta = state ? '<span class="quota-badge is-warn">' + esc(state) + '</span>' : sum && !complete ? '<span class="quota-pocket-meta">已返回的 ' + sum.reported.length + ' 个积分包</span>' : '';
    let bar = '';
    if (sum) { const steps = ladder(sum); if (steps) bar = steps; }
    else {
      const filled = parts.filter(part => Number(part.item.remaining) > 0), title = '组成：' + parts.map(part => part.label + ' ' + remainingText(part.item)).join('，');
      if (filled.length > 1) bar = '<span class="quota-ladder is-parts" role="img" aria-label="' + esc(title) + '" title="' + esc(title) + '">' + filled.map(part => '<i class="is-part-' + parts.indexOf(part) + '" style="flex:' + Number(part.item.remaining) + '"></i>').join('') + '</span>';
    }
    const lip = '<svg class="quota-pocket-lip" viewBox="0 0 320 20" preserveAspectRatio="none" aria-hidden="true"><path d="M0 20V12Q0 0 12 0H104C130 0 136 9 160 9C184 9 190 0 216 0H308Q320 0 320 12V20Z"/></svg>';
    return '<div class="quota-wallet-total quota-pocket">' + lip + '<div class="quota-pocket-head"><small title="' + esc(item.label || entry.label) + '">' + esc(entry.label) + '</small>' + meta + '</div><strong title="' + esc(exactAmount(item)) + '"' + long(value) + '>' + esc(value) + (known(item.remaining) && unit && item.state !== 'unlimited' ? ' <small>' + esc(unit) + '</small>' : '') + '</strong>' + (known(item.total) ? '<span>共 ' + esc(decimal(item.total, item.unit === 'currency')) + (unit ? ' ' + esc(unit) : '') + '</span>' : '') + (bar ? '<div class="quota-pocket-bar">' + bar + '</div>' : '') + '</div>';
  }
  // A part of the balance shown above the pocket (the DeepSeek reference's tickets).
  // A slip carries only its name and amount, as in the reference; when it runs out is in its tooltip.
  function ticket(entry, index) {
    const soon = expiryOf(entry) - Date.now() <= 7 * DAY, note = moneyNote(entry);
    return '<div class="quota-ticket' + (index ? ' is-second' : ' is-first' + (soon ? ' is-soon' : '')) + '" data-key="' + esc(entry.pool.id + '/' + entry.item.id) + '" title="' + esc([entry.item.label || entry.label, note].filter(Boolean).join(' · ')) + '"><span><em>' + esc(entry.label) + '</em></span><b title="' + esc(exactAmount(entry.item)) + '">' + esc(cash(entry.item)) + '</b></div>';
  }
  function wallet(account, money, compact) {const v=model.bodyView(account,compact);if(v.kind==='money-rows')return{html:'<div class="quota-wallet is-rows"><div class="quota-wallet-rows">'+v.rows.map(row).join('')+'</div></div>',more:v.more};const{sum,total,tickets}=v;const front=tickets.length?pocketFigure(total,account,sum,tickets):figure(sum&&sum.soon?{...total,label:total.label+' · 7 天内到期 '+sum.soon+' 积分'}:total,sum&&!compact?ladder(sum):'');return{html:'<div class="quota-wallet'+(tickets.length?' is-pocket':'')+'">'+(tickets.length?'<div class="quota-tickets">'+tickets.map(ticket).join('')+'</div>':'')+front+'</div>',more:v.more};}
  // A window as one line and a thin bar (OpenCode Go's monthly window in the owner's reference).
  function thin(entry) {
    const p = percentOf(entry.item), note = windowNote(entry.item);
    return '<div class="quota-thin" data-key="' + esc(entry.pool.id + '/' + entry.item.id) + '"><span><b>' + esc(entry.label) + '</b> ' + esc(p.unknown || entry.item.state === 'unlimited' ? p.text : p.text + '%') + '</span>' + (note ? '<small>' + esc(note) + '</small>' : '') + bar(entry, 30, true) + '</div>';
  }
  // OpenCode Go reports its windows as rings in the owner's reference: two rings and a monthly bar.
  function ring(entry) {
    const item = entry.item, p = percentOf(item), r = 31, c = 2 * Math.PI * r, note = windowNote(item);
    return '<div class="quota-ring' + (isStale(item) ? ' is-stale' : p.low ? ' low' : '') + '" role="progressbar" aria-label="' + esc(entry.label) + ' ' + p.word + '"' + (p.unknown ? ' aria-valuetext="未知"' : ' aria-valuenow="' + p.value + '" aria-valuemin="0" aria-valuemax="100"') + '><span class="quota-ring-dial"><svg viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="' + r + '"/>' + (p.unknown ? '' : '<circle class="quota-ring-fill" cx="36" cy="36" r="' + r + '" stroke-dasharray="' + (p.value / 100 * c).toFixed(1) + ' ' + c.toFixed(1) + '"/>') + '</svg><b>' + esc(p.unknown ? '未知' : p.text + '%') + '</b></span><span class="quota-ring-name">' + esc(entry.label) + '</span>' + (note ? '<small>' + esc(note) + '</small>' : '') + '</div>';
  }
  // The card body and how many items only the sheet shows. A connection that needs action shows the
  // problem first and keeps only its leading figure, dimmed, so the last reading is still visible.
  function body(account, compact) {const v=model.bodyView(account,compact);if(v.kind==='unknown')return{html:compact?'':empty('还没有读到额度',account,false),more:0};if(v.kind==='empty')return{html:compact?'':empty('已连接，没有额度项',account,true),more:0};if(v.kind==='rings')return{html:'<div class="quota-rings">'+v.rings.map(ring).join('')+'</div>'+(v.third?thin(v.third):''),more:v.more};if(v.kind==='single')return{html:single(v),more:0};if(v.kind==='windows')return{html:'<div class="quota-meters'+(v.thick?' is-thick':'')+'">'+v.meters.map(entry=>meter(entry,v.thick)).join('')+'</div>'+(v.rows.length?'<div class="quota-subrows">'+v.rows.map(subrow).join('')+'</div>':'')+(v.extra?'<div class="quota-extra" data-key="'+esc(v.extra.pool.id+'/'+v.extra.item.id)+'"><span title="'+esc(v.extra.item.label||v.extra.label)+'">'+esc(v.extra.label)+'</span><b title="'+esc(exactAmount(v.extra.item))+'">'+esc(amount(v.extra.item))+'</b></div>':''),more:v.more};return wallet(account,parts(account.quota).money,compact);}
  function empty(title, account, hideable) {
    return '<div class="quota-empty"><span class="quota-ghost" aria-hidden="true">' + '<i></i>'.repeat(24) + '</span><b>' + esc(title) + '</b><div class="quota-empty-actions">' + retry(account, '重新读取') + (hideable ? '<button class="quota-soft-button" data-card-hide="' + esc(account.key) + '">隐藏此卡</button>' : '') + '</div></div>';
  }
  function age(quota) {return model.age(quota);}
  const outdated = model.outdated;
  // The first clause of a service message ("登录已过期，请重新连接。" → "登录已过期"); the full text stays in the title.
  const brief = model.brief;
  const displayName = model.displayName;
  // A shared card names every connection it stands for.
  function sharedNote(item) {return model.sharedNote(item);}
  // A second way to read a connection again, inside the card body; the head's age button stays the
  // card's own refresh control.
  const retry = (account, label) => '<button class="quota-soft-button" data-retry="' + (account.agent === 'codex' ? 'codex' : 'provider') + '" data-id="' + esc(account.id) + '"' + (account.refresh.disabled ? ' disabled' : '') + '>' + label + '</button>';
  // The one action that fixes a connection: sign in again, set up the passive export, retry, or
  // (Codex) its sheet.
  function fix(account, capability) {const v=model.fixView(account,capability);if(v.action==='details')return'<button class="quota-soft-button" data-quota-sheet="codex" data-account="'+esc(account.id)+'">'+v.label+'</button>';if(v.action==='refresh')return retry(account,v.label);return'<button class="quota-soft-button'+(v.action==='credential'?' is-primary':'')+'" data-provider-action="'+v.action+'" data-id="'+esc(account.id)+'">'+v.label+'</button>';}
  function problem(card, capability) {
    const failing = card.members.find(member => member.status.warn) || card, reason = failing.status.title || failing.status.text;
    return '<div class="quota-problem"><div><b title="' + esc(reason) + '">' + esc(brief(reason)) + '</b>' + (card.quota ? '' : '<span>还没有读到额度</span>') + '</div>' + fix(failing, capability) + '</div>';
  }
  function card(capability, item, many, indexInProvider) {
    const key = item.key, name = esc(displayName(key, CARD_NAMES[capability.provider] || capability.name)), hidden = prefs().hidden.includes(key), merged = item.members.length > 1;
    const plan = '<span class="quota-plan-slot">' + (item.plan ? '<span class="quota-plan" title="' + esc(item.plan) + '">' + esc(String(item.plan).toUpperCase()) + '</span>' : '') + '</span>';
    const head = '<header class="quota-card-head"><img class="quota-card-logo' + (MARK_TONE[capability.provider] || '') + '" src="' + logo(capability.provider) + '" alt=""><h3>' + name + '</h3>' + plan + '<button class="quota-age' + (outdated(item.quota) ? ' is-old' : '') + '" ' + (item.agent === 'codex' ? 'data-quota-refresh="' + esc(item.lead.id) + '"' : 'data-provider-action="refresh" data-id="' + esc(item.lead.id) + '"') + ' aria-label="刷新 ' + name + ' 额度" title="最近成功 ' + esc(at(item.quota?.fetchedAt)) + '"' + (item.refresh.disabled ? ' disabled' : '') + '>' + icon('refresh') + '<span>' + esc(age(item.quota)) + '</span></button></header>';
    // Only where it tells cards apart: connections sharing one card, or one of several accounts.
    // When several accounts share one provider, ensure each card has a clear unique alias/account tag.
    const customAlias = item.alias && item.alias.toLowerCase() !== String(CARD_NAMES[capability.provider] || capability.name).toLowerCase() ? item.alias : '';
    const fallbackAlias = many ? (customAlias || '账号 ' + (indexInProvider || 1)) : customAlias;
    const subtitle = merged ? item.members.length + ' 个连接 · 同一账号' : fallbackAlias;
    const alias = subtitle ? '<p class="quota-alias" title="' + esc(merged ? sharedNote(item) : subtitle) + '">' + esc(subtitle) + '</p>' : '';
    const mark = '<img class="quota-card-mark" src="' + logo(capability.provider) + '" alt="" aria-hidden="true">';
    // A shared card keeps its full reading while one of its connections still reads; the footer and
    // the attention line name the one that needs action.
    const warn = item.status.warn, compact = Boolean(item.lead.status.warn), content = body(item, compact), status = item.status, statusTitle = [status.title || status.text, sharedNote(item)].filter(Boolean).join(' · ');
    return '<article class="card quota-card' + (warn ? ' needs-action' : '') + '" tabindex="0" data-key="' + esc(key) + '" data-provider-row="' + esc(capability.provider) + '" data-connection="' + esc(item.id) + '" data-connections="' + esc(item.members.map(member => member.id).join(' ')) + '" data-card-key="' + esc(key) + '"' + (hidden ? ' data-hidden-card' : '') + (item.busy ? ' aria-busy="true"' : '') + '>' + head + alias + '<div class="quota-card-body">' + (compact ? problem(item, capability) : '') + (content.html ? '<div class="quota-card-content' + (compact ? ' is-dim' : '') + '">' + content.html + '</div>' : '') + '</div><footer class="quota-card-foot' + (!warn && !compact && !(content.more > 0) && status.text === '已更新' ? ' is-quiet' : '') + '"><span class="quota-status' + (warn ? ' is-warn' : '') + '" title="' + esc(statusTitle) + '">' + esc(compact ? '需要处理' : status.text) + '</span><button class="quota-sheet-open" data-quota-sheet="' + esc(capability.provider) + '" data-account="' + esc(item.id) + '" data-quota-details="' + esc(item.id) + '" aria-label="账号详情">' + (content.more > 0 ? '另 ' + content.more + ' 项 · ' : '') + '详情</button></footer>' + mark + '</article>';
  }

  // ── Rendering ────────────────────────────────────────────────────────────────────────────────
  let renderedKey = null, renderFrame = 0, drag = null, landing = false;
  function inputKey() {
    const snapshot = host.get(), display = { ...snapshot.prefs }; delete display.slide; delete display.range;
    return JSON.stringify([host.gridVersion(), display, snapshot.showHidden, Math.floor(Date.now() / 30000)]);
  }
  function render() {
    cancelAnimationFrame(renderFrame); renderFrame = 0;
    // A card being dragged keeps the grid as the pointer arranges it; the page catches up on drop.
    // The same holds while a dropped card settles: the flying card and its placeholder are still in
    // the grid, and rebuilding the list underneath them would strand both.
    if (drag || landing) return;
    if ($('quota').hidden || document.hidden) return;
    const key = inputKey(); if (key === renderedKey) return;
    const grid = model.gridView();
    const providerCounts = new Map();
    const decorate = entry => {
      const p = entry.capability.provider;
      const cur = (providerCounts.get(p) || 0) + 1;
      providerCounts.set(p, cur);
      return { ...entry, html: card(entry.capability, entry.item, entry.many, cur) };
    };
    const shown = grid.shown.map(decorate);
    providerCounts.clear();
    const filtered = grid.filtered.map(decorate);
    $('quotaCardsBar').hidden = shown.length + grid.visibleIdle.length < 2;
    window.quotaCardDom.update($('quotaCards'), filtered.length ? filtered.map(item => item.html).join('') : shown.length && prefs().filter !== 'idle' ? '<p class="quota-filter-empty" data-key="empty">' + (prefs().filter === 'action' ? '没有需要处理的卡片。' : '没有状态正常的卡片。') + '</p>' : '', window.quotaProgress.release);
    $('quotaCards').hidden = !shown.length;
    $('quotaHiddenLine').hidden = !grid.hiddenCount;
    $('quotaHiddenLine').innerHTML = grid.hiddenCount ? '已隐藏 ' + grid.hiddenCount + ' 张卡片<button class="text-button" data-hidden-toggle>' + (host.get().showHidden ? '收起' : '显示') + '</button>' : '';
    for (const segments of document.querySelectorAll('#quotaCards .quota-segments')) window.quotaProgress.set(segments, segments.dataset.percent === '' ? null : Number(segments.dataset.percent));
    for (const account of grid.list) window.uiMotion.busy($('quotaCards').querySelector('[data-connection="' + CSS.escape(account.id) + '"] .quota-age'), account.busy);
    renderedKey = key;
  }
  const schedule = () => { if (!renderFrame) renderFrame = requestAnimationFrame(render); };

  // ── Moving cards (Video 1:1 Motion, Synced with Sortable) ────────────────────
  let press = null, suppressClick = false, placeholder = null;
  // Pointer travel that still counts as a click, not a drag (same value as the widget Sortable).
  const DRAG_SLOP = 8;

  function createTracker() {
    let samples = [];
    return {
      reset(val, time = performance.now()) { samples = [{ val, time }]; },
      add(val, time = performance.now()) {
        samples.push({ val, time });
        while (samples.length > 2 && time - samples[0].time > 100) samples.shift();
      },
      velocity() {
        if (samples.length < 2) return 0;
        const first = samples[0], last = samples[samples.length - 1];
        const span = last.time - first.time;
        return span > 0 ? ((last.val - first.val) / span) * 1000 : 0;
      }
    };
  }
  const trackerX = createTracker(), trackerY = createTracker();
  const shownKeys = () => [...$('quotaCards').querySelectorAll('.quota-card:not([data-sort-placeholder])')].map(item => item.dataset.cardKey);

  // One motion decision for the whole drag: only "full" moves. "reduced" (the app setting or the
  // system's preference) and "off" both keep every decorative move out - no glide, no tilt, no
  // landing spring. The card still follows the pointer, because that is the person's own hand.
  const still = () => { const mode = window.uiMotion?.mode; return mode === 'off' || mode === 'reduced'; };

  function slide(cards, before) {
    if (still()) return;
    for (const item of cards) {
      const old = before.get(item), now = item.getBoundingClientRect(); if (!old) continue;
      const dx = old.left - now.left, dy = old.top - now.top;
      if (dx || dy) item.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }
  }

  function shift(moving, over, after) {
    const grid = $('quotaCards');
    const others = [...grid.querySelectorAll('.quota-card')].filter(value => value !== moving);
    const before = new Map(others.map(value => [value, value.getBoundingClientRect()]));
    grid.insertBefore(moving, after ? over.nextSibling : over);
    slide(others, before);
  }

  function pickUp() {
    if (!press) return;
    const { card: moving, id, x, y } = press; press = null;
    const grid = $('quotaCards');
    if (!grid) return;

    // 1. 测量记录网格中所有卡片当前的固定几何槽位 (Static Slot Geometry, exactly like Sortable)
    const cards = [...grid.querySelectorAll('.quota-card:not(.is-flying):not([data-sort-placeholder])')];
    const initialKeys = cards.map(el => el.dataset.cardKey);
    const movingKey = moving.dataset.cardKey;
    const originalIndex = initialKeys.indexOf(movingKey);
    if (originalIndex === -1) return;

    const slots = cards.map(el => {
      const b = el.getBoundingClientRect();
      return {
        left: b.left,
        top: b.top,
        width: b.width,
        height: b.height,
        cx: b.left + b.width / 2,
        cy: b.top + b.height / 2,
      };
    });

    const rect = slots[originalIndex];

    // 2. 创建 1:1 45° 斑马对角斜纹占位槽 (Solid border & fine diagonal stripes)
    placeholder = document.createElement('div');
    placeholder.className = 'ff-drag-placeholder quota-card';
    placeholder.dataset.sortPlaceholder = 'true';
    placeholder.dataset.cardKey = movingKey;
    placeholder.style.width = rect.width + 'px';
    placeholder.style.height = rect.height + 'px';
    moving.parentNode.insertBefore(placeholder, moving);

    // 3. 将原卡片升格为 fixed 飞卡 (Elevation & Scale 1.025)
    moving.classList.add('is-flying');
    moving.style.position = 'fixed';
    moving.style.left = rect.left + 'px';
    moving.style.top = rect.top + 'px';
    moving.style.width = rect.width + 'px';
    moving.style.height = rect.height + 'px';
    moving.style.zIndex = '9999';
    moving.style.pointerEvents = 'none';
    moving.style.margin = '0';
    moving.style.transform = 'translate3d(0, 0, 0) scale(' + (still() ? 1 : 1.025) + ')';

    trackerX.reset(x);
    trackerY.reset(y);

    drag = {
      card: moving,
      movingKey,
      id,
      startX: x,
      startY: y,
      originLeft: rect.left,
      originTop: rect.top,
      width: rect.width,
      height: rect.height,
      slots,
      currentOrder: [...initialKeys],
      tilt: 0,
      dx: 0,
      dy: 0,
    };

    try { grid.setPointerCapture(id); } catch { /* Pointer already left */ }
    document.body.classList.add('quota-dragging');
  }

  function follow(x, y) {
    if (!drag) return;
    const { card: moving, movingKey, startX, startY, originLeft, originTop, width, height, slots } = drag;
    const now = performance.now();
    trackerX.add(x, now);
    trackerY.add(y, now);

    const dx = x - startX;
    const dy = y - startY;
    drag.dx = dx;
    drag.dy = dy;

    // 动态速率侧倾 (Velocity-based Dynamic Tilt)
    const vx = trackerX.velocity();
    const targetTilt = still() ? 0 : Math.max(-5, Math.min(5, (vx / 1000) * 14));
    drag.tilt = (drag.tilt || 0) * 0.75 + targetTilt * 0.25;
    const tilt = still() ? '0' : drag.tilt.toFixed(2);

    moving.style.transform = 'translate3d(' + dx + 'px, ' + dy + 'px, 0) rotate(' + tilt + 'deg) scale(' + (still() ? 1 : 1.025) + ')';

    // 靠近磁吸平滑让位 (Proximity Snapping & FLIP Glide, exactly like Sortable)
    const grid = $('quotaCards');
    if (!grid || slots.length <= 1) return;

    const flyingCx = originLeft + width / 2 + dx;
    const flyingCy = originTop + height / 2 + dy;

    // 计算飞卡几何中心距离每个固定槽位中心点的欧氏距离平方
    const distances = slots.map(slot => (flyingCx - slot.cx) ** 2 + (flyingCy - slot.cy) ** 2);
    const toIndex = distances.indexOf(Math.min(...distances));

    if (toIndex !== -1) {
      const currentPos = drag.currentOrder.indexOf(movingKey);
      if (toIndex !== currentPos) {
        const nextOrder = drag.currentOrder.filter(k => k !== movingKey);
        nextOrder.splice(toIndex, 0, movingKey);
        drag.currentOrder = nextOrder;

        // 执行 FLIP 平滑让位
        const cardsInGrid = [...grid.querySelectorAll('.quota-card:not(.is-flying)')];
        const cardMap = new Map(cardsInGrid.map(el => [el.dataset.cardKey, el]));
        const before = new Map(cardsInGrid.map(el => [el, el.getBoundingClientRect()]));

        // 取消正在进行的旧动画，以防污染真实自然布局测算
        for (const el of cardsInGrid) {
          for (const anim of el.getAnimations()) anim.cancel();
        }

        // 按新顺序排布 DOM 元素
        for (const k of nextOrder) {
          const el = (k === movingKey) ? placeholder : cardMap.get(k);
          if (el) grid.appendChild(el);
        }

        // 让所有位移改变的卡片以 Apple fluid 物理阻尼曲线平滑滑开
        if (!still()) {
          for (const el of grid.querySelectorAll('.quota-card:not(.is-flying)')) {
            const oldR = before.get(el);
            if (!oldR) continue;
            const newR = el.getBoundingClientRect();
            const dX = oldR.left - newR.left;
            const dY = oldR.top - newR.top;
            if (dX || dY) {
              el.animate([
                { transform: 'translate3d(' + dX + 'px, ' + dY + 'px, 0)' },
                { transform: 'translate3d(0, 0, 0)' }
              ], {
                duration: 260,
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
              });
            }
          }
        }
      }
    }
  }

  function drop(save) {
    if (!drag) return;
    const { card: moving, id, originLeft, originTop, dx, dy, tilt, currentOrder } = drag;
    drag = null;
    landing = true;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 50);

    const grid = $('quotaCards');
    try { if (grid?.hasPointerCapture(id)) grid.releasePointerCapture(id); } catch { /* ignore */ }
    document.body.classList.remove('quota-dragging');

    if (!placeholder) {
      landing = false;
      moving.classList.remove('is-flying');
      moving.style.position = '';
      moving.style.left = '';
      moving.style.top = '';
      moving.style.width = '';
      moving.style.height = '';
      moving.style.transform = '';
      moving.style.zIndex = '';
      moving.style.pointerEvents = '';
      moving.style.margin = '';
      return;
    }

    // 4. 落位期间把飞卡交给文档搬运，而不是每帧追一次滚动。
    // 拖拽时飞卡是 fixed（指针在视口空间，跟手零误差）；一松手就换成 absolute + 网格坐标，
    // 这样页面滚动时浏览器直接搬运飞卡和占位槽两者，弹簧只需要收敛它们之间那点差值。
    // 补偿式做法（监听 scroll 每帧改 transform）注定落后合成器一帧，滚快一点就被看成粘在屏幕上。
    const targetRect = placeholder.getBoundingClientRect();
    const targetDx = targetRect.left - originLeft;
    const targetDy = targetRect.top - originTop;

    // 卡片此刻在视口里的位置换算到网格坐标系；换完视觉位置不变，但从此跟随文档。
    const gridRect = grid.getBoundingClientRect();
    moving.style.position = 'absolute';
    moving.style.left = (originLeft - gridRect.left) + 'px';
    moving.style.top = (originTop - gridRect.top) + 'px';

    // 释放瞬时的初速度
    const vx = save ? trackerX.velocity() : 0;
    const vy = save ? trackerY.velocity() : 0;

    // 标记 settling，柔和收拢阴影
    moving.dataset.settling = 'true';

    // 欠阻尼物理弹簧解析求解器（k=320, c=24, m=0.85 -> omega0=19.4, zeta=0.727, omegad=13.3）
    const omega0 = 19.4, zeta = 0.727, omegad = 13.3;
    const x0 = dx - targetDx;
    const C1_x = x0, C2_x = (vx + zeta * omega0 * C1_x) / omegad;

    const y0 = dy - targetDy;
    const C1_y = y0, C2_y = (vy + zeta * omega0 * C1_y) / omegad;

    const r0 = Number(tilt) || 0;
    const C1_r = r0, C2_r = (zeta * omega0 * C1_r) / omegad;

    const s0 = 0.025; // scale 从 1.025 回归到 1.0
    const C1_s = s0, C2_s = (zeta * omega0 * C1_s) / omegad;

    const startTime = performance.now();
    const duration = 380; // ms

    function settleFrame(now) {
      const t = (now - startTime) / 1000;
      // Under reduced/off motion the card goes straight into its slot: no spring, no tilt, no scale.
      if (still() || t >= duration / 1000) {
        finishDrop();
        return;
      }
      const decay = Math.exp(-zeta * omega0 * t);
      const cos = Math.cos(omegad * t);
      const sin = Math.sin(omegad * t);

      const curX = targetDx + decay * (C1_x * cos + C2_x * sin);
      const curY = targetDy + decay * (C1_y * cos + C2_y * sin);
      const curR = decay * (C1_r * cos + C2_r * sin);
      const curS = 1 + decay * (C1_s * cos + C2_s * sin);

      moving.style.transform = 'translate3d(' + curX + 'px, ' + curY + 'px, 0) rotate(' + curR.toFixed(2) + 'deg) scale(' + curS.toFixed(4) + ')';
      requestAnimationFrame(settleFrame);
    }

    function finishDrop() {
      // 提取最新顺序：以 currentOrder 为准
      const finalKeys = save ? currentOrder : shownKeys();

      // 将真实卡片插入 placeholder 的位置，然后清理 placeholder
      if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.insertBefore(moving, placeholder);
        placeholder.parentNode.removeChild(placeholder);
      }
      placeholder = null;

      moving.classList.remove('is-flying');
      delete moving.dataset.settling;
      moving.style.position = '';
      moving.style.left = '';
      moving.style.top = '';
      moving.style.width = '';
      moving.style.height = '';
      moving.style.transform = '';
      moving.style.zIndex = '';
      moving.style.pointerEvents = '';
      moving.style.margin = '';

      if (save) {
        host.reorder(finalKeys);
        host.setMessage('卡片顺序已保存。');
      }

      landing = false;
      renderedKey = null;
      render();
    }

    requestAnimationFrame(settleFrame);
  }
  $('quotaCards').addEventListener('pointerdown', event => {
    const target = event.target.closest('.quota-card');
    if (!target || event.button !== 0 || drag || event.target.closest('button, input, a, textarea, select, summary, [role="button"], [role="switch"], [role="slider"], [contenteditable]')) return;
    press = { card: target, id: event.pointerId, x: event.clientX, y: event.clientY, timer: setTimeout(pickUp, 350) };
  });
  window.addEventListener('pointermove', event => {
    if (press && event.pointerId === press.id) {
      const dist = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      // DRAG_SLOP: a card is also a click target (its details open on click), so a couple of pixels
      // of hand shake must not turn a tap into a drag.
      if (dist >= DRAG_SLOP) {
        clearTimeout(press.timer);
        pickUp();
      }
    }
    if (drag && event.pointerId === drag.id) {
      event.preventDefault();
      follow(event.clientX, event.clientY);
    }
  });
  for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, event => {
    if (press && event.pointerId === press.id) {
      clearTimeout(press.timer);
      press = null;
    }
    if (drag && event.pointerId === drag.id) drop(type === 'pointerup');
  });
  window.addEventListener('keydown', event => { if (drag && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); drop(false); } }, true);
  $('quotaCards').addEventListener('keydown', event => {
    const keys = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }, target = event.target.closest('.quota-card');
    if (!event.altKey || !target || !Object.hasOwn(keys, event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const cards = [...$('quotaCards').querySelectorAll('.quota-card')], index = cards.indexOf(target), next = cards[index + keys[event.key]]; if (!next) return;
    shift(target, next, keys[event.key] > 0);
    const key = target.dataset.cardKey, order = shownKeys(), place = order.indexOf(key) + 1;
    host.reorder(order, key); renderedKey = null; render();
    $('quotaCards').querySelector('[data-card-key="' + CSS.escape(key) + '"] .quota-sheet-open')?.focus();
    host.setMessage('已移到第 ' + place + ' 位。');
  });

  // ── Actions: the card's own controls; sheets and connections open on the React page ───────────
  function act(event) {
    const target = event.target.closest('button');
    // Anywhere else on a card opens its details, unless the press picked the card up or selected text.
    if (!target) { const item = event.target.closest('#quotaCards .quota-card'); if (item && !suppressClick && !event.target.closest('input, a, summary') && !String(window.getSelection?.() || '')) window.quotaUi?.openDetails(item.dataset.providerRow, item.dataset.connection); return; }
    if (target.disabled) return;
    if (target.matches('[data-quota-sheet]')) { window.quotaUi?.openDetails(target.dataset.quotaSheet, target.dataset.account); return; }
    if (target.matches('[data-card-hide]')) { host.toggleHidden(target.dataset.cardHide); return; }
    if (target.matches('[data-hidden-toggle]')) { host.showHidden(); return; }
    if (target.matches('[data-retry]')) { if (target.dataset.retry === 'codex') host.refresh(target.dataset.id); else void host.providerAction('refresh', target.dataset.id); return; }
    if (target.matches('[data-quota-refresh]')) { host.refresh(target.dataset.quotaRefresh); return; }
    if (target.matches('[data-provider-action]')) {
      const kind = target.dataset.providerAction, row = model.accounts().find(account => account.id === target.dataset.id);
      if (kind === 'credential' && row) window.quotaUi?.connect(row.agent, row.id); else void host.providerAction(kind, target.dataset.id);
    }
  }
  $('quotaCards').addEventListener('click', act);
  $('quotaHiddenLine').addEventListener('click', act);
  window.addEventListener('quota-change', schedule);
  window.addEventListener('ui-view-change', event => { if (event.detail === 'quota') schedule(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  const timer = setInterval(schedule, 30000);
  window.addEventListener('unload', () => { cancelAnimationFrame(renderFrame); clearInterval(timer); });
  schedule();
})();
