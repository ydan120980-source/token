// Renderer read contracts, transcribed from the existing projectors and IPC
// handlers. No runtime coercion: null, decimal strings and envelopes stay intact.
export type AgentId = string;
export type Timestamp = string;
export type Decimal = string;
export type NullableNumber = number | null;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type Unsubscribe = () => void;
export type Subscribe = (callback: () => void) => Unsubscribe;
export type PriceField = "inputUncached" | "output" | "cacheRead" | "cacheWrite";
export type UsageField = PriceField | "reasoning" | "outputPlain";
export type Rates = Record<PriceField, NullableNumber>;
export type PriceKey = { provider: string; model: string };
export type PriceEntry = PriceKey & Rates;
export interface AgentMeta { name: string; label: string; hint: string; icon: string; quota: boolean; custom?: boolean; archived?: boolean; usageOnly?: boolean }
export interface Recovery { file: string; quarantined: string | null; code: string }
export interface PriceBasis { version: string; obtainedAt: Timestamp | null; sha256: string | null; overrideSha256: string | null; billingSha256: string | null; source: string | null; basis: string | null; currency: "USD"; kind: "API-equivalent-estimate" }
export interface UsageRow {
  date: string; hour?: number; agent: AgentId; entry: string; provider: string; model: string;
  totalTokens: number; records: number; pricedTokens: number; partialRecords: number; boundedTokens: number;
  inputUncached: NullableNumber; output: NullableNumber; cacheRead: NullableNumber; cacheWrite: NullableNumber; reasoning: NullableNumber;
  estimatedCostUsd: NullableNumber; estimatedCostUpperUsd: NullableNumber; cacheSavingsUsd: NullableNumber;
  pricingReasons: Record<string, number>; unpricedTokens: Record<string, number>; incompleteTokens: Record<string, number>;
  costParts: Rates | null; knownUsage: Partial<Record<UsageField, number>>; knownRecords: Partial<Record<UsageField, number>>;
}
export interface SourceStatus { agent: string; status: "verified" | "partial" | "unverified" | "not-detected" | "error"; realSampleVerified: boolean; errors: string[]; lastSuccess: Timestamp | null; observedRecords: number; qualityIssues: Record<string, number> }
export interface UsageSnapshot {
  schemaVersion: "LocalUsagePreviewV1"; sourceSchemaVersion: "UsageSnapshotV1"; sourceCatalog: Record<string, AgentMeta>;
  catalogRevision: string; sequence: number; collectedAt: Timestamp | null; timezone: string; today: string | null; coverageStart: string | null;
  daily: UsageRow[]; hourly: UsageRow[]; sources: SourceStatus[]; recovered: Recovery[]; priceCatalog: PriceBasis;
}
export interface UsageState {
  snapshot: UsageSnapshot | null; snapshotRevision: number; enabled: boolean; refreshIntervalMs: number; subscriptions: Record<string, number>;
  collecting: boolean; error: string | null; diagnostic: JsonObject | null; audit: JsonObject | null; checkedAt: Timestamp | null;
}
export interface SourcePath { path: string; display?: string; origin: string; state: string; exists?: boolean; kind?: string; files?: number | null; latest?: Timestamp | null; issues?: string[] }
export interface DiscoverySource { agent: string; enabled: boolean; installed: boolean; files: number; latest: Timestamp | null; paths: SourcePath[]; custom?: boolean; archived?: boolean; mixedRules?: boolean; canRollback?: boolean }
export interface SourceDiscovery { schemaVersion: "SourceDiscoveryV1"; checkedAt: Timestamp; sources: DiscoverySource[]; unsupported: JsonObject[] }
export interface SourceSelection { agent: string; enabled: boolean; paths: SourcePath[] }
export interface SourceChangeResult { saved: true; selection: SourceSelection[]; discovery: SourceDiscovery | null; discoveryError: "DISCOVERY_FAILED" | null; state: UsageState }
export type SourceChooseResult = UsageState & { sourceSaved: boolean; sourceSelection?: SourceSelection[] };
export type SavedFile = { saved: true; rows?: number } | { canceled: true };
export interface SessionDay {
  date: string; totalTokens: number; records: number; partialRecords: number; pricedTokens: number; boundedTokens: number;
  inputUncached: NullableNumber; output: NullableNumber; cacheRead: NullableNumber; cacheWrite: NullableNumber; reasoning: NullableNumber;
  estimatedCostUsd: NullableNumber; estimatedCostUpperUsd: NullableNumber; knownUsage: Partial<Record<UsageField, number>>;
}
export interface Session { key: string; agent: string; entries: string[]; models: string[]; start: Timestamp; end: Timestamp; id: string | null; cwd: string | null; title?: string | null; project: string; resumable: boolean; days: SessionDay[] }
/** Names and pins the person gives sessions, keyed by the hashed session key (SESSIONS-NEXT-20261101.md). */
export type SessionLabels = Record<string, { alias?: string; pinned?: boolean; turn?: number; group?: string }>;
/** One session's conversation for the reading view (SESSIONS-READER-20261101.md); never stored. */
/** A tool call; output is a preview when outputLength says there is more. */
export interface TranscriptFile { path: string; kind: "edit" | "write" | "add" | "delete"; added: number; removed: number; to?: string }
export interface TranscriptTool { name: string; summary: string; output: string | null; outputLength?: number; error: boolean; commands?: string[]; change?: { files: TranscriptFile[]; length: number } }
/** One item, light: text in full up to 8K characters, else its opening with length; images by type and size. */
export interface TranscriptCitation { path: string; lines: string; note: string }
export interface TranscriptFacts { schemaVersion: "TranscriptFactsV1"; agent: string; stamp: string; turns: number; tools: number; failed: number; commands: number; compactions: number; images: number; subagents: number; reported: number | null; first: string | null; last: string | null; files: { path: string; added: number; removed: number; calls: number }[]; truncated: boolean }
export interface TranscriptItem { kind: "user" | "assistant" | "thinking" | "tool" | "context" | "command" | "image" | "compact"; time: string | null; side?: string; usage?: number; label?: string; attached?: { name: string; path?: string }[]; cited?: TranscriptCitation[]; answered?: boolean; compact?: { trigger: string | null; before: number | null }; text?: string; length?: number; tool?: TranscriptTool; from?: "user" | "assistant"; image?: { mime: string; bytes: number } }
export interface Transcript { continuation?: { count: number; digests: string[] }; schemaVersion: "TranscriptV2"; agent: string; stamp: string; items: TranscriptItem[]; truncated: boolean; turns: number; tools: number; failed: number }
export interface TranscriptPartRequest { stamp: string; index: number; field: "text" | "output" | "image" | "diff"; offset?: number }
/** A page of one item's full text or output (offset/total/next in characters), or its image as a data URL. */
export interface TranscriptPart { text?: string; offset?: number; total?: number; next?: number | null; clipped?: boolean; image?: string }
export interface TranscriptFind { hits: { index: number; count: number }[]; total: number }
export interface TranscriptSnippet { kind: TranscriptItem["kind"]; before: string; match: string; after: string }
/** One batch of a cross-session search: sessions with matches, how far the list was searched, where to go on. */
export interface TranscriptSearch { schemaVersion: "TranscriptSearchV1"; results: { key: string; hits: number; snippets: TranscriptSnippet[] }[]; searched: number; total: number; next: number | null }
export interface SessionList { schemaVersion: "SessionListV1"; sequence: number; timezone: string; today: string; sessions: Session[]; unattributed: Record<string, Record<string, number>> }
export interface SessionSelection { agent?: string; date?: string; model?: string }
export interface SessionSummary { count: number; agents: Record<string, number>; date: string; model: string }
export interface Billing { autoSync: boolean; mappings: Record<string, string>; defaults: Record<string, { mode: "actual" | "default"; model: string | null; multiplier: number }>; fallback?: string | null; partialLowerBound?: boolean }
export type AgentItemKind = "mcp" | "skill" | "hook" | "plugin" | "instruction" | "file";
export interface AgentItem { id: string; agent: string; kind: AgentItemKind; name: string; scope: "user" | "project"; project: string | null; file: string; openable: boolean; enabled: boolean | null; health: "ok" | "warn" | "issue" | "unknown"; problems: { level: "warn" | "issue" | "note"; text: string; fix: string; remedy: "stop" | "stop-optional" | "manual" | "none" }[]; details: { label: string; value: string }[]; updatedAt: string | null; actions: string[] }
export interface AgentInventory { schemaVersion: string; agents: { id: string; name: string; found: boolean; writable: boolean }[]; items: AgentItem[]; notes: { agent: string; text: string }[]; truncated: boolean }
export interface AgentsState { busy: boolean; error: string | null; checkedAt: string | null; inventory: AgentInventory | null; repaired: number; projects: { id: number; name: string }[] }
export interface AgentRepairPlan { rows: { id: string; name: string; agent: string; kind: string; file: string; text: string; chosen: boolean }[]; manual: { id: string; name: string; agent: string; kind: string; file: string; text: string; fix: string; why: string | null }[] }
export interface AgentRestoreRecord { id: string; at: string; summary: string; files: string[]; restorable: boolean }
export interface AgentUseRow { agent: string; kind: string; name: string; calls: number; sessions: number; last: string | null }
export interface PriceCoverage { records: number; tokens: number; counted: number; lower: NullableNumber; upper: NullableNumber; fallbackTokens: number; fallbackUsd: number; floorTokens: number; floorUsd: number; left: { reason: string; cause: string | null; tokens: number; records: number }[] }
export interface PriceTry { key: string; manual: boolean; current: PriceCoverage; results: { target: string; coverage: PriceCoverage }[] }
export interface PricePlanModels { models: { key: string; tokens: number; lower: number; agents: string[] }[]; tokens: number; lower: number }
export interface PricePlan { before: PriceCoverage; after: PriceCoverage; matched: { key: string; target: string; tokens: number; lower: NullableNumber; agents: string[] }[]; undecided: { key: string; tokens: number; agents: string[]; candidates: number; why: string }[]; fallback: (PricePlanModels & { target: string }) | null; floor: PricePlanModels; mappings: Record<string, string> }
export interface PriceRow extends PriceKey { rates: Partial<Rates>; origin: string; source?: string | null; target?: string | null; observed?: boolean; numbered?: boolean }
export interface PriceSync { enabled: boolean; syncing: boolean; [key: string]: unknown }
export interface PriceSuggestion { total: number; ambiguous: boolean; candidates: { target: string; reason: string; provider: string; model: string; origin: string; source: string | null; rates: Rates }[] }
export interface Pricing {
  version: string; obtainedAt: Timestamp; sha256: string; overrideSha256: string; basis: string; source: string; currencies: string[];
  tiers: JsonObject; billing: Billing; suggestions: Record<string, PriceSuggestion>; observed: (PriceKey & { target: string | null; priced: boolean })[];
  counts: { models: number; priced: number; unpriced: number; manual: number }; models: PriceRow[]; sync?: PriceSync;
}
export interface PriceProbe extends PriceKey { key: string; rates: Rates; origin: string; previous: Rates | null; affectedRecords: number; affectedTokens: number; coverage?: PriceCoverage; sample: { reason: string; lower: NullableNumber; upper: NullableNumber } | null }
// Fields read by the Codex rebuild preview (codex-maintenance-model.js).
export interface MaintenancePreview { id: string; files: number; records: number; previousTokens: number; rebuiltTokens: number; retainedTokens: number; [key: string]: unknown }
export type MaintenanceApply = { canceled: true } | { applied: true; state: UsageState };
export interface WorkbenchSelection { period?: "daily" | "weekly" | "monthly" | "total"; project?: string }
export interface WorkbenchIssue { id: string; code: string; agent: string | null; target: string; evidence: Json; fingerprint: string; acknowledged: boolean; [key: string]: unknown }
export interface WorkbenchTotal { records: number; totalTokens: number; pricedRecords: number; pricedTokens: number; boundedTokens: number; partialRecords: number; lower: NullableNumber; upper: NullableNumber; unpricedTokens: number; unpricedRecords: number; fields: Record<Exclude<UsageField, "outputPlain">, NullableNumber>; knownRecords: Partial<Record<UsageField, number>>; pricingReasons: Record<string, number> }
export interface Budget { limitUsd: NullableNumber; state: string; remainingUsd: NullableNumber; remainingUpperUsd: NullableNumber }
export interface BudgetOverview { budgets: (Budget & { scope: string; period: NonNullable<WorkbenchSelection["period"]>; projectName: string | null; projectLabel: string | null; range: { from: string | null; to: string }; total: WorkbenchTotal })[]; issues: WorkbenchIssue[]; omittedIssues: number }
export interface Workbench {
  schemaVersion: "WorkbenchV1"; sequence: number; timezone: string; today: string; selection: WorkbenchSelection; range: { from: string | null; to: string };
  projectOptions: { id: string; name: string; label: string }[]; projects: (WorkbenchTotal & { id: string; name: string; sessions: number; agents: (WorkbenchTotal & { agent: string })[] })[]; total: WorkbenchTotal; sources: JsonObject[];
  issues: WorkbenchIssue[]; omittedIssues: number; budget: Budget; budgetOverview: BudgetOverview; priceBasis: PriceBasis; historyStarts: string | null; scope: "observed-api-equivalent"; factRevision: number;
}
export type WorkbenchSave = ({ kind: "budget"; limitUsd: NullableNumber } | { kind: "acknowledge"; id: string; fingerprint: string; acknowledged: boolean }) & WorkbenchSelection;
export interface Attention { sources: JsonObject[]; issues: WorkbenchIssue[]; omittedIssues: number; budgetOverview: BudgetOverview }
export interface CustomDefinition { schemaVersion: "CustomSourceV1"; name: string; template: "claude" | "mapped" | "standard"; mode: string; [key: string]: Json }
export interface CustomDraft { token: string; id: string; definition: CustomDefinition; selected: boolean; locations: string[] }
export interface CustomPreview { id: string; summary: { files: number; records: number; totalTokens: number; unknown: Record<Exclude<UsageField, "outputPlain">, number>; added: number; removed: number; replaced: number; pricedRecords: number; [key: string]: unknown }; configHash: string; sourceStamp: string; sequence: number; expiresAt: Timestamp }
export interface CustomSaved { saved: true; id?: string; state: UsageState }
export type ConfigAgent = "codex" | "claude";
export type ConfigScope = "home" | "project";
export type ConfigKind = "mcp" | "hooks" | "skills";
export type ConfigCheckState = "static-ok" | "issue" | "unchecked" | "not-applicable";
export interface ConfigCheck { kind: string; state: ConfigCheckState; reason: string; location?: { section: string; entry?: number }; [key: string]: unknown }
export interface ConfigHealth {
  schemaVersion: "ConfigHealthV1"; contract: string; state: "unchecked"; reason: "PARTIAL_STATIC_SCOPE"; clientVersionVerified: false; runtimeVerified: false;
  scopes: ConfigScope[]; files: { agent: ConfigAgent; scope: ConfigScope; kind: string; checks: ConfigCheck[]; [key: string]: unknown }[];
  counts: Record<ConfigCheckState, number>; summary: Record<ConfigKind, { state: string; files: number; counts: Record<ConfigCheckState, number>; runtimeVerified: false }>; audit: JsonObject;
}
export interface ConfigState { busy: boolean; active: string | null; selections: Record<string, { selected: true; result: ConfigHealth | null; checkedAt: Timestamp | null; error: string | null }> }
export type ConfigReply<T> = T | { error: string };
export interface ConfigView { id: string; kind: ConfigKind; target: string; enabled: boolean | null; rows: { id: number; name: string; enabled: boolean | null }[]; undo: boolean; normalization: boolean }
export interface ConfigPreview { id: string; summary: string; backupRequired: true; normalization: boolean }
export type ConfigActionResult = { view: ConfigView } | { preview: ConfigPreview } | { released: true } | { canceled: true } | ({ applied: true; undo: true } & { state: ConfigState }) | { restored: true; state: ConfigState };
export interface RuntimeDiscovery { schemaVersion: string; checkedAt: Timestamp; entries: JsonObject[]; coverage: { complete: boolean; [key: string]: unknown }; selection?: JsonObject; [key: string]: unknown }
export interface AgentSetup { schemaVersion: string; revision: number; agent?: string; name?: string; reason: string; title: string; actions: { id: string; label: string; [key: string]: unknown }[]; installation: { mode: string; command: string | null; shell?: string | null; executed: boolean }; [key: string]: unknown }
export type SetupReply = { ok: true; state: AgentSetup; outcome?: string } | { ok: false; state: AgentSetup | null; errorCode: string; message: string };
export interface InstallerRow { agent: string; name: string; state: string; version: string | null; latest: string | null; managed: boolean; runnable: boolean | null; checkedAt: Timestamp | null; stage: string | null; busy: boolean; errorCode: string | null; message: string | null; updateAvailable: boolean; route: string; canCancel: boolean; quotaReady: false; [key: string]: unknown }
export interface InstallState { schemaVersion: "AgentInstallStateV1"; revision: number; active: string | null; blocked: boolean; persistWarning: boolean; rows: InstallerRow[] }
export type InstallReply = { ok: true; state: InstallState; message?: string } | { ok: false; message: string; state?: InstallState };
export interface Freshness { state: "fresh" | "stale" | "cached" | "missing"; reason: string | null }
export interface ResourceMeter {
  id: string; label: string | null; unit: "percent" | "tokens" | "requests" | "credits" | "currency" | "unknown"; currency: string | null;
  total: Decimal | null; used: Decimal | null; reserved: Decimal | null; remaining: Decimal | null;
  remainingMode: string; remainingSource: string | null; usedPercent: NullableNumber; remainingPercent: NullableNumber; availability: string;
  requiresEntitlement: boolean; observedAt: Timestamp | null; issues: string[]; state: string; freshness: Freshness; currentlyUsable: boolean | null;
}
export interface ResourceWindow extends ResourceMeter { role: "primary" | "secondary" | "other"; cadence: string; durationMins: NullableNumber; resetsAt: Timestamp | null }
export interface ResourceBalance extends ResourceMeter { kind: string; validFrom: Timestamp | null; expiresAt: Timestamp | null }
export interface ResourcePool { id: string; label: string | null; scope: string; modelIds: string[]; windows: ResourceWindow[]; balances: ResourceBalance[] }
export interface AccountQuotaV2 {
  schemaVersion: "AccountQuotaV2"; provider: string; fetchedAt: Timestamp | null; incomplete: boolean;
  provenance: { kind: string; version: string | null };
  entitlement: { plan: string | null; state: string; observedAt: Timestamp | null; validUntil: Timestamp | null; cancelAt: Timestamp | null; issues: string[]; verificationRequired: boolean; freshness: Freshness };
  pools: ResourcePool[]; resetCredits: number | null; coverage: Record<Freshness["state"], number>; partial: boolean; hasMeasurements: boolean;
}
export interface LegacyWindow { bucket: string; name: string; kind: "primary" | "secondary"; usedPercent: NullableNumber; remainingPercent: NullableNumber; durationMins: NullableNumber; resetsAt: Timestamp | null }
export interface AccountQuotaV1 { schemaVersion: "AccountQuotaV1"; fetchedAt: Timestamp | null; windows: LegacyWindow[]; resetCredits: number | null }
export interface QuotaAccount<Q> { id: string; alias: string; plan: string | null; status: string; errorCode: string | null; quota: Q | null; busy: boolean; lastAttempt: Timestamp | null; nextRefreshAt: Timestamp | null; duplicateKnown: boolean; duplicateAccountIds: string[]; [key: string]: unknown }
export interface ProviderCapability { provider: string; name: string; adapters: { id: string; name: string; experimental?: boolean; websiteLogin: boolean; clientLogin: boolean; clientOnly: boolean; clientMode: "key" | null; kind: string; provenance: string; note: string }[]; reason: string; [key: string]: unknown }
export interface ProviderAccount { id: string; adapter: string; alias: string; provider: string; quota: AccountQuotaV2 | null; status: string; errorCode: string | null; busy: boolean; remembered: boolean; credentialExpiresAt: Timestamp | null; passive: boolean; errorMessage: string | null; credentialReady: boolean; credentialRetryable: boolean; [key: string]: unknown }
export interface ProviderState { schemaVersion: "ProviderQuotaStateV1"; experimentalEnabled?: boolean; refreshConcurrency: JsonObject; capabilities: ProviderCapability[]; cacheError: string | null; cleanupError: string | null; pendingWebsiteLogin: { adapter: string; id: string } | null; accounts: ProviderAccount[] }
export interface QuotaState {
  schemaVersion: "QuotaStateV1"; refreshConcurrency: JsonObject; executableAvailable: boolean; autoRefresh: "off" | "1min"; nextAutoAt: Timestamp | null;
  lastBatch: JsonObject | null; lastProviderBatch: JsonObject | null; operationBusy: boolean; recovered: JsonObject | null;
  accounts: QuotaAccount<AccountQuotaV1>[]; pendingLogin: { accountId: string } | null;
}
export interface QuotaStateV2 extends Omit<QuotaState, "schemaVersion" | "accounts"> { schemaVersion: "QuotaStateV2"; accounts: (QuotaAccount<AccountQuotaV2> | ProviderAccount)[]; providerAccounts: ProviderAccount[]; providerCapabilities: ProviderCapability[] }
// Failure states differ by handler: quota V1 keeps its cache, V2 may return null.
export type QuotaReply<T, FailureState = T> = { ok: true; state: T } | { ok: false; errorCode: string; error?: string; state: FailureState; errorStage?: string | null; storageCode?: string | null };
export interface ProviderConnect { adapter: string; alias: string; credential?: string; project?: string; remember?: boolean; userAgent?: string; organization?: string; workspace?: string }
export type ProviderAction = { action: "refresh" | "cancel" | "remove"; id: string } | { action: "credential"; id: string; credential: string; project?: string; remember?: boolean; userAgent?: string; organization?: string; workspace?: string };
export interface ConnectionRow { agent: string; name: string; custom: boolean; archived: boolean; usage: { state: string; lastState: string | null; observedRecords: number | null; lastSuccess: Timestamp | null; checkedAt: Timestamp | null }; quota: { capability: string; connectionState: string; connections: number | null; loginRequired: number | null; failed: number | null; refreshing: number | null; duplicates: number | null; freshness: Record<Freshness["state"], number> | null; latestSuccess: Timestamp | null; oldestSuccess: Timestamp | null; latestAttempt: Timestamp | null; cliAvailable: boolean | null; cacheRecovered: boolean | null; resourceCoverage?: Record<Freshness["state"], number>; partialConnections?: number } }
export interface Connections { schemaVersion: "SourceConnectionsV1"; observedAt: Timestamp; rows: ConnectionRow[] }
export interface ConnectionsV2 extends Omit<Connections, "schemaVersion"> { schemaVersion: "SourceConnectionsV2" }
export interface WindowState { focused: boolean; maximized: boolean }
export type ViewName = "settings" | "sources" | "sessions" | "quota" | "usage" | "cost";
