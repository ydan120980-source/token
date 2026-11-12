import { useEffect, useState, type ReactNode } from "react";
import { AgentMark, Badge, Breakdown, Button, LabelRow, LineChart, Sheet, Value, type BreakdownPart, type ChartTone, Segmented } from "@ui/kit";
import type { CostDetail, CostHost } from "@ui/data/cost-host";
import type { Rates } from "@ui/data";
import { CostAmount } from "./amount";
import { ensurePricing, usePricing } from "../settings/pricing/store";

// The detail is a floating card (owner 2026-10-28): figures in tiles, the usage composition as a
// breakdown whose parts open a detail card beside the sheet, then the daily line, the users and pricing.

/** One part of the detail card: its title (and an optional aside), then its content. */
export function Part({ title, aside, children, trend, pricing }: { title: ReactNode; aside?: ReactNode; children: ReactNode; trend?: boolean; pricing?: boolean }) {
  return <section className="flex flex-col gap-3" data-cost-detail-trend={trend ? "" : undefined} data-cost-detail-pricing={pricing ? "" : undefined}>
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-body font-semibold text-foreground">{title}</h3>
      {aside ? <span className="text-caption text-muted-foreground tabular-nums">{aside}</span> : null}
    </div>
    {children}
  </section>;
}
function DetailTrend({ detail }: { detail: CostDetail }) {
  const [active, setActive] = useState<number | null>(null), series = detail.series, priced = series.some(point => point.cost !== null);
  const [wanted, setWanted] = useState<"cost" | "tokens">("cost"), metric = priced ? wanted : "tokens", cost = metric === "cost";
  return <Part title={<span className="flex items-center gap-3">{cost ? "每日费用" : "每日 Token"}<span data-cost-detail-metric><Segmented value={metric} onChange={setWanted} size="compact" aria-label="每日看什么"
    items={[{ value: "cost" as const, label: "费用", disabled: !priced }, { value: "tokens" as const, label: "Token" }]} /></span></span>}
    aside={active === null ? (cost ? detail.costEndLabel : detail.endLabel) && "最近 " + (cost ? detail.costEndLabel : detail.endLabel) : undefined} trend>
    <LineChart
      palette="cost"
      variant="detail"
      x={series.map(point => ({ key: point.key, label: point.key.slice(5).replace("-", "/") }))}
      series={[{ key: metric, label: cost ? "每日费用" : "每日 Token", tone: "cost:line", style: "area", values: series.map(point => cost ? point.cost : point.value) }]}
      ticks={{ left: cost ? detail.costTicks : detail.ticks }}
      active={active}
      onActiveChange={setActive}
      endLabel={(cost ? detail.costEndLabel : detail.endLabel) ?? undefined}
      tooltip={index => series[index]?.costReadout}
      dataKey={detail.key + metric}
      aria-label={detail.name + (cost ? " 每日费用" : " 每日 Token")} />
  </Part>;
}
function Pricing({ detail, host }: { detail: CostDetail; host: CostHost }) {
  const { available, data, result } = usePricing();
  const priced = window.uiPricingEditor?.model(detail.key), rates = priced?.rates as Partial<Rates> | null;
  const fixable = detail.item.gaps.some(gap => gap.fixable), incomplete = detail.item.gaps.some(gap => !gap.fixable);
  const byModel = host.state().by === "model";
  useEffect(() => { if (byModel) void ensurePricing(); }, [byModel]);
  return <Part title={byModel ? "计价" : "计价覆盖"} aside={byModel && priced?.priced ? priced.basis : undefined} pricing>
    {!byModel ?
      <p className="text-caption text-muted-foreground">{"已计入 "}
        <b className="font-semibold text-foreground tabular-nums">{host.model.pct(detail.item.coverage)}</b>{" 的 Token"}
      </p> :
      priced?.priced && rates ? <>
        {priced.mapped && priced.target ? <p className="text-caption text-muted-foreground">{"按 " + priced.target + " 计费 · 每百万 Token"}</p> : null}
        <dl className="grid grid-cols-4 gap-2">
          {(["inputUncached", "output", "cacheRead", "cacheWrite"] as const).map((key, index) => <div key={key} className="flex flex-col gap-1 rounded-xl bg-hover px-3 py-2">
            <dt className="text-caption text-foreground">{["输入", "输出", "缓存读取", "缓存写入"][index]}</dt>
            <dd className="text-body font-semibold text-foreground tabular-nums">
              <Value value={rates[key] == null ? null : host.model.rate(rates[key]!)} />
            </dd>
          </div>)}
        </dl>
      </> : available && !data ?
        <p className="text-caption text-muted-foreground">{result || "正在读取计价信息…"}</p> :
        !priced && !detail.unknown ?
          <p className="text-caption text-muted-foreground">{"计价信息在桌面应用中显示。"}</p> : null}
    {detail.item.gaps.length ?
      <ul className="flex flex-col gap-1" data-cost-detail-gaps>
        {detail.item.gaps.map(gap => <li key={gap.code} className="flex justify-between gap-3 text-caption">
          <span className="text-foreground">{gap.text}</span>
          <em className="not-italic text-muted-foreground tabular-nums">{host.short(gap.tokens)}</em>
        </li>)}
      </ul> : null}
    {byModel && priced || incomplete ?
      <div className="flex gap-2">
        {byModel && priced ?
          <Button variant="secondary" size="compact" onClick={() => host.price(detail.key)}>
            {fixable || detail.unknown && !incomplete ? "设置计费" : "调整计费"}
          </Button> : null}
        {incomplete ? <Button variant="secondary" size="compact" onClick={host.sources}>{"查看来源"}</Button> : null}
      </div> : null}
  </Part>;
}
/** Usage composition parts: cost share as the segments, Token and cost in each part's detail card. */
const vivid: Record<string, ChartTone> = { "cost:input": "vivid:input", "cost:output": "vivid:output", "cost:read": "vivid:read", "cost:write": "vivid:write" };
function compositionParts(detail: CostDetail, host: CostHost): BreakdownPart[] {
  const share = (key: string) => detail.mix.find(part => part.key === key)?.value ?? null;
  const parts: BreakdownPart[] = detail.fields.map(field => ({
    key: field.key, label: field.label, note: field.note || undefined, tone: vivid[field.tone] ?? field.tone, share: detail.unknown ? null : share(field.key),
    value: <Value value={field.cost} unknown="未计入" />,
    detail: [
      { label: "Token", value: <Value value={field.tokens} unknown="未报告" /> },
      { label: "估算", value: <Value value={field.cost} unknown="未计入" />, share: share(field.key) },
    ],
  }));
  if ((detail.item.spread ?? 0) > 0) parts.push({
    key: "range", label: "估算区间", note: detail.rangeReason, tone: "muted", hatched: true, share: share("range"),
    value: "至多 +" + host.model.money(detail.item.spread),
    detail: [{ label: "原因", value: detail.rangeReason }],
  });
  return parts;
}
export function DetailSheet({ detail, host }: { detail: CostDetail | null; host: CostHost }) {
  const by = host.state().by;
  return <Sheet
    open={Boolean(detail)}
    onOpenChange={open => { if (!open) host.closeDetail(); }}
    title={detail?.name ?? "费用详情"}
    icon={detail?.agent ? <AgentMark agent={detail.agent} variant="icon" size={24} /> : undefined}
    subtitle={detail ? detail.sub + " · " + detail.range : undefined}
    size="lg"
    placement="left"
    floating
    dismissDrag
    scrollable
    footer={detail ? <div className="flex gap-2" data-cost-detail-foot>
      <Button variant="secondary" size="compact"
        onClick={() => by === "agent" ? host.showAgent(detail.item.agent!) : host.showModel(detail.item.model!)}>{"在用量页查看"}</Button>
      {by === "model" ?
        <Button variant="secondary" size="compact" onClick={() => void host.copy(detail.item.model!)}>{"复制模型标识"}</Button> : null}
    </div> : undefined}>
    {detail ?
      <div data-cost-detail={detail.key} data-cost-detail-mode={by} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="text-figure-lg font-semibold text-foreground tabular-nums" data-cost-detail-amount
            data-value={detail.unknown ? "unknown" : undefined}>
            <CostAmount text={detail.amount} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">{"已计入 "}{detail.coverage}{" Token"}</Badge>
            {detail.change ? <Badge tone="neutral">{host.get().view.span.compare ?? "较前期"}{" "}{detail.change}</Badge> : null}
          </div>
        </div>
        <dl data-cost-detail-metrics className="grid grid-cols-3 gap-2">
          {detail.metrics.map(metric => <div key={metric.label} className="flex flex-col gap-1 rounded-xl bg-hover px-3 py-2.5">
            <dt className="text-caption text-foreground">{metric.label}</dt>
            <dd className="text-subtitle font-semibold text-foreground tabular-nums">
              <Value
                value={metric.value}
                unknown={metric.label === "日均" ? "未计入" : metric.label === "缓存命中" ? "未报告" : metric.label === "缓存约省下" ? "无法估算" : "—"} />
            </dd>
          </div>)}
        </dl>
        <Part title="用量构成" aside={detail.tokens + " Token"}>
          <div data-cost-detail-fields>
            <Breakdown parts={compositionParts(detail, host)} aria-label={detail.name + " 的费用构成"} />
          </div>
        </Part>
        {detail.series.length ? <DetailTrend detail={detail} /> : null}
        <Part title={by === "agent" ? "模型" : "使用方"} aside={String(detail.item.users.length)}>
          <div data-cost-detail-users className="-mx-2 flex max-h-64 flex-col overflow-y-auto overflow-x-hidden px-2" tabIndex={0}
            aria-label={by === "agent" ? "Agent 的全部模型费用" : "模型的全部使用方用量"}>
            {detail.item.users.map(user => <LabelRow
              key={user.key}
              leading={by === "model" && user.agent ? <AgentMark agent={user.agent} variant="icon" size={20} /> : undefined}
              title={by === "agent" ? host.displayModel(user.model!) : host.model.agentName(user.agent!)}
              tag={host.model.pct(user.share)}
              share={user.share}
              aside={host.short(user.tokens) + " Token"}
              value={by === "agent" ? <CostAmount text={host.model.amount(user.lower, user.upper)} /> : undefined} />)}
          </div>
        </Part>
        <Pricing detail={detail} host={host} />
      </div> : null}
  </Sheet>;
}
