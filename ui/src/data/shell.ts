import { useSyncExternalStore } from "react";
import type { ViewName } from "./types";

const listeners = new Set<() => void>();
let stop: (() => void) | undefined;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!stop) {
    const changed = () => { for (const callback of listeners) callback(); };
    window.addEventListener("ui-view-change", changed);
    const observer = new MutationObserver(changed);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    stop = () => { window.removeEventListener("ui-view-change", changed); observer.disconnect(); };
  }
  return () => { listeners.delete(listener); if (!listeners.size) { stop?.(); stop = undefined; } };
}
export function useViewActive(view: ViewName): boolean {
  return useSyncExternalStore(subscribe, () => document.getElementById("main")?.dataset.currentView === view);
}
/** Whether the shell docks the page's summary column (window-shell.js, UI-LAYOUT-SPEC-20261027.md). */
export function useSummaryDocked(): boolean {
  return useSyncExternalStore(subscribe, () => document.body.classList.contains("summary-docked"));
}
export function useDarkTheme(): boolean {
  return useSyncExternalStore(subscribe, () => document.body.classList.contains("dark"));
}
/** The view the legacy shell shows now, read once (not a subscription). */
export function currentView(): ViewName | null { return (document.getElementById("main")?.dataset.currentView as ViewName | undefined) ?? null; }
