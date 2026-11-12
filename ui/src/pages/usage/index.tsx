import { Activity as ReactActivity, memo, useEffect, useLayoutEffect, useRef } from "react";
import { IconDownload, IconRefresh } from "@tabler/icons-react";
import { AgentMark, Banner, Button, IconButton, PageHeader, Segmented } from "@ui/kit";
import { motionAllowed } from "@ui/data";
import { usePageStages } from "@ui/data/page-stages";
import { useUsageHost, type UsageUi, type UsageHost, type UsageSnapshot } from "@ui/data/usage-host";
import { Overview as OverviewView } from "./overview";
import { Activity as ActivityView } from "./activity";
import { Trend as TrendView } from "./trend";

// Busy/checkedAt belongs to the header. Unchanged facts must not reconcile all
// chart cells and model rows every five seconds. A new filter/data projection
// has a new view identity; an empty-state refresh button still follows busy.
type ContentProps = { host: UsageHost; snapshot: UsageSnapshot };
const sameFacts = (a:ContentProps,b:ContentProps) => a.host===b.host && a.snapshot.view===b.snapshot.view;
const Overview = memo(OverviewView,(a,b)=>sameFacts(a,b)&&a.showClients===b.showClients&&a.mountClients===b.mountClients&&(!b.snapshot.view.today.empty||a.snapshot.busy===b.snapshot.busy));
const Activity = memo(ActivityView,sameFacts), Trend = memo(TrendView,sameFacts);

const periods = [
  { value: "all", label: "累计" }, { value: "30", label: "30 天" },
  { value: "7", label: "7 天" }, { value: "today", label: "今日" },
];
export function UsagePage() {
  const { active, visible, mounted, reveal } = usePageStages("usage", 3);
  const host = useUsageHost(), root = useRef<HTMLDivElement>(null);
  const scheduled = useRef(0), held = useRef<{ element: HTMLElement; top: number } | null>(null);
  useEffect(() => {
    let locating = false;
    const interrupt = () => {
      cancelAnimationFrame(scheduled.current);
      held.current = null;
      if (!locating) return;
      locating = false;
      window.scrollTo({ top: window.scrollY, behavior: "instant" });
    };
    const finished = () => { locating = false; };
    const keyIntent = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
          (event.target as HTMLElement)?.closest?.("input,textarea,select,[contenteditable=true]")) return;
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) interrupt();
    };
    const locate: UsageUi["locate"] = target => {
      interrupt();
      reveal(target === "trend" ? 3 : 2);
      scheduled.current = requestAnimationFrame(() => {
        const element = root.current?.querySelector<HTMLElement>("[data-usage-" + target + "]");
        if (!element) return;
        locating = motionAllowed();
        element.scrollIntoView({ block: "start", behavior: locating ? "smooth" : "auto" });
        if (target === "day") element.focus({ preventScroll: true });
      });
    };
    window.addEventListener("wheel", interrupt, { passive: true, capture: true });
    window.addEventListener("touchstart", interrupt, { passive: true, capture: true });
    window.addEventListener("pointerdown", interrupt, true);
    window.addEventListener("keydown", keyIntent);
    window.addEventListener("scrollend", finished);
    window.addEventListener("ui-view-leave", interrupt);
    window.usageUi = Object.freeze({ filters: host.filters, render: host.invalidate, locate });
    return () => {
      interrupt();
      window.removeEventListener("wheel", interrupt, true);
      window.removeEventListener("touchstart", interrupt, true);
      window.removeEventListener("pointerdown", interrupt, true);
      window.removeEventListener("keydown", keyIntent);
      window.removeEventListener("scrollend", finished);
      window.removeEventListener("ui-view-leave", interrupt);
      delete window.usageUi;
    };
  }, [host, reveal]);
  useLayoutEffect(() => {
    const anchor = held.current;
    if (!active || !anchor?.element.isConnected) return;
    const delta = anchor.element.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) > .5) window.scrollBy({ top: delta, behavior: "instant" });
    held.current = null;
  });
  if (!active && mounted === 0) return null;
  const snapshot = host.get(), { state, view } = snapshot;
  const remember = () => {
    const section = document.activeElement?.closest<HTMLElement>("[data-usage-trend],[data-usage-activity]");
    if (section) held.current = { element: section, top: section.getBoundingClientRect().top };
  };
  return <ReactActivity mode={active ? "visible" : "hidden"}><div ref={root} className="flex w-full min-w-0 flex-col gap-6" data-usage-page
    onClickCapture={remember} onKeyDownCapture={remember}>
    <PageHeader title="用量" actions={
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div data-usage-periods>
          <Segmented value={state.period} onChange={period => host.set({ period })} items={periods} aria-label="统计时间范围" />
        </div>
        <div data-usage-refresh title={snapshot.busy ? "正在采集…" : "刷新统计"}>
          <IconButton icon={IconRefresh} label="刷新统计" disabled={snapshot.busy} onClick={() => void host.refresh()} />
        </div>
        <div data-usage-export title="导出统计">
          <IconButton icon={IconDownload} label="导出统计" onClick={host.export} />
        </div>
      </div>
    } />
    {snapshot.loading ? <Banner tone="info">{"正在读取本地统计…"}</Banner> : null}
    {snapshot.error ? <Banner tone="warn">{snapshot.error}</Banner> : null}
    {snapshot.recovery ? <Banner tone="warn">{snapshot.recovery}</Banner> : null}
    <Overview host={host} snapshot={snapshot} showClients={visible > 0} mountClients={mounted > 0} />
    {mounted > 1 ? <ReactActivity mode={visible > 1 ? "visible" : "hidden"}><Activity host={host} snapshot={snapshot} /></ReactActivity> : null}
    {mounted > 2 ? <ReactActivity mode={visible > 2 ? "visible" : "hidden"}><Trend host={host} snapshot={snapshot} />
    <section className="flex flex-wrap items-center gap-3" aria-label="采集来源" data-usage-sources>
      <Button variant="ghost" onClick={host.sources}>{"采集来源 "}{view.sourceCount}{" · Agent 管理"}</Button>
      {view.sourceMarks.map(source =>
        <span key={source.id} title={source.title} className={source.idle ? "text-muted-foreground" : "text-foreground"}>
          <AgentMark agent={source.id} variant="icon" size={20} />
        </span>
      )}
    </section></ReactActivity> : null}
  </div></ReactActivity>;
}
