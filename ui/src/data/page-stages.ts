import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { appShell } from "../app-store";
import type { ViewName } from "./types";

type Visit = ReturnType<typeof appShell.get>["visit"];

/** Paint the page's first screen before restoring off-screen sections on a top-of-page visit. */
export function usePageStages(page: ViewName, last: number) {
  const visit = useSyncExternalStore(appShell.subscribe, () => {
    const shell = appShell.get();
    return shell.view === page ? shell.visit : null;
  });
  const [progress, setProgress] = useState<{ visit: Visit; visible: number } | null>(null);
  const retained = useRef(0);
  const visible = !visit ? 0 : visit.restoreTop > 0 ? last : progress?.visit === visit ? progress.visible : 0;
  useLayoutEffect(() => { retained.current = Math.max(retained.current, visible); }, [visible]);
  const reveal = useCallback((atLeast: number) => {
    const shell = appShell.get();
    if (shell.view !== page) return;
    const target = shell.visit;
    setProgress(previous => {
      if (appShell.get().visit !== target) return previous;
      if (previous?.visit === target && previous.visible >= atLeast) return previous;
      return { visit: target, visible: atLeast };
    });
  }, [page]);
  useEffect(() => {
    if (!visit || visible >= last) return;
    let after = 0;
    const first = requestAnimationFrame(() => {
      after = requestAnimationFrame(() => {
        if (appShell.get().visit === visit) startTransition(() => reveal(visible + 1));
      });
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(after); };
  }, [visit, visible, last, reveal]);
  return { active: visit !== null, visible, mounted: Math.max(visible, retained.current), reveal };
}
