import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

// The old cost-main container switches at 760px (cost.css). Observe its actual
// content width, including when the shared summary panel docks beside it.
export function useCostNarrow(enabled = true) {
  const ref = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false), measuredNarrow = useRef(false);
  useLayoutEffect(() => {
    if (!enabled) return;
    const element = ref.current;
    if (!element) return;
    const resize = new ResizeObserver(entries => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      if (width <= 0) return;
      const next = width <= 760;
      // The page only consumes the breakpoint. Resizing within the same band
      // must not synchronously reconcile all its charts and rows again.
      if (measuredNarrow.current === next) return;
      measuredNarrow.current = next; flushSync(() => setNarrow(next));
    });
    resize.observe(element);
    return () => resize.disconnect();
  }, [enabled]);
  return { ref, narrow };
}

// Composition also uses its actual width for the 400/600px layouts. Preserve
// that contract; the page shell above needs only the 760px breakpoint.
export function useCostWidth(enabled = true) {
  const ref = useRef<HTMLDivElement>(null), measuredWidth = useRef(0);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!enabled) return;
    const element = ref.current; if (!element) return;
    const observer = new ResizeObserver(entries => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next <= 0 || measuredWidth.current === next) return;
      measuredWidth.current = next; flushSync(() => setWidth(next));
    }); observer.observe(element);
    return () => observer.disconnect();
  }, [enabled]);
  return { ref, width, narrow: width > 0 && width <= 760 };
}
