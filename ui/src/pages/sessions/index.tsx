import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { IconColumns2, IconFolderPlus, IconPin, IconScale, IconX } from "@tabler/icons-react";
import { ActionBar, AgentFilter, Button, Card, EmptyState, FoldList, IconButton, Menu, PageHeader, SearchField, Segmented, Select, Sheet, SlideIn, TextField, Value, ViewContent } from "@ui/kit";
import { createSessionsModel, getGlobals, useSessionsHost, useViewActive, type SessionGroup, type SessionGrouping, type SessionRange, type SessionRow, type SessionSort } from "@ui/data";
import { useInsightsHost } from "@ui/data/insights-host";
import { columns, Estimate, projectGroup } from "./rows";
import { SessionDetail } from "./detail";
import { SessionReader } from "./reader";
import { ContentSearch } from "./search";

const ranges: { value: SessionRange; label: string }[] = [
  { value: "today", label: "今天" }, { value: "7", label: "7 天" }, { value: "30", label: "30 天" }, { value: "all", label: "全部" },
];
const groupings: { value: SessionGrouping; label: string }[] = [{ value: "project", label: "按项目" }, { value: "time", label: "按时间" }, { value: "collection", label: "按分组" }];
const sorts: { value: SessionSort; label: string }[] = [
  { value: "recent", label: "按最近" }, { value: "cost", label: "按成本" }, { value: "tokens", label: "按 Token" },
];
type SearchScope = "sessions" | "content";
const scopes: { value: SearchScope; label: string }[] = [{ value: "sessions", label: "会话" }, { value: "content", label: "对话内容" }];

// M5 (owner 2026-10-29), refocused on reading (owner 2026-11-02): range in the page's title row, one search
// box over sessions or conversation text, Agent picker with grouping and sort, then one card that starts
// with the summary line. A row opens its conversation. Figures, groups and wording come from sessions-model.js.
export function SessionsPage() {
  const host = useSessionsHost(), data = host.get(), insights = useInsightsHost(), catalog = getGlobals().agentCatalog.agents;
  const active = useViewActive("sessions");
  const [agent, setAgent] = useState("all"), [range, setRange] = useState<SessionRange>("today");
  const [sort, setSort] = useState<SessionSort>("recent"), [query, setQuery] = useState(""), [scope, setScope] = useState<SearchScope>("sessions"), [grouping, setGrouping] = useState<SessionGrouping>("project");
  const [opened, setOpened] = useState(new Set<string>()), [drawers, setDrawers] = useState(new Set<string>()), [touched, setTouched] = useState(false);
  const [selected, setSelected] = useState<{ session: SessionRow; group: SessionGroup } | null>(null);
  // The phrase being searched in conversation text. A scan reads files, so it starts on the person's Enter or
  // scope choice rather than on each key, and its results stay until the next one.
  const [content, setContent] = useState<string | null>(null);
  // Several sessions picked to act on together, and a group being named.
  const [picking, setPicking] = useState(false), [picked, setPicked] = useState(new Map<string, SessionRow>());
  const [naming, setNaming] = useState<{ from: string | null; keys: string[] } | null>(null), [groupName, setGroupName] = useState("");
  const drill = useRef(0), listTop = useRef(0), wasReading = useRef(false);
  // The reading view replaces the detail card rather than stacking a second dialog on it.
  useEffect(() => { if (data.reading) setSelected(null); }, [data.reading?.key]);
  // Reading and back: the list returns where it was, with focus on the row that opened the conversation.
  const readingKey = data.reading?.key ?? null, away = Boolean(readingKey), lastKey = useRef<string | null>(null);
  if (away && !wasReading.current) listTop.current = document.scrollingElement?.scrollTop ?? 0;
  useLayoutEffect(() => {
    if (readingKey) lastKey.current = readingKey;
    if (away) { wasReading.current = true; return; }
    if (!wasReading.current) return;
    const root = document.querySelector('[data-sessions-page]'); if (!root) return;
    // Restore against the browser's completed layout, before paint. Doing it
    // inside the mount commit synchronously laid out the entire new list.
    const observer = new ResizeObserver(() => {
      observer.disconnect();
      if (document.scrollingElement) document.scrollingElement.scrollTop = listTop.current;
      root.querySelector<HTMLElement>('[data-session="' + lastKey.current + '"] [data-session-name] button')?.focus({ preventScroll: true });
      wasReading.current = false;
    });
    observer.observe(root); return () => observer.disconnect();
  }, [readingKey, away, active]);
  useEffect(() => { if(active) void host.load(range); }, [host, range, active]);
  const listQuery = scope === "sessions" ? query : "";
  const model = useMemo(() => createSessionsModel({ list: data.list, agent, range, sort, query: listQuery, group: grouping, labels: data.labels }), [data.list, agent, range, sort, listQuery, grouping, data.labels]);
  const summary = useMemo(() => active ? model.pageSummary() : null, [model, active]), list = summary?.list ?? [];
  // The first project starts open until the person folds or opens something themselves.
  const isOpen = (id: string) => opened.has(id) || !touched && !opened.size && list[0]?.id === id;
  const reset = () => { setOpened(new Set()); setDrawers(new Set()); setTouched(false); };
  useEffect(() => {
    const request = data.drill;
    if (!request || request.seq === drill.current) return;
    drill.current = request.seq;
    if (request.agent === "all" || catalog[request.agent]) setAgent(request.agent);
    if (ranges.some(item => item.value === request.range)) setRange(request.range as SessionRange);
    if (typeof request.query === "string") { setQuery(request.query); setScope("sessions"); setContent(null); }
    reset();
  }, [data.drill, catalog]);
  // Hidden: nothing is derived or drawn; the same ViewContent keeps the first-visit state across visits.
  if (!active || !summary) return <ViewContent active={false}>{null}</ViewContent>;
  const toggle = (id: string, open: boolean) => {
    setOpened(previous => {
      const next = new Set(previous);
      if (!touched && !previous.size && list[0]) next.add(list[0].id);
      if (open) next.add(id); else next.delete(id);
      return next;
    });
    setTouched(true);
  };
  const allOpen = list.length > 0 && list.every(group => isOpen(group.id));
  const notice = insights.notices("sessions"), status = insights.get();
  const chooseScope = (next: SearchScope) => { setScope(next); setContent(next === "content" && query.trim() ? query.trim() : null); reset(); };
  const searchKey = (event: KeyboardEvent<HTMLDivElement>) => { if (scope === "content" && event.key === "Enter" && !event.nativeEvent.isComposing && query.trim()) { event.preventDefault(); setContent(query.trim()); } };
  if (data.reading) return <ViewContent active><SlideIn key="reader" from="right"><SessionReader siblings={list.flatMap(group => group.sessions).filter(session => host.readable(session.agent))} /></SlideIn></ViewContent>;
  const stopPicking = () => { setPicking(false); setPicked(new Map()); };
  const chosen = [...picked.values()], readable = chosen.filter(session => host.readable(session.agent));
  const each = async (patch: Parameters<typeof host.label>[1], keys = chosen.map(session => session.key)) => { for (const key of keys) await host.label(key, patch); };
  const allPinned = chosen.length > 0 && chosen.every(session => data.labels[session.key]?.pinned);
  const names = model.collections().map(item => item.name);
  const saveName = async () => {
    const name = groupName.trim().slice(0, 40); if (!name || !naming) return;
    if (naming.from) await host.renameGroup(naming.from, name); else { await each({ group: name }, naming.keys); stopPicking(); }
    setNaming(null); setGroupName("");
  };

  return <ViewContent active><SlideIn key="list" from="left" skip={!wasReading.current}><div className="flex flex-col gap-4" data-sessions-page data-ready={Boolean(data.list) || host.snapshotOnly || data.error}>
    <PageHeader title="会话" actions={<Segmented value={range} onChange={value => { setRange(value); reset(); }} items={ranges} aria-label="会话时间范围" />} />
    {status.error || status.message ? <p className="text-caption text-muted-foreground" role={status.error ? "alert" : "status"} data-session-insight-status>{status.error || status.message}</p> : null}
    <div className="flex flex-col gap-3" data-session-filters>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-64 flex-1" data-session-search onKeyDown={searchKey}>
          <SearchField variant="filled" value={query} onChange={value => { setQuery(value.slice(0, 120)); if (!value.trim()) setContent(null); }} maxLength={120}
            placeholder={scope === "content" ? "搜索对话内容，回车开始" : "搜索名称、项目、目录、模型或会话 ID"} aria-label={scope === "content" ? "搜索对话内容" : "搜索会话"} />
        </div>
        {host.snapshotOnly ? null : <div data-session-search-scope><Segmented value={scope} onChange={chooseScope} items={scopes} aria-label="搜索范围" /></div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AgentFilter display="icon" aria-label="会话 Agent 筛选" value={agent} onChange={id => { setAgent(id); reset(); }}
          agents={Object.entries(catalog).map(([id, meta]) => ({ id, name: meta.name, recorded: Boolean(data.list?.sessions.some(session => session.agent === id)) }))} />
        {content ? null : <div className="flex flex-wrap items-center gap-3">
          <Segmented value={grouping} onChange={value => { setGrouping(value); reset(); }} items={groupings} aria-label="会话分组" />
          <div data-session-sort><Select value={sort} onChange={setSort} options={sorts} aria-label="会话排序" /></div>
        </div>}
      </div>
    </div>
    {content && data.list ? <Card><ContentSearch phrase={content} range={range} agent={agent} rangeLabel={summary.label + " · " + summary.agent} sessions={data.list.sessions} onClose={() => { setContent(null); setScope("sessions"); setQuery(""); }} /></Card> : null}
    {content && data.list ? null : <Card>
      {data.list && !host.snapshotOnly ? <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-caption text-muted-foreground" role="status" data-session-summary>
        <b className="font-semibold text-foreground">{summary.sessions}</b>{" 个会话 · "}
        {grouping === "project" ? <><b className="font-semibold text-foreground">{list.filter(group => group.kind === "project").length}</b>{" 个项目 · "}</> : null}<Value value={summary.tokens} />{" Token · "}<Estimate value={summary.estimate} />
        {summary.missing ? <span title="这些记录在来源里没有会话标识，只计入用量页">{" · 另有 " + summary.missing + " 条记录无会话标识"}</span> : null}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {notice.count ? <span className="flex items-center gap-2 text-caption text-muted-foreground" data-session-notice>
          {notice.text}<Button variant="tertiary" size="compact" onClick={() => insights.openAttention("sessions")}>{"在Agent 管理中处理"}</Button>
        </span> : null}
        {list.length ? <span data-session-pick><Button variant={picking ? "primary" : "secondary"} size="compact" onClick={() => picking ? stopPicking() : setPicking(true)}>{picking ? "完成" : "选择"}</Button></span> : null}
        {list.length ? <Button variant="secondary" size="compact" onClick={() => { setTouched(true); setOpened(allOpen ? new Set() : new Set(list.map(group => group.id))); }}>
          {allOpen ? "全部折叠" : "全部展开"}
        </Button> : null}
      </div>
    </div> : null}
      <div data-session-groups>
        {host.snapshotOnly ? <EmptyState message="这个统计快照不包含会话列表；会话只在桌面应用里显示。" /> :
          data.error && !data.list ? <EmptyState message="会话列表读取失败，稍后会随下一次采集重试。" /> :
          !data.list ? <EmptyState message="正在读取会话…" /> :
          !list.length ? <EmptyState message={listQuery ? "没有匹配“" + listQuery + "”的会话。" : summary.label + "没有会话记录。"}
            action={listQuery ? <Button variant="tertiary" onClick={() => setQuery("")}>{"清空搜索条件"}</Button> : undefined} /> :
          <FoldList aria-label={grouping === "time" ? "按时间分组的会话" : "按项目分组的会话"} columns={columns} groups={list.map(group => projectGroup({
            group, model, open: isOpen(group.id), onOpenChange: open => toggle(group.id, open),
            drawer: drawers.has(group.id), readable: session => host.readable(session.agent), onDetail: session => setSelected({ session, group }),
            picking: picking ? { has: key => picked.has(key), toggle: session => setPicked(previous => { const next = new Map(previous); if (next.has(session.key)) next.delete(session.key); else next.set(session.key, session); return next; }) } : null,
            onRenameGroup: name => { setGroupName(name); setNaming({ from: name, keys: [] }); }, onDissolveGroup: name => { void host.renameGroup(name, null); },
            onOpen: session => { if (host.readable(session.agent)) host.read(session); else setSelected({ session, group }); },
            onDrawer: open => setDrawers(previous => { const next = new Set(previous); if (open) next.add(group.id); else next.delete(group.id); return next; }),
          }))} />}
      </div>
    </Card>}
    <ActionBar open={picking && chosen.length > 0} aria-label="选中的会话">
      <span className="px-2 text-caption tabular-nums text-muted-foreground" role="status" data-session-picked>{"已选 " + chosen.length + " 个"}</span>
      <span title={readable.length < 2 ? "选两到三个能阅读的会话" : readable.length > 3 ? "最多并排三个" : undefined} data-session-side-by-side><Button variant="secondary" size="compact" leadingIcon={IconColumns2} disabled={readable.length < 2 || readable.length > 3} onClick={() => { host.read(readable[0]); for (const session of readable.slice(1)) host.readAlso(session); stopPicking(); }}>{"并排阅读"}</Button></span>
      <span title={!readable.length ? "至少选一个能阅读的会话" : chosen.length < 2 ? "选两到三个会话" : chosen.length > 3 ? "最多对比三个" : undefined} data-session-compare-open><Button variant="secondary" size="compact" leadingIcon={IconScale} disabled={!readable.length || chosen.length < 2 || chosen.length > 3} onClick={() => { const first = readable[0]; host.read(first); host.compare(chosen.filter(session => session.key !== first.key).map(session => session.key)); stopPicking(); }}>{"对比"}</Button></span>
      <span data-session-move><Menu trigger={<Button variant="secondary" size="compact" leadingIcon={IconFolderPlus} onClick={() => {}}>{"移到分组"}</Button>} items={[
        ...names.map(name => ({ label: name, onSelect: () => { void each({ group: name }).then(stopPicking); } })),
        { label: "新建分组…", onSelect: () => { setGroupName(""); setNaming({ from: null, keys: chosen.map(session => session.key) }); } },
        { label: "移出分组", onSelect: () => { void each({ group: null }).then(stopPicking); } },
      ]} /></span>
      <span data-session-pin-picked><Button variant="secondary" size="compact" leadingIcon={IconPin} onClick={() => { void each({ pinned: !allPinned }).then(stopPicking); }}>{allPinned ? "取消置顶" : "置顶"}</Button></span>
      <IconButton icon={IconX} size="compact" label="取消选择" onClick={stopPicking} />
    </ActionBar>
    <Sheet open={Boolean(naming)} onOpenChange={open => { if (!open) setNaming(null); }} size="sm" title={naming?.from ? "重命名分组" : "新建分组"} footer={<div className="flex justify-end gap-2" data-session-group-sheet>
      <Button variant="tertiary" onClick={() => setNaming(null)}>{"取消"}</Button>
      <Button variant="primary" disabled={!groupName.trim()} onClick={() => { void saveName(); }}>{"保存"}</Button>
    </div>}><TextField label="分组名称" value={groupName} onChange={setGroupName} maxLength={40} /></Sheet>
    <SessionDetail selected={selected} model={model} onClose={() => setSelected(null)} />
  </div></SlideIn></ViewContent>;
}
