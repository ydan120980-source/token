import { useCallback, useEffect, useRef, useState } from "react";
import type * as T from "./types";

// usage-data.js replaces only get/refresh with decoded snapshot methods. This
// interface describes that renderer bridge, never the packed preload transport.
export interface UsageBridge {
  connections(): Promise<T.Connections>;
  connectionsV2(): Promise<T.ConnectionsV2>;
  configState(): Promise<T.ConfigReply<T.ConfigState>>;
  configChoose(agent: T.ConfigAgent, scope: T.ConfigScope): Promise<T.ConfigReply<{ state: T.ConfigState; canceled?: true }>>;
  configCheck(agent: T.ConfigAgent, scope: T.ConfigScope): Promise<T.ConfigReply<{ state: T.ConfigState }>>;
  configForget(agent: T.ConfigAgent, scope: T.ConfigScope): Promise<T.ConfigReply<{ state: T.ConfigState }>>;
  configCancel(): Promise<T.ConfigReply<{ state: T.ConfigState }>>;
  configManage(action: "list" | "release" | "preview" | "apply" | "undo" | "import", agent: T.ConfigAgent, scope: T.ConfigScope, kind: T.ConfigKind, request?: T.JsonObject): Promise<T.ConfigReply<T.ConfigActionResult>>;
  agentSetup(agent: string): Promise<T.SetupReply>;
  agentSetupAction(request: { agent: string; actionId: string; revision: number }): Promise<T.SetupReply>;
  installers(): Promise<T.InstallReply>;
  installerAction(request: { action: "check" | "install" | "cancel" | "official" | "dismiss-installer" | "copy-launch" | "check-all" | "upgrade-all"; agent: string; revision: number }): Promise<T.InstallReply>;
  onInstallUpdate: T.Subscribe;
  pricing(): Promise<T.Pricing>;
  savePrice(entry: T.PriceEntry): Promise<T.Pricing>;
  resetPrice(entry: T.PriceKey): Promise<T.Pricing>;
  syncPrices(): Promise<T.PriceSync>;
  autoPrices(enabled: boolean): Promise<T.PriceSync>;
  saveBilling(value: T.Billing): Promise<T.Pricing>;
  previewCodex(): Promise<T.MaintenancePreview | null>;
  applyCodex(id: string): Promise<T.MaintenanceApply>;
  get(revision?: number | null): Promise<T.UsageState>;
  refresh(): Promise<T.UsageState>;
  performanceState(): Promise<{ workerStarts: number; requests: number; completed: number; failed: number; maxInFlight: number; packedSnapshotBytes: number; inFlight: number; workerPresent: boolean }>;
  statisticsDiagnostics(): Promise<{ requests: Awaited<ReturnType<UsageBridge["performanceState"]>>; lifecycle: { workerFailures: number; timeouts: number; rejected: number }; owner: T.JsonObject | null }>;
  setEnabled(value: boolean): Promise<T.UsageState>;
  setRefreshInterval(value: number): Promise<T.UsageState>;
  setSubscription(agent: string, fee: number | null): Promise<T.UsageState>;
  chooseSource(agent: string): Promise<T.SourceChooseResult>;
  customDraft(id?: string): Promise<T.CustomDraft>;
  customChoose(token: string): Promise<{ canceled: true } | { selected: true; count: number; locations: string[] }>;
  customSample(token: string): Promise<{ fields: { path: string; type: string; example: string }[]; rows: number; bytes: number }>;
  customPreview(token: string, config: T.CustomDefinition): Promise<T.CustomPreview>;
  customApply(id: string): Promise<T.CustomSaved>;
  customChange(id: string, action: "enable" | "remove" | "rollback", value?: boolean): Promise<T.CustomSaved>;
  customImport(): Promise<{ canceled: true } | T.CustomDraft>;
  customExport(id: string): Promise<T.SavedFile>;
  sources(): Promise<T.SourceDiscovery>;
  changeSource(name: "all" | "enable" | "reset" | "remove" | "include", agent: string | null, value?: string | boolean): Promise<T.SourceChangeResult>;
  exportStatistics(snapshot: T.UsageSnapshot): Promise<T.SavedFile>;
  exportCost(request: { by: "model" | "agent"; from?: string | null; to?: string | null; [key: string]: unknown }): Promise<T.SavedFile>;
  probePrice(entry: T.PriceEntry): Promise<T.PriceProbe>;
  agents(action: string, ...args: unknown[]): Promise<any>;
  revealSourcePath(path: string): Promise<{ shown: boolean }>;
  dataInfo?(): Promise<{ version: string; path: string; bytes: number }>;
  openData(): Promise<void>;
  agentUse(request: { offset: number }): Promise<{ rows: T.AgentUseRow[]; searched: number; total: number; next: number | null }>;
  tryPrice(request: { key: string; targets: string[] }): Promise<T.PriceTry>;
  pricePlan(request: { auto?: boolean; fallback?: string | null; partial?: boolean }): Promise<T.PricePlan>;
  sessions(selection?: { range?: "today" | "7" | "30" | "all"; recent?: boolean }): Promise<T.SessionList>;
  sessionSummary(selection: T.SessionSelection): Promise<T.SessionSummary>;
  sessionLabels(): Promise<T.SessionLabels>;
  transcript(key: string): Promise<T.Transcript>;
  searchTranscripts(request: { query: string; range: string; agent: string; offset: number }): Promise<T.TranscriptSearch>;
  transcriptPart(key: string, request: T.TranscriptPartRequest): Promise<T.TranscriptPart>;
  transcriptFind(key: string, request: { stamp: string; query: string }): Promise<T.TranscriptFind>;
  transcriptCopy(key: string, request: { stamp: string; from: number; to: number }): Promise<{ copied: true }>;
  transcriptExport(key: string, request: { stamp: string; from: number; to: number; name: string }): Promise<{ saved?: true; canceled?: true }>;
  openLink(url: string): Promise<{ opened: true }>;
  setSessionLabel(key: string, patch: { alias?: string | null; pinned?: boolean; group?: string | null }): Promise<T.SessionLabels>;
  transcriptFacts(key: string): Promise<T.TranscriptFacts>;
  transcriptFileHistory(request: { key: string; path: string; offset: number }): Promise<{ schemaVersion: "TranscriptFileHistoryV1"; results: { key: string; exact: boolean; path: string; added: number; removed: number; calls: number }[]; searched: number; total: number; next: number | null }>;
  attention(): Promise<T.Attention>;
  copyResume(key: string): Promise<{ copied: true }>;
  copyText(text: string): Promise<{ copied: true }>;
  openFolder(key: string): Promise<{ opened: true; path: string }>;
  workbench(selection?: T.WorkbenchSelection): Promise<T.Workbench>;
  saveWorkbench(value: T.WorkbenchSave): Promise<T.Workbench>;
  reprice(): Promise<{ recalculated: true; records: number; sequence: number; priceBasis: T.PriceBasis }>;
  exportProjects(selection: T.WorkbenchSelection): Promise<T.SavedFile>;
  onUpdate: T.Subscribe;
}
export interface QuotaBridge {
  providerExperimental(value: boolean): Promise<T.QuotaReply<T.ProviderState>>;
  providers(): Promise<T.QuotaReply<T.ProviderState>>;
  providerConnect(request: T.ProviderConnect): Promise<T.QuotaReply<T.ProviderState>>;
  providerAction(request: T.ProviderAction): Promise<T.QuotaReply<T.ProviderState>>;
  providerGuide(adapter: string): Promise<T.QuotaReply<T.ProviderState>>;
  providerPassiveGuide(id: string): Promise<T.QuotaReply<T.ProviderState>>;
  providerWebsiteLogin(request: T.ProviderConnect): Promise<T.QuotaReply<T.ProviderState>>;
  providerClientLogin(request: T.ProviderConnect): Promise<T.QuotaReply<T.ProviderState>>;
  providerWebsiteCancel(): Promise<T.QuotaReply<T.ProviderState>>;
  onProviderUpdate: T.Subscribe;
  discoverAntigravity(): Promise<{ ok: true; discovery: T.RuntimeDiscovery } | { ok: false; errorCode: string; discovery: null }>;
  antigravitySetup(): Promise<T.SetupReply>;
  antigravitySetupAction(request: { actionId: string; revision: number }): Promise<T.SetupReply>;
  getV2(): Promise<T.QuotaReply<T.QuotaStateV2, null>>;
  get(): Promise<T.QuotaReply<T.QuotaState>>;
  login(alias: string): Promise<T.QuotaReply<T.QuotaState>>;
  cancel(): Promise<T.QuotaReply<T.QuotaState>>;
  refresh(id: string): Promise<T.QuotaReply<T.QuotaState>>;
  refreshAll(): Promise<T.QuotaReply<T.QuotaState>>;
  setAutoRefresh(value: "off" | "1min"): Promise<T.QuotaReply<T.QuotaState>>;
  remove(id: string): Promise<T.QuotaReply<T.QuotaState>>;
  chooseExecutable(): Promise<T.QuotaReply<T.QuotaState>>;
  onUpdate: T.Subscribe;
}
export interface WindowBridge {
  menu(name: "app" | "statistics" | "appearance" | "about"): Promise<true>;
  theme(value: "light" | "dark"): Promise<true>;
  state(): Promise<T.WindowState>;
  onCommand(callback: (command: string) => void): T.Unsubscribe;
  onState(callback: (state: T.WindowState) => void): T.Unsubscribe;
}
declare global {
  interface Window { usageBridge?: UsageBridge; quotaBridge?: QuotaBridge; windowBridge?: WindowBridge }
}
// These getters only return the existing object; no IPC occurs on import/read.
export function getUsageBridge(): UsageBridge { if (!window.usageBridge) throw Error("UI_USAGE_BRIDGE_UNAVAILABLE"); return window.usageBridge; }
export function getQuotaBridge(): QuotaBridge { if (!window.quotaBridge) throw Error("UI_QUOTA_BRIDGE_UNAVAILABLE"); return window.quotaBridge; }
export function getWindowBridge(): WindowBridge { if (!window.windowBridge) throw Error("UI_WINDOW_BRIDGE_UNAVAILABLE"); return window.windowBridge; }

export interface BridgeState<Value> { status: "idle" | "loading" | "ready" | "error"; loading: boolean; data: Value | null; error: Error | null }
interface Run { active: boolean; again: boolean; task: Promise<void> | null }
export interface BridgeOptions { enabled?: boolean; subscribe?: T.Subscribe; requestKey?: string | number }
// read must be an explicitly selected read, not Connect/Refresh/mutation. Wire
// onUpdate/onProviderUpdate/onInstallUpdate through subscribe as appropriate.
// Returned envelopes are not flattened: a fulfilled {ok:false,state:...} stays
// data for the caller to handle, preserving cached state and provider errors.
export function useBridge<Value>(read: () => Promise<Value>, { enabled = true, subscribe, requestKey }: BridgeOptions = {}) {
  const reader = useRef(read), current = useRef<Run | null>(null);
  const lastKey = useRef(requestKey);
  reader.current = read;
  const [state, setState] = useState<BridgeState<Value>>({ status: "idle", loading: false, data: null, error: null });
  const run = useCallback((session: Run): Promise<void> => {
    if (!session.active) return Promise.resolve();
    if (session.task) { session.again = true; return session.task; }
    const task = (async () => {
      do {
        session.again = false;
        setState(previous => ({ status: "loading", loading: true, data: previous.data, error: null }));
        try {
          const data = await reader.current();
          if (session.active) setState({ status: "ready", loading: false, data, error: null });
        } catch (error) {
          if (session.active) setState(previous => ({ status: "error", loading: false, data: previous.data, error: error instanceof Error ? error : Error(String(error)) }));
        }
      } while (session.active && session.again);
    })();
    session.task = task;
    void task.finally(() => { session.task = null; });
    return task;
  }, []);
  const reload = useCallback(() => current.current ? run(current.current) : Promise.resolve(), [run]);
  useEffect(() => {
    // A different selection/account must never inherit the previous key's
    // data. A retry of the same key still retains its last successful value.
    if (lastKey.current !== requestKey) {
      lastKey.current = requestKey;
      setState({ status: "idle", loading: false, data: null, error: null });
    }
    if (!enabled) { setState(previous => ({ ...previous, status: "idle", loading: false, error: null })); return; }
    const session: Run = { active: true, again: false, task: null };
    current.current = session;
    const stop = subscribe?.(() => { void run(session); });
    void run(session);
    return () => { session.active = false; session.again = false; stop?.(); if (current.current === session) current.current = null; };
  }, [enabled, subscribe, requestKey, run]);
  return { ...state, reload };
}
