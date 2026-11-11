import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { appShell, ownNavigation, patchShell, views } from "./app-store";
import type { ViewName } from "./data/types";
import { attachSidebarResize } from "./sidebar-resize";

// Current shared presentation policy. Source, account and credential capabilities
// remain with their data hosts.
type Presentation = {
  uiDetail: { cancelScroll(): void; scrollTo(top: number): void };
  uiMotion: { indicators(): void; setPreference(value: string): void };
  uiKeyboard: { guard(event: KeyboardEvent): boolean; isComposing(): boolean; editable(target: EventTarget | null): boolean };
  usageData?: { collection(): { enabled: boolean; collecting: boolean; error: string | null; checkedAt: string | null } };
};
export const presentation = window as unknown as Presentation;
function saved(key: string, fallback: boolean, yes: string) {
  try { const value = localStorage.getItem(key); return value === null ? fallback : value === yes; } catch { return fallback; }
}
function remember(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Session only. */ } }
function useMedia(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => { const media = matchMedia(query), changed = () => setMatches(media.matches); media.addEventListener("change", changed); changed(); return () => media.removeEventListener("change", changed); }, [query]);
  return matches;
}
export function useShellBehavior(view: ViewName, ready: boolean, dark: boolean) {
  const integrated = Boolean(window.windowBridge), narrow = useMedia("(max-width: 800px)"), wide = useMedia("(min-width: 1360px)");
  const [savedCollapsed, setCollapsed] = useState(() => saved("agentusage.sidebar.v1", false, "collapsed"));
  // While a conversation is open the menu folds to its rail; Ctrl+B opens it for this reading only.
  const [reading, setReading] = useState(false), [peek, setPeek] = useState(false), collapsed = reading ? !peek : savedCollapsed;
  const [docked, setDocked] = useState(() => !saved("agentusage.summary.v1", false, "closed"));
  const [floating, setFloating] = useState(false), [inactive, setInactive] = useState(false), [attention, setAttention] = useState({ count: 0, label: "" });
  const history = useRef<ViewName[]>([view]), index = useRef(0), positions = useRef(new Map<ViewName, number>());
  const [historyIndex, setHistoryIndex] = useState(0), [historyLength, setHistoryLength] = useState(1);
  const pendingTop = useRef(0), previous = useRef<ViewName | null>(null), restoreFrame = useRef(0);
  const summaryOffered = view !== "settings", dock = integrated && summaryOffered && wide && docked, float = integrated && summaryOffered && !wide && floating;
  const navigate = (next: ViewName, traveling = false) => {
    if (appShell.get().view === next) return;
    window.dispatchEvent(new Event("ui-view-leave"));
    presentation.uiDetail?.cancelScroll();
    positions.current.set(appShell.get().view, scrollY);
    if (!appShell.get().ready) { history.current = [next]; index.current = 0; pendingTop.current = 0; }
    else if (!traveling) { history.current.splice(index.current + 1); history.current.push(next); index.current++; pendingTop.current = 0; }
    setHistoryIndex(index.current); setHistoryLength(history.current.length);
    setFloating(false); patchShell({ view: next });
  };
  const travel = (delta: number) => {
    const next = index.current + delta;
    if (next < 0 || next >= history.current.length) return;
    index.current = next; pendingTop.current = positions.current.get(history.current[next]) ?? 0;
    navigate(history.current[next], true);
  };
  const toggleSidebar = () => reading ? setPeek(value => !value) : setCollapsed(value => { remember("agentusage.sidebar.v1", value ? "expanded" : "collapsed"); return !value; });
  const toggleSummary = () => {
    if (!summaryOffered) return;
    if (wide) setDocked(value => { remember("agentusage.summary.v1", value ? "closed" : "open"); return !value; });
    else setFloating(value => !value);
  };
  useLayoutEffect(() => ownNavigation(navigate));
  useLayoutEffect(() => {
    if (!ready || previous.current === view) return;
    previous.current = view;
    window.dispatchEvent(new CustomEvent("ui-view-change", { detail: view }));
    cancelAnimationFrame(restoreFrame.current);
    const top = pendingTop.current;
    if (view === "usage") restoreFrame.current = requestAnimationFrame(() => { if (appShell.get().view === view) presentation.uiDetail?.scrollTo(top); });
    else presentation.uiDetail?.scrollTo(top);
    presentation.uiMotion?.indicators();
    return () => cancelAnimationFrame(restoreFrame.current);
  }, [ready, view]);
  useLayoutEffect(() => {
    document.body.classList.toggle("integrated-titlebar", integrated);
    document.body.classList.toggle("sidebar-collapsed", integrated && collapsed);
    document.body.classList.toggle("summary-docked", dock); document.body.classList.toggle("summary-floating", float);
    document.body.classList.toggle("window-inactive", inactive);
    document.body.classList.toggle("dark", dark);
    presentation.uiDetail?.cancelScroll();
    const frame = requestAnimationFrame(() => presentation.uiMotion?.indicators());
    return () => cancelAnimationFrame(frame);
  }, [integrated, collapsed, dock, float, inactive, dark]);
  useEffect(() => { setFloating(false); }, [wide]);
  useEffect(() => {
    if (float) document.querySelector<HTMLElement>('#summaryPanel button, #summaryPanel [href], #summaryPanel [tabindex]:not([tabindex="-1"])')?.focus();
  }, [float]);
  useEffect(() => attachSidebarResize(), []);
  useEffect(() => {
    window.uiShell = Object.freeze({
      summaryAttention(count: number, label: string) { setAttention(previous => previous.count === count && previous.label === label ? previous : { count, label }); },
      reading(open: boolean) { setReading(open); setPeek(false); },
    });
    return () => { delete window.uiShell; };
  }, []);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (presentation.uiKeyboard.guard(event)) return;
      if (event.altKey && !event.ctrlKey && !event.metaKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); travel(event.key === "ArrowLeft" ? -1 : 1); }
      if (event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && !presentation.uiKeyboard.editable(event.target)) {
        const n = Number(event.key); if (n >= 1 && n <= views.length) { event.preventDefault(); navigate(views[n - 1]); }
      }
      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "b") { event.preventDefault(); toggleSummary(); }
      if (event.key === "Escape" && float && !document.querySelector('dialog[open], [data-ui-portal] [role="dialog"]')) { setFloating(false); document.getElementById("windowSummary")?.focus(); }
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (float && !target.closest('#summaryPanel, #windowSummary, [data-ui-portal]')) setFloating(false);
    };
    window.addEventListener("keydown", keyboard); document.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("keydown", keyboard); document.removeEventListener("pointerdown", outside); };
  });
  useEffect(() => {
    const bridge = window.windowBridge; if (!bridge || !ready) return;
    const command = (action: string) => {
      if (presentation.uiKeyboard.isComposing()) return;
      if (action === "back") travel(-1); if (action === "forward") travel(1); if (action === "sidebar") toggleSidebar(); if (action === "summary") toggleSummary();
      if (action === "theme") window.settingsHost?.theme.set(document.body.classList.contains("dark") ? "light" : "dark");
      if (action === "settings") navigate("settings");
      if (action === "show-quota" || action === "show-connect") navigate("quota");
      if (action === "show-connect") window.dispatchEvent(new Event("first-run-guide"));
      if (action.startsWith("motion-")) presentation.uiMotion.setPreference(action.slice(7));
      if (action.startsWith("theme-")) window.settingsHost?.theme.set(action.slice(6) as "system" | "light" | "dark");
      if (action === "export") { navigate("usage"); window.settingsUi?.openExport(); }
      if (action === "refresh") {
        const current = appShell.get().view;
        if (current === "quota") { void window.quotaUi?.refreshAll(); return; }
        if (current === "sources") { void window.sourcesHost?.load(true); return; }
        if (current === "settings") navigate("usage");
        void window.usageHost?.refresh();
      }
    };
    const stopCommand = bridge.onCommand(command), stopState = bridge.onState(state => setInactive(!state.focused));
    let alive = true; void bridge.state().then(state => { if (alive) setInactive(!state.focused); }).catch(() => {});
    return () => { alive = false; stopCommand(); stopState(); };
  }, [ready, view, collapsed, reading, wide]);
  useEffect(() => { if (integrated) void window.windowBridge?.theme(dark ? "dark" : "light").catch(() => {}); }, [integrated, dark]);
  return { integrated, collapsed, narrow, summaryOffered, dock, float, inactive, attention, historyIndex, historyLength, navigate, travel, toggleSidebar, toggleSummary };
}
declare global { interface Window { uiShell?: { summaryAttention(count: number, label: string): void; reading(open: boolean): void } } }

/** The collection state the title bar's status reads; refreshes its age every 30s. */
export function useCollection(ready: boolean) {
  const [revision, update] = useState(0);
  useEffect(() => {
    if (!ready) return;
    const changed = () => update(value => value + 1), timer = setInterval(changed, 30000);
    window.addEventListener("usage-collection", changed); changed();
    return () => { window.removeEventListener("usage-collection", changed); clearInterval(timer); };
  }, [ready]);
  void revision;
  return ready && window.usageBridge ? presentation.usageData?.collection() : null;
}
export function ago(value: string) {
  const minutes = Math.floor((Date.now() - Date.parse(value)) / 60000);
  return !Number.isFinite(minutes) ? "" : minutes < 1 ? "刚刚" : minutes < 60 ? minutes + " 分钟前" : minutes < 1440 ? Math.floor(minutes / 60) + " 小时前" : new Date(value).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}
