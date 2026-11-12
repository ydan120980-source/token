import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { IconClock, IconColumns2, IconDots, IconFilter2, IconFolder, IconFolderOpen, IconListTree, IconMessages, IconPinFilled } from "@tabler/icons-react";
import { AgentFilter, AgentMark, Collapse, EmptyState, IconButton, Marquee, Menu, SearchField, Segmented, SideRow, StatusDot, TipCard, useHoverCard, Value } from "@ui/kit";
import { createSessionsModel, getGlobals, useSessionsHost, type SessionGroup, type SessionRow, type SessionsViewModel } from "@ui/data";
import { Estimate } from "./rows";

// The reading page's left column (owner 2026-11-04, UI-READER-NAV-20261104.md): the outline, or the other sessions, chosen at its
// top. The sessions read like Codex's sidebar: folders of projects that fold, the first few sessions and "展开显示", the
// current one lit; each session keeps its Agent's logo, when it last moved and what it used; one menu button takes the time's place when pointed at, so the name keeps its width.
export type NavTab = "outline" | "sessions";
const PREVIEW = 5, PROJECTS = 30, OPEN_AT_FIRST = 6;
// What was folded, for this run only: the paths behind these keys are not written anywhere new.
const folded = new Map<string, boolean>(), widened = new Set<string>();

const groupIcon = (group: SessionGroup, open: boolean) => {
  const Icon = group.kind === "pinned" ? IconPinFilled : group.kind === "time" ? IconClock : open ? IconFolderOpen : IconFolder;
  return <Icon size={16} className="text-muted-foreground" aria-hidden />;
};
const Row = memo(function Row({ session, group, model, current, elsewhere, canAdd, onOpen, onBeside, onPress, bind }: { session: SessionRow; group: SessionGroup; model: SessionsViewModel; current: boolean; elsewhere: boolean; canAdd: boolean; onOpen: (session: SessionRow) => void; onBeside: (session: SessionRow) => void; onPress: (event: PointerEvent<Element>, session: SessionRow) => void; bind: ReturnType<typeof useHoverCard>["bind"] }) {
  // A session without a name reads as its time under its project, and as its project in a list by time.
  const host = window.sessionsHost, view = model.sessionView(session, group), name = session.name || (group.kind === "project" ? view.time : session.project || view.time);
  // The row says the time today and the date before that; the card has the rest.
  const when = view.ended.split(" ")[0];
  const card = <TipCard title={name} aside={view.meta.name} note={view.timeTip} rows={[
    ...(session.project && session.project !== name ? [{ key: "project", label: "项目", value: session.project }] : []),
    ...(view.models.length ? [{ key: "model", label: "模型", value: view.models[0] + (view.models.length > 1 ? " +" + (view.models.length - 1) : "") }] : []),
    { key: "tokens", label: "Token", value: <Value value={view.tokens} /> },
    { key: "cost", label: "估算", value: <Estimate value={view.estimate} /> },
  ]} />;
  return <SideRow selected={current} onClick={() => onOpen(session)} aria-label={name + "，" + view.meta.name + "，" + view.ended} attributes={{ "data-nav-open": session.key }} rowProps={{ ...bind(session.key, card, "right"), onPointerDown: event => onPress(event, session), "data-nav-session": session.key }}
    lead={<AgentMark agent={session.agent} variant="icon" size={16} />}
    tail={<>{session.pinned ? <IconPinFilled size={12} aria-label="已置顶" data-nav-pinned /> : null}{elsewhere ? <IconColumns2 size={12} aria-label="已在旁边打开" data-nav-elsewhere /> : null}<span data-nav-time>{when}</span></>}
    below={<span className="flex min-w-0 items-center gap-1 whitespace-nowrap text-micro text-muted-foreground" data-nav-meta>
      {view.isRecent ? <StatusDot tone="active" label="活跃：最近 1 小时内有活动" /> : null}
      <span className="tabular-nums"><Value value={view.tokens} /></span><span aria-hidden>{"·"}</span><span className="tabular-nums"><Estimate value={view.estimate} /></span>
      {view.badge ? <><span aria-hidden>{"·"}</span><span className="truncate tabular-nums">{view.badge}</span></> : null}
    </span>}
    actions={<span data-nav-menu><Menu trigger={<IconButton icon={IconDots} size="compact" label={name + " 的操作"} onClick={() => {}} />} items={[
      { label: session.pinned ? "取消置顶" : "置顶", onSelect: () => { void host.label(session.key, { pinned: !session.pinned }); } },
      ...(current || elsewhere ? [] : [{ label: canAdd ? "并排打开" : "并排打开（窗口放不下）", disabled: !canAdd, onSelect: () => onBeside(session) }]),
    ]} /></span>}>
    <span className="font-medium"><Marquee text={name} title="" /></span>
  </SideRow>;
});
/** The other sessions, as a list to go to: a click reads it here, the action beside it opens it next to this one, holding it places it. */
export const SessionNav = memo(function SessionNav({ current, open, canAdd, ask, onOpen, onBeside, onFocusOpen, onPress }: { current: string; open: string; canAdd: boolean; ask: number; onOpen: (session: SessionRow) => void; onBeside: (session: SessionRow) => void; onFocusOpen: (key: string) => void; onPress: (event: PointerEvent<Element>, session: SessionRow) => void }) {
  const host = useSessionsHost(), data = host.get(), list = data.all ?? data.list, root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(""), needle = query.trim(), [agent, setAgent] = useState("all"), [by, setBy] = useState<"project" | "time">("project"), [filters, setFilters] = useState(false), [, redraw] = useState(0), [projects, setProjects] = useState(PROJECTS);
  const { bind, layer } = useHoverCard();
  // A card's transient owner changes on hover. Rows keep their data/handlers;
  // events consult the current binding so pointer moves and Escape never use
  // an old active-card snapshot while the full list stays out of that update.
  const liveBind = useRef(bind);
  useLayoutEffect(() => { liveBind.current = bind; });
  const bindRow = useCallback<typeof bind>((key, content, placement) => ({
    "data-hover-card": key,
    onPointerEnter: event => liveBind.current(key, content, placement).onPointerEnter(event),
    onPointerMove: event => liveBind.current(key, content, placement).onPointerMove(event),
    onPointerLeave: () => liveBind.current(key, content, placement).onPointerLeave(),
    onFocus: event => liveBind.current(key, content, placement).onFocus(event),
    onBlur: () => liveBind.current(key, content, placement).onBlur(),
    onKeyDown: event => liveBind.current(key, content, placement).onKeyDown(event),
  }), []);
  const model = useMemo(() => createSessionsModel({ list, agent, range: "all", sort: "recent", query: needle, group: by, labels: data.labels }), [list, agent, needle, by, data.labels]);
  const groups = useMemo(() => model.groups().map(group => ({ ...group, sessions: group.sessions.filter(session => host.readable(session.agent)) })).filter(group => group.sessions.length), [model]);
  const agents = useMemo(() => { const catalog = getGlobals().agentCatalog.agents, seen = new Set((list?.sessions ?? []).map(session => session.agent)); return [...seen].filter(id => host.readable(id)).map(id => ({ id, name: catalog[id]?.name ?? id, recorded: true })); }, [list]);
  const others = useMemo(() => open ? open.split(",") : [], [open]);
  useEffect(() => { root.current?.querySelector<HTMLElement>('[data-nav-session][data-selected]')?.scrollIntoView({ block: "nearest" }); }, [current, Boolean(list)]);
  useEffect(() => { if (ask) root.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }); }, [ask]);
  const isOpen = (group: SessionGroup, at: number) => Boolean(needle) || (folded.get(group.id) ?? (at < OPEN_AT_FIRST || group.sessions.some(session => session.key === current)));
  const go = useCallback((session: SessionRow) => { if (others.includes(session.key)) onFocusOpen(session.key); else if (session.key !== current) onOpen(session); }, [others, onFocusOpen, onOpen, current]);
  const rows: ReactNode = !list ? <EmptyState message="正在读取会话…" /> : !groups.length ? <EmptyState message={needle || agent !== "all" ? "没有匹配的会话。" : "还没有可以阅读的会话。"} /> :
    groups.slice(0, projects).map((group, at) => {
      const shown = isOpen(group, at), wide = widened.has(group.id) || Boolean(needle), cut = wide ? group.sessions : group.sessions.slice(0, PREVIEW), rest = group.sessions.length - PREVIEW;
      const visible = group.sessions.some(session => session.key === current) && !cut.some(session => session.key === current) ? [...cut, group.sessions.find(session => session.key === current)!] : cut;
      return <div key={group.id} className="flex min-w-0 flex-col" data-nav-group={group.id} data-group-kind={group.kind}>
        <SideRow lead={groupIcon(group, shown)} expanded={shown} onClick={() => { folded.set(group.id, !shown); redraw(count => count + 1); }} tail={group.sessions.length} title={group.cwd ?? group.name} attributes={{ "data-nav-group-head": "" }}>
          <span className="font-medium"><Marquee text={group.name} title="" /></span>
        </SideRow>
        {shown ? visible.map(session => <Row key={session.key} session={session} group={group} model={model} current={session.key === current} elsewhere={others.includes(session.key)} canAdd={canAdd} onOpen={go} onBeside={onBeside} onPress={onPress} bind={bindRow} />) : null}
        {shown && !needle && rest > 0 ? <SideRow onClick={() => { if (wide) widened.delete(group.id); else widened.add(group.id); redraw(count => count + 1); }} attributes={{ "data-nav-more": "" }}>
          <span className="text-muted-foreground">{wide ? "收起" : "展开显示 " + rest + " 个"}</span>
        </SideRow> : null}
      </div>;
    });
  return <div ref={root} className="flex min-h-0 flex-1 flex-col gap-2" data-reader-sessions>
    <div className="flex shrink-0 items-center gap-1">
      <div className="min-w-0 flex-1"><SearchField value={query} onChange={value => setQuery(value.slice(0, 120))} maxLength={120} placeholder="搜索会话…" aria-label="搜索会话" variant="filled" /></div>
      <span title="筛选和分组" data-nav-filter-toggle><IconButton icon={IconFilter2} label="筛选和分组" aria-expanded={filters} onClick={() => setFilters(!filters)} /></span>
    </div>
    <Collapse open={filters} id="reader-nav-filters" aria-label="筛选和分组"><div className="flex flex-col gap-2 p-0.5" data-nav-filters>
      <Segmented size="compact" value={by} onChange={setBy} aria-label="分组方式" items={[{ value: "project", label: "按项目" }, { value: "time", label: "按时间" }]} />
      {agents.length > 1 ? <AgentFilter display="icon" agents={agents} value={agent} onChange={setAgent} aria-label="只看一个 Agent" /> : null}
    </div></Collapse>
    <nav aria-label="其他会话" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden" tabIndex={-1} data-nav-list>
      {rows}
      {groups.length > projects ? <SideRow onClick={() => setProjects(projects + PROJECTS)} attributes={{ "data-nav-more-projects": "" }}><span className="text-muted-foreground">{"再显示 " + Math.min(PROJECTS, groups.length - projects) + " 组（共 " + groups.length + " 组）"}</span></SideRow> : null}
    </nav>
    {layer}
  </div>;
});
/** The column: which of the two it shows, at its top. */
export function ReaderNav({ tab, onTab, outline, sessions }: { tab: NavTab; onTab: (tab: NavTab) => void; outline: ReactNode; sessions: ReactNode }) {
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2" data-reader-nav data-tab={tab}>
    <div className="shrink-0" data-reader-nav-tabs><Segmented size="compact" value={tab} onChange={onTab} aria-label="左栏内容" items={[{ value: "outline", label: "目录", icon: IconListTree }, { value: "sessions", label: "会话", icon: IconMessages }]} /></div>
    {tab === "outline" ? outline : sessions}
  </div>;
}
