// The outer menu's width is the person's: dragged or set with the arrow keys between two limits, a double click returns to
// the default (owner 2026-11-02, docs/m2/UI-SESSIONS-MULTI-20261102.md). Remembered in this window's own storage only.
const KEY = "agentusage.sidebar.width.v1", MIN = 148, MAX = 280, DEFAULT = 176, STEP = 8;
const clamp = (value: number) => Math.min(MAX, Math.max(MIN, Math.round(value)));
function saved() { try { const value = Number(localStorage.getItem(KEY)); return value ? clamp(value) : null; } catch { return null; } }
function remember(value: number) { try { if (value === DEFAULT) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(value)); } catch { /* This visit only. */ } }

export function attachSidebarResize() {
  const bar = document.querySelector<HTMLElement>(".topbar"); if (!bar) return () => {};
  const root = document.documentElement, handle = document.createElement("div");
  let width = saved() ?? DEFAULT;
  const apply = () => {
    if (width === DEFAULT) root.style.removeProperty("--sidebar-width"); else root.style.setProperty("--sidebar-width", width + "px");
    handle.setAttribute("aria-valuenow", String(width));
  };
  handle.className = "sidebar-resizer"; handle.tabIndex = 0;
  handle.setAttribute("role", "separator"); handle.setAttribute("aria-orientation", "vertical"); handle.setAttribute("aria-label", "调整菜单宽度");
  handle.setAttribute("aria-valuemin", String(MIN)); handle.setAttribute("aria-valuemax", String(MAX)); handle.title = "拖动调整宽度，双击恢复默认";
  let grab: { id: number; offset: number } | null = null;
  const down = (event: PointerEvent) => { if (event.button !== 0) return; event.preventDefault(); grab = { id: event.pointerId, offset: event.clientX - width }; handle.setPointerCapture(event.pointerId); handle.dataset.dragging = ""; document.body.classList.add("sidebar-resizing"); };
  const move = (event: PointerEvent) => { if (grab?.id !== event.pointerId) return; width = clamp(event.clientX - grab.offset); apply(); };
  const up = (event: PointerEvent) => { if (grab?.id !== event.pointerId) return; grab = null; delete handle.dataset.dragging; document.body.classList.remove("sidebar-resizing"); remember(width); };
  const key = (event: KeyboardEvent) => {
    const next = event.key === "ArrowLeft" ? width - STEP : event.key === "ArrowRight" ? width + STEP : event.key === "Home" ? MIN : event.key === "End" ? MAX : null;
    if (next === null) return;
    event.preventDefault(); event.stopPropagation(); width = clamp(next); apply(); remember(width);
  };
  const reset = () => { width = DEFAULT; apply(); remember(width); };
  handle.addEventListener("pointerdown", down); handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
  handle.addEventListener("keydown", key); handle.addEventListener("dblclick", reset);
  bar.append(handle); apply();
  return () => { handle.remove(); root.style.removeProperty("--sidebar-width"); document.body.classList.remove("sidebar-resizing"); };
}
