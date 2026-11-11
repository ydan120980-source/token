import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { data, spring, staggerDelay } from "@ui/design/motion";
import { useKitMotion } from "../motion-mode";
import { isComposing } from "../ime";
import { chartTone, type ChartTone } from "./tones";
import { useSharedChartTooltip, sharedTooltipId } from "./common";

type Segment = { key: string; value: number; tone: ChartTone; pattern?: "solid" | "hatched" | "light"; label: string };
type Marker = { key: string; at: number; kind: "time" | "fee" | "today"; label: string };
interface StackProps {
  variant?: "continuous" | "cost-hero"; segments: Segment[]; height: 4 | 6 | 8 | 12 | 18; width?: "full" | "inline"; steps?: 16 | 30; markers?: Marker[];
  tooltip?: (key: string | null) => ReactNode; unknown?: boolean; active?: string | null; onActiveChange?: (key: string | null) => void; onSelect?: (key: string) => void; "aria-label": string;
}
export function StackBar({ segments, height, variant = "continuous", width = "full", steps, markers = [], unknown = false,
  active, onActiveChange, onSelect, tooltip, "aria-label": label }: StackProps) {
  const tip = useSharedChartTooltip(Boolean(tooltip));
  const root = useRef<SVGSVGElement>(null), id = useId(), { full, mode } = useKitMotion();
  const [actualWidth, setWidth] = useState(width === "inline" ? 44 : 1), [entered, setEntered] = useState(false);
  const [ready, setReady] = useState(false), previous = useRef(false);
  useEffect(() => {
    const svg = root.current; if (!svg) return;
    const resize = new ResizeObserver(() => { const next = width === "inline" ? 44 : svg.clientWidth; if (next > 0) setWidth(next); });
    resize.observe(svg);
    const intersection = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= .25)) { setEntered(true); intersection.disconnect(); } }, { threshold: .25 });
    intersection.observe(svg);
    return () => { resize.disconnect(); intersection.disconnect(); };
  }, [width]);
  useEffect(() => { if (entered && !full) previous.current = true; }, [entered, full]);
  const initial = !previous.current, tier = initial ? data.enter : data.update;
  const visible = segments.filter(segment => Number.isFinite(segment.value) && segment.value > 0);
  useLayoutEffect(() => {
    if (tooltip) tip.refresh(tooltip, key => key === null || segments.some(segment =>
      segment.key === key && Number.isFinite(segment.value) && segment.value > 0));
  }, [segments, tooltip]);
  const selected = visible.some(segment => segment.key === active) ? active : visible[0]?.key;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const gap = steps === 16 ? 2 : 3, stepWidth = steps ? Math.max(0, (actualWidth - gap * (steps - 1)) / steps) : actualWidth;
  const track = steps ? Array.from({ length: steps }, (_, index) => <rect key={index} x={index * (stepWidth + gap)} y={0} width={stepWidth} height={height} rx={2} />)
    : <rect width={actualWidth} height={height} rx={height / 2} />;
  const separated = variant === "cost-hero", usable = Math.max(0, actualWidth - (visible.length - 1) * 3);
  let consumed = 0;
  const keydown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (isComposing(event)) return;
    if (event.key === "Escape") { tip.hide(); onActiveChange?.(null); return; }
    if ((event.key === "Enter" || event.key === " ") && onSelect) { const key = (document.activeElement as HTMLElement | null)?.dataset?.stackKey; if (key) { event.preventDefault(); onSelect(key); } return; }
    const items = [...event.currentTarget.querySelectorAll<SVGElement>("[data-stack-key]")], index = items.indexOf(document.activeElement as unknown as SVGElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : ["ArrowRight", "ArrowDown"].includes(event.key) ? (index + 1) % items.length : ["ArrowLeft", "ArrowUp"].includes(event.key) ? (index - 1 + items.length) % items.length : null;
    if (next !== null && items.length) { event.preventDefault(); items[next].focus(); onActiveChange?.(items[next].dataset.stackKey!); }
  };
  return <><svg ref={root} width={width === "inline" ? 44 : "100%"} height={height} viewBox={`0 0 ${actualWidth} ${height}`} preserveAspectRatio="none"
    role="group" aria-label={label} aria-valuetext={unknown ? "未知" : undefined} tabIndex={unknown || !visible.length ? 0 : undefined}
    data-stack-bar data-stack-variant={variant} data-unknown={unknown || undefined} data-active={active ?? undefined} data-ready={!full || ready || unknown || undefined}
    className="overflow-visible outline-none focus-visible:ring-1 focus-visible:ring-ring" onKeyDown={keydown}
    onPointerMove={event => { if (tooltip) { const key = (event.target as Element).closest("[data-stack-key]")?.getAttribute("data-stack-key") ?? null; tip.show(key, tooltip(key), event.currentTarget, { x: event.clientX, y: event.clientY }, "above"); } }} onPointerLeave={() => { tip.hide(); onActiveChange?.(null); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { tip.hide(); onActiveChange?.(null); } }}>
    <defs><clipPath id={id + "-track"}>{track}</clipPath>
      {visible.map((segment, index) => <pattern key={segment.key} id={id + "-hatch-" + index} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
        <rect width={2.5} height={6} className={chartTone(segment.tone).fill} />
      </pattern>)}
    </defs>
    {!separated ? <g className="fill-muted">{track}</g> : null}
    {/* A 12px bar is a thin target: each segment also answers in a band around it, gaps and hairline segments included. */}
    {separated && !unknown ? (() => { let at = 0; return visible.map((segment, index) => { const length = clamp(segment.value) * usable, left = clamp(at) * usable + index * 3; at += segment.value;
      return <rect key={segment.key} data-stack-hit={segment.key} x={left - 1.5} y={-10} width={Math.max(8, length + 3)} height={height + 20} fill="transparent" className={onSelect ? "cursor-pointer" : undefined}
        onPointerEnter={() => onActiveChange?.(segment.key)} onClick={onSelect ? () => onSelect(segment.key) : undefined} />; }); })() : null}
    {!unknown ? <g clipPath={separated ? undefined : `url(#${id}-track)`}>{visible.map((segment, index) => {
      const left = clamp(consumed) * (separated ? usable : actualWidth) + (separated ? index * 3 : 0), length = clamp(Math.min(segment.value, 1 - consumed)) * (separated ? usable : actualWidth);
      consumed += segment.value;
      // A CSS fill class would override the SVG presentation attribute and hide the hatch.
      const geometry = { x: left, y: 0, width: length, height, rx: separated ? height / 2 : 0 }, colour = segment.pattern === "hatched" ? undefined : chartTone(segment.tone).fill;
      const accessibility = { "aria-label": segment.label, "aria-describedby": tip.open && tip.active === segment.key ? sharedTooltipId : undefined, "data-stack-key": segment.key, "data-fraction": segment.value, tabIndex: selected === segment.key ? 0 : -1 };
      const paint = segment.pattern === "hatched" ? { fill: `url(#${id}-hatch-${index})` } : segment.pattern === "light" ? { fillOpacity: .35 } : {};
      const shade = separated && active && active !== segment.key && visible.some(item => item.key === active) ? .35 : 1;
      const movement = { ...(initial ? { ...tier, delay: staggerDelay(index) } : tier), opacity: spring.fast };
      const interactions = { onFocus: (event: React.FocusEvent<SVGElement>) => { onActiveChange?.(segment.key); if (tooltip) tip.show(segment.key, tooltip(segment.key), event.currentTarget, null, "above"); }, onPointerEnter: () => onActiveChange?.(segment.key), onClick: onSelect ? () => onSelect(segment.key) : undefined };
      return full ? <motion.rect key={segment.key + mode} {...accessibility} {...paint} {...interactions} className={(colour ?? "") + (onSelect ? " cursor-pointer" : "")} role="img"
        initial={{ x: left, y: 0, width: initial ? 0 : length, height }} animate={{ ...geometry, width: entered ? length : 0, opacity: shade }}
        transition={movement} onAnimationStart={() => setReady(false)} onAnimationComplete={() => { if (entered) { previous.current = true; setReady(true); } }}>
        <title>{segment.label}</title>
      </motion.rect> : <rect key={segment.key + mode} {...geometry} {...accessibility} {...paint} {...interactions} opacity={shade} className={colour} role="img"><title>{segment.label}</title></rect>;
    })}</g> : null}
    {markers.map(marker => <g key={marker.key} data-stack-marker={marker.kind} aria-label={marker.label}>
      <title>{marker.label}</title><line x1={clamp(marker.at) * actualWidth} x2={clamp(marker.at) * actualWidth} y1={-3} y2={height + 3} strokeWidth={2} className="stroke-foreground" />
    </g>)}
  </svg>{tip.layer}</>;
}
