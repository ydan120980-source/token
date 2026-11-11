import { useEffect, useState } from "react";
import {
  AgentMark, BarChart, Button, Card, ChartLegend, EmptyState, Figure, LineChart,
  RingChart, Segmented, Value, ScrollArea } from "@ui/kit";
import type { ChartTone } from "@ui/kit";
import type { CostHost, CostSnapshot, CostTrend } from "@ui/data/cost-host";
import { useCostWidth } from "./layout";
import { CostAmount } from "./amount";

const statusNote = (text: string) => text;

export function Trend({ host, snapshot }: { host: CostHost; snapshot: CostSnapshot }) {
  const [active, setActive] = useState<number | null>(null), [pinned, setPinned] = useState<number | null>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const { state, view } = snapshot, trend = view.trend;
  // Every switch above the chart (range, grain, Agent, daily/cumulative, area/line) redraws it from the left.
  const key = [view.span.from, view.span.to, state.grain, [...(state.agents ?? [])].join(), state.trend, state.chartView].join("/");
  useEffect(() => { setActive(null); setPinned(null); setRange(null); }, [key]);
  const read = trend ? host.model.trendView(trend, active ?? pinned) : null;
  const note = read ? statusNote(read.note) : "";
  const grain = trend?.monthly ? "month" : trend?.weekly ? "week" : "day";
  const each = { day: "每日", week: "每周", month: "每月" }[grain];
  const apply = ([a, b]: [number, number]) => {
    if (trend?.buckets[a] && trend.buckets[b]) host.selectRange(trend.buckets[a].date, trend.buckets[b].end);
  };
  const tooltip = (index: number) => {
    const point = host.model.trendView(trend as CostTrend, index);
    return <>
      <strong>{point.when}</strong>
      <span>
        <Value value={point.total} />
      </span>
    </>;
  };
  return <section
      data-cost-trend
      onPointerDownCapture={event => {
        if (!(event.target as Element).closest('[data-chart="line"]')) setPinned(null);
      }}
      onClickCapture={event => {
        if (state.trend === "cumulative" && (event.target as Element).closest('[data-chart="line"]')) {
          event.preventDefault(); event.stopPropagation();
        }
      }}>
      <Card>
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-subtitle font-semibold text-foreground">{"费用走势"}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={grain}
              onChange={grain => host.set({ grain })}
              size="compact"
              aria-label="走势时间粒度"

              items={[{ value: "day", label: "日" }, { value: "week", label: "周" }, { value: "month", label: "月" }]} />
            <Segmented
              value={state.trend}
              onChange={trend => host.set({ trend })}
              size="compact"
              aria-label="走势数值"

              items={[{ value: "daily", label: each }, { value: "cumulative", label: "累计" }]} />
            <Segmented
              value={state.chartView}
              onChange={chartView => host.set({ chartView })}
              size="compact"
              aria-label="图表样式"

              items={[{ value: "area", label: "面积" }, { value: "line", label: "折线" }]} />
          </div>
        </header>{trend && read?.known ?
          <>
            <div data-cost-trend-readout className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-caption text-muted-foreground tabular-nums">{read.when}</span>
              <b className="text-figure-sm font-semibold text-foreground tabular-nums">
                <Value value={read.total} unknown="—" />
              </b>
              <small className="text-caption text-muted-foreground">{note}</small>{view.span.from ?
                <Button variant="ghost" size="compact" onClick={() => host.period("all")}>{"回到累计"}</Button> : null}
            </div>
            <div data-cost-trend-legend>
              <ChartLegend
                variant="inline"
                minVisible={1}
                onToggle={host.toggleSeries}

                items={read.legend.map(item => ({
                  ...item, note:
                    <span data-series-value={item.key}>{item.value}</span>,
                  title: (item.hidden ? "显示 " : "隐藏 ") + item.label,
                }))} />
            </div>
            <div className="min-w-0">
              <LineChart
                palette="cost"
                variant="stack"
                x={trend.buckets.map(bucket => ({
                  key: bucket.date, label: bucket.date.slice(5).replace("-", "/"), partial: bucket.partial,
                  missing: !Object.keys(bucket.values).length,
                }))}

                series={read.drawn}
                hidden={read.legend.filter(item => item.hidden).map(item => item.key)}
                stacked={state.chartView !== "line"}
                ticks={{ left: read.ticks }}

                active={active}
                onActiveChange={setActive}
                pinned={pinned}
                onPinnedChange={setPinned}

                range={range}
                onRangeChange={setRange}
                onApplyRange={apply}

                onSelect={index => apply([index, index])}
                tooltip={tooltip}
                dataKey={key}

                aria-label={state.trend === "cumulative" ? "累计估算" : "费用走势"} />
            </div>
          </> :
          <EmptyState message="当前范围没有已计入估算的用量。" />}
      </Card>
    </section>;
}
export function Composition({ host, snapshot, hidden: concealed = false }: {
  host: CostHost; snapshot: CostSnapshot; hidden?: boolean;
}) {
  const { ref, width } = useCostWidth();
  const [active, setActive] = useState<string | null>(null), [hidden, setHidden] = useState<string[]>([]);
  const { view, state } = snapshot, comp = view.composition;
  const key = [state.compBy, view.span.from, view.span.to, [...(state.agents ?? [])].join()].join("/");
  useEffect(() => { setHidden([]); setActive(null); }, [key]);
  const read = host.model.donutReadout(comp, hidden, active);
  const tone = (key: string): ChartTone => state.compBy === "kind" ? ("cost:" + key) as ChartTone : `series:${key}`;
  const toggle = (key: string) => setHidden(items => {
    if (items.includes(key)) return items.filter(item => item !== key);
    return comp.items.filter(item => item.value !== null && item.value > 0 && !items.includes(item.key)).length > 1 ?
      [...items, key] : items;
  });
  const total = comp.items.filter(item => item.value !== null && item.value > 0 && !hidden.includes(item.key))
    .reduce((sum, item) => sum + item.value!, 0);
  return <div
    ref={ref}
    data-cost-composition
    data-cost-section="composition"
    
    className="flex min-h-0 flex-1 flex-col gap-4"
    hidden={concealed}>
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        value={state.compBy}
        onChange={compBy => host.set({ compBy })}
        size="compact"
        aria-label="按什么看"

        items={[{ value: "agent", label: "Agent" }, { value: "kind", label: "类型" }]} />
      <Segmented
        value={state.ring}
        onChange={ring => host.set({ ring })}
        size="compact"
        aria-label="圆环形状"

        items={[{ value: "full", label: "圆环" }, { value: "semi", label: "半环" }]} />
    </div>{view.comp.lower === null ?
      <EmptyState message="当前范围没有计入估算的用量。" /> :
      <div className={"flex min-h-0 flex-1 gap-6 " + (width >= 600 ? "items-center" : "flex-col items-center")} data-shape={state.ring}>
        <RingChart
          trackTone="cost:track"
          variant="donut"
          size={width >= 400 ? "donut" : "donutCompact"}

          shape={state.ring === "semi" ? "half" : "full"}

          segments={comp.items.filter(item => item.value !== null && item.value > 0).map(item => ({
            key: item.key, value: hidden.includes(item.key) ? 0 : item.value!, tone: tone(item.key), label: item.name,
          }))}

          active={active}
          onActiveChange={setActive}
          onSelect={toggle}
          dataKey={key}

          center={
            <>
              <small>{read.label}</small>
              <b>
                <Figure size="sm" text={read.value} unknown="未计入" />
              </b>
            </>}
          detail={read.detail ? <span>{read.detail}</span> : undefined}

          aria-label={"已计价 " + host.model.money(view.comp.lower)} />
        <div className={"flex min-h-0 w-full min-w-0 flex-1 flex-col " + (width >= 600 ? "self-stretch" : "")} data-cost-composition-agents>
          <ScrollArea maxHeight="fill" aria-label="各项费用">
          <ChartLegend
            variant="tiles"
            minVisible={1}
            onToggle={toggle}
            active={active}
            onActiveChange={setActive}

            items={comp.items.map(item => ({
              key: item.key, label: item.name, tone: tone(item.key), hidden: hidden.includes(item.key),
              lead: state.compBy === "agent" && window.agentCatalog?.agents[item.key] ? <AgentMark agent={item.key} variant="icon" size={16} /> : undefined,
              disabled: item.value === null || item.value <= 0,
              note:
                <>
                  <b className="font-semibold text-foreground tabular-nums">
                    <Value value={item.value === null ? null : host.model.money(item.value)} unknown="未计入" />
                  </b>
                  <em className="not-italic text-muted-foreground tabular-nums">{item.value !== null && item.value > 0 && !hidden.includes(item.key) && total > 0 ?
                    host.model.pct(item.value / total) : "—"}</em>
                </>,
              title: item.name + " · " + item.detail,
              ariaLabel: item.name + " " + (item.value === null ? "未计入" : host.model.money(item.value)) + " · " + item.detail,
            }))} />
          </ScrollArea>
        </div>
      </div>}{read.note ?
        <p className="text-caption text-muted-foreground">{read.note}</p> : null}
  </div>;
}
export function Months({ host, snapshot }: { host: CostHost; snapshot: CostSnapshot }) {
  const [active, setActive] = useState<string | null>(null), [hidden, setHidden] = useState<string[]>([]);
  const { state, view } = snapshot, read = host.model.monthView(view.list, view.all, hidden, active);
  const toggle = (key: string) => setHidden(items => items.includes(key) ? items.filter(item => item !== key) : [...items, key]);
  const note = [read.note || (active === null && state.month ? "已筛选这个月" : ""), read.left]
    .filter(Boolean).join(" · ");
  return <div data-cost-months className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-caption text-muted-foreground">{view.list.length}{" 个月合计 "}
        <b className="font-semibold text-foreground tabular-nums">
          <CostAmount text={view.monthsTotal} />
        </b>
      </span>
      <Segmented
        value={state.bars}
        onChange={bars => host.set({ bars })}
        size="compact"
        aria-label="月度柱图布局"

        items={[{ value: "grouped", label: "分组" }, { value: "stacked", label: "堆叠" }]} />
    </div>{read.groups.length ?
      <BarChart
        variant="months"
        height="months"
        groups={read.groups}
        ticks={read.ticks}

        layout={state.bars}
        selected={state.month}
        hidden={hidden}
        active={active}
        onActiveChange={setActive}

        onSelect={host.month}
        aria-label="按月的费用估算"

        readout={
          <>
            <header data-cost-month-readout className="flex flex-wrap items-baseline gap-x-3 gap-y-1" aria-live="polite">
              <span className="text-caption text-muted-foreground">{read.when}</span>
              <b className="text-figure-sm font-semibold text-foreground tabular-nums">
                <CostAmount text={read.total ?? "未计入"} />
              </b>
              <small className="text-caption text-muted-foreground">{note}</small>
            </header>
          </>} /> :
      <EmptyState message="暂无记录。" />}{read.groups.length ?
        <ChartLegend
          variant="inline"
          minVisible={1}
          onToggle={toggle}

          items={read.legend.map(item => ({ ...item, note: item.value ?? "—" }))} /> : null}{view.list.length > 12 ?
            <Button variant="ghost" size="compact" onClick={() => host.set({ monthsAll: !state.monthsAll })}>
              {state.monthsAll ? "只看最近 12 个月" : "显示全部 " + view.list.length + " 个月"}
            </Button> : null}
  </div>;
}
