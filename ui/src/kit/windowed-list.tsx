import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

type Watch = (node: HTMLElement, changed: (near: boolean) => void) => () => void;
const WindowContext = createContext<Watch | null>(null);

// A window-local layout registry, not a transcript cache. One observer per pane;
// only nearby turn bodies mount. Numeric heights keep scrolling/jumps stable.
export function WindowedList({ root, enabled, children }: { root: RefObject<HTMLDivElement | null>; enabled: boolean; children: ReactNode }) {
  const registry = useMemo(() => ({ observer: null as IntersectionObserver | null, entries: new Map<HTMLElement, (near: boolean) => void>() }), []);
  const watch = useMemo<Watch>(() => (node, changed) => {
    registry.entries.set(node, changed); registry.observer?.observe(node);
    return () => { registry.observer?.unobserve(node); registry.entries.delete(node); };
  }, [registry]);
  useLayoutEffect(() => {
    if (!enabled) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) registry.entries.get(entry.target as HTMLElement)?.(entry.isIntersecting);
    }, { root: root.current, rootMargin: "1000px 0px" });
    registry.observer = observer; for (const node of registry.entries.keys()) observer.observe(node);
    return () => { registry.observer = null; observer.disconnect(); };
  }, [registry, root, enabled]);
  return <WindowContext.Provider value={enabled ? watch : null}>{children}</WindowContext.Provider>;
}

export function WindowedItem({ index, pinned, estimate = 560, attributes = {}, className = "", children }: { index: number; pinned: boolean; estimate?: number; attributes?: { [key: `data-${string}`]: string | number | boolean | undefined }; className?: string; children: ReactNode }) {
  const watch = useContext(WindowContext), ref = useRef<HTMLDivElement>(null), height = useRef(estimate);
  const [near, setNear] = useState(index < 2), draw = !watch || near || pinned;
  useLayoutEffect(() => {
    const node = ref.current; if (!node || !watch) return;
    return watch(node, visible => {
      // Do not take focused controls or a person's selection out from under them.
      if (!visible && (node.contains(document.activeElement) || window.getSelection()?.containsNode(node, true))) return;
      setNear(visible);
    });
  }, [watch]);
  useLayoutEffect(() => {
    const node = ref.current; if (!node || !draw || !watch) return;
    const observer = new ResizeObserver(entries => { const value = entries[0]?.contentRect.height; if (value > 0) height.current = value; });
    observer.observe(node); return () => observer.disconnect();
  }, [draw, watch]);
  return <div ref={ref} {...attributes} data-windowed-item={index} data-windowed-drawn={draw ? "true" : "false"} className={"flex flex-col " + className} style={draw ? undefined : { height: height.current }}>
    {draw ? children : null}
  </div>;
}
