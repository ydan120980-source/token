import type { ComponentType } from "react";
import type { WidgetType } from "@ui/data/widgets";
import type { WidgetProps } from "./shared";
import { QuotaNext, QuotaStatus, QuotaUpcoming, QuotaWindows } from "./quota";
import { CostDaily, CostMonth, CostWhere } from "./cost";
import { UsageHeatmap, UsageLive, UsageToday, UsageWeek } from "./usage";
import { SessionsRecent, SessionsWindow } from "./sessions";
import { AgentsGraph } from "./agents";

// Every widget type the layout model knows, by name.
export const WIDGETS: Record<WidgetType, ComponentType<WidgetProps>> = {
  "quota.windows": QuotaWindows, "quota.next": QuotaNext, "quota.upcoming": QuotaUpcoming, "quota.status": QuotaStatus,
  "cost.month": CostMonth, "cost.daily": CostDaily, "cost.where": CostWhere,
  "usage.today": UsageToday, "usage.heatmap": UsageHeatmap, "usage.week": UsageWeek, "usage.live": UsageLive,
  "sessions.recent": SessionsRecent, "sessions.window": SessionsWindow, "agents.graph": AgentsGraph,
};
