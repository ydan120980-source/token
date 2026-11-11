import { useEffect, useMemo, useRef, useState } from "react";
import { AgentMark, Button, OutlineNav } from "@ui/kit";
import { createSessionsModel, getGlobals, useSessionsHost, type SessionFileHit } from "@ui/data";

// Which other sessions changed this file (docs/m2/UI-READER-FILE-HISTORY-20261102.md): their records are scanned when the
// person asks, newest first and a few seconds at a time, and nothing is kept. Only edit tools count, as in the files list.
type Run = { state: "idle" | "loading" | "ready" | "error"; found: SessionFileHit[]; searched: number; total: number; next: number | null };
export function FileHistory({ sessionKey, path, slot, canOpen, ask }: { sessionKey: string; path: string; slot: number; canOpen: boolean; ask: number }) {
  const host = useSessionsHost(), data = host.get(), agents = getGlobals().agentCatalog.agents, list = data.all ?? data.list;
  const [run, setRun] = useState<Run>({ state: "idle", found: [], searched: 0, total: 0, next: 0 }), seq = useRef(0), asked = useRef(ask);
  const batch = (offset: number, previous: SessionFileHit[]) => {
    const id = ++seq.current;
    setRun(current => ({ ...current, state: "loading", found: previous }));
    host.fileHistory({ key: sessionKey, path, offset })
      .then(value => { if (id === seq.current) setRun({ state: "ready", found: [...previous, ...value.results], searched: value.searched, total: value.total, next: value.next }); })
      .catch(() => { if (id === seq.current) setRun(current => ({ ...current, state: "error" })); });
  };
  useEffect(() => { if (ask !== asked.current) { asked.current = ask; batch(0, []); } }, [ask]);
  useEffect(() => () => { seq.current++; }, []);
  const model = useMemo(() => createSessionsModel({ list, agent: "all", range: "all", sort: "recent", query: "", group: "time", labels: data.labels }), [list, data.labels]);
  const rows = useMemo(() => { const sessions = new Map(model.groups().flatMap(group => group.sessions).map(session => [session.key, session])); return run.found.flatMap(hit => { const session = sessions.get(hit.key); return session ? [{ hit, session }] : []; }).sort((a, b) => Number(b.hit.exact) - Number(a.hit.exact)); }, [model, run.found]);
  const open = (key: string) => { const row = rows.find(item => item.hit.key === key); if (!row) return; const session = { ...row.session, file: row.hit.path }; if (canOpen) host.readAlso(session); else host.readInSlot(slot, session); };
  const status = run.state === "error" ? "查找失败，稍后再试" : run.state === "loading" && !run.searched ? "正在查找…" : run.state === "idle" ? "" : rows.length + " 个会话 · 已查 " + run.searched + " / " + run.total;
  return <div className="flex flex-col gap-2 pt-3" data-file-history data-state={run.state}>
    <h4 className="truncate px-2 text-caption font-medium text-foreground" title={path}>{path.split(/[\\/]/).pop()}</h4>
    {run.state === "idle" ? <div className="px-2"><Button variant="secondary" size="compact" onClick={() => batch(0, [])}>{"还有哪些会话改过它"}</Button></div> :
      <p className="px-2 text-caption text-muted-foreground" role="status" aria-live="polite" data-file-history-status>{status}</p>}
    {rows.length ? <OutlineNav fill={false} aria-label="改过这个文件的会话" active={null} onSelect={open} items={rows.map(({ hit, session }) => ({ key: hit.key,
      lead: <AgentMark agent={session.agent} variant="icon" size={16} />, label: session.name || session.project || model.span(session),
      meta: [agents[session.agent]?.name ?? session.agent, model.span(session), "+" + hit.added + " −" + hit.removed, hit.exact ? "" : "其他目录的同路径文件"].filter(Boolean).join(" · ") }))} /> : null}
    {run.next !== null && run.state === "ready" ? <div className="px-2"><Button variant="tertiary" size="compact" onClick={() => batch(run.next!, run.found)}>{"继续查更早的会话"}</Button></div> : null}
  </div>;
}
