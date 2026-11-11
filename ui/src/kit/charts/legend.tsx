import { type ReactNode } from "react";
import { useKitMotion } from "../motion-mode";
import { isComposing } from "../ime";
import { chartTone, type ChartTone } from "./tones";

export interface LegendItem { key: string; label: string; tone: ChartTone; hidden: boolean; lead?: ReactNode; note?: ReactNode; disabled?: boolean; title?: string; ariaLabel?: string }
export function ChartLegend({ items, onToggle, minVisible, active = null, onActiveChange, variant = "list" }: { items: LegendItem[]; onToggle: (key: string) => void; minVisible: 0 | 1; active?: string | null; onActiveChange?: (key: string | null) => void; variant?: "list" | "inline" | "donut" | "tiles" }) {
  const { full } = useKitMotion(), current = items.find(item => item.key === active)?.key ?? items[0]?.key;
  const toggle = (item: LegendItem) => { if (!item.disabled && (item.hidden || items.filter(row => !row.hidden && !row.disabled).length > minVisible)) onToggle(item.key); };
  // "tiles": a two-column grid, name above value (Screen Time's categories), for a breakdown that sits beside a
  // plain row list and must not read as another one (owner 2026-11-01).
  const tiles = variant === "tiles";
  const layout = variant === "inline" ? "flex flex-wrap gap-x-1 gap-y-0.5" : tiles ? "grid grid-cols-2 gap-1" : "flex flex-col";
  const row = variant === "inline" ? "h-7 gap-2 rounded-full text-caption" : variant === "donut" ? "h-9 w-full gap-3 rounded-lg text-caption" : tiles ? "min-w-0 flex-col gap-1 rounded-xl py-2.5" : "h-9 w-full gap-3 rounded-lg text-body";
  return <div role="group" aria-label="图例" data-chart-legend data-legend-variant={variant} className={layout} onPointerLeave={() => onActiveChange?.(null)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onActiveChange?.(null); }} onKeyDown={event => {
    if (isComposing(event)) return;
    const index = Math.max(0, items.findIndex(item => item.key === current)), next: Record<string, number> = { ArrowLeft: index - 1, ArrowUp: index - 1, ArrowRight: index + 1, ArrowDown: index + 1, Home: 0, End: items.length - 1 };
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onActiveChange?.(null); }
    else if (event.key in next && items.length) { event.preventDefault(); const key = items[Math.max(0, Math.min(items.length - 1, next[event.key]))].key; event.currentTarget.querySelector<HTMLElement>('[data-legend-key="' + CSS.escape(key) + '"]')?.focus(); }
  }}>{items.map(item => <button key={item.key} type="button" data-legend-key={item.key} data-active={item.key === active} tabIndex={item.key === current ? 0 : -1} aria-pressed={item.disabled ? undefined : !item.hidden} aria-disabled={item.disabled || undefined} aria-label={item.ariaLabel} title={item.title} className={"flex " + (tiles ? "items-start" : "items-center") + " px-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring hover:bg-hover " + row + " " + (full ? "transition-colors duration-80 " : "") + (item.key === active ? "bg-hover " : "bg-transparent ") + (item.hidden || item.disabled ? "text-muted-foreground" : "text-foreground")} onPointerEnter={() => onActiveChange?.(item.key)} onFocus={() => onActiveChange?.(item.key)} onClick={() => toggle(item)}>{tiles ? <>
    <span className="flex w-full min-w-0 items-center gap-2 text-caption text-muted-foreground">{item.lead ?? <span aria-hidden className={"h-2 w-2 shrink-0 rounded-full " + chartTone(item.tone).background}/>}<span data-legend-label className="min-w-0 truncate">{item.label}</span></span>
    {item.note ? <span className={"inline-flex items-baseline gap-2 text-body tabular-nums" + (item.hidden || item.disabled ? " opacity-50" : "")}>{item.note}</span> : null}
  </> : <><span aria-hidden className={"h-2 w-2 shrink-0 rounded-full " + chartTone(item.tone).background}/><span data-legend-label className={"min-w-0 " + (variant === "inline" ? "whitespace-nowrap" : "flex-1 truncate")}>{item.label}</span>{item.note ? <span className="inline-flex shrink-0 items-center gap-3 tabular-nums">{item.note}</span> : null}</>}</button>)}</div>;
}
