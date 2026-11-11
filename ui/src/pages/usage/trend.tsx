import { useEffect, useId, useState } from "react";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { AgentFilter, Button, Card, ChartLegend, Collapse, Combobox, DateRangePopover, EmptyState, Figure, LineChart,
  SectionHeader, Segmented, Select, TipCard, Value } from "@ui/kit";
import type { UsageHost, UsageSnapshot } from "@ui/data/usage-host";
import { Facts } from "./shared";

const presets = [
  { key: "today", label: "今天" }, { key: "7", label: "7 天" },
  { key: "30", label: "30 天" }, { key: "page", label: "跟随页面" },
];
export function Trend({ host, snapshot }: { host: UsageHost; snapshot: UsageSnapshot }) {
  const { state, view } = snapshot, { trend } = view;
  const [active, setActive] = useState<number | null>(null), [range, setRange] = useState<[number, number] | null>(null);
  const key = [state.agent, state.source, state.model, trend.start, trend.end,
    state.metric, state.mode, state.display, trend.grain].join(":");
  useEffect(() => { setActive(null); setRange(null); }, [key]);
  const readout = active === null ? null : trend.readouts[active] ?? null;
  // Source, model, value and grain change rarely, so they sit one step away; what is in force stays written out.
  const [more, setMore] = useState(false), moreId = useId();
  const applied = [
    state.source !== "all" ? view.sources.find(option => option.value === state.source)?.label : null,
    state.model !== "all" ? view.models.find(option => option.value === state.model)?.label : null,
    state.display === "average" ? "30 日均" : state.display === "total" ? "累加" : null,
    state.grain !== "auto" && !trend.hourly ? { day: "按日", week: "按周", month: "按月" }[state.grain] : null,
  ].filter(Boolean);
  return <section data-usage-trend>
    <Card>
      <SectionHeader title="用量趋势" actions={<div className="flex flex-wrap items-center justify-end gap-3">
        {state.trendRange ?
          <Button variant="ghost" onClick={() => host.set({ trendRange: null })}>{"跟随页面范围"}</Button> : null}
        <div data-usage-trend-range title={trend.start + " 至 " + trend.end}>
          <DateRangePopover
            value={{ from: trend.start, to: trend.end }}
            presets={presets}
            preset={state.trendRange ? "custom" : "page"}
            onApply={(span, preset) => preset ? host.preset(preset) :
              host.set({ trendRange: span ? { start: span.from, end: span.to } : null })}
            onReset={() => host.set({ trendRange: null })}
            maxDays={3660}
            min={snapshot.coverageStart}
            max={snapshot.today}
            triggerLabel={trend.rangeLabel}
            marks={snapshot.recorded}
            aria-label="趋势时间范围"
          />
        </div>
        <div data-usage-metric>
          <Segmented value={state.metric} onChange={metric => host.set({ metric })} aria-label="趋势指标"
            items={[{ value: "tokens", label: "Token" }, { value: "cost", label: "费用" }]} />
        </div>
      </div>} />
      <div className="flex flex-wrap items-baseline gap-3">
        <Figure text={trend.total} size="md" unit={state.metric === "tokens" ? "Token" : undefined}
          unknown={state.metric === "cost" ? "未定价" : "未知"} />
        <span className="text-caption text-muted-foreground" data-usage-trend-applied>{[trend.rangeLabel, ...applied].join(" · ")}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 max-w-full" data-usage-agents>
          <AgentFilter agents={view.agents} value={state.agent} display="icon" aria-label="用量 Agent 筛选"
            allLabel="全部 Agent" onChange={agent => host.set({ agent })} />
        </div>
        <div className="flex items-center gap-3">
          <div data-usage-trend-mode>
            <Segmented
              value={state.mode}
              onChange={mode => host.set({ mode })}
              items={state.metric === "cost" ? [{ value: "total", label: "总量" }, { value: "models", label: "模型" }] :
                [{ value: "flow", label: "构成" }, { value: "total", label: "总量" }, { value: "models", label: "模型" }]}
              aria-label="趋势构成"
            />
          </div>
          <div data-usage-trend-more data-open={more}>
            <Button variant="secondary" leadingIcon={IconAdjustmentsHorizontal} aria-expanded={more} aria-controls={moreId} onClick={() => setMore(!more)}>
              {applied.length ? "更多 " + applied.length : "更多"}
            </Button>
          </div>
        </div>
      </div>
      <Collapse open={more} id={moreId} aria-label="更多趋势选项">
        <div className="flex flex-wrap items-center gap-3">
          <div data-usage-source>
            <Combobox value={state.source} onChange={source => host.set({ source })} options={view.sources}
              placeholder="全部来源" searchPlaceholder="搜索模型或选项" emptyText="没有匹配的选项" aria-label="用量来源筛选" />
          </div>
          <div data-usage-model>
            <Combobox value={state.model} onChange={model => host.set({ model })} options={view.models}
              placeholder="全部模型" searchPlaceholder="搜索模型或选项" emptyText="没有匹配的选项" aria-label="用量模型筛选" />
          </div>
          <div data-usage-display>
            <Segmented value={state.display} onChange={display => host.set({ display })} aria-label="趋势数值"
              items={[{ value: "daily", label: trend.displayLabel }, { value: "average", label: "30 日均" },
                { value: "total", label: "累加" }]} />
          </div>
          {!trend.hourly ?
            <div data-usage-grain>
              <Select value={state.grain} onChange={grain => host.set({ grain })} aria-label="趋势时间粒度"
                options={[{ value: "auto", label: trend.autoLabel }, { value: "day", label: "按日" },
                  { value: "week", label: "按周" }, { value: "month", label: "按月" }]} />
            </div> : null}
        </div>
      </Collapse>
      <div className="flex items-center justify-between text-caption text-muted-foreground" data-usage-axis-labels>
        <span>{state.metric === "cost" ? "估算费用（美元）" : "Token"}</span>
        {trend.entries.some(entry => entry.axis === "right") ? <span>{"估算费用（美元，右轴）"}</span> : null}
      </div>
      <LineChart
        variant="trend"
        x={trend.x}
        series={trend.entries}
        hidden={state.hidden}
        active={active}
        onActiveChange={setActive}
        range={range}
        onRangeChange={setRange}
        onApplyRange={span => host.applyTrendRange(...span)}
        onSelect={host.selectTrend}
        ticks={trend.ticks}
        tooltip={index => trend.tips[index] ? <TipCard {...trend.tips[index]} /> : null}
        dataKey={key}
        aria-label="用量趋势，可用左右方向键查看日期，回车打开每日明细"
      />
      <span className="sr-only" aria-live="polite" data-usage-trend-readout>
        {readout ? readout.label + "；" + readout.items.map(item => item.label + " " + (item.value ?? "未知")).join("；") : ""}
      </span>
      {trend.empty ? <EmptyState message={trend.empty} /> : null}
      <div className="flex flex-wrap justify-center">
        <ChartLegend
          variant="inline"
          items={trend.entries.map(entry => ({ key: entry.key, label: entry.label, tone: entry.tone,
            hidden: state.hidden.includes(entry.key), title: state.hidden.includes(entry.key) ? "显示这一项" : "隐藏这一项" }))}
          minVisible={0}
          onToggle={key => host.set({ hidden: state.hidden.includes(key) ?
            state.hidden.filter(item => item !== key) : [...state.hidden, key] })}
        />
      </div>
      <Facts items={trend.facts} onDay={host.selectDay} />
      {state.metric === "cost" ?
        <span className="text-caption text-muted-foreground">
          {"定价覆盖 "}
          <Value value={trend.coverage} />
        </span> : null}
    </Card>
  </section>;
}
