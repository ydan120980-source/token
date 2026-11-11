import type { AttentionItem } from "./insights-host";
import { useSyncExternalStore } from "react";
import type { ConnectionRow } from "./types";
import type { AgentCatalog } from "./globals";
// Old-side contracts, shaped by the existing bridge results. Host methods perform all actions.
export interface SourceReadPath { path: string; display: string; origin: string; state: string; exists: boolean; kind: string; files: number | null; issues: string[] }
export interface Source { agent: string; enabled: boolean; installed: boolean; files: number | null; latest: string | null; paths: SourceReadPath[]; canRollback?: boolean; mixedRules?: boolean }
export interface SourceReadStatus { agent: string; observedRecords?: number | null; errors: string[]; qualityIssues?: Record<string, number>; status: string; lastSuccess: string | null; realSampleVerified?: boolean }
export interface SourcesState { discovery: { sources: Source[]; unsupported: { id: string; name: string; markers: string[] }[]; checkedAt?: string } | null; statuses: SourceReadStatus[] | null; busy: boolean; stale: boolean; stage: string; message: string; notice: string; retry: (() => Promise<void>) | null; collection: { collecting?: boolean; enabled?: boolean; error?: string; checkedAt?: string } | null }
export interface SourceInstallerRow { agent: string; name: string; route: string; state: string; stage?: string; busy?: boolean; managed?: boolean; version?: string; latest?: string; updateAvailable?: boolean; message?: string; attempt?: number; downloadedBytes?: number; totalBytes?: number; localMaintenanceRequired?: boolean; canCancel?: boolean; launchCommand?: string }
export interface Installers { snapshot: { revision: string; blocked: boolean; rows: SourceInstallerRow[] } | null; selected: string | null; message: string; loading: string | null; pending: boolean }
export interface Setup { current: { name: string; title: string; providerNote: string; revision: string; steps: string[]; usage: { state: string; steps: string[] }; installation: { command: string | null }; actions: { id: string; label: string }[]; quotaDescription: string; checkedAt?: string; notice: string } | null; selected: string | null; busy: boolean; message: string }
export interface Check { state: string; label: string; reason: string; location: string }
export interface ConfigItem { checkedAt?: string; error?: string; result?: { summary: Record<string, { state: string; counts: Record<string, number> }>; files: { kind: string; checks: unknown[] }[] } }
export interface Config { state: { selections: Record<string, ConfigItem>; busy: boolean }; pending: boolean; message: string }
export interface ManagerSelection { agent: string; scope: string; kind: string }
export interface Manager { selection?: ManagerSelection; view: { id: string; target: string; enabled: boolean | null; rows: { id: number; name: string; enabled: boolean }[] } | null; preview: { id: string; summary: string; normalization: boolean } | null; undoAvailable: boolean; editing: number | null; busy: boolean; message: string }
export interface CustomForm { name: string; template: string; mode: string; input: string; reason: string; time: string; filters: string; mapping: Record<string, string> }
export interface CustomSummary { records: number; totalTokens: number; errors: string[]; [key: string]: unknown }
export interface Custom { editing: boolean; draft: { selected: boolean } | null; step: number; busy: boolean; preview: { summary: CustomSummary } | null; form: CustomForm | null; fields: { path: string; type: string; example: string | null }[]; message: string; sampleInfo: string; location: string }
export type QuotaConnection = ConnectionRow["quota"];
export interface SourceConnections { snapshot: { rows: { agent: string; quota: QuotaConnection }[] }; stale: boolean }
export interface SourcesHost {
 get(): SourcesState; demo: boolean; available: boolean; catalog(): AgentCatalog["agents"]; load(collect?: boolean): Promise<void>; change(name: string, agent: string | null, value?: string | boolean): Promise<void>;
 add(agent: string): Promise<void>; update(statuses?: SourceReadStatus[] | null): void; collection(value: SourcesState["collection"]): void; notice(value: string): void; retry(): Promise<void> | void; reveal(path: string): Promise<void>; copyText(text: string): Promise<boolean>;
 installers(): Installers; loadInstallers(): Promise<void>; installAction(agent: string, action: string): Promise<void>;
 setup(): Setup; openSetup(agent: string): Promise<void>; closeSetup(): void; setupAction(actionId: string): Promise<void>;
 connections(): SourceConnections; loadConnections(): Promise<void>; config(): Config; loadConfig(updated?: unknown): Promise<void>; configAction(name: string, agent: string, scope: string): Promise<void>; configCancel(): Promise<void> | void;
 manager(): Manager; openManager(value: ManagerSelection): Promise<void>; closeManager(): boolean; managerEdit(id: number): void; managerDiscard(): void; managerInvalidate(): void; managerAction(action: string, values?: Record<string, unknown>): Promise<void>;
 custom(): Custom; openCustom(id?: string): Promise<void>; closeCustom(): boolean; customField(key: string, value: string): void; customAction(action: string): Promise<void>; customChange(id: string, action: string, value?: boolean): Promise<void>; customExport(id: string): Promise<void>;
}
export interface SourcesUi { focus(agent: string): void; refresh(): void; reload(collect?: boolean): Promise<void>; render(statuses?: SourceReadStatus[]): void; collection(value: SourcesState["collection"]): void; notice(value: string): void; openAttention(kind?: string): void; openSetup(agent: string): void }
export interface Capability { formats: string; note: string; semantics: string; fields: { label: string; value: string }[]; summary: string }

export interface AttentionCardRow { key: string; kind: "act" | "accept" | "source"; title: string; effect: string; ids: string[]; models: string[] }
export interface SourcesModel {
 create(state: SourcesState, agents: AgentCatalog["agents"]): { demoDiscovery(): NonNullable<SourcesState["discovery"]>; selection(sources: Source[]): void; sourceLine(source?: Source, status?: SourceReadStatus): string };
 createInsights(state: unknown, globals: Window, collection: () => SourcesState["collection"]): unknown;
 STATUS: Readonly<Record<string, string>>; STATUS_TIPS: Readonly<Record<string, string>>; ISSUES: Readonly<Record<string, string>>; PATH_STATE: Readonly<Record<string, string>>; STATE: Readonly<Record<string, string>>;
 errors: Readonly<Record<string, string>>; managementErrors: Readonly<Record<string, string>>; failure(error: Error): string;
 editPatch(values: Record<string, string>): Record<string, unknown>; customConfig(form: CustomForm): Record<string, unknown>;
 count(value: number): string; when(value?: string | null): string | null; sourceSummary(state: SourcesState, connected: boolean): string; sourceNotice(state: SourcesState): string;
 attentionGroups(items: AttentionItem[] | null): { cards: Record<string, AttentionCardRow[]>; general: AttentionItem[]; act: number; accept: number };
 sourceRow(state: SourcesState, id: string, meta: AgentCatalog["agents"][string], demo: boolean): { source?: Source; status?: SourceReadStatus; stopped?: boolean; issues: string[]; label: string; tip?: string; quality: string; changed?: boolean };
 path(entry: SourceReadPath, stale: boolean): { meta: string; issues: string[]; action: { name: string; label: string } | null };
 installerView(row: SourceInstallerRow): { waiting: boolean; progress: number | null; percent: string | null; stage: string; attempt: string }; installerUpgrades(snapshot: Installers["snapshot"]): number; setupWhen(value: string): string; label(row: SourceInstallerRow): string; programStatus(row?: SourceInstallerRow, hasRecords?: boolean): string | null; STAGE: Record<string, string>; installActions(row: SourceInstallerRow, disabled: boolean): { action: string; label: string; disabled?: boolean }[];
 configProjection(state: Config["state"], agent: string, scope: string, kind: string, pending: boolean, message: string): { item?: ConfigItem; known: boolean; busy: boolean; selection: string; message: string; summary: string; files: { title: string; checks: Check[] }[]; empty: string };
 labels: Record<string, string>; previewRows(summary: CustomSummary): [string, number | null][];
}

declare global { interface Window { sourcesHost: SourcesHost; sourcesModel: SourcesModel; sourceConnectionsUi?: { reload(): Promise<void> }; agentSetupUi?: { open(agent: string): void } } }
// A revision number is stable for useSyncExternalStore; mutable host objects are read only after it changes.
let revision = 0;
function subscribe(listener: () => void) { const changed = () => { revision++; listener(); }; const names = ["sources-host-change", "installer-change", "connections-change", "insights-change", "source-catalog"]; names.forEach(name => window.addEventListener(name, changed)); return () => names.forEach(name => window.removeEventListener(name, changed)); }
export function useSourcesHost() { useSyncExternalStore(subscribe, () => revision); return window.sourcesHost; }
export function sourcesModel() { return window.sourcesModel; }
