import { useSyncExternalStore } from "react";
import type { Profile } from "./data/settings-host";
import type { ViewName } from "./data/types";

export const views = ["quota", "usage", "cost", "sessions", "sources", "settings"] as const;
export const viewNames = { quota: "概览", usage: "用量", cost: "费用", sessions: "会话", sources: "Agent 管理", settings: "设置" };
export interface Notice { text: string; hidden: boolean; title?: string; attention?: boolean; role?: "status" | "alert" }
interface ShellSnapshot {
  ready: boolean; view: ViewName; dark: boolean; toast: string;
  visit: { readonly restoreTop: number };
  profile: Profile; historyStart: string; updated: string; collectionState: string;
  notice: Notice; badges: Record<string, { count: number; title: string }>;
}
let snapshot: ShellSnapshot = {
  ready: false, view: "usage", dark: false, toast: "",
  visit: { restoreTop: 0 },
  profile: { name: "本机用户", bio: "记录每一次 AI 协作", tone: "indigo", photo: null },
  historyStart: "", updated: "最近采集 14:32", collectionState: "采集开启 · 示例状态",
  notice: { text: "界面预览", hidden: true }, badges: {},
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const read = () => snapshot;
export function patchShell(patch: Partial<ShellSnapshot>) {
  if (Object.entries(patch).every(([key, value]) => snapshot[key as keyof ShellSnapshot] === value)) return;
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}
export function useShell() { return useSyncExternalStore(subscribe, read); }
export function showShellView(view: ViewName, restoreTop = 0) {
  if (snapshot.view !== view) patchShell({ view, visit: { restoreTop } });
}
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let route: (name: ViewName) => void = showShellView;
export function ownNavigation(navigate: typeof route) { route = navigate; return () => { route = showShellView; }; }
export const appShell = Object.freeze({
  get: read, subscribe,
  start() { patchShell({ ready: true }); },
  navigate(name: string) {
    if (name === "workbench") name = "cost";
    if (views.includes(name as typeof views[number])) route(name as ViewName);
  },
  theme(dark: boolean) { patchShell({ dark }); document.body.classList.toggle("dark", dark); },
  profile(profile: Profile) { patchShell({ profile }); },
  facts(historyStart: string, updated: string) { patchShell({ historyStart, updated }); },
  collectionState(collectionState: string) { patchShell({ collectionState }); },
  notice(notice: Notice) { if (JSON.stringify(snapshot.notice) !== JSON.stringify(notice)) patchShell({ notice }); },
  badge(name: string, count: number, title: string) {
    const previous = snapshot.badges[name];
    if (previous?.count !== count || previous.title !== title) patchShell({ badges: { ...snapshot.badges, [name]: { count, title } } });
  },
  toast(message: string) {
    clearTimeout(toastTimer); patchShell({ toast: message });
    toastTimer = setTimeout(() => patchShell({ toast: "" }), 4500);
  },
});
declare global { interface Window { appShell: typeof appShell } }
window.appShell = appShell;
