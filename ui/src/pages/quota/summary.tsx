import { IconAlertTriangle } from "@tabler/icons-react";
import { AgentMark, Badge, Button } from "@ui/kit";
import { showView } from "@ui/data";
import type { QuotaGrid, QuotaHost } from "@ui/data/quota-host";
import { QuotaFix, nameOf, quotaUi } from "./shared";

/** Connections that need the person: the repair each offers, and a walk through their cards. */
export function AttentionList({ host, grid, inline = false }: { host: QuotaHost; grid: QuotaGrid; inline?: boolean }) {
  const m = host.model;
  if (!grid.warned.length) return null;
  return <section className={"flex flex-col gap-1 " + (inline ? "" : "border-b border-border py-5")} aria-label="需要处理的连接" data-quota-attention>
    <div className="flex items-center justify-between gap-2 pb-2">
      <h2 className="inline-flex items-center gap-2 text-subtitle font-semibold text-foreground">需要处理<Badge tone="warn">{grid.warned.length}</Badge></h2>
      <span data-attention-next><Button variant="ghost" size="compact" onClick={() => quotaUi.locate("attention")}>定位下一张</Button></span>
    </div>
    {grid.warned.map(account => {
      const capability = grid.caps.find(item => item.provider === account.agent), reason = account.status.title || account.status.text;
      return <div key={account.id} className="flex min-h-12 items-center gap-3 border-b border-border py-2 last:border-b-0" data-attention-row={account.id}>
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warn-soft text-warn-text"><IconAlertTriangle size={15} aria-hidden="true" /></span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-medium text-foreground">{nameOf(host, account.id, account.alias || capability?.name || account.agent)}</span>
          <span className="break-words text-caption text-muted-foreground" title={reason}>{m.brief(reason)}</span>
        </div>
        <QuotaFix host={host} account={account} capability={capability} />
      </div>;
    })}
  </section>;
}

// The website-session routes' notes say their interface may change; that label must stay visible.
const UNSTABLE = /可能变更/;
/** The Agents without a quota connection, each with its way to connect. */
export function IdleList({ host, grid, inline = false }: { host: QuotaHost; grid: QuotaGrid; inline?: boolean }) {
  const snapshot = host.get();
  if (!grid.visibleIdle.length) return null;
  return <section className={"flex flex-col gap-1 " + (inline ? "" : "py-5")} aria-labelledby="quotaIdleTitle" data-quota-idle>
    <h2 id="quotaIdleTitle" className="flex items-baseline gap-2 pb-2 text-subtitle font-semibold text-foreground">{grid.live.length ? "未连接" : "还没有连接额度"}<span className="text-caption font-normal text-muted-foreground">{grid.visibleIdle.length} 个 Agent</span></h2>
    {grid.visibleIdle.map(({ key, capability }) => {
      const codex = capability.provider === "codex", missing = codex && host.available && !snapshot.state.executableAvailable;
      // No explanatory small print (owner 2026-10-27): a row keeps only a state (Codex CLI missing, no
      // safe route) and the required non-public/unstable label of website-session routes (2026-10-20).
      const note = codex ? missing ? "没有在默认位置找到官方 Codex CLI。" : null : capability.mode === "planned" ? "读取待接入" : !capability.adapters.length ? "还没有经过核实的安全读取方式。" : UNSTABLE.test(capability.login?.note ?? "") ? capability.login!.note! : null;
      return <div key={key} className="flex min-h-12 items-center gap-3 border-b border-border py-2 last:border-b-0" data-provider-row={capability.provider} data-quota-idle-agent={capability.provider}>
        <AgentMark agent={capability.provider} variant="icon" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-medium text-foreground">{nameOf(host, key, capability.name)}</span>
          {note ? <span className={(inline ? "" : "truncate ") + "text-caption text-muted-foreground"} title={note}>{note}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {missing ? <Button variant="secondary" size="compact" onClick={host.choose}>选择 codex.exe…</Button>
            : codex || capability.adapters.length ? <span data-provider-connect><Button variant="secondary" size="compact" disabled={codex && !host.canAdd()} onClick={() => quotaUi.connect(capability.provider)}>{codex ? "连接 Codex" : "连接"}</Button></span> : null}
          <Button variant="ghost" size="compact" onClick={() => quotaUi.details(capability.provider)}>说明</Button>
        </div>
      </div>;
    })}
  </section>;
}

export function QuotaFootnote() {
  return <p className="flex flex-col items-start gap-2">
    <Button variant="ghost" size="compact" onClick={() => showView("sources")}>在Agent 管理中查看全部</Button>
  </p>;
}

// The quota page's summary column (window-shell.js docks it in a wide window, floats it otherwise).
// It reads the same quota host as the page and reaches the page's sheets through quotaUi.
