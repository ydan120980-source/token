import { useState, type ReactNode } from "react";
import {
  Badge, BarChart, Button, Card, Carousel, ChartLegend,
  Figure, LineChart, RingChart, Segmented, StackBar
} from "@ui/kit";
import type { ChartTone } from "@ui/kit";
import type { CostHost, CostMonthHero, CostSnapshot } from "@ui/data/cost-host";
import { RangePicker } from "./range-picker";

const ranges = [
  { value: "all", label: "累计" }, { value: "30", label: "30 天" },
  { value: "7", label: "7 天" }, { value: "today", label: "今日" },
];
function Subline({ text }: { text: string }) {
  const match = text.match(/^(.*?)([+−-][\d.]+%)$/);
  return match ?
    <>{match[1]}
      <b className="font-semibold text-foreground">{match[2]}</b>
    </> :
    <>{text}</>;
}
function Coverage({ value, host }: { value: number | null; host: CostHost }) {
  return value === null ? null :
    <Badge tone="neutral">
      {"已计入 "}{host.model.covered(value)}{" 的 Token"}
    </Badge>;
}
/** The estimate the page leads with: the figure, its upper bound beside it, one line under it. */
function Lead({ figure, upper, sub, attribute }: { figure: ReactNode; upper: string; sub: ReactNode; attribute: "hero" | "month" }) {
  return <div className="flex flex-col gap-1">
    <div className="flex flex-wrap items-baseline gap-2" data-cost-hero-number={attribute === "hero" ? "" : undefined}
      data-cost-month-number={attribute === "month" ? "" : undefined}>
      {figure}
      {upper ? <span className="text-subtitle text-muted-foreground tabular-nums">{upper}</span> : null}
    </div>
    <p className="text-caption text-muted-foreground" data-cost-hero-sub={attribute === "hero" ? "" : undefined}
      data-cost-month-sub={attribute === "month" ? "" : undefined}>{sub}</p>
  </div>;
}
function Fact({ label, figure, chart, note }: { label: string; figure: ReactNode; chart?: ReactNode; note?: string }) {
  return <Card compact fill>
    <div className="flex h-full items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-caption text-muted-foreground">{label}</span>
        {figure}
        {note ? <span className="text-micro text-muted-foreground">{note}</span> : null}
      </div>
      {chart ? <div className="shrink-0">{chart}</div> : null}
    </div>
  </Card>;
}
function MonthHero({ month, host }: { month: CostMonthHero | null; host: CostHost }) {
  const [active, setActive] = useState<string | null>(null);
  if (!month) return <Card>
    <p className="text-body text-muted-foreground">{"本月还没有用量。"}</p>
  </Card>;
  const day = month.days.find(day => day.key === active);
  const max = Math.max(month.projection?.upper ?? 0, month.upper ?? 0, .01) * 1.08;
  return <Card>
    <p className="text-caption text-muted-foreground">{"本月 · "}{month.title}{" · 不随所选范围变化"}</p>
    <div className="flex flex-wrap items-center justify-between gap-6" data-pointing={day ? "" : undefined}>
      <div className="flex flex-col gap-3">
        <Lead
          attribute="month"
          figure={<Figure size="cost-hero" unknown={day?.used ? "未计入" : "—"}
            text={day ? day.value === null ? null : host.model.money(day.value) : month.number} />}
          upper={!day ? month.upperText : ""}
          sub={day ? <>
            <b className="font-semibold text-foreground">{day.title}</b>{" · "}
            {day.value !== null ? "当天已计价" + (day.partial ? "，另有未计入" : "") : day.used ? "有用量，没有可计价的部分" : "没有记录，不按 0 计"}
          </> : <Subline text={month.sub} />} />
        <div className="flex flex-wrap items-center gap-2">
          <Coverage value={month.coverage} host={host} />
        </div>
      </div>
      <RingChart
        variant="gauge"
        size="gauge"
        trackTone="cost:track"
        projectionTone="cost:track-strong"
        gauge={{ lower: month.lower, upper: month.upper, projection: month.projection, max }}
        center={month.projection ? <>
          <small>{"推算整月"}</small>
          <b><Figure size="sm" text={host.model.money(month.projection.lower)} /></b>
          <span>{"至多 "}{host.model.money(month.projection.upper)}</span>
        </> : <>
          <small>{"推算整月"}</small>
          <b>{"暂不推算"}</b>
          <span>{"本月有用量的日子不足 7 天"}</span>
        </>}
        aria-label="本月至今及推算整月" />
    </div>
    <BarChart
      variant="columns"
      height="days"
      bars={month.days.map(day => ({
        key: day.key, value: day.value, state: day.state, tone: "series:codex", label: day.label,
        mark: day.today ? "today" : undefined,
      }))}
      active={active}
      onActiveChange={setActive}
      aria-label="本月每天的估算" />
    <div className="flex justify-between text-micro text-muted-foreground tabular-nums">
      <span>{month.days[0].short}</span>
      <span>{"今天 "}{month.days[month.today].short}</span>
      <span>{month.days.at(-1)?.short}</span>
    </div>
  </Card>;
}
export function CostHeroView({ snapshot, host, onCoverage }: {
  snapshot: CostSnapshot; host: CostHost; onCoverage: () => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const { state, view: { hero, agents } } = snapshot;
  const range = hero.range, facts = hero.facts, chosen = state.agents ? [...state.agents][0] : null;
  // With one Agent chosen the bar shows only it; the legend keeps the others so the choice can move.
  const picks = chosen ? agents.filter(item => item.recorded).map(item => ({ key: item.id, label: item.name, tone: ("series:" + item.id) as ChartTone, hidden: item.id !== chosen })) :
    range.agents.map(item => ({ key: item.key, label: item.name, tone: item.tone, hidden: false }));
  const agent = range.agents.find(agent => agent.key === active);
  const number = agent ? host.model.money(agent.value) : range.number;
  const rangeCard = <Card fill>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-caption text-muted-foreground">{"API 等价估算"}</p>
      <div className="flex items-center gap-2" role="group" aria-label="费用时间范围" data-carousel-ignore>
        <Segmented value={state.month || state.custom ? "" : state.period} onChange={host.period} items={ranges}
          size="compact" aria-label="费用时间范围" />
        <RangePicker host={host} label={hero.customLabel ?? null} />
      </div>
    </div>
    <div data-pointing={agent ? "" : undefined}>
      <Lead
        attribute="hero"
        figure={<Figure size="cost-hero" text={number} unknown="未定价" />}
        upper={!agent ? range.upperText : ""}
        sub={agent ? <>
          <b className="font-semibold text-foreground">{agent.name}</b>{" · 占已计价 "}{host.model.pct(agent.value / range.total)}
        </> : <Subline text={range.sub} />} />
    </div>
    {range.agents.length ? <>
      <div className="flex" data-carousel-ignore><StackBar
        variant="cost-hero"
        height={12}
        active={active}
        onActiveChange={setActive}
        onSelect={key => { if (key !== "unpriced") host.chooseAgent(key); }}
        segments={[...range.agents.map(agent => ({
          key: agent.key, value: agent.value / range.total, tone: agent.tone,
          label: agent.name + " " + host.model.money(agent.value) + "，占已计价 " + host.model.pct(agent.value / range.total),
        })), ...(range.unpriced.length ? [{
          key: "unpriced", value: 1, tone: "cost:track-strong" as const,
          pattern: "hatched" as const, label: range.unpriced.join("、") + " 未计入",
        }] : [])]}
        aria-label="各 Agent 已计价金额构成" /></div>
      <ChartLegend
        variant="inline"
        minVisible={0}
        active={active}
        onActiveChange={setActive}
        onToggle={key => host.chooseAgent(key)}
        items={[
          ...picks.map(pick => ({ ...pick, title: pick.key === chosen ? "看全部 Agent" : "只看 " + pick.label })),
          ...(range.unpriced.length ? [{
            key: "unpriced", label: range.unpriced.join("、") + " 未计入", tone: "cost:track-strong" as const, hidden: false, disabled: true,
          }] : []),
        ]} />
    </> : null}
    <div className="flex flex-wrap items-center gap-2">
      <Coverage value={range.hasRows ? range.coverage : null} host={host} />
      {range.coverage !== null && 1 - range.coverage > .0005 ?
        <Button variant="tertiary" size="compact" onClick={onCoverage}>
          {host.short(range.unpricedTokens)}{" Token 未计入 ›"}
        </Button> : null}
      {!range.hasRows ? <Badge tone="neutral">{"当前范围暂无用量"}</Badge> : null}
    </div>
  </Card>;
  const factCards = <>
    <Fact
      label="日均"
      figure={<Figure text={facts.perDay} size="sm" unknown="—" />}
      chart={<LineChart
        variant="spark"
        size="hero"
        x={facts.daily.map(point => ({ key: point.date, label: point.date, missing: point.value === null }))}
        series={[{ key: "daily", label: "日均", tone: "series:codex", values: facts.daily.map(point => point.value) }]}
        aria-label="近 14 天的已计价费用" />}
      note={facts.dailyNote} />
    <Fact
      label="每百万 Token"
      figure={<Figure text={facts.perMillion} size="sm" unknown="—" />}
      chart={facts.perMillionBefore !== null && facts.perMillionNow !== null ? <BarChart
        variant="columns"
        height="pair"
        bars={[
          { key: "before", value: facts.perMillionBefore, state: "value", tone: "cost:track-strong", label: "前期" },
          { key: "now", value: facts.perMillionNow, state: "value", tone: "neutral", label: "本期" },
        ]}
        aria-label="每百万 Token 与前期对照" /> : undefined}
      note={facts.perMillionNote || undefined} />
    <Fact
      label="缓存约省下"
      figure={<Figure text={facts.saved} size="sm" unknown="—" />}
      chart={facts.hit !== null ? <RingChart
        variant="concentric"
        size="mini"
        trackTone="cost:track-strong"
        rings={[{ key: "hit", value: facts.hit * 100, tone: "cost:hit", state: "normal", label: facts.hitNote }]}
        aria-label="缓存命中率" /> : undefined}
      note={facts.hitNote} />
  </>;
  const rangeSlide = <div className="grid gap-4" data-cost-range-layout>
    <div data-cost-range-card>{rangeCard}</div>
    <div className="grid gap-4" data-cost-range-facts>{factCards}</div>
  </div>;
  return <section data-cost-section="month" data-cost-hero>
    <Carousel
      index={state.heroSlide === "month" ? 1 : 0}
      onIndexChange={index => host.set({ heroSlide: index ? "month" : "range" })}
      slides={[
        { key: "range", label: "所选范围", node: rangeSlide },
        { key: "month", label: "本月", node: <MonthHero month={hero.month} host={host} /> },
      ]}
      aria-label="费用首屏" />
  </section>;
}
