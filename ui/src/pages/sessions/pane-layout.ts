import type { PaneColumns, PaneEdge } from "@ui/kit/pane-drag";

// How open conversations are arranged (owner 2026-11-04, UI-READER-PANES-20261104.md): columns, each of one or two panes. It lives
// for this visit only; which conversations are open stays with the host. These functions never lose or repeat a slot.
export const COLUMN_PANES = 2;

/** Width affects React only when a pane/column fit decision changes. CSS still
 * receives every native width; fractional resize steps need no tree rebuild. */
export function paneWidthThresholds({ min, floor, nav, side, gap, max }: { min: number; floor: number; nav: number; side: number; gap: number; max: number }) {
  const edges = new Set<number>();
  for (let count = 1; count <= max; count++) {
    for (const taken of [0, nav, side, nav + side]) edges.add((floor + gap) * count + taken);
    edges.add(min * (count + 1));
  }
  return [...edges].sort((a, b) => a - b);
}
export function paneWidthBand(width: number, edges: number[]) {
  let from = 0, to = edges.length;
  while (from < to) { const middle = (from + to) >>> 1; if (width >= edges[middle]) from = middle + 1; else to = middle; }
  return from;
}

const without = (columns: PaneColumns, slot: number) => columns.map(column => column.filter(item => item !== slot)).filter(column => column.length);
export const columnOf = (columns: PaneColumns, slot: number) => columns.findIndex(column => column.includes(slot));

/** The arrangement with slot beside, above, below or in place of target; the middle swaps the two. */
export function placePane(columns: PaneColumns, slot: number, target: number, edge: PaneEdge): PaneColumns {
  if (slot === target) return columns;
  if (edge === "center") return columns.map(column => column.map(item => item === slot ? target : item === target ? slot : item));
  const next = without(columns, slot), at = columnOf(next, target);
  if (at < 0) return columns;
  if (edge === "left" || edge === "right") next.splice(at + (edge === "right" ? 1 : 0), 0, [slot]);
  else next[at].splice(next[at].indexOf(target) + (edge === "bottom" ? 1 : 0), 0, slot);
  return next;
}
/** Slots that are gone leave; new ones take a column of their own at the end, unless the person dropped them somewhere. */
export function reconcile(columns: PaneColumns, slots: number[], dropped?: { slot: number; target: number; edge: PaneEdge } | null): PaneColumns {
  let next = columns.map(column => column.filter(item => slots.includes(item))).filter(column => column.length);
  for (const slot of slots) {
    if (columnOf(next, slot) >= 0) continue;
    next = dropped?.slot === slot && columnOf(next, dropped.target) >= 0 ? placePane([...next, [slot]], slot, dropped.target, dropped.edge) : [...next, [slot]];
  }
  return next;
}
/** The same moves from the keyboard: one column along, or under the column beside. */
export type PaneMove = "left" | "right" | "stack" | "unstack";
export function movePane(columns: PaneColumns, slot: number, move: PaneMove): PaneColumns {
  const at = columnOf(columns, slot); if (at < 0) return columns;
  const alone = columns[at].length === 1;
  if (move === "unstack") return alone ? columns : placePane(columns, slot, columns[at].find(item => item !== slot)!, "right");
  if (move === "stack") {
    const beside = columns[at + 1] ?? columns[at - 1];
    return alone && beside && beside.length < COLUMN_PANES ? placePane(columns, slot, beside[beside.length - 1], "bottom") : columns;
  }
  const to = at + (move === "left" ? -1 : 1);
  if (!alone) return placePane(columns, slot, columns[at].find(item => item !== slot)!, move);
  if (to < 0 || to >= columns.length) return columns;
  const next = [...columns]; [next[at], next[to]] = [next[to], next[at]];
  return next;
}
