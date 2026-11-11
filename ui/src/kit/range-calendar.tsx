import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { IconButton } from "./controls";
import { useKitMotion } from "./motion-mode";
import { isComposing } from "./ime";

export interface CalendarRange { from: string; to: string }
const parse = (day: string) => new Date(day + "T12:00:00Z"), iso = (date: Date) => date.toISOString().slice(0, 10);
const shift = (day: string, days: number) => { const date = parse(day); date.setUTCDate(date.getUTCDate() + days); return iso(date); };
const monthOf = (day: string) => day.slice(0, 7) + "-01";
const shiftMonth = (day: string, months: number) => { const date = parse(monthOf(day)); date.setUTCMonth(date.getUTCMonth() + months); return iso(date); };
const dayLabel = (day: string) => Number(day.slice(5, 7)) + "月" + Number(day.slice(8)) + "日";
const span = (range: CalendarRange) => Math.round((parse(range.to).getTime() - parse(range.from).getTime()) / 86400000) + 1;

export function RangeCalendar({ value, min, max, onChange, commit, marks = [], "aria-label": label }: { value: CalendarRange | null; min: string; max: string; onChange: (range: CalendarRange) => void; commit: "second-click" | "draft"; marks?: string[]; "aria-label": string }) {
  const root = useRef<HTMLDivElement>(null), pendingFocus = useRef(false), [month, setMonth] = useState(monthOf(value?.to ?? max)), [anchor, setAnchor] = useState<string | null>(null), [hover, setHover] = useState<string | null>(null), [focus, setFocus] = useState(value?.to ?? max), { full } = useKitMotion(), markSet = new Set(marks);
  const first = shift(month, -((parse(month).getUTCDay() + 6) % 7)), preview = anchor ? { from: hover && hover < anchor ? hover : anchor, to: hover && hover > anchor ? hover : anchor } : value;
  useEffect(() => { if (value && !anchor) { setMonth(monthOf(value.to)); setFocus(value.to); } }, [value?.from, value?.to]);
  const choose = (day: string) => { if (day < min || day > max) return; setFocus(day); if (anchor) { const range = { from: day < anchor ? day : anchor, to: day > anchor ? day : anchor }; setAnchor(null); setHover(null); onChange(range); } else { setAnchor(day); setHover(null); if (commit === "draft") onChange({ from: day, to: day }); } };
  let summary = "选择开始日期";
  if (preview) summary = anchor && !hover && preview.from === preview.to ? dayLabel(preview.from) + " · 再选一天作为结束，或直接应用单日" : preview.from === preview.to ? dayLabel(preview.from) + " · 单日按小时显示" : dayLabel(preview.from) + " – " + dayLabel(preview.to) + " · " + span(preview) + " 天";
  const focusDay = (day: string) => { const next = day < min ? min : day > max ? max : day; pendingFocus.current = true; setFocus(next); setMonth(monthOf(next)); if (anchor) setHover(next); };
  // A cross-month move removes the previously focused button. Remember the
  // keyboard intent before that removal rather than checking activeElement
  // afterwards, when the browser has already returned it to body.
  useLayoutEffect(() => { if (!pendingFocus.current) return; pendingFocus.current = false; root.current?.querySelector<HTMLButtonElement>('[data-calendar-day="' + focus + '"]')?.focus({ preventScroll: true }); }, [focus, month]);
  return <div ref={root} data-range-calendar data-anchor={anchor ?? ""} className="flex min-w-0 flex-col gap-3" onPointerLeave={() => setHover(null)}>
    <div className="flex items-center justify-between gap-3"><strong className="text-body font-semibold tabular-nums" aria-live="polite">{month.slice(0, 4)}年{Number(month.slice(5, 7))}月</strong><div className="flex items-center gap-1"><IconButton size="compact" icon={IconChevronLeft} label="上个月" disabled={shiftMonth(month, -1) < monthOf(min)} onClick={() => setMonth(shiftMonth(month, -1))}/><IconButton size="compact" icon={IconChevronRight} label="下个月" disabled={shiftMonth(month, 1) > monthOf(max)} onClick={() => setMonth(shiftMonth(month, 1))}/></div></div>
    <div className="grid grid-cols-7 text-center text-micro text-muted-foreground" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map(day => <span key={day}>{day}</span>)}</div>
    <div role="grid" aria-label={label} className="grid grid-cols-7" onKeyDown={event => { if (isComposing(event)) return; const element = (event.target as Element).closest<HTMLButtonElement>("[data-calendar-day]"), day = element?.dataset.calendarDay; if (!day) return; const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key]; let next: string | undefined;
      if (delta !== undefined) next = shift(day, delta); else if (event.key === "PageUp" || event.key === "PageDown") { const targetMonth = shiftMonth(day, event.key === "PageUp" ? -1 : 1), lastDay = Number(shift(shiftMonth(targetMonth, 1), -1).slice(8)); next = targetMonth.slice(0, 8) + String(Math.min(lastDay, Number(day.slice(8)))).padStart(2, "0"); }
      if (next) { event.preventDefault(); event.stopPropagation(); focusDay(next); }
    }}>{Array.from({ length: 42 }, (_, index) => { const day = shift(first, index), disabled = day < min || day > max, inRange = Boolean(preview && day >= preview.from && day <= preview.to), end = preview?.from === day || preview?.to === day, single = preview?.from === preview?.to, today = day === max, outside = day.slice(0, 7) !== month.slice(0, 7); return <button key={day} type="button" role="gridcell" data-calendar-day={day} data-marked={markSet.has(day) || undefined} tabIndex={!disabled && focus === day ? 0 : -1} disabled={disabled} aria-label={day + (markSet.has(day) ? "，有用量记录" : "")} aria-selected={inRange} className={"group relative flex h-9 items-center justify-center text-caption tabular-nums outline-none " + (!disabled ? "" : "cursor-default ")} onClick={() => choose(day)} onFocus={() => { setFocus(day); if (anchor) setHover(day); }} onPointerEnter={() => { if (anchor && !disabled) setHover(day); }}>{inRange && !single ? <span aria-hidden="true" className={"absolute inset-y-0.5 bg-hover " + (preview?.from === day ? "left-1/2 right-0" : preview?.to === day ? "left-0 right-1/2" : "inset-x-0") + (index % 7 === 0 ? " rounded-l-full" : "") + (index % 7 === 6 ? " rounded-r-full" : "")}/> : null}<span className={"relative grid size-8 place-items-center rounded-full group-focus-visible:ring-1 group-focus-visible:ring-ring " + (end ? "bg-foreground font-semibold text-background " : (disabled || outside ? "text-muted-foreground " : today ? "font-semibold text-accent-text " : "text-foreground ") + (!disabled ? "group-hover:bg-hover " : "")) + (full ? "transition-colors duration-80" : "")}>{Number(day.slice(8))}{markSet.has(day) ? <span aria-hidden="true" className={"absolute bottom-0.5 size-0.5 rounded-full " + (end ? "bg-background" : "bg-muted-foreground")}/> : null}</span></button>; })}</div>
    {commit === "draft" ? <p role="status" className="text-caption text-muted-foreground">{summary}</p> : null}
  </div>;
}

export { span as calendarSpan };
