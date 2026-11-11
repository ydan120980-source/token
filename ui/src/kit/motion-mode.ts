import { useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";

const listeners = new Set<() => void>();
let observer: MutationObserver | undefined;
const read = () => document.body.dataset.motion ?? "full";
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!observer) {
    observer = new MutationObserver(() => { for (const notify of listeners) notify(); });
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-motion"] });
  }
  return () => { listeners.delete(listener); if (!listeners.size) { observer?.disconnect(); observer = undefined; } };
}
// One body observer for the new kit components; no subscriptions survive their last unmount.
export function useKitMotion() {
  const mode = useSyncExternalStore(subscribe, read), reduced = useReducedMotion();
  // fade: reduced motion (the app setting or the system's) - no movement, changes cross-fade.
  return { mode, full: mode === "full" && !reduced, fade: mode === "reduced" || mode === "full" && Boolean(reduced) };
}
