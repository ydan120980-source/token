import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { SourceStatus, UsageRow } from "./types";
import { useQuotaHost } from "./quota-host";

// What the widgets read: saved facts the legacy renderer already holds (preview.js usageData,
// sessions-ui.js sessionsUi, quota-host.js quotaHost). Reading never collects, queries a provider or
// writes; each hook re-renders on the renderer's own change event.
interface UsageReader {
  rows(): UsageRow[]; hourly(): UsageRow[]; today(): string | null; sources(): SourceStatus[] | null;
  collection(): { error: string | null; collecting: boolean; checkedAt: string | null; enabled: boolean };
}
export interface SessionDay extends Pick<UsageRow, "date" | "totalTokens" | "inputUncached" | "output" | "cacheRead" | "cacheWrite" | "estimatedCostUsd" | "estimatedCostUpperUsd" | "pricedTokens"> { }
export interface SessionEntry { key: string; agent: string; models: string[]; start: string; end: string; project: string; cwd: string; days: SessionDay[] }
const usage = () => (window as unknown as { usageData?: UsageReader }).usageData;

let usageVersion = 0, sessionVersion = 0;
function on(names: string[], bump: () => void) {
  const listeners = new Set<() => void>();
  const changed = () => { bump(); for (const listener of listeners) listener(); };
  return (listener: () => void) => {
    if (!listeners.size) for (const name of names) window.addEventListener(name, changed);
    listeners.add(listener);
    return () => { listeners.delete(listener); if (!listeners.size) for (const name of names) window.removeEventListener(name, changed); };
  };
}
const subscribeUsage = on(["usage-data-change", "usage-collection"], () => { usageVersion++; });
const subscribeSessions = on(["sessions-change"], () => { sessionVersion++; });

/** Daily and hourly rows, today and the collection state; null until the renderer has data. */
export function useUsage() {
  const version = useSyncExternalStore(subscribeUsage, () => usageVersion);
  return useMemo(() => {
    const reader = usage();
    if (!reader) return null;
    return { rows: reader.rows(), hourly: reader.hourly(), today: reader.today(), sources: reader.sources(), collection: reader.collection(), version };
  }, [version]);
}

/** The saved session list; the first reader asks the sessions page to load it once. */
export function useSessions() {
  const version = useSyncExternalStore(subscribeSessions, () => sessionVersion);
  useEffect(() => { window.sessionsHost?.wantRecent(); }, [version]);
  return useMemo(() => window.sessionsHost?.recent() ?? null, [version]);
}

// Ages and countdowns move without a new read; widgets re-derive the quota grid this often on every page.
const AGE_MS = 30000;
/** The quota host and its grid, independent of the quota page's own timer. */
export function useWidgetQuota() {
  const host = useQuotaHost(), [tick, setTick] = useState(0), version = host.gridVersion();
  useEffect(() => { const timer = setInterval(() => setTick(value => value + 1), AGE_MS); return () => clearInterval(timer); }, []);
  const grid = useMemo(() => host.model.gridView(), [host, version, tick]);
  return { host, grid };
}
