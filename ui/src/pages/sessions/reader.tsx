import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconArrowLeft, IconArrowsMinimize, IconBook2, IconBrain, IconChevronDown, IconChevronUp, IconFileDownload, IconLayoutSidebarRight, IconPin, IconPinnedOff, IconListTree, IconPaperclip, IconPhoto, IconRobot, IconSearch, IconTerminal2, IconTool, IconX } from "@tabler/icons-react";
import { WindowedList, WindowedItem, AgentMark, Appear, ViewportAppear, Badge, Button, Collapse, CopyButton, DiffBlock, Disclosure, EmptyState, Highlight, IconButton, LabelRow, Markdown, Marquee, Menu, OutlineNav, PositionRail, ResizableBox, SearchField, Segmented, SidePanel, SlideOver, TipCard, type RailMark, SideRow, TreeChevron } from "@ui/kit";
import { getGlobals, useSessionsHost, type SessionReading, type SessionRow, type Transcript, type TranscriptFind, type TranscriptItem } from "@ui/data";
import { Part } from "../cost/detail";
import { ComparePanel, COMPARE_OTHERS, useSessionRow } from "./compare";
import { ReaderNav, SessionNav, type NavTab } from "./reader-nav";
import { IconDots } from "@tabler/icons-react";
import { useHoverCard } from "@ui/kit/hover-card";
import { PaneCell, PaneGhost, PaneGrid, usePaneDrag, type PaneColumns, type PaneEdge, type PaneTarget } from "@ui/kit/pane-drag";
import { COLUMN_PANES, columnOf, movePane, paneWidthBand, paneWidthThresholds, placePane, reconcile, type PaneMove } from "./pane-layout";
import { CommandsTab, FailuresTab, FilesTab } from "./side-tabs";
import { SessionFacts } from "./detail";
import { buildTurns, changedFiles, isShell, processExpansion, processParts, segmentOf, shortTokens, turnLabel, turnMoments, turnName, turnSegments, turnWeight, type ChangedFile, type ReaderTurn, type TurnMoment, type TurnSegment } from "./turns";

// The reading view (docs/m2/SESSIONS-READER-20261101.md), after CC Switch's reader (MIT): the whole
// conversation arrives light (long text, outputs and images as previews), grouped into turns whose process
// folds into one line; an outline jumps between turns. Opening more of an item, an image or a find re-reads
// the record; nothing is kept once the view closes. It takes the whole page rather than a dialog (owner
// 2026-11-02): the widget column steps aside, the outer menu folds to its rail, and the conversation reads as a
// document with the person's questions as bubbles (UI-READER-DOCUMENT-20261102.md). Several conversations can lie
// side by side, one pane each (UI-SESSIONS-MULTI-20261102.md). Its left column holds the outline or the other sessions
// (UI-READER-NAV-20261104.md). Those two columns belong to the window and follow the pane in use; panes are placed by holding
// and dragging them (UI-READER-PANES-20261104.md).
const PAGE_TURNS = 30, SCROLL_MARGIN = 24;
type ReaderView = "all" | "talk" | "fail";
const views: { value: ReaderView; label: string }[] = [{ value: "all", label: "全部" }, { value: "talk", label: "只看对话" }, { value: "fail", label: "只看失败" }];
const SIDE_KEY = "agentusage.reader.side.v1", NAV_WIDTH = 248, SIDE_WIDTH = 320, SIDE_ROWS = 200, PANE_MIN = 440, PANE_FLOOR = 320, PANE_MAX = 3, DOCK_MAX = 440, FOLLOW_MS = 4000, RECENT_MS = 3600000, POSITION_MS = 2000;
const WIDTH_EDGES = paneWidthThresholds({ min: PANE_MIN, floor: PANE_FLOOR, nav: NAV_WIDTH, side: SIDE_WIDTH, gap: 12, max: PANE_MAX });
function savedSide() { try { return localStorage.getItem(SIDE_KEY) === "open"; } catch { return false; } }
function rememberSide(open: boolean) { try { localStorage.setItem(SIDE_KEY, open ? "open" : "closed"); } catch { /* This visit only. */ } }
const NAV_KEY = "agentusage.reader.nav.v1";
function savedNav() { try { return localStorage.getItem(NAV_KEY) !== "closed"; } catch { return true; } }
const ERRORS: Record<string, string> = {
  TRANSCRIPT_UNSUPPORTED: "这个 Agent 还不能阅读对话。",
  TRANSCRIPT_NOT_FOUND: "找不到这个会话的记录文件。",
  TRANSCRIPT_TOO_LARGE: "这个会话的记录文件超过 512 MB，暂不读取。",
  TRANSCRIPT_PREVIEW: "界面预览不读取对话；桌面应用里会读取这个会话的记录文件。",
};
type Load = { key: string; state: "loading" } | { key: string; state: "ready"; value: Transcript } | { key: string; state: "error"; message: string };
type Field = "text" | "output" | "diff";
type Full = { text: string; next: number | null; total: number; clipped?: boolean };
const errorCode = (error: unknown) => String((error as Error)?.message ?? "").match(/TRANSCRIPT_[A-Z_]+/)?.[0] ?? "";
const kb = (bytes: number) => bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";

interface Context {
  agent: string; revision: string; needle: string; current: number | null;
  opened: Set<number>; toggle(index: number, open: boolean): void;
  full: Record<string, Full>; more(index: number, field: Field, through?: string): void;
  images: Record<number, string>; image(index: number): void;
  runs: Set<string>; toggleRun(key: string, open: boolean): void;
  link(url: string): void; copy(turn: ReaderTurn): void; copyItem(index: number): Promise<boolean>; copyCode(text: string): Promise<boolean>;
}

const More = memo(function More({ item, full, field, ctx, index }: { item: TranscriptItem; full: Full | undefined; field: Field; ctx: Context; index: number }) {
  const total = full?.total ?? (field === "output" ? item.tool?.outputLength : field === "diff" ? item.tool?.change?.length : item.length);
  if (full?.next === null && full.clipped) return <p className="text-caption text-muted-foreground" data-reader-clipped>{"这一段超过 64 MB，后面的内容没有读取。"}</p>;
  if (!total || (full && full.next === null) || (field === "diff" && !full)) return null;
  return <div><Button variant="tertiary" size="compact" onClick={() => ctx.more(index, field)}>
    {full ? "继续显示（已显示 " + full.text.length + " / " + total + " 字）" : field === "output" ? "显示全部输出（共 " + total + " 字）" : "显示全部（共 " + total + " 字）"}
  </Button></div>;
})
const TextBody = memo(function TextBody({ item, index, ctx }: { item: TranscriptItem; index: number; ctx: Context }) {
  const full = ctx.full[index + ":text"], whole = full ? full.next === null : !item.length;
  return <div className="flex min-w-0 flex-col gap-2">
    <Markdown text={full ? full.text : item.text ?? ""} query={ctx.needle} current={ctx.current === index} onLink={ctx.link} onCopyCode={whole ? ctx.copyCode : undefined} />
    <More item={item} full={full} field="text" ctx={ctx} index={index} />
  </div>;
})
// Where a Codex reply cited its memory: its app hides this, the reading view folds it under the reply.
const Cited = memo(function Cited({ item, index, ctx }: { item: TranscriptItem; index: number; ctx: Context }) {
  const cited = item.cited ?? [], key = -1 - index;
  if (!cited.length) return null;
  return <div data-reader-cited><Disclosure open={ctx.opened.has(key)} onOpenChange={open => ctx.toggle(key, open)} summary={<span className="flex items-center gap-2 text-caption text-muted-foreground"><IconBook2 size={14} aria-hidden />{"引用了 " + cited.length + " 条记忆"}</span>}>
    <ul className="flex flex-col gap-1">{cited.map((entry, at) => <li key={at} className="flex min-w-0 flex-col text-caption"><span className="break-all font-mono text-muted-foreground">{entry.path + ":" + entry.lines}</span><span className="text-foreground">{entry.note}</span></li>)}</ul>
  </Disclosure></div>;
})
const Attached = memo(function Attached({ item }: { item: TranscriptItem }) {
  const files = item.attached ?? [];
  if (!files.length) return null;
  return <div className="flex flex-wrap justify-end gap-1" data-reader-attached>{files.map(file => <span key={file.name + file.path} title={file.path} className="flex max-w-64 items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-caption text-muted-foreground"><IconPaperclip size={12} className="shrink-0" aria-hidden /><span className="truncate">{file.name}</span></span>)}</div>;
})
const CompactMark = memo(function CompactMark({ item }: { item: TranscriptItem }) {
  const trigger = item.compact?.trigger, before = item.compact?.before;
  const said = [trigger === "auto" ? "自动" : trigger === "manual" ? "手动" : "", before ? "压缩前 " + shortTokens(before) + " Token" : ""].filter(Boolean).join(" · ");
  return <p className="flex items-center justify-center gap-2 text-center text-caption text-muted-foreground" data-turn="compact"><IconArrowsMinimize size={14} aria-hidden />{"上下文在这里压缩了" + (said ? " · " + said : "")}</p>;
})
const ImageView = memo(function ImageView({ item, index, ctx }: { item: TranscriptItem; index: number; ctx: Context }) {
  const box = useRef<HTMLDivElement>(null), src = ctx.images[index];
  useEffect(() => {
    const target = box.current; if (!target || src) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); ctx.image(index); } });
    observer.observe(target); return () => observer.disconnect();
  }, [src, index, ctx.revision]);
  return <div ref={box} className={"flex " + (item.from === "user" ? "justify-end" : "")} data-reader-image>
    {src ? <img src={src} alt="会话里的图片" className="max-h-96 max-w-4/5 rounded-xl" /> :
      <span className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-caption text-muted-foreground"><IconPhoto size={14} aria-hidden />{"图片 · " + kb(item.image?.bytes ?? 0)}</span>}
  </div>;
})
const ToolView = memo(function ToolView({ item, index, ctx }: { item: TranscriptItem; index: number; ctx: Context }) {
  const tool = item.tool!, shell = isShell(tool.name), full = ctx.full[index + ":output"];
  const output = full ? full.text : tool.output, opened = ctx.opened.has(index), change = tool.change, diff = ctx.full[index + ":diff"];
  // A change is read when it is opened; the window keeps only its file list until then.
  useEffect(() => { if (opened && change && !diff) ctx.more(index, "diff"); }, [opened, Boolean(change), Boolean(diff), index]);
  const added = change?.files.reduce((sum, file) => sum + file.added, 0) ?? 0, removed = change?.files.reduce((sum, file) => sum + file.removed, 0) ?? 0;
  const showOutput = !change || tool.error || (ctx.needle && output?.toLowerCase().includes(ctx.needle));
  return <div data-turn="tool" data-tool-error={tool.error || undefined} data-tool-change={change ? "" : undefined}>
    <Disclosure open={opened} onOpenChange={open => ctx.toggle(index, open)} summary={<span className="flex min-w-0 items-center gap-2 text-caption">
      {shell ? <IconTerminal2 size={14} className="shrink-0 text-muted-foreground" aria-hidden /> : <IconTool size={14} className="shrink-0 text-muted-foreground" aria-hidden />}
      <span className="shrink-0 font-medium text-foreground">{tool.name}</span>
      <span className="min-w-0 truncate font-mono text-muted-foreground"><Highlight text={tool.summary} query={ctx.needle} current={ctx.current === index} /></span>
      {change ? <span className="shrink-0 tabular-nums text-muted-foreground" data-tool-change-count>{"+" + added + " −" + removed}</span> : null}
      {tool.error ? <Badge tone="warn">{"失败"}</Badge> : null}
    </span>}>
      <div className="flex flex-col gap-2">
        {change ? diff ? <><DiffBlock text={diff.text} query={ctx.needle} current={ctx.current === index} /><More item={item} full={diff} field="diff" ctx={ctx} index={index} /></> : <span className="text-caption text-muted-foreground">{"正在读取改动…"}</span> : null}
        {!showOutput ? null : output !== null ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-2 p-4 font-mono text-caption text-foreground"><Highlight text={output} query={ctx.needle} current={ctx.current === index} /></pre> :
          <span className="text-caption text-muted-foreground">{"没有记录输出"}</span>}
        {showOutput ? <More item={item} full={full} field="output" ctx={ctx} index={index} /> : null}
      </div>
    </Disclosure>
  </div>;
})
const ItemView = memo(function ItemView({ item, index, ctx }: { item: TranscriptItem; index: number; ctx: Context }) {
  let body: ReactNode;
  if (item.kind === "image") body = <ImageView item={item} index={index} ctx={ctx} />;
  else if (item.kind === "tool" && item.tool) body = <ToolView item={item} index={index} ctx={ctx} />;
  else if (item.kind === "command") body = <div className="text-center font-mono text-caption text-muted-foreground" data-turn="command"><Highlight text={item.text ?? ""} query={ctx.needle} current={ctx.current === index} /></div>;
  else if (item.kind === "compact") body = <CompactMark item={item} />;
  else if (item.kind === "assistant") body = <div className="ff-reader-reply flex flex-col gap-2" data-turn="note"><TextBody item={item} index={index} ctx={ctx} /><Cited item={item} index={index} ctx={ctx} /></div>;
  else if (item.kind === "user") body = <div className="flex flex-col items-end gap-1"><Attached item={item} /><div className="max-w-4/5 rounded-2xl bg-bubble px-4 py-3 font-medium" data-turn="user" data-answered={item.answered || undefined}><TextBody item={item} index={index} ctx={ctx} /></div></div>;
  else body = <div data-turn={item.kind}>
    <Disclosure open={ctx.opened.has(index)} onOpenChange={open => ctx.toggle(index, open)} summary={<span className="flex items-center gap-2 text-caption text-muted-foreground">
      {item.kind === "thinking" ? <IconBrain size={14} aria-hidden /> : null}{item.kind === "thinking" ? "思考" : item.label ?? "注入的上下文"}
    </span>}><TextBody item={item} index={index} ctx={ctx} /></Disclosure>
  </div>;
  return <div data-reader-item={index} data-hit={ctx.current === index || undefined}>{body}</div>;
})

function processLine(segment: Extract<TurnSegment, { kind: "steps" }>) {
  return ["执行过程", segment.indices.length + " 步", segment.tools ? segment.tools + " 次工具调用" : "", segment.failures.length ? segment.failures.length + " 次失败" : ""].filter(Boolean).join(" · ");
}
const Process = memo(function Process({ turn, items, ctx }: { turn: Pick<ReaderTurn, "index" | "process">; items: TranscriptItem[]; ctx: Context }) {
  return <div className="flex flex-col gap-3">{processParts(items, turn).map(part => part.kind === "item" ? <ItemView key={part.index} item={items[part.index]} index={part.index} ctx={ctx} /> :
    part.kind === "agent" ? <div key={part.key} data-reader-agent>
      <Disclosure open={ctx.runs.has(part.key)} onOpenChange={open => ctx.toggleRun(part.key, open)} summary={<span className="flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
        <IconRobot size={14} className="shrink-0" aria-hidden /><span className="font-medium text-foreground">{"子 Agent"}</span><span>{part.indices.length + " 步"}</span>
      </span>}><div className="flex flex-col gap-2">{part.indices.map(index => <ItemView key={index} item={items[index]} index={index} ctx={ctx} />)}</div></Disclosure>
    </div> :
    <div key={part.key} data-reader-run>
      <Disclosure open={ctx.runs.has(part.key)} onOpenChange={open => ctx.toggleRun(part.key, open)} summary={<span className="flex min-w-0 items-center gap-2 text-caption">
        <IconTool size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 font-medium text-foreground">{part.name}</span>
        <span className="shrink-0 text-muted-foreground">{part.indices.length + " 次"}</span>
        <span className="min-w-0 truncate font-mono text-muted-foreground">{items[part.indices[0]].tool!.summary}</span>
      </span>}><div className="flex flex-col gap-2">{part.indices.map(index => <ItemView key={index} item={items[index]} index={index} ctx={ctx} />)}</div></Disclosure>
    </div>)}</div>;
})
// What the Agent said between its steps stays on the page, as in Codex and Claude Desktop: only the steps fold. One plain step
// reads inline; a longer run folds into its summary line with failures kept in view.
const StepsView = memo(function StepsView({ segment, turn, items, ctx, open, onOpen }: { segment: Extract<TurnSegment, { kind: "steps" }>; turn: ReaderTurn; items: TranscriptItem[]; ctx: Context; open: boolean; onOpen: (key: number, open: boolean) => void }) {
  if (segment.indices.length === 1 && !segment.failures.length) return <ItemView item={items[segment.indices[0]]} index={segment.indices[0]} ctx={ctx} />;
  return <div data-reader-process>
    <Disclosure open={open} onOpenChange={next => onOpen(segment.key, next)} summary={<span className="text-caption text-muted-foreground">{processLine(segment)}</span>}>
      <Process turn={{ index: turn.index, process: segment.indices }} items={items} ctx={ctx} />
    </Disclosure>
    {!open && segment.failures.length ? <div className="flex flex-col gap-2">{segment.failures.slice(0, 5).map(index => <ItemView key={index} item={items[index]} index={index} ctx={ctx} />)}</div> : null}
  </div>;
})
const TurnView = memo(function TurnView({ turn, items, ctx, opened, onOpen, moment, view, usageKnown }: { turn: ReaderTurn; items: TranscriptItem[]; ctx: Context; opened: Set<number>; onOpen: (key: number, open: boolean) => void; moment: TurnMoment; view: ReaderView; usageKnown: boolean }) {
  const words = turn.question.find(index => items[index].kind === "user");
  const segments = turnSegments(items, turn).filter(segment => segment.kind === "note" || view !== "talk");
  return <section className="ff-reader-turn flex flex-col gap-3" data-reader-turn={turn.index}>
    {turn.question.length ? <div className="flex flex-col gap-1" data-reader-question>
      <div className="flex min-h-7 items-center justify-end gap-2">
        {words !== undefined ? <span className="ff-reader-tail"><CopyButton size="compact" label="复制这条消息" onCopy={() => ctx.copyItem(words)} /></span> : null}
        {moment.time ? <time className="text-caption tabular-nums text-muted-foreground" data-reader-time>{moment.time}</time> : null}
      </div>
      <div className="flex flex-col gap-2">{turn.question.map(index => <ItemView key={index} item={items[index]} index={index} ctx={ctx} />)}</div>
    </div> : null}
    {turn.compacts.map(index => <ItemView key={index} item={items[index]} index={index} ctx={ctx} />)}
    {segments.length || turn.final !== null ? <div className="flex min-w-0 flex-col gap-3">
      {segments.map(segment => segment.kind === "note" ? <ItemView key={segment.index} item={items[segment.index]} index={segment.index} ctx={ctx} /> : <StepsView key={segment.key} segment={segment} turn={turn} items={items} ctx={ctx} open={opened.has(segment.key)} onOpen={onOpen} />)}
      {turn.final !== null ? <ItemView item={items[turn.final]} index={turn.final} ctx={ctx} /> : null}
      <div className="flex min-h-7 items-center justify-between gap-2">
        {usageKnown ? <span className="text-caption tabular-nums text-muted-foreground" title="这一轮记录里报告的 Token，只显示，不进统计" data-reader-usage>{"Token " + (turn.tokens === null ? "未知" : shortTokens(turn.tokens))}</span> : <span />}
        <div className="ff-reader-tail flex gap-1" data-reader-turn-actions>
          {turn.final !== null ? <Button variant="tertiary" size="compact" onClick={() => { void ctx.copyItem(turn.final!); }}>{"复制回复"}</Button> : null}
          {turn.question.length ? <Button variant="tertiary" size="compact" onClick={() => ctx.copy(turn)}>{"复制这一轮"}</Button> : null}
        </div>
      </div>
    </div> : null}
  </section>;
})

const SIDE_PREVIEW = 5;
/** A list in the right column's overview (owner 2026-11-05): its head folds it, and past a few rows the rest waits behind one click. */
function SideFold({ list, title, items, mono = false, onSelect }: { list: string; title: string; items: { key: string; label: string; meta?: string }[]; mono?: boolean; onSelect: (key: string) => void }) {
  const [open, setOpen] = useState(true), [all, setAll] = useState(false), rest = items.length - SIDE_PREVIEW;
  return <div className="flex min-w-0 flex-col" data-reader-side-list={list}>
    <SideRow lead={<TreeChevron open={open} />} expanded={open} onClick={() => setOpen(!open)} tail={items.length} attributes={{ "data-side-fold": list }}><span className="text-muted-foreground">{title}</span></SideRow>
    {open ? <OutlineNav fill={false} mono={mono} aria-label={title} active={null} onSelect={onSelect} items={all ? items : items.slice(0, SIDE_PREVIEW)} /> : null}
    {open && rest > 0 ? <SideRow onClick={() => setAll(!all)} attributes={{ "data-side-more": list }}><span className="text-muted-foreground">{all ? "收起" : "展开其余 " + rest + " 个"}</span></SideRow> : null}
  </div>;
}

// The right column: the session's facts in the detail card's layout, and what only its record can tell: the commands
// it ran, the files it changed, what failed, where it compacted, what the person attached and what the reply cited.
type SideTab = "facts" | "commands" | "files" | "failures" | "compare";
const SideColumn = memo(function SideColumn({ onGoTurn, sessionKey, items, ready, failure, turns, turnOf, onGo, files, file, onFile, onAllFiles, tab, onTab, others, onOthers, canOpen, historyAsk, slot }: { onGoTurn: (turn: number) => void; historyAsk: number; slot: number; sessionKey: string; items: TranscriptItem[]; ready: boolean; failure?: string; turns: ReaderTurn[]; turnOf: Int32Array; onGo: (index: number) => void; files: ChangedFile[]; file: string | null; onFile: (path: string) => void; onAllFiles: () => void; tab: SideTab; onTab: (tab: SideTab) => void; others: string[]; onOthers: (others: string[]) => void; canOpen: boolean }) {
  const { model, found } = useSessionRow(sessionKey);
  const scrollRoot = useRef<HTMLDivElement>(null);
  const { failures, compacts, attached, cited, agents } = useMemo(() => {
    const failures: number[] = [], compacts: number[] = [], attached: { index: number; name: string; path?: string }[] = [], cited: { index: number; path: string; lines: string; note: string }[] = [], agents = new Set<string>();
    items.forEach((item, index) => {
      if (item.side) agents.add(item.side);
      if (item.tool?.error) failures.push(index);
      if (item.kind === "compact") compacts.push(index);
      for (const entry of item.attached ?? []) attached.push({ index, ...entry });
      for (const entry of item.cited ?? []) cited.push({ index, ...entry });
    });
    return { failures, compacts, attached, cited, agents };
  }, [items]);
  const tabs: { value: SideTab; label: string }[] = [{ value: "facts", label: "概况" }, { value: "commands", label: "命令" }, { value: "files", label: "文件" }, { value: "failures", label: failures.length ? "失败 " + failures.length : "失败" }, { value: "compare", label: "对比" }];
  const asked = turns.filter(turn => turn.question.length).length, tools = items.filter(item => item.kind === "tool").length;
  const heavy = useMemo(() => turns.filter(turn => turn.tokens !== null).sort((a, b) => b.tokens! - a.tokens!).slice(0, 5), [turns]);
  // How long the conversation ran, from the record's own times; the saved usage span when it has none.
  const times = useMemo(() => items.flatMap(item => item.time ? [item.time] : []), [items]), duration = times.length ? model.durationBadge(times[0], times[times.length - 1]) : undefined;
  const record = <Part title="这段对话">
    <div className="flex flex-col" data-reader-side-list="record">
      <LabelRow title="轮次" value={String(asked)} />
      <LabelRow title="工具调用" value={String(tools)} />
      {agents.size ? <LabelRow title="子 Agent" value={String(agents.size)} /> : null}
    </div>
    {heavy.length > 1 ? <SideFold list="heavy" title="Token 最多的轮次" onSelect={key => onGoTurn(Number(key))} items={heavy.map(turn => ({ key: String(turn.index), label: turnLabel(items, turn), meta: turnName(turn) + " · " + shortTokens(turn.tokens!) }))} /> : null}
    {compacts.length ? <SideFold list="compacts" title="上下文压缩" onSelect={key => onGo(Number(key))} items={compacts.map(index => ({ key: String(index), label: turnName(turns[turnOf[index]]) + (items[index].compact?.before ? " · 压缩前 " + shortTokens(items[index].compact!.before!) + " Token" : "") }))} /> : null}
    {attached.length ? <SideFold list="attached" title="附带的文件" mono onSelect={key => onGo(Number(key.split(":")[0]))} items={attached.slice(0, SIDE_ROWS).map((entry, at) => ({ key: entry.index + ":" + at, label: entry.name, meta: turnName(turns[turnOf[entry.index]]) }))} /> : null}
    {cited.length ? <SideFold list="cited" title="引用的记忆" onSelect={key => onGo(Number(key.split(":")[0]))} items={cited.slice(0, SIDE_ROWS).map((entry, at) => ({ key: entry.index + ":" + at, label: entry.note || entry.path, meta: turnName(turns[turnOf[entry.index]]) }))} /> : null}
  </Part>;
  return <aside aria-label="这次会话" className="flex h-full min-w-0 flex-1 flex-col gap-3 rounded-2xl bg-card p-4 shadow-card" data-reader-side data-tab={tab}>
    <div className="shrink-0" data-reader-side-tabs><Segmented size="compact" value={tab} onChange={onTab} items={tabs} aria-label="这次会话的内容" /></div>
    <div ref={scrollRoot} className="-mx-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg px-2 outline-none focus-visible:ring-1 focus-visible:ring-border" tabIndex={0} data-reader-side-body>
      <Appear key={tab}>
        {!ready ? <EmptyState message={failure ?? "正在读取对话…"} /> :
          tab === "facts" ? found ? <SessionFacts session={found.session} group={found.group} model={model} after={record} duration={duration} compact /> : record :
          tab === "commands" ? <CommandsTab items={items} turns={turns} turnOf={turnOf} onGo={onGo} scrollRoot={scrollRoot} /> :
          tab === "compare" ? <ComparePanel sessionKey={sessionKey} others={others} onChange={onOthers} canOpen={canOpen} /> :
          tab === "files" ? <FilesTab files={files} file={file} onFile={onFile} onAll={onAllFiles} cwd={found?.session.cwd ?? null} project={found?.group.name ?? null} sessionKey={sessionKey} slot={slot} canOpen={canOpen} historyAsk={historyAsk} scrollRoot={scrollRoot} /> :
          <FailuresTab items={items} turns={turns} turnOf={turnOf} failures={failures} onGo={onGo} />}
      </Appear>
    </div>
  </aside>;
});
/** One conversation: the whole page alone, one pane of several side by side. */
function ReaderPane({ reading, siblings, split, leading, focused, otherPanes, canAdd, nav, sideColumn, onPress, moves }: { reading: SessionReading; siblings: SessionRow[]; split: boolean; leading: boolean; focused: boolean; otherPanes: string[]; canAdd: boolean; nav: { shown: boolean; tab: NavTab; element: HTMLElement | null; open: (tab: NavTab) => void; ask: () => void }; sideColumn: { shown: boolean; element: HTMLElement | null; set: (open: boolean) => void }; onPress: (event: PointerEvent<Element>) => void; moves: { label: string; onSelect: () => void; disabled?: boolean }[] }) {
  const host = useSessionsHost(), data = host.get(), catalog = getGlobals().agentCatalog.agents;
  const go2 = (session: SessionRow, from: "up" | "down") => { entering.current = from; aimed.current = session.key; host.readInSlot(reading.slot, session); };
  const leave = () => { if (split) host.closePane(reading.key); else host.read(null); };
  const [load, setLoad] = useState<Load | null>(null), [reload, setReload] = useState(0), [changed, setChanged] = useState(false);
  const [shown, setShown] = useState(PAGE_TURNS), [opened, setOpened] = useState(new Set<number>()), [processes, setProcesses] = useState(new Set<number>()), [runs, setRuns] = useState(new Set<string>());
  const [full, setFull] = useState<Record<string, Full>>({}), [images, setImages] = useState<Record<number, string>>({});
  const requestEpoch = useRef(0), pendingParts = useRef(new Set<string>()), currentNeedle = useRef("");
  const [query, setQuery] = useState(""), [found, setFound] = useState<TranscriptFind | null>(null), [hit, setHit] = useState(0), [jump, setJump] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [pinnedTurn, setPinnedTurn] = useState<number | null>(null);
  const [view, setView] = useState<ReaderView>("all"), [finding, setFinding] = useState(false), [strip, setStrip] = useState(false);
  // The two side columns are the window's: this pane fills them while it is the one in use.
  const side = sideColumn.shown, setSide = sideColumn.set, [sideTab, setSideTab] = useState<SideTab>("facts");
  // What this conversation is compared with: the other panes, until the person chooses; the list can ask for some.
  const [chosen, setChosen] = useState<string[] | null>(null);
  const others = useMemo(() => (chosen ?? otherPanes).filter(key => key !== reading.key).slice(0, COMPARE_OTHERS), [chosen, otherPanes, reading.key]);
  const asked = data.compare;
  useEffect(() => { if (leading && asked) { setChosen(asked); setSideTab("compare"); setSide(true); host.compare(null); } }, [asked?.join()]);
  // Which way the next conversation comes from, and which turns arrived while following.
  const entering = useRef<"up" | "down" | undefined>(undefined), aimed = useRef<string | null>(null), arrived = useRef<number | null>(null);
  // A conversation chosen from the list comes in without a direction.
  useEffect(() => { if (aimed.current !== reading.key) entering.current = undefined; aimed.current = null; }, [reading.key]);
  // Turns picked for an export: a first and a last, in the outline.
  const [picking, setPicking] = useState<{ from: number | null; to: number | null } | null>(null);
  // One file's turns, chosen in the right column; following a conversation that is still being written.
  const [file, setFile] = useState<string | null>(null), [follow, setFollow] = useState(false), pinned = useRef(false), [historyAsk, setHistoryAsk] = useState(0);
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null), list = useRef<HTMLDivElement>(null), page = useRef<HTMLElement>(null), scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (leading) document.querySelector<HTMLElement>("[data-reader-back] button")?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const generation = ++requestEpoch.current; pendingParts.current.clear();
    if (!reading) { setLoad(null); return; }
    const key = reading.key; let live = true;
    setLoad({ key, state: "loading" }); setShown(PAGE_TURNS); setOpened(new Set()); setProcesses(new Set()); setRuns(new Set()); setFull({}); setImages({}); setChanged(false);
    if (!reload) { setQuery(reading.find ?? ""); setFinding(Boolean(reading.find)); setJump(Boolean(reading.find)); setView("all"); setPicking(null); setFile(null); setFollow(false); setActive(null); setPinnedTurn(null); arrived.current = null; if (scroller.current) scroller.current.scrollTop = 0; }
    setFound(null); setHit(0);
    host.transcript(key).then(value => { if (live) setLoad({ key, state: "ready", value }); })
      .catch((error: unknown) => { if (live) setLoad({ key, state: "error", message: ERRORS[errorCode(error)] ?? "读取对话失败，稍后再试。" }); });
    return () => { live = false; if (requestEpoch.current === generation) { requestEpoch.current++; pendingParts.current.clear(); } };
  }, [reading?.key, reload]);
  useEffect(() => { setReload(0); }, [reading?.key]);
  const transcript = load?.state === "ready" && load.key === reading?.key ? load.value : null, items = transcript?.items ?? [], needle = query.trim().toLowerCase();
  currentNeedle.current = needle;
  const turns = useMemo(() => buildTurns(items), [transcript]);
  const turnOf = useMemo(() => { const map = new Int32Array(items.length); for (const turn of turns) map.fill(turn.index, turn.from, turn.to + 1); return map; }, [turns]);
  const moments = useMemo(() => turnMoments(items, turns), [transcript]);
  const weights = useMemo(() => turns.map(turn => turnWeight(items, turn)), [transcript]);
  const files = useMemo(() => changedFiles(items), [transcript]), usageKnown = useMemo(() => turns.some(turn => turn.tokens !== null), [turns]);
  const shownTurns = useMemo(() => {
    if (file) { const touched = new Set(files.find(entry => entry.path === file)?.indices.map(index => turnOf[index])); return turns.filter(turn => touched.has(turn.index)); }
    return view === "fail" ? turns.filter(turn => turn.failed) : turns;
  }, [turns, view, file, files, turnOf]);
  const openNav = nav.open;
  const failed = useCallback((error: unknown) => { if (errorCode(error) === "TRANSCRIPT_CHANGED") setChanged(true); }, []);
  // Find runs over the full text in the record, a moment after typing stops.
  useEffect(() => {
    if (!transcript || !reading || !needle) { setFound(null); return; }
    let live = true; const timer = setTimeout(() => {
      host.find(reading.key, { stamp: transcript.stamp, query: needle }).then(value => { if (live) { setFound(value); setHit(0); } }).catch(error => { if (live) failed(error); });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [transcript, needle]);
  // More turns mount as the end of the list scrolls into view. The sentinel is a new element whenever the list is drawn
  // anew (another view, one file, a turn added), and an observer only reports a change, so one is built for each element
  // and each page: its first report says whether the end is still in view after the last page.
  const total = useRef(0);
  total.current = shownTurns.length;
  useEffect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setShown(count => Math.min(total.current, count + PAGE_TURNS)); });
    observer.observe(sentinel); return () => observer.disconnect();
  }, [sentinel, shown]);
  // The outline follows the topmost turn in view. One observer per conversation, and a second pass that only adds the
  // frames that have just been mounted, rather than disconnecting and re-observing all of them every page.
  const watcher = useRef<IntersectionObserver | null>(null), visible = useRef(new Set<number>());
  const adopt = useCallback((observer: IntersectionObserver) => {
    list.current?.querySelectorAll("[data-reader-turn-frame]").forEach(element => {
      if (element.getAttribute("data-watched") === "true") return;
      element.setAttribute("data-watched", "true"); observer.observe(element);
    });
  }, []);
  useEffect(() => {
    const root = list.current?.closest("[data-reader-scroll]"); if (!root || !list.current) return;
    let frame = 0;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) { const index = Number((entry.target as HTMLElement).dataset.readerTurnFrame); if (entry.isIntersecting) visible.current.add(index); else visible.current.delete(index); }
      // One update per frame however many frames crossed the edge together.
      if (visible.current.size && !frame) frame = requestAnimationFrame(() => { frame = 0; if (visible.current.size) setActive(Math.min(...visible.current)); });
    }, { root });
    watcher.current = observer; visible.current.clear();
    // Switching what is shown reuses the frames that stay, so the mark has to be cleared with the observer that made it.
    list.current.querySelectorAll("[data-reader-turn-frame]").forEach(element => element.removeAttribute("data-watched"));
    adopt(observer);
    return () => { observer.disconnect(); watcher.current = null; visible.current.clear(); if (frame) cancelAnimationFrame(frame); };
  }, [transcript, view, file, adopt]);
  useEffect(() => {
    const observer = watcher.current; if (!observer) return;
    adopt(observer);
  }, [shown, shownTurns, adopt]);
  // While the question of the turn being read is above the top edge, one line keeps it in view. The question is looked
  // up once per turn rather than on every scroll, and the scroll itself only reads one edge of it.
  useEffect(() => {
    const root = scroller.current; if (!root) return;
    let frame = 0, question: HTMLElement | null = null, measured: number | null = null;
    const check = () => {
      frame = 0;
      if (measured !== active) { measured = active; question = active === null ? null : root.querySelector<HTMLElement>('[data-reader-turn="' + active + '"] [data-reader-question]'); }
      setStrip(Boolean(question && question.getBoundingClientRect().bottom < root.getBoundingClientRect().top + 8));
    };
    const scrolled = () => { if (!frame) frame = requestAnimationFrame(check); };
    check(); root.addEventListener("scroll", scrolled, { passive: true });
    return () => { root.removeEventListener("scroll", scrolled); cancelAnimationFrame(frame); };
  }, [active, transcript, view]);
  // What a turn is drawn from, kept the same object while none of it has changed. A scroll, or a turn coming into
  // view, changes none of it, so the turns already on screen are not drawn again for them. The handlers read the
  // conversation being read, the record's stamp and what is open from here rather than closing over them, so they
  // stay the same functions for the whole visit.
  const latest = useRef({ key: reading?.key ?? null, stamp: transcript?.stamp ?? null, full, images });
  latest.current = { key: reading?.key ?? null, stamp: transcript?.stamp ?? null, full, images };
  const scrollRef = useRef<(selector: string, block: ScrollLogicalPosition) => void>(() => {});
  const toggle = useCallback((index: number, open: boolean) => setOpened(previous => { const next = new Set(previous); if (open) next.add(index); else next.delete(index); return next; }), []);
  const toggleRun = useCallback((key: string, open: boolean) => setRuns(previous => { const next = new Set(previous); if (open) next.add(key); else next.delete(key); return next; }), []);
  const more = useCallback((index: number, field: Field, through?: string) => {
    const { key, stamp, full: shown } = latest.current, slot = index + ":" + field, have = shown[slot];
    if (!key || !stamp || have?.next === null) return;
    const generation = requestEpoch.current, token = generation + ":" + slot;
    if (pendingParts.current.has(token)) return;
    pendingParts.current.add(token);
    const live = () => requestEpoch.current === generation;
    void (async () => {
      let text = have?.text ?? "", offset = have?.next ?? 0;
      for (;;) {
        const part = await host.part(key, { stamp, index, field, offset });
        if (!live()) return;
        text += part.text ?? "";
        const next = part.next ?? null;
        const value = { text, next, total: part.total ?? 0, clipped: part.clipped };
        setFull(previous => ({ ...previous, [slot]: value }));
        if (!through || text.toLowerCase().includes(through) || next === null) break;
        if (next <= offset) throw new Error("TRANSCRIPT_PART_INVALID");
        offset = next;
      }
      if (through && live() && currentNeedle.current === through) scrollRef.current('[data-reader-item="' + index + '"]', "center");
    })().catch(error => { if (live()) failed(error); }).finally(() => pendingParts.current.delete(token));
  }, [host, failed]);
  const link = useCallback((url: string) => { void host.openLink(url); }, [host]);
  const copy = useCallback((turn: ReaderTurn) => {
    const { key, stamp } = latest.current;
    if (key && stamp) host.copyTurns(key, { stamp, from: turn.from, to: turn.to }).catch(failed);
  }, [host, failed]);
  const copyItem = useCallback((index: number) => {
    const { key, stamp } = latest.current;
    return !key || !stamp ? Promise.resolve(false) : host.copyTurns(key, { stamp, from: index, to: index, plain: true }).catch(error => { failed(error); return false; });
  }, [host, failed]);
  const copyCode = useCallback((text: string) => host.copyText(text), [host]);
  const image = useCallback((index: number) => {
    const { key, stamp, images: shown } = latest.current;
    if (!key || !stamp || shown[index]) return;
    const generation = requestEpoch.current, token = generation + ":" + index + ":image";
    if (pendingParts.current.has(token)) return;
    pendingParts.current.add(token);
    host.part(key, { stamp, index, field: "image" }).then(page => {
      if (requestEpoch.current === generation && page.image) setImages(previous => ({ ...previous, [index]: page.image! }));
    }).catch(error => { if (requestEpoch.current === generation) failed(error); }).finally(() => pendingParts.current.delete(token));
  }, [host, failed]);
  const ctx: Context = useMemo(() => ({
    agent: transcript?.agent ?? "", revision: transcript?.stamp ?? "", needle, current: found?.hits[hit]?.index ?? null, opened, full, images,
    toggle, more, image, runs, toggleRun, link, copy, copyItem, copyCode,
  }), [transcript, needle, found, hit, opened, full, images, runs, toggle, more, image, toggleRun, link, copy, copyItem, copyCode]);
  // Opening one turn's process folds nothing else, so the handler stays the same for every turn.
  const onOpenTurn = useCallback((index: number, open: boolean) => setProcesses(previous => { const next = new Set(previous); if (open) next.add(index); else next.delete(index); return next; }), []);
  // A jump keeps correcting while the conversation moves under it: a turn not yet drawn stands at an estimated
  // height until the window draws it, which moves everything below. It therefore ends only once the target is at
  // its mark and the height above it has stopped changing — where it stands being still for a few frames is not
  // enough, because a turn drawn from its estimate leaves the target stable at a place it was pushed to.
  const landing = useRef<{ selector: string; block: ScrollLogicalPosition; until: number; held: number; done: boolean; still: number; seen: number; glided: boolean; blocked: boolean; anchor: number | null } | null>(null);
  useEffect(() => {
    const root = list.current?.closest("[data-reader-scroll]"); if (!root) return;
    // Anything the person does ends a jump at once, a glide under way included: it must not move what they reach for.
    const stop = () => { setPinnedTurn(null); if (!landing.current) return; landing.current = null; root.scrollTop = root.scrollTop; };
    root.addEventListener("wheel", stop, { passive: true }); root.addEventListener("pointerdown", stop); root.addEventListener("keydown", stop);
    return () => { root.removeEventListener("wheel", stop); root.removeEventListener("pointerdown", stop); root.removeEventListener("keydown", stop); };
  }, [transcript]);
  // Clearing the find leaves no place to land on.
  useEffect(() => { const root = scroller.current; if (!needle && landing.current && root) { landing.current = null; root.scrollTop = root.scrollTop; } }, [needle]);
  const scrollTo = useCallback((selector: string, block: ScrollLogicalPosition) => {
    landing.current = { selector, block, until: performance.now() + 4000, held: 0, done: false, still: 0, seen: NaN, glided: false, blocked: false, anchor: null };
    const glide = document.body.dataset.motion === "full" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = () => {
      const goal = landing.current; if (!goal) return;
      const item = list.current?.querySelector<HTMLElement>(goal.selector), target = item?.querySelector<HTMLElement>("[data-find-current]") ?? item, root = target?.closest<HTMLElement>("[data-reader-scroll]");
      if (target && root) {
        const box = target.getBoundingClientRect(), frame = root.getBoundingClientRect();
        const offset = goal.block === "start" ? box.top - frame.top - SCROLL_MARGIN : box.top + box.height / 2 - (frame.top + frame.height / 2);
        // Arriving: a nearby place is glided to once, a far one is jumped to. Until the target is anchored the
        // loop keeps asking the browser to place it, because a turn drawn above it moves it again the next frame.
        if (goal.anchor === null && Math.abs(offset) > 4 && performance.now() > goal.held) {
          if (glide && !goal.glided && Math.abs(offset) < frame.height * 1.5) { root.scrollBy({ top: offset, behavior: "smooth" }); goal.glided = true; goal.held = performance.now() + 420; }
          else {
            const before = root.scrollTop;
            target.scrollIntoView({ block: goal.block });
            // Asking for a place the paper does not allow — the last turn, with nothing below it — moves nothing;
            // the loop treats that as arrived rather than asking again for as long as it is allowed to run.
            goal.blocked = Math.abs(root.scrollTop - before) <= 1;
          }
        }
        // What has to hold is where the target sits in the conversation, not where it sits in the viewport: a turn
        // drawn from its estimate above the target keeps the target's scroll offset still while pushing it off the
        // mark, so an anchored place that was only still would stay at the wrong place for as long as the window
        // takes to fill in. Once the content above has stopped moving and the target is at its mark, it is anchored
        // and from then on only drift is corrected, in pixels, until the conversation stops moving under it.
        const holder = item?.closest<HTMLElement>("[data-windowed-item]") ?? item;
        const real = holder?.getAttribute("data-windowed-drawn") !== "false";
        const contentTop = root.scrollTop + (box.top - frame.top);
        if (Math.abs(contentTop - goal.seen) <= 1) goal.still++; else { goal.still = 0; goal.seen = contentTop; }
        if (goal.anchor !== null) {
          const drift = offset - goal.anchor;
          if (Math.abs(drift) > 2) { root.scrollTop += drift; goal.still = 0; }
          else if (++goal.still > 24) { landing.current = null; return; }
        } else if (real && (goal.blocked || (goal.still >= 5 && Math.abs(offset) <= SCROLL_MARGIN + 24))) {
          goal.anchor = offset;
          if (!goal.done && item) { goal.done = true; item.dataset.landed = ""; setTimeout(() => { delete item.dataset.landed; }, 900); }
        }
      }
      if (performance.now() > goal.until) { landing.current = null; return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);
  scrollRef.current = scrollTo;
  const toTurn = useCallback((index: number) => {
    setActive(index); setPicking(null); const position = shownTurns.findIndex(turn => turn.index === index);
    if (position >= 0) setShown(count => Math.max(count, position + 1));
    scrollTo('[data-reader-turn="' + index + '"]', "start");
  }, [shownTurns, scrollTo]);
  // One file's turns with its changes open.
  const clearFile = useCallback(() => setFile(null), []);
  const chooseFile = useCallback((path: string) => {
    if (file === path) { setFile(null); return; }
    const entry = files.find(item => item.path === path); if (!entry) return;
    setFile(path); setView("all"); setPicking(null); setActive(null); if (scroller.current) scroller.current.scrollTop = 0;
    setShown(count => Math.max(count, new Set(entry.indices.map(index => turnOf[index])).size));
    setOpened(previous => new Set([...previous, ...entry.indices]));
    const expansion = processExpansion(items, turns, turnOf, entry.indices);
    setProcesses(previous => new Set([...previous, ...expansion.processes]));
    setRuns(previous => new Set([...previous, ...expansion.runs]));
  }, [file, files, turnOf, items, turns]);
  // Goes to one item, opening what folds it and leaving a view that hides it.
  const reveal = useCallback((index: number) => {
    const turn = turns[turnOf[index]], item = items[index], segment = segmentOf(items, turn, index), folded = segment !== null;
    setPinnedTurn(turn.index);
    if ((view === "fail" && !turn.failed) || (view === "talk" && folded)) setView("all");
    if (file && !shownTurns.includes(turn)) setFile(null);
    const position = view === "fail" && turn.failed ? shownTurns.findIndex(other => other.index === turn.index) : turn.index;
    setShown(count => Math.max(count, position + 1));
    if (segment) setProcesses(previous => new Set(previous).add(segment.key));
    if (item.kind === "tool" || item.kind === "thinking" || item.kind === "context") toggle(index, true);
    const run = processParts(items, turn).find(part => part.kind !== "item" && part.indices.includes(index));
    if (run && run.kind !== "item") toggleRun(run.key, true);
    scrollTo('[data-reader-item="' + index + '"]', "center");
  }, [turns, turnOf, items, view, file, shownTurns, toggle, toggleRun, scrollTo]);
  const go = (next: number) => {
    const hits = found?.hits ?? []; if (!hits.length) return;
    const position = (next + hits.length) % hits.length, index = hits[position].index, item = items[index];
    setHit(position);
    // A match past the preview loads that item in full first.
    const field: Field = item.tool?.change ? "diff" : item.kind === "tool" ? "output" : "text";
    const seen = [full[index + ":" + field]?.text, item.text, item.tool?.name, item.tool?.summary, item.tool?.output].filter(Boolean).join("\n").toLowerCase();
    if (!seen.includes(needle)) ctx.more(index, field, needle);
    reveal(index);
  };
  // Reopening returns to the turn last read, unless a search result named a place. Only the turn number is remembered;
  // the wait lets a jump settle, and the turn in view when the page closes is saved at once.
  const restored = useRef<string | null>(null), lastPlace = useRef<{ key: string; turn: number } | null>(null);
  useEffect(() => {
    if (!transcript || !reading || restored.current === reading.key) return;
    restored.current = reading.key;
    if (reading.file && files.some(entry => entry.path === reading.file)) { chooseFile(reading.file); return; }
    const turn = reading.find ? 0 : host.labels()[reading.key]?.turn ?? 0;
    if (turn > 0 && turns[turn]) toTurn(turn);
  }, [transcript, reading?.key]);
  const remember = (where: { key: string; turn: number } | null) => { if (where && (host.labels()[where.key]?.turn ?? 0) !== where.turn) void host.position(where.key, where.turn); };
  useEffect(() => {
    if (!reading || active === null || restored.current !== reading.key) return;
    const where = { key: reading.key, turn: active }; lastPlace.current = where;
    const timer = setTimeout(() => remember(where), POSITION_MS);
    return () => clearTimeout(timer);
  }, [active, reading?.key]);
  useEffect(() => { const key = reading?.key; return () => { if (lastPlace.current?.key === key && !landing.current) remember(lastPlace.current); }; }, [reading?.key]);
  // Opened from a search result: the find bar starts with that phrase and lands on its first place.
  useEffect(() => { if (jump && found?.hits.length) { setJump(false); go(0); } }, [found]);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); go(hit + (event.shiftKey ? -1 : 1)); } };
  const closeFind = () => { setFinding(false); setQuery(""); };
  const openFind = () => { setFinding(true); requestAnimationFrame(() => page.current?.querySelector<HTMLInputElement>("[data-reader-find] input")?.focus()); };
  const place = siblings.findIndex(session => session.key === reading?.key), previous = place > 0 ? siblings[place - 1] : null, next = place >= 0 ? siblings[place + 1] ?? null : null;
  const choose = (value: ReaderView) => { entering.current = undefined; setView(value); setFile(null); setPicking(null); setShown(PAGE_TURNS); setActive(null); setPinnedTurn(null); if (scroller.current) scroller.current.scrollTop = 0; };
  // Following: while it is on, the record's size and time are checked and a change is read again in place. The wait
  // grows with how long a look takes, so a large conversation is not read back to back. Nothing is kept between reads.
  useEffect(() => {
    if (!follow || !reading || !transcript) return;
    let live = true, timer: ReturnType<typeof setTimeout>;
    const look = async () => {
      const started = performance.now(), generation = requestEpoch.current;
      try {
        const { stamp } = await host.stamp(reading.key);
        if (live && generation === requestEpoch.current && stamp !== transcript.stamp) {
          const root = scroller.current;
          pinned.current = Boolean(root && root.scrollHeight - root.scrollTop - root.clientHeight < 80);
          const value = await host.transcript(reading.key, transcript);
          if (live && generation === requestEpoch.current) {
            arrived.current = turns.length;
            requestEpoch.current++; pendingParts.current.clear(); setFull({}); setImages({});
            setLoad({ key: reading.key, state: "ready", value }); setChanged(false); return;
          }
        }
      } catch { /* The next look tries again. */ }
      if (live) timer = setTimeout(() => { void look(); }, Math.max(FOLLOW_MS, (performance.now() - started) * 10));
    };
    timer = setTimeout(() => { void look(); }, FOLLOW_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [follow, transcript?.stamp, reading?.key]);
  // Reading along at the end stays at the end as the conversation grows. A turn that arrived must be mounted
  // whether or not the reader is at the end: the page may have grown while they were reading, and a turn the
  // record has but the page hides is a turn they cannot reach.
  useLayoutEffect(() => {
    if (arrived.current !== null) setShown(count => Math.max(count, shownTurns.length));
    if (!pinned.current) return;
    pinned.current = false;
    requestAnimationFrame(() => { const root = scroller.current; if (root) root.scrollTop = root.scrollHeight; });
  }, [transcript]);
  // Keys while reading: J / K a turn, [ / ] a session, / finds; Escape closes the find, then returns to the list.
  useEffect(() => {
    const keyboard = (event: globalThis.KeyboardEvent) => {
      if (!focused || event.defaultPrevented || event.isComposing || document.querySelector('[data-ui-portal] [role="dialog"], [data-ui-portal] [role="menu"], [data-ui-portal] [role="listbox"]')) return;
      const typing = (event.target as Element | null)?.closest?.("input, textarea, [contenteditable=true]");
      if (event.key === "Escape") { event.preventDefault(); if (picking) setPicking(null); else if (typing?.closest("[data-reader-nav]")) (typing as HTMLElement).blur(); else if (finding) closeFind(); else leave(); return; }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); openFind(); return; }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "/") { event.preventDefault(); openFind(); return; }
      if (event.key === "o") { event.preventDefault(); openNav("sessions"); nav.ask(); return; }
      if (event.key === "[" && previous) go2(previous, "up");
      if (event.key === "]" && next) go2(next, "down");
      if (event.key === "j" || event.key === "k") {
        const at = shownTurns.findIndex(turn => turn.index === active), target = shownTurns[Math.max(0, Math.min(shownTurns.length - 1, (at < 0 ? 0 : at) + (event.key === "j" ? 1 : -1)))];
        if (target) toTurn(target.index);
      }
    };
    window.addEventListener("keydown", keyboard); return () => window.removeEventListener("keydown", keyboard);
  });
  const agentName = reading ? catalog[reading.agent]?.name ?? reading.agent : "";
  const title = reading?.name || reading?.project || agentName + " 会话", session = data.list?.sessions.find(item => item.key === reading?.key) ?? null;
  const facts = [agentName, reading?.project && reading.project !== title ? reading.project : "", ...(transcript ? [turns.filter(turn => turn.question.length).length + " 轮", transcript.tools + " 次工具调用", transcript.failed ? transcript.failed + " 次失败" : ""] : [])].filter(Boolean).join(" · ");
  const hits = found?.hits ?? [];
  // A conversation that moved in the last hour may still be running.
  const lastTime = useMemo(() => { for (let at = items.length - 1; at >= 0; at--) { const time = items[at].time ? Date.parse(items[at].time!) : NaN; if (!Number.isNaN(time)) return time; } return null; }, [transcript]);
  const lastMoved = lastTime !== null && Date.now() - lastTime < RECENT_MS;
  const hitTurns = useMemo(() => new Set(hits.map(hit => turnOf[hit.index])), [found, turnOf]);
  const picked = picking && picking.from !== null ? { from: Math.min(picking.from, picking.to ?? picking.from), to: Math.max(picking.from, picking.to ?? picking.from) } : null;
  const pick = useCallback((index: number) => setPicking(current => !current || current.from === null || current.to !== null ? { from: index, to: null } : { from: current.from, to: index }), []);
  // How much each turn took, on a root scale so one huge turn does not flatten the rest. Only when the record reports any.
  const peakTokens = useMemo(() => Math.max(0, ...turns.map(turn => turn.tokens ?? 0)), [turns]);
  // The rail and the outline are one entry per turn: rebuilt when a turn, a time or a hit changes, not when the page
  // merely draws again — otherwise every scroll hands the rail a new list of 300 marks to measure and place.
  const marks: RailMark[] = useMemo(() => shownTurns.map(turn => ({ key: String(turn.index), weight: weights[turn.index], flag: turn.failed > 0, hit: hitTurns.has(turn.index),
    ...(peakTokens > 0 ? { level: turn.tokens === null ? null : Math.sqrt(turn.tokens / peakTokens) } : {}),
    tip: <TipCard title={turnLabel(items, turn)} aside={moments[turn.index]?.time ?? undefined} note={[usageKnown ? "Token " + (turn.tokens === null ? "未知" : shortTokens(turn.tokens)) : "", turn.failed ? turn.failed + " 次失败" : ""].filter(Boolean).join(" · ") || undefined} /> })), [shownTurns, weights, hitTurns, peakTokens, items, moments, usageKnown]);
  const outlineItems = useMemo(() => shownTurns.map(turn => ({ key: String(turn.index), label: turnLabel(items, turn), time: moments[turn.index]?.time ?? undefined, before: view === "fail" ? undefined : moments[turn.index]?.gap ?? undefined,
    flag: turn.failed ? turn.failed + " 次失败" : undefined, marked: Boolean(picked && turn.index >= picked.from && turn.index <= picked.to) })), [shownTurns, items, moments, view, picked]);
  const exportRange = (from: number, to: number, name: string) => { if (reading && transcript) host.exportMarkdown(reading.key, { stamp: transcript.stamp, from, to, name }).catch(failed); };
  const outlineBody = <>
        {picking ? <p className="px-2 text-caption text-muted-foreground" role="status" data-reader-pick-status>{picked ? "已选 " + (picked.to - picked.from + 1) + " 轮" : "点第一轮和最后一轮"}</p> : null}
        <div className="min-h-0 flex-1"><OutlineNav aria-label="对话目录" active={picking || active === null ? null : String(active)} onSelect={key => picking ? pick(Number(key)) : toTurn(Number(key))}
          items={outlineItems} /></div>
        {picking ? <div className="flex shrink-0 justify-end gap-2" data-reader-pick>
          <Button variant="tertiary" size="compact" onClick={() => setPicking(null)}>{"取消"}</Button>
          <Button variant="primary" size="compact" disabled={!picked} onClick={() => { if (picked) { exportRange(turns[picked.from].from, turns[picked.to].to, title + " 第 " + (picked.from + 1) + "-" + (picked.to + 1) + " 轮"); setPicking(null); } }}>{"导出"}</Button>
        </div> : null}
  </>;
  // Only the pane in use fills the window's columns, so the others hold no outline or list while they wait.
  const outline = focused && nav.shown && nav.tab === "outline" && nav.element ? createPortal(outlineBody, nav.element) : null;
  const sideBody = focused && side && sideColumn.element ? createPortal(<SideColumn sessionKey={reading.key} items={items} ready={Boolean(transcript)} failure={load?.state === "error" ? load.message : undefined} turns={turns} turnOf={turnOf} onGo={reveal} files={files} file={file} onFile={chooseFile} onAllFiles={clearFile} tab={sideTab} onTab={setSideTab} others={others} onOthers={setChosen} canOpen={canAdd} onGoTurn={toTurn} historyAsk={historyAsk} slot={reading.slot} />, sideColumn.element) : null;
  const { bind, layer } = useHoverCard();
  const contentKey = (load?.state ?? "none") + ":" + (load?.key ?? "") + ":" + view + ":" + (file ?? "");
  const exports = [
    { label: "导出全部", onSelect: () => exportRange(0, items.length - 1, title) },
    { label: "选择几轮导出", onSelect: () => { setView("all"); openNav("outline"); setPicking({ from: null, to: null }); } },
  ];
  const canFollow = follow || lastMoved;
  // Side by side the head is one line: the name, what to show, find, and the rest behind the menu.
  const headMenu = [
    { label: "上一个会话", disabled: !previous, onSelect: () => { if (previous) go2(previous, "up"); } },
    { label: "下一个会话", disabled: !next, onSelect: () => { if (next) go2(next, "down"); } },
    ...(transcript ? exports : []),
    ...(canFollow ? [{ label: follow ? "停止跟随" : "跟随", onSelect: () => setFollow(!follow) }] : []),
    ...(session?.resumable ? [{ label: "接着做", onSelect: () => { void host.copyResume(session.key); } }] : []),
    ...moves,
  ];
  return <section ref={page} aria-label={"阅读对话：" + title} className="ff-reader-page flex min-h-0 flex-col overflow-hidden rounded-2xl bg-card shadow-card" data-reader-page data-focused={split ? focused : undefined}>
    <header className={"ff-pane-head shrink-0 " + (split ? "px-3" : "px-4 pt-2")} data-reader-header onPointerDown={split ? onPress : undefined}>
      <div className={split ? "flex h-11 min-w-0 items-center gap-1.5" : "flex min-h-12 min-w-0 flex-wrap items-center gap-3"} data-reader-header-row>
      {split ? <AgentMark agent={reading.agent} variant="icon" size={16} /> : <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted"><AgentMark agent={reading.agent} variant="icon" size={20} /></span>}
      <span className={"flex min-w-0 flex-1 " + (split ? "" : "min-w-40")} {...(split ? bind("facts", <TipCard title={title} note={facts} />, "above") : {})}>
        <Appear key={reading.key} className="flex min-w-0 flex-1 flex-col">
          <h2 className={split ? "text-caption font-medium text-foreground" : "text-subtitle font-semibold text-foreground"} data-reader-title><Marquee text={title} /></h2>
          {split ? null : <span className="truncate text-caption text-muted-foreground">{facts}</span>}
        </Appear>
      </span>
      {split ? null : <span className="flex items-center gap-1" data-reader-siblings>
        <span title="上一个会话  ["><IconButton icon={IconChevronUp} size="compact" label="上一个会话" disabled={!previous} onClick={() => { if (previous) go2(previous, "up"); }} /></span>
        <span title="下一个会话  ]"><IconButton icon={IconChevronDown} size="compact" label="下一个会话" disabled={!next} onClick={() => { if (next) go2(next, "down"); }} /></span>
      </span>}
      {transcript ? <div data-reader-views>{split ?
        <Menu trigger={<Button variant="ghost" size="compact" trailingIcon={IconChevronDown}>{views.find(item => item.value === view)?.label}</Button>} items={views.map(item => ({ label: item.label, onSelect: () => choose(item.value) }))} /> :
        <Segmented value={view} onChange={choose} items={views} aria-label="显示内容" />}</div> : null}
      {transcript ? <span className="flex items-center gap-1" data-reader-tools>
        <span title="查找  /"><IconButton icon={IconSearch} size="compact" label="查找" onClick={() => finding ? closeFind() : openFind()} /></span>
        {split ? null : <Menu trigger={<IconButton icon={IconFileDownload} size="compact" label="导出 Markdown" onClick={() => {}} />} items={exports} />}
      </span> : null}
      {split ? follow ? <span data-reader-follow data-on={follow}><Button variant="primary" size="compact" onClick={() => setFollow(false)}>{"跟随中"}</Button></span> : null :
        canFollow ? <span title={follow ? "停止跟随" : "记录一变就重新读取，读到末尾时跟到最新"} data-reader-follow data-on={follow}><Button variant={follow ? "primary" : "secondary"} onClick={() => setFollow(!follow)}>{follow ? "跟随中" : "跟随"}</Button></span> : null}
      {!split && session?.resumable ? <span title="复制恢复命令，由你自己在终端里执行" data-reader-resume><Button variant="secondary" leadingIcon={IconTerminal2} onClick={() => { void host.copyResume(session.key); }}>{"接着做"}</Button></span> : null}
      {split ? <span className="flex items-center gap-1" data-reader-siblings>
        <span data-reader-more><Menu trigger={<IconButton icon={IconDots} size="compact" label="更多" onClick={() => {}} />} items={headMenu} /></span>
        <span title="关闭这一栏" data-reader-close-pane><IconButton icon={IconX} size="compact" label="关闭这一栏" onClick={leave} /></span>
      </span> : null}
      </div>
    </header>
    {/* These lie over the paper rather than pushing one pane's paper below the others. */}
    <div className="relative z-30 h-0"><div className="absolute inset-x-3 top-1 flex flex-col gap-2 rounded-xl bg-popover px-3 py-2 shadow-card empty:hidden" data-reader-bars>
    <Collapse open={Boolean(transcript && finding)} id={"reader-find-" + reading.slot} aria-label="查找"><div className="flex shrink-0 items-center justify-end gap-2 p-0.5" data-reader-find onKeyDown={keyDown}>
      <div className="w-72 min-w-0 shrink"><SearchField value={query} onChange={value => setQuery(value.slice(0, 120))} maxLength={120} placeholder="在对话中查找" aria-label="在对话中查找" /></div>
      <span className="shrink-0 text-caption tabular-nums text-muted-foreground" role="status" data-reader-hits>{needle ? found ? hits.length ? (hit + 1) + " / " + hits.length + (found.total > hits.length ? " · " + found.total + " 处" : "") : "无结果" : "" : ""}</span>
      <IconButton icon={IconChevronUp} size="compact" label="上一处" disabled={!hits.length} onClick={() => go(hit - 1)} />
      <IconButton icon={IconChevronDown} size="compact" label="下一处" disabled={!hits.length} onClick={() => go(hit + 1)} />
    </div></Collapse>
    <Collapse open={Boolean(file)} id={"reader-file-" + reading.slot} aria-label="只看一个文件"><div className="flex shrink-0 items-center gap-2 text-caption text-muted-foreground" role="status" data-reader-file>
      <span className="min-w-0 truncate" title={file ?? undefined}>{"只看 " + (file ?? "").split(/[\\/]/).pop() + " · " + shownTurns.length + " 轮"}</span>
      <span data-reader-file-history><Button variant="tertiary" size="compact" onClick={() => { setSideTab("files"); setSide(true); setHistoryAsk(count => count + 1); }}>{"还有哪些会话改过它"}</Button></span>
      <IconButton icon={IconX} size="compact" label="显示全部" onClick={() => setFile(null)} />
    </div></Collapse>
    <Collapse open={changed} id={"reader-changed-" + reading.slot} aria-label="记录已更新"><div className="flex shrink-0 items-center justify-between gap-3 text-caption text-muted-foreground" role="status" data-reader-changed>
      {"会话记录已更新，重新读取后才能展开或查找。"}<Button variant="secondary" size="compact" onClick={() => setReload(count => count + 1)}>{"重新读取"}</Button>
    </div></Collapse>
    </div></div>
    <div className="relative flex min-h-0 flex-1" data-reader data-side={side} data-split={split}>
      <div className="relative flex min-w-0 flex-1 overflow-hidden pb-2" data-reader-paper>
        {transcript && active !== null && turns[active] ? <div className="ff-reader-strip absolute inset-x-0 top-0 z-10 flex h-11 items-center justify-center px-8" data-show={strip} data-reader-strip>
          <button type="button" tabIndex={strip ? 0 : -1} aria-hidden={!strip} onClick={() => toTurn(active)} className="ff-reader-column flex min-w-0 gap-2 rounded-lg text-left text-caption outline-none focus-visible:ring-1 focus-visible:ring-ring">
            <span className="shrink-0 text-muted-foreground">{turnName(turns[active])}</span>
            <span className="min-w-0 truncate font-medium text-foreground">{turnLabel(items, turns[active])}</span>
          </button>
        </div> : null}
        <ViewportAppear replay={contentKey} from={load?.state === "ready" ? entering.current : undefined}>
        <div ref={scroller} className="ff-reader-scroll min-w-0 flex-1 overflow-y-auto px-8 py-6" data-reader-scroll tabIndex={-1}>
          <div key={contentKey}>
          {!load || load.state === "loading" ? <EmptyState message="正在读取对话…" /> :
            load.state === "error" ? <EmptyState message={load.message} /> :
            !items.length ? <EmptyState message="这个会话没有可显示的对话。" /> :
            !shownTurns.length ? <EmptyState message="这个会话没有失败的步骤。" /> :
            <WindowedList root={scroller} enabled={shownTurns.length > PAGE_TURNS}><div ref={list} className="ff-reader-column mx-auto flex flex-col gap-10">
              {shownTurns.slice(0, shown).map(turn => { const body = <>
                {view !== "fail" && moments[turn.index]?.gap ? <p className="text-center text-caption text-muted-foreground" data-reader-gap>{moments[turn.index].gap}</p> : null}
                <TurnView turn={turn} items={items} ctx={ctx} opened={processes} moment={moments[turn.index]} view={view} usageKnown={usageKnown} onOpen={onOpenTurn} />
              </>; return <WindowedItem key={turn.index} index={turn.index} attributes={{"data-reader-turn-frame": turn.index}} className="gap-10" pinned={active === turn.index || pinnedTurn === turn.index}>{arrived.current !== null && turn.index >= arrived.current ? <Appear from="down" className="flex flex-col gap-10">{body}</Appear> : body}</WindowedItem>; })}
              {shown < shownTurns.length ? <div ref={setSentinel} className="text-center text-caption text-muted-foreground">{"继续显示…"}</div> : null}
              {transcript!.truncated && shown >= shownTurns.length ? <span className="text-center text-caption text-muted-foreground">{"对话过长，只显示前 " + items.length + " 条"}</span> : null}
            </div></WindowedList>}
          </div>
        </div>
        </ViewportAppear>
        {transcript && shownTurns.length > 1 ? <PositionRail aria-label="对话位置" marks={marks} active={active === null ? null : String(active)} onPick={key => toTurn(Number(key))} /> : null}
      </div>
    </div>
    {outline}{sideBody}{layer}
  </section>;
}
// The body takes the page while conversations are open: the widget column steps aside and the outer menu folds.
export function useReadingChrome() {
  // A layout effect, so the page is back to its full height before the list restores its scroll position.
  useLayoutEffect(() => {
    document.body.classList.add("session-reading"); window.uiShell?.reading(true);
    return () => { document.body.classList.remove("session-reading"); window.uiShell?.reading(false); };
  }, []);
}
type PaneSource = { kind: "pane"; slot: number } | { kind: "session"; session: SessionRow };
const PLACES: Record<Exclude<PaneEdge, "center">, string> = { left: "放到左边", right: "放到右边", top: "放到上方", bottom: "放到下方" };
// Dock and overlay coexist during exit motion. A retiring mount may release
// only its own target, never the incoming column's already attached element.
function useColumnTarget() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const mounted = useRef(new Set<HTMLElement>());
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    mounted.current.add(node);
    setElement(node);
    return () => {
      mounted.current.delete(node);
      setElement(current => current === node ? [...mounted.current].at(-1) ?? null : current);
    };
  }, []);
  return [element, attach] as const;
}
export function SessionReader({ siblings }: { siblings: SessionRow[] }) {
  const host = useSessionsHost(), data = host.get(), panes = data.reading ? [data.reading, ...data.also] : [], root = useRef<HTMLDivElement>(null), catalog = getGlobals().agentCatalog.agents;
  const [focused, setFocused] = useState<number | null>(() => data.reading?.slot ?? null), [width, setWidth] = useState(innerWidth);
  // How the conversations are arranged; a session dropped somewhere waits here until the host has opened it.
  const [columns, setColumns] = useState<PaneColumns>([]), [dropped, setDropped] = useState<{ key: string; target: number; edge: PaneEdge } | null>(null);
  const slots = panes.map(pane => pane.slot), droppedSlot = dropped ? panes.find(pane => pane.key === dropped.key)?.slot ?? null : null;
  const placed = useMemo(() => reconcile(columns, slots, dropped && droppedSlot !== null ? { slot: droppedSlot, target: dropped.target, edge: dropped.edge } : null), [columns, slots.join(), droppedSlot]);
  useLayoutEffect(() => {
    if (JSON.stringify(placed) !== JSON.stringify(columns)) setColumns(placed);
    if (dropped && droppedSlot !== null) { setFocused(droppedSlot); setDropped(null); }
  });
  // The side columns push the panes rather than lie over them. When both would leave a pane too narrow, the one opened last
  // stays and the other steps aside until there is room again; a window too small for even one gets it over the panes.
  const [navShown, setNavShown] = useState(savedNav), [navTab, setNavTab] = useState<NavTab>("outline"), [navAsk, setNavAsk] = useState(0), [outlineElement, setOutlineElement] = useColumnTarget();
  const [sideShown, setSideShown] = useState(savedSide), [sideElement, setSideElement] = useColumnTarget(), last = useRef<"nav" | "side">("nav");
  const room = (taken: number) => (width - taken - 12 * Math.max(placed.length, 1)) / Math.max(placed.length, 1) >= PANE_FLOOR;
  const bothFit = room(NAV_WIDTH + SIDE_WIDTH);
  const navUp = navShown && (!sideShown || bothFit || last.current === "nav"), sideUp = sideShown && (!navShown || bothFit || last.current === "side");
  const navOver = navUp && !room(NAV_WIDTH), sideOver = sideUp && !room(SIDE_WIDTH);
  const setNav = (open: boolean) => { if (open) last.current = "nav"; setNavShown(open); try { localStorage.setItem(NAV_KEY, open ? "open" : "closed"); } catch { /* This visit only. */ } };
  const setSide = (open: boolean) => { if (open) last.current = "side"; rememberSide(open); setSideShown(open); };
  const openNav = (tab: NavTab) => { setNavTab(tab); setNav(true); };
  useReadingChrome();
  useEffect(() => host.holdAll(), []);
  useEffect(() => { const target = root.current; if (!target) return; const observer = new ResizeObserver(entries => { const next = entries[0].contentRect.width; setWidth(previous => paneWidthBand(previous, WIDTH_EDGES) === paneWidthBand(next, WIDTH_EDGES) ? previous : next); }); observer.observe(target); return () => observer.disconnect(); }, []);
  const current = panes.some(pane => pane.slot === focused) ? focused : panes[0]?.slot ?? null, currentKey = panes.find(pane => pane.slot === current)?.key ?? "";
  const canAdd = panes.length < PANE_MAX && width / (placed.length + 1) >= PANE_MIN;
  const split = panes.length > 1;
  const widens = () => width / (placed.length + 1) >= PANE_MIN;
  const { drag, pointerX, pointerY, press, settled } = usePaneDrag<PaneSource>({
    allow: (source, slot, edge) => {
      const column = placed[columnOf(placed, slot)] ?? [];
      if (source.kind === "pane") {
        if (source.slot === slot) return false;
        if (edge === "center") return true;
        if (edge === "left" || edge === "right") return placed[columnOf(placed, source.slot)]?.length === 1 || widens();
        return column.includes(source.slot) || column.length < COLUMN_PANES;
      }
      if (edge === "center") return true;
      if (panes.length >= PANE_MAX) return false;
      return edge === "left" || edge === "right" ? widens() : column.length < COLUMN_PANES;
    },
    onDrop: (source, target: PaneTarget) => {
      if (source.kind === "pane") { setColumns(previous => placePane(previous, source.slot, target.slot, target.edge)); setFocused(source.slot); return; }
      if (target.edge === "center") { host.readInSlot(target.slot, source.session); setFocused(target.slot); return; }
      setDropped({ key: source.session.key, target: target.slot, edge: target.edge }); host.readAlso(source.session);
    },
  });
  useEffect(() => { if (drag?.landing && drag.source.kind === "pane") settled(); }, [drag]);
  const open = useRef(panes); open.current = panes;
  const pressRow = useCallback((event: PointerEvent<Element>, session: SessionRow) => {
    const already = open.current.find(pane => pane.key === session.key);
    if (already && open.current.length < 2) return;
    press(event, already ? { kind: "pane", slot: already.slot } : { kind: "session", session }, ".ff-side-actions");
  }, [press]);
  const openHere = useCallback((session: SessionRow) => { if (current !== null) host.readInSlot(current, session); }, [host, current]);
  const openBeside = useCallback((session: SessionRow) => { host.readAlso(session); }, [host]);
  const focusOpen = useCallback((key: string) => setFocused(open.current.find(pane => pane.key === key)?.slot ?? null), []);
  const askNav = useCallback(() => setNavAsk(count => count + 1), []);
  const others = panes.filter(pane => pane.slot !== current).map(pane => pane.key);
  const nav = <ReaderNav tab={navTab} onTab={setNavTab} outline={<div ref={setOutlineElement} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2" data-reader-outline />}
    sessions={<SessionNav current={currentKey} open={others.join()} canAdd={canAdd} ask={navAsk} onOpen={openHere} onBeside={openBeside} onFocusOpen={focusOpen} onPress={pressRow} />} />;
  const sideSlot = <div ref={setSideElement} className="flex min-w-0 flex-1" data-reader-dock />;
  const move = (slot: number, how: PaneMove) => setColumns(previous => movePane(previous, slot, how));
  const movesOf = (slot: number) => {
    const at = columnOf(placed, slot), stacked = placed[at]?.length > 1, beside = placed[at + 1] ?? placed[at - 1];
    return [
      { label: "向左移", disabled: at <= 0 && !stacked, onSelect: () => move(slot, "left") },
      { label: "向右移", disabled: at >= placed.length - 1 && !stacked, onSelect: () => move(slot, "right") },
      stacked ? { label: "单独成一栏", onSelect: () => move(slot, "unstack") } : { label: "放到旁边一栏下方", disabled: !beside || beside.length >= COLUMN_PANES, onSelect: () => move(slot, "stack") },
    ];
  };
  const held = drag && !drag.landing ? drag : null, heldSession = drag?.source.kind === "session" ? drag.source.session : null;
  const zoneLabel = held?.target ? held.target.edge === "center" ? held.source.kind === "pane" ? "交换位置" : "在这一栏打开" : PLACES[held.target.edge] : undefined;
  // The controls that belong to the window sit in its title bar, one of each however many panes are open.
  const start = <>
    <span data-reader-back><Button variant="ghost" size="compact" leadingIcon={IconArrowLeft} aria-label="返回会话列表" onClick={() => host.read(null)}>{"会话列表"}</Button></span>
    <span title={navUp ? "隐藏目录和会话" : "目录和会话  O"} data-reader-nav-toggle><IconButton icon={IconListTree} size="compact" label={navUp ? "隐藏目录和会话" : "显示目录和会话"} onClick={() => setNav(!navUp)} /></span>
  </>, end = <span title={sideUp ? "隐藏这次会话" : "这次会话"} data-reader-side-toggle><IconButton icon={IconLayoutSidebarRight} size="compact" label={sideUp ? "隐藏这次会话" : "这次会话"} onClick={() => setSide(!sideUp)} /></span>;
  const startBar = document.getElementById("titlebarPageStart"), endBar = document.getElementById("titlebarPageEnd"), inTitle = Boolean(window.windowBridge && startBar && endBar);
  return <div ref={root} className="relative flex h-full min-w-0 flex-col" data-reader-panes={panes.length} data-reader-columns={placed.length}>
    {inTitle ? <>{createPortal(start, startBar!)}{createPortal(end, endBar!)}</> : <div className="flex shrink-0 items-center gap-1 pb-2">{start}<span className="flex-1" />{end}</div>}
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <SidePanel open={navUp && !navOver}><ResizableBox storageKey="agentusage.reader.nav-width.v1" initial={NAV_WIDTH} min={200} max={360} edge="right" className="pr-3" aria-label="调整左栏宽度">{nav}</ResizableBox></SidePanel>
      <SlideOver open={navUp && navOver} from="left" className="absolute inset-y-0 left-0 z-30 flex w-72"><div className="flex min-w-0 flex-1 rounded-2xl bg-card p-3 shadow-surface-5">{nav}</div></SlideOver>
      <PaneGrid columns={placed} target={held?.target ?? null} label={zoneLabel}>
        {panes.map((pane, at) => <PaneCell key={pane.slot} slot={pane.slot} columns={placed} lifted={held?.source.kind === "pane" && held.source.slot === pane.slot} pointerX={pointerX} pointerY={pointerY}>
          <Appear skip={at === 0} from="right" className="h-full min-w-0"><div className="h-full" onPointerDownCapture={() => setFocused(pane.slot)} onFocusCapture={() => setFocused(pane.slot)}>
            <ReaderPane reading={pane} siblings={siblings} split={split} leading={at === 0} focused={current === pane.slot} otherPanes={panes.filter(item => item.slot !== pane.slot).map(item => item.key)} canAdd={canAdd}
              nav={{ shown: navUp, tab: navTab, element: outlineElement, open: openNav, ask: askNav }} sideColumn={{ shown: sideUp, element: sideElement, set: setSide }} onPress={event => press(event, { kind: "pane", slot: pane.slot }, "button, a, input")} moves={movesOf(pane.slot)} />
          </div></Appear>
        </PaneCell>)}
      </PaneGrid>
      <SidePanel open={sideUp && !sideOver} className="-my-2 -mr-2 py-2 pr-2"><ResizableBox storageKey="agentusage.reader.side-width.v1" initial={SIDE_WIDTH} min={308} max={DOCK_MAX} edge="left" className="pl-3" aria-label="调整右栏宽度">{sideSlot}</ResizableBox></SidePanel>
      <SlideOver open={sideUp && sideOver} className="absolute inset-y-0 right-0 z-30 flex w-80">{sideSlot}</SlideOver>
    </div>
    {heldSession ? <PaneGhost drag={drag} pointerX={pointerX} pointerY={pointerY} onSettled={settled}>
      <div className="flex h-11 shrink-0 items-center gap-1.5 px-3"><AgentMark agent={heldSession.agent} variant="icon" size={16} /><span className="min-w-0 flex-1 truncate text-caption font-medium text-foreground">{heldSession.name || heldSession.project || catalog[heldSession.agent]?.name}</span></div>
    </PaneGhost> : null}
  </div>;
}
