import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";

const SettledContext = createContext(false);
/** Whether this subtree is a page coming back into view: charts start settled instead of entering again. */
export function useSettled() { return useContext(SettledContext); }

/**
 * A page that renders nothing while hidden (to keep its tree out of memory) remounts on every visit. Like a tab
 * bar keeps its views alive, only the first visit plays the entry motion; later visits start settled
 * (Motion initial animations are skipped, kit plots start entered). Data changes while shown still animate.
 */
export function ViewContent({ active, children }: { active: boolean; children: ReactNode }) {
  const shown = useRef(false), [settled, setSettled] = useState(false);
  useEffect(() => { if (active) shown.current = true; else if (shown.current) setSettled(true); }, [active]);
  if (!active) return null;
  return <SettledContext.Provider value={settled}>
    <AnimatePresence initial={!settled}><div key="view" className="contents">{children}</div></AnimatePresence>
  </SettledContext.Provider>;
}
