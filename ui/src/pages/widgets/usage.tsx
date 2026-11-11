import { useMemo } from "react";
import { Segmented, WidgetDetails, WidgetFigure, WidgetHeat, WidgetLine, WidgetPill, WidgetShares, widgetTone, type DetailRow } from "@ui/kit";
import type { UsageRow } from "@ui/data";
import { useUsage } from "@ui/data/widget-data";
import { changeWidgets } from "@ui/data/widgets";
import { type WidgetProps, agentName, frame, money, percent, short } from "./shared";
import { WEEKDAYS, lastDays, md, shift, weekday } from "./dates";

const KINDS = [["inputUncached", "输入"], ["output", "输出"], ["cacheRead", "缓存读取"], ["cacheWrite", "缓存写入"]] as const;
const scoped = (rows: UsageRow[], agent: string) => agent === "all" ? rows : rows.filter(row => row.agent === agent);
const tokens = (rows: UsageRow[]) => rows.reduce((sum, row) => sum + row.totalTokens, 0);
const cost = (rows: UsageRow[]) => { const known = rows.filter(row => row.estimatedCostUsd !== null); return known.length ? known.reduce((sum, row) => sum + row.estimatedCostUsd!, 0) : null; };
/** A kind of Token summed over the rows that report it; null when none does. */
const kind = (rows: UsageRow[], field: typeof KINDS[number][0]) => { const known = rows.filter(row => row[field] !== null); return known.length ? known.reduce((sum, row) => sum + row[field]!, 0) : null; };
const kindTone = (mode: WidgetProps["config"]["color"], index: number) => widgetTone(mode === "agent" ? "mono" : mode, index);

function Empty({ text }: { text: string }) { return <p className="text-caption text-muted-foreground" data-widget-empty>{text}</p>; }

// 今天: Token and cost side by side, the kinds of Token as one bar, each kind opening to its Agents.
export function UsageToday({ config }: WidgetProps) {
  const usage = useUsage();
  const view = useMemo(() => {
    if (!usage?.today) return null;
    const all = scoped(usage.rows, config.agent), rows = all.filter(row => row.date === usage.today), yesterday = all.filter(row => row.date === shift(usage.today!, -1));
    const kinds = KINDS.map(([field, name]) => ({ field, name, value: kind(rows, field), agents: [...new Set(rows.map(row => row.agent))].map(agent => ({ agent, value: kind(rows.filter(row => row.agent === agent), field) })).filter(item => item.value).sort((a, b) => b.value! - a.value!) }));
    return { today: usage.today, total: tokens(rows), cost: cost(rows), yesterday: yesterday.length ? tokens(yesterday) : null, kinds, known: kinds.reduce((sum, item) => sum + (item.value ?? 0), 0), any: rows.length > 0 };
  }, [usage, config.agent]);
  const sub = view ? Number(view.today.slice(5, 7)) + " 月 " + Number(view.today.slice(8, 10)) + " 日" : undefined;
  if (!view) return frame(config, { title: "今天" }, <Empty text="还没有记录" />);
  // Token on its own line and the cost under it: two large figures side by side collide as soon as a value grows.
  const figures = config.size === "s" ? <div className="flex flex-wrap items-baseline justify-between gap-x-3">
    <WidgetFigure size="md" value={short(view.total)} /><WidgetFigure size="md" value={view.any ? money(view.cost) : "—"} />
  </div> : <div className="flex flex-col gap-1">
    <WidgetFigure value={short(view.total)} after="Token" />
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <WidgetFigure size="md" value={view.any ? money(view.cost) : "—"} after="估算费用" />
      {view.yesterday !== null ? <span className="text-caption text-muted-foreground">昨天 {short(view.yesterday)}</span> : null}
    </div>
  </div>;
  return frame(config, { title: "今天", sub, meta: config.agent === "all" ? "全部 Agent" : agentName(config.agent) }, config.size === "s" || !view.any ? figures : <>
    {figures}
    <WidgetShares aria-label={view.kinds.map(item => item.name + " " + short(item.value)).join("，")} segments={view.kinds.map((item, index) => ({ key: item.field, value: item.value ?? 0, tone: kindTone(config.color, index), label: item.name + " " + short(item.value) }))} />
    <WidgetDetails aria-label="今天的 Token 类型" rows={view.kinds.map((item, index): DetailRow => ({
      key: item.field, tone: kindTone(config.color, index), name: item.name, value: item.value === null ? "未报告" : short(item.value), share: item.value === null ? undefined : percent(item.value, view.known), open: config.size === "l" && index === 2,
      sub: item.agents.length > 1 ? item.agents.map((entry, at) => ({ key: entry.agent, name: agentName(entry.agent), value: short(entry.value), fraction: entry.value! / item.value!, tone: widgetTone(config.color, at, entry.agent) })) : [],
    }))} />
  </>);
}

// 用量日历: the last six months (three when small) as a calendar, darker for more Token.
export function UsageHeatmap({ config }: WidgetProps) {
  const usage = useUsage(), weeks = config.size === "s" ? 13 : 26;
  const view = useMemo(() => {
    if (!usage?.today) return null;
    const end = shift(usage.today, 6 - weekday(usage.today)), dates = lastDays(end, weeks * 7), rows = scoped(usage.rows, config.agent);
    const totals = new Map<string, number>();
    for (const row of rows) if (row.date >= dates[0]) totals.set(row.date, (totals.get(row.date) ?? 0) + row.totalTokens);
    const sorted = [...totals.values()].filter(value => value > 0).sort((a, b) => a - b), cut = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
    const level = (value: number): 0 | 1 | 2 | 3 | 4 => value <= 0 ? 0 : value <= cut(0.25) ? 1 : value <= cut(0.5) ? 2 : value <= cut(0.75) ? 3 : 4;
    const cells = dates.map(date => ({ key: date, level: date > usage.today! ? null : level(totals.get(date) ?? 0), label: md(date) + " " + short(totals.get(date) ?? 0) + " Token" }));
    const days = [...totals].filter(([, value]) => value > 0), best = days.sort((a, b) => b[1] - a[1])[0];
    const byWeekday = WEEKDAYS.map((name, index) => ({ name, value: [...totals].filter(([date]) => weekday(date) === index).reduce((sum, [, value]) => sum + value, 0) }));
    return { cells, total: [...totals.values()].reduce((a, b) => a + b, 0), best, average: days.length ? [...totals.values()].reduce((a, b) => a + b, 0) / days.length : null, byWeekday };
  }, [usage, config.agent, weeks]);
  if (!view) return frame(config, { title: "用量日历" }, <Empty text="还没有记录" />);
  const top = Math.max(...view.byWeekday.map(item => item.value), 0), busiest = view.byWeekday.find(item => item.value === top && top > 0);
  return frame(config, { title: "用量日历", sub: weeks === 26 ? "近 6 个月" : "近 3 个月", meta: <span><b className="font-semibold text-foreground">{short(view.total)}</b> Token</span> }, <>
    <WidgetHeat weeks={weeks} cells={view.cells} mode={config.color} aria-label={"近 " + weeks + " 周每天的 Token"} />
    {config.size === "s" ? null : <WidgetDetails aria-label="用量日历明细" rows={[
      ...view.best ? [{ key: "best", name: "最多的一天", value: md(view.best[0]) + " " + WEEKDAYS[weekday(view.best[0])] + " · " + short(view.best[1]) }] : [],
      ...view.average !== null ? [{ key: "average", name: "平均每天", value: short(view.average) }] : [],
      ...busiest ? [{ key: "weekday", name: "按星期", value: busiest.name + "最多", open: config.size === "l", sub: view.byWeekday.map(item => ({ key: item.name, name: item.name, value: short(item.value), fraction: top ? item.value / top : 0, tone: widgetTone(config.color === "agent" ? "mono" : config.color, 1) })) }] : [],
    ]} />}
  </>);
}

// 近 7 天: a smooth line of Token or cost per day with the peak marked.
export function UsageWeek({ config }: WidgetProps) {
  const usage = useUsage(), metric = config.period === "cost" ? "cost" : "tokens";
  const view = useMemo(() => {
    if (!usage?.today) return null;
    const dates = lastDays(usage.today, 7), rows = scoped(usage.rows, config.agent);
    const values = dates.map(date => { const day = rows.filter(row => row.date === date); return metric === "cost" ? (day.length ? cost(day) : 0) : tokens(day); });
    return { dates, values, total: values.every(value => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0) };
  }, [usage, config.agent, metric]);
  const format = (value: number | null) => metric === "cost" ? money(value) : short(value);
  const pick = <Segmented size="compact" value={metric} aria-label="近 7 天的指标" onChange={value => changeWidgets((m, s) => m.update(s, config.key, { period: value }))} items={[{ value: "tokens", label: "Token" }, { value: "cost", label: "费用" }]} />;
  if (!view) return frame(config, { title: "近 7 天", meta: pick }, <Empty text="还没有记录" />);
  const tone = config.color === "agent" ? "ink:1" as const : widgetTone(config.color, 0);
  return frame(config, { title: "近 7 天", meta: pick }, <>
    <WidgetLine height={config.size === "s" ? 64 : 96} values={view.values} tone={tone} peakLabel={format} aria-label={view.dates.map((date, index) => md(date) + " " + format(view.values[index])).join("，")} />
    <span className="flex justify-between text-micro text-muted-foreground">{[0, 2, 4, 6].map(index => <span key={index}>{md(view.dates[index])}</span>)}</span>
    {config.size === "s" ? null : <WidgetDetails aria-label="近 7 天明细" rows={[
      { key: "total", name: "合计", value: format(view.total) + (metric === "tokens" ? " Token" : "") },
      { key: "days", name: "每天", value: "", open: config.size === "l", sub: view.dates.map((date, index) => ({ key: date, name: md(date) + " " + WEEKDAYS[weekday(date)], value: format(view.values[index]), fraction: view.values[index] === null ? null : view.values[index]! / Math.max(...view.values.map(value => value ?? 0), 1), tone })) },
    ]} />}
  </>);
}

// 最近 24 小时: Token per hour from the saved hourly rows, with whether collection is on. "采集中" says
// only that collection is enabled; the rows are as fresh as the last collection.
export function UsageLive({ config }: WidgetProps) {
  const usage = useUsage();
  const view = useMemo(() => {
    if (!usage?.today) return null;
    const now = new Date(), hours = Array.from({ length: 24 }, (_, index) => { const at = new Date(now.getTime() - (23 - index) * 36e5); const date = at.getFullYear() + "-" + String(at.getMonth() + 1).padStart(2, "0") + "-" + String(at.getDate()).padStart(2, "0"); return { date, hour: at.getHours() }; });
    const rows = scoped(usage.hourly, config.agent).filter(row => hours.some(hour => hour.date === row.date && hour.hour === row.hour));
    const values = hours.map(hour => rows.filter(row => row.date === hour.date && row.hour === hour.hour).reduce((sum, row) => sum + row.totalTokens, 0));
    const agents = [...new Set(rows.map(row => row.agent))].map(agent => ({ agent, value: tokens(rows.filter(row => row.agent === agent)) })).sort((a, b) => b.value - a.value);
    return { values, agents, total: tokens(rows), latest: [...rows].sort((a, b) => (b.date + String(b.hour).padStart(2, "0")).localeCompare(a.date + String(a.hour).padStart(2, "0")))[0] ?? null, collection: usage.collection };
  }, [usage, config.agent]);
  const pill = view ? <WidgetPill tone={view.collection.enabled ? "live" : "neutral"}>{view.collection.collecting ? "正在采集" : view.collection.enabled ? "采集中" : "已暂停"}</WidgetPill> : null;
  if (!view) return frame(config, { title: "最近 24 小时" }, <Empty text="还没有记录" />);
  const last = view.values[23], before = view.values[22], tone = config.color === "agent" ? widgetTone("agent", 0, view.agents[0]?.agent ?? null) : widgetTone(config.color, 0);
  return frame(config, { title: "最近 24 小时", meta: pill }, <>
    <WidgetFigure value={short(view.total)} after="Token" />
    {config.size === "s" ? null : <>
      <WidgetLine height={80} values={view.values} tone={tone} area={false} aria-label={"最近 24 小时每小时的 Token，本小时 " + short(last) + "，上一小时 " + short(before)} />
      <span className="flex justify-between text-micro text-muted-foreground"><span>24 小时前</span><span>12 小时前</span><span>本小时</span></span>
      <WidgetDetails aria-label="最近 24 小时明细" rows={[
        { key: "agents", name: "按 Agent", value: view.agents.length + " 个", sub: view.agents.map((item, index) => ({ key: item.agent, name: agentName(item.agent), value: percent(item.value, view.total), fraction: view.total ? item.value / view.total : 0, tone: widgetTone(config.color, index, item.agent) })) },
        ...view.latest ? [{ key: "latest", name: "最近一条记录", value: String(view.latest.hour).padStart(2, "0") + ":00 · " + agentName(view.latest.agent) }] : [],
      ]} />
    </>}
  </>);
}
