import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useSharedChartTooltip } from "./charts/common";
import { flushSync } from "react-dom";

// The whole of a long document at once: one bar per part, as long as the part is, with flags and search hits
// marked; pointing shows which part, pressing or dragging goes there. It works from weights rather than the
// layout because a long document's later parts are not drawn yet. The outline offers the same by keyboard.
// A part may say how much it took (level, 0 to 1; null when unknown): the bar is that wide, in the same quiet ink, since an
// amount is never good or bad. An unknown part stays the thinnest, so it never reads as a measured small one.
export interface RailMark { key: string; weight: number; flag?: boolean; hit?: boolean; tip?: ReactNode; level?: number | null }
const GAP = 2, MIN = 3, THIN = 2, WIDE = 16, PLAIN = 4;
const barWidth = (mark: RailMark) => mark.level === undefined ? PLAIN : mark.level === null ? THIN : THIN + 2 + mark.level * (WIDE - THIN - 2);

export function PositionRail({ marks, active, onPick, "aria-label": label }: { marks: RailMark[]; active: string | null; onPick: (key: string) => void; "aria-label": string }) {
  const box = useRef<HTMLDivElement>(null), [height, setHeight] = useState(0), last = useRef<string | null>(null), tip = useSharedChartTooltip();
  useLayoutEffect(() => {
    const element = box.current; if (!element) return;
    const observer = new ResizeObserver(entries => { const height = Math.round(entries[0]?.contentRect.height ?? 0); if (height > 0) flushSync(() => setHeight(height)); }); observer.observe(element); return () => observer.disconnect();
  }, []);
  const bars = useMemo(() => {
    const total = marks.reduce((sum, mark) => sum + Math.max(1, mark.weight), 0), room = Math.max(0, height - GAP * marks.length - MIN * marks.length);
    let y = 0;
    return marks.map(mark => { const h = MIN + (total ? Math.max(1, mark.weight) / total : 0) * room, bar = { mark, y, h }; y += h + GAP; return bar; });
  }, [marks, height]);
  const at = (event: PointerEvent<Element>) => {
    const top = box.current?.getBoundingClientRect().top ?? 0, y = event.clientY - top;
    return bars.find(bar => y < bar.y + bar.h + GAP) ?? bars[bars.length - 1];
  };
  const go = (event: PointerEvent<Element>) => { const bar = at(event); if (bar && bar.mark.key !== last.current) { last.current = bar.mark.key; onPick(bar.mark.key); } };
  const point = (event: PointerEvent<Element>) => {
    const bar = at(event); if (!bar) return;
    const element = box.current?.querySelector('[data-rail-mark="' + CSS.escape(bar.mark.key) + '"]');
    if (element && bar.mark.tip) { if (tip.active !== "rail:" + bar.mark.key) tip.show("rail:" + bar.mark.key, bar.mark.tip, element as HTMLElement, null, "above"); }
  };
  const base = useMemo(() => bars.map(bar => <rect key={bar.mark.key} data-rail-mark={bar.mark.key} data-rail-level={bar.mark.level === null ? "unknown" : bar.mark.level} x={10 - barWidth(bar.mark) / 2} width={barWidth(bar.mark)} y={bar.y} height={bar.h} rx={Math.min(2, barWidth(bar.mark) / 2)} className="fill-muted-foreground opacity-25" />), [bars]);
  const flags = useMemo(() => bars.filter(bar => bar.mark.flag).map(bar => <rect key={bar.mark.key} data-rail-flag x="4" width="12" y={bar.y} height="3" rx="1.5" className="fill-warning" />), [bars]);
  const hits = useMemo(() => bars.filter(bar => bar.mark.hit).map(bar => <rect key={bar.mark.key} data-rail-hit x="4" width="12" y={bar.y + Math.max(0, bar.h / 2 - 1.5)} height="3" rx="1.5" className="fill-primary" />), [bars]);
  const current = bars.find(bar => bar.mark.key === active);
  return <div ref={box} aria-label={label} role="img" className="relative h-full w-5 shrink-0 cursor-pointer touch-none select-none" data-rail
    onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); last.current = null; go(event); }}
    onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) go(event); point(event); }}
    onPointerLeave={() => tip.hide()}>
    {height ? <svg className="absolute inset-0" width="20" height={height} aria-hidden="true">
      {base}
      {current ? <rect data-rail-current x={10 - barWidth(current.mark) / 2} width={barWidth(current.mark)} y={current.y} height={current.h} rx={Math.min(2, barWidth(current.mark) / 2)} className="fill-muted-foreground" /> : null}
      {flags}
      {hits}
    </svg> : null}
    {tip.layer}
  </div>;
}
