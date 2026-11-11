import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, animate, motion, useMotionTemplate, useMotionValue, useMotionValueEvent, type MotionValue } from "motion/react";
import { reducedFade, spring } from "@ui/design/motion";
import { useKitMotion } from "./motion-mode";

// Panes the person arranges (owner 2026-11-04, UI-READER-PANES-20261104.md): hold a pane's head, or a row that opens one, and it
// lifts, frosted, and follows the pointer; a region shows where it would land and slides between the places on offer; letting go
// flies it in from where it is, keeping the pointer's speed. Nothing else is laid out again until then, so a long conversation
// costs nothing while the pointer moves. Escape, or letting go away from every pane, puts it back.

export type PaneEdge = "left" | "right" | "top" | "bottom" | "center";
export type PaneColumns = number[][];
type Box = { left: number; top: number; width: number; height: number };
export type PaneTarget = { slot: number; edge: PaneEdge; box: Box };
export type PaneDrag<S> = { source: S; target: PaneTarget | null; landing: boolean };

const LONG_PRESS = 260, SLOP = 6, EDGE = 0.3, LIFT_SCALE = 0.62, LIFT_BLUR = 2.5;
const GHOST_WIDTH = 520, GHOST_HEIGHT = 640, MARGIN = 8;
const within = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

const inBox = (box: Box, x: number, y: number) => x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height;
function edgeAt(box: Box, x: number, y: number): PaneEdge {
  const across = (x - box.left) / box.width, down = (y - box.top) / box.height, side = Math.min(across, 1 - across), level = Math.min(down, 1 - down);
  if (Math.min(side, level) > EDGE) return "center";
  return side < level ? (across < .5 ? "left" : "right") : (down < .5 ? "top" : "bottom");
}
function zone(box: Box, edge: PaneEdge): Box {
  if (edge === "left") return { ...box, width: box.width / 2 };
  if (edge === "right") return { ...box, left: box.left + box.width / 2, width: box.width / 2 };
  if (edge === "top") return { ...box, height: box.height / 2 };
  if (edge === "bottom") return { ...box, top: box.top + box.height / 2, height: box.height / 2 };
  return box;
}
const plain = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });

/**
 * The gesture. `press` goes on what can be held, with a selector for the parts of it that keep their own click. `allow` says
 * whether a place is on offer; a side that is not falls back to the middle of the pane, if that is.
 */
export function usePaneDrag<S>({ allow, onDrop }: { allow: (source: S, slot: number, edge: PaneEdge) => boolean; onDrop: (source: S, target: PaneTarget) => void }) {
  const pointerX = useMotionValue(0), pointerY = useMotionValue(0), [drag, setDrag] = useState<PaneDrag<S> | null>(null);
  const latest = useRef({ allow, onDrop }); latest.current = { allow, onDrop };
  const ended = useRef<(() => void) | null>(null);
  useEffect(() => () => ended.current?.(), []);
  const press = useCallback((event: ReactPointerEvent<Element>, source: S, keep?: string) => {
    if (event.button !== 0 || (keep && (event.target as Element).closest?.(keep))) return;
    const handle = event.currentTarget as HTMLElement, startX = event.clientX, startY = event.clientY, pointer = event.pointerId;
    let lifted = false, target: PaneTarget | null = null, cells: { slot: number; box: Box }[] = [];
    handle.dataset.panePressing = "";
    const locate = (x: number, y: number): PaneTarget | null => {
      const cell = cells.find(item => inBox(item.box, x, y));
      if (!cell) return null;
      const edge = edgeAt(cell.box, x, y), { allow } = latest.current;
      if (allow(source, cell.slot, edge)) return { slot: cell.slot, edge, box: zone(cell.box, edge) };
      return edge !== "center" && allow(source, cell.slot, "center") ? { slot: cell.slot, edge: "center", box: cell.box } : null;
    };
    const swallow = (click: MouseEvent) => { click.preventDefault(); click.stopPropagation(); };
    const stop = () => {
      window.clearTimeout(timer); delete handle.dataset.panePressing; document.body.classList.remove("ff-pane-dragging");
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); window.removeEventListener("keydown", key, true);
      ended.current = null;
    };
    const finish = (place: PaneTarget | null) => {
      stop();
      // The click that follows this release belongs to the gesture, not to what lies under the pointer.
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      setDrag(current => current && { ...current, target: place, landing: true });
      if (place) latest.current.onDrop(source, place);
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      if (!lifted) { if (Math.hypot(next.clientX - startX, next.clientY - startY) > SLOP) stop(); return; }
      pointerX.set(next.clientX); pointerY.set(next.clientY);
      const place = locate(next.clientX, next.clientY);
      if (place?.slot !== target?.slot || place?.edge !== target?.edge) { target = place; setDrag(current => current && { ...current, target: place }); }
    };
    const up = (next: PointerEvent) => { if (next.pointerId !== pointer) return; if (lifted) finish(target); else stop(); };
    const cancel = (next: PointerEvent) => { if (next.pointerId !== pointer) return; if (lifted) finish(null); else stop(); };
    const key = (next: KeyboardEvent) => { if (next.key === "Escape" && lifted) { next.preventDefault(); next.stopPropagation(); finish(null); } };
    const timer = window.setTimeout(() => {
      lifted = true; delete handle.dataset.panePressing; document.body.classList.add("ff-pane-dragging");
      window.getSelection()?.removeAllRanges();
      cells = [...document.querySelectorAll<HTMLElement>("[data-pane-cell]")].map(cell => ({ slot: Number(cell.dataset.paneCell), box: plain(cell.getBoundingClientRect()) }));
      pointerX.set(startX); pointerY.set(startY);
      window.addEventListener("click", swallow, true);
      target = locate(startX, startY);
      setDrag({ source, target, landing: false });
    }, LONG_PRESS);
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel); window.addEventListener("keydown", key, true);
    ended.current = stop;
  }, []);
  const settled = useCallback(() => setDrag(null), []);
  return { drag, pointerX, pointerY, press, settled };
}

/** Where a slot sits in the arrangement. */
function placeOf(columns: PaneColumns, slot: number) {
  const rows = Math.max(1, ...columns.map(column => column.length));
  for (let column = 0; column < columns.length; column++) {
    const row = columns[column].indexOf(slot);
    if (row >= 0) { const span = rows / columns[column].length; return { column: column + 1, row: row * span + 1, span }; }
  }
  return { column: 1, row: 1, span: rows };
}

/** One pane's place. The pane itself never leaves this element, so moving it keeps its scroll position and everything it has read. */
export function PaneCell({ slot, columns, lifted, pointerX, pointerY, children }: { slot: number; columns: PaneColumns; lifted: boolean; pointerX: MotionValue<number>; pointerY: MotionValue<number>; children: ReactNode }) {
  const { full, fade } = useKitMotion(), cell = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0), y = useMotionValue(0), scale = useMotionValue(1), blur = useMotionValue(0), originX = useMotionValue(.5), originY = useMotionValue(.5), opacity = useMotionValue(1);
  const filter = useMotionTemplate`blur(${blur}px)`, [raised, setRaised] = useState(false);
  const layoutKey = JSON.stringify(columns), place = placeOf(columns, slot);
  // Read before this render reaches the page: where the pane is now, so it can go from there.
  const seen = useRef({ layoutKey, lifted }), before = useRef<{ cell: Box; pane: Box } | null>(null), grab = useRef({ x: 0, y: 0 });
  if ((seen.current.layoutKey !== layoutKey || seen.current.lifted !== lifted) && cell.current && inner.current) before.current = { cell: plain(cell.current.getBoundingClientRect()), pane: plain(inner.current.getBoundingClientRect()) };
  // Under the pointer, as far as the page allows: what is held is never pushed out of sight.
  const limits = useRef({ left: 0, right: 0, top: 0, bottom: 0 });
  useMotionValueEvent(pointerX, "change", value => { if (lifted) x.set(within(value - grab.current.x, limits.current.left, limits.current.right)); });
  useMotionValueEvent(pointerY, "change", value => { if (lifted) y.set(within(value - grab.current.y, limits.current.top, limits.current.bottom)); });
  useLayoutEffect(() => {
    const was = seen.current, from = before.current; seen.current = { layoutKey, lifted }; before.current = null;
    const element = cell.current; if (!element) return;
    const now = plain(element.getBoundingClientRect());
    if (lifted && !was.lifted) {
      grab.current = { x: pointerX.get(), y: pointerY.get() };
      const atX = (grab.current.x - now.left) / now.width, atY = (grab.current.y - now.top) / now.height, page = element.closest("main")?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
      originX.set(atX); originY.set(atY);
      const shownLeft = now.left + atX * now.width * (1 - LIFT_SCALE), shownTop = now.top + atY * now.height * (1 - LIFT_SCALE);
      limits.current = { left: page.left + MARGIN - shownLeft, right: page.right - MARGIN - now.width * LIFT_SCALE - shownLeft, top: page.top + MARGIN - shownTop, bottom: page.bottom - MARGIN - now.height * LIFT_SCALE - shownTop };
      setRaised(true);
      if (full) { void animate(scale, LIFT_SCALE, spring.moderate); void animate(blur, LIFT_BLUR, spring.moderate); }
      else { scale.set(LIFT_SCALE); blur.set(LIFT_BLUR); }
      return;
    }
    if (!from) return;
    if (was.lifted && !lifted) {
      // Letting go: from exactly where it is on screen, with the pointer's speed, into wherever its place is now.
      const speedX = pointerX.getVelocity(), speedY = pointerY.getVelocity(), ratio = from.pane.width / now.width;
      originX.set(0); originY.set(0); x.set(from.pane.left - now.left); y.set(from.pane.top - now.top); scale.set(ratio);
      const done = () => { setRaised(false); originX.set(.5); originY.set(.5); };
      if (!full) { x.set(0); y.set(0); scale.set(1); blur.set(0); if (fade) { opacity.set(0); void animate(opacity, 1, reducedFade); } done(); return; }
      void animate(x, 0, { ...spring.slow, velocity: speedX }); void animate(y, 0, { ...spring.slow, velocity: speedY });
      void animate(blur, 0, spring.moderate); void animate(scale, 1, { ...spring.slow, onComplete: done });
      return;
    }
    // Moved aside by another pane: its size is already right, so only its place travels and its text never stretches.
    const dx = from.cell.left - now.left, dy = from.cell.top - now.top;
    if (!full || (!dx && !dy)) return;
    x.set(dx); y.set(dy); void animate(x, 0, spring.slow); void animate(y, 0, spring.slow);
  }, [layoutKey, lifted]);
  return <div ref={cell} className="relative min-h-0 min-w-0" data-pane-cell={slot} data-lifted={lifted || undefined} style={{ gridColumn: place.column, gridRow: place.row + " / span " + place.span }}>
    {raised ? <div aria-hidden="true" className="absolute inset-0 rounded-2xl bg-muted" data-pane-hole /> : null}
    <motion.div ref={inner} className={"h-full" + (raised ? " relative z-40 rounded-2xl shadow-surface-5" : "")} data-pane-inner style={{ x, y, scale, originX, originY, opacity, filter: raised ? filter : undefined }}>{children}</motion.div>
  </div>;
}

/** The arrangement: rows of the tallest column, and the region showing where a held pane would land. */
export function PaneGrid({ columns, target, label, children }: { columns: PaneColumns; target: PaneTarget | null; label?: string; children: ReactNode }) {
  const { full } = useKitMotion(), root = useRef<HTMLDivElement>(null), rows = Math.max(1, ...columns.map(column => column.length));
  const origin = root.current?.getBoundingClientRect(), box = target && origin ? { x: target.box.left - origin.left, y: target.box.top - origin.top, width: target.box.width, height: target.box.height } : null;
  return <div ref={root} className="relative grid h-full min-h-0 min-w-0 flex-1 gap-3" data-pane-grid data-pane-rows={rows} style={{ gridTemplateColumns: "repeat(" + Math.max(1, columns.length) + ", minmax(0, 1fr))", gridTemplateRows: "repeat(" + rows + ", minmax(0, 1fr))" }}>
    {children}
    <AnimatePresence>
      {box ? <motion.div key="zone" aria-hidden="true" className="ff-pane-drop pointer-events-none absolute left-0 top-0 z-30 flex justify-center rounded-2xl pt-4" data-pane-zone={target!.edge}
        initial={{ opacity: 0, ...box }} animate={{ opacity: 1, ...box }} exit={{ opacity: 0, transition: spring.fast.exit }} transition={full ? spring.moderate : reducedFade}>
        {label ? <span className="self-start rounded-full bg-popover px-3 py-1 text-caption font-medium text-foreground shadow-card" data-pane-zone-label>{label}</span> : null}
      </motion.div> : null}
    </AnimatePresence>
  </div>;
}

/** What is held when a row is: its pane does not exist yet, and nothing is read until it lands, so this is the pane's shape. */
export function PaneGhost({ drag, pointerX, pointerY, onSettled, children }: { drag: PaneDrag<unknown> | null; pointerX: MotionValue<number>; pointerY: MotionValue<number>; onSettled: () => void; children: ReactNode }) {
  const { full } = useKitMotion(), x = useMotionValue(0), y = useMotionValue(0), scale = useMotionValue(full ? .4 : LIFT_SCALE), opacity = useMotionValue(0), blur = useMotionValue(LIFT_BLUR);
  const filter = useMotionTemplate`blur(${blur}px)`, shown = GHOST_WIDTH * LIFT_SCALE;
  const landing = Boolean(drag?.landing);
  const follow = () => { if (!landing) { x.set(within(pointerX.get() - shown / 2, MARGIN, innerWidth - MARGIN - shown)); y.set(within(pointerY.get() - 28, MARGIN, innerHeight - MARGIN - GHOST_HEIGHT * LIFT_SCALE)); } };
  useMotionValueEvent(pointerX, "change", follow); useMotionValueEvent(pointerY, "change", follow);
  useLayoutEffect(() => {
    follow();
    if (full) { void animate(scale, LIFT_SCALE, spring.moderate); void animate(opacity, 1, spring.fast); } else { scale.set(LIFT_SCALE); opacity.set(1); }
  }, []);
  useLayoutEffect(() => {
    if (!landing) return;
    const box = drag?.target?.box;
    if (!full) { onSettled(); return; }
    if (box) { void animate(x, box.left, { ...spring.moderate, velocity: pointerX.getVelocity() }); void animate(y, box.top, { ...spring.moderate, velocity: pointerY.getVelocity() }); void animate(scale, box.width / GHOST_WIDTH, spring.moderate); void animate(blur, 0, spring.moderate); }
    void animate(opacity, 0, { ...spring.moderate, onComplete: onSettled });
  }, [landing]);
  return createPortal(<div data-ui-portal=""><motion.div aria-hidden="true" className="ff-pane-ghost pointer-events-none fixed left-0 top-0 z-50 flex flex-col overflow-hidden rounded-2xl bg-card shadow-surface-5" data-pane-ghost style={{ x, y, scale, opacity, filter, originX: 0, originY: 0, width: GHOST_WIDTH, height: GHOST_HEIGHT }}>
    {children}
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-8 pt-4">
      <span className="h-10 w-1/2 self-end rounded-2xl bg-muted" />
      {[100, 96, 100, 88, 100, 72].map((width, at) => <span key={at} className="h-3 shrink-0 rounded-full bg-muted" style={{ width: width + "%" }} />)}
      <span className="h-24 shrink-0 rounded-xl bg-muted" />
      {[100, 92, 64].map((width, at) => <span key={at} className="h-3 shrink-0 rounded-full bg-muted" style={{ width: width + "%" }} />)}
    </div>
  </motion.div></div>, document.body);
}
