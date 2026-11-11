import type { TranscriptItem } from "@ui/data";

// Turns of a conversation for the reading view, after CC Switch's reader (MIT): the person's question, the
// process the Agent went through (thinking, tools, notes, injected context) and its final reply, which is
// its last text with no tool call after it. A turn's process folds into one line; failed tools stay listed.
export interface ReaderTurn {
  index: number;
  /** Its number as a person counts: the questions so far; 0 for what comes before the first question. */
  number: number;
  /** Where the Agent compacted its context during this turn. */
  compacts: number[];
  /** The person's messages and images that open the turn; empty for what comes before the first question. */
  question: number[];
  process: number[];
  final: number | null;
  failures: number[];
  steps: number; tools: number; failed: number;
  /** Tokens the record reports for this turn; null when it reports none (never 0 for unknown). */
  tokens: number | null;
  /** The first and last item of the turn (a turn's items are consecutive). */
  from: number; to: number;
}
/** A turn's process as it reads: what the Agent said stays on the page, and the steps between folds into one line each. */
export type TurnSegment = { kind: "note"; index: number } | { kind: "steps"; key: number; indices: number[]; tools: number; failures: number[] };
const says = (item: TranscriptItem) => item.kind === "assistant" && !item.side;
export function turnSegments(items: TranscriptItem[], turn: ReaderTurn): TurnSegment[] {
  const segments: TurnSegment[] = [];
  let run: number[] = [];
  const flush = () => {
    if (!run.length) return;
    const tools = run.filter(index => items[index].kind === "tool");
    segments.push({ kind: "steps", key: run[0], indices: run, tools: tools.length, failures: tools.filter(index => items[index].tool?.error) });
    run = [];
  };
  for (const index of turn.process) { if (says(items[index])) { flush(); segments.push({ kind: "note", index }); } else run.push(index); }
  flush();
  return segments;
}
/** The fold that holds an item, or null when it stands on the page. */
export function segmentOf(items: TranscriptItem[], turn: ReaderTurn, index: number) {
  for (const segment of turnSegments(items, turn)) if (segment.kind === "steps" && segment.indices.includes(index)) return segment;
  return null;
}
/** Open all steps that touched a file. Partition each affected turn once, even
 * when the same file was edited hundreds of times within that turn. These
 * request-local sets contain indices only and are discarded after the click. */
export function processExpansion(items: TranscriptItem[], turns: ReaderTurn[], turnOf: Int32Array, indices: number[]) {
  const wanted = new Set(indices), affected = new Set(indices.map(index => turnOf[index]));
  const processes: number[] = [], runs: string[] = [];
  for (const index of affected) {
    const turn = turns[index];
    for (const segment of turnSegments(items, turn)) if (segment.kind === "steps" && segment.indices.some(at => wanted.has(at))) processes.push(segment.key);
    for (const part of processParts(items, turn)) if (part.kind !== "item" && part.indices.some(at => wanted.has(at))) runs.push(part.key);
  }
  return { processes, runs };
}
/** A process as shown: single items, and runs of the same tool called again and again folded as one. */
export type ProcessPart = { kind: "item"; index: number } | { kind: "run"; key: string; name: string; indices: number[] } | { kind: "agent"; key: string; indices: number[] };
const RUN = 3;

// A sub-agent's prompt is a step of the turn, not the person's own question.
const asks = (item: TranscriptItem) => !item.side && (item.kind === "user" || (item.kind === "image" && item.from === "user"));

export function buildTurns(items: TranscriptItem[]): ReaderTurn[] {
  const turns: ReaderTurn[] = [];
  let question: number[] = [], body: number[] = [], asked = 0;
  const close = () => {
    if (!question.length && !body.length) return;
    let final: number | null = null;
    for (let at = body.length - 1; at >= 0; at--) {
      const item = items[body[at]];
      if (item.kind === "tool" || item.side) break;
      if (item.kind === "assistant") { final = body[at]; break; }
    }
    const compacts: number[] = [], process: number[] = [], failures: number[] = [];
    let steps = 0, tools = 0;
    for (const index of body) {
      const item = items[index];
      if (item.kind === "compact") { compacts.push(index); continue; }
      if (index === final) continue;
      process.push(index);
      if (!says(item)) steps++;
      if (item.kind === "tool") { tools++; if (item.tool?.error) failures.push(index); }
    }
    if (question.length) asked++;
    // A turn owns consecutive item indices. Do not spread a large turn into
    // function arguments (V8's argument limit is below the supported 500K), or
    // copy all its indices again just to find endpoints and reported usage.
    const from = question[0] ?? body[0], to = body.at(-1) ?? question[question.length - 1];
    let tokens: number | null = null;
    for (let index = from; index <= to; index++) { const value = items[index].usage; if (value !== undefined) tokens = (tokens ?? 0) + value; }
    turns.push({ index: turns.length, number: question.length ? asked : 0, compacts, question, process, final, failures, steps, tools, failed: failures.length, from, to, tokens });
    question = []; body = [];
  };
  items.forEach((item, index) => {
    if (asks(item)) { if (body.length) close(); question.push(index); }
    else body.push(index);
  });
  close();
  return turns;
}

/** Three or more calls of one tool in a row, none failed, read as one line ("Read · 5 次"), like CC Switch's
 * "Called X N times"; a failed call always stands on its own. */
export function processParts(items: TranscriptItem[], turn: Pick<ReaderTurn, "index" | "process">): ProcessPart[] {
  const parts: ProcessPart[] = [];
  let run: number[] = [], agent: number[] = [];
  const flushAgent = () => { if (agent.length) parts.push({ kind: "agent", key: "agent:" + agent[0], indices: agent }); agent = []; };
  const flush = () => {
    if (run.length >= RUN) parts.push({ kind: "run", key: turn.index + ":" + run[0], name: items[run[0]].tool!.name, indices: run });
    else for (const index of run) parts.push({ kind: "item", index });
    run = [];
  };
  for (const index of turn.process) {
    const item = items[index];
    if (item.side) {
      flush();
      if (agent.length && items[agent[0]].side !== item.side) flushAgent();
      agent.push(index); continue;
    }
    flushAgent();
    const same = item.kind === "tool" && !item.tool?.error;
    if (same && run.length && items[run[0]].tool!.name === item.tool!.name) { run.push(index); continue; }
    flush();
    if (same) run.push(index); else parts.push({ kind: "item", index });
  }
  flush(); flushAgent();
  return parts;
}

/** The outline's line for a turn: the first line of its question. */
export function turnLabel(items: TranscriptItem[], turn: ReaderTurn) {
  const first = turn.question.map(index => items[index]).find(item => item.kind === "user");
  if (!first) return turn.question.length ? "图片" : "开头";
  if (first.label) return first.label;
  const line = (first.text ?? "").split("\n").find(part => part.trim()) ?? "";
  return line.trim().replace(/^#{1,6}\s+/, "").slice(0, 80) || "提问";
}

/** A turn's opening time as the outline and the page show it, and the pause before it when it is a long one. */
export interface TurnMoment { time: string | null; gap: string | null }
const PAUSE = 30 * 60000;
const clock = (date: Date) => String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
const dayOf = (date: Date) => date.getFullYear() + "-" + date.getMonth() + "-" + date.getDate();
function pause(ms: number) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return "隔了 " + minutes + " 分钟";
  const hours = Math.round(minutes / 60);
  return hours < 24 ? "隔了 " + hours + " 小时" : "隔了 " + Math.round(hours / 24) + " 天";
}
const known = (items: TranscriptItem[], from: number, to: number) => {
  for (let at = from; from <= to ? at <= to : at >= to; at += from <= to ? 1 : -1) { const time = items[at]?.time ? Date.parse(items[at].time!) : NaN; if (!Number.isNaN(time)) return time; }
  return null;
};
/** An item without a time reads as nothing rather than a guess. */
export function turnMoments(items: TranscriptItem[], turns: ReaderTurn[], now = new Date()): TurnMoment[] {
  let lastEnd: number | null = null, lastDay = dayOf(now);
  return turns.map(turn => {
    const start = known(items, turn.from, turn.to), end = known(items, turn.to, turn.from);
    let time: string | null = null, gap: string | null = null;
    if (start !== null) {
      const date = new Date(start), day = dayOf(date);
      time = (day === lastDay ? "" : (date.getMonth() + 1) + "/" + date.getDate() + " ") + clock(date);
      lastDay = day;
      if (lastEnd !== null && start - lastEnd >= PAUSE) gap = pause(start - lastEnd);
    }
    if (end !== null) lastEnd = end;
    return { time, gap };
  });
}
/** About how much of the page a turn takes: its question and reply as written, its folded process as one line. */
export function turnWeight(items: TranscriptItem[], turn: ReaderTurn) {
  const size = (index: number) => items[index].length ?? items[index].text?.length ?? 80;
  let content = 0;
  for (const index of turn.question) content += size(index);
  for (const index of turn.process) if (says(items[index])) content += size(index);
  return 80 + (turn.steps ? 60 : 0) + content + (turn.final === null ? 0 : size(turn.final));
}
export const turnName = (turn: ReaderTurn) => turn.number ? "第 " + turn.number + " 轮" : "开头";
export const isShell = (name: string) => /^(shell|bash|exec|local_shell|powershell|run_shell_command|run_command)/i.test(name);
export const shortTokens = (value: number) => value >= 1e6 ? (value / 1e6).toFixed(1) + "M" : value >= 1e3 ? (value / 1e3).toFixed(1) + "K" : String(value);
/** The commands a session ran, each with the item it belongs to: one call may run several (Codex's code mode). */
export function ranCommands(items: TranscriptItem[]) {
  const list: { index: number; text: string; failed: boolean }[] = [];
  items.forEach((item, index) => { if (item.kind !== "tool" || !item.tool) return; for (const text of item.tool.commands ?? (isShell(item.tool.name) ? [item.tool.summary] : [])) list.push({ index, text, failed: item.tool.error }); });
  return list;
}
/** The files a session changed through its edit tools, in first-touched order; a failed call changed nothing. */
export interface ChangedFile { path: string; kind: "add" | "delete" | "edit"; added: number; removed: number; calls: number; indices: number[] }
export function changedFiles(items: TranscriptItem[]) {
  const files = new Map<string, ChangedFile>();
  items.forEach((item, index) => {
    if (item.kind !== "tool" || item.tool?.error) return;
    for (const file of item.tool?.change?.files ?? []) {
      const entry: ChangedFile = files.get(file.path) ?? { path: file.path, kind: file.kind === "add" ? "add" : "edit", added: 0, removed: 0, calls: 0, indices: [] };
      // A file written whole may have existed before: only an explicit add reads as new, and the last delete or re-add stands.
      if (file.kind === "delete") entry.kind = "delete"; else if (entry.kind === "delete") entry.kind = file.kind === "add" ? "add" : "edit";
      entry.added += file.added; entry.removed += file.removed; entry.calls++; entry.indices.push(index);
      files.set(file.path, entry);
    }
  });
  return [...files.values()];
}
/** Changed files as a tree under the session's working directory. A folder holding only one folder reads as one line. */
export interface FileNode { key: string; name: string; file: ChangedFile | null; children: FileNode[]; added: number; removed: number; count: number }
export function relativePath(path: string, root?: string | null) {
  const from = path.replace(/\\/g, "/"), base = root?.replace(/\\/g, "/").replace(/\/+$/, "");
  return base && from.toLowerCase().startsWith(base.toLowerCase() + "/") ? from.slice(base.length + 1) : from;
}
export function fileTree(files: ChangedFile[], root?: string | null): FileNode[] {
  const top: FileNode = { key: "", name: "", file: null, children: [], added: 0, removed: 0, count: 0 };
  for (const file of files) {
    const parts = relativePath(file.path, root).split("/").filter(Boolean), trail = [top];
    let node = top, key = "";
    parts.forEach((name, at) => {
      key += "/" + name;
      if (at === parts.length - 1) { node.children.push({ key, name, file, children: [], added: file.added, removed: file.removed, count: 1 }); return; }
      let next = node.children.find(child => !child.file && child.name === name);
      if (!next) { next = { key, name, file: null, children: [], added: 0, removed: 0, count: 0 }; node.children.push(next); }
      node = next; trail.push(next);
    });
    for (const step of trail) { step.added += file.added; step.removed += file.removed; step.count++; }
  }
  const settle = (nodes: FileNode[]): FileNode[] => nodes.map(node => {
    if (node.file) return node;
    const inner = settle(node.children);
    return inner.length === 1 && !inner[0].file ? { ...inner[0], name: node.name + "/" + inner[0].name } : { ...node, children: inner };
  }).sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name));
  return settle(top.children);
}
/** Consecutive entries of one turn, for lists that read turn by turn. */
export function byTurn<T extends { index: number }>(entries: T[], turnOf: Int32Array) {
  const groups: { turn: number; entries: T[] }[] = [];
  for (const entry of entries) { const turn = turnOf[entry.index], last = groups[groups.length - 1]; if (last?.turn === turn) last.entries.push(entry); else groups.push({ turn, entries: [entry] }); }
  return groups;
}
