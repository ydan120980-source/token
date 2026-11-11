import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconCheck, IconChevronLeft, IconCopy, IconDots } from "@tabler/icons-react";
import { Field } from "@base-ui/react/field";
import { motion } from "motion/react";
import { flushSync } from "react-dom";
import { spring } from "@ui/design/motion";
import { AgentMark } from "./data-display";
import { IconButton } from "./controls";
import { isComposing } from "./ime";
import { useKitMotion } from "./motion-mode";

export function TextArea({ label, value, onChange, rows, maxLength, placeholder, disabled, error, mono = false, spellCheck }: {
  label: string; value: string; onChange: (value: string) => void; rows: 3 | 6 | 16; maxLength?: number; placeholder?: string;
  disabled?: boolean; error?: string; mono?: boolean; spellCheck?: boolean;
}) {
  const id = useId(), [focused, setFocused] = useState(false), [pointed, setPointed] = useState(false);
  // Same Field accessibility and foreground/ring states as fluid InputField, with a multiline control.
  const background = disabled ? "bg-transparent" : focused ? "bg-card" : pointed ? (error ? "bg-destructive-light" : "bg-muted") : "bg-transparent";
  const ring = error && (focused || pointed) ? "ring-destructive" : focused || pointed ? "ring-border" : "ring-transparent";
  return <Field.Root invalid={Boolean(error)} disabled={disabled} className="flex w-72 max-w-full flex-col gap-1">
    <Field.Label htmlFor={id} className={"pl-2.5 text-body " + (error ? "text-destructive" : "text-muted-foreground")}>{label}</Field.Label>
    <textarea id={id} value={value} rows={rows} maxLength={maxLength} placeholder={placeholder} disabled={disabled} spellCheck={spellCheck}
      aria-invalid={Boolean(error)} aria-describedby={error ? id + "-error" : undefined}
      className={"w-full resize-y rounded-lg px-2.5 py-2 text-body text-foreground placeholder:text-muted-foreground outline-none ring-1 focus-visible:ring-ring " + background + " " + ring + (mono ? " font-mono" : " font-sans")}
      onChange={event => onChange(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onPointerEnter={() => setPointed(true)} onPointerLeave={() => setPointed(false)}
      onKeyDown={event => { if (event.key === "Enter") event.stopPropagation(); }} />
    {error ? <p id={id + "-error"} className="pl-2.5 text-caption text-destructive">{error}</p> : null}
  </Field.Root>;
}

type FilterAgent = { id: string; name: string; recorded: boolean };
// How many choices fit a row before the Agents without records step aside.
const AGENT_ROW = 8;
export function AgentFilter({ agents, value, onChange, display, allLabel = "全部", "aria-label": label }: {
  agents: FilterAgent[]; value: string; onChange: (value: string) => void; display: "icon" | "chip"; allLabel?: string; "aria-label": string;
}) {
  const root = useRef<HTMLDivElement>(null), { full } = useKitMotion();
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null), [shownAll, setShownAll] = useState(false);
  const everyone = [{ id: "all", name: allLabel, recorded: true }, ...agents.filter(agent => agent.id !== "all")];
  // With many Agents, those without records wait behind 更多; the chosen one always stays.
  const hideable = everyone.length > AGENT_ROW, hidden = hideable ? everyone.filter(agent => !agent.recorded && agent.id !== value).length : 0;
  const options = hideable && !shownAll ? everyone.filter(agent => agent.recorded || agent.id === value) : everyone;
  const measured = useRef<typeof rect>(null);
  const signature = options.map(agent => agent.id + ":" + agent.name).join("|");
  useLayoutEffect(() => {
    const host = root.current; if (!host) return;
    const measure = () => {
      const chosen = [...host.querySelectorAll<HTMLElement>("[role=radio]")].find(button => button.dataset.agent === value);
      const next = chosen ? { x: chosen.offsetLeft, y: chosen.offsetTop, width: chosen.offsetWidth, height: chosen.offsetHeight } : null;
      const previous = measured.current;
      if (previous === next || previous && next && previous.x === next.x && previous.y === next.y && previous.width === next.width && previous.height === next.height) return;
      measured.current = next;
      flushSync(() => setRect(next));
    };
    // Read after native layout, then commit the indicator before this paint.
    // An eager layout-effect read forces the whole newly mounted page to lay out.
    const resize = new ResizeObserver(measure); resize.observe(host); for (const child of host.querySelectorAll("button")) resize.observe(child);
    return () => resize.disconnect();
  }, [value, signature, display]);
  // The wheel moves a row that overflows, until its end; then the page takes over. The chosen one is kept in view.
  useEffect(() => {
    const row = scroller.current; if (!row) return;
    const edges = () => {
      // Read every dimension before touching mask attributes. A write between
      // the reads otherwise makes the second one flush the new page's layout.
      const left = row.scrollLeft, width = row.clientWidth, content = row.scrollWidth;
      row.toggleAttribute("data-more-start", left > 1); row.toggleAttribute("data-more-end", left + width < content - 1);
    };
    const wheel = (event: WheelEvent) => {
      if (row.scrollWidth <= row.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const before = row.scrollLeft; row.scrollLeft += event.deltaY;
      if (row.scrollLeft !== before) event.preventDefault();
    };
    const resize = new ResizeObserver(edges); resize.observe(row); if (root.current) resize.observe(root.current);
    // The initial observer delivery runs after native layout and before paint.
    row.addEventListener("scroll", edges, { passive: true }); row.addEventListener("wheel", wheel, { passive: false });
    return () => { resize.disconnect(); row.removeEventListener("scroll", edges); row.removeEventListener("wheel", wheel); };
  }, [signature]);
  useEffect(() => {
    const row = scroller.current, chosen = row?.querySelector<HTMLElement>('[role=radio][aria-checked="true"]'); if (!row || !chosen) return;
    const keepVisible = () => {
      const width = row.clientWidth, left = row.scrollLeft, start = chosen.offsetLeft, end = start + chosen.offsetWidth;
      if (width <= 0) return;
      if (start < left) row.scrollLeft = start;
      else if (end > left + width) row.scrollLeft = end - width;
    };
    const resize = new ResizeObserver(keepVisible); resize.observe(row); resize.observe(chosen);
    return () => resize.disconnect();
  }, [value, signature]);
  const keydown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isComposing(event)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]")], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = buttons.length - 1;
    if (["ArrowRight", "ArrowDown"].includes(event.key)) next = (index + 1) % buttons.length;
    if (["ArrowLeft", "ArrowUp"].includes(event.key)) next = (index - 1 + buttons.length) % buttons.length;
    if (next !== undefined) { event.preventDefault(); buttons[next].focus(); onChange(buttons[next].dataset.agent!); }
  };
  // One Agent picker for every page (owner 2026-10-28): a tray holding the marks in their own colours,
  // the chosen one raised on a card-coloured tile that springs between choices.
  return <div className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-xl bg-muted p-1" data-agent-filter-tray>
    <div ref={scroller} className="ff-agent-row relative flex min-w-0 flex-1"><div ref={root} role="radiogroup" aria-label={label} className="relative flex w-max shrink-0 gap-1" onKeyDown={keydown} data-agent-filter>
    {rect ? <motion.span key={full ? "moving" : "direct"} aria-hidden="true" data-agent-indicator className="pointer-events-none absolute left-0 top-0 rounded-lg bg-card shadow-card"
      initial={false} animate={full ? rect : undefined} style={full ? undefined : rect} transition={spring.moderate} /> : null}
    {options.map(agent => <button key={agent.id} type="button" role="radio" aria-checked={value === agent.id}
      aria-label={agent.name} title={agent.name + (agent.recorded ? "" : " · 暂无记录")} data-agent={agent.id}
      tabIndex={value === agent.id ? 0 : -1} onClick={() => onChange(agent.id)}
      className={"relative inline-flex h-9 min-w-9 items-center justify-center gap-2 rounded-lg px-2 text-body outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring " + (value === agent.id ? "hover:bg-transparent " : "") + (agent.recorded ? "text-foreground" : "text-muted-foreground opacity-60")}>
      <AgentMark agent={agent.id} variant="icon" size={20} />
      {agent.id === "all" || display === "chip" ? <span className="inline-grid"><span className="invisible col-start-1 row-start-1 font-semibold" aria-hidden="true">{agent.name}</span><span className={"col-start-1 row-start-1 " + (value === agent.id ? "font-semibold" : "font-normal")}>{agent.name}</span></span> : null}
    </button>)}
    </div></div>
    {hideable && (hidden > 0 || shownAll) ? <button type="button" aria-expanded={shownAll} aria-label={shownAll ? "收起没有记录的 Agent" : "显示另外 " + hidden + " 个没有记录的 Agent"} title={shownAll ? "收起没有记录的 Agent" : "另外 " + hidden + " 个没有记录"} data-agent-more onClick={() => setShownAll(!shownAll)}
      className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-caption text-muted-foreground tabular-nums outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring">
      {shownAll ? <IconChevronLeft size={16} aria-hidden="true" /> : <><IconDots size={16} aria-hidden="true" />{hidden}</>}
    </button> : null}
  </div>;
}

export function CopyButton({ label, onCopy, size = "default" }: { label: string; onCopy: () => Promise<boolean>; size?: "default" | "compact" }) {
  const [busy, setBusy] = useState(false), [copied, setCopied] = useState(false), pending = useRef(false), generation = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { generation.current++; clearTimeout(timer.current); }, []);
  const copy = async () => {
    if (pending.current) return;
    pending.current = true;
    const current = ++generation.current; clearTimeout(timer.current); setBusy(true); setCopied(false);
    let success = false;
    try { success = await onCopy(); } catch { /* The page owns any error announcement. */ }
    if (current !== generation.current) return;
    pending.current = false; setBusy(false); setCopied(success);
    if (success) timer.current = setTimeout(() => { if (current === generation.current) setCopied(false); }, 1600);
  };
  return <span data-copy-state={busy ? "busy" : copied ? "copied" : "idle"}><IconButton icon={copied ? IconCheck : IconCopy} label={label} onClick={() => { void copy(); }} size={size} disabled={busy} /></span>;
}

/** One choice in a list of things being picked: a box that fills when chosen. */
export function CheckMark({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  const { full } = useKitMotion();
  return <button type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} data-check-mark
    className="grid size-5 shrink-0 place-items-center rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-ring">
    <span className={"ff-widget-cell grid size-4 place-items-center " + (checked ? "bg-foreground text-background" : "bg-muted")}>
      {checked ? <motion.span className="grid place-items-center" initial={full ? { scale: 0.5, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }} transition={spring.fast}><IconCheck size={12} aria-hidden /></motion.span> : null}
    </span>
  </button>;
}
export function StatusDot({ tone, label }: { tone: "active"; label: string }) {
  return <span role="img" aria-label={label} title={label} data-status-dot={tone} className="inline-block h-2 w-2 shrink-0 rounded-full bg-success" />;
}
