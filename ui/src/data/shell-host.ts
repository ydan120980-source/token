import { useEffect, useState } from "react";

// The app beside its window (src/quota/desktop-shell.js): tray, starting at login, quota notices. A browser preview has none of it.
export interface DesktopShellState {
  tray: boolean; closeToTray: boolean; guided: boolean; notices: boolean;
  login: { available: boolean; open: boolean };
  watch: { enabled: boolean; low: number; reset: boolean };
  lows: number[];
}
export interface DesktopShellPatch { closeToTray?: boolean; guided?: boolean; login?: boolean; watch?: Partial<DesktopShellState["watch"]> }
/** One line of a connection's recent reads, newest first; several reads with the same end share a line. */
export interface ReadLine { at: string; ok: boolean; code?: string; message?: string | null; automatic: boolean; quiet?: boolean; count?: number }
export interface ShellBridge { get(): Promise<DesktopShellState>; set(patch: DesktopShellPatch): Promise<DesktopShellState>; readHistory(id: string): Promise<ReadLine[]> }
declare global { interface Window { shellBridge?: ShellBridge } }

let current: DesktopShellState | null = null;
const listeners = new Set<() => void>();
const publish = (value: DesktopShellState) => { current = value; for (const listener of listeners) listener(); };
export function useDesktopShell() {
  const [, redraw] = useState(0);
  useEffect(() => {
    const listener = () => redraw(count => count + 1);
    listeners.add(listener);
    if (!current) void window.shellBridge?.get().then(publish).catch(() => {});
    return () => { listeners.delete(listener); };
  }, []);
  const set = (patch: DesktopShellPatch) => { void window.shellBridge?.set(patch).then(publish).catch(() => {}); };
  return { state: current, set };
}
