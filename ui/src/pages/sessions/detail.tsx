import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { UnknownLabel } from "@ui/kit/surfaces";
import { AgentMark, Badge, Breakdown, Combobox, CopyButton, LabelRow, LineChart, Sheet, StatusDot, Switch, TextField, Value, type BreakdownPart, type ChartTone } from "@ui/kit";
import { useSessionsHost, type SessionGroup, type SessionRow, type SessionsViewModel } from "@ui/data";
import { CostAmount } from "../cost/amount";
import { Part } from "../cost/detail";
import { FolderAction, ReadAction, ResumeAction } from "./actions";

const tones: Record<string, ChartTone> = { inputUncached: "vivid:input", output: "vivid:output", cacheRead: "vivid:read", cacheWrite: "vivid:write" };
const money = (value: number, digits = 2) => "$" + value.toFixed(digits);

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-1">
    <span className="text-caption text-muted-foreground">{label}</span>
    <div className="flex min-w-0 items-center gap-2">{children}</div>
  </div>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="flex min-h-9 items-center justify-between gap-3 pl-3"><span className="text-caption text-muted-foreground">{label}</span><Switch label={label} labelHidden checked={checked} onChange={onChange} /></div>;
}
/** The tiles of a detail card, the cost detail's: a label over a figure, three to a row. */
export function Tiles({ items, compact = false, "aria-label": label }: { items: { label: string; value: string | null; unknown?: UnknownLabel }[]; compact?: boolean; "aria-label"?: string }) {
  return <dl aria-label={label} data-session-detail-stats className="grid grid-cols-3 gap-2">
    {items.map(item => <div key={item.label} className={"flex min-w-0 flex-col gap-1 rounded-xl bg-hover " + (compact ? "px-2 py-2" : "px-3 py-2.5")}>
      <dt className={"text-caption text-foreground" + (compact ? " truncate" : "")} title={item.label}>{item.label}</dt>
      <dd className={"truncate font-semibold text-foreground tabular-nums " + (compact ? "text-body" : "text-subtitle")}><Value value={item.value} unknown={item.unknown ?? "—"} /></dd>
    </div>)}
  </dl>;
}

// The person's own name, group and pin for a session (SESSIONS-NEXT-20261101.md, UI-SESSIONS-MULTI-20261102.md):
// saved by the app only, never written to the Agent's files. An empty name falls back to the title the Agent stores.
function Naming({ session, groups }: { session: SessionRow; groups: string[] }) {
  const host = useSessionsHost(), label = host.get().labels[session.key], [draft, setDraft] = useState(label?.alias ?? "");
  useEffect(() => { setDraft(label?.alias ?? ""); }, [session.key, label?.alias]);
  const commit = (value: string) => { const alias = value.trim(); if (alias !== (label?.alias ?? "")) void host.label(session.key, { alias: alias || null }); };
  const options = useMemo(() => [{ value: "", label: "不分组" }, ...groups.map(name => ({ value: name, label: name }))], [groups]);
  return <div className="flex flex-col gap-3" data-session-naming>
    <TextField label="名称" value={draft} onChange={setDraft} onCommit={commit} maxLength={120} placeholder={session.title || "未命名"} />
    <div className="flex min-w-0 flex-col gap-1"><span className="pl-3 text-caption text-muted-foreground">{"分组"}</span><div className="min-w-0 flex-1" data-session-group-field>
      <Combobox value={label?.group ?? ""} onChange={value => { void host.label(session.key, { group: value.trim() ? value.trim().slice(0, 40) : null }); }} options={options} allowCustom customLabel={text => "新建分组 “" + text + "”"} placeholder="不分组" searchPlaceholder="选择或输入新分组" emptyText="还没有分组" aria-label="会话分组" />
    </div></div>
    <Toggle label="置顶" checked={label?.pinned === true} onChange={pinned => { void host.label(session.key, { pinned }); }} />
  </div>;
}
function DayTrend({ session, model, view }: { session: SessionRow; model: SessionsViewModel; view: ReturnType<SessionsViewModel["inspectorView"]> }) {
  const [active, setActive] = useState<number | null>(null), days = view.days, peak = Math.max(...days.map(day => day.totalTokens), 1);
  const readout = (index: number) => days[index] ? days[index].date.slice(5).replace("-", "/") + " · " + days[index].tokens + " Token" : undefined;
  return <Part title="每日 Token" aside={active !== null ? readout(active) : "最近 " + days[days.length - 1].tokens}>
    <div data-session-detail-days>
      <LineChart palette="cost" variant="detail" x={days.map(day => ({ key: day.date, label: day.date.slice(5).replace("-", "/") }))}
        series={[{ key: "tokens", label: "每日 Token", tone: "cost:line", style: "area", values: days.map(day => day.totalTokens) }]}
        ticks={{ left: [{ value: 0, label: "0" }, { value: peak, label: model.short(peak) }] }} active={active} onActiveChange={setActive}
        endLabel={days[days.length - 1].tokens} tooltip={readout} dataKey={session.key} aria-label="这个会话的每日 Token" />
    </div>
  </Part>;
}
/** A session's facts, one layout wherever they show: its detail card and the reading page's right column. */
export function SessionFacts({ session, group, model, after, duration, compact = false }: { session: SessionRow; group: SessionGroup; model: SessionsViewModel; after?: ReactNode; duration?: string; compact?: boolean }) {
  const host = useSessionsHost(), view = model.inspectorView(session, group), name = host.get().labels[session.key]?.alias || session.title || null;
  // Each part's bar is its share of the parts that were reported.
  const known = view.partsRows.reduce((sum, part) => sum + (part.part.value ?? 0), 0);
  const parts: BreakdownPart[] = view.partsRows.map(part => {
    const share = part.part.value !== null && known > 0 ? part.part.value / known : null;
    return { key: part.key, label: part.label, note: part.note || undefined, tone: tones[part.key] ?? "cost:muted", share,
      value: <span data-session-part={part.key}><Value value={part.part.value === null ? null : part.text} unknown="未报告" /></span>,
      detail: [{ label: "Token", value: <Value value={part.part.value === null ? null : part.text} unknown="未报告" />, share }] };
  });
  const cost = view.totals.cost, total = view.totals.total;
  const tiles: { label: string; value: string | null; unknown?: UnknownLabel }[] = [
    { label: "Token", value: view.tokens },
    { label: "用量占比", value: group.total > 0 ? view.ratio.toFixed(1) + "%" : null },
    { label: compact ? "每百万" : "每百万 Token", value: cost !== null && total > 0 ? money(cost / total * 1e6, 3) : null, unknown: "未定价" },
    { label: "时长", value: duration || model.durationBadge(session.start, session.end) || null },
    { label: "缓存命中", value: view.rateText, unknown: "未报告" },
    { label: "缓存约省下", value: view.totals.savings !== null ? money(view.totals.savings) : null, unknown: "无法估算" },
  ];
  return <div className={"flex min-w-0 flex-col " + (compact ? "gap-4" : "gap-6")} data-session-detail>
    <div className="flex flex-col gap-2">
      <div className={(compact ? "text-figure-md" : "text-figure-lg") + " font-semibold text-foreground tabular-nums"} data-session-detail-amount>
        {view.estimate.lower === null ? <span className="text-muted-foreground">{"未定价"}</span> : <CostAmount text={view.estimate.text} />}
      </div>
      <div className="flex flex-wrap gap-2">
        {view.coverageText ? <Badge tone="neutral">{view.coverageText}</Badge> : null}
        {view.rangeLabel ? <Badge tone="neutral">{view.rangeLabel}</Badge> : null}
      </div>
    </div>
    <Tiles items={tiles} compact={compact} />
    <Part title="用量构成" aside={view.tokens === null ? "未知" : view.tokens + " Token"}>
      <div data-session-detail-parts><Breakdown parts={parts} columns={compact ? 1 : 2} aria-label="这个会话的用量构成" /></div>
    </Part>
    {view.days.length > 1 ? <DayTrend session={session} model={model} view={view} /> : null}
    {view.models.length ? <Part title="模型" aside={String(view.models.length)}>
      <div data-session-detail-model className="flex flex-col">{view.models.map(item => <LabelRow key={item} title={item} />)}</div>
    </Part> : <Part title="模型"><span className="text-body text-muted-foreground" data-session-detail-model>{"模型未记录"}</span></Part>}
    {after}
    <Part title="会话">
      <div className="flex flex-col gap-4">
        <Naming session={session} groups={model.collections().map(item => item.name)} />
        {session.title ? <Prop label="Agent 里的标题"><span className="break-all text-body text-foreground" data-session-detail-title>{session.title}</span></Prop> : null}
        {name ? <Prop label="项目"><span className="break-all text-body text-foreground">{session.project || "未知项目"}</span></Prop> : null}
        <Prop label="会话 ID">{session.id ? <>
          <code className="min-w-0 break-all font-mono text-caption text-foreground">{session.id}</code>
          <CopyButton size="compact" label="复制完整会话 ID" onCopy={() => host.copyText(session.id!, "inspector")} />
        </> : <span className="text-body text-muted-foreground">{"未记录"}</span>}</Prop>
        <Prop label="工作目录">{session.cwd ? <>
          <code className="min-w-0 break-all font-mono text-caption text-foreground">{session.cwd}</code>
          <CopyButton size="compact" label="复制工作目录" onCopy={() => host.copyText(session.cwd!, "inspector")} />
          <FolderAction enabled sessionKey={session.key} kind="inspector" title={"在文件资源管理器中打开对应工作目录：" + session.cwd} />
        </> : <span className="text-body text-muted-foreground">{"未记录"}</span>}</Prop>
      </div>
    </Part>
  </div>;
}
// A session's details in the cost detail's floating card, on the same side and in the same order.
export function SessionDetail({ selected, model, onClose }: { selected: { session: SessionRow; group: SessionGroup } | null; model: SessionsViewModel; onClose: () => void }) {
  const host = useSessionsHost(), session = selected?.session, view = selected ? model.inspectorView(selected.session, selected.group) : null;
  const name = session ? host.get().labels[session.key]?.alias || session.title || null : null;
  return <Sheet open={Boolean(selected)} onOpenChange={open => { if (!open) onClose(); }} placement="left" floating dismissDrag scrollable size="lg"
    title={name || view?.project || "未知项目"}
    icon={session ? <AgentMark agent={session.agent} variant="icon" size={24} /> : undefined}
    subtitle={view ? <span className="flex items-center gap-2">{view.meta.name}{view.isRecent ? <><StatusDot tone="active" label="活跃" />{"活跃"}</> : null}{" · " + view.metadata}</span> : undefined}
    footer={session && view ? <div className="flex gap-2" data-session-detail-footer>
      <ReadAction session={session} />
      {session.resumable ? <ResumeAction session={session} button title="复制 PowerShell 恢复命令，由你自己在终端里执行" /> : null}
    </div> : undefined}>
    {selected ? <SessionFacts session={selected.session} group={selected.group} model={model} /> : null}
  </Sheet>;
}
