import { useSyncExternalStore } from "react";

// The widget sidebar's saved layouts (design/desktop-reference/widget-layout-model.js). The model is
// pure; this store keeps the one parsed state for the window, writes it to local storage and tells
// every reader (the sidebar, the title bar readout, settings) through widget-layout-change.
export type WidgetType = "quota.windows" | "quota.next" | "quota.upcoming" | "quota.status" | "cost.month" | "cost.daily" | "cost.where" |
  "usage.today" | "usage.heatmap" | "usage.week" | "usage.live" | "sessions.recent" | "sessions.window" | "agents.graph";
export type WidgetSize = "s" | "m" | "l";
export type WidgetColor = "agent" | "mono" | "ink";
export type WidgetBackground = "plain" | "soft" | "tint" | "inv";
export interface WidgetConfig { key: string; type: WidgetType; size: WidgetSize; color: WidgetColor; background: WidgetBackground; agent: string; period: string | null; readout: boolean }
export interface WidgetLayout { id: string; name: string; widgets: WidgetConfig[] }
export interface WidgetState { active: string; layouts: WidgetLayout[] }
export interface WidgetTypeInfo { category: "quota" | "cost" | "usage" | "sessions" | "agents"; name: string; periods: string[]; readout?: boolean }
export interface WidgetLayoutModel {
  KEY: string; SIZES: WidgetSize[]; COLORS: WidgetColor[]; BACKGROUNDS: WidgetBackground[]; CATEGORIES: [WidgetTypeInfo["category"], string][];
  TYPES: Record<WidgetType, WidgetTypeInfo>; MAX_LAYOUTS: number; MAX_WIDGETS: number; NAME_MAX: number;
  defaults(): WidgetState; parse(raw: string | null): WidgetState; serialize(state: WidgetState): string; activeLayout(state: WidgetState): WidgetLayout;
  add(state: WidgetState, type: WidgetType): WidgetState; remove(state: WidgetState, key: string): WidgetState; reorder(state: WidgetState, keys: string[]): WidgetState;
  move(state: WidgetState, key: string, step: number): WidgetState; update(state: WidgetState, key: string, patch: Partial<Omit<WidgetConfig, "key" | "type">>): WidgetState;
  readout(state: WidgetState): WidgetConfig | null; addLayout(state: WidgetState, name: string): WidgetState; renameLayout(state: WidgetState, id: string, name: string): WidgetState;
  removeLayout(state: WidgetState, id: string): WidgetState; activate(state: WidgetState, id: string): WidgetState; reset(state: WidgetState): WidgetState;
}
declare global { interface Window { widgetLayoutModel: WidgetLayoutModel } }

export const widgetModel = () => window.widgetLayoutModel;
const EVENT = "widget-layout-change";
let state: WidgetState | null = null;
function read(): WidgetState {
  if (state) return state;
  let raw: string | null = null;
  try { raw = localStorage.getItem(widgetModel().KEY); } catch { /* Storage unavailable: the default for this session. */ }
  state = widgetModel().parse(raw);
  return state;
}
function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
/** Applies one model operation, saves the result and tells every reader. A failed save keeps the change for this session. */
export function changeWidgets(change: (model: WidgetLayoutModel, current: WidgetState) => WidgetState) {
  const next = change(widgetModel(), read());
  if (next === state) return;
  state = next;
  try { localStorage.setItem(widgetModel().KEY, widgetModel().serialize(next)); } catch { /* Kept for this session. */ }
  window.dispatchEvent(new Event(EVENT));
}
export function useWidgetState(): WidgetState { return useSyncExternalStore(subscribe, read); }
