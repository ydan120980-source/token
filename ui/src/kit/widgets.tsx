import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconChevronRight } from "@tabler/icons-react";
import { data, instant, spring, staggerDelay } from "@ui/design/motion";
import { useKitMotion } from "./motion-mode";
import { chartTone, type ChartTone } from "./charts/tones";
import { useHoverCard } from "./hover-card";

// The widget sidebar's building blocks (owner decision 2026-10-27,
// docs/m2/UI-PALETTE-QUOTA-SUMMARY-PROPOSAL-20261027.md section 4). One frame, one way to open a
// row in place, and the compact graphics the thirteen widgets draw with. Colours come from the
// widget's colour mode (widgetTone): the Agent's colour, one blue ramp or ink. Marks open hover cards
// (owner 2026-10-28, docs/m2/UI-HOVER-20261028.md).

export type WidgetColorMode = "agent" | "mono" | "ink";
export type WidgetSurface = "plain" | "soft" | "tint" | "inv";
const AGENTS = new Set(["codex", "claude", "cursor", "workbuddy", "antigravity", "deepseek", "gemini", "opencode", "zcode", "mimo", "copilot", "cline", "pi", "continue", "kilo", "qwen", "kimi"]);

/** The colour of the index-th series under a colour mode; an unknown Agent falls back to the ramp. */
export function widgetTone(mode: WidgetColorMode, index: number, agent?: string | null): ChartTone {
  if (mode === "ink") return ("ink:" + (index % 4 + 1)) as ChartTone;
  if (mode === "agent" && agent && AGENTS.has(agent)) return ("agent:" + agent) as ChartTone;
  return ("ramp:" + (index % 5 + 1)) as ChartTone;
}

/** Where a widget sits on the home board (owner 2026-10-29, Apple-style interaction): its place in the
 * entrance order and what opening it does. Outside the board (library previews) a widget is still. */
export const WidgetPlace = createContext<{ order?: number; onOpen?: () => void }>({});
const INTERACTIVE = "button,a,input,select,textarea,summary,[role=button],[role=switch],[role=slider],[contenteditable]";
const pressed = { scale: 0.98 };

/** One widget: a card on the window ground with its title row. Background and accent are theme rules (theme/widgets.css).
 * On the board it rises into place in order (spring.slow, faded under reduced motion), deepens its shadow under the
 * pointer, gives under a press and springs back, and opens its page on a click outside its own controls. */
export function WidgetCard({ type, title, sub, meta, surface = "plain", accent, label, children }: {
  type: string; title: string; sub?: ReactNode; meta?: ReactNode; surface?: WidgetSurface; accent?: string | null; label?: string; children: ReactNode;
}) {
  const { order, onOpen } = useContext(WidgetPlace), { full, fade } = useKitMotion();
  const enter = order === undefined || (!full && !fade) ? false : full ? { opacity: 0, y: 12 } : { opacity: 0 };
  const settle = order === undefined ? spring.slow : { ...spring.slow, delay: staggerDelay(order) };
  const open = (event: MouseEvent<HTMLElement>) => { if (!onOpen || (event.target as Element).closest(INTERACTIVE) || String(window.getSelection?.() || "")) return; onOpen(); };
  const key = (event: KeyboardEvent<HTMLElement>) => { if (onOpen && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(); } };
  return <motion.section className={"flex min-w-0 flex-col gap-3 rounded-2xl p-4 text-foreground shadow-card outline-none focus-visible:ring-1 focus-visible:ring-ring" + (onOpen ? " cursor-pointer" : "")} data-widget={type}
    data-widget-open={onOpen ? "" : undefined} tabIndex={onOpen ? 0 : undefined} onClick={open} onKeyDown={key}
    initial={enter} animate={{ opacity: 1, y: 0 }} transition={settle} whileTap={onOpen && full ? pressed : undefined}
    data-widget-bg={surface} data-widget-accent={accent && AGENTS.has(accent) ? accent : "none"} aria-label={label ?? title}>
    <header className="flex min-h-6 items-center justify-between gap-2">
      <h3 className="flex min-w-0 items-baseline gap-2 truncate text-body font-semibold">{title}{sub ? <span className="truncate text-caption font-normal text-muted-foreground">{sub}</span> : null}</h3>
      {meta ? <div className="flex shrink-0 items-center gap-2 text-caption text-muted-foreground">{meta}</div> : null}
    </header>
    {children}
  </motion.section>;
}

/** A large reading with what follows it on the same baseline. */
export function WidgetFigure({ value, after, size = "lg" }: { value: string; after?: ReactNode; size?: "lg" | "md" | "sm" }) {
  const text = size === "lg" ? "text-figure-lg" : size === "md" ? "text-figure-md" : "text-figure-sm";
  return <div className="flex flex-wrap items-baseline gap-2">
    <span className={text + " font-semibold tabular-nums text-foreground"} data-widget-figure>{value}</span>
    {after ? <span className="text-caption text-muted-foreground">{after}</span> : null}
  </div>;
}

/** A neutral pill beside a title or figure: a comparison, a state, a countdown. Never coloured as good or bad. */
export function WidgetPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "live" }) {
  return <span className={"inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-caption font-medium " + (tone === "warn" ? "bg-warn-soft text-warn-text" : "bg-surface-2 text-muted-foreground")} data-widget-pill={tone}>
    {tone === "live" ? <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" /> : null}{children}
  </span>;
}

export interface DetailRow { key: string; lead?: ReactNode; tone?: ChartTone; name: ReactNode; wrap?: boolean; value?: ReactNode; share?: string; sub?: { key: string; name: ReactNode; value: ReactNode; fraction?: number | null; tone?: ChartTone }[]; open?: boolean }

/** Text under a graphic: a row per item with its value and share; a row with sub-rows opens in place on click. */
export function WidgetDetails({ rows, "aria-label": label }: { rows: DetailRow[]; "aria-label": string }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(rows.filter(row => row.open).map(row => row.key)));
  if (!rows.length) return null;
  return <div className="flex flex-col border-t border-border pt-1" role="list" aria-label={label} data-widget-details>
    {rows.map(row => <DetailLine key={row.key} row={row} open={open.has(row.key)} onToggle={() => setOpen(current => {
      const next = new Set(current);
      if (next.has(row.key)) next.delete(row.key); else next.add(row.key);
      return next;
    })} />)}
  </div>;
}
function DetailLine({ row, open, onToggle }: { row: DetailRow; open: boolean; onToggle: () => void }) {
  const id = useId(), { full } = useKitMotion(), has = Boolean(row.sub?.length);
  const content = <>
    {has ? <motion.span className="inline-flex shrink-0 text-muted-foreground" animate={{ rotate: open ? 90 : 0 }} transition={full ? spring.fast : instant}><IconChevronRight size={12} aria-hidden="true" /></motion.span> : <span className="w-3 shrink-0" />}
    {row.lead ?? (row.tone ? <span className={"h-2 w-2 shrink-0 ff-widget-cell " + chartTone(row.tone).background} aria-hidden="true" /> : null)}
    <span className={"min-w-0 flex-1 text-left " + (row.wrap ? "break-words" : "truncate")}>{row.name}</span>
    {row.value !== undefined ? <span className="shrink-0 font-medium tabular-nums">{row.value}</span> : null}
    {row.share ? <span className="w-9 shrink-0 text-right text-caption tabular-nums text-muted-foreground">{row.share}</span> : null}
  </>;
  const line = "flex min-h-7 w-full items-center gap-2 rounded-lg text-body text-foreground";
  return <div role="listitem">
    {has ? <button type="button" className={line + " cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring"} aria-expanded={open} aria-controls={id} onClick={onToggle} data-widget-row>{content}</button>
      : <div className={line} data-widget-row>{content}</div>}
    <AnimatePresence initial={false}>
      {has && open ? <motion.div id={id} className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={full ? spring.moderate : instant}>
        <div className="flex flex-col gap-2 pb-2 pl-5 pt-1">
          {row.sub!.map(item => <div key={item.key} className="grid items-center gap-x-2 gap-y-1 text-caption text-muted-foreground" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
            <span className="min-w-0 truncate">{item.name}</span><span className="font-medium tabular-nums text-foreground">{item.value}</span>
            {item.fraction !== undefined && item.fraction !== null ? <span className="col-span-2 flex h-1 overflow-hidden rounded-full bg-surface-2"><span className={"h-full rounded-full " + chartTone(item.tone ?? "neutral").background} style={{ width: Math.max(0, Math.min(1, item.fraction)) * 100 + "%" }} /></span> : null}
          </div>)}
        </div>
      </motion.div> : null}
    </AnimatePresence>
  </div>;
}

/** A row of equal cells, the first on of them filled: a quota window, a share of time. Hatched when the reading is stale. */
export function WidgetCells({ count, on, tone, hatched = false, "aria-label": label }: { count: 30 | 40; on: number | null; tone: ChartTone; hatched?: boolean; "aria-label": string }) {
  const { full } = useKitMotion(), filled = on === null ? 0 : Math.max(0, Math.min(count, Math.round(on)));
  return <div className="flex h-3 gap-px" role="img" aria-label={label} data-widget-cells={hatched ? "hatched" : "solid"}>
    {Array.from({ length: count }, (_, index) => <motion.i key={index} className={"min-w-0 flex-1 ff-widget-cell " + (hatched ? "ff-widget-hatch" : index < filled ? chartTone(tone).background : chartTone(tone).background + " opacity-20")}
      initial={full ? { opacity: 0 } : false} animate={{ opacity: hatched || index < filled ? 1 : 0.2 }} transition={full ? { ...data.enter, delay: staggerDelay(index) / 4 } : instant} />)}
  </div>;
}

/** Small daily columns beside a figure: a day without a record is a thin mark, never a zero-height gap read as none. */
export function MiniBars({ values, "aria-label": label }: { values: (number | null)[]; "aria-label": string }) {
  const top = Math.max(0, ...values.map(value => value ?? 0));
  return <div className="flex h-7 shrink-0 items-end gap-0.5" role="img" aria-label={label} data-mini-bars>
    {values.map((value, index) => <i key={index} className={"w-1 rounded-full " + (value === null ? "bg-border" : "bg-muted-foreground")} style={{ height: value === null || !top ? 3 : Math.max(3, value / top * 28) }} data-mini-bar={value === null ? "none" : "day"} />)}
  </div>;
}

/** Shares side by side with small gaps: kinds of Token, Agents, connection states. tall: the status block. */
export function WidgetShares({ segments, tall = false, "aria-label": label }: { segments: { key: string; value: number; tone: ChartTone; hatched?: boolean; label: string }[]; tall?: boolean; "aria-label": string }) {
  const { full } = useKitMotion(), hover = useHoverCard(), shown = segments.filter(segment => segment.value > 0);
  return <div className={"flex gap-1 " + (tall ? "h-16" : "h-2")} role="img" aria-label={label} data-widget-shares>
    {hover.layer}
    {shown.map((segment, index) => <motion.i key={segment.key} {...hover.bind(segment.key, segment.label)} className={"min-w-1 origin-left " + (tall ? "rounded-lg " : "rounded-full ") + (segment.hatched ? "ff-widget-hatch" : chartTone(segment.tone).background)}
      style={{ flexGrow: segment.value, flexBasis: 0 }} initial={full ? { scaleX: 0 } : false} animate={{ scaleX: 1 }} transition={full ? { ...data.enter, delay: staggerDelay(index) } : instant} />)}
  </div>;
}

const W = 272;
function smooth(points: [number, number][]) {
  return points.map(([x, y], index) => {
    if (!index) return "M" + x.toFixed(1) + " " + y.toFixed(1);
    const [px, py] = points[index - 1], cx = (px + x) / 2;
    return "C" + cx.toFixed(1) + " " + py.toFixed(1) + " " + cx.toFixed(1) + " " + y.toFixed(1) + " " + x.toFixed(1) + " " + y.toFixed(1);
  }).join(" ");
}
/** A smooth line (with a faint area) over known values; unknown points break it. The highest known point is labelled. */
export function WidgetLine({ values, tone, height, peakLabel, area = true, "aria-label": label }: { values: (number | null)[]; tone: ChartTone; height: 64 | 80 | 96; peakLabel?: (value: number) => string; area?: boolean; "aria-label": string }) {
  const { full } = useKitMotion(), known = values.filter((value): value is number => value !== null), max = Math.max(...known, 0) || 1, top = peakLabel ? 18 : 4;
  const x = (index: number) => values.length < 2 ? W / 2 : index / (values.length - 1) * W, y = (value: number) => top + (height - top - 2) * (1 - value / max);
  const runs: [number, number][][] = [];
  values.forEach((value, index) => { if (value === null) { runs.push([]); return; } if (!runs.length) runs.push([]); runs[runs.length - 1].push([x(index), y(value)]); });
  const paths = runs.filter(run => run.length).map(run => run.length === 1 ? "M" + (run[0][0] - 1).toFixed(1) + " " + run[0][1].toFixed(1) + "H" + (run[0][0] + 1).toFixed(1) : smooth(run));
  const peak = known.length ? values.indexOf(Math.max(...known)) : -1, stroke = chartTone(tone);
  return <svg className="w-full shrink-0 overflow-visible" viewBox={"0 0 " + W + " " + height} height={height} preserveAspectRatio="none" role="img" aria-label={label} data-widget-line>
    {[0.33, 0.66, 1].map(at => <line key={at} x1={0} x2={W} y1={top + (height - top - 2) * at} y2={top + (height - top - 2) * at} className="stroke-border" vectorEffect="non-scaling-stroke" />)}
    {area ? paths.map((path, index) => { const run = runs.filter(item => item.length)[index]; return <motion.path key={"a" + index} d={path + "L" + run.at(-1)![0].toFixed(1) + " " + height + "L" + run[0][0].toFixed(1) + " " + height + "Z"} className={stroke.fill} fillOpacity={0.12} initial={full ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={full ? data.enter : instant} />; }) : null}
    {paths.map((path, index) => <motion.path key={"l" + index} d={path} fill="none" strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" className={stroke.stroke} initial={full ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={full ? data.enter : instant} />)}
    {peak >= 0 && peakLabel ? <g data-widget-peak><circle cx={x(peak)} cy={y(values[peak]!)} r={3.5} className={stroke.fill} /><text x={Math.max(16, Math.min(W - 16, x(peak)))} y={y(values[peak]!) - 8} textAnchor="middle" className="fill-foreground text-micro font-semibold">{peakLabel(values[peak]!)}</text></g> : null}
  </svg>;
}

/** Stacked columns with gaps; below the axis, a hatched stub for Token that could not be priced. */
export function WidgetColumns({ columns, height, "aria-label": label }: { columns: { key: string; label: string; detail?: ReactNode; segments: { key: string; value: number; tone: ChartTone }[]; under: boolean }[]; height: 48 | 112; "aria-label": string }) {
  const { full } = useKitMotion(), hover = useHoverCard(), axis = height - (height > 60 ? 16 : 6), totals = columns.map(column => column.segments.reduce((sum, segment) => sum + segment.value, 0)), max = Math.max(...totals, 0) || 1, step = W / Math.max(1, columns.length), width = Math.max(2, step - 3);
  return <svg className="w-full shrink-0 overflow-visible" viewBox={"0 0 " + W + " " + height} height={height} preserveAspectRatio="none" role="img" aria-label={label} data-widget-columns>
    <defs><pattern id="ff-widget-hatch" width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width={1.5} height={4} className="fill-muted-foreground" /></pattern></defs>
    <line x1={0} x2={W} y1={axis + 0.5} y2={axis + 0.5} className="stroke-border" vectorEffect="non-scaling-stroke" />
    {hover.layer}
    {columns.map((column, index) => {
      let base = axis;
      return <motion.g key={column.key} {...hover.bind(column.key, column.detail ?? column.label)} style={{ transformOrigin: "0px " + axis + "px" }} initial={full ? { scaleY: 0 } : false} animate={{ scaleY: 1 }} transition={full ? { ...data.enter, delay: staggerDelay(index) / 2 } : instant}>
        <rect x={index * step} y={0} width={step} height={height} className="fill-transparent" />
        {column.segments.map(segment => { const h = segment.value / max * (axis - 4); base -= h; return h > 0 ? <rect key={segment.key} x={index * step + 1.5} y={base} width={width} height={Math.max(0, h - 1.5)} rx={Math.min(3, width / 2)} className={chartTone(segment.tone).fill} /> : null; })}
        {column.under ? <rect x={index * step + 1.5} y={axis + 3} width={width} height={height > 60 ? 9 : 3} rx={2} fill="url(#ff-widget-hatch)" /> : null}
      </motion.g>;
    })}
  </svg>;
}

/** Month to date: the running total (solid), last month at the same day (dashed) and the projected month end (open dot). */
export function WidgetMonthLine({ current, previous, projection, days, tone, "aria-label": label }: { current: (number | null)[]; previous: (number | null)[]; projection: number | null; days: number; tone: ChartTone; "aria-label": string }) {
  const { full } = useKitMotion(), height = 64, known = [...current, ...previous, projection].filter((value): value is number => value !== null), max = Math.max(...known, 0) * 1.08 || 1;
  const x = (index: number) => index / Math.max(1, days - 1) * W, y = (value: number) => height - value / max * (height - 4);
  const line = (values: (number | null)[]) => values.map((value, index) => value === null ? null : [x(index), y(value)] as [number, number]).filter((point): point is [number, number] => point !== null).map(([px, py], index) => (index ? "L" : "M") + px.toFixed(1) + " " + py.toFixed(1)).join(" ");
  const last = current.reduce<number>((at, value, index) => value === null ? at : index, -1), stroke = chartTone(tone);
  return <svg className="w-full shrink-0 overflow-visible" viewBox={"0 0 " + W + " " + height} height={height} preserveAspectRatio="none" role="img" aria-label={label} data-widget-month>
    {previous.some(value => value !== null) ? <path d={line(previous)} fill="none" strokeWidth={1.5} strokeDasharray="2 3" className="stroke-muted-foreground" vectorEffect="non-scaling-stroke" /> : null}
    {last >= 0 ? <motion.path d={line(current)} fill="none" strokeWidth={2} strokeLinejoin="round" className={stroke.stroke} vectorEffect="non-scaling-stroke" initial={full ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={full ? data.enter : instant} /> : null}
    {last >= 0 ? <circle cx={x(last)} cy={y(current[last]!)} r={3.5} className={stroke.fill} /> : null}
    {projection !== null ? <circle cx={x(days - 1)} cy={y(projection)} r={3} fill="none" strokeDasharray="2 2" className="stroke-muted-foreground" data-widget-projection /> : null}
  </svg>;
}

/** A calendar of days by week, darker for more Token; a day without records is the empty step. */
export function WidgetHeat({ weeks, cells, mode, "aria-label": label }: { weeks: number; cells: { key: string; level: 0 | 1 | 2 | 3 | 4 | null; label: string }[]; mode: WidgetColorMode; "aria-label": string }) {
  const { full } = useKitMotion(), hover = useHoverCard(), steps: ChartTone[] = mode === "ink" ? ["ink:4", "ink:3", "ink:2", "ink:1"] : ["ramp:4", "ramp:3", "ramp:2", "ramp:1"];
  return <div className="flex flex-col gap-2">
    <div className="grid grid-flow-col grid-rows-7 gap-px" style={{ gridTemplateColumns: "repeat(" + weeks + ", minmax(0, 1fr))" }} role="img" aria-label={label} data-widget-heat>
      {hover.layer}
      {cells.map((cell, index) => <motion.i key={cell.key} {...(cell.level === null ? {} : hover.bind(cell.key, cell.label))} className={"aspect-square ff-widget-cell " + (cell.level === null ? "bg-transparent" : cell.level === 0 ? "bg-surface-2" : chartTone(steps[cell.level - 1]).background)}
        initial={full ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={full ? { ...data.enter, delay: staggerDelay(Math.floor(index / 7)) / 2 } : instant} />)}
    </div>
    <div className="flex items-center justify-end gap-1 text-micro text-muted-foreground" aria-hidden="true">少<i className="h-2 w-2 ff-widget-cell bg-surface-2" />{steps.map(step => <i key={step} className={"h-2 w-2 ff-widget-cell " + chartTone(step).background} />)}多</div>
  </div>;
}

const LANE = { gridTemplateColumns: "96px minmax(0, 1fr)" };
/** Lanes on a time axis: a band until a window resets and markers where something resets or expires. */
export function WidgetLanes({ lanes, axis, "aria-label": label }: { lanes: { key: string; lead: ReactNode; name: string; tone: ChartTone; band: number | null; marks: { key: string; at: number; label: string; kind: "reset" | "expiry" }[]; muted?: boolean }[]; axis: string[]; "aria-label": string }) {
  const { full } = useKitMotion(), hover = useHoverCard();
  return <div className="flex flex-col gap-1" role="list" aria-label={label} data-widget-lanes>
    {hover.layer}
    {lanes.map((lane, index) => <div key={lane.key} role="listitem" className="grid h-7 items-center gap-2 text-caption" style={LANE} aria-label={lane.name + (lane.marks.length ? "：" + lane.marks.map(mark => mark.label).join("，") : "")}>
      <span className="flex min-w-0 items-center gap-2 truncate text-foreground">{lane.lead}<span className="truncate">{lane.name}</span></span>
      <span className={"relative h-full rounded-lg bg-surface-2" + (lane.muted ? " ff-widget-hatch opacity-60" : "")}>
        {lane.band !== null ? <motion.span className={"absolute left-0 top-2 h-3 origin-left rounded-full opacity-50 " + chartTone(lane.tone).background} style={{ width: Math.max(0.02, Math.min(1, lane.band)) * 100 + "%" }} initial={full ? { scaleX: 0 } : false} animate={{ scaleX: 1 }} transition={full ? { ...data.enter, delay: staggerDelay(index) } : instant} /> : null}
        {lane.marks.map(mark => <span key={mark.key} {...hover.bind(mark.key, mark.label)} className={"absolute top-2 h-3 w-3 -translate-x-1/2 ring-2 ring-card " + (mark.kind === "expiry" ? "rotate-45 ff-widget-cell " : "rounded-full ") + chartTone(lane.tone).background} style={{ left: Math.max(0, Math.min(1, mark.at)) * 100 + "%" }} />)}
      </span>
    </div>)}
    <div className="grid gap-2 text-micro text-muted-foreground" style={LANE} aria-hidden="true"><span /><span className="flex justify-between">{axis.map(item => <span key={item}>{item}</span>)}</span></div>
  </div>;
}

/** Sessions on a short time axis, one lane per Agent, behind them the quota window the Agent's service reports
 * (start to reset). Positions are fractions of the axis. The pointed or focused session reads out in the line above
 * the lanes, never over them; a span opens its session when clicked. */
export function WidgetSpans({ lanes, axis, now, summary, "aria-label": label }: {
  lanes: { key: string; lead: ReactNode; name: string; sub?: string; tone: ChartTone; band: { from: number; to: number } | null;
    spans: { key: string; from: number; to: number; live?: boolean; label: string; readout: string; onSelect?: () => void }[] }[];
  axis: string[]; now: number; summary: string; "aria-label": string;
}) {
  const { full } = useKitMotion(), [active, setActive] = useState<string | null>(null), at = (value: number) => Math.max(0, Math.min(1, value)) * 100 + "%";
  const pointed = active ? lanes.flatMap(lane => lane.spans).find(span => span.key === active) : undefined;
  return <div className="flex flex-col gap-2" data-widget-spans>
    <p className={"truncate text-caption " + (pointed ? "text-foreground" : "text-muted-foreground")} aria-live="polite" data-widget-readout>{pointed ? pointed.readout : summary}</p>
    <div className="flex flex-col gap-2" role="list" aria-label={label}>
      {lanes.map((lane, index) => <div key={lane.key} role="listitem" className="flex flex-col gap-1" aria-label={lane.name + (lane.sub ? " " + lane.sub : "") + "：" + (lane.spans.length ? lane.spans.map(span => span.label).join("，") : "没有会话")}>
        <span className="flex min-w-0 items-center justify-between gap-2 text-caption">
          <span className="flex min-w-0 items-center gap-2 text-foreground">{lane.lead}<span className="truncate">{lane.name}</span></span>
          {lane.sub ? <span className="shrink-0 text-micro text-muted-foreground tabular-nums">{lane.sub}</span> : null}
        </span>
        <span className="relative h-5 rounded-lg bg-surface-2">
          {lane.band ? <span aria-hidden="true" className={"absolute inset-y-0 rounded-lg opacity-20 " + chartTone(lane.tone).background} style={{ left: at(lane.band.from), width: at(lane.band.to - lane.band.from) }} /> : null}
          {lane.spans.map((span, spanIndex) => <motion.button key={span.key} type="button" aria-label={span.label} onClick={span.onSelect} data-widget-span={span.key}
            onPointerEnter={() => setActive(span.key)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(span.key)} onBlur={() => setActive(null)}
            className={"absolute top-1 h-3 min-w-1.5 origin-left cursor-pointer rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring " + chartTone(lane.tone).background}
            style={{ left: at(span.from), width: at(span.to - span.from) }}
            initial={full ? { scaleX: 0 } : false} animate={{ scaleX: 1 }} transition={full ? { ...data.enter, delay: staggerDelay(index + spanIndex) } : instant}>
            {span.live ? <span aria-hidden="true" className="absolute right-0.5 top-1 h-1 w-1 rounded-full bg-card" /> : null}
          </motion.button>)}
          <span aria-hidden="true" className="absolute inset-y-0 w-px bg-foreground opacity-40" style={{ left: at(now) }} />
        </span>
      </div>)}
    </div>
    <span className="flex justify-between text-micro text-muted-foreground tabular-nums" aria-hidden="true">{axis.map(item => <span key={item}>{item}</span>)}</span>
  </div>;
}

/** The machine in the middle and the Agents it reads around it. An edge says how reading that Agent goes; it is not a call graph. */
export function WidgetGraph({ nodes, tone, flowing, "aria-label": label }: { nodes: { key: string; lead: ReactNode; name: string; sub: string; state: "ok" | "warn" | "stale" }[]; tone: ChartTone; flowing: boolean; "aria-label": string }) {
  const { full } = useKitMotion(), root = useRef<HTMLDivElement>(null), [width, setWidth] = useState(W), height = 248, hub: [number, number] = [width / 2, height / 2];
  useLayoutEffect(() => { const element = root.current; if (!element) return; const observer = new ResizeObserver(() => setWidth(element.clientWidth || W)); observer.observe(element); return () => observer.disconnect(); }, []);
  const placed = nodes.slice(0, 8).map((node, index, all) => { const angle = -Math.PI / 2 + index / all.length * Math.PI * 2; return { ...node, x: hub[0] + Math.cos(angle) * (width / 2 - 40), y: hub[1] + Math.sin(angle) * (height / 2 - 40) }; });
  const edgeClass = (state: string) => state === "warn" ? "stroke-warn" : state === "stale" ? "stroke-muted-foreground" : chartTone(tone).stroke;
  return <div className="flex flex-col gap-2"><div ref={root} className="relative" style={{ height }} role="img" aria-label={label} data-widget-graph>
    <svg className="absolute inset-0 overflow-visible" width={width} height={height} aria-hidden="true">
      {placed.map(node => { const mx = (hub[0] + node.x) / 2, d = "M" + hub[0] + " " + hub[1] + " C" + mx + " " + hub[1] + " " + mx + " " + node.y + " " + node.x + " " + node.y; return <g key={node.key}>
        <path d={d} fill="none" strokeWidth={1.5} className="stroke-border" />
        <path d={d} fill="none" strokeWidth={1.5} className={edgeClass(node.state) + (node.state === "ok" && full && flowing ? " ff-widget-flow" : "")} strokeDasharray={node.state === "ok" ? "3 5" : node.state === "stale" ? "2 4" : undefined} opacity={node.state === "stale" ? 0.6 : 1} />
      </g>; })}
    </svg>
    <span className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ left: hub[0], top: hub[1] }}><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground text-body font-semibold text-background">本</span><span className="text-micro text-muted-foreground">本机</span></span>
    {placed.map(node => <span key={node.key} className="absolute flex w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-px text-center" style={{ left: node.x, top: node.y }} data-graph-node={node.key} data-graph-state={node.state}>
      <span className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-card ring-1 ring-border">{node.lead}{node.state === "warn" ? <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-warn" /> : null}</span>
      <span className="line-clamp-2 w-full break-words text-micro font-medium text-foreground">{node.name}</span><span className="w-full truncate text-micro text-muted-foreground">{node.sub}</span>
    </span>)}
  </div>
  <div className="flex justify-center gap-3 text-micro text-muted-foreground" aria-hidden="true">{([["ok", "读取中", chartTone(tone).background], ["warn", "需要处理", "bg-warn"], ["stale", "待刷新", "bg-muted-foreground"]] as const).map(([key, text, swatch]) => <span key={key} className="inline-flex items-center gap-1"><i className={"h-1 w-3 rounded-full " + swatch} />{text}</span>)}</div></div>;
}

/** In edit mode, the row of tools above a widget enters in sequence. */
export function WidgetTools({ index, children }: { index: number; children: ReactNode }) {
  const { full } = useKitMotion();
  return <motion.div className="flex h-7 items-center gap-1" initial={full ? { opacity: 0, y: 4 } : false} animate={{ opacity: 1, y: 0 }} transition={full ? { ...spring.fast, delay: index * 0.03 } : instant} data-widget-tools>{children}</motion.div>;
}
/** A small tool button in edit mode (size letters, settings, remove). */
export function WidgetTool({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}
    className={"inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-lg px-2 text-micro font-semibold outline-none ring-1 ring-border focus-visible:ring-ring " + (pressed ? "bg-foreground text-background" : "bg-card text-foreground")}>{children}</button>;
}
/** The drag grip; dragging works on the whole widget in edit mode (Sortable), this only shows where. */
export function WidgetGrip() {
  return <span className="inline-flex h-6 w-6 cursor-grab items-center justify-center rounded-lg text-muted-foreground" aria-hidden="true" data-widget-grip>⠿</span>;
}
/** The dashed "add" slot at the end of the list in edit mode. */
export function WidgetAddSlot({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-body text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring" data-widget-add>{children}</button>;
}
