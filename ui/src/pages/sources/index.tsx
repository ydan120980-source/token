import { useEffect, useMemo, useRef, useState } from "react";
import { IconPlus, IconRefresh } from "@tabler/icons-react";
import { Badge, Banner, Button, Card, Disclosure, EmptyState, IconButton, PageHeader, SectionHeader, Segmented, Switch } from "@ui/kit";
import { showView, sourcesModel, useSourcesHost, useViewActive, type SourceReadStatus } from "@ui/data";
import { useInsightsHost, type AttentionItem } from "@ui/data/insights-host";
import { useUsage } from "@ui/data/widget-data";
import { SourceSheets } from "./sheets";
import { ADMIN_SECTIONS, AgentsTab, useAgentAdmin, type AdminSection } from "./agents-tab";
import { SourceCard } from "./source-card";

const kinds = [["all", "全部"], ["sources", "来源"], ["cost", "费用"], ["sessions", "会话"], ["budget", "预算"]] as const;
const SHOWN = 6;

const compact = (value: number) => value >= 1e9 ? (value / 1e9).toFixed(1) + "B" : value >= 1e6 ? (value / 1e6).toFixed(1) + "M" : value >= 1e3 ? (value / 1e3).toFixed(1) + "K" : String(value);
const DAYS = 14;

/** One item that belongs to no card, or any item when the whole list is opened. */
function AttentionRow({ item, status, insights }: { item: AttentionItem; status: { busy?: boolean }; insights: ReturnType<typeof useInsightsHost> }) {
  return <article data-attention-id={item.id} data-attention-item={item.kind}
    data-attention-collection={item.scope === "collection" ? "" : undefined} data-acknowledged={item.acknowledged ? "" : undefined}
    className="flex min-h-14 flex-wrap items-center gap-3">
    <Badge tone="neutral">{item.kindLabel}</Badge>
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <strong className="text-body font-semibold text-foreground" title={item.title} data-attention-what>{item.what}</strong>
      <span className="text-caption text-muted-foreground" data-attention-effect>{item.effect + (item.acknowledged ? " · 已知悉" : "")}</span>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {item.actions.map(action => <Button key={action.action + action.label} variant="secondary" size="compact" disabled={status.busy || action.disabled} onClick={() => insights.act(action.action, action.value)}>{action.label}</Button>)}
      {item.scope !== "collection" ? <Button variant="secondary" size="compact" disabled={status.busy} onClick={() => { void (item.acknowledged ? insights.restore(item.id) : insights.acknowledge(item.id)); }}>{item.acknowledged ? "恢复待办" : "已知悉"}</Button> : null}
    </div>
  </article>;
}

// The sources page (owner 2026-11-03, docs/m2/UI-OWNER-FIVE-BATCHES-20261103.md): a tab for what is read and a tab
// for each Agent's configuration. A problem sits on the card of the Agent it belongs to and says whether it can be
// solved; only what belongs to no Agent stays in the list above them. sources-host.js owns every read and action;
// insights-ui.js the attention items.
export function SourcesPage() {
  const host = useSourcesHost(), state = host.get(), model = sourcesModel(), insights = useInsightsHost(), active = useViewActive("sources");
  const [paths, setPaths] = useState<string[]>([]), [caps, setCaps] = useState<string[]>([]), [focus, setFocus] = useState<string | null>(null);
  const [kind, setKind] = useState<string>("all"), [showAcknowledged, setShowAcknowledged] = useState(false), [expanded, setExpanded] = useState(false), [allOpen, setAllOpen] = useState(false);
  const [tab, setTab] = useState<"sources" | AdminSection>("sources"), usage = useUsage(), admin = useAgentAdmin();
  useEffect(() => { void admin.load(); }, []);
  const [sheet, setSheet] = useState<"install" | "custom" | "demo" | null>(null), [demoAgent, setDemoAgent] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const toggle = (set: (update: (list: string[]) => string[]) => void, id: string) => set(list => list.includes(id) ? list.filter(value => value !== id) : [...list, id]);
  const changePath = async (action: string, agent: string, path?: string) => {
    const origin = document.activeElement;
    await host.change(action, agent, path);
    // Reset can remove its own trigger. Return keyboard focus to this Agent's
    // still-open path control after React has committed the saved selection.
    requestAnimationFrame(() => {
      if (origin instanceof HTMLElement && !origin.isConnected) {
        root.current?.querySelector<HTMLButtonElement>(`[data-source-agent="${CSS.escape(agent)}"] [data-source-paths] button`)?.focus({ preventScroll: true });
      }
    });
  };

  // The page's API for other pages (window.sourcesUi) and the old setup/connection hooks.
  useEffect(() => {
    window.sourcesUi = Object.freeze({
      focus(agent: string) { setTab("sources"); setPaths(list => list.includes(agent) ? list : [...list, agent]); setFocus(agent); showView("sources"); },
      refresh: () => { void host.load(true); }, reload: host.load,
      render(statuses?: SourceReadStatus[]) { if (arguments.length) host.update(statuses ?? null); else host.update(); },
      collection: host.collection, notice: host.notice,
      openAttention: (next = "all") => { setTab("sources"); setKind(next); setExpanded(false); setAllOpen(true); insights.openAttention(next); },
      openSetup: (agent: string) => { void host.openSetup(agent); },
    });
    window.sourceConnectionsUi = Object.freeze({ reload: host.loadConnections });
    window.agentSetupUi = Object.freeze({ open: (agent: string) => { void host.openSetup(agent); } });
    const customOpen = () => setSheet("custom"), customClose = () => setSheet(null);
    window.addEventListener("sources-custom-open", customOpen); window.addEventListener("sources-custom-close", customClose);
    return () => {
      delete window.sourcesUi; delete window.sourceConnectionsUi; delete window.agentSetupUi;
      window.removeEventListener("sources-custom-open", customOpen); window.removeEventListener("sources-custom-close", customClose);
    };
  }, [host, insights]);
  // Entering the page reads the saved state, installers, connections and the configuration selections.
  useEffect(() => {
    if (!active) return;
    void host.load(); void host.loadInstallers(); void host.loadConnections(); void host.loadConfig().catch(() => {});
    const changed = () => { void host.loadConnections(); }, timer = setInterval(changed, 30000);
    window.addEventListener("source-connections-invalidated", changed); window.addEventListener("source-catalog", changed);
    return () => { clearInterval(timer); window.removeEventListener("source-connections-invalidated", changed); window.removeEventListener("source-catalog", changed); };
  }, [active, host]);
  // A focus request (from attention, the usage page or settings) scrolls to that Agent once it is drawn.
  useEffect(() => {
    if (!active || !focus || state.busy) return;
    const row = root.current?.querySelector<HTMLElement>(`[data-source-agent="${CSS.escape(focus)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "center" });
    row.querySelector<HTMLButtonElement>("[data-source-paths] button")?.focus({ preventScroll: true });
    setFocus(null);
  }, [active, focus, state.busy, state.discovery]);
  // openAttention(kind) from elsewhere chooses the filter through the insights state.
  const requested = insights.get().kind;
  useEffect(() => { if (requested) { setKind(requested); setExpanded(false); } }, [requested]);
  // Each Agent's last 14 days from saved rows: what it read today and whether it has gone quiet.
  const days = useMemo(() => {
    const rows = usage?.rows ?? [], today = usage?.today ?? null, totals = new Map<string, Map<string, number>>();
    for (const row of rows) { const own = totals.get(row.agent) ?? new Map<string, number>(); own.set(row.date, (own.get(row.date) ?? 0) + row.totalTokens); totals.set(row.agent, own); }
    const dates = today ? Array.from({ length: DAYS }, (_, index) => { const at = new Date(today + "T12:00:00Z"); at.setUTCDate(at.getUTCDate() - DAYS + 1 + index); return at.toISOString().slice(0, 10); }) : [];
    return { today, spark: (agent: string) => dates.map(date => totals.get(agent)?.get(date) ?? null), of: (agent: string) => today ? totals.get(agent)?.get(today) ?? null : null };
  }, [usage]);

  const all = state.discovery?.sources ?? [], enabled = all.filter(source => source.enabled).length;
  const items = insights.items() ?? [], visible = items.filter(item => showAcknowledged || !item.acknowledged), open = items.filter(item => !item.acknowledged);
  const filters = kinds.filter(([value]) => value === "all" || visible.some(item => item.kind === value));
  const chosen = filters.some(([value]) => value === kind) ? kind : "all", filtered = visible.filter(item => chosen === "all" || item.kind === chosen);
  const omitted = insights.omitted(), status = insights.get();
  const notice = model.sourceNotice(state), groups = model.attentionGroups(items);
  const generalItems = filtered.filter(item => !item.agent), agentItems = filtered.filter(item => item.agent);
  const ids = Object.keys(host.catalog());
  // Each source in the one section that says what it needs.
  const read = (id: string) => (state.statuses?.find(status => status.agent === id)?.observedRecords ?? 0) > 0;
  const needs = (id: string) => (groups.cards[id] ?? []).some(row => row.kind !== "accept"), broken = (id: string) => (groups.cards[id] ?? []).some(row => row.kind === "accept");
  const sections = [
    { key: "attention", title: "要处理的来源", ids: ids.filter(needs) },
    { key: "accept", title: "有无法修复的记录", ids: ids.filter(id => !needs(id) && broken(id)) },
    { key: "reading", title: "正常读取", ids: ids.filter(id => !needs(id) && !broken(id) && read(id)) },
    { key: "quiet", title: "还没有记录", ids: ids.filter(id => !needs(id) && !broken(id) && !read(id)) },
  ].filter(section => section.ids.length);

  return <div ref={root} className="flex flex-col gap-6" data-sources-page data-ready={Boolean(state.discovery)}>
    <div data-source-summary>
      <PageHeader title="Agent 管理" description={tab === "sources" ? model.sourceSummary(state, !host.demo) : undefined} actions={tab === "sources" ? <div className="flex flex-wrap items-center gap-2">
        <span data-source-refresh><IconButton icon={IconRefresh} label="重新检查" disabled={state.busy || Boolean(state.collection?.collecting)} onClick={() => { void host.load(true); }} /></span>
        {!host.demo && host.available ? <Button variant="tertiary" onClick={() => { setSheet("install"); void host.loadInstallers(); }}>{"安装与更新"}</Button> : null}
        {!host.demo && host.available ? <Button variant="primary" leadingIcon={IconPlus} onClick={() => { void host.openCustom(); }}>{"添加我的 Agent"}</Button> : null}
      </div> : undefined} />
    </div>
    <Segmented value={tab} onChange={setTab} aria-label="Agent 管理分类" items={[
      { value: "sources" as const, label: "用量来源" + (open.length ? " " + open.length : "") },
      ...ADMIN_SECTIONS.map(item => ({ value: item.value, label: item.label + (admin.state?.inventory && item.value !== "history" ? " " + admin.counts[item.value].total : "") })),
    ]} />
    {notice || state.retry ? <div role="status" data-source-notice>
      <Banner tone={state.stale ? "warn" : "info"} action={state.retry ? <Button variant="tertiary" disabled={state.busy} onClick={() => { void host.retry(); }}>
        {state.stale && state.message.includes("已保存") ? "重试检查" : "重试操作"}</Button> : undefined}>{notice}</Banner>
    </div> : null}
    {tab !== "sources" ? <AgentsTab section={tab} admin={admin} /> : <>
    <section id="sourcesAttentionSection" className="flex flex-col gap-3" data-source-attention>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 tabIndex={-1} data-attention-heading className="flex items-baseline gap-2 text-title font-semibold text-foreground outline-none">
          {"需要处理"}{open.length ? <span className="text-subtitle text-warn">{(omitted.general || omitted.budget ? "已返回 " : "") + open.length + " 项"}</span> : null}
        </h2>
        <Switch label="显示已知悉" checked={showAcknowledged} onChange={setShowAcknowledged} disabled={status.busy} />
      </div>
      {generalItems.length || !agentItems.length ? <Card>
        <div className="flex flex-col gap-1" data-attention-list>
          {generalItems.map(item => <AttentionRow key={item.id} item={item} status={status} insights={insights} />)}
          {!generalItems.length && !agentItems.length ? <EmptyState message={!insights.items() ? "正在读取诊断…" : omitted.general || omitted.budget ?
            "当前已返回的列表中没有待处理事项；仍有事项未返回，不能确认全部状态。" : items.length ? "事项均已知悉；底层问题修复后才会退出列表。" : "没有需要处理的事项。"} /> : null}
        </div>
      </Card> : null}
      {agentItems.length ? <Disclosure open={allOpen} onOpenChange={setAllOpen} summary={<span className="text-body text-foreground" data-attention-all>{"各来源的事项 " + agentItems.length + " 项"}</span>}>
        <div className="flex flex-col gap-3">
          {filters.length > 2 ? <Segmented value={chosen} onChange={value => { setKind(value); setExpanded(false); }} aria-label="事项类别"
            items={filters.map(([value, label]) => ({ value, label: label + " " + (value === "all" ? visible.length : visible.filter(item => item.kind === value).length) }))} /> : null}
          <div className="flex flex-col gap-1">{(expanded ? agentItems : agentItems.slice(0, SHOWN)).map(item => <AttentionRow key={item.id} item={item} status={status} insights={insights} />)}</div>
          {agentItems.length > SHOWN ? <div><Button variant="tertiary" onClick={() => setExpanded(!expanded)}>{expanded ? "收起" : "显示全部 " + agentItems.length + " 项"}</Button></div> : null}
        </div>
      </Disclosure> : null}
      {omitted.general ? <p className="text-caption text-muted-foreground" data-attention-omitted="general">{"诊断总量超过返回上限，另有 " + omitted.general + " 项未返回。"}</p> : null}
      {omitted.budget ? <p className="text-caption text-muted-foreground" data-attention-omitted="budget">{"预算事项超过返回上限，另有 " + omitted.budget + " 项未返回。"}</p> : null}
      {status.error || status.message ? <p className="text-caption text-muted-foreground" role={status.error ? "alert" : "status"}>{status.error || status.message}</p> : null}
    </section>

    <section className="flex flex-col gap-4" data-source-rows>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-title font-semibold text-foreground">全部来源</h2>
        {host.available ? <span data-source-bulk><Button variant="tertiary" size="compact" disabled={state.busy || !all.length} onClick={() => { void host.change("all", null, enabled !== all.length); }}>{enabled === all.length && all.length ? "全部停用" : "全部读取"}</Button></span> : null}
      </div>
      <div className="ff-grid-cards grid gap-4">
        {sections.flatMap((section, index) => [
          <h3 key={"heading-" + section.key} className={"col-span-full text-subtitle font-semibold text-foreground " + (index ? "pt-2" : "")} data-source-heading={section.key}>{section.title} <span className="font-normal text-muted-foreground">{section.ids.length}</span></h3>,
          ...section.ids.map(id => { const today = days.of(id); return <SourceCard key={id} id={id} section={section.key} issues={groups.cards[id] ?? []} spark={days.spark(id)} today={today === null ? "今天没有记录" : "今天 " + compact(today) + " Token"}
            pathsOpen={paths.includes(id)} capOpen={caps.includes(id)} togglePaths={() => toggle(setPaths, id)} toggleCap={() => toggle(setCaps, id)} changePath={(action, agent, path) => void changePath(action, agent, path)} onDemo={agent => { setDemoAgent(agent); setSheet("demo"); }} />; }),
        ])}
      </div>
    </section>

    <section className="flex flex-col gap-3" data-source-traces>
      <SectionHeader title="已发现 · 暂不支持" />
      <Card>
        {state.discovery?.unsupported.length ? <div className="flex flex-col gap-2">{state.discovery.unsupported.map(trace => <div key={trace.id} className="flex min-h-9 flex-wrap items-center gap-3">
          <span className="text-body font-semibold text-foreground">{trace.name}</span>
          <span className="break-all font-mono text-caption text-muted-foreground">{trace.markers.map(marker => marker.replaceAll("/", "\\")).join("、")}</span>
        </div>)}</div> : <EmptyState message={state.discovery ? "没有发现其他 Agent 的目录。" : "检查读取位置后显示。"} />}
      </Card>
    </section>
    </>}
    <SourceSheets sheet={sheet} setSheet={setSheet} demoAgent={demoAgent} />
  </div>;
}
