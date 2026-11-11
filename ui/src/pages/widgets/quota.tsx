import { IconArrowUpRight, IconEye, IconEyeOff } from "@tabler/icons-react";
import { AgentMark, IconButton, WidgetCells, WidgetDetails, WidgetFigure, WidgetLanes, WidgetPill, WidgetShares, widgetTone, type DetailRow } from "@ui/kit";
import { showView } from "@ui/data";
import type { QuotaDial, QuotaGrid, QuotaHost } from "@ui/data/quota-host";
import { changeWidgets } from "@ui/data/widgets";
import { useWidgetQuota as useQuotaGrid } from "@ui/data/widget-data";
import { type WidgetProps, frame } from "./shared";

const RANGES: Record<string, { span: number; axis: string[] }> = {
  "24h": { span: 864e5, axis: ["现在", "12 小时", "24 小时"] },
  "7d": { span: 7 * 864e5, axis: ["现在", "3 天", "7 天"] },
};
const dialsOf = (grid: QuotaGrid, agent: string) => (grid.hero?.now?.dials ?? []).filter(dial => agent === "all" || dial.agent === agent);
const time = (at: number) => { const value = new Date(at); return String(value.getHours()).padStart(2, "0") + ":" + String(value.getMinutes()).padStart(2, "0"); };
const dialName = (dial: QuotaDial) => dial.name + (dial.sub ? " · " + dial.sub : "");

/** The title bar readout of a quota widget: the first matching account's windows, in a few characters. */
export function quotaReadout(grid: QuotaGrid, agent: string): { agent: string; text: string; label: string } | null {
  const dial = dialsOf(grid, agent)[0];
  if (!dial) return null;
  const text = dial.windows.slice(0, 2).map(window => window.label.replace(" 小时", "h").replace("每周", "周") + " " + window.text).join(" · ");
  return { agent: dial.agent, text, label: dialName(dial) + "：" + dial.windows.map(window => window.label + " " + window.text).join("，") };
}

function Empty({ host }: { host: QuotaHost }) {
  return <p className="text-caption text-muted-foreground" data-widget-empty>{host.get().state.accounts.length || host.get().providerState?.accounts.length ? "没有额度窗口" : "还没有连接额度"}</p>;
}

// 额度窗口: each account's windows as cell bars with when they reset; a row per window opens to time and quota used.
export function QuotaWindows({ config }: WidgetProps) {
  const { host, grid } = useQuotaGrid(), hero = grid.hero, dials = dialsOf(grid, config.agent), shown = dials.slice(0, config.size === "l" ? 6 : config.size === "m" ? 2 : 3);
  const word = host.get().prefs.measure === "used" ? "已用" : "剩余";
  const eye = <IconButton icon={config.readout ? IconEye : IconEyeOff} size="compact" label={config.readout ? "标题栏显示中" : "在标题栏显示"} onClick={() => changeWidgets((m, s) => m.update(s, config.key, { readout: !config.readout }))} />;
  const rows: DetailRow[] = dials.flatMap(dial => dial.windows.map((window, index) => ({
    key: dial.account + dial.sub + index, lead: <AgentMark agent={dial.agent} variant="icon" size={16} />, name: dialName(dial) + " · " + window.label,
    value: window.state === "stale" ? "待刷新" : window.state === "out" ? "已用完" : word + " " + window.text,
    sub: window.time === null ? [] : [{ key: "time", name: "时间已过", value: Math.round((1 - (host.get().prefs.measure === "used" ? 1 - window.time : window.time)) * 100) + "%", fraction: 1 - (host.get().prefs.measure === "used" ? 1 - window.time : window.time), tone: widgetTone(config.color, 0, dial.agent) },
      ...window.value === null ? [] : [{ key: "used", name: word, value: window.text, fraction: window.value / 100, tone: widgetTone(config.color, 0, dial.agent) }]],
  })));
  return frame(config, { title: "额度窗口", sub: word, accent: dials[0]?.agent, meta: config.size === "s" ? null : eye }, !hero || !dials.length ? <Empty host={host} /> : config.size === "s" ?
    <div className="flex flex-col gap-2">{shown.map(dial => <div key={dial.account + dial.sub} className="flex items-center gap-2 text-body">
      <AgentMark agent={dial.agent} variant="icon" size={16} /><span className="min-w-0 flex-1 truncate">{dialName(dial)}</span>
      <span className="shrink-0 text-caption tabular-nums text-muted-foreground">{dial.windows.map(window => window.label + " " + window.text).join(" · ")}</span>
    </div>)}</div> : <>
    {shown.map((dial, at) => <div key={dial.account + dial.sub} className="flex flex-col gap-2" data-widget-account={dial.agent}>
      <span className="flex items-center gap-2 text-body font-semibold"><AgentMark agent={dial.agent} variant="icon" size={16} />{dialName(dial)}</span>
      {dial.windows.map(window => <div key={window.label} className="flex flex-col gap-1">
        <span className="flex justify-between gap-2 text-caption text-muted-foreground"><span>{window.label}</span><span className="tabular-nums">{window.state === "stale" ? <b className="font-semibold text-foreground">待刷新</b> : <>{word} <b className="font-semibold text-foreground">{window.text}</b></>}</span></span>
        <WidgetCells count={40} on={window.value === null ? null : window.value / 100 * 40} tone={widgetTone(config.color, at, dial.agent)} hatched={window.state === "stale"} aria-label={dialName(dial) + " " + window.label + " " + word + " " + window.text} />
        {window.at ? <span className="text-micro text-muted-foreground">{hero.clock(window.at)} 恢复</span> : null}
      </div>)}
    </div>)}
    {config.size === "l" ? <WidgetDetails rows={rows} aria-label="额度窗口明细" /> : null}
  </>);
}

/** Every window that will reset among the shown cards, soonest first: when, which, and how far it has run. */
function resets(host: QuotaHost, grid: QuotaGrid, agent: string) {
  const m = host.model, now = Date.now();
  const found: { at: number; who: string; agent: string; label: string; text: string; elapsed: number | null; span: number | null }[] = [];
  for (const entry of grid.shown) {
    if (agent !== "all" && entry.item.agent !== agent) continue;
    for (const part of m.parts(entry.item.quota).percent) {
      const item = part.item, at = Date.parse(item.resetsAt ?? "");
      if (m.isStale(item) || !Number.isFinite(at) || at <= now || item.state === "unlimited") continue;
      const span = Number.isFinite(item.durationMins) && item.durationMins! > 0 ? item.durationMins! * 60000 : null;
      found.push({ at, agent: entry.item.agent, who: m.displayName(entry.key, entry.capability.name), label: part.label, text: m.percentOf(item).text, span, elapsed: span === null ? null : Math.max(0, Math.min(span, span - (at - now))) });
    }
  }
  return found.sort((a, b) => a.at - b.at);
}
export function nextReset(host: QuotaHost, grid: QuotaGrid, agent: string) { return resets(host, grid, agent)[0] ?? null; }
// 下一次恢复: the time large, the window's elapsed share in cells, then what comes after.
export function QuotaNext({ config }: WidgetProps) {
  const { host, grid } = useQuotaGrid(), m = host.model, [next = null, ...others] = resets(host, grid, config.agent), hero = grid.hero, later = others.slice(0, 3);
  return frame(config, { title: "下一次恢复", accent: next?.agent, meta: next ? <WidgetPill>{m.span(next.at - Date.now())}后</WidgetPill> : null }, !next || !hero ? <Empty host={host} /> : <>
    {config.size === "s" ? <span className="flex items-center gap-2 text-body"><AgentMark agent={next.agent} variant="icon" size={16} /><span className="flex-1 font-semibold tabular-nums">{m.clock(next.at)}</span><span className="text-caption text-muted-foreground">{next.who} {next.label}</span></span> : <>
      <WidgetFigure value={time(next.at)} after={m.clock(next.at).replace(/\s*\d{1,2}:\d{2}$/, "")} />
      <span className="flex items-center gap-2 text-body"><AgentMark agent={next.agent} variant="icon" size={16} /><span className="min-w-0 flex-1 break-words">{next.who} · {next.label}</span></span>
      {next.span && next.elapsed !== null ? <>
        <WidgetCells count={30} on={next.elapsed / next.span * 30} tone={widgetTone(config.color, 0, next.agent)} aria-label={"窗口已过 " + Math.round(next.elapsed / next.span * 100) + "%"} />
        <span className="flex justify-between text-micro text-muted-foreground"><span>窗口已过 {m.span(next.elapsed)}</span><span>共 {m.span(next.span)}</span></span>
      </> : null}
      <WidgetDetails aria-label="之后的恢复" rows={later.map(item => ({ key: item.who + item.label + item.at, lead: <AgentMark agent={item.agent} variant="icon" size={16} />, name: item.label.includes("·") ? item.label : item.who + " · " + item.label, wrap: true, value: m.clock(item.at) }))} />
    </>}
  </>);
}

// 接下来: one lane per window of each account on a 24-hour or 7-day axis.
export function QuotaUpcoming({ config }: WidgetProps) {
  const { host, grid } = useQuotaGrid(), hero = grid.hero, range = RANGES[config.period ?? "7d"] ?? RANGES["7d"], now = Date.now();
  const lanes = (hero?.next?.lanes ?? []).filter(lane => config.agent === "all" || lane.agent === config.agent).slice(0, config.size === "l" ? 10 : config.size === "m" ? 5 : 3);
  return frame(config, { title: "接下来", sub: config.period === "24h" ? "24 小时" : "7 天", accent: lanes[0]?.agent }, !lanes.length || !hero ? <Empty host={host} /> :
    <WidgetLanes aria-label="接下来的恢复和到期" axis={range.axis} lanes={lanes.map((lane, index) => ({
      key: lane.account + lane.sub + index, lead: <AgentMark agent={lane.agent} variant="icon" size={16} />, name: lane.sub || lane.name, tone: widgetTone(config.color, 0, lane.agent), muted: lane.kind === "stale",
      band: lane.at ? (lane.at - now) / range.span : null,
      marks: lane.kind === "expiry" ? (lane.marks ?? []).filter(mark => mark.at - now <= range.span).map(mark => ({ key: String(mark.at), at: (mark.at - now) / range.span, kind: "expiry" as const, label: hero.day(mark.at) + " 到期 " + mark.text }))
        : lane.at && lane.at - now <= range.span ? [{ key: "reset", at: (lane.at - now) / range.span, kind: "reset" as const, label: hero.clock(lane.at) + " 恢复" }] : [],
    }))} />);
}

// 连接状态: one block per state, sized by how many connections are in it; each state's row lists them.
export function QuotaStatus({ config }: WidgetProps) {
  const { host, grid } = useQuotaGrid(), m = host.model;
  const live = grid.live.filter(entry => config.agent === "all" || entry.item.agent === config.agent), idle = grid.idle.filter(entry => config.agent === "all" || entry.capability.provider === config.agent);
  const stale = (entry: QuotaGrid["live"][number]) => !entry.item.quota || m.outdated(entry.item.quota) || m.parts(entry.item.quota).percent.some(part => m.isStale(part.item));
  const name = (entry: QuotaGrid["live"][number]) => m.displayName(entry.key, entry.capability.name);
  const groups = [
    { key: "ok", label: "正常", tone: widgetTone(config.color, 0, "codex"), names: live.filter(entry => !entry.warn && !stale(entry)).map(name) },
    { key: "warn", label: "需要处理", tone: "warn" as const, names: live.filter(entry => entry.warn).map(entry => name(entry) + " · " + m.brief(entry.item.status.title || entry.item.status.text)) },
    { key: "stale", label: "待刷新", tone: widgetTone(config.color, 3, null), names: live.filter(entry => !entry.warn && stale(entry)).map(name) },
    { key: "idle", label: "未连接", tone: "muted" as const, names: idle.map(entry => entry.capability.name) },
  ];
  const warned = groups[1].names.length, total = live.length + idle.length;
  return frame(config, { title: "连接状态", sub: total + " 个 Agent", meta: config.size === "s" ? warned ? <WidgetPill tone="warn">{warned} 个需要处理</WidgetPill> : null : <IconButton icon={IconArrowUpRight} size="compact" label="打开额度" onClick={() => showView("quota")} /> }, !total ? <Empty host={host} /> : <>
    <WidgetShares tall={config.size !== "s"} aria-label={groups.map(group => group.label + " " + group.names.length).join("，")} segments={groups.map(group => ({ key: group.key, value: group.names.length, tone: group.tone, hatched: group.key === "stale", label: group.label + " " + group.names.length }))} />
    {config.size === "s" ? null : <WidgetDetails aria-label="各状态的连接" rows={groups.filter(group => group.names.length).map(group => ({
      key: group.key, tone: group.tone, name: group.label, value: group.names.length, open: group.key === "warn",
      sub: group.names.map((item, index) => ({ key: String(index), name: item, value: "" })),
    }))} />}
  </>);
}
