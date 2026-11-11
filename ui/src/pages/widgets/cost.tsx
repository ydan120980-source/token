import { useMemo, type ReactNode } from "react";
import { AgentMark, Segmented, TipCard, WidgetColumns, WidgetDetails, WidgetFigure, WidgetMonthLine, WidgetPill, WidgetShares, widgetTone, type ChartTone, type DetailRow } from "@ui/kit";
import { getGlobals } from "@ui/data";
import type { UsageRow } from "@ui/data";
import { useUsage } from "@ui/data/widget-data";
import { changeWidgets } from "@ui/data/widgets";
import { type WidgetProps, agentName, frame, money, percent, short } from "./shared";
import { lastDays, md, shift } from "./dates";

const KINDS = [["inputUncached", "输入"], ["output", "输出"], ["cacheRead", "缓存读取"], ["cacheWrite", "缓存写入"]] as const;
const scoped = (rows: UsageRow[], agent: string) => agent === "all" ? rows : rows.filter(row => row.agent === agent);
const upperText = (lower: number | null, upper: number | null) => lower !== null && upper !== null && upper > lower + 0.005 ? "– " + money(upper) : undefined;
const unpriced = (rows: UsageRow[]) => rows.reduce((sum, row) => sum + Math.max(0, row.totalTokens - row.pricedTokens), 0);

function Empty({ text }: { text: string }) { return <p className="text-caption text-muted-foreground" data-widget-empty>{text}</p>; }

// 本月至今: the month's estimate so far, the change against the same days last month (neutral), and the running line.
export function CostMonth({ config }: WidgetProps) {
  const usage = useUsage();
  const view = useMemo(() => {
    if (!usage?.today) return null;
    const rows = scoped(usage.rows, config.agent), today = usage.today, insights = getGlobals().costInsights;
    const month = insights.months(rows, { today })[0];
    if (!month) return null;
    const start = today.slice(0, 8) + "01", days = Number(shift(shift(start, 32).slice(0, 8) + "01", -1).slice(8, 10));
    const run = (from: string, count: number) => { let total: number | null = null; return Array.from({ length: count }, (_, index) => { const date = shift(from, index), day = rows.filter(row => row.date === date && row.estimatedCostUsd !== null); if (day.length) total = (total ?? 0) + day.reduce((sum, row) => sum + row.estimatedCostUsd!, 0); return total; }); };
    const elapsed = Number(today.slice(8, 10)), before = shift(start, -1).slice(0, 8) + "01";
    const previousRows = rows.filter(row => row.date >= before && row.date < start && Number(row.date.slice(8, 10)) <= elapsed && row.estimatedCostUsd !== null);
    return { month, days, current: run(start, elapsed), previous: run(before, elapsed), previousTotal: previousRows.length ? previousRows.reduce((sum, row) => sum + row.estimatedCostUsd!, 0) : null, missing: unpriced(rows.filter(row => row.date >= start)) };
  }, [usage, config.agent]);
  if (!view) return frame(config, { title: "本月至今" }, <Empty text="本月还没有记录" />);
  const { month } = view, delta = month.delta === null ? null : <WidgetPill>比上月同期 {month.delta >= 0 ? "↑" : "↓"}{Math.abs(Math.round(month.delta * 100))}%</WidgetPill>;
  return frame(config, { title: "本月至今", meta: delta }, config.size === "s" ? <WidgetFigure size="md" value={month.lower === null ? "未计价" : money(month.lower)} after={upperText(month.lower, month.upper)} /> : <>
    <WidgetFigure value={month.lower === null ? "未计价" : money(month.lower)} after={upperText(month.lower, month.upper)} />
    <WidgetMonthLine aria-label="本月累计花费" current={view.current} previous={view.previous} projection={month.projection?.lower ?? null} days={view.days} tone={config.color === "agent" ? "ink:1" : widgetTone(config.color, 0)} />
    <WidgetDetails aria-label="本月明细" rows={[
      ...month.projection ? [{ key: "projection", name: "推算整月", value: money(month.projection.lower) + (month.projection.upper > month.projection.lower + 0.005 ? " – " + money(month.projection.upper).replace("$", "") : "") }] : [],
      ...view.previousTotal !== null ? [{ key: "previous", name: "上月同期", value: money(view.previousTotal) }] : [],
      ...view.missing > 0 ? [{ key: "missing", name: "未计入", value: short(view.missing) + " Token" }] : [],
    ]} />
  </>);
}

// 每天花费: stacked columns per day by Agent, hatched under the axis when some of that day's Token are unpriced.
export function CostDaily({ config }: WidgetProps) {
  const usage = useUsage(), count = Number(config.period ?? "14");
  const view = useMemo(() => {
    if (!usage?.today) return null;
    const dates = lastDays(usage.today, count), rows = scoped(usage.rows, config.agent).filter(row => row.date >= dates[0]);
    const agents = [...new Set(rows.map(row => row.agent))].sort((a, b) => rows.filter(row => row.agent === b).reduce((s, r) => s + (r.estimatedCostUsd ?? 0), 0) - rows.filter(row => row.agent === a).reduce((s, r) => s + (r.estimatedCostUsd ?? 0), 0));
    const sum = (list: UsageRow[], field: "estimatedCostUsd" | "estimatedCostUpperUsd") => { const known = list.filter(row => row[field] !== null); return known.length ? known.reduce((s, row) => s + row[field]!, 0) : null; };
    const byAgent = agents.map(agent => { const own = rows.filter(row => row.agent === agent); return { agent, lower: sum(own, "estimatedCostUsd"), upper: sum(own, "estimatedCostUpperUsd"), missing: unpriced(own), models: [...new Set(own.map(row => row.model))] }; });
    const columns: { key: string; label: string; detail?: ReactNode; under: boolean; segments: { key: string; tone: ChartTone; value: number }[] }[] = dates.map(date => ({ key: date, label: md(date), under: rows.some(row => row.date === date && row.totalTokens > row.pricedTokens), segments: agents.map((agent, index) => ({ key: agent, tone: widgetTone(config.color, index, agent), value: rows.filter(row => row.date === date && row.agent === agent).reduce((s, row) => s + (row.estimatedCostUsd ?? 0), 0) })) }));
    for (const column of columns) {
      const parts = column.segments.filter(segment => segment.value > 0);
      column.detail = <TipCard title={column.label} aside={money(parts.reduce((s, segment) => s + segment.value, 0))} note={column.under ? "另有未计价的用量" : undefined}
        rows={parts.map(segment => ({ key: segment.key, label: agentName(segment.key), value: money(segment.value), tone: segment.tone }))} />;
    }
    return { dates, columns, byAgent, lower: sum(rows, "estimatedCostUsd"), upper: sum(rows, "estimatedCostUpperUsd") };
  }, [usage, config.agent, config.color, count]);
  const grain = <Segmented size="compact" value={String(count)} aria-label="每天花费的天数" onChange={value => changeWidgets((m, s) => m.update(s, config.key, { period: value }))} items={[{ value: "7", label: "7 天" }, { value: "14", label: "14 天" }, { value: "30", label: "30 天" }]} />;
  if (!view || !view.byAgent.length) return frame(config, { title: "每天花费", meta: config.size === "s" ? null : grain }, <Empty text={"近 " + count + " 天没有记录"} />);
  const label = view.columns.map(column => column.label + " " + money(column.segments.reduce((s, segment) => s + segment.value, 0))).join("，");
  return frame(config, { title: "每天花费", sub: config.size === "s" ? "近 " + count + " 天 · " + money(view.lower) : undefined, meta: config.size === "s" ? null : grain }, config.size === "s" ?
    <WidgetColumns height={48} columns={view.columns} aria-label={label} /> : <>
    <WidgetFigure value={view.lower === null ? "未计价" : money(view.lower)} after={upperText(view.lower, view.upper)} />
    <WidgetColumns height={112} columns={view.columns} aria-label={label} />
    <span className="flex justify-between text-micro text-muted-foreground"><span>{md(view.dates[0])}</span><span>{md(view.dates.at(-1)!)}</span></span>
    <WidgetDetails aria-label="按 Agent" rows={view.byAgent.map((item, index): DetailRow => ({
      key: item.agent, tone: widgetTone(config.color, index, item.agent), name: agentName(item.agent), value: item.lower === null ? "未计价" : money(item.lower) + (item.missing ? "+" : ""),
      share: view.lower && item.lower !== null ? percent(item.lower, view.lower) : undefined, open: config.size === "l" && index === 0,
      sub: [...item.models.slice(0, 4).map(model => ({ key: model, name: model, value: "" })), ...item.missing ? [{ key: "missing", name: "未计入", value: short(item.missing) + " Token" }] : []],
    }))} />
  </>);
}

// 花在哪: one row per Agent with its main model, the shares as one bar, each row opening to its kinds of Token.
export function CostWhere({ config }: WidgetProps) {
  const usage = useUsage(), period = config.period ?? "month";
  const view = useMemo(() => {
    if (!usage?.today) return null;
    const from = period === "month" ? usage.today.slice(0, 8) + "01" : shift(usage.today, -Number(period) + 1);
    const rows = scoped(usage.rows, config.agent).filter(row => row.date >= from), items = getGlobals().costTable.table(rows, { by: "agent" });
    return items.filter(item => item.agent).sort((a, b) => (b.lower ?? -1) - (a.lower ?? -1) || b.tokens - a.tokens).slice(0, config.size === "s" ? 2 : 5).map(item => {
      const own = rows.filter(row => row.agent === item.agent), tokens = own.reduce((s, row) => s + row.totalTokens, 0);
      const models = [...own.reduce((map, row) => map.set(row.model, (map.get(row.model) ?? 0) + row.totalTokens), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
      const kinds = KINDS.map(([field, name]) => { const known = own.filter(row => row[field] !== null); return { field, name, value: known.length ? known.reduce((s, row) => s + row[field]!, 0) : null }; });
      return { agent: item.agent!, lower: item.lower, tokens, model: models[0]?.[0] ?? null, kinds };
    });
  }, [usage, config.agent, config.size, period]);
  const title = period === "month" ? "本月" : "近 " + period + " 天";
  if (!view?.length) return frame(config, { title: "花在哪", sub: title }, <Empty text="这段时间没有记录" />);
  const total = view.reduce((s, item) => s + (item.lower ?? 0), 0);
  return frame(config, { title: "花在哪", sub: title }, config.size === "s" ? <div className="flex flex-col gap-2">
    {view.map(item => <span key={item.agent} className="flex items-center gap-2 text-body"><AgentMark agent={item.agent} variant="icon" size={16} /><span className="flex-1 truncate">{agentName(item.agent)}</span><span className="text-caption tabular-nums text-muted-foreground">{short(item.tokens)} · <b className="font-semibold text-foreground">{money(item.lower)}</b></span></span>)}
  </div> : <>
    <WidgetShares aria-label={view.map(item => agentName(item.agent) + " " + money(item.lower)).join("，")} segments={view.map((item, index) => ({ key: item.agent, value: item.lower ?? 0, tone: widgetTone(config.color, index, item.agent), label: agentName(item.agent) + " " + money(item.lower) }))} />
    <WidgetDetails aria-label="各 Agent 的构成" rows={view.map((item, index): DetailRow => {
      const known = item.kinds.reduce((s, kind) => s + (kind.value ?? 0), 0);
      return { key: item.agent, lead: <AgentMark agent={item.agent} variant="icon" size={16} />, name: agentName(item.agent), value: short(item.tokens) + " · " + money(item.lower), share: total ? percent(item.lower ?? 0, total) : undefined, open: index === 0 && config.size === "l",
        sub: [...item.model ? [{ key: "model", name: "模型", value: item.model }] : [], ...item.kinds.map((kind, at) => ({ key: kind.field, name: kind.name, value: kind.value === null ? "未报告" : percent(kind.value, known), fraction: kind.value === null || !known ? null : kind.value / known, tone: widgetTone(config.color === "agent" ? "mono" : config.color, at) }))] };
    })} />
  </>);
}
