import { useEffect, useRef, useState, type RefObject } from "react";
import { motion } from "motion/react";
import { flushSync } from "react-dom";
import { spring } from "./design/motion";
import { useKitMotion } from "./kit/motion-mode";
import { isComposing } from "./kit/ime";
import { views, viewNames } from "./app-store";
import { useQuotaGrid } from "./pages/quota/shared";

const icons = { quota: "layout-grid", usage: "chart-line", cost: "coin", sessions: "history", sources: "database", settings: "settings" };
type View = typeof views[number];
function SelectionIndicator({ parent, selected }: { parent: RefObject<HTMLElement | null>; selected: string }) {
  type Rect = { x: number; y: number; width: number; height: number };
  const [rects, setRects] = useState(new Map<string, Rect>()), { full } = useKitMotion();
  useEffect(() => {
    const root = parent.current; if (!root) return;
    const measure = () => {
      if (!root.getClientRects().length) return;
      const next = new Map<string, Rect>();
      for (const child of root.children) if (child instanceof HTMLElement && child.tagName === "BUTTON") {
        const key = child.dataset.view ?? child.dataset.filter; if (!key) continue;
        next.set(key, { x: child.offsetLeft, y: child.offsetTop, width: child.offsetWidth, height: child.offsetHeight });
      }
      // Selection uses already measured button geometry. A page change does
      // not synchronously lay out the newly mounted page just to move a pill.
      flushSync(() => setRects(previous => previous.size === next.size && [...next].every(([key, value]) => { const old = previous.get(key); return old && old.x === value.x && old.y === value.y && old.width === value.width && old.height === value.height; }) ? previous : next));
    };
    const observer = new ResizeObserver(measure); observer.observe(root);
    for (const child of root.children) if (child.tagName === "BUTTON") observer.observe(child);
    const children = new MutationObserver(() => { for (const child of root.children) if (child.tagName === "BUTTON") observer.observe(child); });
    children.observe(root, { childList: true });
    return () => { observer.disconnect(); children.disconnect(); };
  }, [parent]);
  const rect = rects.get(selected);
  if (!rect) return null;
  const { x, y, width, height } = rect;
  return full ? <motion.span aria-hidden="true" className="motion-indicator" initial={false} style={{ width, height }} animate={{ x, y }} transition={spring.moderate} /> :
    <span aria-hidden="true" className="motion-indicator" style={{ width, height, transform: `translate(${x}px,${y}px)` }} />;
}
export function Navigation({ view, collapsed, badges, onNavigate }: { view: View; collapsed: boolean; badges: Record<string, { count: number; title: string }>; onNavigate(view: View): void }) {
  const root = useRef<HTMLElement>(null);
  return <nav ref={root} aria-label="主导航" className="motion-group motion-ready">
    {views.map((name, index) => {
      const count = badges[name]?.count ?? 0, title = [collapsed ? viewNames[name] : "", count ? badges[name].title : ""].filter(Boolean).join(" · ");
      return <NavItem key={name} view={name} index={index} current={view === name} title={title} count={count} badgeTitle={count ? badges[name].title : undefined} onClick={() => onNavigate(name)} />;
    })}
    <SelectionIndicator parent={root} selected={view} />
  </nav>;
}
function NavItem({ view, index, current, title, count, badgeTitle, onClick }: { view: View; index: number; current: boolean; title: string; count: number; badgeTitle?: string; onClick(): void }) {
  return <>
    {index === 0 || index === 4 ? <span className="nav-caption" aria-hidden="true">{index === 0 ? "工作" : "管理"}</span> : null}
    <button data-view={view} aria-current={current ? "page" : undefined} title={title || undefined} data-badge-title={badgeTitle} data-shortcut={"Ctrl+" + (index + 1)} onClick={onClick}>
      <img src={"assets/ui/" + icons[view] + ".svg"} alt="" /><span className="nav-label">{view === "sources" ? "Agent" : viewNames[view]}</span>
      {view === "quota" || view === "sources" ? <span className="nav-badge" aria-hidden="true" hidden={!count}>{count > 99 ? "99+" : count || ""}</span> : null}
    </button>
  </>;
}
export function QuotaFilters() {
  const { host, grid } = useQuotaGrid(), root = useRef<HTMLDivElement>(null), selected = host.get().prefs.filter;
  const items = Object.entries(host.model.FILTERS).map(([value, filter]) => ({ value, label: filter.label, count: value === "idle" ? grid.visibleIdle.length : grid.shown.filter(filter.match).length }));
  return <div id="quotaFilter" ref={root} className="range-tabs motion-group motion-ready" role="group" aria-label="筛选卡片" onKeyDown={event => {
    if (isComposing(event) || event.altKey || event.ctrlKey || event.metaKey || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next]?.focus(); buttons[next]?.click();
  }}>
    {items.map(item => <button key={item.value} type="button" data-filter={item.value} aria-pressed={selected === item.value} tabIndex={selected === item.value ? 0 : -1}
      onClick={() => host.setPreference("filter", item.value as typeof selected)}>{item.label}<em>{item.count}</em></button>)}
    <SelectionIndicator parent={root} selected={selected} />
  </div>;
}
