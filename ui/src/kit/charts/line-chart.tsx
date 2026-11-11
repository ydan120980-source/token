import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import { data, instant } from "@ui/design/motion";
import { usePlot, CursorReadout, GeometryPath, useSharedChartTooltip, sharedTooltipId } from "./common";
import { clamp, costStackGeometry, curve, niceStep, runs } from "./geometry";
import { chartTone, type ChartTone } from "./tones";
import { isComposing } from "../ime";

interface X { key: string; label: string; partial?: boolean; missing?: boolean }
interface Series { key: string; label: string; tone: ChartTone; values: (number | null)[]; style?: "line" | "area" | "dashed"; axis?: "left" | "right" }
interface Tick { value: number; label: string }
type Range = [number, number];
interface LineProps { palette?: "default" | "cost"; variant: "trend" | "stack" | "detail" | "spark"; x: X[]; series: Series[]; stacked?: boolean; ticks?: { left: Tick[]; right?: Tick[]; x?: { index: number; label: string }[] }; active?: number | null; onActiveChange?: (index: number | null) => void; pinned?: number | null; onPinnedChange?: (index: number | null) => void; range?: Range | null; onRangeChange?: (range: Range | null) => void; onApplyRange?: (range: Range) => void; onSelect?: (index: number) => void; tooltip?: (index: number) => ReactNode; endLabel?: string; readout?: ReactNode; size?: "row" | "hero"; dataKey?: string; hidden?: readonly string[]; "aria-label": string }

export function LineChart({ variant, x, series, palette = "default", stacked = false, ticks, active = null, onActiveChange, pinned = null, onPinnedChange, range = null, onRangeChange, onApplyRange, onSelect, tooltip, endLabel, readout, size = "row", dataKey, hidden, "aria-label": label }: LineProps) {
  const trendTip = variant === "trend";
  const windowTip = useSharedChartTooltip((variant === "spark" || trendTip) && Boolean(tooltip));
  useLayoutEffect(() => {
    if (tooltip && variant === "spark") windowTip.refresh(key => tooltip(Number(key)), key =>
      key !== null && Number.isInteger(Number(key)) && Number(key) >= 0 && Number(key) < x.length);
    if (trendTip) {
      if (!tooltip) windowTip.hide();
      else windowTip.refresh(key => tooltip(x.findIndex(point => point.key === key)), key => x.some(point => point.key === key));
    }
  }, [variant, x, series, tooltip]);
  useLayoutEffect(() => { if (trendTip) windowTip.hide(); }, [dataKey]);
  const plot = usePlot(dataKey, variant !== "spark", true), reveal = useMotionValue(plot.full && !plot.entered ? 0 : 1), swept = useRef<string | undefined | null>(null), id = useId(), svg = useRef<SVGSVGElement>(null), anchor = useRef<number | null>(null), suppressClick = useRef(false), drag = useRef<{ pointer: number; start: number; from: number; to: number; moved: boolean; before: Range | null } | null>(null);
  const spark = variant === "spark", width = spark ? size === "hero" ? 96 : 108 : Math.max(240, plot.width), height = spark ? size === "hero" ? 36 : 32 : variant === "detail" ? 176 : variant === "stack" ? 272 : 300;
  const left = spark ? 3 : variant === "stack" ? width < 560 ? 46 : 52 : Math.max(46, Math.ceil(Math.max(0, ...(ticks?.left ?? []).map(tick => tick.label.length)) * 6.6) + 12), right = spark ? 3 : variant === "trend" && series.some(item => item.axis === "right") ? 56 : variant === "stack" ? width < 560 ? 14 : 20 : 14, top = spark ? 4 : variant === "detail" ? 26 : variant === "stack" ? 34 : 8, bottom = spark ? height - 4 : variant === "detail" ? 146 : variant === "stack" ? 240 : height - 34;
  // A new dataKey hides the plot at once and sweeps it in from the left edge (Apple's chart reveal); the geometry
  // under the clip jumps to the new shape instead of morphing, so nothing slides sideways or starts mid-plot.
  // A revisited page (plot already settled) shows the line in place.
  const inner = useMotionValue(width - left - right); inner.set(width - left - right);
  const clipWidth = useTransform(() => reveal.get() * inner.get());
  useLayoutEffect(() => {
    if (!plot.full) { reveal.jump(1); return; }
    if (!plot.entered) { reveal.jump(0); return; }
    if (swept.current === dataKey) return;
    swept.current = dataKey;
    if (!plot.initial) { reveal.jump(1); return; }
    const control = animate(reveal, 1, data.sweep); return () => control.stop();
  }, [plot.full, plot.entered, dataKey]);
  const geometryTier = plot.full && !plot.entered ? instant : data.reshape;
  const sx = (index: number) => left + (x.length < 2 ? (width - left - right) / 2 : index * (width - left - right) / (x.length - 1));
  // A hidden series keeps its known points at zero: every path keeps the same structure whichever series are shown,
  // so turning one off or on morphs the whole stack (owner 2026-11-02) instead of cutting to a new drawing.
  const isHidden = (key: string) => Boolean(hidden?.includes(key));
  const businessValues = series.map(item => x.map((_, index) => { const value = item.values[index] ?? null; return value !== null && isHidden(item.key) ? 0 : value; }));
  const costStack = palette === "cost" && variant === "stack";
  const values = businessValues, bases: number[][] = [], tops: (number | null)[][] = [];
  let below = x.map(() => 0);
  const costGeometry = costStack ? costStackGeometry(values, x.map(point => Boolean(point.missing)), stacked) : null;
  if (costGeometry) { bases.push(...costGeometry.bases); tops.push(...costGeometry.tops); }
  else values.forEach(list => { bases.push([...below]); tops.push(list.map((value, index) => value === null ? null : value + (stacked ? below[index] : 0))); if (stacked) below = below.map((value, index) => value + (list[index] ?? 0)); });
  const maximum = (axis: "left" | "right") => {
    const peak = Math.max(0, ...tops.flatMap((list, index) => (series[index].axis ?? "left") === axis ?
      list.filter((value): value is number => value !== null) : []));
    const supplied = axis === "right" ? ticks?.right : ticks?.left;
    // Supplied ticks need not reach the ceiling (the detail sheet labels 0 and the midpoint only).
    const highest = supplied?.length ? Math.max(...supplied.map(tick => tick.value)) : 0;
    if (highest && peak <= highest) return highest;
    return niceStep(peak / 4) * 4;
  };
  const maxima = { left: maximum("left"), right: maximum("right") }, sy = (value: number, axis: "left" | "right" = "left") => bottom - value / maxima[axis] * (bottom - top);
  const showTrendTip = (index: number, node: Element, point?: { x: number; y: number }) => {
    if (!trendTip || !tooltip || !svg.current || !x[index]) return;
    const box = svg.current.getBoundingClientRect(), value = tops[0]?.[index];
    // Keyboard placement follows the old trendCanvas point, with its original missing-point fallback.
    const at = point ? { x: point.x - box.left, y: point.y - box.top } : { x: sx(index) * box.width / width,
      y: (value == null ? top + 40 : sy(value, series[0]?.axis ?? "left")) * box.height / height };
    windowTip.show(x[index].key, tooltip(index), node, at, "plot");
  };
  const picked = active ?? pinned;
  const indexAt = (clientX: number) => { const bounds = svg.current?.getBoundingClientRect(); return Math.round(clamp(bounds ? ((clientX - bounds.left) / bounds.width * width - left) / (width - left - right) : 0) * Math.max(0, x.length - 1)); }, change = (value: number | null) => onActiveChange?.(value), clear = () => { change(null); windowTip.hide(); };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isComposing(event) || !x.length) return;
    const current = active ?? pinned ?? x.length - 1, directions: Record<string, number> = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: x.length - 1 };
    if (event.key in directions) { event.preventDefault(); event.stopPropagation(); const index = Math.max(0, Math.min(x.length - 1, directions[event.key])); if (event.shiftKey) { anchor.current ??= range?.[0] ?? current; onRangeChange?.([Math.min(anchor.current, index), Math.max(anchor.current, index)]); } else { anchor.current = null; onRangeChange?.(null); } onPinnedChange?.(null); change(index); plot.ref.current?.querySelector<SVGElement>('[data-line-point="' + index + '"]')?.focus(); }
    else if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); if (range) onApplyRange?.(range); else onSelect?.(current); }
    else if (event.key === " " && variant === "stack") { event.preventDefault(); event.stopPropagation(); onPinnedChange?.(pinned === current ? null : current); change(current); }
    else if (event.key === "Escape" && (active !== null || pinned !== null || range !== null)) { event.preventDefault(); event.stopPropagation(); anchor.current = null; clear(); onPinnedChange?.(null); onRangeChange?.(null); }
  };
  const axisText = palette === "cost" ? variant === "detail" ? "text-cost-caption" : "text-cost-muted" : "text-muted-foreground";
  const axisFill = palette === "cost" ? variant === "detail" ? "fill-cost-caption" : "fill-cost-muted" : "fill-muted-foreground";
  const axisStroke = palette === "cost" ? variant === "detail" ? "stroke-cost-grid" : "stroke-cost-hairline" : "stroke-border";
  const axis = (items: Tick[] | undefined, side: "left" | "right") => {
    // Grid lines travel with the rescaled axis; a line the new scale no longer has fades where it was.
    return <AnimatePresence initial={false}>{items?.map(tick =>
    <motion.g key={tick.value} className={"text-micro " + axisText} initial={plot.full ? { opacity: 0, y: sy(tick.value, side) } : false}
      animate={{ opacity: 1, y: sy(tick.value, side) }} exit={plot.full ? { opacity: 0 } : undefined} transition={plot.full ? geometryTier : instant}>
      {side === "left" ? <line x1={left} x2={width - right} y1={0} y2={0}
        className={axisStroke} /> : null}
      <text x={side === "left" ? left - 8 : width - right + 8} y={0}
        dy=".32em" textAnchor={side === "left" ? "end" : "start"}
        fill="currentColor">{tick.label}</text>
    </motion.g>)}</AnimatePresence>;
  };
  const dates = ticks?.x ?? (spark ? [] : Array.from({ length: Math.min(x.length, variant === "stack" ? 6 : variant === "trend" ? 8 : 4) }, (_, index) => index).map((_, index, array) => { const point = Math.round(index * (x.length - 1) / Math.max(1, array.length - 1)); return { index: point, label: x[point]?.label ?? "" }; }));
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => { const state = drag.current; if (!state || state.pointer !== event.pointerId) return; drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (event.type === "pointerup" && state.moved) { suppressClick.current = true; onApplyRange?.([Math.min(state.from, state.to), Math.max(state.from, state.to)]); } else if (event.type !== "pointerup") { onRangeChange?.(state.before); suppressClick.current = state.moved; } };
  return <div ref={plot.ref} role="group" aria-label={label} tabIndex={picked === null ? 0 : -1} data-chart="line" data-variant={variant} data-ready={plot.ready} data-enter-count={plot.entries} data-active={picked ?? ""} data-pinned={pinned ?? ""} data-range={range?.join(":") ?? ""} data-carousel-ignore={onRangeChange ? "" : undefined} className="flex min-w-0 flex-col gap-3 outline-none focus-visible:ring-1 focus-visible:ring-ring" onKeyDown={keyDown} onPointerLeave={() => { if (!drag.current) clear(); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !drag.current) clear(); }}
    onPointerDown={event => { if (event.button !== 0 || !onRangeChange || !svg.current?.contains(event.target as Node) || !x.length) return; const index = indexAt(event.clientX); onPinnedChange?.(null); suppressClick.current = false; drag.current = { pointer: event.pointerId, start: event.clientX, from: index, to: index, moved: false, before: range }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (!svg.current?.contains(event.target as Node) && !drag.current || !x.length || pinned !== null && !drag.current) return; const index = indexAt(event.clientX); change(index); if (spark && tooltip && svg.current) windowTip.show(String(index), tooltip(index), svg.current, { x: event.clientX, y: event.clientY }, "above"); if (trendTip) { const node = svg.current?.querySelector('[data-line-point="' + index + '"]'); if (node) showTrendTip(index, node, { x: event.clientX, y: event.clientY }); } if (drag.current && Math.abs(event.clientX - drag.current.start) > 5) { drag.current.moved = true; drag.current.to = index; onRangeChange?.([Math.min(drag.current.from, index), Math.max(drag.current.from, index)]); } }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={event => { if (drag.current?.pointer === event.pointerId) { onRangeChange?.(drag.current.before); drag.current = null; } }}>
    {readout}<div className="relative min-w-0 overflow-hidden" style={spark ? { width, height } : undefined}>
      <svg ref={svg} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Keep the SVG's layout box, and mount its real geometry once the width is known. */}
        {spark || plot.width > 0 ? <>
        <defs><clipPath id={id + "-clip"}><motion.rect x={left} y={0} height={height} width={clipWidth} /></clipPath><linearGradient id={id + "-fade"} x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity={1} className="text-foreground"/><stop offset="1" stopColor="currentColor" stopOpacity={0} className="text-foreground"/></linearGradient><mask id={id + "-mask"} maskUnits="userSpaceOnUse" x={0} y={top} width={width} height={bottom - top} style={{ maskType: "alpha" }}><rect x={0} y={top} width={width} height={bottom - top} fill={`url(#${id}-fade)`}/></mask>
        </defs>
        {!spark ? <>{axis(ticks?.left, "left")}{axis(ticks?.right, "right")}{dates.map(tick => <text key={tick.index} x={sx(tick.index)} y={variant === "stack" ? 262 : height - 10} textAnchor={tick.index === 0 ? "start" : tick.index === x.length - 1 ? "end" : "middle"} className={"text-micro " + axisFill}>{tick.label}</text>)}{x.map((point, index) => point.partial ? <rect key={point.key} data-partial={point.key} x={sx(index) - 1} y={bottom + 3} width={2} height={5} rx={1} className={costStack ? "fill-cost-warn" : "fill-muted-foreground"} opacity={costStack ? .85 : undefined}/> : null)}</> : null}
        {range ? <rect data-line-brush x={sx(range[0])} y={top} width={Math.max(1, sx(range[1]) - sx(range[0]))} height={bottom - top} className="fill-selected"/> : null}
        <motion.g clipPath={`url(#${id}-clip)`} initial={false} animate={{ opacity: plot.mode === "reduced" && !plot.entered ? 0 : 1 }} transition={geometryTier}>
          {series.map((item, si) => { const list = tops[si], segments = costGeometry?.parts[si] ?? runs(list, (value, index) => value !== null && !x[index].missing), y = (value: number) => sy(value, item.axis ?? "left"), bridges = segments.slice(1).flatMap((run, index) => { const a = segments[index].at(-1)!, b = run[0]; return costStack || x.slice(a + 1, b).every(point => point.missing) ? [[a, b]] : []; }); return <motion.g key={item.key} data-line-series={isHidden(item.key) ? undefined : item.key} data-line-hidden={isHidden(item.key) ? item.key : undefined} initial={false} animate={{ opacity: isHidden(item.key) ? 0 : 1 }} transition={plot.full ? geometryTier : instant}>
            {segments.map(run => { const points = run.map(index => ({ x: sx(index), y: y(list[index]!) })), d = curve(points), base = run.slice().reverse().map(index => ({ x: sx(index), y: y(costStack || stacked ? bases[si][index] : 0) })), area = d + " " + curve(base).replace(/^M/, "L") + " Z"; return <g key={run[0]} data-line-run={run.join(":")}>
                            {item.style === "area" ? <g mask={stacked ? undefined : `url(#${id}-mask)`}><GeometryPath full={plot.full} fill="currentColor"
                  className={chartTone(item.tone).fill} opacity={stacked ? .26 : .32} d={area} transition={geometryTier} /></g> : null}
              <GeometryPath full={plot.full} fill="none" strokeWidth={item.style === "dashed" ? 2 : variant === "trend" ? 2.4 : 2} strokeDasharray={item.style === "dashed" ? "5 5" : undefined} strokeLinecap="round" strokeLinejoin="round" className={chartTone(item.tone).stroke} d={d} transition={geometryTier}/>{run.length === 1 ? <circle cx={points[0].x} cy={points[0].y} r={spark ? 2.5 : 4} className={chartTone(item.tone).fill}/> : null}
            </g>; })}
            {bridges.map(([a, b]) => <g key={a + ":" + b}>
              {costStack && stacked && item.style === "area" ? <g>
                <GeometryPath data-missing-area full={plot.full}
                  d={`M${sx(a)} ${y(list[a]!)} L${sx(b)} ${y(list[b]!)} L${sx(b)} ${y(bases[si][b])} L${sx(a)} ${y(bases[si][a])} Z`}
                  fill="currentColor" className={chartTone(item.tone).fill} opacity={.26} transition={geometryTier}/>
              </g> : null}
              <motion.path data-missing-bridge d={`M${sx(a)} ${y(list[a]!)} L${sx(b)} ${y(list[b]!)}`} fill="none" strokeWidth={1.5} strokeDasharray="1 5" strokeLinecap="round" className={chartTone(item.tone).stroke} initial={false} animate={{ opacity: .6 }} transition={geometryTier}/>
            </g>)}
            {variant === "detail" && !endLabel && picked === null && list.some(value => value !== null) ? (() => { const index = list.findLastIndex(value => value !== null); return <text x={sx(index)} y={Math.max(15, Math.min(...list.filter((value): value is number => value !== null).map(y)) - 10)} textAnchor="end" className="fill-muted-foreground text-micro">{item.label}</text>; })() : null}
            {spark && list.some(value => value !== null) ? (() => { const index = list.findLastIndex(value => value !== null); return <circle cx={sx(index)} cy={y(list[index]!)} r={2.5} className={chartTone(item.tone).fill}/>; })() : null}
          </motion.g>; })}
        </motion.g>
        {variant === "detail" && endLabel && series.length ? (() => {
          const points = values[0].flatMap((value, index) => value === null || x[index].missing ? [] : [{ index, value }]);
          const last = points.at(-1); if (!last) return null;
          const y = (value: number) => sy(value, series[0].axis ?? "left");
          const labelY = Math.max(15, Math.min(...points.map(point => y(point.value))) - 10);
          return <g data-detail-end className={chartTone(series[0].tone).fill}>
            {points.map(point => <circle key={point.index} cx={sx(point.index)} cy={y(point.value)} r={point === last ? 3.5 : 1.3}/>)}
            {picked === null ? <text data-detail-end-label x={sx(last.index)} y={labelY} textAnchor={sx(last.index) < width / 3 ? "start" : "end"} className="text-micro">{endLabel}</text> : null}
          </g>;
        })() : null}
        {picked !== null && x[picked] ? <g data-line-cursor><line x1={sx(picked)} x2={sx(picked)} y1={top} y2={bottom} strokeDasharray={costStack ? "3 3" : "3 4"} strokeOpacity={costStack ? .3 : undefined} className={costStack ? "stroke-cost-text" : "stroke-muted-foreground"}/>{series.map((item, index) => tops[index][picked] !== null && !x[picked].missing && !isHidden(item.key) ? <circle data-cursor-series={index} key={item.key} cx={sx(picked)} cy={sy(tops[index][picked]!, item.axis ?? "left")} r={variant === "trend" ? 5 : 4.5} className={chartTone(item.tone).fill}/> : null)}</g> : null}
        {x.map((point, index) => <rect key={point.key} id={id + "-" + index} data-line-point={index} role="button" tabIndex={picked === index ? 0 : -1} aria-label={point.label} aria-describedby={tooltip && picked === index ? spark || trendTip ? windowTip.open ? sharedTooltipId : undefined : id + "-tooltip" : undefined} x={index === 0 ? left : (sx(index - 1) + sx(index)) / 2} y={top} width={(index === x.length - 1 ? width - right : (sx(index) + sx(index + 1)) / 2) - (index === 0 ? left : (sx(index - 1) + sx(index)) / 2)} height={bottom - top} fill="transparent" className="cursor-pointer outline-none focus-visible:stroke-ring" onFocus={event => { change(index); if (spark && tooltip) windowTip.show(String(index), tooltip(index), event.currentTarget, null, "above"); if (trendTip) showTrendTip(index, event.currentTarget); }} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect?.(index); }}/>) }
        </> : null}
      </svg>
      {!spark && !trendTip && picked !== null && tooltip ? <CursorReadout id={id + "-tooltip"} x={sx(picked)} width={width} top={top} detail={variant === "detail"}>{tooltip(picked)}</CursorReadout> : null}
    </div>{windowTip.layer}
  </div>;
}
