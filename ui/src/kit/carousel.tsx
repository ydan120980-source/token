import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useMotionValue } from "motion/react";
import { flushSync } from "react-dom";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { project, reducedFade, rubberband, spring, velocityTracker } from "@ui/design/motion";
import { CarouselDots, IconButton } from "./controls";
import { useKitMotion } from "./motion-mode";
import { isComposing } from "./ime";

interface CarouselProps {
  slides: { key: string; label: string; node: ReactNode }[]; index: number;
  onIndexChange: (index: number) => void; "aria-label": string;
}
export function Carousel({ slides, index, onIndexChange, "aria-label": label }: CarouselProps) {
  const root = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null), viewportRef = useRef<HTMLDivElement>(null), x = useMotionValue(0), height = useMotionValue(0), { full, fade } = useKitMotion();
  const [width, setWidth] = useState(0), [restIndex, setRestIndex] = useState(index), [size, setSize] = useState(0), entered = useRef(new Set<string>()), drag = useRef<{ id: number; x: number; y: number; base: number; dx: number; live: boolean } | null>(null), tracker = useRef(velocityTracker()), handoff = useRef(0), suppress = useRef(false), wheel = useRef({ amount: 0, at: 0 }), movement = useRef<ReturnType<typeof animate> | null>(null), suppressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = Math.max(0, Math.min(slides.length - 1, index)), show = (next: number) => onIndexChange(Math.max(0, Math.min(slides.length - 1, next)));
  if (slides[current]) entered.current.add(slides[current].key);
  useLayoutEffect(() => { x.set(0); }, [restIndex, x]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current, slide = track.current?.children[current]; if (!viewport) return;
    const resize = new ResizeObserver(entries => {
      let width: number | undefined, size: number | undefined;
      for (const entry of entries) {
        if (entry.target === viewport && entry.contentRect.width > 0) width = Math.round(entry.contentRect.width);
        if (entry.target === slide && entry.contentRect.height > 0) size = Math.round(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height);
      }
      if (width !== undefined || size !== undefined) flushSync(() => { if (width !== undefined) setWidth(width); if (size !== undefined) setSize(size); });
    });
    resize.observe(viewport); if (slide) resize.observe(slide); return () => resize.disconnect();
  }, [current, slides.length]);
  useLayoutEffect(() => { if (!full || !height.get()) { height.set(size); return; } const control = animate(height, size, spring.slow); return () => control.stop(); }, [size, full, height]);
  useEffect(() => { if (drag.current?.live || !width) return; movement.current?.stop(); if (!full) { x.set(0); setRestIndex(current); if (fade && current !== restIndex && track.current) animate(track.current, { opacity: [0, 1] }, reducedFade); return; } if (current === restIndex && x.get() === 0) return; const target = -(current - restIndex) * width, velocity = handoff.current; handoff.current = 0; const control = animate(x, target, velocity ? { ...spring.momentum, velocity } : spring.slow); movement.current = control; void control.then(() => { setRestIndex(current); }); return () => control.stop(); }, [current, restIndex, width, full, x]);
  useEffect(() => { const element = root.current; if (!element) return; const onWheel = (event: WheelEvent) => { if (slides.length < 2 || Math.abs(event.deltaX) <= Math.abs(event.deltaY) || (event.target as Element).closest("[data-carousel-ignore]")) return; event.preventDefault(); const now = performance.now(); if (now - wheel.current.at < 650) return; wheel.current.amount += event.deltaX; if (Math.abs(wheel.current.amount) >= 40) { show(current + Math.sign(wheel.current.amount)); wheel.current = { amount: 0, at: now }; } }; element.addEventListener("wheel", onWheel, { passive: false }); return () => element.removeEventListener("wheel", onWheel); }, [current, slides.length, onIndexChange]);
  useEffect(() => () => { movement.current?.stop(); clearTimeout(suppressTimer.current); const element = viewportRef.current, pointer = drag.current?.id; if (element && pointer !== undefined && element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer); }, []);
  const release = (event: React.PointerEvent<HTMLDivElement>) => { const held = drag.current; if (!held || held.id !== event.pointerId) return; drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (!held.live) return; suppress.current = true; clearTimeout(suppressTimer.current); suppressTimer.current = setTimeout(() => { suppress.current = false; }, 0); const velocity = event.type === "pointercancel" ? 0 : tracker.current.velocity(), landing = held.dx + project(velocity), next = event.type !== "pointercancel" && Math.abs(landing) > width / 2 ? Math.max(0, Math.min(slides.length - 1, current - Math.sign(landing))) : current; if (next !== current) { handoff.current = velocity; show(next); } else { movement.current?.stop(); if (full) movement.current = animate(x, -(current - restIndex) * width, { ...spring.momentum, velocity }); else x.set(-(current - restIndex) * width); } };
  return <div ref={root} data-carousel data-index={current} role="region" aria-roledescription="轮播" aria-label={label} className="flex min-w-0 flex-col gap-3" onClickCapture={event => { if (suppress.current) { event.preventDefault(); event.stopPropagation(); } }} onKeyDown={event => { if (isComposing(event) || (event.target as Element).closest("[data-carousel-ignore],input,textarea,select,[role=slider]")) return; if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); show(current + (event.key === "ArrowLeft" ? -1 : 1)); } }}>
    {/* Each slide carries p-4 inside a -m-4 viewport: card shadows stay whole instead of being cut at the clip edge. */}
    <motion.div ref={viewportRef} className="-m-4 overflow-hidden" style={{ height }} onPointerDown={event => { if (slides.length < 2 || event.button !== 0 || (event.target as Element).closest("button,a,input,select,textarea,[contenteditable],[data-carousel-ignore]")) return; drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, base: x.get(), dx: 0, live: false }; tracker.current.reset(0, event.timeStamp); }} onPointerMove={event => { const held = drag.current; if (!held || held.id !== event.pointerId) return; const dx = event.clientX - held.x, dy = event.clientY - held.y; if (!held.live) { if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return; movement.current?.stop(); held.base = x.get(); held.live = true; getSelection()?.removeAllRanges(); event.currentTarget.setPointerCapture(event.pointerId); } held.dx = dx; tracker.current.add(dx, event.timeStamp); const edge = current === 0 && dx > 0 || current === slides.length - 1 && dx < 0; x.set(held.base + (edge ? rubberband(dx, width) : dx)); }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={event => { if (drag.current?.id === event.pointerId) { drag.current = null; if (full) movement.current = animate(x, -(current - restIndex) * width, spring.slow); else x.set(-(current - restIndex) * width); } }}>
      <motion.div ref={track} className="flex w-full items-start" style={{ x, marginLeft: -restIndex * 100 + "%", touchAction: "pan-y" }}>{slides.map((slide, i) => <section key={slide.key} data-carousel-slide={slide.key} data-entered={entered.current.has(slide.key) || undefined} aria-hidden={i !== current} inert={i !== current} aria-roledescription="幻灯片" aria-label={slide.label} className="w-full min-w-0 shrink-0 p-4">{slide.node}</section>)}</motion.div>
    </motion.div>
    {slides.length > 1 ? <nav aria-label={label} className="mt-4 flex items-center justify-center gap-3"><IconButton icon={IconChevronLeft} label="上一页" disabled={current === 0} onClick={() => show(current - 1)}/><div className="flex items-center gap-3">{slides.map((slide, i) => <div key={slide.key} className="flex cursor-pointer items-center gap-2 text-caption text-foreground" onClick={event => { if (!(event.target as Element).closest("button")) show(i); }}><CarouselDots count={1} value={i === current ? 0 : -1} onValueChange={() => show(i)} getLabel={() => slide.label}/><span>{slide.label}</span></div>)}</div><IconButton icon={IconChevronRight} label="下一页" disabled={current === slides.length - 1} onClick={() => show(current + 1)}/></nav> : null}
  </div>;
}
