import { useEffect, useState } from "react";
import { AgentMark, Badge, Button, Disclosure, SettingRow, Sheet, Switch } from "@ui/kit";
import { useDesktopShell } from "@ui/data/shell-host";
import type { QuotaHost } from "@ui/data/quota-host";

type Found = { agent: string; installed: boolean; files: number | null };
const OPEN_EVENT = "first-run-guide";
export const openGuide = () => window.dispatchEvent(new Event(OPEN_EVENT));

/** The first run: which Agents this machine has, each connected from one page (owner 2026-11-05). Finding them reads folder
 * names and file counts only; connecting goes through the same sheet as everywhere else, which this page steps aside for. */
export function FirstRunGuide({ host, connect, away }: { host: QuotaHost; connect: (agent: string) => void; away: boolean }) {
  const shell = useDesktopShell(), [asked, setAsked] = useState(false), [found, setFound] = useState<Found[] | null>(null);
  const wanted = asked || shell.state?.guided === false;
  useEffect(() => { const open = () => setAsked(true); window.addEventListener(OPEN_EVENT, open); return () => window.removeEventListener(OPEN_EVENT, open); }, []);
  useEffect(() => { if (wanted && !found) void window.usageBridge?.sources().then(value => setFound(value.sources as Found[])).catch(() => setFound([])); }, [wanted, found]);
  const finish = () => { setAsked(false); if (shell.state?.guided === false) shell.set({ guided: true }); };
  if (!wanted) return null;
  const m = host.model, connected = new Set(m.accounts().map(account => account.agent)), capabilities = m.capabilities();
  const facts = new Map((found ?? []).map(item => [item.agent, item]));
  const here = (agent: string) => { const fact = facts.get(agent); return Boolean(fact?.installed || fact?.files); };
  const known = capabilities.filter(item => here(item.provider)), others = capabilities.filter(item => !here(item.provider));
  const row = (capability: (typeof capabilities)[number]) => {
    const fact = facts.get(capability.provider), codex = capability.provider === "codex", usable = codex || capability.adapters.length > 0;
    return <div key={capability.provider} className="flex min-h-12 items-center gap-3 border-b border-border py-2 last:border-b-0" data-guide-agent={capability.provider}>
      <AgentMark agent={capability.provider} variant="icon" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-body font-medium text-foreground">{capability.name}</span>
        {fact?.files ? <span className="text-caption text-muted-foreground">{"本机有 " + fact.files + " 份用量记录"}</span> : fact?.installed ? <span className="text-caption text-muted-foreground">{"已安装，还没有用量记录"}</span> : null}
      </div>
      {connected.has(capability.provider) ? <Badge tone="neutral">{"已连接"}</Badge>
        : usable ? <span data-guide-connect><Button variant="secondary" size="compact" disabled={codex && !host.canAdd()} onClick={() => connect(capability.provider)}>{"连接额度"}</Button></span>
        : <span className="shrink-0 text-caption text-muted-foreground">{capability.mode === "planned" ? "读取待接入" : "没有账号额度"}</span>}
    </div>;
  };
  return <Sheet open={!away} onOpenChange={open => { if (!open) finish(); }} title="连接你的 Agent" description="用量已经在本机统计。连接额度后，这里会显示每个账号还剩多少。" size="lg" scrollable
    footer={<span data-guide-finish className="flex w-full justify-end"><Button variant="primary" onClick={finish}>{"完成"}</Button></span>}>
    <div className="flex flex-col gap-6" data-guide>
      {!found ? <p className="text-caption text-muted-foreground" role="status">{"正在查找本机的 Agent…"}</p> : <>
        {known.length ? <div data-guide-found>{known.map(row)}</div> : <p className="text-body text-muted-foreground">{"这台电脑上还没有找到 Agent。"}</p>}
        {others.length ? <div data-guide-others><Disclosure summary={known.length ? "另外 " + others.length + " 个没有在本机找到" : "全部 " + others.length + " 个 Agent"}><div>{others.map(row)}</div></Disclosure></div> : null}
      </>}
      {shell.state ? <div data-guide-options>
        <SettingRow title="额度快用完时提醒" control={<Switch labelHidden label="额度快用完时提醒" checked={shell.state.watch.enabled} onChange={value => shell.set({ watch: { enabled: value } })} />} />
        {shell.state.login.available ? <SettingRow title="开机时启动，留在托盘" control={<Switch labelHidden label="开机时启动，留在托盘" checked={shell.state.login.open} onChange={value => shell.set({ login: value })} />} /> : null}
      </div> : null}
    </div>
  </Sheet>;
}
