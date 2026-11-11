import { useSyncExternalStore } from "react";

// What the legacy shell (design/desktop-reference/preview.js) offers the settings page until M9:
// theme, collection, profile, demo data state and statistics export. Every change fires
// settings-host-change on window; reads never touch the shell's DOM.
export type ThemePreference = "system" | "light" | "dark";
export type DemoState = "normal" | "partial" | "empty" | "error";
export interface Profile { name: string; bio: string; tone: "indigo" | "teal" | "coral"; photo: string | null }
export interface Collection { mode: "desktop" | "snapshot" | "demo"; enabled: boolean; intervalMs: number }
export interface ExportResult { kind: "saved" | "canceled" | "failed" | "preview"; message: string; json?: string }
export interface SettingsHost {
  theme: { get(): ThemePreference; set(value: ThemePreference): void };
  collection: { get(): Collection; setEnabled(value: boolean): Promise<void>; setInterval(value: number): Promise<void> };
  profile: { get(): Profile; save(value: Profile): { ok: true } | { ok: false; error: "storage" } };
  demo: { available: boolean; get(): DemoState; set(value: DemoState): void };
  exportHelp: string;
  exportStatistics(request: { range: "all" | "current"; sources: boolean }): Promise<ExportResult>;
  toast(message: string): void;
}
// The page's own entry points for the shell and other pages (sidebar profile, usage export,
// "go to pricing"); registered by the settings island.
export interface SettingsUi { openProfile(): void; openExport(): void; openSection(name: SettingsSection): void }
export type SettingsSection = "general" | "account" | "quota" | "collection" | "pricing" | "privacy" | "about";
declare global {
  interface Window { settingsHost?: SettingsHost; settingsUi?: SettingsUi }
}

export function getSettingsHost(): SettingsHost {
  if (!window.settingsHost) throw Error("UI_SETTINGS_HOST_UNAVAILABLE");
  return window.settingsHost;
}
function subscribe(listener: () => void) {
  window.addEventListener("settings-host-change", listener);
  return () => window.removeEventListener("settings-host-change", listener);
}
// Snapshots must be stable between changes, so object reads are cached by their JSON.
const cache = new Map<string, { json: string; value: unknown }>();
function stable<T>(key: string, value: T): T {
  const json = JSON.stringify(value), hit = cache.get(key);
  if (hit && hit.json === json) return hit.value as T;
  cache.set(key, { json, value });
  return value;
}
export function useTheme(): ThemePreference { return useSyncExternalStore(subscribe, () => getSettingsHost().theme.get()); }
export function useCollection(): Collection { return useSyncExternalStore(subscribe, () => stable("collection", getSettingsHost().collection.get())); }
export function useProfile(): Profile { return useSyncExternalStore(subscribe, () => stable("profile", getSettingsHost().profile.get())); }
export function useDemoState(): DemoState { return useSyncExternalStore(subscribe, () => getSettingsHost().demo.get()); }

// The legacy motion preference (motion.js), changed from the settings page.
export type MotionPreference = "system" | "reduced" | "off";
type UiMotion = { preference: MotionPreference; mode: "full" | "reduced" | "off"; setPreference(value: MotionPreference): void };
declare global { interface Window { uiMotion?: UiMotion } }
function subscribeMotion(listener: () => void) {
  window.addEventListener("ui-motion-change", listener);
  return () => window.removeEventListener("ui-motion-change", listener);
}
export function useMotionPreference(): MotionPreference { return useSyncExternalStore(subscribeMotion, () => window.uiMotion?.preference ?? "system"); }
export function setMotionPreference(value: MotionPreference) { window.uiMotion?.setPreference(value); }
/** Whether page-level movement (smooth scrolling) is allowed right now. */
export function motionAllowed(): boolean { return (window.uiMotion?.mode ?? document.body.dataset.motion) === "full"; }

// Legacy navigation and the sources page's entry point.
type UsageData = { view(name: string): void; toast(message: string): void };
type SourcesUi = { focus(agent: string): void; openAttention?(kind?: string): void; openSetup?(agent: string): void };
declare global { interface Window { usageData?: UsageData; sourcesUi?: SourcesUi } }
export function showView(name: "settings" | "sources" | "usage" | "cost" | "sessions" | "quota") { window.usageData?.view(name); }
export function focusSource(agent: string) { if (agent === "all" || !window.sourcesUi) showView("sources"); else window.sourcesUi.focus(agent); }
