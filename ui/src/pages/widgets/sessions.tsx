import { useMemo } from "react";
import { IconArrowUpRight } from "@tabler/icons-react";
import { AgentMark, IconButton, WidgetDetails, WidgetPill, WidgetSpans, widgetTone, type DetailRow } from "@ui/kit";
import { getGlobals, showView } from "@ui/data";
import { useSessions, useWidgetQuota } from "@ui/data/widget-data";
import { type WidgetProps, frame, money, percent, short } from "./shared";

const KINDS = [["inputUncached", "输入"], ["output", "输出"], ["cacheRead", "缓存读取"], ["cacheWrite", "缓存写入"]] as const;
const clock = (iso: string) => { const at = new Date(iso); return String(at.getHours()).padStart(2, "0") + ":" + String(at.getMinutes()).padStart(2, "0"); };
const length = (start: string, end: string) => { const mins = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000)); return mins < 60 ? mins + " 分" : Math.floor(mins / 60) + " 小时" + (mins % 60 ? " " + mins % 60 + " 分" : ""); };

// 最近会话: the latest sessions, newest first; a session opens in place to its Token and how they split by kind.
export function SessionsRecent({ config }: WidgetProps) {
  const list = useSessions(), labels = window.sessionsHost?.labels() ?? {};
  const count = window.sessionsHost?.count({ agent: config.agent }) ?? null;
  const view = useMemo(() => {
    if (!list) return null;
    const all = list.sessions.filter(session => config.agent === "all" || session.agent === config.agent).sort((a, b) => b.end.localeCompare(a.end));
    return { rows: all.slice(0, config.size === "s" ? 2 : config.size === "l" ? 5 : 3).map(session => {
      const total = session.days.reduce((sum, day) => sum + day.totalTokens, 0), priced = session.days.filter(day => day.estimatedCostUsd !== null);
      const kinds = KINDS.map(([field, name]) => { const known = session.days.filter(day => day[field] !== null); return { field, name, value: known.length ? known.reduce((sum, day) => sum + day[field]!, 0) : null }; });
      return { session, total, cost: priced.length ? priced.reduce((sum, day) => sum + day.estimatedCostUsd!, 0) : null, kinds, known: kinds.reduce((sum, item) => sum + (item.value ?? 0), 0) };
    }) };
  }, [list, config.agent, config.size]);
  const open = <IconButton icon={IconArrowUpRight} size="compact" label="打开会话" onClick={() => showView("sessions")} />;
  if (!view || !view.rows.length) return frame(config, { title: "最近会话", meta: open }, <p className="text-caption text-muted-foreground" data-widget-empty>{view ? "还没有会话" : window.sessionsHost?.recentFailed() ? "会话读取失败，下次更新时重试" : "正在读取会话"}</p>);
  return frame(config, { title: "最近会话", sub: count !== null ? "今天 " + count + " 个" : undefined, meta: open },
    <WidgetDetails aria-label="最近会话" rows={view.rows.map((row, index): DetailRow => ({
      key: row.session.key, open: config.size !== "s" && index === 0,
      lead: <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2"><AgentMark agent={row.session.agent} variant="icon" size={16} /></span>,
      name: <span className="flex min-w-0 flex-col"><span className="truncate">{labels[row.session.key]?.alias || row.session.title || row.session.project || "未知项目"}</span><span className="truncate text-caption text-muted-foreground">{(row.session.models[0] ?? "模型未记录") + " · " + length(row.session.start, row.session.end)}</span></span>,
      value: <span className="flex flex-col items-end">{row.cost === null ? <WidgetPill tone="warn">未计价</WidgetPill> : money(row.cost)}<span className="text-caption font-normal text-muted-foreground">{clock(row.session.end)}</span></span>,
      sub: [{ key: "tokens", name: "Token", value: short(row.total) }, ...row.kinds.map((kind, at) => ({ key: kind.field, name: kind.name, value: kind.value === null ? "未报告" : percent(kind.value, row.known), fraction: kind.value === null || !row.known ? null : kind.value / row.known, tone: widgetTone(config.color === "agent" ? "mono" : config.color, at) }))],
    }))} />);
}

// 当前窗口里的会话 (SESSIONS-NEXT-20261101.md items 2 and 3): each Agent's shortest current quota window, from
// its start (reset minus its length) to its reset as the service reports them, and the sessions that ran in it.
// The used share is the service's own figure; nothing is projected. A session opens in the reading view.
const HOUR = 36e5;
export function SessionsWindow({ config }: WidgetProps) {
  const list = useSessions(), { host, grid } = useWidgetQuota(), m = host.model, catalog = getGlobals().agentCatalog.agents;
  const labels = window.sessionsHost?.labels() ?? {}, now = Date.now();
  const view = useMemo(() => {
    const windows = new Map<string, { agent: string; label: string; start: number; reset: number; used: number | null }>();
    for (const entry of grid.live) {
      const agent = entry.item.agent;
      if (config.agent !== "all" && agent !== config.agent) continue;
      for (const part of m.parts(entry.item.quota).percent) {
        const item = part.item, reset = Date.parse(item.resetsAt ?? ""), length = (item.durationMins ?? 0) * 6e4;
        if (m.isStale(item) || !Number.isFinite(reset) || !length || reset <= now || reset - length > now) continue;
        const known = windows.get(agent);
        if (!known || length < known.reset - known.start) windows.set(agent, { agent, label: part.label, start: reset - length, reset,
          used: item.usedPercent ?? (item.remainingPercent === null ? null : 100 - item.remainingPercent) });
      }
    }
    const lanes = [...windows.values()].sort((a, b) => a.reset - b.reset).slice(0, config.size === "l" ? 5 : config.size === "m" ? 3 : 2);
    if (!lanes.length) return null;
    const from = Math.max(now - 12 * HOUR, Math.min(...lanes.map(lane => lane.start))), to = Math.max(now + HOUR / 2, Math.min(now + 12 * HOUR, Math.max(...lanes.map(lane => lane.reset))));
    const at = (time: number) => (time - from) / (to - from);
    const clockAt = (time: number) => { const value = new Date(time); return String(value.getHours()).padStart(2, "0") + ":" + String(value.getMinutes()).padStart(2, "0"); };
    return { now: at(now), axis: [0, 1, 2, 3].map(index => clockAt(from + (to - from) * index / 3)), lanes: lanes.map((lane, index) => {
      const sessions = (list?.sessions ?? []).filter(session => session.agent === lane.agent && Date.parse(session.end) > lane.start && Date.parse(session.start) < now);
      return { key: lane.agent, lead: <AgentMark agent={lane.agent} variant="icon" size={16} />, name: catalog[lane.agent]?.name ?? lane.agent,
        sub: (config.size === "s" ? "" : lane.label + " · ") + (lane.used === null ? "已用未知" : "已用 " + Math.round(lane.used) + "%") + (config.size === "s" ? "" : " · " + clockAt(lane.reset) + " 恢复"),
        tone: widgetTone(config.color, index, lane.agent), band: { from: at(lane.start), to: at(lane.reset) },
        spans: sessions.map(session => {
          const name = labels[session.key]?.alias || session.title || session.project || "未知项目", start = Math.max(from, Date.parse(session.start)), end = Math.max(start + 6e4, Date.parse(session.end));
          const tokens = session.days.reduce((sum, day) => sum + day.totalTokens, 0), live = now - Date.parse(session.end) < HOUR;
          return { key: session.key, from: at(start), to: at(end), live, label: name + " " + clock(session.start) + "–" + clock(session.end),
            readout: name + " · " + clock(session.start) + "–" + clock(session.end) + (live ? " · 进行中" : "") + " · " + short(tokens) + " Token",
            onSelect: () => { showView("sessions"); requestAnimationFrame(() => { if (window.sessionsHost?.readable(session.agent)) window.sessionsHost.read({ ...session, name }); else window.sessionsHost?.drillDown(session.agent, "today"); }); } };
        }) };
    }) };
  }, [list, grid, config.agent, config.size, config.color, labels]);
  const open = <IconButton icon={IconArrowUpRight} size="compact" label="打开会话" onClick={() => showView("sessions")} />;
  if (!view) return frame(config, { title: "当前窗口里的会话", meta: open }, <p className="text-caption text-muted-foreground" data-widget-empty>{list ? "还没有服务商报告的额度窗口" : "正在读取会话"}</p>);
  const count = view.lanes.reduce((sum, lane) => sum + lane.spans.length, 0);
  return frame(config, { title: "当前窗口里的会话", meta: open },
    <WidgetSpans aria-label="当前额度窗口里的会话" lanes={view.lanes} axis={view.axis} now={view.now} summary={count ? count + " 个会话" : "窗口里还没有会话"} />);
}
