import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { IconCalendar } from "@tabler/icons-react";
import { Button as FluidButton } from "@/components/ui/button";
import { portalRoot } from "@/lib/portal-root";
import { surfaceClasses } from "@/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@/lib/surface-context";
import { reducedFade, spring } from "@ui/design/motion";
import { Button, Segmented } from "./controls";
import { RangeCalendar, calendarSpan, type CalendarRange } from "./range-calendar";
import { useKitMotion } from "./motion-mode";
import { isComposing } from "./ime";

/**
 * A small panel that grows out of the control that opened it and goes back the same way (owner 2026-11-04:
 * calendars are Apple-style small popovers, not sheets). The page behind stays live; a press outside, Escape or
 * scrolling the page closes it.
 */
export function AnchoredPopover({ open, onOpenChange, trigger, label, onOpenFocus, children, ...attributes }: {
  open: boolean; onOpenChange: (open: boolean) => void; trigger: ReactNode; label: string; onOpenFocus?: (panel: HTMLElement) => void; children: ReactNode;
  [key: `data-${string}`]: string | undefined;
}) {
  const anchor = useRef<HTMLSpanElement>(null), panel = useRef<HTMLDivElement>(null), { full, fade } = useKitMotion(), level = Math.min(8, useSurface() + 2);
  const [place, setPlace] = useState({ left: 12, top: 12, origin: "50% 0" });
  useLayoutEffect(() => {
    if (!open) return; const element = panel.current, host = anchor.current; if (!element || !host) return;
    const measure = () => {
      const rect = host.getBoundingClientRect(), width = element.offsetWidth, height = element.offsetHeight;
      const left = Math.max(12, Math.min(innerWidth - width - 12, rect.left)), below = rect.bottom + 8 + height <= innerHeight - 12;
      setPlace({ left, top: below ? rect.bottom + 8 : Math.max(12, rect.top - height - 8), origin: (rect.left + rect.width / 2 - left) + "px " + (below ? "0" : height + "px") });
    };
    measure(); const resize = new ResizeObserver(measure); resize.observe(element);
    const wheel = (event: WheelEvent) => { if (!element.contains(event.target as Node)) onOpenChange(false); };
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true); window.addEventListener("wheel", wheel, { passive: true });
    return () => { resize.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); window.removeEventListener("wheel", wheel); };
  }, [open, onOpenChange]);
  const hidden = full ? { opacity: 0, scale: 0.94 } : fade ? { opacity: 0 } : undefined;
  return <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
    <span ref={anchor} className="inline-flex">{trigger}</span>
    <AnimatePresence>{open ? <Dialog.Portal forceMount container={portalRoot()}>
      <Dialog.Content forceMount asChild aria-describedby={undefined}
        onOpenAutoFocus={event => { event.preventDefault(); if (panel.current) onOpenFocus?.(panel.current); }}
        onCloseAutoFocus={event => { event.preventDefault(); anchor.current?.querySelector("button")?.focus({ preventScroll: true }); }}
        onInteractOutside={event => { if (anchor.current?.contains(event.target as Node)) event.preventDefault(); }}
        onEscapeKeyDown={event => { if (isComposing(event)) event.preventDefault(); }}>
        <motion.div ref={panel} {...attributes} data-popover="" className={"fixed z-50 flex w-76 flex-col gap-3 overflow-auto rounded-2xl p-4 text-body text-foreground outline-none " + surfaceClasses(level)}
          style={{ left: place.left, top: place.top, maxWidth: innerWidth - 24, maxHeight: innerHeight - 24, transformOrigin: place.origin }}
          initial={hidden ?? false} animate={{ opacity: 1, scale: 1 }}
          exit={full ? { ...hidden, transition: spring.moderate.exit } : fade ? { opacity: 0, transition: reducedFade } : undefined}
          transition={full ? spring.moderate : reducedFade}
          onKeyDown={event => { if (event.key !== "Tab") return; const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(element => element.tabIndex >= 0); const index = buttons.indexOf(document.activeElement as HTMLElement); if (event.shiftKey && index <= 0 || !event.shiftKey && index === buttons.length - 1) { event.preventDefault(); buttons[event.shiftKey ? buttons.length - 1 : 0]?.focus(); } }}>
          <SurfaceProvider value={level}><Dialog.Title className="sr-only">{label}</Dialog.Title>{children}</SurfaceProvider>
        </motion.div>
      </Dialog.Content>
    </Dialog.Portal> : null}</AnimatePresence>
  </Dialog.Root>;
}

const focusDay = (panel: HTMLElement) => panel.querySelector<HTMLButtonElement>('[data-calendar-day][tabindex="0"]')?.focus({ preventScroll: true });
export { focusDay as focusCalendarDay };

export function DateRangePopover({ value, presets, preset, onApply, onReset, maxDays, min, max, triggerLabel, marks, "aria-label": label }: { value: CalendarRange | null; presets: { key: string; label: string }[]; preset: string; onApply: (range: CalendarRange | null, preset?: string) => void; onReset: () => void; maxDays: number; min: string; max: string; triggerLabel?: string; marks?: string[]; "aria-label": string }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(value), [error, setError] = useState(""), id = useId();
  const changeOpen = (next: boolean) => { if (next) { setDraft(value); setError(""); } setOpen(next); };
  const apply = () => { if (!draft?.from || !draft.to) { setError("请选择日期"); return; } if (draft.from > draft.to) { setError("结束日期不能早于开始日期"); return; } if (calendarSpan(draft) > maxDays) { setError(maxDays === 3660 ? "最多查看 10 年" : "最多查看 " + maxDays + " 天"); return; } onApply(draft); setOpen(false); };
  const reset = () => { onReset(); setOpen(false); };
  return <AnchoredPopover open={open} onOpenChange={changeOpen} label={label} onOpenFocus={focusDay} data-date-range-popover=""
    trigger={<FluidButton type="button" variant="secondary" leadingIcon={IconCalendar} aria-label={label} aria-expanded={open} onClick={() => changeOpen(!open)}>{triggerLabel ?? presets.find(item => item.key === preset)?.label ?? label}</FluidButton>}>
    <RangeCalendar value={draft} min={min} max={max} onChange={range => { setDraft(range); setError(""); }} commit="draft" marks={marks} aria-label="选择日期范围"/>
    <Segmented value={preset} size="compact" items={presets.map(item => ({ value: item.key, label: item.label }))} onChange={key => { onApply(null, key); setOpen(false); }} aria-label="快速范围"/>
    {error ? <p role="alert" id={id} className="text-caption text-foreground">{error}</p> : null}
    <div className="flex items-center justify-end gap-2"><Button variant="ghost" size="compact" onClick={reset}>重置</Button><Button variant="primary" size="compact" onClick={apply}>应用</Button></div>
  </AnchoredPopover>;
}
