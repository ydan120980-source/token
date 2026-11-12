import { Activity as ReactActivity, memo, useCallback, useEffect, useRef, useState } from "react";
import { IconDownload } from "@tabler/icons-react";
import {
  AgentFilter, IconButton, PageHeader, PaneGroup, ScrollArea, Segmented, SubTabs,
} from "@ui/kit";
import { motionAllowed } from "@ui/data";
import { usePageStages } from "@ui/data/page-stages";
import { useCostHost, type CostUi } from "@ui/data/cost-host";
import { CostHeroView } from "./hero";
import { Composition, Months, Trend } from "./charts";
import { Subscriptions } from "./subscriptions";
import { CostTableView } from "./table";
import { Checks } from "./checks";
import { DetailSheet } from "./detail";
import { AttentionNotice, Projects } from "./projects";

const Hero = memo(CostHeroView), TrendPanel = memo(Trend);
const showCoverage = () => window.costUi?.locate("coverage");

// 费用 on the shared kit (owner 2026-10-27: one kit for every page; the cost page's own
// reference styling retired 2026-10-28, UI-COST-KIT-20261028.md).
export function CostPage() {
  const { active, visible, mounted, reveal: revealSections } = usePageStages("cost", 3);
  const host = useCostHost(), ref = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState(0), scheduled = useRef(0);
  const [waiting, setWaiting] = useState<string | null>(null);
  const visibleStage = useRef(visible);
  visibleStage.current = visible;
  const reveal = useCallback((target: string) => {
    if (window.appShell.get().view !== "cost") return;
    if (target !== "analysis" && target !== "month" && visibleStage.current < 3) { setWaiting(target); return; }
    const element = target === "analysis" ? ref.current :
      ref.current?.querySelector<HTMLElement>('[data-cost-section="' + target + '"]');
    // A target below the first screen is not there yet on the frame it is asked for; it is placed
    // as soon as that frame's mount lands rather than being scrolled to nowhere.
    setWaiting(null);
    element?.scrollIntoView({ block: "start", behavior: motionAllowed() ? "smooth" : "auto" });
  }, [ref]);
  useEffect(() => {
    if (!active || waiting === null) return undefined;
    const frame = requestAnimationFrame(() => reveal(waiting));
    return () => cancelAnimationFrame(frame);
  }, [active, waiting, visible, reveal]);
  useEffect(() => {
    const locate: CostUi["locate"] = target => {
      setSection(0);
      if (target === "month") host.set({ heroSlide: "month" });
      if (target === "composition") host.set({ panelTab: "composition", panel: "both" });
      if (target !== "analysis" && target !== "month") revealSections(3);
      cancelAnimationFrame(scheduled.current);
      scheduled.current = requestAnimationFrame(() => reveal(target));
    };
    const ui: CostUi = Object.freeze({
      render: host.invalidate, state: host.state, projects: () => setSection(1), analysis: () => setSection(0), locate,
      agent: (id: string) => { host.set({ agents: new Set([id]), open: null }); locate("analysis"); },
    });
    window.costUi = ui;
    window.costPage = Object.freeze({ render: ui.render, state: ui.state });
    const leave = () => { cancelAnimationFrame(scheduled.current); setWaiting(null); };
    window.addEventListener("ui-view-leave", leave);
    return () => {
      cancelAnimationFrame(scheduled.current);
      window.removeEventListener("ui-view-leave", leave);
      delete window.costUi;
      delete window.costPage;
    };
  }, [host, reveal, revealSections]);
  const snapshot = host.get(), { state, folds, view } = snapshot;
  return <ReactActivity mode={active ? "visible" : "hidden"}><div ref={ref} className="flex flex-col gap-6" data-cost-page>
    <PageHeader
      title="费用"
      inlineActions={<SubTabs value={section} onChange={setSection} items={["费用分析", "项目与预算"]} idPrefix="cost-sections" />}
      actions={section === 0 ?
        <IconButton icon={IconDownload} label="导出费用 CSV" disabled={snapshot.exporting} onClick={() => void host.export()} /> : null} />
    {section === 0 ?
      <div className="flex flex-col gap-6" data-cost-analysis data-range-open={folds.rail ? "" : undefined}>
        <Hero host={host} snapshot={snapshot} onCoverage={showCoverage} />
        <div className="flex items-center justify-between gap-3" data-cost-agents>
          <AgentFilter agents={view.agents} value={state.agents ? [...state.agents][0] : "all"}
            onChange={host.chooseAgent} display="icon" aria-label="费用 Agent 筛选" />
          <span className="text-caption text-muted-foreground">
            {state.agents ? [...state.agents].map(host.model.agentName).join("、") : "全部 Agent"}
          </span>
        </div>
        {mounted > 0 ? <ReactActivity mode={visible > 0 ? "visible" : "hidden"}><TrendPanel host={host} snapshot={snapshot} /></ReactActivity> : null}
        {mounted > 1 ? <ReactActivity mode={visible > 1 ? "visible" : "hidden"}><div data-cost-duo>
          <PaneGroup
            collapsed={state.panel === "both" ? null : state.panel === "where" ? "months" : "where"}
            onCollapsedChange={key => host.set({ panel: key === null ? "both" : key === "months" ? "where" : "months" })}
            panes={[
              {
                key: "where", title: "花在哪",
                actions: <Segmented value={state.panelTab} onChange={panelTab => host.set({ panelTab })} size="compact"
                  items={[{ value: "composition", label: "费用构成" }, { value: "subscriptions", label: "订阅对照" }]}
                  aria-label="花在哪视图" />,
                fixed: true, // The ring stays; only the Agents under it scroll.
                node: <>
                  <Composition host={host} snapshot={snapshot} hidden={state.panelTab !== "composition"} />
                  <div className="flex min-h-0 flex-1 flex-col" hidden={state.panelTab !== "subscriptions"}>
                    <ScrollArea maxHeight="fill" aria-label="订阅对照"><Subscriptions host={host} snapshot={snapshot} /></ScrollArea>
                  </div>
                </>,
              },
              { key: "months", title: "按月", node: <Months host={host} snapshot={snapshot} /> },
            ]} />
        </div></ReactActivity> : null}
        {mounted > 2 ? <ReactActivity mode={visible > 2 ? "visible" : "hidden"}><CostTableView host={host} snapshot={snapshot} />
        <Checks host={host} snapshot={snapshot} />
        <AttentionNotice kind="cost" /></ReactActivity> : null}
      </div> :
      <Projects />}
    <DetailSheet detail={active ? view.detail : null} host={host} />
  </div></ReactActivity>;
}
