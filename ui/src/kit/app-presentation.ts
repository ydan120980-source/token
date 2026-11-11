// Current app presentation policy: one IME policy, one motion preference and
// cancellable scrolling. React Figure/charts own all numeric presentation.
import { animate } from "motion/react";
import { spring } from "@ui/design/motion";
import { isComposing } from "./ime";

type Mode = "full" | "reduced" | "off";
type Preference = "system" | "reduced" | "off";
const motionKey = "agentusage.motion.v1", media = matchMedia("(prefers-reduced-motion: reduce)");
let preference: Preference = "system";
try { const value = localStorage.getItem(motionKey); if (value === "off" || value === "reduced") preference = value; } catch { /* Session only. */ }
const mode = (): Mode => preference === "off" ? "off" : preference === "reduced" || media.matches ? "reduced" : "full";
const editable = (target: EventTarget | null) => Boolean((target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"]'));
const usable = (element: HTMLElement | null | undefined) => Boolean(element?.isConnected && !(element as HTMLButtonElement).disabled && !element.closest("[hidden], [inert]") && element.getClientRects().length);
function guard(event: Event & { key?: string; isComposing?: boolean; keyCode?: number }) {
  if (!isComposing(event)) return false;
  if (["Enter", "Escape"].includes(event.key ?? "") || ["submit", "cancel"].includes(event.type)) event.preventDefault();
  return true;
}
function restoreFocus(previous: HTMLElement | null, fallback: HTMLElement | null | (() => HTMLElement | null)) {
  if (!previous || usable(previous)) return;
  const target = typeof fallback === "function" ? fallback() : fallback;
  if (usable(target)) target?.focus({ preventScroll: true });
}
function rove(event: KeyboardEvent, buttons: Iterable<HTMLButtonElement>, vertical = false) {
  if (guard(event) || editable(event.target) || event.altKey || event.ctrlKey || event.metaKey) return null;
  const keys = vertical ? ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"] : ["ArrowLeft", "ArrowRight", "Home", "End"];
  const list = [...buttons].filter(button => !button.disabled && !button.hidden);
  if (!keys.includes(event.key) || !list.length) return null;
  event.preventDefault();
  const index = list.indexOf(document.activeElement as HTMLButtonElement), step = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
  return list[event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : (index + step + list.length) % list.length];
}
let scrollJob: ReturnType<typeof animate> | null = null, placeFrame = 0, epoch = 0;
function cancelScroll() { scrollJob?.stop(); scrollJob = null; epoch++; cancelAnimationFrame(placeFrame); placeFrame = 0; }
function scrollTo(top: number) {
  const from = scrollY, to = Math.max(0, Math.min(document.documentElement.scrollHeight - innerHeight, top));
  cancelScroll();
  if (mode() !== "full" || document.hidden || Math.abs(to - from) < 2) { window.scrollTo({ top: to, behavior: "instant" }); return; }
  const control = animate(from, to, { ...spring.slow, onUpdate: value => window.scrollTo({ top: value, behavior: "instant" }) });
  scrollJob = control;
  void control.then(() => { if (scrollJob === control) scrollJob = null; });
}
function keepPlace(section: HTMLElement, top: number) {
  cancelScroll(); const current = epoch, route = document.getElementById("main")?.dataset.currentView;
  let remaining = 3;
  const fix = () => {
    placeFrame = 0;
    if (current !== epoch || !section.isConnected || section.closest<HTMLElement>("#usage")?.hidden || document.getElementById("main")?.dataset.currentView !== route) return;
    const delta = section.getBoundingClientRect().top - top;
    if (Math.abs(delta) > .5) window.scrollBy({ top: delta, behavior: "instant" });
    if (--remaining) placeFrame = requestAnimationFrame(fix);
  };
  fix();
}
function endDocumentAnimations() {
  for (const animation of document.getAnimations()) {
    if (animation.timeline !== document.timeline) continue;
    const effect = animation.effect as KeyframeEffect | null, target = effect?.target;
    if (target instanceof Element && target.closest("[data-ui-root], [data-ui-portal], #app") && Number.isFinite(effect?.getComputedTiming().endTime) && animation.playbackRate !== 0) animation.finish();
    else animation.cancel();
  }
}
const indicators = () => window.dispatchEvent(new Event("ui-shell-layout"));
function apply() { document.body.dataset.motion = mode(); endDocumentAnimations(); cancelScroll(); indicators(); window.dispatchEvent(new Event("ui-motion-change")); }
const motion = Object.freeze({
  get mode() { return mode(); }, get preference() { return preference; },
  get activeCount() { return document.getAnimations().filter(animation => animation.playState === "running" && animation.timeline === document.timeline && Number.isFinite(animation.effect?.getComputedTiming().endTime)).length; },
  setPreference(value: string) { preference = value === "off" || value === "reduced" ? value : "system"; try { localStorage.setItem(motionKey, preference); } catch { /* Session only. */ } apply(); },
  indicators,
  busy(element: HTMLElement | null, busy: boolean) { if (element) { element.setAttribute("aria-busy", String(busy)); element.toggleAttribute("data-busy", busy); } },
});
const scroll = Object.freeze({ scrollTo, keepPlace, cancelScroll, get activeCount() { return Number(Boolean(scrollJob)) + Number(Boolean(placeFrame)); } });
const keyboard = Object.freeze({ isComposing, guard, editable, restoreFocus, rove });
Object.assign(window, { uiMotion: motion, uiDetail: scroll, uiKeyboard: keyboard });
media.addEventListener("change", apply);
window.addEventListener("wheel", cancelScroll, { capture: true, passive: true });
window.addEventListener("pointerdown", cancelScroll, { capture: true, passive: true });
window.addEventListener("touchstart", cancelScroll, { capture: true, passive: true });
for (const name of ["resize", "ui-view-leave", "ui-scroll-cancel", "ui-motion-change"]) window.addEventListener(name, cancelScroll);
window.addEventListener("keydown", event => { if (!guard(event) && ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", "Escape", " "].includes(event.key)) cancelScroll(); });
document.addEventListener("visibilitychange", () => { document.body.toggleAttribute("data-page-hidden", document.hidden); if (document.hidden) { cancelScroll(); endDocumentAnimations(); } });
document.addEventListener("cancel", event => { guard(event); }, true);
window.addEventListener("unload", () => { cancelScroll(); media.removeEventListener("change", apply); });
apply();
