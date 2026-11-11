import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import { IconArrowsDiagonal, IconArrowsDiagonalMinimize2, IconLayoutSidebar, IconLayoutSidebarRight } from "@tabler/icons-react";
import { portalRoot } from "@/lib/portal-root";
import { reducedFade, spring } from "@ui/design/motion";
import { IconButton } from "./controls";
import { ScrollArea } from "./surfaces";
import { useKitMotion } from "./motion-mode";
import { isComposing } from "./ime";
import type { ChartTone } from "./charts/tones";

export function Reveal({ trigger, content, "aria-label": label }: { trigger: ReactNode; content: ReactNode; "aria-label": string }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), id = useId(), [position, setPosition] = useState({ left: 8, top: 8 }), { mode } = useKitMotion();
  useLayoutEffect(() => { if (!open) return; const anchor = root.current, element = panel.current; if (!anchor || !element) return; const place = () => { const box = anchor.getBoundingClientRect(), width = element.offsetWidth, height = element.offsetHeight; setPosition({ left: Math.max(8, Math.min(innerWidth - width - 8, box.left)), top: box.bottom + 8 + height <= innerHeight - 8 ? box.bottom + 8 : Math.max(8, box.top - height - 8) }); }; place(); const resize = new ResizeObserver(place); resize.observe(element); const close = () => setOpen(false); window.addEventListener("scroll", close, true); window.addEventListener("resize", place); return () => { resize.disconnect(); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", place); }; }, [open]);
  return <><button ref={root} type="button" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined} className="inline-flex cursor-pointer items-baseline gap-2 rounded-lg text-left text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring" onPointerEnter={() => setOpen(true)} onPointerLeave={() => { if (document.activeElement !== root.current) setOpen(false); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)} onKeyDown={event => { if (!isComposing(event) && event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } }}>{trigger}</button>{createPortal(<AnimatePresence>{open ? <motion.div ref={panel} id={id} role="tooltip" className="pointer-events-none fixed z-50 flex flex-col gap-2 rounded-xl bg-surface-3 p-3 text-caption text-foreground shadow-surface-3" style={{ ...position, maxWidth: innerWidth - 16 }} initial={mode === "off" ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={mode === "off" ? undefined : { opacity: 0 }} transition={spring.fast}>{content}</motion.div> : null}</AnimatePresence>, portalRoot())}</>;
}

/** Actions on what is selected, floating at the bottom of the page while there is a selection. */
export function ActionBar({ open, "aria-label": label, children }: { open: boolean; "aria-label": string; children: ReactNode }) {
  const { full, fade } = useKitMotion();
  return <AnimatePresence initial={false}>
    {open ? <motion.div key="bar" role="toolbar" aria-label={label} data-action-bar className="ff-action-bar sticky bottom-4 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-2xl px-3 py-2"
      initial={full ? { opacity: 0, y: 16 } : fade ? { opacity: 0 } : false} animate={{ opacity: 1, y: 0 }}
      exit={full ? { opacity: 0, y: 16, transition: spring.moderate.exit } : fade ? { opacity: 0, transition: reducedFade } : undefined}
      transition={full ? spring.slow : reducedFade}>{children}</motion.div> : null}
  </AnimatePresence>;
}
/** Things side by side: a label column, then one column each. Rows are made of cells on one shared grid. */
export function CompareGrid({ columns, compact = false, "aria-label": label, children }: { columns: number; compact?: boolean; "aria-label": string; children: ReactNode }) {
  return <div role="table" aria-label={label} data-compare className={"grid items-start " + (compact ? "gap-x-2" : "gap-x-4")} style={{ gridTemplateColumns: (compact ? "56px" : "minmax(88px, 120px)") + " repeat(" + columns + ", minmax(0, 1fr))" }}>{children}</div>;
}
export function CompareRow({ label, cells, section = false, head = false, compact = false, attributes }: { label: ReactNode; cells: ReactNode[]; section?: boolean; head?: boolean; compact?: boolean; attributes?: Record<string, string> }) {
  const stuck = head ? " sticky top-0 z-10 bg-card" : "";
  return <div role="row" className="contents" {...attributes}>
    <div role="rowheader" className={section ? "col-span-full min-w-0 text-foreground " + (compact ? "pt-2 text-caption font-semibold" : "pt-6 pb-1 text-body font-semibold") : "self-stretch py-2 text-caption text-muted-foreground" + stuck}>{label}</div>
    {section ? null : cells.map((cell, index) => <div key={index} role="cell" className={"min-w-0 py-2 text-foreground tabular-nums " + (compact ? "truncate text-caption" : "text-body") + stuck}>{cell}</div>)}
  </div>;
}
export function Ticket({ tone, title, figure, caption, muted = false }: { tone: ChartTone; title: ReactNode; figure: ReactNode; caption?: ReactNode; muted?: boolean }) {
  return <div data-ticket data-tone={tone} data-muted={muted || undefined} className="relative flex min-w-0 flex-col pt-5 text-foreground">
    <svg width="100%" height={20} viewBox="0 0 320 20" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-x-0 top-0 fill-surface-2"><path d="M0 20V12Q0 0 12 0H104C130 0 136 9 160 9C184 9 190 0 216 0H308Q320 0 320 12V20Z"/></svg>
    <div className="relative flex min-w-0 items-baseline justify-between gap-2 bg-surface-2 px-4 pb-4"><span className={(muted ? "text-muted-foreground" : "text-foreground") + " text-caption"}>{title}</span><span className={(muted ? "text-muted-foreground" : "text-foreground") + " text-subtitle font-semibold tabular-nums"}>{figure}</span></div>{caption ? <div className="relative bg-surface-2 px-4 pb-4 text-caption text-muted-foreground">{caption}</div> : null}
  </div>;
}

type Pane = { key: string; title: string; node: ReactNode; actions?: ReactNode; fixed?: boolean };
function PaneSurface({ pane, collapsed, narrow, wide, onToggle }: { pane: Pane; collapsed: boolean; narrow: boolean; wide: boolean; onToggle: () => void }) {
  const { full } = useKitMotion(), grow = useMotionValue(collapsed && !narrow ? 0 : 1);
  useLayoutEffect(() => { const target = collapsed && !narrow ? 0 : 1; if (!full) { grow.set(target); return; } const control = animate(grow, target, spring.slow); return () => control.stop(); }, [collapsed, narrow, full, grow]);
  const expanded = narrow || !collapsed, actionLabel = collapsed ? "展开" + pane.title : wide ? "恢复两栏" : "把" + pane.title + "放大到整行";
  return <motion.section data-pane={pane.key} data-collapsed={collapsed && !narrow || undefined} className="relative flex min-w-0 flex-col gap-3" style={{ flexGrow: grow, flexBasis: 0, minWidth: narrow ? 0 : 56 }}>
    <div className={expanded ? "flex min-h-9 items-center gap-3" : "absolute inset-0 flex flex-col items-center gap-4 rounded-2xl bg-surface-3 py-4"}>
      <h2 className="whitespace-nowrap text-title font-semibold text-foreground" style={expanded ? undefined : { writingMode: "vertical-rl", order: 2 }}>{pane.title}</h2>
      {expanded ? pane.actions : null}{!narrow ? <div title={actionLabel} className={expanded ? "ml-auto" : undefined}><IconButton icon={collapsed ? IconArrowsDiagonal : IconArrowsDiagonalMinimize2} label={actionLabel} onClick={onToggle}/></div> : null}
    </div>
    <div inert={!expanded} aria-hidden={!expanded} className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-surface-3 p-5" style={{ height: narrow && !pane.fixed ? "auto" : 520, minHeight: narrow ? 408 : undefined, visibility: expanded ? "visible" : "hidden", overflowAnchor: "none" }}>{pane.fixed ? <div className="flex min-h-0 flex-1 flex-col" data-pane-body>{pane.node}</div> : narrow ? pane.node : <ScrollArea maxHeight="fill" aria-label={pane.title}><div className="flex min-h-full flex-col" data-pane-body>{pane.node}</div></ScrollArea>}</div>
  </motion.section>;
}
export function PaneGroup({ panes, collapsed, onCollapsedChange }: { panes: Pane[]; collapsed: string | null; onCollapsedChange: (key: string | null) => void }) {
  const root = useRef<HTMLDivElement>(null), [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => { const element = root.current; if (!element) return; const resize = new ResizeObserver(() => setNarrow(element.clientWidth <= 760)); resize.observe(element); setNarrow(element.clientWidth <= 760); return () => resize.disconnect(); }, []);
  return <div ref={root} data-pane-group data-narrow={narrow || undefined} className={"flex items-stretch gap-4 " + (narrow ? "flex-col" : "flex-row")}>{panes.map(pane => <PaneSurface key={pane.key} pane={pane} narrow={narrow} wide={Boolean(collapsed && collapsed !== pane.key)} collapsed={collapsed === pane.key} onToggle={() => onCollapsedChange(collapsed && collapsed !== pane.key ? null : panes.find(item => item.key !== pane.key)?.key ?? null)}/>)}</div>;
}

export function EdgeTrigger({ side, label, onOpen }: { side: "left" | "right"; label: string; onOpen: () => void }) {
  const [shown, setShown] = useState(false), { mode } = useKitMotion();
  return <div data-edge-trigger={side} className={"fixed inset-y-0 z-40 flex items-center " + (side === "left" ? "left-0" : "right-0")} style={{ width: 24 }} onPointerEnter={() => setShown(true)} onPointerLeave={event => { if (!event.currentTarget.contains(document.activeElement)) setShown(false); }} onFocus={() => setShown(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setShown(false); }}><motion.div initial={false} animate={{ opacity: shown ? 1 : 0 }} transition={spring.fast} style={mode === "off" ? { opacity: shown ? 1 : 0 } : undefined}><IconButton icon={side === "left" ? IconLayoutSidebar : IconLayoutSidebarRight} label={label} onClick={onOpen}/></motion.div></div>;
}
