import { useMemo } from "react";
import { AgentMark, WidgetDetails, WidgetGraph, widgetTone, type DetailRow } from "@ui/kit";
import { useUsage, useWidgetQuota } from "@ui/data/widget-data";
import { type WidgetProps, agentName, frame, short } from "./shared";

// Agent 图: this machine in the middle and each Agent it reads around it. An edge shows how reading that
// Agent goes (reading / needs attention / to refresh). It is not a call graph: the app records no calls.
export function AgentsGraph({ config }: WidgetProps) {
  const usage = useUsage(), { host, grid } = useWidgetQuota();
  const view = useMemo(() => {
    if (!usage) return null;
    const today = usage.today, m = host.model, states = new Map<string, { state: "ok" | "warn" | "stale"; reason: string | null }>();
    const recorded = new Set(usage.rows.map(row => row.agent));
    for (const source of usage.sources ?? []) {
      if (source.observedRecords > 0) recorded.add(source.agent);
      if (source.status === "error") states.set(source.agent, { state: "warn", reason: "读取出错" });
    }
    for (const entry of grid.live) {
      const agent = entry.item.agent; recorded.add(agent);
      if (entry.warn) states.set(agent, { state: "warn", reason: m.brief(entry.item.status.title || entry.item.status.text) });
      else if (!states.has(agent) && entry.item.quota && m.parts(entry.item.quota).percent.some(part => m.isStale(part.item))) states.set(agent, { state: "stale", reason: "额度待刷新" });
    }
    const todayTokens = (agent: string) => today ? usage.rows.filter(row => row.agent === agent && row.date === today).reduce((sum, row) => sum + row.totalTokens, 0) : 0;
    const models = new Set(usage.rows.filter(row => !today || row.date === today).map(row => row.model));
    const nodes = [...recorded].filter(agent => config.agent === "all" || agent === config.agent).map(agent => ({ agent, tokens: todayTokens(agent), ...(states.get(agent) ?? { state: "ok" as const, reason: null }) })).sort((a, b) => b.tokens - a.tokens);
    return { nodes, models: models.size, total: nodes.reduce((sum, node) => sum + node.tokens, 0), collecting: usage.collection.enabled };
  }, [usage, grid, host, config.agent]);
  if (!view || !view.nodes.length) return frame(config, { title: "Agent 图" }, <p className="text-caption text-muted-foreground" data-widget-empty>还没有读取到 Agent</p>);
  const tone = widgetTone(config.color, 1, config.color === "agent" ? "codex" : null);
  const rows: DetailRow[] = [
    ...view.nodes.filter(node => node.state !== "ok").map(node => ({ key: node.agent, lead: <AgentMark agent={node.agent} variant="icon" size={16} />, name: agentName(node.agent), value: node.reason ?? "" })),
    ...view.nodes.filter(node => node.state === "ok" && node.tokens).slice(0, 3).map(node => ({ key: node.agent, lead: <AgentMark agent={node.agent} variant="icon" size={16} />, name: agentName(node.agent), value: "今天 " + short(node.tokens) })),
  ];
  return frame(config, { title: "Agent 图", meta: <span><b className="font-semibold text-foreground">{view.nodes.length}</b> 个 Agent · <b className="font-semibold text-foreground">{view.models}</b> 个模型</span> }, <>
    <WidgetGraph tone={tone} aria-label={view.nodes.map(node => agentName(node.agent) + " " + (node.state === "warn" ? "需要处理" : node.state === "stale" ? "待刷新" : "读取中")).join("，")}
      nodes={view.nodes.map(node => ({ key: node.agent, lead: <AgentMark agent={node.agent} variant="icon" size={16} />, name: agentName(node.agent), sub: node.state === "ok" ? node.tokens ? short(node.tokens) : "今天无记录" : node.state === "warn" ? "需要处理" : "待刷新", state: node.state }))} flowing={view.collecting} />
    {config.size === "s" ? null : <WidgetDetails aria-label="Agent 明细" rows={rows} />}
  </>);
}
