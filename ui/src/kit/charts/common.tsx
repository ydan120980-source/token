import { startTransition, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentPropsWithoutRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { portalRoot } from "@/lib/portal-root";
import { data, dataSettle, reducedFade, spring, staggerDelay } from "@ui/design/motion";
import { useKitMotion } from "../motion-mode";
import { isComposing } from "../ime";
import { useSettled } from "../settled";
import { positionTooltip, type Point } from "./geometry";

type NativeGraphic<T extends "path" | "rect"> = Omit<ComponentPropsWithoutRef<T>, "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "values" | "from">;
// Reduced mode writes SVG geometry synchronously (Motion's reduced-motion setting alone only disables
// transforms, not d/x/width tweens); a changed shape cross-fades in instead of moving. Off: no fade.
export function GeometryPath({ d, from, full, transition, opacity, ...props }: NativeGraphic<"path"> & { d: string; from?: string; full: boolean; transition: import("motion/react").Transition }) {
  const { fade } = useKitMotion();
  if (full) return <motion.path {...props} opacity={opacity} initial={from ? { d: from } : false} animate={{ d }} transition={transition}/>;
  return fade ? <motion.path key={d} {...props} d={d} initial={{ opacity: 0 }} animate={{ opacity: Number(opacity ?? 1) }} transition={reducedFade}/> : <path {...props} d={d} opacity={opacity}/>;
}
export function GeometryRect({ geometry, from, full, transition, opacity, ...props }: NativeGraphic<"rect"> & { geometry: { x: number; y: number; width: number; height: number; rx?: number }; from?: { x: number; y: number; width: number; height: number; rx?: number }; full: boolean; transition: import("motion/react").Transition }) {
  const { fade } = useKitMotion();
  if (full) return <motion.rect {...props} opacity={opacity} initial={from ?? false} animate={geometry} transition={transition}/>;
  return fade ? <motion.rect key={[geometry.x, geometry.y, geometry.width, geometry.height].join()} {...props} {...geometry} initial={{ opacity: 0 }} animate={{ opacity: Number(opacity ?? 1) }} transition={reducedFade}/> : <rect {...props} {...geometry} opacity={opacity}/>;
}

// Observer ownership is local to each plot. A resize updates layout only; a new
// dataKey resets entry. Timers/observers never survive a key change or unmount.
// One native delivery and one React commit for all changed plot widths. The
// Native sizes are read before any writes. Fixed-height off-screen plots can
// prepare geometry in interruptible work while visible content paints first.
const plotWidths = new Map<Element, { width: number; deferOffscreen: boolean; publish: (width: number) => void }>();
let plotWidthObserver: ResizeObserver | undefined;
function observePlotWidth(root: Element, publish: (width: number) => void, initialWidth: number, deferOffscreen: boolean) {
  const subscription = { width: initialWidth, publish, deferOffscreen };
  plotWidthObserver ??= new ResizeObserver(entries => {
    const changed: (() => void)[] = [], background: (() => void)[] = [];
    for (const entry of entries) {
      const current = plotWidths.get(entry.target), width = Math.round(entry.contentRect.width);
      if (!current || width <= 0 || current.width === width) continue;
      current.width = width;
      const box = current.deferOffscreen ? entry.target.getBoundingClientRect() : null;
      const target = box && (box.top > innerHeight + 128 || box.bottom < -128) ? background : changed;
      target.push(() => { if (plotWidths.get(entry.target) === current) current.publish(width); });
    }
    if (changed.length) flushSync(() => { for (const publish of changed) publish(); });
    if (background.length) startTransition(() => { for (const publish of background) publish(); });
  });
  plotWidths.set(root, subscription); plotWidthObserver.observe(root);
  return () => {
    if (plotWidths.get(root) !== subscription) return;
    plotWidths.delete(root); plotWidthObserver?.unobserve(root);
    if (!plotWidths.size) { plotWidthObserver?.disconnect(); plotWidthObserver = undefined; }
  };
}
export function usePlot(dataKey?: string, measureWidth = true, deferOffscreen = false) {
  const ref = useRef<HTMLDivElement>(null), { full, mode } = useKitMotion(), settled = useSettled();
  const [width, setWidth] = useState(0), [phase, setPhase] = useState({ key: dataKey, entered: settled, complete: settled });
  const entries = useRef(0);
  if (phase.key !== dataKey) setPhase({ key: dataKey, entered: false, complete: false });
  useLayoutEffect(() => {
    const root = ref.current; if (!root) return;
    // Native resize delivery follows layout. Publish the real width before paint
    // without forcing all newly mounted charts to lay out inside a React commit.
    // Plot roots have no padding/border/vertical scrollbar: their native
    // content-box width rounded to CSS pixels equals clientWidth, without a DOM read.
    const unobserve = measureWidth ? observePlotWidth(root, setWidth, width, deferOffscreen) : () => {};
    return unobserve;
  }, [measureWidth, deferOffscreen]);
  // Width strategy changes never restart the entry motion. Only a data key
  // change re-arms the original intersection/entry lifecycle.
  useEffect(() => {
    const root = ref.current; if (!root) return;
    const intersection = new IntersectionObserver(values => { if (values.some(value => value.isIntersecting && value.intersectionRatio >= .25)) { entries.current++; setPhase(previous => ({ ...previous, entered: true })); intersection.disconnect(); } }, { threshold: .25 });
    intersection.observe(root); return () => intersection.disconnect();
  }, [dataKey]);
  useEffect(() => { if (!phase.entered) return; if (!full) { setPhase(previous => previous.complete ? previous : { ...previous, complete: true }); return; } const timer = setTimeout(() => setPhase(previous => ({ ...previous, complete: true })), dataSettle * 1000); return () => clearTimeout(timer); }, [phase.entered, dataKey, full]);
  const initial = !phase.complete, tier = initial ? data.enter : data.update;
  return { ref, width, full, mode, entered: phase.entered, initial, ready: (!measureWidth || width > 0) && phase.entered && (!full || phase.complete), entries: entries.current, tier, transition: (index = 0) => ({ ...tier, delay: initial ? staggerDelay(index) : 0 }) };
}
export function plotKeys(event: KeyboardEvent<HTMLElement | SVGElement>, keys: string[], active: string | null | undefined, change?: (key: string | null) => void, select?: (key: string) => void, vertical = false) {
  if (isComposing(event) || !keys.length) return;
  const index = Math.max(0, keys.indexOf(active ?? "")), directions: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, ...(vertical ? { ArrowUp: index - 1, ArrowDown: index + 1 } : {}), Home: 0, End: keys.length - 1 };
  if (event.key in directions) { event.preventDefault(); event.stopPropagation(); const key = keys[Math.max(0, Math.min(keys.length - 1, directions[event.key]))]; change?.(key); const root = event.currentTarget; root.querySelector<HTMLElement | SVGElement>('[data-chart-key="' + CSS.escape(key) + '"]')?.focus(); }
  else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); change?.(null); }
  else if (event.key === "Enter" && active != null && keys.includes(active)) { event.preventDefault(); event.stopPropagation(); select?.(active); }
}

// One window-level layer for calendar/hour cells and small charts. The first
// registered chart renders it into the shared portal, even when that chart's
// page is hidden. Ownership transfers on unmount; no detached anchor survives.
// "annotation" (Swift Charts' selection annotation): the card sits above the plot, centred on the mark and kept
// inside the chart's width, so it never covers data; a pointer only chooses which mark it belongs to.
type Placement = "pointer" | "above" | "plot" | "annotation" | "right" | "left";
type WindowTip = { owner: string; key: string | null; content: ReactNode; anchor: Element; point: Point | null; placement: Placement };
const tipOwners: string[] = [], tipListeners = new Set<() => void>();
let tipSnapshot: { renderer: string | null; tip: WindowTip | null } = { renderer: null, tip: null };
let pendingTip: WindowTip | null = null, pointerFrame = 0;
function commitTip(tip: WindowTip | null) { tipSnapshot = { renderer: tipOwners[0] ?? null, tip }; for (const listener of tipListeners) listener(); }
function publishTip(tip: WindowTip | null, pointer = false) {
  if (pointer && tip && tipSnapshot.tip) {
    pendingTip = tip;
    if (!pointerFrame) pointerFrame = requestAnimationFrame(() => { const next = pendingTip; pointerFrame = 0; pendingTip = null; commitTip(next?.anchor.isConnected ? next : null); });
    return;
  }
  if (pointerFrame) cancelAnimationFrame(pointerFrame);
  pointerFrame = 0; pendingTip = null; commitTip(tip);
}
const subscribeTip = (listener: () => void) => { tipListeners.add(listener); return () => { tipListeners.delete(listener); }; };
export const sharedTooltipId = "kit-window-chart-tooltip";
// The old heat tooltip grew from its bottom centre as it faded in (motion.css .heat-tooltip); reduced motion only fades.
const tipFrom = { opacity: 0, scale: 0.96, y: 4 }, tipFade = { opacity: 0 }, tipAt = { opacity: 1, scale: 1, y: 0 };
function WindowTooltip() {
  const tip = useSyncExternalStore(subscribeTip, () => tipSnapshot.tip);
  const ref = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 0, height: 0 }), { mode } = useKitMotion();
  useLayoutEffect(() => { if (!tip) return; const element = ref.current; if (!element) return; const measure = () => setSize(previous => previous.width === element.offsetWidth && previous.height === element.offsetHeight ? previous : { width: element.offsetWidth, height: element.offsetHeight }); measure(); const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect(); }, [tip?.content, tip?.owner]);
  useEffect(() => {
    const hide = () => { if (tipSnapshot.tip || pendingTip) publishTip(null); };
    const scroll = (event: Event) => {
      const current = tipSnapshot.tip;
      if (!current) return;
      // Only a scroll that moves the anchor matters; another list scrolling elsewhere leaves the card where it is.
      if (event.target instanceof Node && !event.target.contains(current.anchor)) return;
      if ((current.placement === "plot" || !current.point) && current.anchor.contains(document.activeElement)) publishTip({ ...current });
      else hide();
    };
    const visibility = () => { if (document.hidden) hide(); };
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", hide);
    window.addEventListener("ui-view-leave", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("ui-view-leave", hide);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  let left = 8, top = 8;
  if (tip && tip.anchor.isConnected) {
    const box = (tip.placement === "plot" || tip.placement === "annotation" ? tip.anchor.closest("svg") ?? tip.anchor : tip.anchor).getBoundingClientRect();
    if (tip.placement === "plot") {
      const position = positionTooltip(box, size, tip.point ?? { x: box.width / 2, y: box.height / 2 });
      left = box.left + position.x; top = box.top + position.y;
    }
    else if (tip.placement === "annotation") {
      const mark = tip.anchor.getBoundingClientRect(), centre = mark.left + mark.width / 2;
      left = Math.max(box.left, Math.min(box.right - size.width, centre - size.width / 2));
      top = box.top - size.height - 8; if (top < 8) top = box.bottom + 8;
    }
    else if (tip.placement === "above") { left = (tip.point?.x ?? box.left + box.width / 2) - size.width / 2; top = box.top - size.height - 10; if (top < 8) top = box.bottom + 10; }
    // Beside a list, so the card covers none of the rows the pointer is moving through.
    else if (tip.placement === "right") { left = box.right + 8; top = box.top; if (left + size.width > innerWidth - 8) left = box.left - size.width - 8; }
    else if (tip.placement === "left") { left = box.left - size.width - 8; top = box.top; if (left < 8) left = box.right + 8; }
    else if (tip.point) { left = tip.point.x + 14; top = tip.point.y - size.height - 10; if (left + size.width > innerWidth - 8) left = tip.point.x - size.width - 14; if (top < 8) top = tip.point.y + 18; }
    else { left = box.left + box.width / 2 - size.width / 2; top = box.top - size.height - 10; if (top < 8) top = box.bottom + 10; }
    left = Math.max(8, Math.min(innerWidth - size.width - 8, left)); top = Math.max(8, Math.min(innerHeight - size.height - 8, top));
  }
  const plotWidth = tip?.placement === "plot" || tip?.placement === "annotation" ? (tip.anchor.closest("svg") ?? tip.anchor).getBoundingClientRect().width - 16 : innerWidth - 16;
  return createPortal(<AnimatePresence initial={false}>{tip ? <motion.div key={tip.owner} ref={ref} id={sharedTooltipId} role="tooltip" data-chart-tooltip data-tooltip-owner={tip.owner} className="kit-window-tooltip pointer-events-none fixed z-50 flex w-max flex-col gap-1 rounded-xl px-3 py-2 text-caption shadow-surface-5" style={{ left, top, maxWidth: Math.min(320, innerWidth - 16, plotWidth), transformOrigin: "50% 100%" }} initial={mode === "off" ? false : mode === "full" ? tipFrom : tipFade} animate={tipAt} exit={mode === "off" ? undefined : mode === "full" ? tipFrom : tipFade} transition={spring.fast}>{tip.content}</motion.div> : null}</AnimatePresence>, portalRoot());
}

// Each chart reads only primitives about itself (its active key, whether it renders the layer), so a
// pointer move re-renders the tooltip layer alone, never every chart on the page (owner 2026-10-29: hover lag).
export function useSharedChartTooltip(enabled = true) {
  const owner = useId();
  const active = useSyncExternalStore(subscribeTip, () => tipSnapshot.tip?.owner === owner ? tipSnapshot.tip.key : undefined);
  const renderer = useSyncExternalStore(subscribeTip, () => tipSnapshot.renderer === owner);
  useEffect(() => { if (!enabled) return; tipOwners.push(owner); publishTip(tipSnapshot.tip); return () => { const index = tipOwners.indexOf(owner); if (index >= 0) tipOwners.splice(index, 1); publishTip(tipSnapshot.tip?.owner === owner ? null : tipSnapshot.tip); }; }, [enabled, owner]);
  const hide = () => { if (tipSnapshot.tip?.owner === owner || pendingTip?.owner === owner) publishTip(tipSnapshot.tip?.owner === owner ? null : tipSnapshot.tip); };
  // Call only when the chart's input props change, not when this store notifies.
  // Keep owner/key/anchor/point intact so React updates the existing card.
  const refresh = (resolve: (key: string | null) => ReactNode, exists: (key: string | null) => boolean) => {
    const current = pendingTip?.owner === owner ? pendingTip : tipSnapshot.tip;
    if (!enabled || current?.owner !== owner) return;
    if (!current.anchor.isConnected || !exists(current.key)) { publishTip(null); return; }
    publishTip({ ...current, content: resolve(current.key) });
  };
  return { show: (key: string | null, content: ReactNode, anchor: Element, point: Point | null = null, placement: Placement = "pointer") => {
    if (!enabled) return;
    const current = pendingTip?.owner === owner ? pendingTip : tipSnapshot.tip;
    publishTip({ owner, key, content: current?.owner === owner && current.key === key && current.anchor === anchor ? current.content : content, anchor, point, placement }, point !== null);
  }, refresh, hide, active, open: active !== undefined, layer: renderer ? <WindowTooltip/> : null };
}

export function CursorReadout({ children, x, width, top, detail = false, id }: { children: ReactNode; x: number; width: number; top: number; detail?: boolean; id: string }) {
  const ref = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => { const element = ref.current; if (!element) return; const measure = () => setSize({ width: element.offsetWidth, height: element.offsetHeight }); measure(); const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect(); }, []);
  return <div ref={ref} id={id} role="tooltip" data-chart-tooltip
    className={detail ? "pointer-events-none absolute right-0 top-0 text-caption font-semibold text-foreground" :
      "pointer-events-none absolute flex h-6 items-center gap-2 rounded-full bg-surface-3 px-3 text-caption text-foreground shadow-surface-3"}
    style={detail ? { maxWidth: width } : { left: Math.max(0, Math.min(width - size.width, x - size.width / 2)),
      top: Math.max(0, top - size.height - 6), maxWidth: width }}>{children}</div>;
}
