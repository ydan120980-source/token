import { useMemo, useState, type RefObject } from "react";
import { IconAlertTriangle, IconFolder, IconListDetails, IconListTree, IconTerminal2, IconX } from "@tabler/icons-react";
import { Button, CopyButton, DiffCount, EmptyState, FileMark, IconButton, Marquee, SearchField, SideRow, TreeChevron, WindowedItem, WindowedList, fileNameTone, useHoverCard, TipCard } from "@ui/kit";
import { useSessionsHost, type TranscriptItem } from "@ui/data";
import { FileHistory } from "./file-history";
import { byTurn, fileTree, ranCommands, relativePath, turnLabel, turnName, type ChangedFile, type FileNode, type ReaderTurn } from "./turns";

// The right column's lists, in the density of Codex's change tree (owner 2026-11-04, UI-READER-NAV-20261104.md): Codex's files
// are the reference; commands and failures read turn by turn in the same rows.
const ROWS = 200, LONG = 100;

function useFolds<T>() {
  const [shut, setShut] = useState(() => new Set<T>());
  return { isOpen: (key: T) => !shut.has(key), toggle: (key: T) => setShut(previous => { const next = new Set(previous); if (!next.delete(key)) next.add(key); return next; }) };
}
function TurnHead({ turn, items, count, open, onToggle }: { turn: ReaderTurn; items: TranscriptItem[]; count: number; open: boolean; onToggle: () => void }) {
  const label = turnLabel(items, turn);
  return <SideRow lead={<TreeChevron open={open} />} expanded={open} onClick={onToggle} tail={count} title={label} attributes={{ "data-side-turn": String(turn.index) }}>
    <span className="flex min-w-0 gap-2"><span className="shrink-0 font-medium">{turnName(turn)}</span><span className="min-w-0 truncate text-muted-foreground">{label}</span></span>
  </SideRow>;
}
function Summary({ icon, label, aside }: { icon: typeof IconTerminal2; label: string; aside: React.ReactNode }) {
  const Icon = icon;
  return <SideRow lead={<Icon size={16} className="text-muted-foreground" aria-hidden />} tail={aside}><span className="font-medium">{label}</span></SideRow>;
}

/** What the session ran, turn by turn, each line with its own program first. */
export function CommandsTab({ items, turns, turnOf, onGo, scrollRoot }: { items: TranscriptItem[]; turns: ReaderTurn[]; turnOf: Int32Array; onGo: (index: number) => void; scrollRoot: RefObject<HTMLDivElement | null> }) {
  const host = useSessionsHost(), [query, setQuery] = useState(""), [limit, setLimit] = useState(ROWS), [current, setCurrent] = useState<string | null>(null), needle = query.trim().toLowerCase(), folds = useFolds<number>(), { bind, layer } = useHoverCard();
  const all = useMemo(() => ranCommands(items), [items]), shown = useMemo(() => needle ? all.filter(entry => entry.text.toLowerCase().includes(needle)) : all, [all, needle]);
  const failed = useMemo(() => all.filter(entry => entry.failed).length, [all]);
  const groups = useMemo(() => byTurn(shown.slice(0, limit).map((entry, at) => ({ ...entry, key: entry.index + ":" + at, position: at })), turnOf), [shown, limit, turnOf]);
  return <section className="flex min-w-0 flex-col gap-2" data-reader-side-list="commands">
    <SearchField value={query} onChange={value => { setQuery(value.slice(0, 120)); setLimit(ROWS); }} maxLength={120} placeholder="筛选命令…" aria-label="筛选命令" variant="filled" />
    <div className="flex min-w-0 flex-col">
      <Summary icon={IconTerminal2} label="所有命令" aside={<>{failed ? <span className="ff-count-del" data-commands-failed>{failed + " 失败"}</span> : null}<span>{all.length + " 条"}</span></>} />
      <WindowedList root={scrollRoot} enabled={shown.length > LONG}>{groups.map(group => { const open = folds.isOpen(group.turn); return <div key={group.turn} className="flex min-w-0 flex-col">
        <TurnHead turn={turns[group.turn]} items={items} count={group.entries.length} open={open} onToggle={() => folds.toggle(group.turn)} />
        {open ? group.entries.map(entry => { const program = entry.text.match(/^\S+/)?.[0] ?? ""; return <WindowedItem key={entry.key} index={entry.position} estimate={32} pinned={current === entry.key}><SideRow level={1} selected={current === entry.key} rowProps={entry.text.length > LONG ? bind(entry.key, <TipCard title={turnName(turns[group.turn])} note={entry.text.slice(0, 1200)} />, "left") : undefined}
          lead={entry.failed ? <IconX size={14} className="ff-count-del" role="img" aria-label="失败" /> : <span className="w-3.5 text-center font-mono text-muted-foreground" aria-hidden>{"$"}</span>}
          onClick={() => { setCurrent(entry.key); onGo(entry.index); }} attributes={{ "data-outline-item": entry.key, "data-command-failed": entry.failed ? "" : undefined }}
          actions={<CopyButton size="compact" label="复制这条命令" onCopy={() => host.copyText(entry.text)} />}>
          <span className="line-clamp-3 wrap-anywhere font-mono" data-command-text><span className="font-medium">{program}</span><span className="text-muted-foreground">{entry.text.slice(program.length)}</span></span>
        </SideRow></WindowedItem>; }) : null}
      </div>; })}</WindowedList>
    </div>
    {!shown.length ? <span className="px-2 text-caption text-muted-foreground">{all.length ? "没有匹配的命令" : "这次会话没有跑命令"}</span> : null}
    {shown.length > limit ? <Button variant="tertiary" size="compact" onClick={() => setLimit(limit + ROWS)}>{"再显示 " + Math.min(ROWS, shown.length - limit) + " 条（共 " + shown.length + " 条）"}</Button> : null}
    {layer}
  </section>;
}

/** What failed, turn by turn: the tool, what it was asked, and the first thing its output said. */
export function FailuresTab({ items, turns, turnOf, failures, onGo }: { items: TranscriptItem[]; turns: ReaderTurn[]; turnOf: Int32Array; failures: number[]; onGo: (index: number) => void }) {
  const host = useSessionsHost(), [query, setQuery] = useState(""), [limit, setLimit] = useState(ROWS), [current, setCurrent] = useState<number | null>(null), needle = query.trim().toLowerCase(), folds = useFolds<number>();
  const entries = useMemo(() => failures.map(index => { const tool = items[index].tool!; return { index, name: tool.name, summary: tool.summary, said: tool.output?.split("\n").map(line => line.trim()).find(Boolean)?.slice(0, 240) ?? "" }; }), [failures, items]);
  const shown = useMemo(() => needle ? entries.filter(entry => [entry.name, entry.summary, entry.said].some(text => text.toLowerCase().includes(needle))) : entries, [entries, needle]);
  const groups = useMemo(() => byTurn(shown.slice(0, limit), turnOf), [shown, limit, turnOf]);
  if (!failures.length) return <EmptyState message="这次会话没有失败的步骤。" />;
  const spread = new Set(failures.map(index => turnOf[index])).size;
  return <section className="flex min-w-0 flex-col gap-2" data-reader-side-list="failures">
    {failures.length > 5 ? <SearchField value={query} onChange={value => { setQuery(value.slice(0, 120)); setLimit(ROWS); }} maxLength={120} placeholder="筛选失败…" aria-label="筛选失败" variant="filled" /> : null}
    <div className="flex min-w-0 flex-col">
      <Summary icon={IconAlertTriangle} label={failures.length + " 次失败"} aside={"涉及 " + spread + " 轮"} />
      {groups.map(group => { const open = folds.isOpen(group.turn); return <div key={group.turn} className="flex min-w-0 flex-col">
        <TurnHead turn={turns[group.turn]} items={items} count={group.entries.length} open={open} onToggle={() => folds.toggle(group.turn)} />
        {open ? group.entries.map(entry => <SideRow key={entry.index} level={1} selected={current === entry.index} title={entry.summary}
          lead={<IconX size={14} className="ff-count-del" aria-hidden />} onClick={() => { setCurrent(entry.index); onGo(entry.index); }} attributes={{ "data-outline-item": String(entry.index) }}
          actions={<CopyButton size="compact" label="复制这条失败" onCopy={() => host.copyText([entry.summary, entry.said].filter(Boolean).join("\n"))} />}
          below={<>
            {entry.summary && entry.summary !== entry.name ? <span className="line-clamp-2 wrap-anywhere font-mono text-muted-foreground">{entry.summary}</span> : null}
            {entry.said ? <span className="ff-count-del line-clamp-2 wrap-anywhere font-mono" data-failure-said>{entry.said}</span> : null}
          </>}>
          <span className="font-medium">{entry.name}</span>
        </SideRow>) : null}
      </div>; })}
    </div>
    {!shown.length ? <span className="px-2 text-caption text-muted-foreground">{"没有匹配的失败"}</span> : null}
    {shown.length > limit ? <Button variant="tertiary" size="compact" onClick={() => setLimit(limit + ROWS)}>{"再显示 " + Math.min(ROWS, shown.length - limit) + " 条（共 " + shown.length + " 条）"}</Button> : null}
  </section>;
}

const KIND_WORDS: Record<ChangedFile["kind"], string> = { add: "新增", delete: "删除", edit: "修改" };
/** A changed file: its name in full, wrapped when it must be. The name's colour and the card say what kind of change. */
function FileRow({ entry, name, below, level, file, onFile, bind }: { entry: ChangedFile; name: string; below?: string; level: number; file: string | null; onFile: (path: string) => void; bind: ReturnType<typeof useHoverCard>["bind"] }) {
  const rows = [{ key: "kind", label: "状态", value: KIND_WORDS[entry.kind] }, { key: "calls", label: "改动", value: entry.calls + " 次" }, { key: "lines", label: "行数", value: <DiffCount added={entry.added} removed={entry.removed} /> }];
  return <SideRow level={level} selected={file === entry.path} onClick={() => onFile(entry.path)} lead={<FileMark path={entry.path} />} aria-label={name + "，" + KIND_WORDS[entry.kind]}
    tail={<DiffCount added={entry.added} removed={entry.removed} />} attributes={{ "data-outline-item": entry.path, "data-file-kind": entry.kind }}
    rowProps={bind("file:" + entry.path, <TipCard title={entry.path} rows={rows} />, "left")}
    below={below ? <span className="wrap-anywhere text-muted-foreground" data-file-folder>{below}</span> : undefined}>
    <span className={"block wrap-anywhere " + fileNameTone(entry.kind)} data-file-name>{name}</span>
  </SideRow>;
}
// A folder tree or one flat list, for this run: flat gives the name the whole row.
let flatFiles = false;
function Branch({ nodes, level, folds, file, onFile, bind, positions }: { nodes: FileNode[]; level: number; folds: ReturnType<typeof useFolds<string>>; file: string | null; onFile: (path: string) => void; bind: ReturnType<typeof useHoverCard>["bind"]; positions: Map<FileNode, number> }) {
  return <>{nodes.map(node => {
    if (!node.file) { const open = folds.isOpen(node.key); return <WindowedItem key={node.key} index={positions.get(node)!} estimate={32 * (node.count + 1)} pinned={false}><div className="flex min-w-0 flex-col" data-file-dir={node.key}>
      <SideRow level={level} lead={<TreeChevron open={open} />} expanded={open} onClick={() => folds.toggle(node.key)} title={node.name}><Marquee text={node.name} title={node.name} /></SideRow>
      {open ? <Branch nodes={node.children} level={level + 1} folds={folds} file={file} onFile={onFile} bind={bind} positions={positions} /> : null}
    </div></WindowedItem>; }
    return <WindowedItem key={node.key} index={positions.get(node)!} estimate={32} pinned={file === node.file.path}><FileRow entry={node.file} name={node.name} level={level} file={file} onFile={onFile} bind={bind} /></WindowedItem>;
  })}</>;
}
/** The files the session changed, after Codex's change tree: its workspace, a filter, all changes, then the folders. */
export function FilesTab({ files, file, onFile, onAll, cwd, project, sessionKey, slot, canOpen, historyAsk, scrollRoot }: { files: ChangedFile[]; file: string | null; onFile: (path: string) => void; onAll: () => void; cwd: string | null; project: string | null; sessionKey: string; slot: number; canOpen: boolean; historyAsk: number; scrollRoot: RefObject<HTMLDivElement | null> }) {
  const [query, setQuery] = useState(""), needle = query.trim().toLowerCase(), folds = useFolds<string>(), { bind, layer } = useHoverCard();
  const shown = useMemo(() => needle ? files.filter(entry => relativePath(entry.path, cwd).toLowerCase().includes(needle)) : files, [files, needle, cwd]);
  const tree = useMemo(() => fileTree(shown.slice(0, ROWS), cwd), [shown, cwd]);
  const positions = useMemo(() => { const map = new Map<FileNode, number>(); const visit = (nodes: FileNode[]) => { for (const node of nodes) { map.set(node, map.size); visit(node.children); } }; visit(tree); return map; }, [tree]);
  const added = useMemo(() => files.reduce((sum, entry) => sum + entry.added, 0), [files]), removed = useMemo(() => files.reduce((sum, entry) => sum + entry.removed, 0), [files]);
  const chosen = file ? files.find(entry => entry.path === file) ?? null : null, open = folds.isOpen(":root"), [flat, setFlat] = useState(flatFiles);
  if (!files.length) return <EmptyState message="这次会话没有通过编辑工具改文件。" />;
  return <section className="flex min-h-full min-w-0 flex-col gap-2" data-reader-side-list="files">
    {project ? <div className="flex h-9 min-w-0 shrink-0 items-center gap-2 rounded-xl bg-muted px-3 text-caption text-foreground" title={cwd ?? project} data-files-workspace><IconFolder size={16} className="shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate">{project}</span></div> : null}
    <div className="flex shrink-0 items-center gap-1">
      <div className="min-w-0 flex-1"><SearchField value={query} onChange={value => setQuery(value.slice(0, 120))} maxLength={120} placeholder="筛选文件…" aria-label="筛选文件" variant="filled" /></div>
      <span data-files-layout data-flat={flat || undefined}><IconButton icon={flat ? IconListTree : IconListDetails} label={flat ? "按文件夹显示" : "平铺显示"} onClick={() => { flatFiles = !flat; setFlat(!flat); }} /></span>
    </div>
    <div className="flex min-w-0 flex-1 flex-col">
      <SideRow lead={<IconListDetails size={16} className="text-muted-foreground" aria-hidden />} selected={!file} onClick={onAll} tail={<DiffCount added={added} removed={removed} />} attributes={{ "data-files-all": "" }}><span className="font-medium">{"所有更改"}</span></SideRow>
      <SideRow lead={<TreeChevron open={open} />} expanded={open} onClick={() => folds.toggle(":root")} tail={files.length} attributes={{ "data-files-root": "" }}>{"已更改的文件"}</SideRow>
      <WindowedList root={scrollRoot} enabled={shown.length > 40}>{open ? flat ? shown.slice(0, ROWS).map((entry, index) => { const parts = relativePath(entry.path, cwd).split("/"); return <WindowedItem key={entry.path} index={index} estimate={52} pinned={file === entry.path}><FileRow entry={entry} name={parts[parts.length - 1]} below={parts.slice(0, -1).join("/")} level={0} file={file} onFile={onFile} bind={bind} /></WindowedItem>; }) : <Branch nodes={tree} level={1} folds={folds} file={file} onFile={onFile} bind={bind} positions={positions} /> : null}</WindowedList>
      {!shown.length ? <span className="px-2 py-1 text-caption text-muted-foreground">{"没有匹配的文件"}</span> : null}
      {shown.length > ROWS ? <span className="px-2 py-1 text-caption text-muted-foreground">{"只列出前 " + ROWS + " 个"}</span> : null}
    </div>
    {chosen ? <div className="sticky bottom-0 flex min-w-0 flex-col bg-card" data-file-chosen>
      <FileHistory key={chosen.path} sessionKey={sessionKey} path={chosen.path} slot={slot} canOpen={canOpen} ask={historyAsk} />
    </div> : null}
    {layer}
  </section>;
}
