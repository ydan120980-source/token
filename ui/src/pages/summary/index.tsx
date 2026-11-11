import { useMemo, type ReactNode } from "react";
import { AgentMark, BarChart, Figure, StackBar, widgetTone, type ChartTone } from "@ui/kit";
import type { UsageRow } from "@ui/data";
import { useSessions, useUsage, useWidgetQuota } from "@ui/data/widget-data";
import { ago } from "../../app-shell";
import { agentName, money, short } from "../widgets/shared";
import { nextReset } from "../widgets/quota";
import { usePricing } from "../settings/pricing/store";

// The right column (owner 2026-10-29, docs/m2/UI-POLISH-M10-20261029.md): one large card per page with that
// page's essentials, read-only, drawn directly from the saved facts the page reads. It does not reuse the
// home page's widgets. Sections are spaced, never ruled; unknown and unpriced never read as zero.

const tone = (agent: string, index: number): ChartTone => widgetTone("agent", index, agent);
const tokens = (rows: UsageRow[]) => rows.reduce((sum, row) => sum + row.totalTokens, 0);
const cost = (rows: UsageRow[]) => { const known = rows.filter(row => row.estimatedCostUsd !== null); return known.length ? known.reduce((sum, row) => sum + row.estimatedCostUsd!, 0) : null; };
const KINDS = [["inputUncached", "输入"], ["output", "输出"], ["cacheRead", "缓存读取"], ["cacheWrite", "缓存写入"]] as const;
/** A kind of Token over the rows that report it; null when none does, which reads 未报告 and never 0. */
const kindSum = (rows: UsageRow[], field: typeof KINDS[number][0]) => { const known = rows.filter(row => row[field] !== null); return known.length ? known.reduce((sum, row) => sum + row[field]!, 0) : null; };
const unpriced = (rows: UsageRow[]) => rows.filter(row => row.estimatedCostUsd === null).reduce((sum, row) => sum + row.totalTokens, 0);
const shift = (day: string, by: number) => { const at = new Date(day + "T12:00:00Z"); at.setUTCDate(at.getUTCDate() + by); return at.toISOString().slice(0, 10); };
const md = (day: string) => Number(day.slice(5, 7)) + " 月 " + Number(day.slice(8, 10)) + " 日";
const byAgent = (rows: UsageRow[]) => [...new Set(rows.map(row => row.agent))].map(agent => { const own = rows.filter(row => row.agent === agent); return { agent, tokens: tokens(own), cost: cost(own) }; });

function Frame({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return <section className="flex flex-col gap-6 rounded-2xl bg-card p-5 shadow-card" data-summary-card>
    <header className="flex items-baseline justify-between gap-3">
      <h2 className="text-subtitle font-semibold text-foreground">{title}</h2>
      {sub ? <span className="text-caption text-muted-foreground">{sub}</span> : null}
    </header>
    {children}
  </section>;
}
function Lead({ figure, unit, unknown, caption }: { figure: string | null; unit?: string; unknown?: "未定价"; caption?: ReactNode }) {
  return <div className="flex flex-col gap-1" data-summary-lead><Figure text={figure} size="md" unit={unit} unknown={unknown} />{caption ? <span className="text-caption text-muted-foreground">{caption}</span> : null}</div>;
}
/** A section. grow lets a chart section take the room the column leaves; unused for now (owner 2026-10-29: the
 * full-height card looked worse, keep the card to its content and keep this hook for a later design). */
function Part({ title, action, grow = false, children }: { title: string; action?: ReactNode; grow?: boolean; children: ReactNode }) {
  return <div className={grow ? "flex min-h-32 flex-1 flex-col gap-3" : "flex flex-col gap-3"} data-summary-part={title}>
    <div className="flex items-center justify-between gap-3"><span className="text-caption font-semibold text-muted-foreground">{title}</span>{action}</div>
    {children}
  </div>;
}
/** One line: a mark, a name (with an optional second line), a value; an optional share bar under it. */
function Line({ agent, name, detail, value, share, shareTone }: { agent?: string; name: ReactNode; detail?: ReactNode; value: ReactNode; share?: number | null; shareTone?: ChartTone }) {
  return <div className="flex flex-col gap-1.5" data-summary-line>
    <div className="flex min-w-0 items-center gap-3">
      {agent ? <AgentMark agent={agent} variant="icon" size={16} /> : null}
      <span className="flex min-w-0 flex-1 flex-col"><span className="break-words text-body text-foreground">{name}</span>{detail ? <span className="break-words text-caption text-muted-foreground">{detail}</span> : null}</span>
      <span className="shrink-0 text-body font-semibold tabular-nums text-foreground">{value}</span>
    </div>
    {share !== undefined ? <StackBar height={4} unknown={share === null} segments={share === null ? [] : [{ key: "share", value: share, tone: shareTone ?? "accent", label: String(Math.round(share * 100)) + "%" }]} aria-label="占比" /> : null}
  </div>;
}
/** One account or model's quota windows under its full name: the name says whose quota it is, a row only which window. */
function WindowGroup({ agent, name, children }: { agent: string; name: string; children: ReactNode }) {
  return <div className="flex flex-col gap-2" data-summary-group={name}>
    <div className="flex min-w-0 items-center gap-2"><AgentMark agent={agent} variant="icon" size={16} /><span className="min-w-0 flex-1 break-words text-body font-semibold text-foreground">{name}</span></div>
    {children}
  </div>;
}
function WindowRow({ label, when, value, share, shareTone }: { label: string; when?: string; value: string; share?: number | null; shareTone: ChartTone }) {
  return <div className="flex flex-col gap-1" data-summary-window>
    <div className="flex min-w-0 items-baseline gap-2 text-body"><span className="min-w-0 flex-1 truncate text-foreground">{label}</span>{when ? <span className="shrink-0 text-caption text-muted-foreground">{when}</span> : null}<span className="w-12 shrink-0 text-right font-semibold tabular-nums text-foreground">{value}</span></div>
    {share !== undefined ? <StackBar height={4} unknown={share === null} segments={share === null ? [] : [{ key: "share", value: share, tone: shareTone, label: value }]} aria-label={label + " " + value} /> : null}
  </div>;
}
function Days({ rows, today, count, pick, label }: { rows: UsageRow[]; today: string; count: number; pick: (rows: UsageRow[]) => number | null; label: (value: number | null) => string }) {
  const days = Array.from({ length: count }, (_, index) => shift(today, index - count + 1));
  const bars = days.map(day => { const own = rows.filter(row => row.date === day), value = own.length ? pick(own) : null;
    return { key: day, value, state: !own.length ? "unobserved" as const : value === null ? "unpriced" as const : value === 0 ? "zero" as const : "value" as const, tone: "ink:2" as ChartTone, mark: day === today ? "today" as const : undefined, label: md(day) + " " + label(value) }; });
  return <BarChart variant="columns" height="days" bars={bars} tooltip={key => bars.find(bar => bar.key === key)?.label} dataKey={today + ":" + count} aria-label={"最近 " + count + " 天"} />;
}
function Note({ children }: { children: ReactNode }) { return <p className="text-caption text-muted-foreground">{children}</p>; }

function UsageSummary() {
  const usage = useUsage();
  const view = useMemo(() => {
    if (!usage?.today) return null;
    const yesterdayKey = shift(usage.today, -1), weekStart = shift(usage.today, -7), monthStart = shift(usage.today, -30);
    const today = usage.rows.filter(row => row.date === usage.today), yesterday = usage.rows.filter(row => row.date === yesterdayKey);
    const total = tokens(today), agents = byAgent(today).sort((a, b) => b.tokens - a.tokens);
    const week = usage.rows.filter(row => row.date > weekStart && row.date <= usage.today!);
    const kinds = KINDS.map(([field, name]) => ({ field, name, value: kindSum(today, field) })), known = kinds.reduce((sum, item) => sum + (item.value ?? 0), 0);
    // Cache hits only over rows that report both sides; a row missing one says nothing about the share.
    const both = today.filter(row => row.cacheRead !== null && row.inputUncached !== null), read = both.reduce((sum, row) => sum + row.cacheRead!, 0), input = both.reduce((sum, row) => sum + row.inputUncached!, 0);
    const days = new Map<string, number>(); for (const row of usage.rows) if (row.date > monthStart && row.date <= usage.today!) days.set(row.date, (days.get(row.date) ?? 0) + row.totalTokens);
    const counted = [...days.entries()].filter(([, value]) => value > 0), best = [...counted].sort((a, b) => b[1] - a[1])[0] ?? null;
    return { day: usage.today, total, cost: today.length ? cost(today) : null, yesterday: yesterday.length ? tokens(yesterday) : null, agents, week: tokens(week), rows: usage.rows, any: today.length > 0, kinds, known, hit: read + input > 0 ? read / (read + input) : null, best, average: counted.length ? counted.reduce((sum, [, value]) => sum + value, 0) / counted.length : null };
  }, [usage]);
  if (!view) return <Frame title="用量"><Note>还没有记录</Note></Frame>;
  return <Frame title="用量" sub={"今天 " + md(view.day)}>
    <Lead figure={short(view.total)} unit="Token" caption={<>{"估算 " + (view.any ? money(view.cost) : "—")}{view.yesterday !== null ? " · 昨天 " + short(view.yesterday) : ""}</>} />
    <Part title="今天各 Agent">{view.agents.length ? view.agents.slice(0, 5).map((item, index) => <Line key={item.agent} agent={item.agent} name={agentName(item.agent)} value={short(item.tokens)} share={view.total ? item.tokens / view.total : null} shareTone={tone(item.agent, index)} />) : <Note>今天还没有用量</Note>}</Part>
    {view.any ? <Part title="今天的 Token 类型" action={view.hit !== null ? <span className="text-caption text-muted-foreground" data-summary-hit>缓存命中 {Math.round(view.hit * 100)}%</span> : null}>{view.kinds.map((item, index) => <Line key={item.field} name={item.name} value={item.value === null ? "未报告" : short(item.value)} share={item.value === null ? null : view.known ? item.value / view.known : null} shareTone={widgetTone("mono", index)} />)}</Part> : null}
    <Part title={"近 7 天 · " + short(view.week) + " Token"}><Days rows={view.rows} today={view.day} count={7} pick={tokens} label={value => value === null ? "没有记录" : short(value) + " Token"} /></Part>
    {view.best ? <Part title="近 30 天">
      <Line name="最多的一天" detail={md(view.best[0])} value={short(view.best[1])} />
      {view.average !== null ? <Line name="有记录的日子平均" value={short(view.average)} /> : null}
    </Part> : null}
  </Frame>;
}

function CostSummary() {
  const usage = useUsage(), { active } = usePricing();
  const view = useMemo(() => {
    if (!usage?.today) return null;
    const month = usage.rows.filter(row => row.date.slice(0, 7) === usage.today!.slice(0, 7) && row.date <= usage.today!);
    const spent = cost(month), day = Number(usage.today.slice(8, 10)), length = new Date(Number(usage.today.slice(0, 4)), Number(usage.today.slice(5, 7)), 0).getDate();
    const agents = byAgent(month).sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1)), priced = agents.reduce((sum, item) => sum + (item.cost ?? 0), 0);
    return { day: usage.today, spent, projected: spent === null ? null : spent / day * length, agents, priced, missing: unpriced(month), rows: usage.rows };
  }, [usage]);
  if (!view) return <Frame title="费用"><Note>还没有记录</Note></Frame>;
  return <Frame title="费用" sub={Number(view.day.slice(5, 7)) + " 月至今"}>
    <Lead figure={view.spent === null ? null : money(view.spent)} unknown="未定价" caption={view.projected !== null ? "按日均推算整月 " + money(view.projected) : undefined} />
    <Part title="本月各 Agent">{view.agents.length ? view.agents.slice(0, 5).map((item, index) => <Line key={item.agent} agent={item.agent} name={agentName(item.agent)} value={money(item.cost)} share={item.cost === null || !view.priced ? null : item.cost / view.priced} shareTone={tone(item.agent, index)} />) : <Note>本月还没有用量</Note>}</Part>
    <Part title="近 14 天每天"><Days rows={view.rows} today={view.day} count={14} pick={cost} label={value => value === null ? "未计价" : money(value)} /></Part>
    {view.missing ? <Note>{short(view.missing) + " Token 未计价，未计入上面的金额"}</Note> : null}
    {active?.fallbackTokens ? <Note>{"全部历史中有 " + money(active.fallbackUsd) + " 是保底估算"}</Note> : null}
    {active?.floorTokens ? <p className="text-caption text-destructive" data-summary-floor>{"全部历史中有 " + money(active.floorUsd) + " 只算了已报告字段，实际更高"}</p> : null}
  </Frame>;
}

function QuotaSummary() {
  const { host, grid } = useWidgetQuota(), m = host.model, next = nextReset(host, grid, "all");
  const dials = grid.hero?.now?.dials ?? [], warned = grid.live.filter(entry => entry.warn);
  const connected = host.get().state.accounts.length || host.get().providerState?.accounts.length;
  return <Frame title="额度" sub={grid.live.length + " 个连接"}>
    {next ? <Lead figure={m.clock(next.at).match(/\d{1,2}:\d{2}$/)?.[0] ?? m.clock(next.at)} caption={"下一次恢复 · " + next.who + " " + next.label + " · " + m.span(next.at - Date.now()) + "后"} />
      : <Note>{connected ? "没有额度窗口" : "还没有连接额度"}</Note>}
    {dials.length ? <Part title="额度窗口" action={<span className="text-caption text-muted-foreground" data-summary-measure>{host.get().prefs.measure === "used" ? "已用" : "剩余"}</span>}>
      <div className="flex flex-col gap-4">{dials.map(dial => <WindowGroup key={dial.account + dial.sub} agent={dial.agent} name={dial.name + (dial.sub ? " · " + dial.sub : "")}>
        {dial.windows.map(window => <WindowRow key={window.label} label={window.label} when={window.at ? m.clock(window.at) : undefined} value={window.state === "stale" ? "待刷新" : window.text}
          share={window.state === "ok" || window.state === "out" ? (window.value ?? null) === null ? null : Math.max(0, Math.min(1, window.value! / 100)) : undefined} shareTone={tone(dial.agent, 0)} />)}
      </WindowGroup>)}</div>
    </Part> : null}
    <Part title="连接">
      {warned.length ? warned.slice(0, 4).map(entry => <Line key={entry.key} agent={entry.item.agent} name={m.displayName(entry.key, entry.capability.name)} detail={m.brief(entry.item.status.title || entry.item.status.text)} value="需要处理" />) : null}
      <Line name="正常" value={grid.live.length - warned.length} />
      <Line name="未连接" value={grid.idle.length} />
    </Part>
  </Frame>;
}

function SessionsSummary() {
  const list = useSessions();
  const counts = window.sessionsHost?.summary() ?? null;
  const view = useMemo(() => {
    if (!list) return null;
    const all = [...list.sessions].sort((a, b) => b.end.localeCompare(a.end));
    const agents = Object.entries(counts?.agents ?? {}).map(([agent,count])=>({agent,count})).sort((a,b)=>b.count-a.count);
    return { count: counts?.count ?? null, agents, recent: all.slice(0, 4).map(session => { const priced = session.days.filter(day => day.estimatedCostUsd !== null);
      return { session, cost: priced.length ? priced.reduce((sum, day) => sum + day.estimatedCostUsd!, 0) : null, tokens: session.days.reduce((sum, day) => sum + day.totalTokens, 0) }; }) };
  }, [list,counts]);
  if (!view) return <Frame title="会话"><Note>{window.sessionsHost?.recentFailed() ? "会话读取失败，下次更新时重试" : "正在读取会话"}</Note></Frame>;
  return <Frame title="会话" sub="今天">
    <Lead figure={view.count === null ? null : String(view.count)} unit="个会话" />
    {view.agents.length > 1 ? <Part title="今天各 Agent">{view.agents.map((item, index) => <Line key={item.agent} agent={item.agent} name={agentName(item.agent)} value={item.count} share={view.count ? item.count / view.count : null} shareTone={tone(item.agent, index)} />)}</Part> : null}
    <Part title="最近会话">{view.recent.length ? view.recent.map(row => <Line key={row.session.key} agent={row.session.agent} name={window.sessionsHost?.labels()[row.session.key]?.alias || row.session.title || row.session.project || "未知项目"} detail={(row.session.models[0] ?? "模型未记录") + " · " + short(row.tokens) + " Token"} value={money(row.cost)} />) : <Note>还没有会话</Note>}</Part>
  </Frame>;
}

// The same word as the source's own card: a source with records has been read, whether or not a real sample was checked.
const SOURCE_STATE: Record<string, string> = { verified: "已读取", partial: "部分读取", unverified: "已读取", "not-detected": "未发现", error: "读取出错" };
function SourcesSummary() {
  const usage = useUsage(), collection = usage?.collection, sources = usage?.sources ?? [];
  const state = !collection ? "—" : !collection.enabled ? "已暂停" : collection.collecting ? "正在采集" : collection.error ? "上次没有完成" : collection.checkedAt ? ago(collection.checkedAt) : "尚未采集";
  const recorded = sources.filter(source => source.observedRecords > 0);
  const order = (status: string) => ["error", "partial", "unverified", "verified", "not-detected"].indexOf(status);
  return <Frame title="用量来源" sub={"采集 · " + state}>
    <Lead figure={String(recorded.length)} unit={"/ " + sources.length + " 个来源有记录"} />
    <Part title="来源">{sources.length ? [...sources].sort((a, b) => order(a.status) - order(b.status)).slice(0, 8).map(source =>
      <Line key={source.agent} agent={source.agent} name={agentName(source.agent)} detail={source.observedRecords + " 条记录" + (source.lastSuccess ? " · 最近成功 " + ago(source.lastSuccess) : "")} value={source.status === "unverified" && !source.observedRecords ? "尚未读取" : SOURCE_STATE[source.status] ?? source.status} />) : <Note>还没有来源</Note>}</Part>
  </Frame>;
}

const PAGES: Record<string, () => ReactNode> = { quota: QuotaSummary, usage: UsageSummary, cost: CostSummary, sessions: SessionsSummary, sources: SourcesSummary };
/** The summary column's one card for the page on screen; settings has none. */
export function PageSummary({ view }: { view: string }) {
  const Page = PAGES[view];
  return Page ? <div className="flex flex-col pb-4" data-page-summary={view}><Page /></div> : null;
}
