import { Button, SectionHeader, ValueButton } from "@ui/kit";
import { sourcesModel, useSourcesHost } from "@ui/data";

type QuotaWindow = Window & { quotaUi?: { openSource(agent: string): void } };

// A source's account quota: one quiet phrase in its row (opens the quota home when supported), or a
// short section in the setup sheet.
export function QuotaLine({ agent, detail = false, prefix = "" }: { agent: string; detail?: boolean; prefix?: string }) {
  const host = useSourcesHost(), quota = host.connections().snapshot.rows.find(row => row.agent === agent)?.quota;
  if (!quota || host.catalog()[agent]?.usageOnly) return null;
  const model = window.connectionState, text = model.CAPABILITY_LABELS[quota.capability], description = model.quotaDescription(quota);
  const supported = quota.capability === "supported", stale = host.connections().stale;
  const open = () => { host.closeSetup(); (window as QuotaWindow).quotaUi?.openSource(agent); };
  if (detail) return <div className="flex flex-col gap-3">
    <SectionHeader title={"账号额度：" + text} />
    <p className="text-body text-foreground">{(stale ? "上次状态，待重新检查。" : "") + description}</p>
    {quota.latestSuccess ? <p className="text-caption text-muted-foreground">{"额度最近成功 " + sourcesModel().when(quota.latestSuccess)}</p> : null}
    {supported ? <div><Button variant="tertiary" onClick={open}>{"在额度监控中查看"}</Button></div> : null}
  </div>;
  const phrase = text + (supported ? " · " + (stale ? "上次状态，待重新检查 · " : "") + description.replace(/。$/, "") : "");
  return <span data-source-connection={agent}>{prefix}
    {supported ? <span data-source-quota={agent} title="在额度监控中查看"><ValueButton onClick={open}>{phrase}</ValueButton></span> : phrase}
  </span>;
}
