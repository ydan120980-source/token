import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { portalRoot } from "@/lib/portal-root";
import { instant, spring } from "@ui/design/motion";
import { chartTone, type ChartTone } from "./charts/tones";
import { useKitMotion } from "./motion-mode";
import { isComposing } from "./ime";

export interface BreakdownPart {
  key: string; label: string; value: ReactNode; share: number | null; tone: ChartTone; hatched?: boolean; note?: string;
  /** Shown in the detail card beside the breakdown while this part is pointed at or focused. */
  detail?: { label: string; value: ReactNode; share?: number | null }[];
}
const swatch = (part: { tone: ChartTone; hatched?: boolean }) => part.hatched ? "ff-widget-hatch" : chartTone(part.tone).background;
const dim = 0.28;

/**
 * A breakdown in the manner of a reasoning summary (owner 2026-10-28): rounded segments with gaps over a
 * quiet remainder, then a legend of swatches and values. Pointing at a segment or a row lifts it, quiets
 * the rest and opens a detail card beside the breakdown; keyboard focus does the same and Escape closes it.
 */
export function Breakdown({ parts, columns = 2, onActiveChange, "aria-label": label }: {
  parts: BreakdownPart[]; columns?: 1 | 2; onActiveChange?: (key: string | null) => void; "aria-label": string;
}) {
  const [active, setActive] = useState<string | null>(null), root = useRef<HTMLDivElement>(null), rows = useRef(new Map<string, HTMLElement>());
  const { full } = useKitMotion(), sum = parts.reduce((total, part) => total + Math.max(0, part.share ?? 0), 0);
  const current = parts.find(part => part.key === active && part.detail?.length) ?? null;
  useEffect(() => { onActiveChange?.(active); }, [active]);
  const fade = (key: string) => ({ opacity: active && active !== key ? dim : 1 });
  const motionTier = full ? spring.fast : instant;
  return <div ref={root} className="flex flex-col gap-3" data-breakdown data-active={active ?? ""}
    onPointerLeave={() => setActive(null)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setActive(null); }}
    onKeyDown={event => { if (event.key === "Escape" && active && !isComposing(event)) { event.stopPropagation(); setActive(null); } }}>
    <div className="flex h-2 gap-1" role="img" aria-label={label}>
      {parts.filter(part => (part.share ?? 0) > 0).map(part => <motion.span key={part.key} data-breakdown-segment={part.key}
        className={"h-full rounded-full " + swatch(part)} style={{ flexGrow: part.share!, flexBasis: 0 }}
        initial={false} animate={fade(part.key)} transition={motionTier} onPointerEnter={() => setActive(part.key)} />)}
      {sum < 0.999 ? <span className="h-full rounded-full bg-muted" style={{ flexGrow: 1 - sum, flexBasis: 0 }} /> : null}
    </div>
    <div className={"grid gap-x-6 " + (columns === 2 ? "grid-cols-2" : "grid-cols-1")}>
      {parts.map(part => <button key={part.key} type="button" data-breakdown-row={part.key}
        ref={element => { if (element) rows.current.set(part.key, element); else rows.current.delete(part.key); }}
        className="-mx-2 flex min-h-8 min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-body outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring"
        onPointerEnter={() => setActive(part.key)} onFocus={event => { if (event.currentTarget.matches(":focus-visible")) setActive(part.key); }}>
        <span className={"ff-widget-cell size-2.5 shrink-0 " + swatch(part)} />
        <motion.span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2" initial={false} animate={fade(part.key)} transition={motionTier}>
          <span className="min-w-0 break-words text-foreground">{part.label}</span>
          {part.note ? <span className="min-w-0 break-words text-caption text-muted-foreground">{part.note}</span> : null}
        </motion.span>
        <span className="shrink-0 font-semibold text-foreground tabular-nums">{part.value}</span>
      </button>)}
    </div>
    <BreakdownDetail part={current} anchor={current ? rows.current.get(current.key) ?? null : null} frame={root.current} />
  </div>;
}

/** The card beside a breakdown: it opens next to the pointed row and glides between rows. */
function BreakdownDetail({ part, anchor, frame }: { part: BreakdownPart | null; anchor: HTMLElement | null; frame: HTMLElement | null }) {
  const card = useRef<HTMLDivElement>(null), [place, setPlace] = useState<{ left: number; top: number } | null>(null), { full } = useKitMotion();
  useLayoutEffect(() => {
    if (!part || !anchor || !frame) { setPlace(null); return; }
    const measure = () => {
      const sheet = frame.closest("[role=dialog]"), row = anchor.getBoundingClientRect();
      const width = card.current?.offsetWidth ?? 256, height = card.current?.offsetHeight ?? 120;
      if (sheet) {
        // In a sheet the card stands beside it, level with the row.
        const surface = sheet.getBoundingClientRect(), right = surface.right + 12;
        setPlace({ left: right + width <= innerWidth - 8 ? right : Math.max(8, surface.left - 12 - width), top: Math.max(8, Math.min(innerHeight - height - 8, row.top - 8)) });
      } else {
        // On a page it opens just under the row (above when the window has no room below).
        const below = row.bottom + 6;
        setPlace({ left: Math.max(8, Math.min(innerWidth - width - 8, row.left)), top: below + height <= innerHeight - 8 ? below : Math.max(8, row.top - 6 - height) });
      }
    };
    measure();
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [part, anchor, frame]);
  return createPortal(<AnimatePresence>{part && place ? <motion.div ref={card} key="breakdown-detail" role="tooltip" data-breakdown-detail={part.key}
    className="pointer-events-none fixed z-50 flex w-64 flex-col gap-2 rounded-xl bg-surface-5 p-3 text-caption text-foreground shadow-surface-5"
    style={{ left: 0, top: 0 }}
    initial={full ? { opacity: 0, x: place.left - 6, y: place.top } : { opacity: 1, x: place.left, y: place.top }}
    animate={{ opacity: 1, x: place.left, y: place.top }} exit={full ? { opacity: 0 } : undefined}
    transition={full ? spring.moderate : instant}>
    <div className="flex items-center gap-2">
      <span className={"ff-widget-cell size-2.5 shrink-0 " + swatch(part)} />
      <span className="flex-1 font-semibold">{part.label}</span>
      <span className="font-semibold tabular-nums">{part.value}</span>
      {part.share != null ? <span className="text-muted-foreground tabular-nums">{Math.round(part.share * 100) + "%"}</span> : null}
    </div>
    {part.detail?.map(row => <div key={row.label} className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{row.label}</span><span className="tabular-nums">{row.value}</span></div>
      {row.share != null ? <span className="h-1 overflow-hidden rounded-full bg-muted"><span className={"flex h-full rounded-full " + swatch(part)} style={{ width: Math.max(2, Math.min(100, row.share * 100)) + "%" }} /></span> : null}
    </div>)}
  </motion.div> : null}</AnimatePresence>, portalRoot());
}

/** A row of a breakdown's companion list: a mark, a name with an optional pill, a quiet aside and a value. */
export function LabelRow({ leading, title, tag, aside, value, share, tone = "cost:muted" }: {
  leading?: ReactNode; title: ReactNode; tag?: ReactNode; aside?: ReactNode; value?: ReactNode; share?: number | null; tone?: ChartTone;
}) {
  return <div className="-mx-2 flex min-h-10 items-center gap-3 rounded-lg px-2 py-1.5 text-body hover:bg-hover" data-label-row>
    {leading}
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-foreground">{title}</span>
        {tag != null ? <span className="shrink-0 rounded-full bg-info/15 px-2 py-0.5 text-micro text-accent-text tabular-nums">{tag}</span> : null}
      </span>
      {share != null ? <span className="h-1 w-full overflow-hidden rounded-full bg-muted"><span className={"flex h-full rounded-full " + chartTone(tone).background} style={{ width: Math.max(1, Math.min(100, share * 100)) + "%" }} /></span> : null}
    </span>
    {aside != null ? <span className="shrink-0 text-caption text-muted-foreground tabular-nums">{aside}</span> : null}
    {value != null ? <span className="shrink-0 font-semibold text-foreground tabular-nums">{value}</span> : null}
  </div>;
}
