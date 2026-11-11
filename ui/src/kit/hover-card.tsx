import type { FocusEvent, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useSharedChartTooltip } from "./charts/common";
import { chartTone, type ChartTone } from "./charts/tones";
import { isComposing } from "./ime";

// Hover cards (owner 2026-10-28, docs/m2/UI-HOVER-20261028.md): migrated pages keep the old pages'
// hover behaviour, and the new features open a card on hover. A card shares the window's one chart
// tooltip, so only one card is open at a time; focus opens it too and Escape closes it.

export interface TipCardRow { key: string; label: ReactNode; value: ReactNode; tone?: ChartTone; hatched?: boolean; pointed?: boolean }

/** A hover card's content in the old chart tooltip's manner: a heading, rows with a swatch, and a quiet note. */
export function TipCard({ title, aside, rows = [], note }: { title: ReactNode; aside?: ReactNode; rows?: TipCardRow[]; note?: ReactNode }) {
  return <>
    <span className="flex items-baseline justify-between gap-3" data-tip-heading>
      <strong className="font-semibold text-foreground tabular-nums">{title}</strong>
      {aside != null ? <span className="text-muted-foreground tabular-nums">{aside}</span> : null}
    </span>
    {rows.map(row => <span key={row.key} data-tip-row data-pointed={row.pointed || undefined}
      className={"flex min-w-0 items-center gap-2" + (row.pointed ? " font-semibold" : "")}>
      {row.tone ? <i className={"ff-widget-cell size-2 shrink-0 " + (row.hatched ? "ff-widget-hatch" : chartTone(row.tone).background)} /> : null}
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.label}</span>
      <b className="shrink-0 font-medium text-foreground tabular-nums">{row.value}</b>
    </span>)}
    {note != null ? <span className="text-muted-foreground" data-tip-note>{note}</span> : null}
  </>;
}

/**
 * Binds hover cards to elements: spread `bind(key, content)` on each element and render `layer` once.
 * Pointing at or focusing the element opens its card above it (below when there is no room), or beside it in a dense list.
 */
export function useHoverCard() {
  const tip = useSharedChartTooltip();
  const bind = (key: string, content: ReactNode, placement: "above" | "right" | "left" = "above") => ({
    "data-hover-card": key,
    onPointerEnter: (event: PointerEvent<Element>) => tip.show(key, content, event.currentTarget, null, placement),
    onPointerMove: (event: PointerEvent<Element>) => { if (tip.active !== key) tip.show(key, content, event.currentTarget, null, placement); },
    onPointerLeave: () => tip.hide(),
    onFocus: (event: FocusEvent<Element>) => tip.show(key, content, event.currentTarget, null, placement),
    onBlur: () => tip.hide(),
    onKeyDown: (event: KeyboardEvent<Element>) => { if (event.key === "Escape" && tip.open && !isComposing(event)) { event.stopPropagation(); tip.hide(); } },
  });
  return { bind, active: tip.active ?? null, layer: tip.layer };
}
