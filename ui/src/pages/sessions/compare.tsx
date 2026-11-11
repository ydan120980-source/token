import { useEffect, useMemo, useState, type ReactNode } from "react";
import { IconPlus, IconX } from "@tabler/icons-react";
import { AgentMark, Button, Combobox, CompareGrid, CompareRow, DiffCount, FileMark, IconButton, Marquee, SideRow, StackBar, Value } from "@ui/kit";
import { createSessionsModel, useSessionsHost, type SessionGroup, type SessionRow, type TranscriptFacts } from "@ui/data";
import { Estimate } from "./rows";

// A small comparison in the reading page's right column (owner 2026-11-02, redrawn 2026-11-04 in the density of the change tree):
// this conversation and up to two others, each named with its logo. What the app's saved list knows shows as bars at once; what their
// records say is read when the tab opens and released when it closes. Bars show amounts, never good or bad. docs/m2/UI-READER-NAV-20261104.md
type Read = TranscriptFacts | "reading" | "failed" | "unsupported";
export const COMPARE_OTHERS = 2;
const SUGGESTED = 5;
const parts = [{ key: "inputUncached", label: "输入", tone: "vivid:input" }, { key: "output", label: "输出", tone: "vivid:output" }, { key: "cacheRead", label: "缓存读取", tone: "vivid:read" }, { key: "cacheWrite", label: "缓存写入", tone: "vivid:write" }] as const;

export function useSessionRow(key: string | undefined) {
  const host = useSessionsHost(), data = host.get();
  const list = data.all ?? data.list;
  const model = useMemo(() => createSessionsModel({ list, agent: "all", range: "all", sort: "recent", query: "", group: "project", labels: data.labels }), [list, data.labels]);
  const found = useMemo(() => { const group = key ? model.groupFor(key) : null, session = group?.sessions.find(item => item.key === key); return session && group ? { session, group } : null as { session: SessionRow; group: SessionGroup } | null; }, [model, key]);
  return { model, found };
}
/** Which session: its Agent's logo and its place in the list, because two sessions may have the same Agent. */
function Who({ session, at }: { session: SessionRow; at: number }) {
  return <span className="flex shrink-0 items-center gap-1" data-compare-who={at + 1}><AgentMark agent={session.agent} variant="icon" size={16} /><span className="text-micro tabular-nums text-muted-foreground">{at + 1}</span></span>;
}
/** One amount per session: who, a bar against the largest, the amount. */
function Amounts({ label, rows, attribute }: { label: string; attribute: string; rows: { session: SessionRow; share: number | null; value: ReactNode }[] }) {
  return <div className="flex min-w-0 flex-col gap-1" data-compare-row={attribute}>
    <span className="px-2 text-caption text-muted-foreground">{label}</span>
    {rows.map(({ session, share, value }, at) => <div key={session.key} className="flex min-h-6 min-w-0 items-center gap-2 px-2 text-caption text-foreground" data-compare-amount>
      <Who session={session} at={at} />
      <span className="min-w-0 flex-1">{share === null ? null : <StackBar width="full" height={4} segments={[{ key: session.key, value: share, tone: "accent", label }]} aria-label={label} />}</span>
      <span className="shrink-0 font-medium tabular-nums">{value}</span>
    </div>)}
  </div>;
}
export function ComparePanel({ sessionKey, others, onChange, canOpen }: { sessionKey: string; others: string[]; onChange: (others: string[]) => void; canOpen: boolean }) {
  const host = useSessionsHost(), { model } = useSessionRow(sessionKey), [reads, setReads] = useState<Record<string, Read>>({});
  const keys = [sessionKey, ...others.filter(key => key !== sessionKey)], signature = keys.join();
  const all = useMemo(() => model.groups().flatMap(group => group.sessions.map(session => ({ session, group }))), [model]);
  const rows = useMemo(() => keys.flatMap(key => { const found = all.find(entry => entry.session.key === key); return found ? [{ session: found.session, group: found.group, view: model.inspectorView(found.session, found.group) }] : []; }), [all, signature]);
  const nameOf = (session: SessionRow) => session.name || session.project || model.span(session);
  const options = useMemo(() => all.filter(entry => !keys.includes(entry.session.key)).sort((a, b) => b.session.end.localeCompare(a.session.end)).slice(0, 200).map(entry => ({ value: entry.session.key, label: nameOf(entry.session) })), [all, signature]);
  // The nearest thing to compare with: the same project's latest sessions, then the latest of any.
  const suggested = useMemo(() => { const own = rows[0]?.group, rest = all.filter(entry => !keys.includes(entry.session.key)).sort((a, b) => Number(b.group === own) - Number(a.group === own) || b.session.end.localeCompare(a.session.end)); return rest.slice(0, SUGGESTED); }, [all, signature]);
  // One record at a time: reading them all at once would hold every conversation in memory together.
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const { session } of rows) {
        if (!live) return;
        if (reads[session.key] && reads[session.key] !== "reading") continue;
        if (!host.readable(session.agent)) { setReads(previous => ({ ...previous, [session.key]: "unsupported" })); continue; }
        setReads(previous => ({ ...previous, [session.key]: "reading" }));
        try { const value = await host.facts(session.key); if (live) setReads(previous => ({ ...previous, [session.key]: value })); }
        catch { if (live) setReads(previous => ({ ...previous, [session.key]: "failed" })); }
      }
    })();
    return () => { live = false; };
  }, [signature]);
  const record = (pick: (value: TranscriptFacts) => ReactNode) => rows.map(({ session }) => {
    const read = reads[session.key];
    return typeof read === "object" ? pick(read) : <span className="text-muted-foreground">{read === "failed" ? "失败" : read === "unsupported" ? "—" : "…"}</span>;
  });
  const shared = useMemo(() => {
    const seen = new Map<string, Map<string, { added: number; removed: number }>>();
    for (const key of keys) { const read = reads[key]; if (typeof read !== "object") continue; for (const file of read.files) { const entry = seen.get(file.path) ?? new Map(); entry.set(key, { added: file.added, removed: file.removed }); seen.set(file.path, entry); } }
    return [...seen].filter(([, owners]) => owners.size > 1).sort((a, b) => a[0].localeCompare(b[0])).slice(0, 12);
  }, [reads, signature]);
  const peak = Math.max(...rows.map(row => row.session.totals.total), 1), peakCost = Math.max(...rows.map(row => row.view.estimate.lower ?? 0), 0);
  const closed = rows.slice(1).filter(row => { const open = host.get(); return host.readable(row.session.agent) && open.reading?.key !== row.session.key && !open.also.some(pane => pane.key === row.session.key); });
  return <section className="flex min-w-0 flex-col gap-4" data-reader-side-list="compare">
    <div className="flex min-w-0 flex-col" data-compare-chosen>
      {rows.map(({ session, view }, at) => <SideRow key={session.key} lead={<Who session={session} at={at} />} tail={at ? undefined : "当前"} title={nameOf(session)} attributes={{ "data-compare-column": session.key }}
        below={<span className="whitespace-nowrap text-micro text-muted-foreground">{view.meta.name + " · " + model.span(session)}</span>}
        actions={at ? <IconButton icon={IconX} size="compact" label={"不再对比 " + nameOf(session)} onClick={() => onChange(others.filter(key => key !== session.key))} /> : undefined}>
        <span className="font-medium"><Marquee text={nameOf(session)} title="" /></span>
      </SideRow>)}
      {others.length < COMPARE_OTHERS ? <div className="pt-1" data-compare-add><Combobox value="" onChange={key => { if (key) onChange([...others, key]); }} options={options} placeholder="添加要对比的会话" searchPlaceholder="搜索会话" emptyText="没有其他会话" aria-label="添加要对比的会话" /></div> : null}
    </div>
    {rows.length < 2 ? suggested.length ? <div className="flex min-w-0 flex-col" data-compare-suggested>
      <span className="px-2 pb-1 text-caption text-muted-foreground">{"最近的会话"}</span>
      {suggested.map(({ session }) => <SideRow key={session.key} lead={<AgentMark agent={session.agent} variant="icon" size={16} />} onClick={() => onChange([...others, session.key])} tail={<IconPlus size={14} aria-hidden />} aria-label={"对比 " + nameOf(session)} title={nameOf(session)}
        below={<span className="whitespace-nowrap text-micro text-muted-foreground">{model.span(session)}</span>}><Marquee text={nameOf(session)} title="" /></SideRow>)}
    </div> : null : <>
      <div className="flex min-w-0 flex-col gap-3" data-compare-amounts>
        <Amounts label="估算" attribute="estimate" rows={rows.map(({ session, view }) => ({ session, share: view.estimate.lower === null || !peakCost ? null : view.estimate.lower / peakCost, value: <Estimate value={view.estimate} /> }))} />
        <Amounts label="Token" attribute="tokens" rows={rows.map(({ session, view }) => ({ session, share: session.totals.total / peak, value: <Value value={view.tokens} /> }))} />
        <div className="flex min-w-0 flex-col gap-1" data-compare-row="parts">
          <span className="px-2 text-caption text-muted-foreground">{"用量构成"}</span>
          {rows.map(({ session, view }, at) => { const known = parts.reduce((sum, part) => sum + (view.parts[part.key].value ?? 0), 0); return <div key={session.key} className="flex min-h-6 min-w-0 items-center gap-2 px-2" data-compare-amount>
            <Who session={session} at={at} />
            <span className="min-w-0 flex-1"><StackBar width="full" height={8} segments={parts.map(part => ({ key: part.key, value: known ? (view.parts[part.key].value ?? 0) / known : 0, tone: part.tone, label: part.label + " " + model.fieldText(view.parts[part.key]) }))} aria-label="用量构成" /></span>
          </div>; })}
        </div>
      </div>
      <div className="px-2" data-compare-counts><CompareGrid compact columns={rows.length} aria-label="会话对比">
        <CompareRow compact head label="" attributes={{ "data-compare-head": "" }} cells={rows.map(({ session }, at) => <span className="flex" title={nameOf(session)}><Who session={session} at={at} /></span>)} />
        <CompareRow compact label="缓存命中" cells={rows.map(({ view }) => <Value value={view.rateText} unknown="未报告" />)} />
        <CompareRow compact label="时长" cells={rows.map(({ session }) => model.durationBadge(session.start, session.end) || "—")} />
        <CompareRow compact label="轮次" attributes={{ "data-compare-row": "turns" }} cells={record(value => value.turns)} />
        <CompareRow compact label="工具" cells={record(value => value.tools)} />
        <CompareRow compact label="命令" cells={record(value => value.commands)} />
        <CompareRow compact label="失败" attributes={{ "data-compare-row": "failed" }} cells={record(value => value.failed)} />
        <CompareRow compact label="文件" attributes={{ "data-compare-row": "files" }} cells={record(value => value.files.length)} />
        <CompareRow compact label="压缩" cells={record(value => value.compactions)} />
      </CompareGrid></div>
      {shared.length ? <div className="flex min-w-0 flex-col" data-compare-shared-list>
        <span className="px-2 pb-1 text-caption text-muted-foreground">{"共同改过的文件 " + shared.length}</span>
        {shared.map(([path, owners]) => <SideRow key={path} lead={<FileMark path={path} />} title={path} attributes={{ "data-compare-shared": path }}
          below={<span className="flex flex-wrap gap-x-3 text-micro">{rows.map(({ session }, at) => { const entry = owners.get(session.key); return <span key={session.key} className="flex items-center gap-1"><Who session={session} at={at} />{entry ? <DiffCount added={entry.added} removed={entry.removed} /> : <span className="text-muted-foreground">{"—"}</span>}</span>; })}</span>}>
          <Marquee text={path.split(/[\\/]/).slice(-2).join("/")} title="" />
        </SideRow>)}
      </div> : null}
      {closed.length && canOpen ? <div className="px-2" data-compare-read><Button variant="secondary" size="compact" onClick={() => { for (const row of closed) host.readAlso(row.session); }}>{"并排打开"}</Button></div> : null}
    </>}
  </section>;
}
