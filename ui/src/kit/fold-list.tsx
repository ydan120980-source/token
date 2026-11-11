import { useEffect, useId, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent } from "motion/react";
import { IconChevronRight } from "@tabler/icons-react";
import { reducedFade, rubberband, spring } from "@ui/design/motion";
import { useKitMotion } from "./motion-mode";

// Grouped rows that fold (sessions by project). A group's head row and its rows share one 12-column
// grid, so the columns line up across groups. No rules: groups stand apart by space, rows that open
// something light up under the pointer. A head folds from its chevron button (keyboard) or a click
// anywhere on the head outside its own buttons; the body grows and shrinks with spring.moderate and
// cross-fades under reduced motion.

export interface FoldColumn { key: string; span: 1 | 2 | 3 | 4 | 5 | 6; align?: "start" | "end" }
export interface FoldRow { key: string; cells: Record<string, ReactNode>; onOpen?: () => void; attributes?: Record<string, string> }
export interface FoldGroup {
  key: string; label: string; open: boolean; onOpenChange: (open: boolean) => void;
  head: Record<string, ReactNode>; rows: FoldRow[]; footer?: ReactNode; attributes?: Record<string, string>;
}

const spans = { 1: "col-span-1", 2: "col-span-2", 3: "col-span-3", 4: "col-span-4", 5: "col-span-5", 6: "col-span-6" };
const interactive = "button, a, input, select, textarea, [role=button]";

function Cells({ columns, cells, first }: { columns: FoldColumn[]; cells: Record<string, ReactNode>; first?: ReactNode }) {
  return <>{columns.map((column, index) => <div key={column.key} data-fold-cell={column.key}
    className={spans[column.span] + " flex min-w-0 items-center gap-2 " + (column.align === "end" ? "justify-end text-right" : "")}>
    {index === 0 && first !== undefined ? first : cells[column.key]}
  </div>)}</>;
}

function Group({ group, columns }: { group: FoldGroup; columns: FoldColumn[] }) {
  const id = useId(), { full, fade } = useKitMotion();
  const toggle = () => group.onOpenChange(!group.open);
  const enter = full ? { height: 0, opacity: 0 } : fade ? { opacity: 0 } : false;
  return <section data-fold-group={group.key} data-open={group.open} className="flex flex-col" {...group.attributes}>
    <div data-fold-head className="grid min-h-12 cursor-pointer grid-cols-12 items-center gap-x-3 rounded-xl px-2 hover:bg-hover"
      onClick={event => { if (!(event.target as Element).closest(interactive)) toggle(); }}>
      <Cells columns={columns} cells={group.head} first={<button type="button" aria-expanded={group.open} aria-controls={id} aria-label={group.label}
        onClick={toggle} className="flex min-w-0 items-center gap-2 rounded-lg text-left outline-none focus-visible:ring-1 focus-visible:ring-ring">
        <IconChevronRight size={16} aria-hidden className={"shrink-0 text-muted-foreground transition-transform duration-160 " + (group.open ? "rotate-90" : "")} />
        {group.head[columns[0].key]}
      </button>} />
    </div>
    <AnimatePresence initial={false}>
      {group.open ? <motion.div key="body" id={id} role="group" aria-label={group.label} className="overflow-hidden"
        initial={enter} animate={full ? { height: "auto", opacity: 1 } : { opacity: 1 }}
        exit={full ? { height: 0, opacity: 0, transition: spring.moderate.exit } : fade ? { opacity: 0, transition: reducedFade } : undefined}
        transition={full ? spring.moderate : reducedFade}>
        {group.rows.map(row => <div key={row.key} data-fold-row={row.key} {...row.attributes}
          className={"grid min-h-12 grid-cols-12 items-center gap-x-3 rounded-xl px-2 " + (row.onOpen ? "cursor-pointer hover:bg-hover" : "")}
          onClick={row.onOpen ? event => { if (!(event.target as Element).closest(interactive)) row.onOpen!(); } : undefined}>
          <Cells columns={columns} cells={row.cells} first={<span className="flex min-w-0 items-center gap-2 pl-6">{row.cells[columns[0].key]}</span>} />
        </div>)}
        {group.footer ? <div className="pb-2 pl-8">{group.footer}</div> : null}
      </motion.div> : null}
    </AnimatePresence>
  </section>;
}

/**
 * A table row that opens in place, for a list whose rows have more to say than a line (Agent 管理, owner 2026-11-05). Its name is the
 * control, a click on the row outside its own controls does the same, and the cells line up with OpenTableHead's.
 */
export function OpenRow({ id, open, onToggle, title, aside, lines, cells, between, children, attributes }: { id: string; open: boolean; onToggle: () => void; title: ReactNode; aside?: ReactNode; lines?: ReactNode; cells: ReactNode[]; between?: ReactNode; children: ReactNode; attributes?: Record<string, string | undefined> }) {
  const click = (event: MouseEvent) => { if (!(event.target as Element).closest(interactive + ", [role=switch], [role=checkbox]")) onToggle(); };
  return <div role="listitem" className="flex min-w-0 flex-col rounded-xl" data-open={open || undefined} {...attributes}>
    <div className="ff-open-grid cursor-pointer items-start rounded-xl p-3 hover:bg-hover" onClick={click}>
      <div className="flex min-w-0 flex-col gap-1">
        <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className="flex min-w-0 items-start gap-2 rounded-lg text-left outline-none focus-visible:ring-1 focus-visible:ring-ring">
          <IconChevronRight size={16} aria-hidden="true" className={"mt-0.5 shrink-0 text-muted-foreground transition-transform duration-160 " + (open ? "rotate-90" : "")} />
          {title}{aside}
        </button>
        {lines ? <div className="flex min-w-0 flex-col gap-1 pl-6">{lines}</div> : null}
      </div>
      {cells}
    </div>
    {between}
    <Collapse open={open} id={id} aria-label={typeof attributes?.["aria-label"] === "string" ? attributes["aria-label"] : undefined}>{children}</Collapse>
  </div>;
}
/** The column names above OpenRow's cells. */
export function OpenTableHead({ cells }: { cells: ReactNode[] }) {
  return <div className="ff-open-grid items-center px-3 py-2 text-caption text-muted-foreground" aria-hidden="true">{cells}</div>;
}

/** A pill that folds a panel elsewhere on the row (a source's read locations, its parsing coverage). */
export function PillToggle({ open, onToggle, controls, children }: { open: boolean; onToggle: () => void; controls: string; children: ReactNode }) {
  return <button type="button" aria-expanded={open} aria-controls={controls} onClick={onToggle}
    className="inline-flex h-7 min-w-0 items-center gap-1 rounded-full bg-muted px-3 text-caption text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
    <span className="truncate">{children}</span>
    <IconChevronRight size={14} aria-hidden className={"shrink-0 transition-transform duration-160 " + (open ? "-rotate-90" : "rotate-90")} />
  </button>;
}

/** A panel that grows open and shrinks closed (spring.moderate), cross-fading under reduced motion. */
export function Collapse({ open, id, children, "aria-label": label }: { open: boolean; id: string; children: ReactNode; "aria-label"?: string }) {
  const { full, fade } = useKitMotion();
  return <AnimatePresence initial={false}>
    {open ? <motion.div key="panel" id={id} role="region" aria-label={label} className="overflow-hidden"
      initial={full ? { height: 0, opacity: 0 } : fade ? { opacity: 0 } : false} animate={full ? { height: "auto", opacity: 1 } : { opacity: 1 }}
      exit={full ? { height: 0, opacity: 0, transition: spring.moderate.exit } : fade ? { opacity: 0, transition: reducedFade } : undefined}
      transition={full ? spring.moderate : reducedFade}>{children}</motion.div> : null}
  </AnimatePresence>;
}

/** A column that opens sideways and pushes its neighbour along; its content keeps its width while it moves. */
export function SidePanel({ open, className = "", children }: { open: boolean; className?: string; children: ReactNode }) {
  const { full, fade } = useKitMotion();
  return <AnimatePresence initial={false}>
    {open ? <motion.div key="panel" className={"flex shrink-0 justify-end overflow-hidden " + className}
      initial={full ? { width: 0, opacity: 0 } : fade ? { opacity: 0 } : false} animate={full ? { width: "auto", opacity: 1 } : { opacity: 1 }}
      exit={full ? { width: 0, opacity: 0, transition: spring.moderate.exit } : fade ? { opacity: 0, transition: reducedFade } : undefined}
      transition={full ? spring.moderate : reducedFade}>{children}</motion.div> : null}
  </AnimatePresence>;
}
/** A panel that slides over what is under it, from the side it leaves by. */
export function SlideOver({ open, from = "right", className = "", children }: { open: boolean; from?: "left" | "right"; className?: string; children: ReactNode }) {
  const { full, fade } = useKitMotion(), x = from === "left" ? -24 : 24;
  return <AnimatePresence initial={false}>
    {open ? <motion.div key="over" className={className}
      initial={full ? { opacity: 0, x } : fade ? { opacity: 0 } : false} animate={{ opacity: 1, x: 0 }}
      exit={full ? { opacity: 0, x, transition: spring.moderate.exit } : fade ? { opacity: 0, transition: reducedFade } : undefined}
      transition={full ? spring.moderate : reducedFade}>{children}</motion.div> : null}
  </AnimatePresence>;
}
const savedWidth = (key: string, initial: number, min: number, max: number) => { try { const value = Number(localStorage.getItem(key)); return value ? Math.min(max, Math.max(min, value)) : initial; } catch { return initial; } };
const STEP = 16;
/**
 * A column the person sizes: dragged 1:1 from where it was grabbed, resisting past its limits and settling back on release;
 * arrow keys step, Home and End reach the limits, a double click returns to the default. The width stays in this window's storage.
 */
export function ResizableBox({ storageKey, initial, min, max, edge, className = "", "aria-label": label, children }: { storageKey: string; initial: number; min: number; max: number; edge: "left" | "right"; className?: string; "aria-label": string; children: ReactNode }) {
  const width = useMotionValue(savedWidth(storageKey, initial, min, max)), [now, setNow] = useState(() => Math.round(width.get())), { full } = useKitMotion();
  const [grab, setGrab] = useState<{ id: number; x: number; from: number } | null>(null), sign = edge === "right" ? 1 : -1;
  useMotionValueEvent(width, "change", value => setNow(Math.round(value)));
  useEffect(() => () => { document.body.classList.remove("sidebar-resizing"); }, []);
  const save = (value: number) => { try { if (value === initial) localStorage.removeItem(storageKey); else localStorage.setItem(storageKey, String(value)); } catch { /* This visit only. */ } };
  const settle = (value: number) => { const end = Math.round(Math.min(max, Math.max(min, value))); save(end); if (full) void animate(width, end, spring.moderate); else width.set(end); };
  const down = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setGrab({ id: event.pointerId, x: event.clientX, from: width.get() }); document.body.classList.add("sidebar-resizing"); };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (grab?.id !== event.pointerId) return;
    const wanted = grab.from + (event.clientX - grab.x) * sign, bound = Math.min(max, Math.max(min, wanted));
    width.set(bound + rubberband(wanted - bound, 200));
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => { if (grab?.id !== event.pointerId) return; setGrab(null); document.body.classList.remove("sidebar-resizing"); settle(width.get()); };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const value = width.get(), grow = event.key === (edge === "right" ? "ArrowRight" : "ArrowLeft"), shrink = event.key === (edge === "right" ? "ArrowLeft" : "ArrowRight");
    const next = grow ? value + STEP : shrink ? value - STEP : event.key === "Home" ? min : event.key === "End" ? max : null;
    if (next === null) return;
    event.preventDefault(); event.stopPropagation(); settle(next);
  };
  return <motion.div className={"relative flex h-full shrink-0 " + className} style={{ width }} data-resizable>
    {children}
    <div role="separator" aria-orientation="vertical" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={now} tabIndex={0} title="拖动调整宽度，双击恢复默认"
      className={"ff-resize-handle " + (edge === "right" ? "right-0" : "left-0")} data-dragging={grab ? "" : undefined}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key} onDoubleClick={() => settle(initial)} />
  </motion.div>;
}
export function FoldList({ columns, groups, "aria-label": label }: { columns: FoldColumn[]; groups: FoldGroup[]; "aria-label": string }) {
  return <div role="list" aria-label={label} data-fold-list className="flex flex-col gap-2">
    {groups.map(group => <div role="listitem" key={group.key}><Group group={group} columns={columns} /></div>)}
  </div>;
}
