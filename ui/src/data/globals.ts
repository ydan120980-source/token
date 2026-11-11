import type * as T from "./types";

export interface DisplayValues {
  usd(value: number): string;
  cost(lower: T.NullableNumber | undefined, upper?: T.NullableNumber, coverage?: T.NullableNumber): { text: string; lower: T.NullableNumber; upper: T.NullableNumber; partial: boolean };
  reset(date: string, now?: number): string;
}
export interface PricingLabels { REASONS: Readonly<Record<string, string>>; CAUSES: Readonly<Record<string, string>>; FIXABLE: readonly string[]; remediation(reason: string, cause?: string): { summary: string; steps: string[] } }
export interface ModelStats { tokens?: number; pricedTokens?: number; agents?: string[]; unpricedAgents?: Record<string, number>; reasons?: Record<string, number>; unpriced?: Record<string, number>; incomplete?: Record<string, number> }
export interface UsedModel extends T.PriceKey {
  key: string; row: T.PriceRow; target: string | null; mapped: boolean; manual: boolean; agentIds: string[]; unpricedAgentIds: string[]; agents: string[];
  tokens: number; pricedTokens: number; share: T.NullableNumber; reasons: Record<string, number>; unpriced: Record<string, number> | null; incomplete: Record<string, number>; unpricedAgents: Record<string, number>;
}
export interface PricingGap extends T.PriceKey { key: string; agentIds: string[]; agents: string[]; tokens: number; total: number; ratio: T.NullableNumber; fixable: boolean; groups: { reason: string; tokens: number; fixable: boolean; causes: { cause: string; tokens: number }[] }[] }
export interface UiPricing extends PricingLabels {
  FIELDS: readonly T.PriceField[]; LABELS: Readonly<Record<T.PriceField, string>>; ORIGINS: Readonly<Record<string, { label: string; scope: string }>>;
  origin(row?: T.PriceRow | null): { label: string; scope: string }; scope(row?: T.PriceRow | null): string; priced(row?: T.PriceRow | null): boolean;
  formatCount(value: T.NullableNumber | undefined): string; formatStamp(value: string | null | undefined): string;
  usedModels(observed: T.Pricing["observed"], rows: T.PriceRow[], usage: Record<string, ModelStats>, billing: T.Billing, names: Record<string, string>): UsedModel[];
  pricingGaps(models: UsedModel[]): { key: string; tokens: number; reasons: string[] }[];
  unpricedUsage(models: UsedModel[]): PricingGap[]; unpricedTotals(list: PricingGap[]): { fixable: number; incomplete: number };
  coverage(usage: Record<string, ModelStats>): { tokens: number; priced: number; ratio: T.NullableNumber };
  entry(provider: string, model: string, values: Record<T.PriceField, string | number | null | undefined>): T.PriceEntry;
}
// design/desktop-reference/pricing-view.js: what the pricing panel says, as text and data (M3).
export interface RateParts { priced: boolean; values: (string | null)[]; title: string }
export interface PriceRowView { key: string; model: string; detail: string; openLabel: string; basis: string; scope: string; routedTo: string | null; rates: RateParts; tokens: string; leftOut: { fixable: boolean; text: string; title: string } | null; share: string | null }
export interface GapStatus { key: string; title: string; amount: string; lines: { fixable: boolean; text: string }[]; guides: { title: string; steps: string[] }[]; checkManual: boolean; sources: { id: string; label: string }[] }
export interface SuggestionsView { title: string; note: string; candidates: { target: string; reason: string; provenance: string; rates: string }[]; more: string | null }
export interface UiPricingView {
  short(value: T.NullableNumber | undefined): string; usd(value: number): string; percent(value: number): string;
  fieldPlaceholder(field: T.PriceField, index: number): string;
  rates(row: T.PriceRow | null | undefined, pricing: UiPricing): RateParts;
  row(item: UsedModel, gap: PricingGap | null | undefined, pricing: UiPricing): PriceRowView;
  suggestions(key: string, value: T.PriceSuggestion | null | undefined): SuggestionsView | null;
  status(item: PricingGap | null | undefined, pricing: UiPricing): GapStatus | null;
  coverageLegend(value: ReturnType<UiPricing["coverage"]>, totals: ReturnType<UiPricing["unpricedTotals"]>): { empty: string | null; items: { kind: "priced" | "fixable" | "incomplete"; label: string; tokens: string }[]; total: string };
  catalogLine(data: T.Pricing | null, pricing: UiPricing): string; catalogTitle(data: T.Pricing | null): string;
  countsText(models: UsedModel[], list: PricingGap[]): string;
  templateOptions(models: T.PriceRow[], selected: string): { options: { value: string; label: string }[]; selected: string };
}
// design/desktop-reference/pricing-editor-model.js: the pricing panel's own calculations (M3).
export interface BillingDraft { mode: "actual" | "default"; multiplier: string; model: string }
export interface EditorHeading { provider: string; model: string; title: string; eyebrow: string; meta: string; fill: Partial<T.Rates> | null; manual: boolean; startMode: "map" | "manual" }
export interface PricingEditorModel {
  COLLAPSED_ROWS: number;
  money(value: T.NullableNumber): string;
  share(coverage: T.PriceCoverage | null | undefined): string;
  leftLines(left: T.PriceCoverage["left"], pricing: UiPricing): string[];
  verdict(coverage: T.PriceCoverage | null | undefined, pricing: UiPricing): { kind: "full" | "some" | "none" | "empty"; label: string; detail: string; left: string[] };
  withManualRows(models: UsedModel[], rows: T.PriceRow[]): UsedModel[];
  table(models: UsedModel[], gaps: PricingGap[], query: string, expanded: boolean, pricing: UiPricing): { rows: UsedModel[]; byGap: Record<string, PricingGap>; folded: boolean; expandText: string; count: string; empty: string };
  coverageText(value: ReturnType<UiPricing["coverage"]>): string | null;
  shares(value: ReturnType<UiPricing["coverage"]>, totals: ReturnType<UiPricing["unpricedTotals"]>): { priced: number; fixable: number; incomplete: number };
  attentionText(gaps: PricingGap[], totals: ReturnType<UiPricing["unpricedTotals"]>): string;
  syncText(sync: T.PriceSync | undefined, pricing: UiPricing): string;
  priceTargets(rows: T.PriceRow[], pricing: UiPricing): string[];
  templateRow(rows: T.PriceRow[], key: string): T.PriceRow | null;
  editor(key: string | null, models: UsedModel[], rows: T.PriceRow[], pricing: UiPricing): EditorHeading;
  mappingPreview(raw: string, rows: T.PriceRow[], pricing: UiPricing): string;
  probeReady(entry: T.PriceEntry): boolean;
  probeText(result: T.PriceProbe, pricing: UiPricing): string;
  probeErrorText(error: unknown): string; resetErrorText(error: unknown): string;
  billingDraft(billing: T.Billing, agent: string): BillingDraft;
  billingCheck(draft: BillingDraft, rows: T.PriceRow[], pricing: UiPricing): { valid: boolean; modelValid: boolean; error: string };
  billingValue(draft: BillingDraft): T.Billing["defaults"][string];
}
// design/desktop-reference/profile-model.js and codex-maintenance-model.js (M3).
export interface ProfileModel {
  KEY: string; TONES: readonly ("indigo" | "teal" | "coral")[]; NAME_MAX: number; BIO_MAX: number; PHOTO_TYPES: readonly string[];
  DEFAULT: Readonly<{ name: string; bio: string; tone: "indigo" | "teal" | "coral"; photo: string | null }>; parse(raw: string | null): { name: string; bio: string; tone: "indigo" | "teal" | "coral"; photo: string | null };
  initials(name: string): string; previewName(value: string): string; fileProblem(file: { type: string; size: number }): string | null; fileChosen(file: { size: number }): string;
  toSave<P extends { name: string; bio: string }>(draft: P, name: string, bio: string): P;
}
export interface CodexMaintenanceModel { previewText(value: { files: number; records: number; previousTokens: number; rebuiltTokens: number; retainedTokens: number }): string }
export interface CostGap { code: string; kind: string; tokens: number; fixable: boolean; text: string }
export interface CostItem {
  key: string; agent: string | null; provider: string | null; model: string | null; tokens: number; records: number; share: number;
  lower: T.NullableNumber; upper: T.NullableNumber; pricedTokens: number; boundedTokens: number; coverage: T.NullableNumber; perMillion: T.NullableNumber;
  fields: Record<T.PriceField, { value: T.NullableNumber; partial: boolean }>; costParts: T.Rates | null; spread: T.NullableNumber;
  spreadReasons: { code: string; records: number; text: string }[]; savings: T.NullableNumber; hitRate: T.NullableNumber; gaps: CostGap[];
  users: { key: string; agent?: string; provider?: string; model?: string; tokens: number; lower: T.NullableNumber; upper: T.NullableNumber; pricedTokens: number; share: number; coverage: T.NullableNumber }[];
  series: { date: string; tokens: number }[]; previous: T.NullableNumber; delta: T.NullableNumber; isNew: boolean; other?: false;
}
export type FoldedCostItem = CostItem | { key: null; other: true; count: number; members: string[]; tokens: number; share: number; lower: T.NullableNumber; upper: T.NullableNumber; pricedTokens: number; coverage: T.NullableNumber };
export interface CostTable {
  FIELDS: readonly T.PriceField[]; PARTS: readonly T.PriceField[]; RANGED: readonly string[]; HEADER: readonly string[];
  table(rows: T.UsageRow[], options?: { by?: "model" | "agent"; previousRows?: T.UsageRow[] | null }): CostItem[];
  sort(items: CostItem[], by?: "tokens" | "cost"): CostItem[]; fold(items: CostItem[], top?: number): FoldedCostItem[];
  points(series: { date: string; tokens: number }[], max?: number): { date: string; tokens: number }[];
  csv(items: CostItem[], options?: { by?: "model" | "agent"; range?: string; agentName?: (id: string) => string; modelName?: (model: string) => string }): string;
}
export interface CostTotal { lower: T.NullableNumber; upper: T.NullableNumber; tokens: number; pricedTokens: number; coverage: T.NullableNumber; usageDays: number }
export interface MonthCost extends CostTotal { month: string; from: string; to: string; current: boolean; started: boolean; delta: T.NullableNumber; deltaKind: string | null; projection: { lower: number; upper: number; elapsed: number; remaining: number; usageDays: number } | null }
export interface CostComposition {
  lower: T.NullableNumber; upper: T.NullableNumber; spread: T.NullableNumber; tokens: number; pricedTokens: number; coverage: T.NullableNumber; fullTokens: number;
  reasons: { code: string; records: number; text: string }[]; parts: { key: T.PriceField; cost: T.NullableNumber; share: T.NullableNumber; tokens: T.NullableNumber; tokenShare: T.NullableNumber; perMillion: T.NullableNumber; series: { date: string; cost: number }[] }[]; buckets: string[];
}
export interface CostInsights {
  PARTS: readonly T.PriceField[]; total(rows: T.UsageRow[]): CostTotal;
  months(rows: T.UsageRow[], options?: { today?: string; coverageStart?: string | null; minimumDays?: number }): MonthCost[];
  waffle(fractions: T.NullableNumber[], cells?: number): number[];
  composition(rows: T.UsageRow[], options?: { bucket?: "day" | "week"; from?: string | null }): CostComposition;
  subscriptions(rows: T.UsageRow[], options?: { from?: string; to?: string; fees?: Record<string, number>; agents?: string[] }): (CostTotal & { agent: string; fee: T.NullableNumber; ratioLower: T.NullableNumber; ratioUpper: T.NullableNumber })[];
  coverage(items: CostItem[]): { tokens: number; pricedTokens: number; coverage: T.NullableNumber; unpricedTokens: number; gaps: { code: string; title: string; tokens: number; fixable: boolean; share: T.NullableNumber; models: { key: string; tokens: number }[] }[]; range: { spread: number; models: { key: string; model: string | null; spread: number }[]; reasons: { code: string; records: number; text: string }[] } | null };
  cache(items: CostItem[]): { hitRate: T.NullableNumber; savings: T.NullableNumber; models: { key: string; model: string | null; tokens: number; users: CostItem["users"]; hitRate: T.NullableNumber; savings: T.NullableNumber; priced: boolean; reported: boolean }[] };
  monthEnd(start: string): string; shift(date: string, days: number): string;
}
export interface Point { x: number; y: number }
export interface CostChart {
  curve(points: Point[]): string; niceMax(value: number): number;
  plot(values: T.NullableNumber[], frame?: { width?: number; left?: number; right?: number; top?: number; bottom?: number; max?: number | null }): { max: number; points: ((Point & { value: number; index: number }) | null)[]; segments: { line: string; area: string }[] };
}
export interface UsageMath {
  AVERAGE_MIN: number; localDay(timezone: string, time?: string | number | Date): string; shift(date: string, days: number): string;
  startFor(today: string, period: string, coverageStart: string | null): string;
  series(rows: T.UsageRow[], model: string, days: string[], display: string, metric: string, coverageStart: string, observedDates?: Set<string> | null): T.NullableNumber[] | undefined;
  seriesByModel(rows: T.UsageRow[], models: string[], days: string[], display: string, metric: string, coverageStart: string, observedDates?: Set<string> | null): Map<string, T.NullableNumber[]>;
  disjointMix(rows: T.UsageRow[]): { total: number; values: number[]; displayValues: T.NullableNumber[]; partialValues: boolean[]; incomplete: boolean; coverage: T.NullableNumber };
}
export type RecordedFields = (agent: string, field: T.UsageField) => boolean;
export interface InsightShare { key: string | null; tokens: number; cost: T.NullableNumber; tokenShare: number; costShare: T.NullableNumber; count?: number }
export interface HourGrid { cells: { tokens: number; records: number; days: number }[][]; max: number; peak: { weekday: number; hour: number } | null; active: number; peakHour: number | null; peakWeekday: number | null; hours: number[]; days: number[] }
export interface InsightsMath {
  recordedFields(rows: T.UsageRow[]): RecordedFields;
  categoryView(rows: T.UsageRow[], recorded: RecordedFields): { key: string; label: string; value: T.NullableNumber; state: "value" | "unknown" | "partial" | "not-recorded" | "combined"; note?: string }[];
  cacheHitRate(rows: T.UsageRow[], recorded: RecordedFields): T.NullableNumber;
  costDestination(rows: T.UsageRow[], recorded: RecordedFields): { total: T.NullableNumber; parts: { key: T.PriceField; value: T.NullableNumber; share: T.NullableNumber }[]; savings: T.NullableNumber; hitRate: T.NullableNumber; pricedShare: T.NullableNumber };
  shares(rows: T.UsageRow[], by: keyof T.UsageRow, limit?: number): InsightShare[];
  weekHour(rows: T.UsageRow[]): HourGrid; streaks(totals: Map<string, number>, start: string, end: string): { current: number; longest: number };
  peakWindow(hours: number[], width?: number): { start: number; tokens: number; share: number } | null;
  efficiency(rows: T.UsageRow[], recorded: RecordedFields): { activeDays: number; tokens: number; records: number; pricedTokens: number; costPerDay: T.NullableNumber; tokensPerRecord: T.NullableNumber; costPerMillion: T.NullableNumber; hitRate: T.NullableNumber; pricingCoverage: T.NullableNumber };
  change(current: T.NullableNumber, previous: T.NullableNumber): T.NullableNumber;
}
export interface AgentCatalog { agents: Record<string, T.AgentMeta>; readonly sources: readonly string[]; readonly labels: Readonly<Record<string, string>>; install(catalog: Record<string, { name: string; archived?: boolean }>): void }
export interface PackedRows { columns: string[]; layouts: ({ kind: string; values?: unknown[]; keys?: string[] } | null)[]; rows: unknown[][] }
export interface PackedSnapshot { codec: "LocalUsageColumnsV1"; header: Omit<T.UsageSnapshot, "daily" | "hourly">; daily: PackedRows; hourly: PackedRows }
export interface SnapshotCodec { pack(snapshot: T.UsageSnapshot): PackedSnapshot; unpack(value: PackedSnapshot): T.UsageSnapshot }
export interface ConnectionState {
  FRESH_MS: number; USAGE_LABELS: Readonly<Record<string, string>>; CAPABILITY_LABELS: Readonly<Record<string, string>>;
  quotaFreshness(account: { status?: string; errorCode?: string | null; busy?: boolean; quota?: T.AccountQuotaV1 | T.AccountQuotaV2 | null }, now: number): T.Freshness & { fetchedAt: string | null };
  quotaLabel(health: T.Freshness): string;
  projectConnections(input: { catalog: Record<string, T.AgentMeta>; collection?: { enabled: boolean; checkedAt?: string | null } | null; statuses?: Record<string, Partial<T.SourceStatus>>; disabled?: string[]; custom?: Record<string, { enabled: boolean }>; discovered?: { agent: string; installed: boolean }[]; quota?: Partial<T.QuotaStateV2> | null; now?: number }): T.Connections;
  quotaDescription(quota: T.ConnectionRow["quota"]): string;
}
export interface Bucket { label: string; start: string; end: string; value: T.NullableNumber; partial: boolean }
export interface ChartUi {
  positionTooltip(bounds: { width: number; height: number }, panel: { width: number; height: number }, point: Point): Point;
  tooltipSummary<P extends { value: T.NullableNumber }>(points: P[]): { total: T.NullableNumber; entries: P[]; zeroCount: number; unknownCount: number };
  bucketSeries(days: string[], values: T.NullableNumber[], grain: string, display?: string): Bucket[];
  gapPlan(buckets: Bucket[], values: T.NullableNumber[], observedDates: Set<string>, coverageStart: string, display: string): number[];
  segmentKind(left: number, right: number, blocked: number[], values?: T.NullableNumber[] | null): "recorded" | "unknown" | "bridge";
}
declare global {
  interface Window {
    displayValues: DisplayValues; pricingLabels: PricingLabels; uiPricing: UiPricing; uiPricingView: UiPricingView;
    costTable: CostTable; costInsights: CostInsights; costChart: CostChart; usageMath: UsageMath; insightsMath: InsightsMath;
    agentCatalog: AgentCatalog; connectionState: ConnectionState; snapshotCodec: SnapshotCodec; chartUi: ChartUi;
    pricingEditorModel: PricingEditorModel; profileModel: ProfileModel; codexMaintenanceModel: CodexMaintenanceModel;
    // Usage per provider/model, published by preview.js with a usage-models event on every change.
    usageModels?: Record<string, ModelStats>;
  }
}
// No wrapping, formatting, cloning, fallback values or side effects.
export function getGlobals() {
  return {
    displayValues: window.displayValues, pricingLabels: window.pricingLabels, uiPricing: window.uiPricing, uiPricingView: window.uiPricingView,
    costTable: window.costTable, costInsights: window.costInsights, costChart: window.costChart, usageMath: window.usageMath, insightsMath: window.insightsMath,
    agentCatalog: window.agentCatalog, connectionState: window.connectionState, snapshotCodec: window.snapshotCodec, chartUi: window.chartUi,
    pricingEditorModel: window.pricingEditorModel, profileModel: window.profileModel, codexMaintenanceModel: window.codexMaintenanceModel,
  };
}
