import { useId, useLayoutEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { usePlot, useSharedChartTooltip, sharedTooltipId } from "./common";
import { chartTone } from "./tones";
import { isComposing } from "../ime";

interface Cell { key: string; row: number; col: number; level: 0 | 1 | 2 | 3 | 4 | null; disabled?: boolean; highlighted?: boolean; observed?: boolean; label: string }
interface HeatmapProps {
  variant: "calendar" | "weekHour"; rows: number; cols: number; cells: Cell[];
  colLabels?: { col: number; label: string }[]; rowLabels?: { row: number; label: string }[];
  colLabelsPosition?: "top" | "bottom"; sizing?: "default" | "fit-square";
  navigation?: "chronological" | "grid";
  selected?: string | null; onSelect?: (key: string) => void;
  active?: string | null; onActiveChange?: (key: string | null) => void;
  tooltip?: (key: string) => ReactNode; dataKey?: string; "aria-label": string;
}
export function Heatmap({ variant, rows, cols, cells, colLabels = [], rowLabels = [], colLabelsPosition = "top",
  sizing = "default", navigation = "chronological", selected = null, onSelect, active = null, onActiveChange, tooltip, dataKey,
  "aria-label": label }: HeatmapProps) {
  const plot = usePlot(dataKey), id = useId(), tip = useSharedChartTooltip(), [focus, setFocus] = useState<string | null>(null);
  useLayoutEffect(() => {
    tip.refresh(key => {
      const cell = cells.find(item => item.key === key);
      return cell ? tooltip?.(cell.key) ?? cell.label : null;
    }, key => cells.some(cell => cell.key === key && !cell.disabled));
  }, [cells, tooltip]);
  const gap = 3, labelWidth = variant === "weekHour" ? 22 : rowLabels.length ? 22 : 0, labelHeight = colLabels.length ? 20 : 0;
  // A pointable grid keeps room for the hover/selected ring (2.5px out, 1.5px wide) inside its frame, so the ring on an
  // edge cell is never clipped (owner 2026-11-01).
  const inset = onSelect || onActiveChange ? 4 : 0;
  const fit = sizing === "fit-square", gaps = Math.max(0, cols - 1) * gap + inset * 2;
  // The derived minimum only prevents invalid hidden/first-frame geometry; ResizeObserver owns the real width.
  // A calendar shrinks its squares to the card (down to 6px) instead of scrolling sideways (owner 2026-10-29).
  const width = fit ? Math.max(labelWidth + Math.max(1, cols) + gaps, plot.width) : variant === "calendar" ?
    Math.max(labelWidth + cols * 6 + gaps, plot.width) : Math.max(labelWidth + cols * 27 - gap + inset * 2, plot.width);
  const cellWidth = !fit && variant === "weekHour" ? 24 : (width - labelWidth - gaps) / Math.max(1, cols);
  const cellHeight = !fit && variant === "weekHour" ? 20 : cellWidth;
  const height = labelHeight + rows * (cellHeight + gap) - gap + inset * 2;
  const gridTop = (colLabelsPosition === "top" ? labelHeight : 0) + inset, gridLeft = labelWidth + inset;
  const labelY = colLabelsPosition === "top" ? 14 : height - labelHeight + 14;
  // As the old calendar (rhythm.css): with some cells marked (a chosen hour slot), every other recorded cell steps back
  // to the lowest swatch and marked cells take a ring. A cell without records (unknown, not zero) is a lighter fill of
  // that swatch, and a day not yet reached lighter still.
  const marking = cells.some(cell => cell.highlighted);
  const fillOf = (cell: Cell) => chartTone(cell.level === null ? "heat:0" : `heat:${marking && !cell.highlighted && cell.level > 0 ? 0 : cell.level}`).fill;
  const ring = (cell: Cell, kind: "hover" | "mark") => <rect key={kind + cell.key} data-heat-ring={kind} aria-hidden="true" pointerEvents="none" x={gridLeft + cell.col * (cellWidth + gap) - 2.5} y={gridTop + cell.row * (cellHeight + gap) - 2.5} width={cellWidth + 5} height={cellHeight + 5} rx={6} fill="none" strokeWidth={1.5} className={(kind === "mark" ? "stroke-foreground" : "stroke-muted-foreground") + " kit-heat-ring"}/>;
  const activeCell = cells.find(cell => cell.key === active && !cell.disabled);
  const enabled = cells.filter(cell => !cell.disabled), entry = enabled.find(cell => cell.key === (focus ?? selected ?? active))?.key ?? enabled[0]?.key;
  const show = (cell: Cell, anchor: Element, point: { x: number; y: number } | null = null) => { if (cell.disabled) return; onActiveChange?.(cell.key); tip.show(cell.key, tooltip?.(cell.key) ?? cell.label, anchor, point, "annotation"); };
  const close = () => { tip.hide(); onActiveChange?.(null); };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isComposing(event)) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    const cell = cells.find(item => item.key === (focus ?? active ?? entry)); if (!cell) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); if (!cell.disabled) onSelect?.(cell.key); return; }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    let next: Cell | undefined;
    if (event.key === "Home" || event.key === "End") next = event.key === "Home" ? enabled[0] : enabled.at(-1);
    else if (variant === "calendar") {
      const delta = (navigation === "grid" ? { ArrowLeft: -rows, ArrowRight: rows, ArrowUp: -1, ArrowDown: 1 } :
        { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 })[event.key]!;
      const order = cells.slice().sort((a, b) => a.col * rows + a.row - b.col * rows - b.row), index = order.indexOf(cell);
      for (let indexAt = index + delta; indexAt >= 0 && indexAt < order.length; indexAt += delta) if (!order[indexAt].disabled) { next = order[indexAt]; break; }
    } else {
      let row = cell.row, col = cell.col;
      for (let attempt = 0; attempt < rows * cols; attempt++) { row = (row + (event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0) + rows) % rows; col = (col + (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0) + cols) % cols; next = enabled.find(item => item.row === row && item.col === col); if (next) break; }
    }
    if (next) { setFocus(next.key); plot.ref.current?.querySelector<SVGElement>('[data-heat-key="' + CSS.escape(next.key) + '"]')?.focus(); }
  };
  return <div ref={plot.ref} role="group" aria-label={label} tabIndex={enabled.length ? undefined : 0} data-chart="heatmap" data-variant={variant} data-sizing={sizing} data-col-labels-position={colLabelsPosition} data-active={active ?? ""} data-selected={selected ?? ""} data-ready={plot.ready} data-enter-count={plot.entries} className="min-w-0 overflow-x-auto outline-none focus-visible:ring-1 focus-visible:ring-ring" onKeyDown={keyDown} onPointerLeave={close} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
    {/* As the old Token 活动 calendar did (owner 2026-10-29): the first view and each new range sweep in column by
        column (theme/fluid-helpers.css .kit-heat-cell), a palette change cross-fades, and the hovered cell takes a
        thin ring outside a card-coloured gap; it never grows. */}
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} data-heat-sweep={plot.full && plot.entered && plot.initial ? "" : undefined}>
      {colLabels.map(item => <text key={item.col} x={gridLeft + item.col * (cellWidth + gap)} y={labelY} data-heat-col-label={item.col} className={(activeCell?.col === item.col ? "fill-foreground font-semibold" : "fill-muted-foreground") + " kit-heat-label text-micro"}>{item.label}</text>)}
      {variant === "weekHour" && activeCell && !colLabels.some(item => item.col === activeCell.col) ? <text data-heat-hover-label x={gridLeft + activeCell.col * (cellWidth + gap)} y={labelY} className="fill-foreground font-semibold text-micro">{activeCell.col}</text> : null}
      {rowLabels.map(item => <text key={item.row} x={0} y={gridTop + item.row * (cellHeight + gap) + cellHeight / 2 + 4} className={(activeCell?.row === item.row ? "fill-foreground font-semibold" : "fill-muted-foreground") + " kit-heat-label text-micro"}>{item.label}</text>)}
      {(plot.width > 0 ? cells : []).map(cell => <rect key={cell.key} id={id + cell.key} data-heat-key={cell.key} data-level={cell.level === null ? "unknown" : cell.level} data-highlighted={cell.highlighted || undefined} role="button" aria-label={cell.label} aria-pressed={selected === cell.key} aria-disabled={cell.disabled || undefined} aria-describedby={tip.open && tip.active === cell.key ? sharedTooltipId : undefined} tabIndex={!cell.disabled && entry === cell.key ? 0 : -1} x={gridLeft + cell.col * (cellWidth + gap)} y={gridTop + cell.row * (cellHeight + gap)} width={cellWidth} height={cellHeight} rx={4} className={fillOf(cell) + " kit-heat-cell outline-none focus-visible:stroke-ring"} style={{ ["--c" as string]: cell.col, opacity: plot.mode !== "off" && !plot.entered ? 0 : undefined, fillOpacity: cell.level !== null ? undefined : cell.disabled ? .28 : .55 }} onPointerEnter={event => show(cell, event.currentTarget, { x: event.clientX, y: event.clientY })} onPointerMove={event => show(cell, event.currentTarget, { x: event.clientX, y: event.clientY })} onFocus={event => { setFocus(cell.key); show(cell, event.currentTarget); }} onClick={() => { if (!cell.disabled) onSelect?.(cell.key); }}/>) }
      {cells.filter(cell => cell.key === selected || cell.highlighted).map(cell => ring(cell, "mark"))}
      {activeCell && activeCell.key !== selected && !activeCell.highlighted ? ring(activeCell, "hover") : null}
    </svg>{tip.layer}
  </div>;
}
