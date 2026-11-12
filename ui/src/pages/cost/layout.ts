import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

// Composition uses its measured width for the 400/600px chart layouts.
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
