import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Disclosure, Figure, ListRow, Sheet, StackBar, TextField, Value } from "@ui/kit";
import type { QuotaAccount, QuotaCapability, QuotaEntry, QuotaHost } from "@ui/data/quota-host";
import { refreshQuota } from "./shared";
import type { ReadLine } from "@ui/data/shell-host";

const SMOOTH = () => document.body.dataset.motion === "full" ? "smooth" as const : "auto" as const;

/** The card's own settings: its name, its place and whether the quota page shows it. */
function CardSettings({ host, id, fallback, movable }: { host: QuotaHost; id: string; fallback: string; movable: boolean }) {
  const [value, setValue] = useState(host.get().prefs.names[id] || "");
  useEffect(() => setValue(host.get().prefs.names[id] || ""), [host, id]);
  const hidden = host.get().prefs.hidden.includes(id);
  return <div className="flex flex-col gap-3" data-quota-card-settings={id}>
    <TextField value={value} onChange={setValue} onCommit={() => host.rename(id, value)} label="卡片名称" maxLength={32} placeholder={fallback} autoComplete="off" spellCheck={false} />
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="compact" onClick={() => host.rename(id, value)}>保存名称</Button>
      {movable ? <><Button variant="ghost" size="compact" onClick={() => host.move(id, -1)} aria-label="卡片前移">前移</Button><Button variant="ghost" size="compact" onClick={() => host.move(id, 1)} aria-label="卡片后移">后移</Button></> : null}
      <Button variant="ghost" size="compact" onClick={() => host.toggleHidden(id)}>{hidden ? "在额度页显示" : "在额度页隐藏"}</Button>
    </div>
  </div>;
}

/** One resource with its full exact reading and every fact the service reported about it. */
function Resource({ host, entry, grouped, agent }: { host: QuotaHost; entry: QuotaEntry; grouped: boolean; agent: string }) {
  const m = host.model, view = m.resourceView(entry, grouped), quiet = m.BLOCKING.has(entry.item.state) || m.isStale(entry.item);
  return <div data-quota-resource><ListRow multiline
    title={<span className="py-2" title={entry.item.label || entry.label}>{grouped ? entry.label : entry.item.label || entry.detail || entry.label}</span>}
    meta={<span className="flex flex-col gap-2 py-2"><span>{view.facts}</span>{view.fraction === null ? null : <StackBar height={4} aria-label={view.value}
      segments={[{ key: entry.item.id, value: view.fraction, tone: quiet ? "muted" : `agent:${agent}`, label: view.value }]} />}</span>}
    trailing={<span className="shrink-0 text-body font-semibold tabular-nums" title={view.value}><Value value={view.value} /></span>} /></div>;
}

const stamp = (at: string) => new Date(at).toLocaleString("zh-CN", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
function readLine(line: ReadLine) {
  const times = line.count && line.count > 1 ? "连续 " + line.count + " 次" : "";
  if (line.ok) return ["成功", times].filter(Boolean).join(" · ");
  return [line.message?.replace(/。$/, "") ?? "读取失败" + (line.code ? "（" + line.code + "）" : ""), times, line.quiet ? "会自动重试" : ""].filter(Boolean).join(" · ");
}
/** What became of this connection's recent reads. A passing failure stays quiet on the card, so this is where it can be found. */
function ReadHistoryList({ id, busy }: { id: string; busy: boolean }) {
  const [lines, setLines] = useState<ReadLine[] | null>(null), [open, setOpen] = useState(false);
  const load = useCallback(() => { void window.shellBridge?.readHistory(id).then(setLines).catch(() => setLines([])); }, [id]);
  // Read when the sheet opens, and again when a read in progress ends.
  useEffect(() => { if (!busy) load(); }, [load, busy]);
  if (!window.shellBridge || !lines) return null;
  const failed = lines.filter(line => !line.ok).reduce((sum, line) => sum + (line.count ?? 1), 0);
  return <div data-quota-read-history={id}><Disclosure open={open} onOpenChange={setOpen} summary={<span className="flex items-center gap-2 text-caption text-muted-foreground">{"最近读取"}{failed ? <Badge tone="warn">{failed + " 次失败"}</Badge> : null}</span>}>
    {lines.length ? <ul className="flex flex-col gap-2">{lines.map(line => <li key={line.at} className="flex min-w-0 items-baseline gap-3 text-caption" data-read-line={line.ok ? "ok" : "failed"}>
      <time className="shrink-0 tabular-nums text-muted-foreground">{stamp(line.at)}</time>
      <span className={"min-w-0 break-words " + (line.ok ? "text-muted-foreground" : "text-foreground")}>{readLine(line)}</span>
    </li>)}</ul> : <p className="text-caption text-muted-foreground">{"还没有读取记录"}</p>}
  </Disclosure></div>;
}
function AccountDetails({ host, account, capability, cardKey }: { host: QuotaHost; account: QuotaAccount; capability: QuotaCapability; cardKey: string | null }) {
  const m = host.model, quota = account.quota, row = account.row, { leading, events } = m.factsView(account), sum = m.creditTotal(account, m.parts(quota).money);
  const facts = [
    { label: leading[0], value: leading[1] },
    { label: "接下来", value: events[0] ? m.clock(events[0].at) : "没有报告", note: events[0]?.text },
    { label: "最近成功读取", value: quota ? m.age(quota) : "尚未读取", note: quota ? m.at(quota.fetchedAt) : "" },
  ];
  const meta = [
    quota?.entitlement?.plan ? "套餐 " + quota.entitlement.plan : null,
    quota?.entitlement?.validUntil ? "会员有效期 " + m.at(quota.entitlement.validUntil) : null,
    quota?.entitlement?.verificationRequired ? "资格需重新核验" : null,
    "最近成功 " + m.at(quota?.fetchedAt),
    account.agent === "codex" && row.lastAttempt ? "最近尝试 " + m.at(row.lastAttempt) : null,
    quota?.partial ? "部分数据或资格未知" : null,
  ].filter(Boolean).join(" · ");
  const groups = m.resourcesView(account, capability);
  return <section className="flex flex-col gap-6" data-quota-account={account.id}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-subtitle font-semibold text-foreground">{m.displayName(account.id, account.alias || capability.name)}</h3>
      <Badge tone={account.status.warn ? "warn" : "neutral"}>{account.status.text}</Badge>
    </div>
    <div className="grid grid-cols-3 gap-3" data-quota-facts>
      {facts.map(fact => <div key={fact.label} className="flex min-w-0 flex-col gap-2 rounded-xl bg-surface-2 p-3">
        <span className="text-caption text-muted-foreground">{fact.label}</span>
        <span title={fact.value} className="truncate"><Figure text={fact.value} size="sm" /></span>
        {fact.note ? <span className="break-words text-caption text-muted-foreground">{fact.note}</span> : null}
      </div>)}
    </div>
    {account.status.title ? <p className="text-caption text-destructive">{account.status.title}</p> : null}
    {sum ? <div className="flex flex-col gap-2" title={sum.item.label || undefined} data-quota-sheet-total><span className="text-caption text-muted-foreground">{sum.item.label}</span><span className="text-body font-semibold tabular-nums"><Value value={m.exactAmount(sum.item)} /></span></div> : null}
    {groups.length ? groups.map(group => <div key={group.title} className="flex flex-col gap-3" data-quota-resource-group>
      {group.closed ? <div data-quota-more><Disclosure summary={group.title}>{group.items.map(entry => <Resource key={entry.pool.id + "/" + entry.item.id} host={host} entry={entry} grouped={group.grouped} agent={account.agent} />)}</Disclosure></div>
        : <>
          <h4 className="text-subtitle font-semibold text-foreground">{group.title}{group.summary ? <span className="text-caption font-normal text-muted-foreground"> {group.summary}</span> : null}</h4>
          <div>{group.items.slice(0, group.limit).map(entry => <Resource key={entry.pool.id + "/" + entry.item.id} host={host} entry={entry} grouped={group.grouped} agent={account.agent} />)}</div>
          {group.items.length > group.limit ? <div data-quota-more><Disclosure summary={"另外 " + (group.items.length - group.limit) + " 项"}>{group.items.slice(group.limit).map(entry => <Resource key={entry.pool.id + "/" + entry.item.id} host={host} entry={entry} grouped={group.grouped} agent={account.agent} />)}</Disclosure></div> : null}
        </>}
    </div>) : <p className="text-caption text-muted-foreground">{quota ? "没有额度项" : "尚无额度观测"}</p>}
    <div className="flex flex-col gap-2">
      <h4 className="text-subtitle font-semibold text-foreground">连接</h4>
      <p className="text-caption text-muted-foreground">{meta}</p>
      {quota?.resetCredits == null ? null : <p className="text-body">可用重置次数 {quota.resetCredits}</p>}
      {row.remembered ? <p className="text-caption text-muted-foreground">已保持登录 · 凭据由 Windows 系统加密保护；移除连接会删除本应用保存的凭据。</p> : null}
      {row.duplicateKnown ? <p className="text-caption text-muted-foreground" data-duplicate-note>{m.duplicateNote(account)}</p> : null}
      <ReadHistoryList id={account.id} busy={account.busy} />
    </div>
    {cardKey === null ? null : <CardSettings host={host} id={cardKey} fallback={account.alias || capability.name} movable />}
  </section>;
}

/** Every connection of one Agent, its resources and actions; opened from a card, a tile or the summary. */
export function QuotaDetails({ host, selection, onClose, connect }: { host: QuotaHost; selection: { agent: string; account?: string } | null; onClose: () => void; connect: (agent: string, id?: string) => void }) {
  const m = host.model, capability = m.capabilities().find(item => item.provider === selection?.agent), list = m.accounts().filter(account => account.agent === selection?.agent);
  const body = useRef<HTMLDivElement>(null), keys = new Map<string, string | null>();
  // A shared card keeps one name, under its first connection.
  for (const card of m.cardsOf(list)) card.members.forEach((member, index) => keys.set(member.id, index ? null : card.key));
  // Scrolls the sheet's own body to a connection; scrollIntoView would also scroll the window behind it.
  const jump = (id: string) => {
    const target = body.current?.querySelector<HTMLElement>(`[data-quota-account="${CSS.escape(id)}"]`), scroller = body.current?.closest<HTMLElement>("[data-sheet-body]");
    if (!target || !scroller) return;
    scroller.scrollTo({ top: scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top, behavior: SMOOTH() });
  };
  useEffect(() => {
    if (!selection?.account) return;
    const frame = requestAnimationFrame(() => jump(selection.account!));
    return () => cancelAnimationFrame(frame);
  }, [selection]);
  const snapshot = host.get();
  const footer = capability ? <div className="flex w-full flex-col gap-3">
    {list.map(account => <div key={account.id} className="flex flex-wrap items-center gap-2" data-quota-account-actions={account.id}>
      <span className="min-w-0 flex-1 break-words text-caption text-muted-foreground">{m.displayName(account.id, account.alias || capability.name)}</span>
      <span data-quota-sheet-refresh={account.id}><Button variant="secondary" size="compact" disabled={account.refresh.disabled} loading={account.busy} onClick={() => refreshQuota(host, account)}>{account.row.passive ? "读取本地观测" : "刷新"}</Button></span>
      {account.agent !== "codex" ? <Button variant="ghost" size="compact" disabled={account.busy} onClick={() => account.row.passive ? void host.providerAction("passive-guide", account.id) : connect(account.agent, account.id)}>
        {account.row.passive ? "复制状态栏配置" : capability.adapters.some(route => route.clientLogin || route.websiteLogin) ? "重新连接／登录" : "重新提供凭据"}</Button> : null}
      {account.busy && account.agent !== "codex" ? <Button variant="ghost" size="compact" onClick={() => { void host.providerAction("cancel", account.id); }}>取消</Button> : null}
      <span data-quota-remove={account.id}><Button variant="ghost" tone="danger" size="compact" disabled={account.agent === "codex" && (!host.available || snapshot.example || account.busy)} onClick={() => account.agent === "codex" ? host.remove(account.id) : void host.providerAction("remove", account.id)}>移除连接</Button></span>
    </div>)}
    <div className="flex flex-wrap justify-end gap-2">
      {capability.provider === "codex" && !snapshot.state.executableAvailable ? <Button variant="primary" onClick={host.choose}>选择 codex.exe…</Button>
        : capability.provider === "codex" || capability.adapters.length ? <span data-provider-connect={capability.provider}><Button variant="primary" disabled={capability.provider === "codex" && !host.canAdd()} onClick={() => connect(capability.provider)}>{list.length ? "再连接一个账号" : capability.provider === "codex" ? "连接 Codex" : "连接额度"}</Button></span> : null}
    </div>
  </div> : undefined;
  return <Sheet open={Boolean(selection && capability)} onOpenChange={open => { if (!open) onClose(); }} title={capability?.name || "额度详情"} size="lg" scrollable footer={footer}>
    {capability ? <div ref={body} className="flex flex-col gap-8" data-quota-details>
      {list.length > 1 ? <nav className="flex flex-wrap gap-2" aria-label="连接">{list.map(account => <Button key={account.id} variant="secondary" size="compact" onClick={() => jump(account.id)}>{m.displayName(account.id, account.alias || capability.name)}</Button>)}</nav> : null}
      {list.length ? list.map(account => <AccountDetails key={account.id} host={host} account={account} capability={capability} cardKey={keys.get(account.id) ?? null} />)
        : <><p className="text-body text-muted-foreground">未连接。</p><CardSettings host={host} id={"agent:" + capability.provider} fallback={capability.name} movable={false} /></>}
      <section className="flex flex-col gap-3">
        <h3 className="text-subtitle font-semibold text-foreground">读取方式</h3>
        <p className="text-caption text-muted-foreground">{capability.reason}</p>
        {capability.adapters.map(route => <p key={route.id} className="text-caption text-muted-foreground"><span className="font-semibold text-foreground">{route.name}</span> {route.note}</p>)}
        <p className="text-caption text-muted-foreground">{capability.provider === "codex" ? "额度归属于实际服务账号，不同账号与资源池不相加。" : "选择记住的凭据用 Windows 加密保存在本机，其余只在本次运行的内存里；查看本页不会请求服务商。不同资源池、余额及其组成不相加。"}</p>
        {capability.provider === "codex" ? <span><Button variant="ghost" size="compact" onClick={host.choose}>Codex CLI 不在默认位置？选择 codex.exe…</Button></span> : null}
      </section>
    </div> : null}
  </Sheet>;
}
