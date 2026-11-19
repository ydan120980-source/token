import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useMotionValue } from "motion/react";
import { dragSettle, dragSpring, reducedFade, spring, velocityTracker } from "@ui/design/motion";
import { useKitMotion } from "./motion-mode";
import { isComposing } from "./ime";

export interface SortableProps {
  items: { key: string; node: ReactNode; label: string }[];
  onReorder: (keys: string[]) => void;
  "aria-label": string;
  immediate?: boolean;
  // Pick up on a hold OR on a small move, the way the Agent cards do. For a board whose items are
  // also click targets: a tap stays a tap, and either habit (hold, then drag) works without the
  // person having to learn which one this board wants.
  eager?: boolean;
  // Whether the item itself joins the tab order. Leave it on where the item is the only focusable
  // thing; turn it off where the content inside already carries focus, so Tab visits one stop.
  focusable?: boolean;
  delay?: number;
}

type Slot = { left: number; top: number; width: number; height: number; cx: number; cy: number };
// Pointer travel that still counts as a click, not a drag. Small enough to feel instant for a real
// drag, big enough that a tap on a widget does not become one.
const DRAG_SLOP = 8;
// The controls a drag must never swallow. Same list as the widget card's own click gate
// (ui/src/kit/widgets.tsx) so a press that belongs to a control cannot become a card pickup.
export const INTERACTIVE = "button, a, input, select, textarea, summary, [role=button], [role=switch], [role=slider], [contenteditable]";
type Hold = {
  key: string;
  pointer: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  live: boolean;
  original: string[];
  preview: string[];
  slots: Slot[];
  originalIndex: number;
  initialRect: { left: number; top: number; width: number; height: number };
};

export function Sortable({
  items,
  onReorder,
  "aria-label": label,
  immediate = false,
  eager = false,
  focusable = true,
  delay = 350,
}: SortableProps) {
  const root = useRef<HTMLDivElement>(null);
  const hold = useRef<Hold | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppress = useRef(false);
  const pendingReorder = useRef<{ cancel: boolean; keys: string[]; changed: boolean } | null>(null);
  const { full, fade } = useKitMotion();
  // The latest `onReorder`, held in a ref. Callers pass an inline arrow, so its identity changes on
  // every parent render; keeping it in the dependency array of the landing effect made an unrelated
  // re-render mid-landing stop the springs and start them again (a visible backtrack and up to
  // +200 ms), and re-applied the release velocity that `thrown` still held.
  const reorder = useRef(onReorder);
  useLayoutEffect(() => { reorder.current = onReorder; });
  const track = useRef({ x: velocityTracker(), y: velocityTracker() });
  const thrown = useRef({ x: 0, y: 0 });
  const tiltSmooth = useRef(0);
  const focusBack = useRef<string | null>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useMotionValue(0);
  const scale = useMotionValue(1);
  // Two coordinate spaces, on purpose. While the card is in hand it is `fixed`: the pointer lives in
  // viewport space, so a fixed card tracks it exactly with no arithmetic. The moment it is released
  // it has to land on a placeholder that travels with the document, and no amount of scroll
  // arithmetic can do that without trailing the compositor by a frame - which is what "the card is
  // glued to the screen" looks like. So the landing switches to `absolute` in document coordinates:
  // the compositor moves it with the page and there is nothing left to correct.
  const [landing, setLanding] = useState<{ left: number; top: number } | null>(null);

  const [preview, setPreview] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [heldSlot, setHeldSlot] = useState<Slot | null>(null);
  const [release, setRelease] = useState(0);
  const [settling, setSettling] = useState(false);

  const byKey = new Map(items.map(item => [item.key, item]));
  const order = preview?.length === items.length && preview.every(key => byKey.has(key))
    ? preview
    : items.map(item => item.key);

  const nodes = () => [...root.current?.querySelectorAll<HTMLElement>("[data-sort-key]:not([data-sort-placeholder])") ?? []];

  const clearSuppression = () => {
    clearTimeout(suppressTimer.current);
    suppressTimer.current = setTimeout(() => {
      suppress.current = false;
    }, 50);
  };

  // A picked-up card is swapped for a placeholder, so the node that held focus is unmounted and
  // focus drops to <body>. React's onKeyDown is rooted at the list, so it never sees Escape once
  // that happens; the native card grid binds Escape on `window` for the same reason
  // (design/desktop-reference/quota-card-grid.js). Hand focus back once the card has landed.
  const restoreFocus = () => {
    const key = focusBack.current;
    focusBack.current = null;
    if (!key || document.activeElement !== document.body) return;
    nodes().find(item => item.dataset.sortKey === key)?.focus({ preventScroll: true });
  };

  const startDrag = (held: Hold) => {
    held.slots = nodes().map(item => {
      const b = item.getBoundingClientRect();
      return {
        left: b.left,
        top: b.top,
        width: b.width,
        height: b.height,
        cx: b.left + b.width / 2,
        cy: b.top + b.height / 2,
      };
    });
    held.live = true;
    x.set(held.dx);
    y.set(held.dy);
    tiltSmooth.current = 0;
    rotate.set(0);
    // Same rule as the native card grid: a lifted card is decorative feedback, so reduced motion
    // gets the same shape without the lift.
    scale.set(full ? 1.025 : 1);
    setLanding(null);
    // The node is about to be swapped for the placeholder. Remember it so Escape's handler can put
    // focus back where it was instead of leaving a keyboard user on <body>.
    focusBack.current = root.current?.contains(document.activeElement) ? held.key : null;
    track.current.x.reset(held.startX + held.dx);
    track.current.y.reset(held.startY + held.dy);
    setPicked(held.key);
    const originSlot = held.slots[held.originalIndex] || {
      left: held.initialRect.left,
      top: held.initialRect.top,
      width: held.initialRect.width,
      height: held.initialRect.height,
      cx: held.initialRect.left + held.initialRect.width / 2,
      cy: held.initialRect.top + held.initialRect.height / 2,
    };
    setHeldSlot(originSlot);
    setPreview([...held.original]);
    try {
      root.current?.setPointerCapture(held.pointer);
    } catch {
      // Pointer already left
    }
    document.body.classList.add("is-sorting");
  };

  const finish = (cancel: boolean) => {
    clearTimeout(timer.current);
    document.body.classList.remove("is-sorting");
    const held = hold.current;
    hold.current = null;
    if (!held?.live) return;

    const keys = cancel ? held.original : held.preview;
    const changed = !cancel && keys.some((key, i) => key !== held.original[i]);
    pendingReorder.current = { cancel, keys, changed };

    const originSlot = held.slots[held.originalIndex] || {
      left: held.initialRect.left,
      top: held.initialRect.top,
      width: held.initialRect.width,
      height: held.initialRect.height,
      cx: held.initialRect.left + held.initialRect.width / 2,
      cy: held.initialRect.top + held.initialRect.height / 2,
    };

    thrown.current = cancel
      ? { x: 0, y: 0 }
      : { x: track.current.x.velocity(), y: track.current.y.velocity() };

    setPreview(keys);
    suppress.current = true;
    clearTimeout(suppressTimer.current);

    // Hand the card from viewport space to document space in the same commit that starts the
    // landing, so the switch cannot be seen: document position = viewport position + scroll.
    setLanding({ left: originSlot.left + window.scrollX, top: originSlot.top + window.scrollY });
    setSettling(true);
    setRelease(v => v + 1);
  };

  useLayoutEffect(() => {
    if (!settling) return;
    if (!full) {
      x.set(0);
      y.set(0);
      tiltSmooth.current = 0;
      rotate.set(0);
      scale.set(1);
      const dropped = root.current?.querySelector<HTMLElement>("[data-sort-key][aria-grabbed=true]");
      if (fade && dropped) animate(dropped, { opacity: [0.4, 1] }, reducedFade);
      const pending = pendingReorder.current;
      pendingReorder.current = null;
      if (pending?.changed) reorder.current(pending.keys);
      setPicked(null);
      setPreview(null);
      setHeldSlot(null);
      setLanding(null);
      setSettling(false);
      clearSuppression();
      return;
    }

    // One read, in the layer's own space. The layer is `absolute` at `landing`, so the destination is
    // the placeholder's document position minus that origin; a scroll between the release and this
    // measure is already inside both numbers and needs no separate correction.
    const placeholderEl = root.current?.querySelector<HTMLElement>("[data-sort-placeholder]");
    const placeholderRect = placeholderEl?.getBoundingClientRect();
    const targetX = placeholderRect && landing ? placeholderRect.left + window.scrollX - landing.left : 0;
    const targetY = placeholderRect && landing ? placeholderRect.top + window.scrollY - landing.top : 0;

    const { x: vx, y: vy } = thrown.current;
    // The release velocity is handed to the springs once. Clearing it here means a rerun of this
    // effect (a motion-mode change, or a second release) cannot kick the card again.
    thrown.current = { x: 0, y: 0 };
    const animX = animate(x, targetX, vx ? { ...dragSpring, velocity: vx } : dragSpring);
    const animY = animate(y, targetY, vy ? { ...dragSpring, velocity: vy } : dragSpring);
    const animR = animate(rotate, 0, dragSettle);
    const animS = animate(scale, 1, dragSettle);

    let cancelled = false;
    void Promise.all([animX, animY, animR, animS]).then(() => {
      if (cancelled) return;
      const pending = pendingReorder.current;
      pendingReorder.current = null;
      if (pending?.changed) {
        reorder.current(pending.keys);
      }
      setPicked(null);
      setPreview(null);
      setHeldSlot(null);
      setLanding(null);
      setSettling(false);
      clearSuppression();
    });

    return () => {
      // Only a genuine restart owns the landing now: `release` (a newer drop) or the motion mode.
      // `landing` is deliberately out of the dependency array — it is set once per release and read
      // here, so listing it would restart the springs the moment the layer switches spaces.
      // `onReorder` is out too, through the ref: an unrelated parent render must not interrupt a
      // landing in flight. `settling` is left alone for the effect that replaces this one; the
      // promise above is cancelled so a stopped animation cannot settle the state underneath it.
      cancelled = true;
      animX.stop();
      animY.stop();
      animR.stop();
      animS.stop();
    };
  }, [release, full, fade]);

  useEffect(() => () => {
    clearTimeout(timer.current);
    clearTimeout(suppressTimer.current);
    x.stop();
    y.stop();
    rotate.stop();
    scale.stop();
    document.body.classList.remove("is-sorting");
    const element = root.current;
    const pointer = hold.current?.pointer;
    if (element && pointer !== undefined && element.hasPointerCapture(pointer)) {
      element.releasePointerCapture(pointer);
    }
  }, [x, y, rotate, scale]);

  // After the drop commits and the real card is back in the tree, put focus back on it. This has to
  // be an effect rather than part of the landing branch above: there the placeholder is still
  // mounted, so the card being restored is not in the list yet.
  useEffect(() => {
    if (picked === null) restoreFocus();
  }, [picked]);

  useEffect(() => {
    if (hold.current && (hold.current.original.length !== items.length || hold.current.original.some(key => !byKey.has(key)))) {
      finish(true);
    }
  }, [items]);

  // Escape while a card is in hand. The list's own onKeyDown handles the usual case, but the picked
  // node is replaced by the placeholder, focus drops to <body>, and the event stops reaching the
  // list at all. This bubble-phase listener runs after React's root, so a focused-card Escape is
  // still handled (and stopped) there and never arrives here twice.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !hold.current) return;
      event.preventDefault();
      finish(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      ref={root}
      role="list"
      aria-label={label}
      data-sortable=""
      data-picked={picked ?? ""}
      className="contents"
      onClickCapture={event => {
        if (suppress.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerDown={event => {
        suppress.current = false;
        clearTimeout(suppressTimer.current);
        if (event.button !== 0 || settling) return;
        const target = event.target as Element;
        if (target.closest(INTERACTIVE)) return;
        const node = target.closest<HTMLElement>("[data-sort-key]");
        if (!node) return;
        const key = node.dataset.sortKey;
        if (!key) return;

        clearTimeout(timer.current);
        const original = nodes().map(item => item.dataset.sortKey!);
        const originalIndex = original.indexOf(key);
        if (originalIndex === -1) return;

        const rect = node.getBoundingClientRect();
        const held: Hold = {
          key,
          pointer: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          dx: 0,
          dy: 0,
          live: false,
          original,
          preview: original,
          slots: [],
          originalIndex,
          initialRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        };
        hold.current = held;

        if (immediate) {
          // In immediate mode, startDrag will trigger as soon as displacement reaches threshold
        } else {
          timer.current = setTimeout(() => {
            if (hold.current === held) startDrag(held);
          }, delay);
        }
      }}
      onPointerMove={event => {
        const held = hold.current;
        if (!held || held.pointer !== event.pointerId) return;

        held.dx = event.clientX - held.startX;
        held.dy = event.clientY - held.startY;

        if (!held.live) {
          const dist = Math.hypot(held.dx, held.dy);
          if (immediate) {
            // A widget is also a click target, so a couple of pixels of hand shake must not turn a
            // click into a drag: DRAG_SLOP keeps a tap a tap.
            if (dist >= DRAG_SLOP) {
              clearTimeout(timer.current);
              startDrag(held);
            }
          } else if (eager) {
            // Eager items are click targets too, so the same slop applies: either habit picks up
            // (the hold above, once `delay` passes, or a deliberate move), and a tap shorter than
            // `delay` still ends as a click.
            if (dist >= DRAG_SLOP) {
              clearTimeout(timer.current);
              startDrag(held);
            }
          } else {
            if (dist > 6) {
              clearTimeout(timer.current);
              hold.current = null;
            }
          }
          return;
        }

        track.current.x.add(event.clientX, event.timeStamp);
        track.current.y.add(event.clientY, event.timeStamp);

        const vx = track.current.x.velocity();
        // Tilt and lift are decoration, so reduced motion keeps the card upright: the native card
        // grid's `still()` folds `reduced` in with `off` for exactly this reason.
        const targetTilt = full ? Math.max(-5, Math.min(5, (vx / 1000) * 14)) : 0;
        // Same easing on the tilt as the native card grid: the card leans towards the pointer's own
        // velocity instead of snapping to it, so a fast flick and a slow drift both read as weight.
        tiltSmooth.current += (targetTilt - tiltSmooth.current) * 0.25;
        rotate.set(full ? tiltSmooth.current : 0);

        x.set(held.dx);
        y.set(held.dy);

        const origin = held.slots[held.originalIndex] || held.initialRect;
        const floatingCenterX = origin.left + origin.width / 2 + held.dx;
        const floatingCenterY = origin.top + origin.height / 2 + held.dy;

        const distances = held.slots.map(slot => {
          const scx = slot.cx ?? (slot.left + slot.width / 2);
          const scy = slot.cy ?? (slot.top + slot.height / 2);
          return (floatingCenterX - scx) ** 2 + (floatingCenterY - scy) ** 2;
        });
        const to = distances.indexOf(Math.min(...distances));

        if (to !== -1) {
          const currentPos = held.preview.indexOf(held.key);
          if (to !== currentPos) {
            const next = held.preview.filter(k => k !== held.key);
            next.splice(to, 0, held.key);
            held.preview = next;
            setPreview([...next]);
          }
        }
      }}
      onPointerUp={event => {
        finish(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={event => {
        finish(true);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onLostPointerCapture={() => {
        if (hold.current?.live) finish(true);
      }}
      onKeyDown={event => {
        if (isComposing(event)) return;
        if (event.key === "Escape" && hold.current) {
          event.preventDefault();
          event.stopPropagation();
          finish(true);
          return;
        }
        if (!event.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        const node = (event.target as Element).closest<HTMLElement>("[data-sort-key]");
        if (!node) return;
        event.preventDefault();
        event.stopPropagation();
        const index = order.indexOf(node.dataset.sortKey!);
        const to = Math.max(0, Math.min(order.length - 1, index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1)));
        const next = order.slice();
        next.splice(index, 1);
        next.splice(to, 0, node.dataset.sortKey!);
        onReorder(next);
        node.focus({ preventScroll: true });
      }}
    >
      {order.map(key => {
        const item = byKey.get(key);
        if (!item) return null;
        if (picked === key) {
          return (
            <motion.div
              key={key}
              data-sort-key={key}
              data-sort-placeholder=""
              role="listitem"
              layout={full}
              transition={spring.moderate}
              className="ff-drag-placeholder mb-4 flex min-w-0 break-inside-avoid flex-col"
              style={{
                width: heldSlot?.width ? `${heldSlot.width}px` : undefined,
                height: heldSlot?.height ? `${heldSlot.height}px` : undefined,
                minHeight: heldSlot?.height ? `${heldSlot.height}px` : undefined,
              }}
            />
          );
        }
        return (
          <motion.div
            key={key}
            data-sort-key={key}
            role="listitem"
            tabIndex={focusable ? 0 : undefined}
            aria-label={item.label}
            aria-grabbed={picked === key || undefined}
            className="relative min-w-0 outline-none focus-visible:ring-1 focus-visible:ring-ring"
            layout={full && !settling}
            transition={spring.moderate}
          >
            {item.node}
          </motion.div>
        );
      })}

      {picked && heldSlot && byKey.has(picked) ? (
        <motion.div
          data-sort-flying=""
          data-settling={settling ? "true" : undefined}
          className={landing ? "pointer-events-none absolute" : "pointer-events-none fixed"}
          style={{
            zIndex: 9999,
            left: landing ? landing.left : heldSlot.left,
            top: landing ? landing.top : heldSlot.top,
            width: heldSlot.width,
            height: heldSlot.height,
            x,
            y,
            rotate,
            scale,
          }}
        >
          <div className="ff-drag-flying h-full w-full" data-settling={settling ? "true" : undefined}>
            {byKey.get(picked)!.node}
          </div>
        </motion.div>
      ) : null}
    </div>
  );
}
