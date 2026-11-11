import { useSyncExternalStore } from "react";
import type { Workbench, Attention, WorkbenchSelection, WorkbenchIssue, WorkbenchTotal, BudgetOverview } from "./types";

export interface InsightsSnapshot {
  view: Workbench | null; general: Workbench | Attention | null; period: NonNullable<WorkbenchSelection["period"]>;
  project: string; busy: boolean; dirty: boolean; draft: string; message: string; error: string;
  open: Set<string>; budgetOpen: Set<string>; focusBudget: string | null; kind?: string;
}
/** One "需要处理" item as data (insights-ui.js item()). */
export interface AttentionItem {
  id: string; kind: string; kindLabel: string; scope: string; acknowledged: boolean; what: string; effect: string; title?: string;
  agent: string | null; fix: "price" | "accept" | "source"; tokens: number | null; records: number | null; modelKey: string | null;
  actions: { action: string; label: string; value?: string; disabled?: boolean }[];
}
type BudgetRow = BudgetOverview["budgets"][number];
export interface InsightsHost {
  version(): number; available: boolean; get(): InsightsSnapshot;
  attention(kind?: string): WorkbenchIssue[]; capability(agent: string): unknown;
  notices(page: string): { count: number; text: string };
  items(): AttentionItem[] | null; capabilityView(agent: string): { formats: string; note: string; semantics: string; fields: { label: string; value: string }[]; summary: string } | null; act(action: string, value?: string): void; omitted(): { general: number; budget: number };
  acknowledge(id: string): Promise<void>; restore(id: string): Promise<void>; openAttention(kind: string): void;
  openBudget(key: string): Promise<void>; select(patch: WorkbenchSelection): Promise<void>; draft(text: string): void;
  toggle(kind: "budget" | "project", key: string, open: boolean): void;
  budget: { save(raw: string): Promise<void>; remove(): Promise<void> };
  projects: { load(clearMessage?: boolean): Promise<void>; export(): Promise<void> };
  format: { count(value: number): string; money(value: number | null): string; budgetMoney(value: number): string;
    cost(row: Pick<WorkbenchTotal, "lower" | "upper">): string; agent(id: string): string;
    budgetKey(row: BudgetRow): string; budgetName(row: BudgetRow): string; budgetStates: Record<string, string>;
    budgetLabels: Record<string, string>; periods: Record<string, string>;
  };
}
declare global { interface Window { insightsHost: InsightsHost } }
const subscribe = (listener: () => void) => {
  window.addEventListener("insights-change", listener);
  return () => window.removeEventListener("insights-change", listener);
};
export function useInsightsHost() {
  useSyncExternalStore(subscribe, () => window.insightsHost.version());
  return window.insightsHost;
}
