import type { ReactNode } from "react";
import { WidgetCard } from "@ui/kit";
import { getGlobals } from "@ui/data";
import type { WidgetConfig } from "@ui/data/widgets";

export interface WidgetProps { config: WidgetConfig }

/** A widget's card: its title row and body, with the person's chosen background and the accent its tint takes. */
export function frame(config: WidgetConfig, head: { title: string; sub?: ReactNode; meta?: ReactNode; accent?: string | null }, body: ReactNode) {
  return <WidgetCard type={config.type} title={head.title} sub={head.sub} meta={head.meta} surface={config.background} accent={head.accent ?? (config.agent === "all" ? null : config.agent)}>{body}</WidgetCard>;
}

export const agentName = (id: string) => getGlobals().agentCatalog.agents[id]?.name ?? id;
/** Token counts in the app's short form (1.2M); unknown stays 未知. */
export const short = (value: number | null | undefined) => value === null || value === undefined ? "未知" : value >= 1e9 ? (value / 1e9).toFixed(1) + "B" : value >= 1e6 ? (value / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M" : value >= 1e3 ? (value / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(Math.round(value));
/** A dollar amount; unknown and unpriced never read as $0. */
export const money = (value: number | null | undefined) => value === null || value === undefined ? "未计价" : value > 0 && value < 0.005 ? "<$0.01" : getGlobals().displayValues.usd(value);
export const percent = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 100) + "%" : "";
