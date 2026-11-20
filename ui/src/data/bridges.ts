import { useCallback, useEffect, useRef, useState } from "react";
import type * as T from "./types";
import type { ShellBridge } from "./shell-host";

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
  pricingCoverage(): Promise<T.PriceCoverage | null>;
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
interface TauriApi {
  core: { invoke<Result>(command: string, args?: Record<string, unknown>): Promise<Result> };
  event: { listen<Result>(event: string, callback: (event: { payload: Result }) => void): Promise<T.Unsubscribe> };
}
declare global {
  interface Window {
    usageBridge?: UsageBridge;
    quotaBridge?: QuotaBridge;
    windowBridge?: WindowBridge;
    __TAURI__?: TauriApi;
  }
}

function installTauriReader(api: TauriApi) {
  const invoke = <Result,>(command: string, args?: Record<string, unknown>) =>
    api.core.invoke<Result>(command, args).catch((error: unknown) => {
      throw error instanceof Error ? error : Error(String(error));
    });
  const listen = <Result,>(event: string, callback: (payload: Result) => void, ready?: () => void): T.Unsubscribe => {
    let stopped = false;
    const registration = api.event.listen<Result>(event, ({ payload }) => { if (!stopped) callback(payload); });
    void registration.then(() => { if (!stopped) ready?.(); }, () => {});
    return () => {
      if (stopped) return;
      stopped = true;
      void registration.then(unlisten => unlisten(), () => {});
    };
  };
  // usage-data.js consumes this transport after the classic bundle loads.
  const transport = {
    get: () => invoke<T.UsageState>("usage_get"),
    refresh: () => invoke<T.UsageState>("usage_refresh"),
    performanceState: () => invoke<Awaited<ReturnType<UsageBridge["performanceState"]>>>("usage_performance_state"),
    statisticsDiagnostics: () => invoke<Awaited<ReturnType<UsageBridge["statisticsDiagnostics"]>>>("usage_statistics_diagnostics"),
    setRefreshInterval: (value: number) => invoke<T.UsageState>("usage_set_refresh_interval", { value }),
    sessions: (selection?: Parameters<UsageBridge["sessions"]>[0]) => invoke<T.SessionList>("usage_sessions", { selection }),
    sessionSummary: (selection: T.SessionSelection) => invoke<T.SessionSummary>("usage_session_summary", { selection }),
    dataInfo: () => invoke<{ version: string; path: string; bytes: number }>("usage_data_info"),
    openData: () => invoke<void>("usage_open_data"),
    sources: () => invoke<T.SourceDiscovery>("usage_sources"),
    configState: () => invoke<Awaited<ReturnType<UsageBridge["configState"]>>>("usage_config_state"),
    configChoose: (agent: T.ConfigAgent, scope: T.ConfigScope) =>
      invoke<Awaited<ReturnType<UsageBridge["configChoose"]>>>("usage_config_choose", { agent, scope }),
    configCheck: (agent: T.ConfigAgent, scope: T.ConfigScope) =>
      invoke<Awaited<ReturnType<UsageBridge["configCheck"]>>>("usage_config_check", { agent, scope }),
    configForget: (agent: T.ConfigAgent, scope: T.ConfigScope) =>
      invoke<Awaited<ReturnType<UsageBridge["configForget"]>>>("usage_config_forget", { agent, scope }),
    configCancel: () => invoke<Awaited<ReturnType<UsageBridge["configCancel"]>>>("usage_config_cancel"),
    configManage: (...[action, agent, scope, kind, request]: Parameters<UsageBridge["configManage"]>) =>
      invoke<Awaited<ReturnType<UsageBridge["configManage"]>>>("usage_config_manage", { action, agent, scope, kind, request }),
    customDraft: (id?: string) => invoke<T.CustomDraft>("usage_custom_draft", { id }),
    customChoose: (token: string) => invoke<Awaited<ReturnType<UsageBridge["customChoose"]>>>("usage_custom_choose", { token }),
    customSample: (token: string) => invoke<Awaited<ReturnType<UsageBridge["customSample"]>>>("usage_custom_sample", { token }),
    customPreview: (token: string, config: T.CustomDefinition) => invoke<T.CustomPreview>("usage_custom_preview", { token, config }),
    customApply: (id: string) => invoke<T.CustomSaved>("usage_custom_apply", { id }),
    customChange: (id: string, action: Parameters<UsageBridge["customChange"]>[1], value?: boolean) =>
      invoke<T.CustomSaved>("usage_custom_change", { id, action, value }),
    customImport: () => invoke<Awaited<ReturnType<UsageBridge["customImport"]>>>("usage_custom_import"),
    customExport: (id: string) => invoke<T.SavedFile>("usage_custom_export", { id }),
    connections: () => invoke<T.Connections>("usage_connections"),
    connectionsV2: () => invoke<T.ConnectionsV2>("usage_connections_v2"),
    setEnabled: (value: boolean) => invoke<T.UsageState>("usage_set_enabled", { value }),
    setSubscription: (agent: string, fee: number | null) => invoke<T.UsageState>("usage_subscription", { agent, fee }),
    chooseSource: (agent: string) => invoke<T.SourceChooseResult>("usage_choose_source", { agent }),
    changeSource: (name: string, agent: string | null, value?: string | boolean) =>
      invoke<T.SourceChangeResult>("usage_change_source", { name, agent, value }),
    revealSourcePath: (file: string) => invoke<{ shown: boolean }>("usage_reveal_source", { file }),
    pricing: () => invoke<T.Pricing>("usage_pricing"),
    pricingCoverage: () => invoke<T.PriceCoverage | null>("usage_pricing", { view: "coverage" }),
    savePrice: (entry: T.PriceEntry) => invoke<T.Pricing>("usage_price_save", { entry }),
    resetPrice: (entry: T.PriceKey) => invoke<T.Pricing>("usage_price_reset", { entry }),
    saveBilling: (value: T.Billing) => invoke<T.Pricing>("usage_billing_save", { value }),
    previewCodex: () => invoke<T.MaintenancePreview | null>("usage_codex_preview"),
    applyCodex: (id: string) => invoke<T.MaintenanceApply>("usage_codex_apply", { id }),
    syncPrices: () => invoke<T.PriceSync>("usage_price_sync"),
    autoPrices: (enabled: boolean) => invoke<T.PriceSync>("usage_price_auto", { enabled }),
    probePrice: (entry: T.PriceEntry) => invoke<T.PriceProbe>("usage_price_probe", { entry }),
    tryPrice: (request: Parameters<UsageBridge["tryPrice"]>[0]) => invoke<T.PriceTry>("usage_price_try", { request }),
    pricePlan: (request: Parameters<UsageBridge["pricePlan"]>[0]) => invoke<T.PricePlan>("usage_price_plan", { request }),
    reprice: () => invoke<Awaited<ReturnType<UsageBridge["reprice"]>>>("usage_reprice"),
    saveWorkbench: (value: T.WorkbenchSave) => invoke<T.Workbench>("usage_workbench_save", { value }),
    workbench: (selection?: T.WorkbenchSelection) => invoke<T.Workbench>("usage_workbench", { selection }),
    attention: () => invoke<T.Attention>("usage_attention"),
    sessionLabels: () => invoke<T.SessionLabels>("usage_session_labels"),
    // The shared shell asks for Agent admin state on mount. Report the
    // unavailable feature through the error envelope that panel handles.
    agents: (action: string, ...args: unknown[]) => invoke("usage_agents", { action, args }),
    agentSetup: (agent: string) => invoke<T.SetupReply>("usage_agent_setup", { agent }),
    agentSetupAction: (request: Parameters<UsageBridge["agentSetupAction"]>[0]) => invoke<T.SetupReply>("usage_agent_setup_action", { request }),
    agentUse: (request: Parameters<UsageBridge["agentUse"]>[0]) => invoke<Awaited<ReturnType<UsageBridge["agentUse"]>>>("usage_agent_use", { request }),
    installers: () => invoke<T.InstallReply>("usage_installers"),
    installerAction: (request: Parameters<UsageBridge["installerAction"]>[0]) => invoke<T.InstallReply>("usage_installer_action", { request }),
    onInstallUpdate: (callback: () => void) => listen("usage:installUpdate", callback),
    setSessionLabel: (key: string, patch: Parameters<UsageBridge["setSessionLabel"]>[1]) =>
      invoke<T.SessionLabels>("usage_session_label", { key, patch }),
    transcript: (key: string, proof?: unknown) => invoke<T.Transcript>("usage_transcript", { key, proof }),
    transcriptPart: (key: string, request: T.TranscriptPartRequest) =>
      invoke<T.TranscriptPart>("usage_transcript_part", { key, request }),
    transcriptFind: (key: string, request: Parameters<UsageBridge["transcriptFind"]>[1]) =>
      invoke<T.TranscriptFind>("usage_transcript_find", { key, request }),
    transcriptStamp: (key: string) => invoke<{ stamp: string }>("usage_transcript_stamp", { key }),
    transcriptFacts: (key: string) => invoke<T.TranscriptFacts>("usage_transcript_facts", { key }),
    searchTranscripts: (request: Parameters<UsageBridge["searchTranscripts"]>[0]) =>
      invoke<T.TranscriptSearch>("usage_search_transcripts", { request }),
    transcriptFileHistory: (request: Parameters<UsageBridge["transcriptFileHistory"]>[0]) =>
      invoke<Awaited<ReturnType<UsageBridge["transcriptFileHistory"]>>>("usage_transcript_file_history", { request }),
    onUpdate: (callback: () => void) => listen("usage:update", callback),
    exportStatistics: (payload: T.UsageSnapshot) => invoke<T.SavedFile>("usage_export_statistics", { payload }),
    exportCost: (request: Parameters<UsageBridge["exportCost"]>[0]) => invoke<T.SavedFile>("usage_export_cost", { request }),
    exportProjects: (selection?: T.WorkbenchSelection) => invoke<T.SavedFile>("usage_export_projects", { selection }),
    transcriptCopy: (key: string, request: Parameters<UsageBridge["transcriptCopy"]>[1]) =>
      invoke<{ copied: true }>("usage_transcript_copy", { key, request }),
    transcriptExport: (key: string, request: Parameters<UsageBridge["transcriptExport"]>[1]) =>
      invoke<T.SavedFile>("usage_transcript_export", { key, request }),
    copyText: (text: string) => invoke<{ copied: true }>("usage_copy_text", { text }),
    copyResume: (key: string) => invoke<{ copied: true }>("usage_copy_resume", { key }),
    openLink: (url: string) => invoke<{ opened: true }>("usage_open_link", { url }),
    openFolder: (key: string) => invoke<{ opened: true; path: string }>("usage_open_folder", { key }),
  };
  Object.defineProperty(window, "usageTransport", { enumerable: true, value: Object.freeze(transport) });
  Object.defineProperty(window, "previewUsage", { enumerable: true, value: Object.freeze({
    schemaVersion: "LocalUsagePreviewV1", sequence: 0,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    daily: [], hourly: [], sources: [], loading: true,
  }) });
  const windowBridge: WindowBridge = {
    menu: name => invoke<true>("desktop_menu", { name }),
    theme: (value: "light" | "dark") => invoke<true>("desktop_theme", { value }),
    state: () => invoke<T.WindowState>("desktop_state"),
    onCommand: callback => {
      let live = true;
      const consume = () => { void invoke<string | null>("desktop_take_open_command").then(command => {
        if (live && command) callback(command);
      }, () => {}); };
      const native = listen("window:command", callback);
      const pending = listen("window:openCommandPending", consume, consume);
      return () => { live = false; native(); pending(); };
    },
    onState: callback => listen("window:state", callback),
  };
  Object.defineProperty(window, "windowBridge", { enumerable: true, value: Object.freeze(windowBridge) });
  const providers = () => invoke<T.QuotaReply<T.ProviderState>>("quota_providers");
  const quotaState = () => invoke<T.QuotaReply<T.QuotaState>>("quota_get", { versionTwo: false });
  const quotaBridge: QuotaBridge = {
    providers,
    providerExperimental: enabled => invoke("quota_provider_experimental", { enabled }),
    providerConnect: request => invoke("quota_provider_connect", { request }),
    providerAction: request => invoke("quota_provider_action", { request }),
    providerGuide: adapter => invoke("quota_provider_guide", { adapter }),
    providerPassiveGuide: id => invoke("quota_provider_passive_guide", { id }),
    providerWebsiteLogin: request => invoke("quota_provider_website_login", { request }),
    providerClientLogin: request => invoke("quota_provider_client_login", { request }),
    providerWebsiteCancel: () => invoke("quota_provider_website_cancel"),
    onProviderUpdate: callback => listen("quota:providerUpdate", callback),
    discoverAntigravity: () => invoke("quota_discover_antigravity"),
    antigravitySetup: () => invoke("quota_antigravity_setup"),
    antigravitySetupAction: request => invoke("quota_antigravity_setup_action", { request }),
    getV2: () => invoke("quota_get", { versionTwo: true }),
    get: quotaState,
    login: alias => invoke("quota_login", { alias }),
    cancel: () => invoke("quota_cancel"),
    refresh: id => invoke("quota_refresh", { id }),
    refreshAll: () => invoke("quota_refresh_all"),
    setAutoRefresh: value => invoke("quota_set_auto_refresh", { value }),
    remove: id => invoke("quota_remove", { id }),
    chooseExecutable: () => invoke("quota_choose_executable"),
    onUpdate: callback => listen("quota:update", callback),
  };
  Object.defineProperty(window, "quotaBridge", { enumerable: true, value: Object.freeze(quotaBridge) });
  const shellBridge: ShellBridge = {
    get: () => invoke("shell_get"),
    set: patch => invoke("shell_set", { patch }),
    readHistory: id => invoke("shell_read_history", { id }),
  };
  Object.defineProperty(window, "shellBridge", { enumerable: true, value: Object.freeze(shellBridge) });
  const githubBridge: NonNullable<Window["githubBridge"]> = {
    get: () => invoke("github_get"),
    connect: () => invoke("github_connect"),
    cancel: () => invoke("github_cancel"),
    disconnect: () => invoke("github_disconnect"),
    repositories: () => invoke("github_repositories"),
    setSync: request => invoke("github_set_sync", { request }),
    syncNow: () => invoke("github_sync_now"),
    copyCode: () => invoke("github_copy_code"),
    open: url => invoke("github_open", { url }),
    onUpdate: callback => listen("github:update", callback),
  };
  Object.defineProperty(window, "githubBridge", { enumerable: true, value: Object.freeze(githubBridge) });
  const updateBridge: NonNullable<Window["updateBridge"]> = {
    get: () => invoke("update_get"),
    check: () => invoke("update_check"),
    cancel: () => invoke("update_cancel"),
    install: () => invoke("update_install"),
    open: url => invoke("update_open", { url }),
    onUpdate: callback => listen("update:state", callback),
  };
  Object.defineProperty(window, "updateBridge", { enumerable: true, value: Object.freeze(updateBridge) });
  const caption = (action: "minimize" | "toggleMaximize" | "close" | "drag") =>
    void invoke<void>("desktop_caption", { action }).catch(() => {});
  document.addEventListener("DOMContentLoaded", () => {
    const titlebar = document.querySelector("#appTitlebar");
    if (!titlebar) return;
    const controls = document.createElement("div");
    controls.className = "tauri-caption";
    const minimize = document.createElement("button");
    const maximize = document.createElement("button");
    const close = document.createElement("button");
    for (const [button, action, label] of [
      [minimize, "minimize", "最小化"],
      [maximize, "toggleMaximize", "最大化"],
      [close, "close", "关闭"],
    ] as const) {
      button.type = "button";
      button.dataset.caption = action;
      button.setAttribute("aria-label", label);
      button.addEventListener("click", () => caption(action));
      controls.append(button);
    }
    titlebar.append(controls);
    const showMaximized = (state: T.WindowState) => {
      maximize.dataset.maximized = String(state.maximized);
      maximize.setAttribute("aria-label", state.maximized ? "向下还原" : "最大化");
    };
    const stop = windowBridge.onState(showMaximized);
    void windowBridge.state().then(showMaximized).catch(() => {});
    window.addEventListener("unload", stop, { once: true });
    titlebar.addEventListener("mousedown", event => {
      const mouse = event as MouseEvent;
      if (mouse.button !== 0 || !(mouse.target instanceof Element) ||
          mouse.target.closest("button, a, input, select, [data-ui-portal]")) return;
      caption(mouse.detail === 2 ? "toggleMaximize" : "drag");
    });
  }, { once: true });
}

if (import.meta.env.VITE_QUOTADOCK_TAURI_READER === "1" && typeof window !== "undefined" &&
    window.__TAURI__ && !Object.hasOwn(window, "usageTransport")) {
  installTauriReader(window.__TAURI__);
}

// These getters only return the existing objects.
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
