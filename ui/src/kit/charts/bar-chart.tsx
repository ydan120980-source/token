import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { flushSync } from "react-dom";
import { data, spring } from "@ui/design/motion";
import { usePlot, plotKeys, GeometryPath, useSharedChartTooltip, sharedTooltipId } from "./common";
import { barPath, dailyBarPath, clamp, niceStep } from "./geometry";
import { chartTone, type ChartTone } from "./tones";

type Bar = { key: string; value: number | null; state: "value" | "zero" | "unobserved" | "unpriced" | "future"; tone: ChartTone; mark?: "peak" | "today"; label: string };
type Month = { key: string; label: string; ariaLabel?: string; series: { key: string; lower: number | null; upper: number | null; tone: ChartTone }[]; projection?: { lower: number; upper: number } | null };
interface BarProps { variant: "columns" | "months"; height: "strip" | "hours" | "days" | "pair" | "months" | "fill"; bars?: Bar[]; groups?: Month[]; layout?: "grouped" | "stacked"; selected?: string | null; hidden?: string[]; ticks?: { value: number; label: string }[]; readout?: ReactNode; tooltip?: (key: string) => ReactNode; active?: string | null; onActiveChange?: (key: string | null) => void; onSelect?: (key: string) => void; dataKey?: string; "aria-label": string }
function useStripNarrow() { return useSyncExternalStore(listener => { const media = matchMedia("(max-width: 760px)"); media.addEventListener("change", listener); return () => media.removeEventListener("change", listener); }, () => matchMedia("(max-width: 760px)").matches); }

export function BarChart({ variant, height, bars = [], groups = [], layout = "stacked", selected = null, hidden = [], ticks = [], readout, tooltip, active = null, onActiveChange, onSelect, dataKey, "aria-label": label }: BarProps) {
  const tip = useSharedChartTooltip(Boolean(tooltip));
  const plot = usePlot(dataKey, height !== "pair", true), narrow = useStripNarrow(), id = useId(), width = height === "pair" ? 44 : Math.max(240, plot.width), hiddenKeys = new Set(hidden);
  const monthFrame = useRef<HTMLDivElement>(null), [monthHeight, setMonthHeight] = useState(160);
  const measuredHeight = useRef(160);
  const bandX = useMotionValue(0), bandWidth = useMotionValue(0), bandOpacity = useMotionValue(0);
  // A spring settling at zero may sample a tiny negative floating-point width.
  // Keep the follow spring intact and constrain only its SVG length domain.
  const paintedBandWidth = useTransform(bandWidth, value => Math.max(0, value));
  useLayoutEffect(() => {
    const element = monthFrame.current;
    // "months" and "fill" take the height their container leaves them ("fill": the summary card's last chart).
    if ((height !== "months" && height !== "fill") || !element) return;
    // This frame has no padding/border/scrollbar. Its native content height,
    // rounded to CSS pixels, is clientHeight without forcing layout during a
    // mount or Activity reconnect. Publish changed geometry before painting.
    const observer = new ResizeObserver(entries => {
      const next = Math.max(height === "fill" ? 96 : 160, Math.round(entries[0]?.contentRect.height ?? 0));
      if (measuredHeight.current === next) return;
      measuredHeight.current = next; flushSync(() => setMonthHeight(next));
    }); observer.observe(element);
    return () => observer.disconnect();
  }, [height]);
  const h = height === "fill" ? monthHeight : height === "strip" ? narrow ? 96 : 132 : height === "hours" ? 156 : height === "days" ? 64 : height === "pair" ? 36 : monthHeight;
  const keys = variant === "months" ? groups.map(item => item.key) : bars.filter(item => item.state !== "future").map(item => item.key), focusKey = keys.includes(active ?? "") ? active : variant === "months" ? selected ?? keys.at(-1) : keys[0];
  useLayoutEffect(() => {
    if (tooltip) tip.refresh(key => tooltip(key!), key => key !== null && keys.includes(key));
  }, [variant, variant === "months" ? groups : bars, tooltip]);
  const interactive = (key: string, text: string, enabled = true) => enabled ? { role: "button", tabIndex: key === focusKey ? 0 : -1, "aria-pressed": variant === "months" ? key === selected : undefined, "data-chart-key": key, "aria-label": text, "aria-describedby": tip.open && tip.active === key ? sharedTooltipId : undefined, onFocus: (event: React.FocusEvent<SVGElement>) => { onActiveChange?.(key); if (tooltip) tip.show(key, tooltip(key), event.currentTarget, null, variant === "columns" ? "annotation" : "pointer"); }, onPointerEnter: () => onActiveChange?.(key), onClick: () => onSelect?.(key) } : { "aria-label": text };
  let content: ReactNode;
  // Native sizing keeps the same SVG box; avoid mounting an entire fake-width
  // geometry tree that would immediately be replaced before its first paint.
  let nextBand = { x: 0, y: 10, width: 0, height: 0 };
  if (variant === "columns") {
    const peak = Math.max(height === "days" ? .01 : height === "pair" ? 1e-9 : 1, ...bars.flatMap(item => item.value !== null && Number.isFinite(item.value) ? [item.value] : [])), max = peak;
    // The today ring on daily bars is drawn outside the bar; an inset keeps it inside the frame instead of clipped.
    const inset = height === "days" ? 4 : 0, slot = (width - inset * 2) / Math.max(1, bars.length), barWidth = height === "pair" ? 14 : height === "fill" ? Math.max(4, Math.min(28, slot * .6)) : Math.max(1, slot - (height === "hours" ? 5 : 3));
    content = <div style={{ width }}><svg width={width} height={h + inset * 2} viewBox={`${-inset} ${-inset} ${width} ${h + inset * 2}`}>
      {(plot.width > 0 || height === "pair" ? bars : []).map((item, index) => { const known = item.value !== null && Number.isFinite(item.value), ratio = known ? clamp(item.value! / max) : null, barHeight = item.state === "zero" || known && item.value === 0 ? height === "days" ? 8 : height === "pair" ? 6 : height === "hours" ? 0 : 1 : item.state === "unobserved" ? 4 : item.state === "unpriced" ? 20 : item.state === "future" ? height === "hours" ? 0 : 8 : ratio === null ? 0 : height === "pair" ? 6 + ratio * 26 : height === "days" ? 8 + ratio * 56 : Math.max(height === "hours" ? 8 : 1, ratio * h), x = height === "pair" ? index ? 26 : 4 : index * slot + (slot - barWidth) / 2, y = h - barHeight, collapsed = dailyBarPath(x, h, barWidth, 0), target = dailyBarPath(x, y, barWidth, barHeight), dot = height !== "days" && height !== "pair" && item.state === "unobserved", outline = item.state === "future" || item.state === "unpriced" || height === "pair" && item.state === "unobserved", colour = height === "days" ? item.state === "unpriced" ? "stroke-warn" : item.state === "future" ? "stroke-cost-hairline" : item.state === "unobserved" ? "fill-cost-track-strong" : chartTone(item.tone).fill : item.state === "unpriced" ? "stroke-warn" : dot ? "fill-muted-foreground" : outline ? "stroke-muted-foreground" : chartTone(item.mark === "today" ? "accent" : item.tone).fill, alpha = dot ? .45 : height === "days" && !outline && item.state !== "unobserved" ? active === item.key ? 1 : .85 : height === "strip" && !outline && item.mark !== "today" ? active === item.key ? .5 : item.mark === "peak" ? .58 : .22 : 1;
        // Daily bars transition their path like the strip's rects (same command structure collapsed and full).
        const shape = { d: `path("${plot.full && !plot.entered ? collapsed : target}")` } as React.CSSProperties;
        // Apple-style selection (Swift Charts RuleMark + annotation, owner 2026-11-01): the pointed bar deepens and a
        // hairline rule rises from it to the card above the plot; no column box around the bar. An hour still to come
        // stays an outlined column; the invisible column is each slot's frame.
        const column = height === "strip" || height === "hours";
        return <g key={item.key} data-bar-key={item.key} data-state={item.state} data-chart-value={known ? item.value : "unknown"}>
          {column ? <rect data-bar-column aria-hidden="true" x={index * slot + .5} y={0} width={Math.max(1, slot - 1)} height={h} rx={Math.min(8, slot / 2)} strokeWidth={1}
            className="fill-transparent stroke-border" strokeOpacity={.8} opacity={item.state === "future" ? 1 : 0}/> : null}
          {column && item.state !== "future" ? <line data-bar-rule aria-hidden="true" x1={x + barWidth / 2} x2={x + barWidth / 2} y1={0} y2={Math.max(0, (dot ? h - 4 : y) - 4)}
            strokeWidth={1} className="stroke-muted-foreground kit-bar-rule" opacity={active === item.key ? .6 : 0}/> : null}
          {height === "days" && item.mark === "today" ? <g data-day-today>
            <path style={shape} fill="none" strokeWidth={6} className="stroke-muted-foreground kit-column-bar"/>
            <path style={shape} fill="none" strokeWidth={4} className="stroke-surface-3 kit-column-bar"/>
          </g> : null}
          {height === "days" ? <path data-bar-shape style={{ ...shape, fillOpacity: alpha }} fill={outline ? "none" : undefined} strokeWidth={item.state === "unpriced" ? 1.5 : 1} className={colour + " kit-column-bar"}/> : <rect data-bar-shape style={dot ? { x: x + barWidth / 2 - 2, y: h - 4, width: 4, height: 4, rx: 2, fillOpacity: alpha } : { x, y: plot.full && !plot.entered ? h : y, width: barWidth, height: plot.full && !plot.entered ? 0 : barHeight, rx: height === "pair" ? 4 : barWidth / 2, fillOpacity: alpha }} fill={outline ? "none" : undefined} strokeDasharray={item.state === "unobserved" && !dot ? "2 2" : undefined} className={colour + " kit-column-bar" + (column && active === item.key ? " kit-bar-active" : "")}/>}
          {item.mark === "peak" && height !== "hours" ? <circle cx={x + barWidth / 2} cy={Math.max(2, y - 4)} r={2} className="fill-muted-foreground"/> : null}
          <rect {...interactive(item.key, item.label, item.state !== "future")} x={index * slot} y={0} width={slot} height={h} fill="transparent" className={"outline-none focus-visible:stroke-ring " + (item.state === "future" ? "" : "cursor-pointer")}/>
        </g>;
      })}
    </svg>{ticks.length ? <div data-column-ticks aria-hidden="true" className="relative mt-2 h-4 text-micro text-muted-foreground">{ticks.map(tick => { const edge = height !== "hours" && (tick.value === 0 || tick.value === bars.length - 1); return <span key={tick.value} data-column-tick={tick.value} className="absolute top-0 whitespace-nowrap" style={{ left: edge ? tick.value === 0 ? 0 : width : inset + (tick.value + .5) * slot, transform: edge ? tick.value === 0 ? undefined : "translateX(-100%)" : "translateX(-50%)" }}>{tick.label}</span>; })}</div> : null}</div>;
  } else {
    const values = groups.map(group => { const visible = group.series.filter(item => !hiddenKeys.has(item.key) && item.lower !== null); return layout === "stacked" ? Math.max(visible.reduce((sum, item) => sum + item.lower!, 0), hidden.length ? 0 : group.projection?.upper ?? 0, hidden.length ? 0 : visible.reduce((sum, item) => sum + (item.upper ?? item.lower!), 0)) : Math.max(0, ...visible.map(item => item.lower!)); });
    const step = niceStep(Math.max(1e-9, ...values) / 4), yMax = ticks.length ? Math.max(...ticks.map(tick => tick.value)) || step * 4 : step * 4, grid = ticks.length ? ticks : [0, 1, 2, 3, 4].map(index => ({ value: index * step, label: "" }));
    const left = Math.ceil(Math.max(0, ...ticks.map(tick => tick.label.length)) * 6.6) + 12, top = 10, bottom = h - 26, right = 4, inner = width - left - right, slot = inner / Math.max(1, groups.length), visibleCount = Math.max(1, ...groups.map(group => group.series.filter(item => !hiddenKeys.has(item.key)).length)), bw = layout === "stacked" ? clamp(slot * .62, 4, 52) : clamp((slot * .74 - 3 * (visibleCount - 1)) / visibleCount, 8, 30), gw = layout === "stacked" ? bw : bw * visibleCount + 3 * (visibleCount - 1), y = (value: number) => bottom - value / yMax * (bottom - top), every = Math.max(1, Math.ceil((Math.max(1, ...groups.map(group => group.label.length)) * 12 + 10) / slot));
    nextBand = { x: left + Math.max(0, groups.findIndex(group => group.key === active)) * slot, y: top, width: slot, height: bottom - top };
    content = <svg className="absolute left-0 top-0" width={width} height={h} viewBox={`0 0 ${width} ${h}`}><defs><pattern id={id} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)"><rect width={2.5} height={6} className="fill-muted-foreground opacity-20"/></pattern></defs>
      {grid.map((tick, index) => <g key={index} className="text-micro text-muted-foreground"><line x1={left} x2={width - right} y1={y(tick.value)} y2={y(tick.value)} className="stroke-border"/><text x={left - 8} y={y(tick.value)} dy=".32em" textAnchor="end" fill="currentColor">{tick.label}</text></g>)}
      <motion.rect data-month-band x={bandX} y={top} width={paintedBandWidth} height={bottom - top}
          rx={8} opacity={bandOpacity} className="fill-cost-track" />
      {(plot.width > 0 ? groups : []).map((group, index) => { const centre = left + slot * (index + .5), collapsed = barPath(centre - bw / 2, bottom, bw, 0, 0), visible = group.series.filter(item => !hiddenKeys.has(item.key)), topKey = [...visible].reverse().find(item => item.lower !== null && item.lower > 0)?.key, known = visible.filter(item => item.lower !== null), lower = known.length ? known.reduce((sum, item) => sum + item.lower!, 0) : null, upper = known.length ? known.reduce((sum, item) => sum + (item.upper ?? item.lower!), 0) : null; let sum = 0;
        return <g key={group.key} data-month-key={group.key} data-chart-value={lower === null ? "unknown" : lower}>
          {layout === "stacked" && group.projection && !hidden.length ? <GeometryPath full={plot.full} data-month-projection d={barPath(centre - bw / 2, y(group.projection.upper), bw, bottom - y(group.projection.upper), Math.min(6, bw / 2))} fill="none" strokeDasharray="4 4" className="stroke-muted-foreground" opacity={plot.entered || !plot.full ? 1 : 0} transition={plot.transition(index)}/> : null}
          {group.series.map((item, seriesIndex) => { const shown = !hiddenKeys.has(item.key), value = item.lower, vi = visible.findIndex(row => row.key === item.key); let target = collapsed;
            if (shown && value !== null) { if (layout === "stacked") { const y1 = y(sum + value), y0 = y(sum); target = barPath(centre - bw / 2, y1, bw, Math.max(0, y0 - y1 - (sum > 0 && value > 0 ? 1.5 : 0)), item.key === topKey ? Math.min(6, bw / 2) : 0); sum += value; } else target = barPath(centre - gw / 2 + vi * (bw + 3), y(value), bw, bottom - y(value), Math.min(6, bw / 2)); }
            return <GeometryPath full={plot.full} key={item.key} data-month-series={item.key} data-chart-value={value === null ? "unknown" : value} d={plot.full && !plot.entered ? collapsed : target} className={chartTone(item.tone).fill} opacity={shown && value !== null ? 1 : 0} transition={plot.transition(index + seriesIndex)}/>;
          })}
          {layout === "stacked" && !hidden.length && lower !== null && upper !== null && upper > lower ? <GeometryPath full={plot.full} data-month-range d={barPath(centre - bw / 2, y(upper), bw, Math.max(0, y(lower) - y(upper) - 1.5), Math.min(6, bw / 2))} fill={`url(#${id})`} opacity={plot.entered || !plot.full ? 1 : 0} transition={plot.transition(index)}/> : null}
          {index % every === 0 || index === groups.length - 1 ? <text x={centre} y={h - 8} textAnchor="middle" className={(group.key === selected ? "fill-foreground font-semibold" : "fill-muted-foreground") + " text-micro"}>{group.label}</text> : null}
          <rect {...interactive(group.key, group.ariaLabel ?? group.label)} x={left + index * slot} y={top} width={slot} height={bottom - top} fill="transparent" className="cursor-pointer outline-none focus-visible:stroke-ring"/>
        </g>;
      })}
    </svg>;
  }
  const visibleBand = variant === "months" && groups.some(group => group.key === active);
  useLayoutEffect(() => {
    if (!plot.full) { bandX.set(nextBand.x); bandWidth.set(nextBand.width); bandOpacity.set(visibleBand ? 1 : 0); return; }
    const x = animate(bandX, nextBand.x, data.follow), w = animate(bandWidth, nextBand.width, data.follow);
    const opacity = animate(bandOpacity, visibleBand ? 1 : 0, spring.fast);
    return () => { x.stop(); w.stop(); opacity.stop(); };
  }, [nextBand.x, nextBand.width, visibleBand, plot.full, bandX, bandWidth, bandOpacity]);
  return <div ref={plot.ref} role="group" aria-label={label} tabIndex={0} data-chart="bar" data-variant={variant} data-height={height} data-layout={layout} data-ready={plot.ready} data-enter-count={plot.entries} data-active={active ?? ""} className={"flex min-w-0 flex-col gap-3 outline-none focus-visible:ring-1 focus-visible:ring-ring" + (variant === "months" ? " h-full min-h-0" : height === "fill" ? " min-h-0 flex-1" : "")} onPointerMove={event => { const element = (event.target as Element).closest("[data-chart-key]"); const key = element?.getAttribute("data-chart-key"); if (tooltip && element && key) tip.show(key, tooltip(key), element, { x: event.clientX, y: event.clientY }, variant === "columns" ? "annotation" : "pointer"); }} onPointerLeave={() => { tip.hide(); onActiveChange?.(null); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { tip.hide(); onActiveChange?.(null); } }} onKeyDown={event => { if (event.key === "Escape") tip.hide(); plotKeys(event, keys, variant === "months" ? focusKey : active, onActiveChange, onSelect); }}>{readout}<div ref={monthFrame} className={variant === "months" ? "relative min-h-40 min-w-0 flex-1" : height === "fill" ? "relative min-h-24 min-w-0 flex-1 overflow-hidden" : "min-w-0 overflow-hidden"}>{height === "fill" ? <div className="absolute left-0 top-0">{content}</div> : content}</div>{tip.layer}</div>;
}
