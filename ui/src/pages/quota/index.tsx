import { useEffect, useRef, useState } from "react";
import { IconCopy, IconRefresh } from "@tabler/icons-react";
import { Banner, Button, IconButton, Segmented, Select, ViewContent } from "@ui/kit";
import { showView } from "@ui/data";
import type { QuotaCapability, QuotaHost, QuotaPrefs } from "@ui/data/quota-host";
import { useQuotaGrid } from "./shared";
import { WidgetBoard } from "../widgets";
import { AttentionList, IdleList, QuotaFootnote } from "./summary";
import { QuotaDetails } from "./details";
import { CodexConnection, ProviderConnection } from "./connections";
import { FirstRunGuide } from "./guide";

const FLASH_MS = 1800;
const smooth = () => document.body.dataset.motion === "full" ? "smooth" as const : "auto" as const;

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
function Header({ host }: { host: QuotaHost }) {
  const snapshot = host.get(), today = new Date();
  const refreshing = snapshot.refreshingAll || Boolean(snapshot.state.operationBusy && !snapshot.state.pendingLogin);
  const nothing = !snapshot.state.accounts.length && !snapshot.providerState?.accounts.length;
  return <header className="flex flex-wrap items-start justify-between gap-4" data-quota-toolbar>
    <div className="flex min-w-0 flex-col gap-1">
      <h1 className="text-display font-semibold text-foreground">概览</h1>
      <span className="text-caption text-muted-foreground" data-home-date>{today.getMonth() + 1} 月 {today.getDate()} 日 {WEEK[today.getDay()]}</span>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Segmented value={snapshot.prefs.measure} onChange={value => host.setPreference("measure", value)} aria-label="额度读数"
        items={[{ value: "remaining" as QuotaPrefs["measure"], label: "剩余" }, { value: "used" as QuotaPrefs["measure"], label: "已用" }]} />
      <span className="inline-flex items-center gap-2" data-quota-cadence>
        <span className="text-caption text-muted-foreground">自动刷新</span>
        <Select value={snapshot.state.autoRefresh === "1min" ? "1min" : "off"} onChange={host.setAuto} disabled={!host.available || snapshot.example} aria-label="额度自动刷新"
          options={[{ value: "off", label: "关闭" }, { value: "1min", label: "每分钟" }]} />
      </span>
      <span data-quota-copy><IconButton icon={IconCopy} label="复制额度摘要" onClick={() => { void host.copySummary(); }} /></span>
      <span data-quota-refresh-all><Button variant="primary" leadingIcon={IconRefresh} loading={refreshing} disabled={!host.available || snapshot.example || snapshot.requesting || snapshot.refreshingAll || nothing || Boolean(snapshot.state.pendingLogin)}
        onClick={() => { void host.refreshAll(); }}>全部刷新</Button></span>
    </div>
  </header>;
}

/** Results and warnings of the last action: batch counts, example data, a reset cache, the host's message. */
function Notices({ host }: { host: QuotaHost }) {
  const snapshot = host.get(), { batch } = host.model.toolbarView(snapshot);
  const recovered = snapshot.state.recovered && !snapshot.requesting ? "检测到受损的 " + snapshot.state.recovered.file + (snapshot.state.recovered.quarantined ? "，已移入数据目录下的 quarantine 文件夹" : "，且无法移入 quarantine") + "，账号列表已重置，请重新连接。" : snapshot.error;
  return <>
    {batch ? <p className="text-caption text-muted-foreground" data-quota-summary>上次全部刷新：成功 {batch.success} / 失败 {batch.failed} / 跳过 {batch.skipped}</p> : null}
    {snapshot.example ? <Banner tone="info">示例额度 · 合成数据</Banner> : null}
    {recovered ? <Banner tone="warn">{recovered}</Banner> : null}
    <p role="status" className="text-caption text-muted-foreground empty:hidden" data-provider-quota-message>{snapshot.message}</p>
  </>;
}

type Details = { agent: string; account?: string };

// 概览, the home page (owner 2026-10-27, UI-PALETTE-QUOTA-SUMMARY-PROPOSAL-20261027.md section 3; was the quota page, M6). The legacy side
// keeps state and actions in window.quotaHost (quota-host.js, model in quota-model.js) and still draws
// the account cards (quota-card-grid.js, owner: the cards stay as they were) between this island and
// QuotaAfter. This island owns the sheets and offers window.quotaUi to the cards, the summary, the
// cost page and the sources page.
export function QuotaPage() {
  const { host, grid, active } = useQuotaGrid(), root = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState<Details | null>(null), [codexOpen, setCodexOpen] = useState(false);
  const [provider, setProvider] = useState<{ capability: QuotaCapability; id: string | null } | null>(null);
  const walk = useRef({ attention: 0, old: 0 }), flash = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(grid); latest.current = grid;

  const connect = (agent: string, id?: string) => {
    if (host.get().connecting) return;
    if (agent === "codex") { if (host.canAdd()) { setDetails(null); setCodexOpen(true); } return; }
    const capability = host.model.capabilities().find(item => item.provider === agent);
    if (capability?.adapters.length) { setDetails(null); setProvider({ capability, id: id || null }); }
  };
  const focusAgent = (agent: string) => {
    const target = document.querySelector<HTMLElement>(`#quota [data-provider-row="${CSS.escape(agent)}"], #summaryPanel [data-provider-row="${CSS.escape(agent)}"]`);
    target?.scrollIntoView({ block: "center", behavior: smooth() });
    target?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  };
  // Walks the cards that need attention (or have not read for a day), one per press, showing a
  // filtered-out card first. Hidden cards stay hidden.
  const locate = (kind: "attention" | "old") => {
    const now = latest.current, m = host.model, prefs = host.get().prefs;
    const candidates = now.live.filter(entry => !prefs.hidden.includes(entry.key) && (kind === "old" ? entry.item.quota && m.outdated(entry.item.quota) : entry.warn));
    if (!candidates.length) return;
    const chosen = candidates[walk.current[kind]++ % candidates.length];
    if (!m.FILTERS[prefs.filter].match(chosen)) host.setPreference("filter", "all");
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`#quotaCards .quota-card[data-card-key="${CSS.escape(chosen.key)}"]`);
      if (!target) return;
      target.scrollIntoView({ block: "center", behavior: smooth() });
      target.dataset.attentionFlash = "";
      target.querySelector<HTMLButtonElement>(".quota-problem button, .quota-sheet-open")?.focus({ preventScroll: true });
      if (flash.current) clearTimeout(flash.current);
      flash.current = setTimeout(() => { delete target.dataset.attentionFlash; }, FLASH_MS);
    });
  };

  useEffect(() => {
    window.quotaUi = Object.freeze({
      state: host.state, refreshAll: host.refreshAll, add: () => connect("codex"),
      openSource: (agent: string) => { showView("quota"); requestAnimationFrame(() => focusAgent(agent)); },
      connect, openDetails: (agent: string, account?: string) => setDetails({ agent, account }), locate,
    });
    window.providerQuotaUi = Object.freeze({ state: host.providers, codex: host.codex });
    return () => { delete window.quotaUi; delete window.providerQuotaUi; };
    // The functions above read the host and refs, which never change identity.
  }, [host]);
  useEffect(() => () => { if (flash.current) clearTimeout(flash.current); }, []);

  // The page leaves memory while hidden; its sheets stay mounted, since other surfaces open them through quotaUi.
  return <>
    <ViewContent active={active}>
      <div ref={root} className="flex w-full flex-col gap-8" data-quota-page data-ready>
        <div className="flex flex-col gap-3">
          <Header host={host} />
          <Notices host={host} />
        </div>
        <WidgetBoard />
      </div>
    </ViewContent>
    <QuotaDetails host={host} selection={details} onClose={() => setDetails(null)} connect={connect} />
    <CodexConnection host={host} open={codexOpen} onClose={() => setCodexOpen(false)} />
    <ProviderConnection host={host} selection={provider} onClose={() => setProvider(null)} />
    <FirstRunGuide host={host} connect={connect} away={Boolean(provider) || codexOpen} />
  </>;
}
// Below the cards: the connections that need attention and the Agents not yet connected.
export function QuotaAfter() {
  const { host, grid, active } = useQuotaGrid(), idle = host.get().prefs.filter === "idle";
  return <ViewContent active={active}><div className="mt-8 flex w-full flex-col gap-8" data-quota-after>
    {idle ? null : <AttentionList host={host} grid={grid} inline />}
    <IdleList host={host} grid={grid} inline />
    {!host.available ? <span data-quota-example><Button variant="ghost" size="compact" onClick={host.toggleExample}>{host.get().example ? "返回未连接状态" : "查看示例卡片"}</Button></span> : null}
    <QuotaFootnote />
  </div></ViewContent>;
}
