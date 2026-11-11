import { useSyncExternalStore } from "react";
import type { ChartTone } from "@ui/kit";

// preview.js owns data, actions and session preferences. JSX only composes its projections.
export interface UsageFilters { period: string; agent: string; source: string; model: string }
export interface UsageState extends UsageFilters {
  metric: "tokens" | "cost"; mode: "flow" | "total" | "models";
  display: "daily" | "average" | "total"; grain: "auto" | "day" | "week" | "month";
  trendRange: { start: string; end: string } | null; selectedDay: string | null;
  heatRange: string; palette: string; slot: { day: number; hour: number } | null; hidden: string[];
}
export interface UsagePrice {
  lower: string | null; upper: string | null; lowerValue: number | null; upperValue: number | null;
  coverage: string; bounds: string; label: string;
}
export interface UsageFact { label: string; value: string | null; title?: string; day?: string | null }
export interface UsageTip {
  title: string; aside?: string; note?: string | null;
  rows?: { key: string; label: string; value: string; tone: ChartTone }[];
}
interface Segment { key: string; value: number; tone: ChartTone; label: string }
export interface UsageCategories {
  tiles: { key: string; label: string; text: string | null; title: string; tone: ChartTone; state: string }[];
  segments: Segment[]; unknown: boolean;
}
export interface UsageClient {
  id: string; name: string; records: string; tokens: string | null; price: UsagePrice; sessions: number | null;
  models: { key: string; name: string; tokens: string | null; price: UsagePrice;
    share: string | null; fraction: number | null; output: string | null; hit: string | null; categories: UsageCategories }[];
}
export interface UsageBar {
  key: string; value: number | null; state: "value" | "zero" | "unobserved" | "unpriced" | "future";
  mark?: "peak" | "today"; tone: ChartTone; label: string; tip?: UsageTip;
}
export interface UsageHeatCell {
  key: string; row: number; col: number; level: 0 | 1 | 2 | 3 | 4 | null;
  disabled?: boolean; highlighted?: boolean; label: string; tip: UsageTip;
}
export interface UsageReadout {
  label: string; partial: boolean; missing: boolean;
  items: { key: string; label: string; tone: ChartTone; value: string | null }[];
}
export interface UsageTrend {
  start: string; end: string; grain: string; hourly: boolean; displayLabel: string; autoLabel: string;
  rangeLabel: string; total: string | null; coverage: string | null; empty: string;
  buckets: { start: string; end: string; label: string; hour?: number; value: number | null; partial: boolean }[];
  x: { key: string; label: string; partial: boolean; missing: boolean }[];
  entries: { key: string; label: string; tone: ChartTone; values: (number | null)[];
    style: "area" | "dashed"; axis: "left" | "right" }[];
  readouts: UsageReadout[]; facts: UsageFact[];
  tips: UsageTip[];
  ticks: { left: { value: number; label: string }[]; right: { value: number; label: string }[] };
}
export interface UsageView {
  periodLabel: string; scope: string; filtered: boolean;
  hero: { tokens: string | null; records: string | null; price: UsagePrice; average: string | null;
    averageTitle: string; comparison: string | null; today: string; bars: UsageBar[] };
  today: { date: string; tokens: string | null; records: string | null; price: UsagePrice;
    sessions: number | null; categories: UsageCategories; clients: UsageClient[]; empty: string };
  calendar: { start: string; end: string; columns: number; cells: UsageHeatCell[]; labels: { col: number; label: string }[] };
  activity: {
    rangeLabel: string; cells: UsageHeatCell[]; empty: string; peakSlot: string | null; stats: UsageFact[]; facts: UsageFact[];
    slot: { key: string; label: string; tokens: string | null; price: UsagePrice;
      shares: { key: string; name: string; tokens: string; share: string; value: number; tone: ChartTone }[] } | null;
    hours: { hours: UsageBar[]; used: number; peak: { key: string; hour: number; value: number } | null;
      last: number; ready: boolean; draw: boolean; empty: string; facts: UsageFact[]; ticks: { value: number; label: string }[] } | null;
  };
  day: { date: string; observed: boolean; tokens: string | null; records: string | null;
    price: UsagePrice; categories: UsageCategories; clients: UsageClient[] } | null;
  trend: UsageTrend;
  agents: { id: string; name: string; recorded: boolean }[];
  sources: { value: string; label: string }[]; models: { value: string; label: string }[];
  sourceMarks: { id: string; name: string; title: string; idle: boolean }[];
  sourceCount: number;
}
export interface UsageSnapshot {
  revision: number; state: UsageState; view: UsageView; loading: boolean; busy: boolean;
  error: string | null; recovery: string | null; today: string; coverageStart: string; recorded: string[];
}
export interface UsageHost {
  version(): number; get(): UsageSnapshot; set(patch: Partial<UsageState>): void; filters(): UsageFilters; invalidate(): void;
  refresh(): Promise<void>; export(): void; sources(): void; cost(): void; openSessions(agent?: string): void;
  selectDay(day: string): void; closeDay(): void; selectTrend(index: number): void;
  applyTrendRange(from: number, to: number): void; preset(key: string): void;
}
export interface UsageUi { filters(): UsageFilters; render(): void; locate(target: "day" | "calendar" | "trend"): void }
declare global { interface Window { usageHost?: UsageHost; usageUi?: UsageUi } }
export function getUsageHost(): UsageHost {
  if (!window.usageHost) throw Error("UI_USAGE_HOST_UNAVAILABLE");
  return window.usageHost;
}
function subscribe(listener: () => void) {
  window.addEventListener("usage-host-change", listener);
  return () => window.removeEventListener("usage-host-change", listener);
}
export function useUsageHost() {
  const host = getUsageHost();
  useSyncExternalStore(subscribe, host.version);
  return host;
}
