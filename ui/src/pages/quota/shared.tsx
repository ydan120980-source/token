import { useEffect, useMemo, useState } from "react";
import { Button } from "@ui/kit";
import { useViewActive } from "@ui/data";
import { useQuotaHost, type QuotaAccount, type QuotaCapability, type QuotaGrid, type QuotaHost } from "@ui/data/quota-host";

// Ages ("10 分钟前") and countdowns move without a new read; the page re-derives them this often.
const AGE_MS = 30000;

/** The quota host and its grid, re-derived on every change and every half minute while shown. */
export function useQuotaGrid(): { host: QuotaHost; grid: QuotaGrid; active: boolean } {
  const host = useQuotaHost(), active = useViewActive("quota"), [tick, setTick] = useState(0), version = host.gridVersion();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick(value => value + 1), AGE_MS);
    return () => clearInterval(timer);
  }, [active]);
  // version and tick are the change signals: the host publishes a new version on every change.
  const grid = useMemo(() => host.model.gridView(), [host, version, tick]);
  return { host, grid, active };
}

/** One explicit read of a connection: Codex through its own CLI, the others through their adapter. */
export function refreshQuota(host: QuotaHost, account: QuotaAccount) {
  if (account.agent === "codex") host.refresh(account.id);
  else void host.providerAction("refresh", account.id);
}

/** The page island owns the sheets; the summary island and other pages reach them through quotaUi. */
export const quotaUi = {
  connect: (agent: string, id?: string) => window.quotaUi?.connect(agent, id),
  details: (agent: string, account?: string) => window.quotaUi?.openDetails(agent, account),
  locate: (kind: "attention" | "old") => window.quotaUi?.locate(kind),
};

/** The one repair a connection that needs attention offers (model.fixView). */
export function QuotaFix({ host, account, capability, size = "compact" }: { host: QuotaHost; account: QuotaAccount; capability: QuotaCapability | undefined; size?: "default" | "compact" }) {
  const view = host.model.fixView(account, capability);
  const run = () => {
    if (view.action === "details") quotaUi.details(account.agent, account.id);
    else if (view.action === "credential") quotaUi.connect(account.agent, account.id);
    else if (view.action === "refresh") refreshQuota(host, account);
    else void host.providerAction(view.action, account.id);
  };
  return <span data-provider-action={view.action}>
    <Button variant="secondary" size={size} disabled={view.action === "refresh" ? account.refresh.disabled : account.busy} onClick={run}>{view.label}</Button>
  </span>;
}

/** The name a card or connection shows: the person's own name for it, else the service's. */
export function nameOf(host: QuotaHost, key: string, fallback: string) {
  return host.model.displayName(key, fallback);
}
