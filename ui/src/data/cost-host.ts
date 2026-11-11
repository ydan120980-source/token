import { useSyncExternalStore } from "react";
import type { ChartTone } from "@ui/kit";
import type { CostItem, CostComposition, CostInsights, MonthCost, FoldedCostItem } from "./globals";
import type { UsageRow } from "./types";

export interface CostState {
  period: string; month: string | null; custom: { from: string; to: string } | null; agents: Set<string> | null;
  gapsOnly: boolean; cal: string | null; by: "model" | "agent"; sort: "tokens" | "cost"; open: string | null;
  all: boolean; query: string; monthsAll: boolean; trend: "daily" | "cumulative"; hidden: Set<string>;
  compBy: "agent" | "kind"; ring: "full" | "semi"; bars: "grouped" | "stacked"; panel: "both" | "where" | "months";
  panelTab: "composition" | "subscriptions"; grain: "auto" | "day" | "week" | "month"; chartView: "area" | "line";
  heroSlide: "range" | "month";
}
export interface CostSpan { from: string | null; to: string | null; previous: { from: string; to: string } | null; compare: string | null; label: string }
export interface CostPoint { key: string; label: string; value: number | null; readout: string }
export interface CostDayPoint extends CostPoint { cost: number | null; costText: string; costReadout: string }
export interface CostMix { key: string; value: number; tone: ChartTone; pattern?: "hatched"; label: string }
export interface CostRow {
  key: string; name: string; sub: string; agent: string | null; title: string; tokens: string; share: string; amount: string;
  unknown: boolean; note: string; rate: string | null; change: string | null; mix: CostMix[]; points: CostPoint[]; other: boolean;
}
export interface CostDetail extends CostRow {
  item: CostItem; fields: { key: string; label: string; note: string; tone: ChartTone; tokens: string | null; cost: string | null }[];
  series: CostDayPoint[]; ticks: { value: number; label: string }[]; costTicks: { value: number; label: string }[]; endLabel: string | null; costEndLabel: string | null; range: string; rangeReason: string; coverage: string;
  metrics: { label: string; value: string | null }[];
}
export interface CostDay {
  key: string; date: string; title: string; short: string; future: boolean; today: boolean; used: boolean;
  value: number | null; partial: boolean; label: string; state: "value" | "zero" | "unpriced" | "unobserved" | "future";
}
export interface CostMonthHero {
  title: string; lower: number | null; upper: number | null; projection: MonthCost["projection"]; days: CostDay[]; today: number;
  coverage: number | null; number: string | null; upperText: string; sub: string;
}
export interface CostHero {
  range: { number: string | null; upperText: string; total: number; agents: { key: string; name: string; value: number; tone: ChartTone }[];
    unpriced: string[]; coverage: number | null; unpricedTokens: number; hasRows: boolean; sub: string };
  month: CostMonthHero | null;
  facts: { perDay: string | null; daily: { date: string; value: number | null }[]; dailyNote: string; perMillion: string | null;
    perMillionNow: number | null; perMillionBefore: number | null; perMillionNote: string; saved: string | null;
    hit: number | null; hitNote: string };
  customLabel: string | null; slide: CostState["heroSlide"];
}
export interface CostBucket {
  date: string; end: string; title: string; values: Record<string, number>; used: Set<string>; partial: boolean; unpriced: string[];
}
export interface CostTrend { buckets: CostBucket[]; series: { key: string; name: string }[]; left: string[]; weekly: boolean; monthly: boolean }
export interface CostLegend { key: string; label: string; tone: ChartTone; hidden: boolean; disabled?: boolean; value: string | null }
export interface CostTrendView {
  series: { key: string; label: string; tone: ChartTone; style: "line" | "area"; values: (number | null)[] }[];
  drawn: { key: string; label: string; tone: ChartTone; style: "line" | "area"; values: (number | null)[] }[];
  ticks: { value: number; label: string }[]; legend: CostLegend[]; known: boolean; when: string; total: string | null; note: string;
}
export interface CostDonut {
  items: { key: string; name: string; value: number | null; detail: string }[];
  centerLabel: string; centerFoot: string; note: string;
}
export interface CostMonthsView {
  groups: { key: string; label: string; ariaLabel: string; projection: MonthCost["projection"];
    series: { key: string; lower: number | null; upper: number | null; tone: ChartTone }[] }[];
  ticks: { value: number; label: string }[]; left: string; when: string; total: string | null; note: string; legend: CostLegend[];
}
export interface CostView {
  span: CostSpan; all: UsageRow[]; rows: UsageRow[]; models: CostItem[]; items: CostItem[]; comp: CostComposition; list: MonthCost[];
  hero: CostHero; trend: CostTrend | null; composition: CostDonut; coverage: ReturnType<CostInsights["coverage"]>;
  cache: ReturnType<CostInsights["cache"]>; cacheRows: ReturnType<CostInsights["cache"]>["models"];
  subscriptions: ReturnType<CostInsights["subscriptions"]>; subsMonth: MonthCost | null; shown: FoldedCostItem[];
  matched: CostItem[]; table: CostRow[]; detail: CostDetail | null; search: boolean; canFold: boolean;
  counts: { model: number; agent: number }; monthsTotal: string; rangeLabel: string; agents: { id: string; name: string; recorded: boolean }[];
}
export interface CostSnapshot {
  state: CostState; folds: { rail: boolean }; view: CostView; fees: Record<string, number>;
  exporting: boolean; available: boolean;
}
export interface CostModel {
  subscriptionView(entry: CostView["subscriptions"][number]): {
    ratio: string | null; note: string; segments: CostMix[];
    markers: { key: string; at: number; kind: "fee"; label: string }[];
  };
  money(value: number | null | undefined): string; rate(value: number | null): string; pct(value: number | null, digits?: number): string;
  covered(value: number | null): string; amount(lower: number | null, upper: number | null): string;
  agentName(id: string): string; rangeWords(reasons: CostItem["spreadReasons"]): string; monthLabel(month: string): string;
  trendView(model: CostTrend, index?: number | null): CostTrendView;
  monthView(list: MonthCost[], rows: UsageRow[], hidden?: string[], active?: string | null): CostMonthsView;
  donutReadout(model: CostDonut, hidden?: string[], active?: string | null): {
      label: string; amount: number | null; value: string | null; detail: string; share: string | null; note: string;
  };
  quotaSummary(agent: string): string | null; md(date: string): string;
}
export interface CostUi {
  render(): void; state(): CostState; projects(): void; analysis(): void;
  locate(section: "month" | "composition" | "coverage" | "analysis"): void;
  agent(id: string): void;
}
export interface CostHost {
  version(): number; get(): CostSnapshot; state(): CostState; model: CostModel; set(patch: Partial<CostState>): void;
  period(value: string): void; chooseAgent(id: string): void; selectRange(from: string, to: string): void;
  toggleSeries(key: string): void; saveFee(id: string, raw: string): Promise<string>; closeDetail(): void;
  price(key: string, explain?: boolean): void; copy(text: string): Promise<void>; export(): Promise<void>;
  rail(open: boolean): void; month(key: string): void; group(by: CostState["by"]): void;
  showModel(model: string): void; showAgent(agent: string): void; sources(): void; quota(agent: string): void; invalidate(): void;
  short(value: number): string; displayModel(model: string | null): string; today(): string; coverageStart(): string | null;
}
declare global { interface Window { costHost: CostHost; costUi?: CostUi; costPage?: Pick<CostUi, "render" | "state"> } }
const subscribe = (listener: () => void) => {
  window.addEventListener("cost-change", listener);
  return () => window.removeEventListener("cost-change", listener);
};
export function useCostHost() {
  useSyncExternalStore(subscribe, () => window.costHost.version());
  return window.costHost;
}
