import { useSyncExternalStore } from "react";
import { currentView, getGlobals, type Billing, type PriceCoverage, type PriceEntry, type PricePlan, type PriceTry, type PriceRow, type PriceSuggestion, type Pricing, type PricingGap, type UsedModel } from "@ui/data";

// The pricing panel's state, shared by the settings section, the price sheet and the cost page
// (window.uiPricingEditor). Timing follows the retired pricing-controller.js: the large catalog is
// read only when settings or cost is shown or a sheet is asked for, reads are serialized with one
// queued follow-up, and a save reports its own result apart from a failed reload.
export type Gap = PricingGap & { suggestions?: PriceSuggestion };
export interface EditorState { open: boolean; key: string | null; serial: number; probe: boolean }
export interface PricingState {
  available: boolean; data: Pricing | null; rows: PriceRow[]; billing: Billing; models: UsedModel[]; gaps: Gap[]; names: Record<string, string>;
  result: string; syncing: boolean; savingBilling: boolean; editor: EditorState;
  /** The one-click sheet; the rules before it was applied, for 撤销; what the fallback and the floor contribute now. */
  fixOpen: boolean; undo: Billing | null; active: PriceCoverage | null;
}
type PricingEditor = { open(key: string): Promise<void>; explain(key: string): Promise<void>; model(key: string): { basis: string; priced: boolean; rates: unknown; mapped: boolean; target: string | null } | null };
declare global { interface Window { uiPricingEditor?: PricingEditor } }

const names = () => Object.fromEntries(Object.entries(getGlobals().agentCatalog.agents).map(([id, agent]) => [id, agent.name]));
let state: PricingState = { available: false, data: null, rows: [], billing: { autoSync: true, defaults: {}, mappings: {} }, models: [], gaps: [], names: {}, result: "", syncing: false, savingBilling: false, editor: { open: false, key: null, serial: 0, probe: false }, fixOpen: false, undo: null, active: null };
const listeners = new Set<() => void>();
function set(patch: Partial<PricingState>) { state = { ...state, ...patch }; for (const listener of listeners) listener(); }
function bridge() { return window.usageBridge!; }

let loading = false, reloadQueued = false, loadPromise: Promise<void> | null = null, editorRequest = 0, savedNotice = "";
function saved(text: string) { savedNotice = text; set({ result: text }); }
function rebuild(from: Partial<PricingState> = {}) {
  const next = { ...state, ...from };
  if (!next.data) { set(from); return; }
  const { uiPricing, pricingEditorModel } = getGlobals();
  const models = pricingEditorModel.withManualRows(uiPricing.usedModels(next.data.observed, next.rows, window.usageModels ?? {}, next.billing, next.names), next.rows);
  const gaps = uiPricing.unpricedUsage(models).map(item => ({ ...item, suggestions: next.data!.suggestions?.[item.key] }));
  set({ ...from, models, gaps });
}
export function load(): Promise<void> {
  if (!state.available) return Promise.resolve();
  if (loading) { reloadQueued = true; return loadPromise!; }
  loadPromise = read(); return loadPromise;
}
async function read() {
  loading = true;
  try {
    const data = await bridge().pricing();
    rebuild({ data, rows: data.models || [], billing: data.billing || state.billing });
    // Only a person who turned the fallback or the floor on pays for working out what they contribute.
    const billing = data.billing || state.billing;
    set({ active: billing.fallback || billing.partialLowerBound ? (await bridge().pricePlan({ auto: false, fallback: billing.fallback ?? null, partial: Boolean(billing.partialLowerBound) })).after : null });
    window.dispatchEvent(new Event("pricing-change"));
  } catch {
    set({ result: savedNotice ? savedNotice + " 价格显示暂未刷新，请重新进入设置重试。" : "价格读取失败，已保存的规则保留；请重新进入设置重试。" });
  } finally { loading = false; if (reloadQueued) { reloadQueued = false; void load(); } }
}

/** Opens the sheet for a used model (key) or a custom identifier (null) once prices are read. */
export async function openEditor(key: string | null, withProbe = false) {
  const request = ++editorRequest;
  if (loading) await loadPromise; else if (!state.data) await load();
  if (request !== editorRequest) return;
  if (!state.data) { window.usageData?.toast("价格暂不可用，请稍后重试。"); return; }
  if (key === null || state.models.some(model => model.key === key)) set({ editor: { open: true, key, serial: state.editor.serial + 1, probe: withProbe } });
}
export function closeEditor() { ++editorRequest; set({ editor: { ...state.editor, open: false } }); }
export function setResult(text: string) { set({ result: text }); }

/** Saves mappings or Agent rules; the caller shows a failure where it was asked. */
export async function saveConfig(next: Billing, text: string, target: "panel" | "editor"): Promise<{ ok: boolean; message: string | null }> {
  if (state.savingBilling) return { ok: false, message: null };
  set({ savingBilling: true }); savedNotice = "";
  try { await bridge().saveBilling(next); saved(text); await load(); return { ok: true, message: text }; }
  catch {
    const message = "配置未保存，输入已保留。请核对完整计费模型与 0–1000 的倍率，或重试保存。";
    if (target === "panel") set({ result: message });
    return { ok: false, message };
  } finally { set({ savingBilling: false }); }
}
export async function setAutoSync(value: boolean) { try { await bridge().autoPrices(value); await load(); } catch { set({ result: "自动同步设置未保存。" }); } }
export async function syncNow() {
  set({ syncing: true });
  try { await bridge().syncPrices(); set({ result: "最新模型价格已同步，手动规则和映射保留。" }); }
  catch { set({ result: "价格同步未完成，现有价格与手动规则保留。" }); }
  finally { await load(); set({ syncing: false }); }
}
export async function savePrice(entry: PriceEntry): Promise<string | null> {
  savedNotice = "";
  try { await bridge().savePrice(entry); saved("手动规则已保存，全部历史按新规则重算。"); closeEditor(); await load(); return null; }
  catch { return "保存失败，输入已保留。请检查模型标识与非负价格，或重试保存；原规则保留。"; }
}
export async function resetPrice(entry: PriceEntry): Promise<string | null> {
  savedNotice = "";
  try { await bridge().resetPrice(entry); saved("手动规则已撤销，恢复目录规则；没有目录规则时恢复未定价。"); closeEditor(); await load(); return null; }
  catch (error) { set({ result: "撤销未完成，原规则保留。" }); return getGlobals().pricingEditorModel.resetErrorText(error); }
}
export function probePrice(entry: PriceEntry) { return bridge().probePrice(entry); }
export function tryPrice(key: string, targets: string[]): Promise<PriceTry> { return bridge().tryPrice({ key, targets }); }
export function pricePlan(request: { auto?: boolean; fallback?: string | null; partial?: boolean }): Promise<PricePlan> { return bridge().pricePlan(request); }
export function openFix() { closeEditor(); set({ fixOpen: true }); }
export function closeFix() { set({ fixOpen: false }); }
/** Applies a one-click choice; the rules it replaced stay here for 撤销 until the next one. */
export async function applyFix(next: Billing, text: string) {
  const previous = state.billing, outcome = await saveConfig(next, text, "panel");
  if (outcome.ok) set({ undo: previous });
  return outcome;
}
export async function undoFix() {
  if (!state.undo) return;
  const outcome = await saveConfig(state.undo, "已撤销，恢复到一键处理之前。", "panel");
  if (outcome.ok) set({ undo: null });
}

let started = false;
/** Wires the store once, when the settings island mounts at page load. */
export function startPricing() {
  if (started) return; started = true;
  const { uiPricing, uiPricingView, pricingEditorModel } = getGlobals();
  if (!window.usageBridge || !uiPricing || !uiPricingView || !pricingEditorModel) return;
  set({ available: true, names: names() });
  // For the cost page: open the sheet for a used model, and how that model is priced now.
  window.uiPricingEditor = Object.freeze({
    open: (key: string) => openEditor(key, true),
    explain: (key: string) => openEditor(key),
    model(key: string) {
      const item = state.models.find(model => model.key === key); if (!item) return null;
      return { basis: uiPricing.origin(item.row).label, priced: uiPricing.priced(item.row), rates: item.row?.rates || null, mapped: item.mapped, target: item.target };
    }
  });
  const shown = () => currentView() === "settings" || currentView() === "cost";
  window.addEventListener("ui-view-change", event => { ++editorRequest; const view = (event as CustomEvent<string>).detail; if (view === "settings" || view === "cost") void load(); });
  window.addEventListener("usage-models", () => rebuild());
  window.addEventListener("source-catalog", () => { rebuild({ names: names() }); if (shown()) void load(); });
  const stop = bridge().onUpdate(() => { if (currentView() === "settings") void load(); });
  window.addEventListener("unload", stop);
  if (shown()) void load();
}

function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function usePricing(): PricingState { return useSyncExternalStore(subscribe, () => state); }
