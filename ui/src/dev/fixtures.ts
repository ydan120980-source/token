import type { ComponentType } from "react";
import { Probe } from "../dev/probe";
import { KitGallery } from "../dev/kit-gallery";
import { SettingsPage } from "../pages/settings";
import { QuotaPage, QuotaAfter } from "../pages/quota";
import { TitleReadout, WidgetBoard } from "../pages/widgets";
import { CostPage } from "../pages/cost";
import { UsagePage } from "../pages/usage";
import { SessionsPage } from "../pages/sessions";
import { SourcesPage } from "../pages/sources";

// Isolated acceptance fixtures only. App imports its page children directly.
export const islands: Record<string, ComponentType<any>> = {
  probe: Probe,
  "kit-gallery": KitGallery,
  settings: SettingsPage,
  quota: QuotaPage,
  "quota-after": QuotaAfter,
  widgets: WidgetBoard,
  "title-readout": TitleReadout,
  cost: CostPage,
  usage: UsagePage,
  sessions: SessionsPage,
  sources: SourcesPage,
};
