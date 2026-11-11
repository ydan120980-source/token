'use strict';
// Pure usage projections. The shell owns saved data and preferences; this module never reads
// the DOM, storage, files, credentials or an IPC bridge. Existing UMD math remains authoritative.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.usageModel = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const known = Number.isFinite;
  const fields = ['inputUncached', 'output', 'cacheRead', 'cacheWrite'];
  const names = ['输入', '输出（含推理）', '缓存读取', '缓存写入'];
  const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const pad = value => String(value).padStart(2, '0');
  function shift(day, amount) {
    const date = new Date(day + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }
  function dates(start, end) {
    const result = [];
    for (let day = start; day <= end; day = shift(day, 1)) result.push(day);
    return result;
  }
  const dayCount = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  const weekday = day => (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7;
  function sum(rows, field) { return rows.reduce((value, row) => value + (row[field] ?? 0), 0); }
  function reported(rows, field) {
    const values = rows.map(row => row[field]).filter(known);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  }
  function aggregate(rows) {
    const priced = rows.filter(row => known(row.estimatedCostUsd));
    const total = reported(rows, 'totalTokens');
    const savings = rows.filter(row => known(row.cacheSavingsUsd) && row.cacheSavingsUsd > 0);
    return {
      total, partial: rows.some(row => !known(row.totalTokens)),
      cost: priced.length ? sum(priced, 'estimatedCostUsd') : null,
      upper: priced.length ? priced.reduce((n, row) => n + (row.estimatedCostUpperUsd ?? row.estimatedCostUsd), 0) : null,
      costPartial: priced.length < rows.length || rows.some(row => row.unpricedRecords > 0 || row.pricedTokens < row.totalTokens),
      savings: savings.length ? sum(savings, 'cacheSavingsUsd') : null,
      bounded: sum(rows, 'boundedTokens'), records: sum(rows, 'records'),
      coverage: total ? sum(rows, 'pricedTokens') / total : null
    };
  }
  function filterRows(rows, state, skip = null) {
    const agent = skip === 'agent' ? 'all' : state.agent;
    const model = skip === 'model' ? 'all' : state.model;
    if (agent === 'all' && state.source === 'all' && model === 'all') return rows;
    return rows.filter(row => (agent === 'all' || row.agent === agent) &&
      (state.source === 'all' || (row.provider || 'unknown') === state.source) && (model === 'all' || row.model === model));
  }
  const within = (rows, start, end) => rows.filter(row => row.date >= start && row.date <= end);
  function previousWindow(today, start, coverageStart, period) {
    if (period === 'all') return null;
    const length = dayCount(start, today) + 1, from = shift(start, -length), to = shift(start, -1);
    return { from, to, complete: from >= coverageStart };
  }
  function dayTotals(rows) {
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.date)) groups.set(row.date, []);
      groups.get(row.date).push(row);
    }
    return new Map([...groups].map(([day, items]) => [day, reported(items, 'totalTokens')]));
  }
  function strip(rows, today) {
    const days = dates(shift(today, -29), today), totals = dayTotals(rows);
    const maximum = Math.max(1, ...days.map(day => totals.get(day) ?? 0));
    return days.map(day => ({ key: day, value: totals.has(day) ? totals.get(day) : null,
      state: !totals.has(day) ? 'unobserved' : totals.get(day) === null ? 'unpriced' : totals.get(day) === 0 ? 'zero' : 'value',
      mark: day === today ? 'today' : totals.get(day) > 0 && totals.get(day) === maximum ? 'peak' : undefined }));
  }
  const level = (value, maximum) => !value ? 0 : value < maximum * .12 ? 1 : value < maximum * .33 ? 2 : value < maximum * .65 ? 3 : 4;
  function calendar(rows, allRows, today, coverageStart, range, realData, selectedDay, highlighted = []) {
    const start = range === '365' ? shift(today, -364) : range + '-01-01';
    const end = range === '365' ? today : range + '-12-31', origin = shift(start, -weekday(start));
    const columns = Math.ceil((dayCount(origin, end) + 1) / 7), totals = dayTotals(within(rows, start, today));
    const observed = new Set(allRows.map(row => row.date)), maximum = Math.max(1, ...totals.values());
    const cells = dates(origin, end).map((day, index) => {
      const disabled = day < start || day > today;
      const seen = realData ? observed.has(day) : day >= coverageStart && allRows.length > 0;
      const value = totals.has(day) ? totals.get(day) : 0;
      return { key: day, row: index % 7, col: Math.floor(index / 7),
        level: disabled || !seen || value === null ? null : level(value, maximum), disabled,
        highlighted: highlighted.includes(day), value: seen ? value : null, observed: seen, selected: selectedDay === day };
    });
    const months = [];
    for (let month = start.slice(0, 7) + '-01'; month <= end; month = shift(month.slice(0, 7) + '-28', 7).slice(0, 7) + '-01') {
      const col = Math.floor(dayCount(origin, month < start ? start : month) / 7);
      if (months.at(-1)?.col === col) months.pop();
      months.push({ index: col, label: Number(month.slice(5, 7)) + '月', col });
    }
    const labels = months.filter((item, index) => (months[index + 1]?.col ?? columns) - item.col >= 2);
    return { start, end, columns, cells, labels, totals };
  }
  function dayHours(rows, day, today, currentHour, ready) {
    const last = day === today ? currentHour : 23;
    const hours = Array.from({ length: 24 }, (_, hour) => {
      const items = rows.filter(row => row.date === day && row.hour === hour);
      return { key: String(hour), hour, value: items.length ? reported(items, 'totalTokens') : 0,
        items, future: hour > last, records: sum(items, 'records') };
    });
    const used = hours.filter(hour => hour.value > 0);
    const peak = used.reduce((best, hour) => !best || hour.value > best.value ? hour : best, null);
    return { hours, used: used.length, peak, last, ready,
      empty: !ready ? '这一天没有按小时的记录。' : rows.some(row => row.date === day) ? '这一天只有 0 token 的空记录。' : '这一天没有用量记录。' };
  }
  const slotName = (day, hour) => weekdays[day] + ' ' + pad(hour) + ':00–' + pad(hour + 1) + ':00';
  const slotRows = (rows, day, hour) => rows.filter(row => row.hour === hour && weekday(row.date) === day);
  function modelTone(model) {
    let hash = 0;
    for (const character of model) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return 'model:' + hash % 10;
  }

  // Extracted from preview.renderTrend: chronology, hourly/cumulative/average and model grouping
  // stay in the existing math modules. S2 tracks reporting per field before bucket projection.
  function trend(rows, hourlyRows, context, state, math, chart) {
    const start = state.trendRange?.start ?? math.startFor(context.today, state.period, context.coverageStart);
    const end = state.trendRange?.end ?? context.today, grouped = filterRows(rows, state);
    const subset = within(grouped, start, end), chronological = dates(start, end);
    const grain = state.grain === 'auto' ? chronological.length > 366 ? 'week' : 'day' : state.grain;
    const flowRows = state.display === 'total' ? subset : grouped;
    const observed = new Set(rows.map(row => row.date)), realDates = context.realData ? observed : null;
    const hourly = start === end && context.hourlyReady;
    const hours = hourly ? Array.from({ length: (start === context.today ? context.currentHour : 23) + 1 }, (_, h) => h) : [];
    const hourRows = hourly ? within(filterRows(hourlyRows, state), start, end) : [];
    const perHour = (pick, keep = () => true) => {
      let running = 0, hasKnown = false;
      return hours.map(hour => {
        const items = hourRows.filter(row => row.hour === hour && keep(row)), values = items.map(pick).filter(known);
        const value = items.length && !values.length ? null : values.reduce((a, b) => a + b, 0);
        if (state.display !== 'total') return value;
        if (value !== null) { running += value; hasKnown = true; }
        return hasKnown ? running : null;
      });
    };
    const pick = row => state.metric === 'cost' ? row.estimatedCostUsd : row.totalTokens;
    const add = lists => chronological.map((_, index) => {
      const values = lists.map(list => list[index]).filter(known);
      return values.length ? values.reduce((a, b) => a + b, 0) : null;
    });
    const weights = new Map();
    for (const row of subset) weights.set(row.model, (weights.get(row.model) || 0) + (pick(row) || 0));
    const models = [...weights].sort((a, b) => b[1] - a[1]).map(([model]) => model);
    let total, entries;
    if (hourly && state.mode !== 'models') {
      total = perHour(pick);
      entries = [{ key: 'total', label: state.metric === 'cost' ? '已定价估算' : '总量', tone: 'ink:1', unit: state.metric, values: total }];
    } else if (state.mode === 'models') {
      // The shared math's cost lane preserves reported nulls. Project Token values into that
      // numeric lane too; presentation still uses the original metric and no price is invented.
      const numericRows = state.metric === 'tokens' ? flowRows.map(row => ({ ...row, estimatedCostUsd: row.totalTokens })) : flowRows;
      const series = math.seriesByModel(numericRows, models, chronological, state.display, 'cost', context.coverageStart, realDates);
      total = hourly ? perHour(pick) : add([...series.values()]);
      const values = model => hourly ? perHour(pick, row => row.model === model) : series.get(model);
      entries = models.slice(0, 5).map(model => ({ key: model, label: model === 'unknown' ? '模型未记录' : model,
        tone: modelTone(model), unit: state.metric, values: values(model) }));
      if (models.length > 5) entries.push({ key: 'other', label: '其他 ' + (models.length - 5) + ' 个模型', tone: 'muted',
        unit: state.metric, values: hourly ? perHour(pick, row => !models.slice(0, 5).includes(row.model)) : add(models.slice(5).map(values)) });
    } else if (state.mode === 'flow' && state.metric === 'tokens') {
      const flow = new Map();
      for (const row of flowRows) {
        if (!flow.has(row.date)) flow.set(row.date, []);
        flow.get(row.date).push(row);
      }
      const projected = [...flow].flatMap(([date, items]) => [...fields, 'cost', '__total__'].map(key => {
        const value = reported(items, key === 'cost' ? 'estimatedCostUsd' : key === '__total__' ? 'totalTokens' : key);
        return { date, model: key, totalTokens: value, estimatedCostUsd: value };
      }));
      const series = math.seriesByModel(projected, [...fields, 'cost', '__total__'], chronological, state.display, 'cost', context.coverageStart, realDates);
      const tones = ['measure:input', 'measure:output', 'measure:cacheRead', 'measure:cacheWrite'];
      entries = fields.map((field, index) => ({ key: field, label: names[index], tone: tones[index], unit: 'tokens',
        values: hourly ? perHour(row => row[field]) : series.get(field) }));
      entries.push({ key: 'cost', label: '估算费用（右轴）', tone: 'measure:estimate', unit: 'cost',
        values: hourly ? perHour(row => row.estimatedCostUsd) : series.get('cost') });
      total = hourly ? perHour(pick) : series.get('__total__');
    } else {
      const daily = dayTotalsForMetric(flowRows, pick);
      const projected = [...daily].map(([date, value]) => ({ date, model: '__total__', totalTokens: value, estimatedCostUsd: value }));
      total = hourly ? perHour(pick) : math.seriesByModel(projected, ['__total__'], chronological, state.display, 'cost', context.coverageStart, realDates).get('__total__');
      entries = [{ key: 'total', label: state.metric === 'cost' ? '已定价估算' : '总量', tone: 'ink:1', unit: state.metric, values: total }];
    }
    const lead = !hourly && state.display === 'average' ? Math.max(0, chronological.findIndex((_, index) =>
      [total, ...entries.map(entry => entry.values)].some(list => known(list[index])))) : 0;
    const shown = lead ? chronological.slice(lead) : chronological;
    const bucket = values => hourly ? hours.map((hour, index) => ({ label: pad(hour) + ':00', start, end, hour,
      value: values[index], partial: false })) : chart.bucketSeries(shown, lead ? values.slice(lead) : values, grain, state.display);
    const buckets = bucket(total);
    entries = entries.map(entry => ({ ...entry, buckets: bucket(entry.values), values: bucket(entry.values).map(item => item.value) }));
    return { start, end, grain, hourly, buckets, entries, subset, aggregate: aggregate(subset), observed,
      displayLabel: hourly ? '每小时' : grain === 'week' ? '每周' : grain === 'month' ? '每月' : '每日',
      autoLabel: '自动（' + (grain === 'week' ? '按周' : '按日') + '）', lead: lead ? shown[0] : null };
  }
  function dayTotalsForMetric(rows, pick) {
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.date)) groups.set(row.date, []);
      groups.get(row.date).push(pick(row));
    }
    return new Map([...groups].map(([date, values]) => {
      const reported = values.filter(known);
      return [date, reported.length ? reported.reduce((a, b) => a + b, 0) : null];
    }));
  }
  const short = value => value === null || value === undefined ? '未知' : value >= 1e9 ? (value / 1e9).toFixed(1) + 'B' :
    value >= 1e6 ? (value / 1e6).toFixed(1) + 'M' : value >= 1e3 ? (value / 1e3).toFixed(1) + 'K' : String(value);
  const displayModel = value => value === 'unknown' ? '模型未记录' : value;
  const exact = value => value === null ? null : value.toLocaleString('zh-CN');
  const hasUsage = row => row.totalTokens > 0 || [...fields, 'reasoning']
    .some(field => (row.knownUsage?.[field] ?? row[field]) > 0);
  const percentage = value => value > 0 && value < .005 ? '<1%' : (value * 100).toFixed(0) + '%';
  function trendTooltip(projection, state, index, chart, display) {
    const bucket = projection.buckets[index];
    if (!bucket) return null;
    const title = bucket.hour !== undefined ? bucket.start.slice(5) + ' ' + pad(bucket.hour) + ':00 – ' + pad(bucket.hour + 1) + ':00' :
      bucket.start === bucket.end ? bucket.start : bucket.start + ' 至 ' + bucket.end;
    const missing = !dates(bucket.start, bucket.end).some(day => projection.observed.has(day));
    if (missing) return { title, aside: '未记录', rows: [], note: '淡线仅连接前后记录，没有此日期的用量数值。' };
    const points = projection.entries.filter(entry => !state.hidden.includes(entry.key))
      .map(entry => ({ ...entry, value: entry.values[index] ?? null }));
    const summary = chart.tooltipSummary(points.filter(point => state.metric === 'cost' || point.unit !== 'cost'));
    const value = number => number === null ? '未定价' : state.metric === 'cost' ? display.usd(number) : short(number) + ' token';
    const rows = summary.entries.slice(0, 6).map(point => ({ key: point.key, label: point.label, value: value(point.value), tone: point.tone }));
    const cost = state.metric === 'tokens' ? points.find(point => point.unit === 'cost') : null;
    if (cost) rows.push({ key: cost.key, label: '已定价估算', value: cost.value === null ? '未定价' : display.usd(cost.value), tone: cost.tone });
    const empty = summary.entries.length ? '' : summary.total === null ? '记录存在，但用量或价格未报告。' :
      projection.hourly ? '此时段没有用量记录。' : '此日期的已记录值为零。';
    const note = empty + (summary.entries.length > 6 ? '另有 ' + (summary.entries.length - 6) + ' 个模型，可在模型明细查看；' : '') +
      (summary.zeroCount ? summary.zeroCount + ' 项记录为零；' : '') + (summary.unknownCount ? summary.unknownCount + ' 个值未知；' : '') +
      (projection.entries.some(entry => entry.buckets[index]?.partial) ? '当前聚合含未记录日期；' : '') +
      (state.display === 'total' ? '当前区间累计值' : projection.hourly ? '每小时记录值 · 本地时间' :
        state.display === 'average' ? '30 日平均值' : '每日记录值') + (state.metric === 'cost' ? ' · 已定价部分' : '');
    return { title, aside: summary.total === null ? '数值未知' : '合计 ' + value(summary.total), rows, note };
  }
  function project(input, state, globals) {
    const { rows, hourlyRows, today, coverageStart, realData, recorded, currentHour, sessionCounts, sources } = input;
    const { usageMath: math, insightsMath: insights, displayValues: display, chartUi: chart, agents } = globals;
    const filtered = filterRows(rows, state), start = math.startFor(today, state.period, coverageStart);
    const scoped = state.period === 'all' ? filtered : within(filtered, start, today), daily = filtered.filter(row => row.date === today);
    const total = aggregate(scoped), current = aggregate(daily), observed = new Set(scoped.map(row => row.date));
    const periodLabel = state.period === 'all' ? '累计' : state.period === 'today' ? '今天' : '最近 ' + state.period + ' 天';
    const scope = [state.agent === 'all' ? '全部 Agent' : agents[state.agent]?.name ?? state.agent,
      state.source === 'all' ? null : state.source === 'unknown' ? '来源未报告' : state.source,
      state.model === 'all' ? null : displayModel(state.model)].filter(Boolean).join(' · ');
    const tokens = (amount, full = false) => amount.total === null ? null : (full ? exact(amount.total) : short(amount.total)) + (amount.partial ? '+' : '');
    function price(amount, label) {
      const value = display.cost(amount.cost, amount.upper, amount.coverage);
      const range = value.lower !== null && value.upper > value.lower + .000001;
      const lower = value.lower === null ? null : display.usd(value.lower) + (value.partial || amount.costPartial ? '+' : '');
      const bounds = value.lower === null ? '未定价' : display.usd(value.lower) +
        (range ? ' — ' + display.usd(value.upper) : value.partial || amount.costPartial ? '+' : '');
      const coverage = amount.coverage === null ? '未知' : (amount.coverage * 100).toFixed(1) + '%';
      return { lower, upper: range ? display.usd(value.upper) : null, lowerValue: value.lower, upperValue: value.upper, coverage, bounds,
        label: label + ' ' + bounds + '；定价覆盖 ' + coverage +
          '。仅包括已定价部分，未知费用不计为零，API 等价估算不代表订阅账单。' };
    }
    function categories(items) {
      const mix = math.disjointMix(items), tones = ['category:input', 'category:output', 'category:cacheRead', 'category:cacheWrite', 'category:reasoning'];
      const tiles = insights.categoryView(items, recorded).map((tile, index) => {
        const text = { value: short(tile.value), partial: '≥ ' + short(tile.value), combined: '含在输出中',
          'not-recorded': '来源不记录' }[tile.state] ?? null;
        const title = ({ partial: '部分记录未报告' + tile.label + '，显示已报告部分的下限',
          combined: '来源只记录输出总量，推理已包含其中，无法拆分',
          'not-recorded': '这些来源的日志没有单独记录' + tile.label + '，相应 token 已计入其他分类，不按零计算',
          unknown: '这些记录没有报告' + tile.label + '，不按零计算' }[tile.state] || '') + (tile.note ? '；' + tile.note : '');
        return { key: tile.key, label: tile.label, text, title, tone: tones[index],
          value: mix.total ? mix.values[index] : null, state: tile.state };
      });
      return { tiles, segments: tiles.filter(tile => known(tile.value)).map(tile => ({ key: tile.key,
        value: mix.total ? tile.value / mix.total : 0, tone: tile.tone, label: tile.label + ' ' + (tile.text ?? '未知') })),
        unknown: !mix.total };
    }
    function clients(items, date) {
      const whole = aggregate(items);
      const used = hasUsage;
      return Object.entries(agents).filter(([id]) => items.some(row => row.agent === id && used(row))).map(([id, meta]) => {
        const subset = items.filter(row => row.agent === id), amount = aggregate(subset);
        const entries = new Set(subset.map(row => row.entry));
        const entry = entries.size !== 1 ? '多个入口' : ({ desktop: 'Desktop', cli: 'CLI', sdk: 'SDK', export: '用量导出',
          harness: 'Harness', unknown: '入口未知' }[[...entries][0]] || '入口未知');
        const name = meta.name + (['codex', 'mimo'].includes(id) ? ' / ' + entry : '');
        return { id, name, records: String(amount.records), tokens: tokens(amount), price: price(amount, meta.name + ' 估算'),
          sessions: sessionCounts[date + ':' + id] ?? null,
          models: [...new Set(subset.map(row => row.model))].filter(model => subset.some(row => row.model === model && used(row)))
            .map(key => {
              const group = subset.filter(row => row.model === key), amount = aggregate(group), hit = insights.cacheHitRate(group, recorded);
              const output = group.every(row => row.output !== null && row.output !== undefined) ? short(sum(group, 'output')) :
                sum(group.map(row => ({ value: row.knownUsage?.output || 0 })), 'value') > 0 ?
                  '≥ ' + short(group.reduce((n, row) => n + (row.knownUsage?.output || 0), 0)) : null;
              const fraction = whole.total > 0 && amount.total !== null ? amount.total / whole.total : null;
              return { key, name: displayModel(key), tokens: tokens(amount), price: price(amount, displayModel(key) + ' 估算'),
                share: fraction === null ? null : percentage(fraction), fraction,
                output, hit: hit === null ? null : percentage(hit),
                categories: categories(group) };
            }) };
      });
    }
    const periodBefore = previousWindow(today, start, coverageStart, state.period);
    const previous = periodBefore?.complete ? within(filtered, periodBefore.from, periodBefore.to) : [];
    const delta = previous.length ? insights.change(total.total, aggregate(previous).total) : null;
    const signed = value => value === null ? null : Math.abs(value) < .005 ? '持平' : (value > 0 ? '+' : '−') + Math.abs(value * 100).toFixed(1) + '%';
    const average = observed.size && total.total !== null ? total.total / observed.size : null;
    const change = state.period !== 'today' && observed.size > 1 && average > 0 && daily.length && current.total !== null ? current.total / average - 1 : null;
    const trendContext = { ...input, hourlyReady: input.hourlyReady(state.trendRange?.start ?? start) };
    const projection = trend(rows, hourlyRows, trendContext, state, math, chart);
    const selected = state.selectedDay;
    const dayRows = selected ? filtered.filter(row => row.date === selected) : [];
    const daySeen = selected && (realData ? rows.some(row => row.date === selected) : selected >= coverageStart && rows.length > 0);
    const activityRows = within(filterRows(hourlyRows, state), state.heatRange === '365' ? shift(today, -364) : state.heatRange + '-01-01', today);
    const grid = insights.weekHour(activityRows), slotObserved = new Set(), slotKnown = new Set(), slotPartial = new Set();
    for (const row of activityRows) {
      const key = weekday(row.date) + ':' + row.hour;
      slotObserved.add(key);
      if (known(row.totalTokens)) slotKnown.add(key); else slotPartial.add(key);
    }
    const slot = state.slot ? slotRows(activityRows, state.slot.day, state.slot.hour) : [];
    const slotAmount = aggregate(slot), slotDates = slot.filter(row => row.totalTokens > 0).map(row => row.date);
    const cal = calendar(filtered, rows, today, coverageStart, state.heatRange, realData, selected, selected ? [] : slotDates);
    const runs = insights.streaks(cal.totals, cal.start, today), peak = insights.peakWindow(grid.hours);
    const hours = selected ? dayHours(filterRows(hourlyRows, state), selected, today, currentHour, input.hourlyReady(selected)) : null;
    const labelDay = day => day + ' · ' + weekdays[weekday(day)];
    const bars = strip(filtered, today).map(bar => ({ ...bar, tone: 'ink:1',
      label: labelDay(bar.key) + '：' + (bar.state === 'unobserved' ? '未观测到记录' :
        bar.value === null ? '未知' : exact(bar.value) + ' Token') + '，查看明细' }));
    const timeCells = grid.cells.flatMap((cells, day) => cells.map((cell, hour) => {
      const key = day + ':' + hour, unknown = slotObserved.has(key) && !slotKnown.has(key);
      const partial = slotPartial.has(key) ? '+' : '';
      return { key, row: day, col: hour, level: unknown ? null : level(cell.tokens, grid.max),
        label: slotName(day, hour) + '，' + (unknown ? '未知' : cell.tokens || partial ?
          exact(cell.tokens) + partial + ' Token，' + cell.days + ' 天' : '无用量'),
        tip: { title: slotName(day, hour), aside: unknown ? '未知' : cell.tokens || partial ?
          short(cell.tokens) + partial + ' Token' : '无用量', note: cell.tokens ? cell.days + ' 天有用量' : null } };
    }));
    const trendEntries = projection.entries.map(entry => ({ ...entry, label: displayModel(entry.label),
      style: entry.unit === 'cost' && state.metric === 'tokens' ? 'dashed' : 'area',
      axis: entry.unit === 'cost' && state.metric === 'tokens' ? 'right' : 'left' }));
    const axisTicks = axis => {
      const visible = trendEntries.filter(entry => entry.axis === axis && !state.hidden.includes(entry.key));
      if (!visible.length && axis === 'right') return [];
      const peak = Math.max(0, ...visible.flatMap(entry => entry.values.filter(known)));
      // Same numeric scale as the existing kit geometry/cost-model niceStep; display stays with existing formatters.
      const raw = peak / 4, exponent = raw > 0 ? Math.floor(Math.log10(raw)) : 0, base = raw / 10 ** exponent;
      const step = raw > 0 ? (base <= 1 ? 1 : base <= 2 ? 2 : base <= 2.5 ? 2.5 : base <= 5 ? 5 : 10) * 10 ** exponent : 1;
      return Array.from({ length: Math.max(1, Math.ceil(peak / step)) + 1 }, (_, index) => ({ value: index * step,
        label: axis === 'right' || state.metric === 'cost' ? display.usd(index * step) : short(index * step) }));
    };
    function trendReadout(index) {
      const bucket = projection.buckets[index];
      if (!bucket) return null;
      const items = trendEntries.filter(entry => !state.hidden.includes(entry.key)).map(entry => ({ key: entry.key,
        label: entry.label, tone: entry.tone, value: entry.values[index] === null ? null :
          entry.unit === 'cost' ? display.usd(entry.values[index]) : exact(entry.values[index]) }));
      const missing = !projection.hourly && !dates(bucket.start, bucket.end).some(day => projection.observed.has(day));
      return { label: projection.hourly ? bucket.start + ' ' + bucket.label : bucket.start === bucket.end ? bucket.start : bucket.start + ' 至 ' + bucket.end,
        items, partial: bucket.partial, missing };
    }
    const recent = !state.trendRange && state.period === 'all' ? { from: shift(today, -29), to: today } :
      { from: projection.start, to: projection.end };
    const before = { from: shift(recent.from, -(dayCount(recent.from, recent.to) + 1)), to: shift(recent.from, -1) };
    const pick = row => state.metric === 'cost' ? row.estimatedCostUsd : row.totalTokens;
    const valueOf = items => { const values = items.map(pick).filter(known); return values.length ? values.reduce((a, b) => a + b, 0) : null; };
    const trendFilteredHours = filterRows(hourlyRows, state);
    const now = projection.hourly ? valueOf(trendFilteredHours.filter(row => row.date === projection.start && row.hour <= (projection.start === today ? currentHour : 23))) : valueOf(within(filtered, recent.from, recent.to));
    const then = projection.hourly ? input.hourlyReady(shift(projection.start, -1)) ? valueOf(trendFilteredHours.filter(row => row.date === shift(projection.start, -1) && row.hour <= (projection.start === today ? currentHour : 23))) : null :
      before.from >= coverageStart ? valueOf(within(filtered, before.from, before.to)) : null;
    const unitRows = projection.hourly ? trendFilteredHours.filter(row => row.date === projection.start) : projection.subset;
    const units = new Map(), leads = new Map();
    for (const row of unitRows) if (known(pick(row))) {
      const key = projection.hourly ? row.hour : row.date;
      units.set(key, (units.get(key) || 0) + pick(row));
      leads.set(row.model, (leads.get(row.model) || 0) + pick(row));
    }
    const trendPeak = [...units].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1])[0];
    const lead = [...leads].sort((a, b) => b[1] - a[1])[0], leadTotal = [...leads.values()].reduce((a, b) => a + b, 0);
    const perRecord = insights.efficiency(projection.subset, recorded).tokensPerRecord;
    const agentTotals = {};
    for (const row of input.allRows) agentTotals[row.agent] = (agentTotals[row.agent] || 0) + (row.totalTokens ?? 0);
    const agentItems = Object.entries(agents).map(([id, meta], index) => ({ id, name: meta.name, recorded: Boolean(agentTotals[id]), index }))
      .sort((a, b) => (agentTotals[b.id] || 0) - (agentTotals[a.id] || 0) || a.index - b.index);
    const sourceOptions = [...new Set(input.allRows.filter(row => state.agent === 'all' || row.agent === state.agent).map(row => row.provider || 'unknown'))].sort();
    const modelOptions = [...new Set(input.allRows.filter(row => (state.agent === 'all' || row.agent === state.agent) &&
      (state.source === 'all' || (row.provider || 'unknown') === state.source)).map(row => row.model))].sort();
    return {
      periodLabel, scope: scope + ' · ' + periodLabel, filtered: state.agent !== 'all' || state.source !== 'all' || state.model !== 'all',
      hero: { tokens: tokens(total, true), records: scoped.length ? exact(total.records) : null, price: price(total, 'API 等价估算'),
        average: state.period !== 'today' && observed.size > 1 && average > 0 ? short(Math.round(average)) : null,
        averageTitle: average === null ? '' : '区间日均 ' + short(Math.round(average)) + ' Token（按 ' + observed.size + ' 个有记录日计算）',
        comparison: state.period !== 'all' && state.period !== 'today' ? signed(delta) : null,
        today: daily.length ? '今天 ' + short(current.total) + (change === null ? '' : ' · 较日均 ' + signed(change)) : '今天暂无记录', bars },
      today: { date: today, tokens: tokens(current), records: daily.length ? exact(current.records) : null,
        price: price(current, '今日估算'), sessions: daily.length ? sessionCounts[today + ':' + state.agent] ?? null : null,
        categories: categories(daily), clients: clients(daily, today),
        empty: daily.length ? daily.some(hasUsage) ? '' : '此日只有 0 token 的空记录。' :
          rows.some(row => row.date === today) ? '今天在当前筛选下没有用量记录。' : input.error ? '今天的统计没能读取，已有数据保留不变。' :
            input.collecting ? '正在读取今天的用量…' : !input.enabled ? '采集已暂停，今天的用量暂不更新。' : '今天还没有用量记录。' },
      calendar: { ...cal, totals: undefined, cells: cal.cells.map(cell => ({ ...cell,
        label: labelDay(cell.key) + ' · ' + (cell.observed && cell.value !== null ? exact(cell.value) + ' Token' : '未观测到记录'),
        tip: { title: labelDay(cell.key), aside: !cell.observed ? '未观测到记录' : cell.value === null ? '未知' : exact(cell.value) + ' Token' } })) },
      activity: { rangeLabel: '星期 × 小时 · ' + (state.heatRange === '365' ? '最近一年' : state.heatRange + ' 年') +
          (scope === '全部 Agent' ? '' : ' · ' + scope),
        cells: timeCells, empty: grid.max || slotPartial.size ? '' : '当前范围暂无按小时的用量。',
        peakSlot: grid.peak ? grid.peak.weekday + ':' + grid.peak.hour : null,
        stats: [{ label: '活跃', value: String([...cal.totals.values()].filter(value => value > 0).length) + ' 天' },
          { label: '当前连续', value: runs.current + ' 天' }, { label: '最长连续', value: runs.longest.length + ' 天',
            title: runs.longest.from ? runs.longest.from + ' 至 ' + runs.longest.to : '' },
          ...(peak ? [{ label: '高峰三小时', value: pad(peak.start) + '–' + (peak.end ? pad(peak.end) : '24') + ' 点',
            title: '这三个小时占范围内 ' + (peak.share * 100).toFixed(0) + '% 的 token' }] : [])],
        facts: [{ label: '最集中的时段', value: grid.peak ? slotName(grid.peak.weekday, grid.peak.hour) : null },
          { label: '最活跃的星期', value: grid.peakWeekday === null ? null : weekdays[grid.peakWeekday] },
          { label: '有用量的时段', value: grid.active + ' / 168' }],
        slot: state.slot ? { key: state.slot.day + ':' + state.slot.hour, label: slotName(state.slot.day, state.slot.hour),
          tokens: tokens(slotAmount), price: price(slotAmount, '时段估算'),
          shares: insights.shares(slot, 'agent', 4).map(item => ({ key: item.key ?? 'other', name: item.key ? agents[item.key]?.name ?? item.key :
            '其他 ' + item.count + ' 个 Agent', tokens: short(item.tokens), share: percentage(item.tokenShare),
            value: item.tokens, tone: item.key ? 'agent:' + item.key : 'muted' })) } : null,
        hours: hours ? { ...hours, draw: Boolean(hours.peak) || hours.hours.some(hour => !hour.future && hour.value === null),
          facts: [{ label: '有用量的小时', value: hours.used + ' / ' + (hours.last + 1) },
          { label: '峰值', value: hours.peak ? pad(hours.peak.hour) + ':00 · ' + short(hours.peak.value) + ' Token' : null }],
          ticks: [0, 6, 12, 18, 23].map(value => ({ value, label: pad(value) })),
          hours: hours.hours.map(hour => {
            const lead = hour.value ? insights.shares(hour.items, 'agent', 1)[0] : null;
            const name = lead?.key ? agents[lead.key]?.name : null;
            return { key: hour.key, value: hour.future ? null : hour.value,
          state: hour.future ? 'future' : hour.value === null ? 'unpriced' : hour.value === 0 ? 'zero' : 'value',
          tone: hours.peak?.hour === hour.hour ? 'heat:4' : 'heat:3', mark: hours.peak?.hour === hour.hour ? 'peak' : undefined,
          label: pad(hour.hour) + ':00–' + pad(hour.hour + 1) + ':00，' + (hour.future ? '尚未到达' : hour.value === null ? '未知' : exact(hour.value) + ' Token'),
          tip: { title: pad(hour.hour) + ':00–' + pad(hour.hour + 1) + ':00',
            aside: hour.future ? '尚未到达' : hour.value === null ? '未知' : hour.value ? short(hour.value) + ' Token' : '无用量',
            note: name ? name + ' ' + percentage(lead.tokenShare) : null } };
          }) } : null },
      day: selected ? { date: selected, observed: Boolean(daySeen), tokens: daySeen ? tokens(aggregate(dayRows)) : null,
        records: daySeen ? exact(aggregate(dayRows).records) : null, price: price(aggregate(dayRows), selected + ' 估算'),
        categories: categories(dayRows), clients: clients(dayRows, selected) } : null,
      trend: { ...projection, observed: undefined, subset: undefined, aggregate: undefined, entries: trendEntries,
        x: projection.buckets.map(bucket => ({ key: projection.hourly ? String(bucket.hour) : bucket.start,
          label: projection.hourly ? bucket.label : bucket.start.slice(5), partial: bucket.partial,
          missing: !projection.hourly && bucket.start >= coverageStart && !dates(bucket.start, bucket.end).some(day => projection.observed.has(day)) })),
        readouts: projection.buckets.map((_, index) => trendReadout(index)),
        ticks: { left: axisTicks('left'), right: axisTicks('right') },
        tips: projection.buckets.map((_, index) => trendTooltip(projection, state, index, chart, display)),
        total: state.metric === 'cost' ? price(projection.aggregate, '区间估算').lower : tokens(projection.aggregate),
        rangeLabel: state.trendRange ? projection.start === projection.end ? projection.start.slice(5) :
          projection.start.slice(5) + ' – ' + projection.end.slice(5) : periodLabel,
        coverage: projection.aggregate.coverage === null ? null : (projection.aggregate.coverage * 100).toFixed(1) + '%',
        empty: trendEntries.some(entry => entry.values.some(known)) ? '' : state.display === 'average' && projection.subset.length ?
          '30 日均需要近 30 天里至少 ' + math.AVERAGE_MIN + ' 个有记录的日期，这个区间里还没有。' : '此筛选条件下没有可用数据。',
        facts: [{ label: projection.hourly ? projection.start === today ? '较昨天同时段' : '较前一天' : !state.trendRange && state.period === 'all' ?
          '近 30 天较前 30 天' : '较上一区间', value: signed(insights.change(now, then)) },
          { label: projection.hourly ? '峰值时段' : '峰值日', value: trendPeak ? (state.metric === 'cost' ? display.usd(trendPeak[1]) : short(trendPeak[1])) +
            ' · ' + (projection.hourly ? pad(trendPeak[0]) + ':00' : trendPeak[0].slice(5)) : null,
            day: trendPeak ? projection.hourly ? projection.start : trendPeak[0] : null },
          { label: '主力模型', value: lead && lead[1] > 0 ? displayModel(lead[0]) + ' · ' + (lead[1] / leadTotal * 100).toFixed(0) + '%' : null,
            title: lead ? displayModel(lead[0]) : '' },
          { label: '单次调用 Token', value: perRecord === null ? null : short(Math.round(perRecord)),
            title: '范围内平均每条记录的 Token，一条记录约为一次模型调用' }] },
      agents: agentItems, sources: [{ value: 'all', label: '全部来源' }, ...sourceOptions.map(value => ({ value,
        label: value === 'unknown' ? '来源未报告' : value }))],
      models: [{ value: 'all', label: '全部模型' }, ...modelOptions.map(value => ({ value, label: displayModel(value) }))],
      sourceCount: Object.keys(agents).filter(id => sources?.some(source => source.agent === id && source.observedRecords > 0)).length,
      sourceMarks: Object.entries(agents).map(([id, meta]) => { const source = sources?.find(item => item.agent === id);
        return { id, name: meta.name, idle: Boolean(source) && !(source.observedRecords > 0),
          title: meta.name + (source ? ' · ' + (source.observedRecords > 0 ? source.observedRecords.toLocaleString('zh-CN') + ' 条已读取记录' : '未检测到本机记录') : '') }; }),
    };
  }
  return { sum, reported, aggregate, filterRows, within, shift, dates, dayCount, weekday, previousWindow,
    dayTotals, strip, level, calendar, dayHours, slotName, slotRows, trend, short, displayModel, modelTone, trendTooltip, project };
});
