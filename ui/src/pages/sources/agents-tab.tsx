import { useEffect, useMemo, useRef, useState } from "react";
import { IconFileText, IconFolderOpen, IconPlus, IconRefresh } from "@tabler/icons-react";
import { AgentMark, Badge, Banner, Button, CheckMark, CopyButton, Disclosure, EmptyState, Figure, IconButton, Meter, OpenRow, OpenTableHead, SearchField, Segmented, Sheet, Switch, TextArea } from "@ui/kit";
import { type AgentItem, type AgentItemKind, type AgentRepairPlan, type AgentRestoreRecord, type AgentsState, type AgentUseRow } from "@ui/data";
import type { UsageBridge } from "@ui/data";
import { ConfigSection } from "./sheets";

export type AdminSection = Exclude<AgentItemKind, "file"> | "history";
export const ADMIN_SECTIONS: { value: AdminSection; label: string }[] = [{ value: "mcp", label: "MCP" }, { value: "skill", label: "Skills" }, { value: "hook", label: "Hooks" }, { value: "plugin", label: "插件" }, { value: "instruction", label: "指令文件" }, { value: "history", label: "恢复记录" }];
const TITLES: Record<AdminSection, string> = { mcp: "MCP 服务器", skill: "Skills", hook: "Hooks", plugin: "插件", instruction: "指令文件", history: "恢复记录" };
const KIND_NAMES: Record<string, string> = { mcp: "MCP", skill: "Skill", hook: "Hook", plugin: "插件", instruction: "指令文件", file: "配置文件" };
const HEALTH: Record<AgentItem["health"], { label: string; tone: string }> = { ok: { label: "正常", tone: "text-muted-foreground" }, warn: { label: "需要注意", tone: "text-warn" }, issue: { label: "有问题", tone: "text-destructive" }, unknown: { label: "没法确认", tone: "text-muted-foreground" } };
const ORDER: AgentItem["health"][] = ["issue", "warn", "unknown", "ok"];
const ERRORS: Record<string, string> = {
  INVENTORY_BUSY: "正在检查，请稍候。", INVENTORY_FAILED: "检查没有完成，什么都没有改变；请重试。", INVENTORY_TIMEOUT: "检查超时了，什么都没有改变；请重试。", INVENTORY_ITEM_UNKNOWN: "结果已过期，请重新检查。", INVENTORY_ACTION_UNSUPPORTED: "这一项暂时不能在这里修改。",
  INVENTORY_FILE_MISSING: "这个文件已经不在了，请重新检查。", INVENTORY_OPEN_REFUSED: "只能直接打开文本配置文件；这一项请在资源管理器里查看。", INVENTORY_OPEN_FAILED: "这台电脑没有能打开这种文件的程序。",
  CONFIG_MANAGEMENT_UNSUPPORTED: "这一项暂时不能在这里修改。", CONFIG_MANAGEMENT_LIMIT: "这个目录里的项目太多，没有改动。", CONFIG_IMPORT_REJECTED: "这个目录太大，或里面有看起来像密钥的文件，没有移动它。", CONFIG_FILE_REJECTED: "这个文件太大或不是普通文件，没有改动它。", CONFIG_FORMAT_UNSUPPORTED: "这个文件的写法没法安全修改，没有改动它。", CONFIG_IMPORT_COLLISION: "目标已有同名的配置，没有覆盖它。", CONFIG_EDIT_INVALID: "这个修改不合法，没有保存。", CONFIG_NO_CHANGE: "内容没有变化。",
  CONFIG_PREVIEW_STALE: "预览已过期，请重新操作。", CONFIG_CHANGED: "文件刚被别的程序改过，没有写入。请重新检查后再试。", CONFIG_BACKUP_UNAVAILABLE: "备份不可用，为了安全没有写入。", CONFIG_UNDO_UNAVAILABLE: "这条记录恢复不了。",
};
const failed = (code: unknown) => ERRORS[String(code)] ?? "操作没有完成，配置没有改变。";
const when = (at: string | null) => { if (!at) return "—"; const value = new Date(at); return (value.getMonth() + 1) + "/" + value.getDate() + " " + String(value.getHours()).padStart(2, "0") + ":" + String(value.getMinutes()).padStart(2, "0"); };
const worst = (items: AgentItem[]) => ORDER.find(level => items.some(item => item.health === level)) ?? "ok";
const useKey = (agent: string, kind: string, name: string) => agent + "|" + kind + "|" + name;
const detail = (item: AgentItem, label: string) => item.details.find(row => row.label === label)?.value;
const scopeOf = (item: AgentItem) => item.scope === "user" ? "用户级" : "项目 " + item.project;
/** The line under a name: its own description when it has one, else what it is. */
function subtitle(item: AgentItem) {
  const described = detail(item, "描述");
  if (described) return described;
  if (item.kind === "mcp") return [detail(item, "连接方式"), detail(item, "命令") ?? detail(item, "地址")].filter(Boolean).join(" · ");
  if (item.kind === "hook") return [detail(item, "类型"), detail(item, "命令")].filter(Boolean).join(" · ");
  if (item.kind === "plugin") return detail(item, "版本") ? "版本 " + detail(item, "版本") : detail(item, "来源") ?? "";
  return detail(item, "大小") ?? "";
}
/** Each problem once, with how many places have it: the same words on four copies of a Skill are one thing to read. */
function distinct(items: AgentItem[]) {
  const seen = new Map<string, { level: string; text: string; fix: string; count: number }>();
  for (const item of items) for (const entry of item.problems) { const old = seen.get(entry.text); if (old) old.count++; else seen.set(entry.text, { level: entry.level, text: entry.text, fix: entry.fix, count: 1 }); }
  return [...seen.values()];
}
const problemTone = (level: string) => level === "issue" ? "text-destructive" : level === "warn" ? "text-warn" : "text-muted-foreground";
interface Group { key: string; name: string; items: AgentItem[] }
type Pending = { group: string; id: string; summary: string; normalization: boolean };

/** The admin's state, kept above the section being shown so that moving between sections loses nothing. */
export function useAgentAdmin() {
  const bridge = window.usageBridge;
  const [state, setState] = useState<AgentsState | null>(null), [message, setMessage] = useState("");
  const take = (value: { error?: string; state?: AgentsState } & Partial<AgentsState>) => { if (value.error) { setMessage(failed(value.error)); return; } setState((value.state ?? value) as AgentsState); };
  const check = async () => { if (!bridge) return; setMessage(""); setState(current => current && { ...current, busy: true }); take(await bridge.agents("check")); };
  const items = useMemo(() => state?.inventory?.items ?? [], [state]);
  const counts = useMemo(() => Object.fromEntries(ADMIN_SECTIONS.map(({ value }) => { const own = items.filter(item => item.kind === value); return [value, { total: own.length, bad: own.filter(item => item.health === "issue" || item.health === "warn").length }]; })) as Record<AdminSection, { total: number; bad: number }>, [items]);
  return { state, message, setMessage, take, check, items, counts, load: async () => { if (bridge) take(await bridge.agents("state")); } };
}

// The local Agent admin (owner 2026-11-03, docs/m2/UI-OWNER-FIVE-BATCHES-20261103.md; a table page since 2026-11-05,
// docs/m2/UI-AGENT-ADMIN-TABLE-20261105.md): the page holds what can be done, as the pricing page does. A summary with one click, a
// search, and a row for each thing that opens in place. Nothing is read until the person presses check; nothing is written
// without a preview, and every write can be restored from 恢复记录.
export function AgentsTab({ section, admin }: { section: AdminSection; admin: ReturnType<typeof useAgentAdmin> }) {
  return window.usageBridge ? <AgentsPane section={section} admin={admin} bridge={window.usageBridge} /> : <EmptyState message="本机配置管理在桌面应用中可用。" />;
}
function AgentsPane({ section, admin, bridge }: { section: AdminSection; admin: ReturnType<typeof useAgentAdmin>; bridge: UsageBridge }) {
  const { state, message, setMessage, take, check, items } = admin;
  const [only, setOnly] = useState("all"), [query, setQuery] = useState(""), [show, setShow] = useState<"all" | "look" | "off">("all"), [opened, setOpened] = useState(() => new Set<string>()), [records, setRecords] = useState<AgentRestoreRecord[]>([]);
  const [use, setUse] = useState<Map<string, AgentUseRow> | null>(null), [using, setUsing] = useState<{ searched: number; total: number } | null>(null), useRun = useRef(0);
  const [plan, setPlan] = useState<AgentRepairPlan | null>(null), [repairing, setRepairing] = useState(false), [editing, setEditing] = useState<{ id: string; name: string; text: string; revision: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => () => { useRun.current++; }, []);
  const loadHistory = async () => { const value = await bridge.agents("history"); if (value.error) setMessage(failed(value.error)); else setRecords(value.records ?? []); };
  useEffect(() => { setQuery(""); setShow("all"); setPending(null); if (section === "history") void loadHistory(); }, [section]);
  const inventory = state?.inventory ?? null, found = inventory?.agents.filter(agent => agent.found) ?? [];
  const loadPlan = async () => { const value = await bridge.agents("plan"); if (!value.error) setPlan(value); };
  useEffect(() => { if (state?.checkedAt && !state.busy) void loadPlan(); }, [state?.checkedAt, state?.busy]);
  const nameOf = (id: string) => inventory?.agents.find(agent => agent.id === id)?.name ?? id;
  const own = useMemo(() => items.filter(item => item.kind === section && (only === "all" || item.agent === only)), [items, section, only]);
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase(), byName = new Map<string, AgentItem[]>();
    for (const item of own) { const list = byName.get(item.name) ?? []; list.push(item); byName.set(item.name, list); }
    const hit = (group: Group) => !needle || group.name.toLowerCase().includes(needle) || group.items.some(item => [subtitle(item), item.file, nameOf(item.agent), ...item.problems.map(entry => entry.text)].some(text => text.toLowerCase().includes(needle)));
    const off = (group: Group) => group.items.every(item => item.enabled === false), look = (group: Group) => ["issue", "warn"].includes(worst(group.items));
    return [...byName].map(([name, list]): Group => ({ key: name, name, items: list })).filter(hit).filter(group => show === "all" || (show === "off" ? off(group) : look(group) && !off(group)))
      .sort((a, b) => Number(off(a)) - Number(off(b)) || ORDER.indexOf(worst(a.items)) - ORDER.indexOf(worst(b.items)) || a.name.localeCompare(b.name));
  }, [own, query, show, inventory]);
  const tally = useMemo(() => { const names = new Map<string, AgentItem[]>(); for (const item of own) names.set(item.name, [...names.get(item.name) ?? [], item]); const all = [...names.values()], active = all.filter(list => !list.every(item => item.enabled === false)), count = (level: AgentItem["health"]) => active.filter(list => worst(list) === level).length; return { total: all.length, off: all.length - active.length, issue: count("issue"), warn: count("warn"), unknown: count("unknown"), ok: count("ok") }; }, [own]);
  // How often each was used, scanned from the saved session records only when asked, batch by batch; nothing is kept.
  const countUse = async () => {
    const run = ++useRun.current, next = new Map<string, AgentUseRow>(); let offset: number | null = 0;
    setUse(next); setUsing({ searched: 0, total: 0 });
    try {
      while (offset !== null && run === useRun.current) {
        const batch = await bridge.agentUse({ offset });
        if (run !== useRun.current) return;
        for (const row of batch.rows) { const key = useKey(row.agent, row.kind, row.name), old = next.get(key); next.set(key, old ? { ...row, calls: old.calls + row.calls, sessions: old.sessions + row.sessions, last: old.last && row.last ? (old.last > row.last ? old.last : row.last) : old.last ?? row.last } : row); }
        setUse(new Map(next)); setUsing({ searched: batch.searched, total: batch.total }); offset = batch.next;
      }
    } catch { setMessage("使用情况没有统计完，已有的结果保留。"); }
    if (run === useRun.current) setUsing(null);
  };
  const usedOf = (item: AgentItem) => {
    if (!use) return null;
    const direct = use.get(useKey(item.agent, item.kind, item.name));
    if (direct) return direct;
    if (item.kind !== "plugin") return null;
    // A plugin's tools carry its own name: name@market is the plugin, the tool says plugin_name_server or name:skill.
    const plain = item.name.split("@")[0], list = [...use.values()].filter(row => row.agent === item.agent && (row.name.startsWith("plugin_" + plain + "_") || row.name.startsWith(plain + ":")));
    return list.length ? { ...list[0], calls: list.reduce((sum, row) => sum + row.calls, 0), sessions: list.reduce((sum, row) => sum + row.sessions, 0) } : null;
  };
  const usedText = (group: Group) => {
    if (!use || section === "hook" || section === "instruction") return "";
    const calls = group.items.reduce((sum, item) => sum + (usedOf(item)?.calls ?? 0), 0);
    return calls ? calls + " 次" : using ? "统计中" : "没用过";
  };
  const preview = async (group: string, request: object) => { setBusy(true); setMessage(""); const value = await bridge.agents("preview", request); setBusy(false); if (value.error) setMessage(failed(value.error)); else setPending({ group, ...value.preview }); };
  const apply = async () => { if (!pending) return; setBusy(true); const value = await bridge.agents("apply", pending.id); setBusy(false); if (value.error) { setMessage(failed(value.error)); return; } setPending(null); setEditing(null); await check(); };
  const toggleRow = (key: string) => setOpened(current => { const next = new Set(current); if (!next.delete(key)) next.add(key); return next; });
  const rows = { bridge, usedOf, counted: Boolean(use), nameOf, busy, pending, preview, apply, cancel: () => setPending(null), onError: (code: unknown) => setMessage(failed(code)), onEdit: async (item: AgentItem) => { const value = await bridge.agents("instruction", item.id); if (value.error) setMessage(failed(value.error)); else setEditing({ id: item.id, name: item.name, text: value.text, revision: value.revision }); } };
  const fileProblems = items.filter(item => item.kind === "file");
  const look = tally.issue + tally.warn, can = plan?.rows.length ?? 0, hand = plan?.manual.length ?? 0;
  const legend = ["正常 " + tally.ok, tally.warn ? "需要注意 " + tally.warn : "", tally.issue ? "有问题 " + tally.issue : "", tally.unknown ? "没法确认 " + tally.unknown : "", tally.off ? "已停用 " + tally.off : ""].filter(Boolean).join(" · ");
  const active = tally.total - tally.off || 1;
  return <section className="flex flex-col gap-4" data-agent-admin>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-title font-semibold text-foreground" data-agent-title>{TITLES[section]}</h2>
      <div className="flex flex-wrap items-center gap-2">
        {inventory ? <IconButton icon={IconRefresh} label="重新检查" disabled={state?.busy} onClick={() => void check()} /> : null}
        {inventory && section !== "history" ? <Button variant="tertiary" disabled={Boolean(using)} onClick={() => void countUse()}>{using ? "统计中 " + using.searched + " / " + using.total : "统计使用情况"}</Button> : null}
        <Button variant="tertiary" leadingIcon={IconPlus} onClick={async () => { take(await bridge.agents("addProject")); }}>添加项目</Button>
      </div>
    </div>
    {state?.projects.length ? <div className="flex flex-wrap items-center gap-2" data-agent-projects>
      {state.projects.map(project => <span key={project.id} className="flex items-center gap-1 rounded-lg bg-muted py-0.5 pl-3 pr-1 text-caption text-foreground">{"项目 " + project.name}<Button variant="ghost" size="compact" aria-label={"不再检查 " + project.name} onClick={async () => { take(await bridge.agents("removeProject", project.id)); }}>移除</Button></span>)}
    </div> : null}
    {message || state?.error ? <div role="status" data-agent-message><Banner tone="warn">{message || failed(state?.error)}</Banner></div> : null}
    {!inventory ? <div className="flex flex-col items-center gap-4 rounded-2xl bg-card px-6 py-12 text-center shadow-card" data-agent-start>
      <p className="max-w-96 text-body text-muted-foreground">{state?.busy ? "正在检查，只读取配置，不运行任何东西。" : "看看这台电脑上的 Agent 装了哪些 MCP、Skills、Hooks 和插件，哪些有问题。只读取配置，不运行任何东西，也不联网。"}</p>
      <Button variant="primary" disabled={state?.busy} onClick={() => void check()}>检查本机配置</Button>
    </div> : section === "history" ? (records.length ? <div className="flex flex-col gap-3" data-agent-history>{records.map(record => <div key={record.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-card p-4 shadow-card" data-agent-record={record.id}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="break-words text-body font-semibold text-foreground">{record.summary}</span><span className="text-caption text-muted-foreground">{when(record.at) + (record.files.length ? " · " + record.files.join("、") : "")}</span></div>
      {record.restorable ? <Button variant="secondary" size="compact" onClick={async () => { const value = await bridge.agents("restore", record.id); if (value.error) setMessage(failed(value.error)); else { setRecords(value.records ?? []); setMessage(""); await check(); } }}>恢复到改之前</Button> : <span className="text-caption text-muted-foreground">文件之后又改过，或已恢复</span>}
    </div>)}</div> : <EmptyState message="还没有修改记录。在这里做的每次修改都会先加密备份，可以从这里恢复。" />) : <>
      <div className="flex flex-col gap-3 rounded-2xl bg-card p-6 shadow-card" data-agent-summary>
        <Figure text={String(look)} size="md" unit={"项要看，共 " + tally.total + " 项"} />
        <Meter aria-label={legend} segments={[{ value: tally.ok / active, tone: "done", label: "正常" }, { value: look / active, tone: "warn", label: "要看" }, { value: tally.unknown / active, tone: "muted", label: "没法确认" }]} />
        <p className="text-caption text-muted-foreground" data-agent-legend>{legend}</p>
        {can || hand ? <div className="flex flex-wrap items-center gap-3" data-agent-repair-entry>
          <span className="text-body text-foreground">{"所有分类里 " + [can ? can + " 项可以一键处理" : "", hand ? hand + " 项要手动" : ""].filter(Boolean).join("，")}</span>
          <Button variant="primary" size="compact" onClick={() => { setRepairing(true); void loadPlan(); }}>一键处理</Button>
        </div> : null}
        {state?.repaired ? <div className="flex flex-wrap items-center gap-3" data-agent-repair-undo><span className="text-caption text-muted-foreground">{"刚才的一键处理改了 " + state.repaired + " 项"}</span><Button variant="tertiary" size="compact" onClick={async () => { const value = await bridge.agents("undoRepair"); if (value.error) { setMessage(failed(value.error)); return; } setMessage(value.left ? value.left + " 项之后又改过，没有恢复。" : ""); take(value); await check(); }}>撤销</Button></div> : null}
      </div>
      {fileProblems.length ? <div className="flex flex-col gap-1" data-agent-file-problems>{fileProblems.map(item => <Banner key={item.id} tone="warn" action={<Locate bridge={bridge} item={item} onError={code => setMessage(failed(code))} />}>{item.file + "：" + item.problems.map(entry => entry.text).join("；")}</Banner>)}</div> : null}
      {inventory.notes.filter(note => section === "mcp" && (only === "all" || note.agent === only)).map(note => <p key={note.text} className="text-caption text-muted-foreground" data-agent-note>{note.text}</p>)}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64"><SearchField value={query} onChange={setQuery} placeholder="搜索名称、路径或问题" aria-label="搜索配置项" /></div>
        <Segmented value={show} onChange={setShow} aria-label="按状态看" items={[{ value: "all", label: "全部" }, { value: "look", label: "要看的 " + look }, { value: "off", label: "已停用 " + tally.off }]} />
        {found.length > 1 ? <Segmented value={only} onChange={setOnly} aria-label="按 Agent 看" items={[{ value: "all", label: "全部 Agent" }, ...found.map(agent => ({ value: agent.id, label: agent.name }))]} /> : null}
      </div>
      {groups.length ? <div className="flex flex-col rounded-2xl bg-card p-2 shadow-card" data-agent-table role="list" aria-label={TITLES[section]}>
        <OpenTableHead cells={[<span key="name" className="pl-6">名称</span>, <span key="used" className="text-right">{use ? "用过" : ""}</span>, <span key="on" className="text-right">启用</span>]} />
        {groups.map(group => <Row key={group.key} group={group} open={opened.has(group.key)} onToggle={() => toggleRow(group.key)} used={usedText(group)} {...rows} />)}
      </div> : <EmptyState message={query || only !== "all" || show !== "all" ? "没有符合条件的项。" : "没有发现这一类配置。"} />}
    </>}
    {section !== "history" ? <Disclosure summary={<span className="text-body text-muted-foreground" data-config-advanced>按目录逐项检查和编辑</span>}><ConfigSection /></Disclosure> : null}
    <RepairSheet open={repairing} plan={plan} bridge={bridge} nameOf={nameOf} onClose={() => setRepairing(false)} onDone={async value => { take(value); setMessage(value.failed.length ? value.failed.map(row => row.name + "：" + failed(row.error)).join("；") : ""); setRepairing(false); await check(); }} onError={code => setMessage(failed(code))} />
    <Sheet scrollable open={Boolean(editing)} onOpenChange={open => { if (!open) { setEditing(null); setPending(null); } }} title={editing?.name ?? ""} size="lg"
      footer={pending && editing ? <PreviewBar pending={pending} busy={busy} onCancel={() => setPending(null)} onApply={() => void apply()} /> : undefined}>
      {editing ? <div className="flex flex-col gap-2" data-agent-instruction>
        <TextArea value={editing.text} onChange={text => setEditing({ ...editing, text })} label={editing.name} rows={16} />
        <div className="flex justify-end"><Button variant="secondary" disabled={busy} onClick={() => void preview(":edit", { id: editing.id, action: "text", text: editing.text, revision: editing.revision })}>预览修改</Button></div>
      </div> : null}
    </Sheet>
  </section>;
}

function PreviewBar({ pending, busy, onCancel, onApply }: { pending: Pending; busy: boolean; onCancel: () => void; onApply: () => void }) {
  return <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl bg-muted p-3" data-agent-preview>
    <div className="flex min-w-0 flex-1 flex-col gap-1"><span className="text-body text-foreground">{pending.summary}</span><span className="text-caption text-muted-foreground">{pending.normalization ? "保存后不保留这个文件里的注释；写入前加密备份，可以从“恢复记录”恢复。" : "写入前加密备份，可以从“恢复记录”恢复。"}</span></div>
    <div className="flex shrink-0 gap-2"><Button variant="tertiary" disabled={busy} onClick={onCancel}>取消</Button><Button variant="primary" disabled={busy} onClick={onApply}>应用</Button></div>
  </div>;
}
/** Where an item lives. Only its id goes to the app, which knows the path; opening is for text files. */
function Locate({ bridge, item, onError }: { bridge: UsageBridge; item: { id: string; openable?: boolean; name: string }; onError: (code: unknown) => void }) {
  const act = async (action: string) => { const value = await bridge.agents("locate", { id: item.id, action }); if (value.error) onError(value.error); return !value.error; };
  return <span className="flex shrink-0 items-center gap-0.5" data-agent-locate>
    <span data-agent-reveal><IconButton icon={IconFolderOpen} size="compact" label={"在资源管理器中显示 " + item.name} onClick={() => void act("reveal")} /></span>
    <span data-agent-copy><CopyButton size="compact" label={"复制 " + item.name + " 的路径"} onCopy={() => act("copy")} /></span>
    {item.openable ? <span data-agent-open><IconButton icon={IconFileText} size="compact" label={"打开文件 " + item.name} onClick={() => void act("open")} /></span> : null}
  </span>;
}
function Fact({ label, children }: { label: string; children: string }) {
  return <div className="flex min-w-0 flex-col gap-0.5 text-caption"><span className="text-muted-foreground">{label}</span><span className="min-w-0 break-words text-foreground">{children}</span></div>;
}
type RowActions = { bridge: UsageBridge; usedOf: (item: AgentItem) => AgentUseRow | null; counted: boolean; nameOf: (id: string) => string; busy: boolean; pending: Pending | null; preview: (group: string, request: object) => Promise<void>; apply: () => Promise<void>; cancel: () => void; onError: (code: unknown) => void; onEdit: (item: AgentItem) => Promise<void> };
/** One thing installed: all there is to read and do about it opens under the row, one block per place it lives. */
function Row({ group, open, onToggle, used, bridge, usedOf, counted, nameOf, busy, pending, preview, apply, cancel, onError, onEdit }: { group: Group; open: boolean; onToggle: () => void; used: string } & RowActions) {
  const level = worst(group.items), first = group.items[0], agents = [...new Set(group.items.map(item => item.agent))], problems = distinct(group.items), about = subtitle(first), allOff = group.items.every(item => item.enabled === false), id = "agent-row-" + first.id;
  const canToggle = (item: AgentItem) => item.enabled !== null && item.actions.some(action => action.startsWith("toggle"));
  const single = group.items.length === 1 ? first : null;
  return <OpenRow id={id} open={open} onToggle={onToggle} attributes={{ "data-agent-row": group.name, "data-off": allOff ? "true" : undefined, "aria-label": group.name + " 详情" }}
    title={<span className="min-w-0 break-words text-body font-semibold text-foreground" data-agent-item={group.name}>{group.name}</span>}
    aside={level !== "ok" ? <span className={"shrink-0 text-caption font-medium leading-5 " + HEALTH[level].tone} data-agent-health={level}>{HEALTH[level].label}</span> : null}
    lines={<>
      {about ? <span className="min-w-0 break-words text-caption text-muted-foreground">{about}</span> : null}
      {problems.map(entry => <span key={entry.text} className="min-w-0 break-words text-caption" data-agent-problem-line={entry.level}><span className={problemTone(entry.level)}>{entry.text + (entry.count > 1 ? "（" + entry.count + " 处）" : "")}</span>{entry.fix ? <span className="text-muted-foreground">{" · " + entry.fix}</span> : null}</span>)}
      <span className="flex min-w-0 flex-wrap items-center gap-1 text-caption text-muted-foreground" data-agent-marks={agents.join(" ")}>{agents.map(agent => <AgentMark key={agent} agent={agent} variant="icon" size={16} />)}<span className="min-w-0 break-words">{[agents.map(nameOf).join("、"), group.items.length > 1 ? group.items.length + " 处" : scopeOf(first)].join(" · ")}</span></span>
    </>}
    cells={[
      <span key="used" className="pt-0.5 text-right text-caption tabular-nums text-muted-foreground" data-agent-used-count>{used}</span>,
      <span key="on" className="flex justify-end pt-0.5" data-agent-switch>
        {single && canToggle(single) ? <Switch labelHidden checked={single.enabled!} disabled={busy} label={(single.enabled ? "停用 " : "启用 ") + group.name} onChange={value => void preview(group.key, { id: single.id, action: "toggle", enabled: value })} /> : <span className="text-caption text-muted-foreground">{single ? single.enabled === null ? "" : single.enabled ? "启用" : "停用" : "展开"}</span>}
      </span>,
    ]}
    between={pending?.group === group.key ? <div className="px-3 pb-3"><PreviewBar pending={pending} busy={busy} onCancel={cancel} onApply={() => void apply()} /></div> : null}>
      <div className="flex flex-col gap-3 px-3 pb-3 pl-9" data-agent-detail>
        {group.items.map(item => { const usedRow = usedOf(item), layer = item.actions.includes("toggle-layer"), block = group.items.length > 1; return <section key={item.id} className="flex min-w-0 flex-col gap-2 rounded-xl bg-muted p-3" data-agent-occurrence={item.agent}>
          <div className="flex flex-wrap items-center gap-2">
            <AgentMark agent={item.agent} variant="icon" size={16} />
            <span className="text-body font-medium text-foreground">{nameOf(item.agent)}</span>
            <Badge tone="neutral">{scopeOf(item)}</Badge>
            <span className={"text-caption font-medium " + HEALTH[item.health].tone}>{HEALTH[item.health].label}</span>
            <span className="flex-1" />
            {canToggle(item) && (block || layer) ? <Switch checked={item.enabled!} disabled={busy} label={layer ? "这个文件的全部 Hooks" : item.enabled ? "已启用" : "已停用"} onChange={value => void preview(group.key, { id: item.id, action: "toggle", enabled: value })} /> : item.enabled !== null ? <span className="text-caption text-muted-foreground">{item.enabled ? "已启用" : "已停用"}</span> : null}
          </div>
          <div className="flex min-w-0 items-start gap-2"><code className="min-w-0 flex-1 break-all font-mono text-caption text-foreground" data-agent-file>{item.file}</code><Locate bridge={bridge} item={item} onError={onError} /></div>
          {item.problems.map(entry => <div key={entry.text} className="flex flex-col gap-0.5 text-caption" data-agent-problem={entry.level}><span className={"font-medium " + problemTone(entry.level)}>{entry.text}</span>{entry.fix ? <span className="text-muted-foreground">{entry.fix}</span> : null}</div>)}
          <div className="ff-fact-grid" data-agent-facts>
            {item.details.filter(row => row.label !== "描述").map(row => <Fact key={row.label} label={row.label}>{row.value}</Fact>)}
            {item.updatedAt ? <Fact label="更新于">{when(item.updatedAt)}</Fact> : null}
            {counted && item.kind !== "hook" && item.kind !== "instruction" ? <div data-agent-used><Fact label="用过">{usedRow ? usedRow.calls + " 次 · " + usedRow.sessions + " 个会话" + (usedRow.last ? " · 最近 " + when(usedRow.last) : "") : "在已读取的会话里没有用过"}</Fact></div> : null}
          </div>
          {item.kind === "mcp" ? <div className="flex flex-wrap gap-2">{[["codex", "Codex"], ["claude", "Claude Code"]].filter(([to]) => to !== item.agent && !group.items.some(other => other.agent === to && other.scope === item.scope) && !(to === "claude" && item.scope === "user")).map(([to, name]) => <Button key={to} variant="tertiary" size="compact" disabled={busy} onClick={() => void preview(group.key, { id: item.id, action: "copy", to })}>{"也加到 " + name}</Button>)}</div> : null}
          {item.actions.includes("read") ? <div><Button variant="tertiary" size="compact" disabled={busy} onClick={() => void onEdit(item)}>查看和编辑</Button></div> : null}
        </section>; })}
      </div>
  </OpenRow>;
}

/** One click over every kind: what will be stopped, each with its reason and a way out; what cannot be done from here and what to do instead. */
function RepairSheet({ open, plan, bridge, nameOf, onClose, onDone, onError }: { open: boolean; plan: AgentRepairPlan | null; bridge: UsageBridge; nameOf: (id: string) => string; onClose: () => void; onDone: (value: { failed: { name: string; error: string }[]; state?: AgentsState }) => Promise<void>; onError: (code: unknown) => void }) {
  const [left, setLeft] = useState<Set<string> | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setLeft(null); }, [open]);
  // Until the person changes something, what the plan chose is chosen.
  const chosen = left ?? new Set((plan?.rows ?? []).filter(row => row.chosen).map(row => row.id)), set = (id: string, on: boolean) => { const next = new Set(chosen); if (on) next.add(id); else next.delete(id); setLeft(next); };
  const apply = async () => { setBusy(true); const value = await bridge.agents("repair", [...chosen]); setBusy(false); if (value.error) { onError(value.error); onClose(); return; } await onDone(value); };
  const place = (row: { agent: string; kind: string; file: string }) => nameOf(row.agent) + " · " + (KIND_NAMES[row.kind] ?? row.kind) + " · " + row.file;
  return <Sheet scrollable open={open} onOpenChange={value => { if (!value) onClose(); }} title="一键处理" size="lg"
    footer={<div className="flex w-full flex-wrap items-center justify-between gap-3"><p className="text-body text-foreground" role="status" data-repair-count>{chosen.size ? "将停用 " + chosen.size + " 项；写入前加密备份，可以一步撤销" : "没有选中的项"}</p><Button variant="primary" disabled={busy || !chosen.size} onClick={() => void apply()}>应用</Button></div>}>
    <div className="flex flex-col gap-6" data-agent-repair>
      <section className="flex flex-col gap-2" data-repair-rows>
        <span className="text-subtitle font-semibold text-foreground">{"可以一键处理 " + (plan?.rows.length ?? 0)}</span>
        <p className="text-caption text-muted-foreground">只会停用：Skill 移到停用目录，插件和 MCP 关掉开关。不删除任何文件，不联网，也不运行任何东西。</p>
        {plan?.rows.map(row => <div key={row.id} className="flex min-w-0 items-start gap-3" data-repair-row={row.name}>
          <CheckMark checked={chosen.has(row.id)} onChange={value => set(row.id, value)} label={"停用 " + row.name} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="break-words text-body text-foreground">{row.name}</span><span className="break-words text-caption text-warn">{row.text}</span><span className="break-all text-caption text-muted-foreground">{place(row)}</span></div>
        </div>)}
        {plan && !plan.rows.length ? <p className="text-caption text-muted-foreground">没有能自动处理的项。</p> : null}
      </section>
      {plan?.manual.length ? <section className="flex flex-col gap-3" data-repair-manual>
        <span className="text-subtitle font-semibold text-foreground">{"要手动处理 " + plan.manual.length}</span>
        {plan.manual.map((row, at) => <div key={row.id + at} className="flex min-w-0 items-start gap-3" data-repair-hand={row.name}>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="break-words text-body text-foreground">{row.name}</span><span className="break-words text-caption text-warn">{row.text}</span>{row.why ? <span className="break-words text-caption text-muted-foreground">{"不能自动处理：" + failed(row.why)}</span> : null}{row.fix ? <span className="break-words text-caption text-foreground">{row.fix}</span> : null}<span className="break-all text-caption text-muted-foreground">{place(row)}</span></div>
          <Locate bridge={bridge} item={{ id: row.id, name: row.name, openable: /\.(?:md|json|toml|ya?ml|txt)$/i.test(row.file) }} onError={onError} />
        </div>)}
      </section> : null}
    </div>
  </Sheet>;
}
