import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { animate, motion, useMotionValue } from "motion/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Badge as FluidBadge } from "@/components/ui/badge";
import { Banner as FluidBanner, bannerMotion } from "@/components/ui/banner";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { fontWeights } from "@/lib/font-weight";
import { ScrollArea as FluidScrollArea } from "@/components/ui/scroll-area";
import { spring } from "@ui/design/motion";
import { isComposing } from "./ime";
import { useKitMotion } from "./motion-mode";

const FOCUSABLE = "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex=\"-1\"])";
interface SheetProps {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; size?: "sm" | "lg" | "xl"; footer?: ReactNode; scrollable?: boolean; placement?: "center" | "left" | "right"; dismissDrag?: boolean; children: ReactNode;
  /** A side sheet that floats as a whole card, inset from the window edges (owner 2026-10-28). */
  floating?: boolean;
  /** Shown before the title in a tile, and a line under it (a floating detail card). */
  icon?: ReactNode; subtitle?: ReactNode;
}
// The widget column (window-shell.js) docks or floats on the right: body.summary-docked / summary-floating.
function subscribeBody(listener: () => void) { const observer = new MutationObserver(listener); observer.observe(document.body, { attributes: true, attributeFilter: ["class"] }); return () => observer.disconnect(); }
const widgetsOpen = () => !document.body.classList.contains("session-reading") && (document.body.classList.contains("summary-docked") || document.body.classList.contains("summary-floating"));
// Every sheet stays inside the window and scrolls its body (owner 2026-11-01: the price editor's 43 candidates
// pushed its tabs and save button off-screen); scrollable={false} is the opt-out for a sheet known to be short.
export function Sheet({ open, onOpenChange, title, description, size = "sm", footer, scrollable = true,
  placement = "center", dismissDrag = false, floating = false, icon, subtitle, children }: SheetProps) {
  const lastOpen = useRef(false), trigger = useRef<HTMLElement | null>(null);
  const presentation = useRef({ placement, size });
  // A floating detail card on the right moves to the left while the widget column is open, so it never
  // covers the widgets; opening the column with the card shown moves it over (owner 2026-10-29).
  const widgets = useSyncExternalStore(subscribeBody, widgetsOpen);
  if (open) presentation.current = { placement: placement === "right" && floating && widgets ? "left" : placement, size };
  const shownPlacement = presentation.current.placement, shownSize = presentation.current.size;
  const panel = useRef<HTMLDivElement>(null), shift = useMotionValue(0), { full } = useKitMotion(), [viewport, setViewport] = useState(innerWidth), dragging = useRef<{ id: number; start: number; previous: number; time: number; velocity: number } | null>(null), snap = useRef<ReturnType<typeof animate> | null>(null);
  const side = shownPlacement !== "center", bounded = scrollable || side, width = Math.min(viewport, floating && side ? (shownSize === "sm" ? 360 : 440) : shownSize === "sm" ? 400 : shownSize === "lg" ? 540 : 880), direction = shownPlacement === "left" ? -1 : 1;
  useEffect(() => { const resize = () => setViewport(innerWidth); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
  useLayoutEffect(() => { const write = (value: number) => { if (panel.current) panel.current.style.translate = value + "px 0"; }; write(shift.get()); return shift.on("change", write); }, [shift, open]);
  useEffect(() => { if (!open || !full) { snap.current?.stop(); shift.set(0); dragging.current = null; } }, [open, full, shift]);
  useEffect(() => () => { snap.current?.stop(); const element = panel.current, id = dragging.current?.id; if (element && id !== undefined && element.hasPointerCapture(id)) element.releasePointerCapture(id); }, []);
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => { const held = dragging.current; if (!held || held.id !== event.pointerId) return; dragging.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (event.type === "pointerup" && (Math.abs(shift.get()) > width / 3 || held.velocity * direction > 500)) { onOpenChange(false); return; } snap.current?.stop(); if (full) snap.current = animate(shift, 0, spring.slow); else shift.set(0); };
  const descriptionId = useId();
  if (open && !lastOpen.current) trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  lastOpen.current = open;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent key={shownPlacement + shownSize} ref={panel} size={shownSize} slideFrom={side ? shownPlacement as "left" | "right" : undefined} edgeAttached={side && !floating} data-sheet-placement={shownPlacement} className={bounded ? (side ? floating ? "flex flex-col rounded-2xl" : "flex h-dvh flex-col" : "ff-sheet-scrollable flex flex-col") : undefined} style={side ? floating ? { width, maxWidth: width, height: "calc(100dvh - 60px)", top: "calc(50% + 22px)", left: shownPlacement === "left" ? 16 + width / 2 : "auto", right: shownPlacement === "right" ? 16 - width / 2 : undefined } : { width, maxWidth: width, left: shownPlacement === "left" ? width / 2 : "auto", right: shownPlacement === "right" ? -width / 2 : undefined } : undefined} closeLabel="关闭" aria-describedby={description ? descriptionId : undefined}
      onPointerDown={event => { if (!side || !dismissDrag || event.button !== 0 || !(event.target as Element).closest("[data-sheet-drag]")) return; snap.current?.stop(); dragging.current = { id: event.pointerId, start: event.clientX, previous: event.clientX, time: performance.now(), velocity: 0 }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { const held = dragging.current; if (!held || held.id !== event.pointerId) return; const now = performance.now(); held.velocity = (event.clientX - held.previous) / Math.max(1, now - held.time) * 1000; held.previous = event.clientX; held.time = now; shift.set(direction * Math.max(0, (event.clientX - held.start) * direction)); }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { if (dragging.current) { dragging.current = null; if (full) snap.current = animate(shift, 0, spring.slow); else shift.set(0); } }}
      // Escape that confirms or cancels an input-method candidate is not a request to close.
      onEscapeKeyDown={(event: KeyboardEvent) => { if (isComposing(event)) event.preventDefault(); }}
      // Focus moves to the first control without scrolling: the browser's own scroll-into-view on that
      // focus also scrolls the window behind the fixed sheet when the page is long.
      onOpenAutoFocus={(event: Event) => { const first = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(FOCUSABLE); if (first) { event.preventDefault(); first.focus({ preventScroll: true }); } }}
      onCloseAutoFocus={event => { if (trigger.current?.isConnected) { event.preventDefault(); trigger.current.focus({ preventScroll: true }); } }}>
      <DialogHeader data-sheet-drag={side && dismissDrag ? "" : undefined} className={bounded ? "shrink-0" : undefined}>{icon || subtitle ? <div className="flex min-w-0 items-center gap-3 pr-10">
        {icon ? <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted">{icon}</span> : null}
        <div className="flex min-w-0 flex-col gap-0.5"><DialogTitle title={title} className="truncate">{title}</DialogTitle>{subtitle ? <span className="truncate text-caption text-muted-foreground">{subtitle}</span> : null}</div>
      </div> : <DialogTitle title={title}>{title}</DialogTitle>}{description ? <DialogDescription id={descriptionId}>{description}</DialogDescription> : null}</DialogHeader>
      <div data-sheet-body className={"flex flex-col gap-3 text-body text-foreground" + (bounded ? " -mx-2 min-h-0 overflow-y-auto overflow-x-hidden px-2" : "") + (side ? " flex-1" : "")}>{children}</div>
      {footer ? <DialogFooter data-sheet-footer className={bounded ? "shrink-0" : undefined}>{footer}</DialogFooter> : null}
    </DialogContent>
  </Dialog>;
}

export function Disclosure({ open, defaultOpen = false, onOpenChange, summary, actions, flush = false, children }: {
  open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; summary: ReactNode; actions?: ReactNode; /** Lined up with the rest of its card. */ flush?: boolean; children: ReactNode;
}) {
  const [localOpen, setLocalOpen] = useState(defaultOpen), id = useId();
  const expanded = open ?? localOpen;
  // fluid sizes an accordion to w-72; a disclosure spans its container.
  return <Accordion className={"w-full" + (flush ? " ff-disclosure-flush" : "")} type="single" collapsible value={expanded ? id : ""} onValueChange={(value: string) => { const next = value === id; setLocalOpen(next); onOpenChange?.(next); }}>
    <AccordionItem value={id}>{actions ? <div className="flex items-center gap-3"><div className="min-w-0 flex-1"><AccordionTrigger>{summary}</AccordionTrigger></div><div className="flex shrink-0 items-center gap-2">{actions}</div></div> : <AccordionTrigger>{summary}</AccordionTrigger>}<AccordionContent>{children}</AccordionContent></AccordionItem>
  </Accordion>;
}

export function Badge({ tone, children }: { tone: "neutral" | "warn"; children: ReactNode }) {
  return <FluidBadge color={tone === "warn" ? "amber" : "gray"}>{children}</FluidBadge>;
}
const bannerTransitions = {
  appear: { ...bannerMotion.appear, row: spring.moderate, banner: spring.moderate },
  dismiss: { ...bannerMotion.dismiss, row: spring.moderate.exit },
};
export function Banner({ tone, title, children, action }: { tone: "info" | "warn" | "error"; title?: string; children: ReactNode; action?: ReactNode }) {
  return <FluidBanner status={tone === "warn" ? "warning" : tone} motion={bannerTransitions}>
    <div className="flex items-center gap-3"><div className="flex flex-col gap-2">{title ? <span className="font-semibold text-body">{title}</span> : null}<div className="text-body">{children}</div></div>{action}</div>
  </FluidBanner>;
}

// title keeps a cell's existing native hover reading (spec section 7); it adds no hover card.
export interface Column<Row> {
  key: string; label: string; header?: ReactNode; render: (row: Row) => ReactNode;
  title?: (row: Row) => string | undefined; headerTitle?: string;
}
// onRowClick is a pointer convenience only: the keyboard path is a Button inside the row.
// variant "plain" draws no rules (Apple-style surfaces, owner 2026-10-29): a quiet header, rows apart by
// spacing only, and groupStart opens a little space above the first row of each group.
export function DataTable<Row>({ columns, rows, rowKey, onRowClick, size, rowEmphasis, variant = "ruled", groupStart }: { columns: Column<Row>[]; rows: Row[];
  rowKey: (row: Row) => string; onRowClick?: (row: Row) => void; size?: "default" | "compact";
  rowEmphasis?: (row: Row) => boolean; variant?: "ruled" | "plain"; groupStart?: (row: Row) => boolean }) {
  const plain = variant === "plain";
  return <div className="min-w-0 overflow-x-auto"><Table size={size}><TableHeader><TableRow className={plain ? "border-transparent" : undefined}>{columns.map(column => <TableHead key={column.key} title={column.headerTitle}
    className={"whitespace-nowrap" + (plain ? " pb-2 text-caption text-muted-foreground" : "")}>{column.header ?? column.label}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{rows.map((row, index) => <TableRow key={rowKey(row)} index={index} data-row-key={rowKey(row)}
      className={[onRowClick ? "cursor-pointer" : "", plain ? "border-transparent" : ""].join(" ").trim() || undefined}
      onClick={onRowClick ? event => { if (!(event.target as HTMLElement).closest("button, a, input, select, textarea")) onRowClick(row); } : undefined}>
      {columns.map(column => <TableCell key={column.key} title={column.title?.(row)}
        className={[rowEmphasis?.(row) ? "text-foreground" : "", index > 0 && groupStart?.(row) ? "pt-4" : ""].join(" ").trim() || undefined}
        style={rowEmphasis?.(row) ? { fontVariationSettings: fontWeights.semibold } : undefined}>
        {column.render(row)}
      </TableCell>)}</TableRow>)}</TableBody>
  </Table></div>;
}

export function TreeBranch() {
  return <svg data-list-branch width={34} height={18} viewBox="0 0 34 18" aria-hidden="true"
    className="shrink-0 overflow-visible stroke-border" fill="none">
    <path d="M9 0V26 M9 0V4C9 7.2 11.2 9.5 14.5 9.5H28" />
  </svg>;
}
export function ListRow({ leading, title, meta, trailing, onClick, selected, multiline = false, level = 0 }: { leading?: ReactNode; title: ReactNode; meta?: ReactNode; trailing?: ReactNode; onClick?: () => void; selected?: boolean; multiline?: boolean; level?: 0 | 1 }) {
  const content = <>{level === 1 ? <TreeBranch /> : null}{leading}<span className="flex flex-1 items-center gap-2 text-left"><span className="text-subtitle">{title}</span>{meta ? <span className="text-caption text-muted-foreground">{meta}</span> : null}</span>{trailing}</>;
  const classes = "flex w-full items-center gap-2 border-b border-border text-foreground " + (multiline ? "min-h-9 " : "h-9 ") + (selected ? "bg-selected" : "bg-transparent");
  return onClick ? <button type="button" className={classes} style={{ outlineColor: "var(--focus-ring)" }} aria-pressed={Boolean(selected)} onClick={onClick}>{content}</button> : <div className={classes}>{content}</div>;
}
/** A long document's outline: one line per part, the current one selected; choosing one jumps there.
 * It stays in view while the document beside it scrolls. */
type OutlineEntry = { key: string; label: string; meta?: string; time?: string; flag?: string; before?: string; marked?: boolean; lead?: ReactNode };
const OutlineRow = memo(function OutlineRow({ item, selected, onSelect, pill, full, mono }: { item: OutlineEntry; selected: boolean; onSelect: (key: string) => void; pill: string; full: boolean; mono: boolean }) {
  return <Fragment>{item.before ? <span className="px-2 pt-2 text-micro text-muted-foreground" data-outline-gap>{item.before}</span> : null}<button type="button" onClick={() => onSelect(item.key)} aria-current={selected ? "true" : undefined} data-outline-item={item.key} data-marked={item.marked || undefined}
      className={"relative flex min-w-0 flex-col rounded-lg px-2 py-1.5 text-left text-caption outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring " + (item.marked ? "bg-selected text-foreground" : selected ? "text-foreground" : "text-muted-foreground")}>
      {selected ? <motion.span aria-hidden layoutId={full ? pill : undefined} className="absolute inset-0 rounded-lg bg-selected" transition={spring.moderate} /> : null}
      <span className={"relative flex min-w-0 gap-2 " + (item.lead ? "items-center" : "items-baseline")}>
        {item.lead ? <span className="flex shrink-0 items-center">{item.lead}</span> : null}
        {item.time ? <time className="shrink-0 text-micro tabular-nums text-muted-foreground">{item.time}</time> : null}
        <span className={"line-clamp-2 min-w-0 flex-1 break-words" + (mono ? " font-mono" : "")}>{item.label}</span>
        {item.flag ? <span className="size-1.5 shrink-0 self-center rounded-full bg-warning" title={item.flag} role="img" aria-label={item.flag} data-outline-flag /> : null}
      </span>
      {item.meta ? <span className="relative text-micro text-muted-foreground">{item.meta}</span> : null}
    </button></Fragment>;
});
export function OutlineNav({ items, active, onSelect, fill = true, mono = false, "aria-label": label }: { items: OutlineEntry[]; active: string | null; onSelect: (key: string) => void; fill?: boolean; mono?: boolean; "aria-label": string }) {
  const root = useRef<HTMLElement>(null), pill = useId(), { full } = useKitMotion();
  const latestSelect = useRef(onSelect);
  useLayoutEffect(() => { latestSelect.current = onSelect; });
  const select = useCallback((key: string) => latestSelect.current(key), []);
  // The current part stays in view inside the outline; only the outline scrolls, never the page around it.
  useEffect(() => {
    const nav = root.current, item = active === null ? null : nav?.querySelector<HTMLElement>('[data-outline-item="' + CSS.escape(active) + '"]');
    if (!nav || !item) return;
    if (item.offsetTop < nav.scrollTop) nav.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > nav.scrollTop + nav.clientHeight) nav.scrollTop = item.offsetTop + item.offsetHeight - nav.clientHeight;
  }, [active]);
  return <motion.nav ref={root} layoutScroll aria-label={label} className={(fill ? "ff-reader-outline " : "") + "flex flex-col gap-0.5"} data-outline>
    {items.map(item => <OutlineRow key={item.key} item={item} selected={item.key === active} onSelect={select} pill={pill} full={full} mono={mono} />)}
  </motion.nav>;
}
/** A search result that opens what it found: a heading line (lead, title, meta, aside) over the matching
 * lines, each a label and the text around the match with the match marked. */
export function ResultRow({ lead, title, meta, aside, lines, onClick, "aria-label": label }: {
  lead?: ReactNode; title: string; meta?: string; aside?: string; lines: { key: string; label: string; before: string; match: string; after: string }[]; onClick: () => void; "aria-label": string;
}) {
  return <button type="button" onClick={onClick} aria-label={label} data-result-row
    className="flex w-full min-w-0 cursor-pointer flex-col gap-1 rounded-xl px-2 py-2 text-left outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring">
    <span className="flex w-full min-w-0 items-center gap-2 text-caption">
      {lead}<span className="min-w-0 truncate font-medium text-foreground">{title}</span>
      {meta ? <span className="shrink-0 text-muted-foreground">{meta}</span> : null}
      {aside ? <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{aside}</span> : null}
    </span>
    {lines.map(line => <span key={line.key} className="flex min-w-0 gap-2 pl-6 text-caption text-muted-foreground" data-result-line>
      <span className="w-10 shrink-0">{line.label}</span>
      <span className="min-w-0 truncate">{line.before}<mark className="rounded-lg bg-selected px-0.5 text-foreground">{line.match}</mark>{line.after}</span>
    </span>)}
  </button>;
}
// One setting: its name and an optional explanation on the left, its control on the right.
export function SettingRow({ title, description, control }: { title: ReactNode; description?: ReactNode; control?: ReactNode }) {
  return <div className="flex min-h-9 items-center justify-between gap-3 border-b border-border py-3 last:border-b-0" data-setting-row>
    <div className="flex min-w-0 flex-col gap-1"><span className="text-body text-foreground">{title}</span>{description ? <span className="text-caption text-muted-foreground">{description}</span> : null}</div>
    {control ? <div className="flex shrink-0 items-center gap-3">{control}</div> : null}
  </div>;
}
// A card is white on the grey page, lifted by a soft shadow rather than outlined (owner 2026-10-28).
// fill: the card takes its grid cell's full height, so a row of cards lines up.
export function Card({ children, compact = false, title, meta, onClick, fill = false }: { children: ReactNode; compact?: boolean; title?: string; meta?: ReactNode; onClick?: () => void; fill?: boolean }) {
  return <div className={(compact ? "p-4" : "p-6") + " flex flex-col gap-3 rounded-2xl bg-card shadow-card" + (fill ? " h-full" : "")} onClick={onClick ? event => { if (!(event.target as Element).closest("button,a,input,select,textarea,summary,[role=button],[role=slider],[contenteditable]") && !String(window.getSelection?.() || "")) onClick(); } : undefined}>
    {title || meta ? <div className="flex items-center justify-between gap-3">{title ? <h3 className="text-subtitle font-semibold text-foreground">{title}</h3> : <span />}{meta ? <span className="text-caption text-muted-foreground">{meta}</span> : null}</div> : null}
    {children}
  </div>;
}
export function PageHeader({ title, description, actions, inlineActions }: {
  title: string; description?: string; actions?: ReactNode; inlineActions?: ReactNode;
}) {
  return <header className="flex items-center justify-between gap-3">
    <div className="flex min-w-0 items-center gap-4">
      <div className="flex flex-col gap-2"><h1 className="text-display font-semibold text-foreground">{title}</h1>{description ? <p className="text-caption text-muted-foreground">{description}</p> : null}</div>
      {inlineActions}
    </div>
    {actions}
  </header>;
}
export function SectionHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><div className="flex flex-col gap-2"><h2 className="text-title font-semibold text-foreground">{title}</h2>{description ? <p className="text-caption text-muted-foreground">{description}</p> : null}</div>{actions}</div>;
}
export type UnknownLabel = "未知" | "未定价" | "—" | "未报告" | "未计入" | "无法估算" | "没有记录";
export function Value({ value, unknown = "未知", className }: {
  value: string | null | undefined; unknown?: UnknownLabel; className?: string;
}) {
  return <span className={"tabular-nums " + (className ?? "")}
    data-value={value == null ? "unknown" : undefined}>{value ?? unknown}</span>;
}
export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return <div className="flex items-center gap-3 text-body text-muted-foreground"><p>{message}</p>{action}</div>;
}
// Read-only multi-line text (a JSON preview). Focusable so the keyboard can scroll it.
export function CodeBlock({ text, "aria-label": label }: { text: string; "aria-label": string }) {
  return <pre tabIndex={0} aria-label={label} className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-2 p-4 font-mono text-caption text-foreground">{text}</pre>;
}
// A bounded scrolling list. The edge fades show only where content continues, and drop while
// focus is inside so the focused row reads fully; at either end the wheel moves the page on.
const heights = { sm: "max-h-64", md: "max-h-96", lg: "max-h-128", fill: "h-full" };
// data-overflow marks a viewport that really scrolls: a scroll timeline can keep its last value after
// the content shrinks, so the fade applies only while there is something to scroll.
export function ScrollArea({ children, maxHeight, "aria-label": label }: { children: ReactNode; maxHeight: "sm" | "md" | "lg" | "fill"; "aria-label": string }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = root.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]");
    if (!viewport) return;
    // Reading scrollHeight forces a layout, so a page that streams content in would pay one layout per mutation
    // record. Both observers therefore only ask for one check on the next frame, and the frame is skipped when it
    // has already been scheduled — the attribute lands in the same frame the person would have seen it before.
    let queued = 0;
    const check = () => viewport.toggleAttribute("data-overflow", viewport.scrollHeight > viewport.clientHeight + 1);
    const schedule = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; check(); }); };
    const resize = new ResizeObserver(schedule), content = new MutationObserver(schedule);
    resize.observe(viewport); for (const child of viewport.children) resize.observe(child);
    content.observe(viewport, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style"] });
    check();
    return () => { if (queued) cancelAnimationFrame(queued); resize.disconnect(); content.disconnect(); };
  }, []);
  return <FluidScrollArea ref={root} aria-label={label} className={maxHeight === "fill" ? "min-h-0 flex-1" : undefined} viewportClassName={"ff-scroll-fade ff-scroll-focus " + heights[maxHeight]}>{children}</FluidScrollArea>;
}
