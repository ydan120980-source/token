import { type ReactNode, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { portalRoot } from "@/lib/portal-root";
import { data, reducedFade, spring, staggerDelay } from "@ui/design/motion";
import { Value } from "./surfaces";
import type { UnknownLabel } from "./surfaces";
import { useKitMotion } from "./motion-mode";

function useMotionSetting() {
  return useKitMotion().mode;
}
const figureSize = { xl: "text-figure-xl", lg: "text-figure-lg", md: "text-figure-md", sm: "text-figure-sm",
  "cost-hero": "text-figure-cost-hero" };
interface FigureProps {
  text: string | null; unit?: string; size: keyof typeof figureSize; unknown?: UnknownLabel; animated?: boolean;
}
function RollingDigit({ character, index, initial, tier }: { character: string; index: number; initial: boolean; tier: typeof data.enter | typeof data.update }) {
  const transition = { ...tier, delay: staggerDelay(index) };
  return <span className="relative inline-flex h-lh overflow-hidden" aria-hidden="true"><span className="invisible">{character}</span>
    <motion.span className="absolute left-0 top-0 flex flex-col" initial={{ y: initial ? "0%" : `${-Number(character) * 10}%` }} animate={{ y: `${-Number(character) * 10}%` }} transition={transition}>
      {[..."0123456789"].map(digit => <span className="h-lh shrink-0" key={digit}>{digit}</span>)}
    </motion.span>
  </span>;
}
export function Figure({ text, unit, size, unknown = "未知", animated = true }: FigureProps) {
  const previous = useRef<string | null>(null), mode = useMotionSetting(), reduced = useReducedMotion();
  const initial = previous.current === null, signature = text?.replace(/\d/g, "#");
  // A new digit count re-keys the digits without fading the figure: live collection changes today's
  // figures every few seconds, and a fade from zero read as the card flashing (owner 2026-10-29).
  const transition = initial ? data.enter : data.update;
  useEffect(() => { previous.current = text; }, [text]);
  const direct = !animated || mode !== "full" || reduced, fade = animated && (mode === "reduced" || mode === "full" && Boolean(reduced));
  return <span className="inline-flex items-baseline gap-2 text-foreground">
    <span className={figureSize[size] + " font-semibold tabular-nums"}>
      {text === null ? <Value value={null} unknown={unknown} /> : direct ? fade && !initial ? <motion.span key={text} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={reducedFade}>{text}</motion.span> : <span>{text}</span> : <motion.span key={signature} className="inline-flex" aria-label={text}
        initial={false} animate={{ opacity: 1 }} transition={transition}>
        {[...text].map((character, index) => /\d/.test(character) ? <RollingDigit key={index} character={character} index={text.length - 1 - index} initial={initial} tier={transition} /> : <span key={index} aria-hidden="true">{character}</span>)}
      </motion.span>}
    </span>{unit ? <span className="text-caption text-muted-foreground">{unit}</span> : null}
  </span>;
}

/** A value that opens something: it reads exactly like the text around it (size, weight, colour, no padding), underlines on hover. */
export function ValueButton({ onClick, children, "aria-label": label }: { onClick: () => void; children: ReactNode; "aria-label"?: string }) {
  return <button type="button" aria-label={label} onClick={onClick} data-value-button
    className="inline-flex cursor-pointer items-baseline gap-1 rounded-lg text-inherit underline-offset-4 outline-none hover:underline hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring">
    {children}
  </button>;
}

const dots: Record<string, string> = {
  codex: "bg-agent-codex", claude: "bg-agent-claude", opencode: "bg-agent-opencode", workbuddy: "bg-agent-workbuddy", mimo: "bg-agent-mimo",
  gemini: "bg-agent-gemini", cursor: "bg-agent-cursor", zcode: "bg-agent-zcode", deepseek: "bg-agent-deepseek", antigravity: "bg-agent-antigravity",
  copilot: "bg-agent-copilot", cline: "bg-agent-cline", pi: "bg-agent-pi", "continue": "bg-agent-continue", kilo: "bg-agent-kilo", qwen: "bg-agent-qwen", kimi: "bg-agent-kimi",
};
const marks = { 16: "h-4 w-4", 20: "h-5 w-5", 24: "h-6 w-6" };
// Theme helpers (fluid-helpers.css): Claude's mark in its orange, black marks light in the dark theme.
const markTone: Record<string, string> = { claude: " ff-mark-claude", codex: " ff-mark-mono", opencode: " ff-mark-mono", cursor: " ff-mark-mono", mimo: " ff-mark-mono", copilot: " ff-mark-mono", pi: " ff-mark-mono", continue: " ff-mark-mono" };
type CatalogWindow = Window & { agentCatalog?: { agents: Record<string, { name: string; icon: string }> } };
export function AgentMark({ agent, variant, size = 20 }: { agent: string; variant: "icon" | "dot"; size?: 16 | 20 | 24 }) {
  const meta = (window as CatalogWindow).agentCatalog?.agents[agent];
  const icon = meta?.icon ?? "ui/layout-grid";
  return variant === "dot" ? <span className={"inline-flex shrink-0 rounded-full " + marks[size] + " " + (dots[agent] ?? "bg-muted")} role="img" aria-label={meta?.name ?? agent} />
    : <img className={marks[size] + " shrink-0" + (markTone[agent] ?? "")} src={`assets/${icon}.svg`} alt={meta?.name ?? agent} />;
}

type ToastMessage = { id: number; message: string; tone: "neutral" | "warn" } | null;
// How long one message stays, as the legacy toast (design/desktop-reference/preview.js toast()).
const TOAST_MS = 4500;
let currentToast: ToastMessage = null, sequence = 0, toastTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
function publish(message: ToastMessage) {
  currentToast = message; clearTimeout(toastTimer);
  if (message) toastTimer = setTimeout(() => { if (currentToast?.id === message.id) publish(null); }, TOAST_MS);
  for (const listener of listeners) listener();
}
export const toast = {
  show(message: string, { tone = "neutral" }: { tone?: "neutral" | "warn" } = {}) { publish({ id: ++sequence, message, tone }); },
};
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); if (listeners.size === 0) { currentToast = null; clearTimeout(toastTimer); } }; }
// Mounted with the gallery now and the app shell at M9. The newest announcement replaces the
// previous one; each leaves after TOAST_MS.
export function Toast() {
  const message = useSyncExternalStore(subscribe, () => currentToast), reduced = useReducedMotion(), mode = useMotionSetting();
  return createPortal(<div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center" role="status" aria-live="polite">
    <AnimatePresence mode="wait">{message ? <motion.div key={message.id} className={"rounded-xl bg-surface-3 p-4 text-body " + (message.tone === "warn" ? "text-warn-text" : "text-foreground")}
      initial={{ opacity: 0, y: reduced || mode !== "full" ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: spring.moderate.exit }} transition={spring.moderate}>{message.message}</motion.div> : null}</AnimatePresence>
  </div>, portalRoot());
}

// The person's own avatar: a photo, or initials on one of three tones. Initials come from the
// page (profile-model.js); the kit does not derive them.
const avatarTones = {
  indigo: "from-avatar-indigo-from to-avatar-indigo-to text-avatar-indigo-text",
  teal: "from-avatar-teal-from to-avatar-teal-to text-avatar-teal-text",
  coral: "from-avatar-coral-from to-avatar-coral-to text-avatar-coral-text",
};
const avatarSizes = { 24: "h-6 w-6 text-micro", 40: "h-10 w-10 text-subtitle", 64: "h-16 w-16 text-title" };
export function Avatar({ initials, label, tone, photo, size }: { initials: string; label: string; tone: "indigo" | "teal" | "coral"; photo?: string | null; size: 24 | 40 | 64 }) {
  const box = "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full " + avatarSizes[size];
  return photo ? <img className={box + " object-cover"} src={photo} alt={label} />
    : <span className={box + " bg-linear-135 font-semibold " + avatarTones[tone]} role="img" aria-label={label}>{initials}</span>;
}

// Shares of one whole as adjacent segments (pricing coverage). Values are 0–1 fractions already
// computed by the existing modules; an unknown share is left out by the page and shown as Value.
const meterTones = { done: "bg-success", warn: "bg-warn", muted: "bg-muted-foreground" };
export function Meter({ segments, "aria-label": label }: { segments: { value: number; tone: "done" | "warn" | "muted"; label: string }[]; "aria-label": string }) {
  const mode = useMotionSetting(), reduced = useReducedMotion(), seen = useRef(false);
  const direct = mode !== "full" || reduced, transition = seen.current ? data.update : data.enter;
  useEffect(() => { seen.current = true; }, []);
  return <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={label}>
    {segments.map(segment => {
      const width = Math.max(0, Math.min(1, segment.value)) * 100 + "%";
      return direct ? <span key={segment.label} className={"h-full " + meterTones[segment.tone]} data-meter-segment={segment.label} style={{ width }} />
        : <motion.span key={segment.label} className={"h-full " + meterTones[segment.tone]} data-meter-segment={segment.label} initial={{ width: 0 }} animate={{ width }} transition={transition} />;
    })}
  </div>;
}
