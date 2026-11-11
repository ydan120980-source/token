import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useTransform } from "motion/react";
import { data, spring, staggerDelay } from "@ui/design/motion";
import { usePlot, plotKeys, GeometryPath } from "./common";
import { arcPath, clamp, lowestArc, ringRadii } from "./geometry";
import { chartTone, type ChartTone } from "./tones";

type Ring = { key: string; value: number | null; tone: ChartTone; state: "normal" | "stale" | "unknown" | "out"; tick?: number | null; label: string };
type Segment = { key: string; value: number; tone: ChartTone; label: string };
interface RingProps { variant: "concentric" | "donut" | "gauge"; trackTone?: ChartTone; projectionTone?: ChartTone; size: "dial" | "card" | "donut" | "donutCompact" | "gauge" | "mini" | "coverage"; rings?: Ring[]; segments?: Segment[]; shape?: "full" | "half"; gauge?: { lower: number | null; upper: number | null; projection: { lower: number | null; upper: number | null } | null; max: number }; center?: ReactNode; detail?: ReactNode; active?: string | null; onActiveChange?: (key: string | null) => void; onSelect?: (key: string) => void; dataKey?: string; "aria-label": string }

function RingStroke({ mid, radius, stroke, ring, entered, full, initial, index, dataKey }: { mid: number; radius: number; stroke: number; ring: Ring; entered: boolean; full: boolean; initial: boolean; index: number; dataKey?: string }) {
  const amount = useMotionValue(0), path = useTransform(() => arcPath(mid, mid, 0, Math.min(Math.PI * 1.9999, amount.get() * 2 * Math.PI), radius));
  useEffect(() => { amount.set(0); }, [dataKey]);
  useEffect(() => { const target = entered || !full ? clamp(ring.value! / 100) : 0; if (!full) { amount.set(target); return; } const control = animate(amount, target, { ...(initial ? data.enter : data.update), delay: initial ? staggerDelay(index) : 0 }); return () => control.stop(); }, [ring.value, entered, full, initial, index, amount, dataKey]);
  return <motion.path d={path} fill="none" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={ring.state === "stale" ? "3 4" : undefined} className={chartTone(ring.tone).stroke} visibility={ring.value === 0 ? "hidden" : undefined}/>;
}

function DonutArc({ id, a0, a1, start, full, entered, intro, index, track, tone, trackTone, active, onHeight, dataKey }: { id: string; a0: number; a1: number; start: number; full: boolean; entered: boolean; intro: boolean; index: number; track?: boolean; tone: ChartTone; trackTone?: ChartTone; active: boolean; onHeight: (id: string, value: number | null) => void; dataKey?: string }) {
  const begin = useMotionValue(track ? a0 : start), end = useMotionValue(track ? a1 : start);
  const present = useIsPresent();
  const path = useTransform(() => arcPath(120, 120, begin.get(), end.get()));
  useEffect(() => { if (!track) { begin.set(start); end.set(start); } }, [dataKey]);
  useEffect(() => {
    const update = () => onHeight(id, lowestArc(120, begin.get(), end.get()) + 12);
    const stopA = begin.on("change", update), stopB = end.on("change", update);
    update();
    return () => { stopA(); stopB(); onHeight(id, null); };
  }, [id, begin, end, onHeight]);
  useEffect(() => {
    const middle = (begin.get() + end.get()) / 2, from = present ? a0 : middle, to = present ? a1 : middle;
    if (!full || !entered) {
      begin.set(entered || !full || track ? from : start);
      end.set(entered || !full || track ? to : start); return;
    }
    const entering = intro && present && !track;
    const tier = entering ? data.enter : data.update, delay = entering ? staggerDelay(index) : 0;
    const first = animate(begin, from, { ...tier, delay }), last = animate(end, to, { ...tier, delay }); return () => { first.stop(); last.stop(); };
  }, [a0, a1, full, entered, intro, index, present, track, start, begin, end]);
  const strokeTier = track ? data.update : spring.fast;
  return <motion.path data-arc-key={id} d={path} fill="none" strokeLinecap="round" className={track ? trackTone ? chartTone(trackTone).stroke : "stroke-hover" : chartTone(tone).stroke} initial={false} animate={{ strokeWidth: active && !track ? 20 : 16, opacity: present ? 1 : 0 }} exit={{ opacity: 0 }} transition={strokeTier} />;
}

function DonutReadout({ full, off, dimension, half, active, children }: {
  full: boolean; off: boolean; dimension: number; half: boolean; active: string | null; children: ReactNode;
}) {
  const content = off ? children : <motion.div key={active ?? "total"} className="flex flex-col items-center gap-1"
    initial={{ opacity: 0, y: full ? 4 : 0 }} animate={{ opacity: 1, y: 0 }} transition={spring.fast}>{children}</motion.div>;
  const classes = "absolute left-1/2 flex w-full flex-col items-center gap-1 px-6 text-center";
  return full ? <motion.div data-donut-center className={classes} initial={false}
    animate={{ top: dimension / 2, x: "-50%", y: half ? "-100%" : "-50%" }} transition={spring.slow}>{content}</motion.div>
    : <div data-donut-center className={classes} style={{ top: dimension / 2, transform: half ? "translate(-50%, -100%)" : "translate(-50%, -50%)" }}>{content}</div>;
}

export function RingChart({ variant, size, trackTone, projectionTone, rings = [], segments = [], shape = "full", gauge, center, detail, active = null, onActiveChange, onSelect, dataKey, "aria-label": label }: RingProps) {
  const plot = usePlot(dataKey, size === "dial"), [arcHeights, setArcHeights] = useState<Record<string, number>>({});
  const onHeight = useCallback((id: string, value: number | null) => setArcHeights(previous => { if (value === null) { const next = { ...previous }; delete next[id]; return next; } return previous[id] === value ? previous : { ...previous, [id]: value }; }), []);
  const visible = segments.filter(segment => Number.isFinite(segment.value) && segment.value > 0), keys = variant === "donut" ? visible.map(item => item.key) : rings.map(item => item.key), current = keys.includes(active ?? "") ? active : keys[0];
  const dimension = size === "dial" ? Math.max(112, Math.min(136, plot.width || 136)) : ({ card: 64, donut: 208, donutCompact: 168, gauge: 240, mini: 36, coverage: 112 }[size] ?? 136);
  const start = shape === "half" ? -Math.PI / 2 : 0, sweep = shape === "half" ? Math.PI : 2 * Math.PI, pad = 3.5 / 108 + 16 / 2 / 108, total = visible.reduce((sum, item) => sum + item.value, 0);
  const arcs = useMemo(() => { let used = 0; return visible.map(item => { const from = start + used * sweep; used += total ? item.value / total : 0; const to = start + used * sweep, middle = (from + to) / 2; return { ...item, a0: to - from > 2 * pad ? from + pad : middle, a1: to - from > 2 * pad ? to - pad : middle }; }); }, [segments, start, sweep, total]);
  const targetHeight = shape === "half" ? 133 : 240, drawnHeight = Math.max(targetHeight === 240 && !plot.full ? 240 : 0, ...Object.values(arcHeights), shape === "half" ? 133 : 0), donutHeight = plot.full ? Math.min(240, Math.max(133, drawnHeight || targetHeight)) : targetHeight;
  const activate = (key: string) => onActiveChange?.(key), attributes = (item: { key: string; label: string }) => ({ role: "button", tabIndex: item.key === current ? 0 : -1, "aria-label": item.label, "data-chart-key": item.key, onFocus: () => activate(item.key), onPointerEnter: () => activate(item.key), onClick: () => onSelect?.(item.key) });
  let graphic: ReactNode;
  if (variant === "donut") graphic = <div className="relative overflow-hidden" style={{ width: dimension, height: donutHeight / 240 * dimension }}><svg width={dimension} height={dimension} viewBox="0 0 240 240" data-shape={shape}>
    <DonutArc id="track" a0={shape === "half" ? start + pad : 0} a1={shape === "half" ? start + sweep - pad : Math.PI * 1.9999} start={start} full={plot.full} entered intro={false} index={0} track trackTone={trackTone} tone="muted" active={false} onHeight={onHeight}/>
    <AnimatePresence>{arcs.map((item, index) => <DonutArc key={item.key} id={item.key} a0={item.a0} a1={item.a1} tone={item.tone} start={start} full={plot.full} entered={plot.entered} intro={plot.initial} index={index} active={active === item.key} onHeight={onHeight} dataKey={dataKey}/>)}</AnimatePresence>
    {arcs.map(item => <path key={item.key} {...attributes(item)} d={arcPath(120, 120, item.a0, item.a1)} fill="none" stroke="transparent" strokeWidth={30} pointerEvents="stroke" className="cursor-pointer outline-none focus-visible:stroke-ring" />)}
  </svg>{center ? <DonutReadout full={plot.full} off={plot.mode === "off"} dimension={dimension} half={shape === "half"} active={active}>{center}{shape === "half" ? null : detail}</DonutReadout> : null}</div>;
  else if (variant === "gauge") {
    const max = gauge && Number.isFinite(gauge.max) && gauge.max > 0 ? gauge.max : 1, arc = (from: number, to: number) => arcPath(120, 116, -Math.PI / 2 + clamp(from / max) * Math.PI, -Math.PI / 2 + clamp(to / max) * Math.PI, 96), present = gauge?.lower !== null && gauge?.lower !== undefined;
    graphic = <div className="relative" style={{ width: dimension, height: dimension * 132 / 240 }}><svg width={dimension} height={dimension * 132 / 240} viewBox="0 0 240 132"><path d={arc(0, max)} fill="none" strokeWidth={16} strokeLinecap="round" className={trackTone ? chartTone(trackTone).stroke : "stroke-hover"}/>{gauge?.projection?.lower != null && gauge.projection.upper != null ? <GeometryPath full={plot.full} data-gauge="projection" d={arc(gauge.projection.lower, plot.full && !plot.entered ? gauge.projection.lower : gauge.projection.upper)} fill="none" strokeWidth={16} strokeDasharray="2 6" strokeLinecap="round" className={projectionTone ? chartTone(projectionTone).stroke : "stroke-active"} transition={plot.tier}/> : null}{gauge?.upper != null && gauge.lower != null && gauge.upper > gauge.lower ? <GeometryPath full={plot.full} data-gauge="range" d={arc(gauge.lower, plot.full && !plot.entered ? gauge.lower : gauge.upper)} fill="none" strokeWidth={16} strokeOpacity={.35} strokeLinecap="round" className="stroke-series-codex" transition={plot.tier}/> : null}{present ? <GeometryPath full={plot.full} data-gauge="lower" d={arc(0, plot.full && !plot.entered ? 0 : gauge!.lower!)} fill="none" strokeWidth={16} strokeLinecap="round" className="stroke-series-codex" transition={plot.tier}/> : null}</svg>{center ? <div className="absolute inset-0 flex flex-col items-center justify-end pb-2 text-center">{center}</div> : null}</div>;
  } else {
    const dial = size === "dial", radii = dial ? ringRadii(rings.length) : [size === "card" ? 30 : size === "mini" ? 13 : 46], view = dial ? 140 : size === "card" ? 72 : size === "mini" ? 36 : 112, mid = view / 2;
    graphic = <div className="relative" style={{ width: dimension, height: dimension }}><svg width={dimension} height={dimension} viewBox={`0 0 ${view} ${view}`}>
      {rings.slice(0, radii.length).map((item, index) => { const radius = radii[index], stroke = dial ? rings.length >= 3 ? 9 : 11 : size === "card" ? 6 : size === "mini" ? 5 : 7, unknown = item.value === null || item.state === "unknown", angle = item.tick == null ? null : -Math.PI / 2 + item.tick * 2 * Math.PI, half = stroke / 2 + 3;
        return <g key={item.key} data-ring-key={item.key} data-state={item.state} data-chart-value={unknown ? "unknown" : item.value} opacity={index ? .66 : 1}><circle cx={mid} cy={mid} r={radius} fill="none" strokeWidth={stroke} className={item.state === "out" ? "stroke-warn" : trackTone ? chartTone(trackTone).stroke : "stroke-hover"}/>{!unknown ? <RingStroke mid={mid} radius={radius} stroke={stroke} ring={item} entered={plot.entered} full={plot.full} initial={plot.initial} index={index} dataKey={dataKey}/> : null}{angle !== null ? <line x1={mid + Math.cos(angle) * (radius - half)} y1={mid + Math.sin(angle) * (radius - half)} x2={mid + Math.cos(angle) * (radius + half)} y2={mid + Math.sin(angle) * (radius + half)} strokeWidth={2} className="stroke-background"/> : null}<circle {...attributes(item)} cx={mid} cy={mid} r={radius} fill="none" stroke="transparent" strokeWidth={stroke + 5} pointerEvents="stroke" className="cursor-pointer outline-none focus-visible:stroke-ring"/></g>;
      })}
    </svg>{center ? <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div> : null}</div>;
  }
  // A half ring has room inside the arc for the label and value only; the detail line sits under the arc
  // instead of running into it (owner 2026-11-01).
  if (variant === "donut" && shape === "half" && detail) graphic = <>{graphic}<div data-donut-detail className="mt-2 text-center text-caption text-muted-foreground" style={{ maxWidth: dimension }}>{detail}</div></>;
  return <div ref={plot.ref} role="group" aria-label={label} tabIndex={0} data-chart="ring" data-variant={variant} data-size={size} data-ready={plot.ready} data-enter-count={plot.entries} data-active={active ?? ""} className={"flex min-w-0 flex-col items-center outline-none focus-visible:ring-1 focus-visible:ring-ring"} onPointerLeave={() => onActiveChange?.(null)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onActiveChange?.(null); }} onKeyDown={event => plotKeys(event, keys, active, onActiveChange, onSelect)}>{graphic}</div>;
}
