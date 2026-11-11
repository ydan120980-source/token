import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { animate, motion, useAnimationControls, useMotionValue } from "motion/react";
import { marquee, reducedFade, spring } from "@ui/design/motion";
import { useKitMotion } from "./motion-mode";

// A list can mount hundreds of names at once. Native sizes arrive together;
// publish overflow after all reads, rather than forcing layout in each ref.
type MarqueeMeasure = { box: Element; text: Element; boxWidth: number; textWidth: number; publish: (overflow: boolean, width: number) => void };
const marqueeMeasures = new Map<Element, MarqueeMeasure>();
let marqueeObserver: ResizeObserver | undefined;
function observeMarquee(box: Element, text: Element, publish: MarqueeMeasure["publish"]) {
  const measure = { box, text, boxWidth: 0, textWidth: 0, publish };
  marqueeObserver ??= new ResizeObserver(entries => {
    const changed = new Set<MarqueeMeasure>();
    for (const entry of entries) {
      const current = marqueeMeasures.get(entry.target); if (!current) continue;
      if (entry.target === current.box) current.boxWidth = Math.round(entry.contentRect.width);
      else current.textWidth = Math.round(entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width);
      changed.add(current);
    }
    if (changed.size) flushSync(() => { for (const current of changed) if (marqueeMeasures.get(current.box) === current) current.publish(current.textWidth > current.boxWidth + 1, current.textWidth); });
  });
  marqueeMeasures.set(box, measure); marqueeMeasures.set(text, measure);
  marqueeObserver.observe(box); marqueeObserver.observe(text);
  return () => {
    marqueeMeasures.delete(box); marqueeMeasures.delete(text); marqueeObserver?.unobserve(box); marqueeObserver?.unobserve(text);
    if (!marqueeMeasures.size) { marqueeObserver?.disconnect(); marqueeObserver = undefined; }
  };
}

/** Text on one line. When it does not fit, its end fades out; pointed at or focused, it slides at a slow steady
 * pace, looping with a second copy, and eases back when the pointer leaves. Reduced motion keeps it still. */
export function Marquee({ text, children, title }: { text: string; children?: ReactNode; title?: string }) {
  const root = useRef<HTMLSpanElement>(null), copy = useRef<HTMLSpanElement>(null), x = useMotionValue(0), { full } = useKitMotion();
  const measuredWidth = useRef(0);
  const [overflow, setOverflow] = useState(false), [pointed, setPointed] = useState(false), sliding = overflow && pointed && full;
  useLayoutEffect(() => {
    const box = root.current, inner = copy.current; if (!box || !inner) return;
    return observeMarquee(box, inner, (overflow, width) => { measuredWidth.current = width; setOverflow(overflow); });
  }, []);
  useEffect(() => {
    if (!sliding) { const back = animate(x, 0, spring.moderate); return () => back.stop(); }
    const distance = measuredWidth.current + marquee.gap;
    const run = animate(x, [0, -distance], { duration: distance / marquee.pixelsPerSecond, ease: "linear", repeat: Infinity, delay: marquee.pause });
    return () => run.stop();
  }, [sliding, x, text]);
  return <span ref={root} className="ff-marquee" title={title ?? (overflow ? text : undefined)} data-overflow={overflow || undefined} data-sliding={sliding || undefined}
    onPointerEnter={() => setPointed(true)} onPointerLeave={() => setPointed(false)} onFocus={() => setPointed(true)} onBlur={() => setPointed(false)}>
    <motion.span className="ff-marquee-track" style={{ x }}>
      <span ref={copy} data-marquee-text>{children ?? text}</span>
      {sliding ? <span aria-hidden="true" className="pl-8">{text}</span> : null}
    </motion.span>
  </span>;
}

const offsets = { up: { y: -12 }, down: { y: 12 }, left: { x: -12 }, right: { x: 12 } };
/** Content that takes another's place: a quick fade, rising a little from the side it came from when it has one. */
export function Appear({ from, skip = false, className, children }: { from?: keyof typeof offsets; skip?: boolean; className?: string; children: ReactNode }) {
  const { full, fade } = useKitMotion(), initial = skip ? false : full ? { opacity: 0, ...(from ? offsets[from] : {}) } : fade ? { opacity: 0 } : false;
  return <motion.div className={className} initial={initial} animate={{ opacity: 1, x: 0, y: 0 }} transition={full ? spring.moderate : reducedFade}>{children}</motion.div>;
}
/** Animate the visible viewport rather than the very tall scroll contents.
 * Replaying preserves the scroll element and its position. */
export function ViewportAppear({ replay, from, children }: { replay: string; from?: keyof typeof offsets; children: ReactNode }) {
  const { full, fade } = useKitMotion(), controls = useAnimationControls();
  useLayoutEffect(() => {
    const offset = full && from ? offsets[from] : null;
    controls.set({ opacity: full || fade ? 0 : 1, x: offset && "x" in offset ? offset.x : 0, y: offset && "y" in offset ? offset.y : 0 });
    return () => controls.stop();
  }, [replay, from, full, fade, controls]);
  useEffect(() => {
    if (full || fade) void controls.start({ opacity: 1, x: 0, y: 0, transition: full ? spring.moderate : reducedFade });
  }, [replay, from, full, fade, controls]);
  return <motion.div data-reader-reveal className="flex min-h-0 min-w-0 flex-1 overflow-hidden" initial={full || fade ? { opacity: 0 } : false} animate={controls}>{children}</motion.div>;
}
/** A view that replaces another in place, sliding in from one side (the reading view and the list it came from). */
export function SlideIn({ from, skip = false, children }: { from: "left" | "right"; skip?: boolean; children: ReactNode }) {
  const { full, fade } = useKitMotion(), initial = skip ? false : full ? { x: from === "left" ? "-100%" : "100%" } : fade ? { opacity: 0 } : false;
  return <motion.div className="h-full min-w-0" initial={initial} animate={{ x: 0, opacity: 1 }} transition={full ? spring.slow : reducedFade}>{children}</motion.div>;
}
