import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { AgentMark, EmptyState, OutlineNav, SearchField, Sheet } from "@ui/kit";
import { createSessionsModel, getGlobals, showView, useSessionsHost, type SessionRow } from "@ui/data";

// Ctrl+K from anywhere (owner 2026-11-02, docs/m2/UI-QUICK-SWITCH-20261102.md): a session, a project or a page, by name, with the
// keyboard alone. Enter goes there; Ctrl+Enter opens a session beside the conversation being read. It looks at names only, never
// inside a conversation, and lets the list go when it closes.
type Entry = { key: string; kind: "session" | "project" | "page"; label: string; meta?: string; agent?: string; before?: string; run: (beside: boolean) => void };
const PAGES: { view: "quota" | "usage" | "cost" | "sessions" | "sources" | "settings"; label: string }[] = [
  { view: "quota", label: "概览" }, { view: "usage", label: "用量" }, { view: "cost", label: "费用" }, { view: "sessions", label: "会话" }, { view: "sources", label: "Agent 管理" }, { view: "settings", label: "设置" },
];
const RECENT = 8, SESSIONS = 30, PROJECTS = 6;

function Switcher({ onClose }: { onClose: () => void }) {
  const host = useSessionsHost(), data = host.get(), agents = getGlobals().agentCatalog.agents, [query, setQuery] = useState(""), [at, setAt] = useState(0), needle = query.trim().toLowerCase();
  // The dialog surface can survive a quick close/reopen during its exit spring.
  // Its mount autofocus then does not run again, but this new search body does.
  const focusSearch = useCallback((node: HTMLDivElement | null) => { node?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }); }, []);
  useEffect(() => host.holdAll(), []);
  const list = data.all ?? data.list;
  const model = useMemo(() => createSessionsModel({ list, agent: "all", range: "all", sort: "recent", query: "", group: "time", labels: data.labels }), [list, data.labels]);
  const sessions = useMemo(() => model.groups().flatMap(group => group.sessions).sort((a, b) => b.end.localeCompare(a.end)), [model]);
  const openSession = (session: SessionRow, beside: boolean) => {
    onClose(); showView("sessions");
    if (!host.readable(session.agent)) { host.read(null); host.drillDown(session.agent, "all", session.name || session.project || ""); return; }
    if (beside && host.get().reading) host.readAlso(session); else host.read(session);
  };
  const entries = useMemo<Entry[]>(() => {
    const has = (...values: (string | null | undefined)[]) => !needle || values.some(value => value?.toLowerCase().includes(needle));
    const found = sessions.filter(session => has(session.name, session.title, session.project, session.cwd, session.id, agents[session.agent]?.name, ...session.models)).slice(0, needle ? SESSIONS : RECENT);
    const projects = new Map<string, { name: string; count: number }>();
    for (const session of sessions) if (session.project && session.cwd && has(session.project, session.cwd)) { const entry = projects.get(session.cwd.toLowerCase()) ?? { name: session.project, count: 0 }; entry.count++; projects.set(session.cwd.toLowerCase(), entry); }
    const rows: Entry[] = found.map((session, index) => ({ key: "s:" + session.key, kind: "session", agent: session.agent, before: index ? undefined : needle ? "会话" : "最近的会话", label: session.name || session.project || model.span(session), meta: (agents[session.agent]?.name ?? session.agent) + (session.project && session.name ? " · " + session.project : "") + " · " + model.span(session), run: beside => openSession(session, beside) }));
    if (needle) [...projects.values()].slice(0, PROJECTS).forEach((project, index) => rows.push({ key: "p:" + project.name + index, kind: "project", before: index ? undefined : "项目", label: project.name, meta: project.count + " 个会话", run: () => { onClose(); showView("sessions"); host.read(null); host.drillDown("all", "all", project.name); } }));
    PAGES.filter(page => has(page.label)).forEach((page, index) => rows.push({ key: "v:" + page.view, kind: "page", before: index ? undefined : "页面", label: page.label, run: () => { onClose(); if (page.view === "sessions") host.read(null); showView(page.view); } }));
    return rows;
  }, [sessions, needle]);
  useEffect(() => { setAt(0); }, [needle]);
  const current = entries[Math.min(at, entries.length - 1)];
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setAt(value => (value + 1) % Math.max(1, entries.length)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setAt(value => (value - 1 + entries.length) % Math.max(1, entries.length)); }
    else if (event.key === "Enter" && current) { event.preventDefault(); current.run(event.ctrlKey || event.metaKey); }
  };
  return <div ref={focusSearch} className="flex min-h-0 flex-col gap-3" data-quick-switch onKeyDown={keyDown}>
    <SearchField value={query} onChange={value => setQuery(value.slice(0, 120))} maxLength={120} placeholder="搜索会话、项目或页面" aria-label="搜索会话、项目或页面" />
    {entries.length ? <OutlineNav fill={false} aria-label="结果" active={current?.key ?? null} onSelect={key => entries.find(entry => entry.key === key)?.run(false)}
      items={entries.map(entry => ({ key: entry.key, label: entry.label, meta: entry.meta, before: entry.before, lead: entry.agent ? <AgentMark agent={entry.agent} variant="icon" size={16} /> : undefined }))} /> : <EmptyState message={"没有匹配“" + query.trim() + "”的内容。"} />}
  </div>;
}
export function QuickSwitch() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k" && !event.isComposing) { event.preventDefault(); setOpen(value => !value); } };
    const ask = () => setOpen(true);
    window.addEventListener("keydown", key); window.addEventListener("quick-switch", ask);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("quick-switch", ask); };
  }, []);
  return <Sheet open={open} onOpenChange={setOpen} size="lg" scrollable title="快速切换">{open ? <Switcher onClose={() => setOpen(false)} /> : null}</Sheet>;
}
