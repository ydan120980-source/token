import { useState, type ReactNode } from "react";
import { Button, Figure, Value, Card, Sheet, SectionHeader, Segmented, ListRow, RingChart, BarChart, LineChart, ChartLegend, Heatmap, Timeline, StepChart, StackBar, Carousel, Sortable, Reveal, Ticket, PaneGroup, RangeCalendar, DateRangePopover, EdgeTrigger, AgentMark, type ChartTone } from "@ui/kit";
import { SwatchGroup, DataTable, TreeBranch, TipCard } from "@ui/kit";

const start = Date.UTC(2026, 9, 26, 4), hour = 3600000, end = start + 24 * hour;
const x = ["10/21", "10/22", "10/23", "10/24", "10/25", "10/26"].map((label, i) => ({ key: String(i), label, missing: i === 2, partial: i === 4 }));
const initialBars = ["value", "zero", "unobserved", "unpriced", "future"].map((state, i) => ({ key: String(i), value: i === 0 ? 12 : i === 1 ? 0 : null, state: state as "value" | "zero" | "unobserved" | "unpriced" | "future", tone: "neutral" as ChartTone, label: ["2026-10-26 · 12 Token", "已观测 0 Token", "未观测到记录", "有用量，未计入", "还没到"][i] }));
function Sample({ name, title, children }: { name: string; title: string; children: ReactNode }) { return <section data-mkb-case={name} className="flex min-w-0 flex-col gap-3"><SectionHeader title={title}/>{children}</section>; }
function HeatmapLiveReadout({ variant }: { variant: "calendar" | "weekHour" }) {
  const [value, setValue] = useState(2);
  const [state, setState] = useState<"shown" | "disabled" | "removed">("shown");
  return <Sample name={"heatmap-live-" + variant} title={"热力图实时读数 · " + variant}>
    <div className="flex flex-wrap gap-3">
      <Button variant="secondary" onClick={() => setValue(6)}>更新读数</Button>
      <Button variant="secondary" onClick={() => setState("removed")}>移除当前格</Button>
      <Button variant="secondary" onClick={() => setState("disabled")}>禁用当前格</Button>
      <Button variant="secondary" onClick={() => { setValue(2); setState("shown"); }}>恢复格</Button>
    </div>
    <Heatmap
      variant={variant}
      rows={7}
      cols={variant === "calendar" ? 53 : 24}
      cells={state === "removed" ? [] : [{
        key: "live", row: 0, col: 0, level: value === 2 ? 1 : 4,
        disabled: state === "disabled", label: value + " Token",
      }]}
      tooltip={variant === "calendar" ? () => value + " Token" : undefined}
      aria-label={"热力实时 " + variant} />
  </Sample>;
}
function TipCardReadout({ variant }: { variant: "trend" | "calendar" | "weekHour" }) {
  const [value, setValue] = useState(2), [removed, setRemoved] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const points = ["left", "middle", "right"].filter(key => !removed || key !== "middle");
  const content = (key: string) => <TipCard title={variant + " " + key} aside="已保存统计"
    rows={[
      { key: "known", label: "已定价估算", value: "$" + value, tone: "ink:1" },
      { key: "zero", label: "已报告零", value: "0 Token", tone: "category:input" },
      { key: "unknown", label: "未知值", value: <Value value={null} />, tone: "muted" },
    ]}
    note="完整读数与键盘焦点使用同一张卡片" />;
  return <Sample name={"tipcard-" + variant} title={"多行提示卡 · " + variant}>
    <div className="flex flex-wrap gap-3">
      <Button variant="secondary" onClick={() => setValue(6)}>更新卡片读数</Button>
      <Button variant="secondary" onClick={() => setRemoved(true)}>移除卡片当前点</Button>
      <Button variant="secondary" onClick={() => { setValue(2); setRemoved(false); }}>恢复卡片数据</Button>
    </div>
    {variant === "trend" ? <LineChart
      variant="trend"
      x={points.map(key => ({ key, label: key }))}
      series={[{ key: "total", label: "Token", tone: "ink:1", values: points.map(() => value) }]}
      active={active}
      onActiveChange={setActive}
      tooltip={index => content(points[index])}
      dataKey="tipcard-trend"
      aria-label="趋势多行提示卡" /> : <Heatmap
      variant={variant}
      rows={7}
      cols={variant === "calendar" ? 53 : 24}
      cells={points.map(key => ({ key, row: 3,
        col: key === "left" ? 0 : key === "right" ? variant === "calendar" ? 52 : 23 : variant === "calendar" ? 26 : 12,
        level: 3, label: key + " · " + value + " Token" }))}
      tooltip={content}
      dataKey={"tipcard-" + variant}
      aria-label={variant + "多行提示卡"} />}
  </Sample>;
}
function SharedLayoutOptions() {
  const [swatch, setSwatch] = useState("orange");
  const cells = Array.from({ length: 168 }, (_, index) => ({ key: String(index), row: Math.floor(index / 24),
    col: index % 24, level: index % 5 as 0 | 1 | 2 | 3 | 4, label: "合成格 " + index }));
  return <Sample name="layout-options" title="共享布局选项">
    <SwatchGroup value={swatch} onChange={setSwatch} aria-label="合成圆点配色"
      items={(["orange", "blue", "green", "mono"] as const).map(value => ({
        value, label: value, tone: ("palette:" + value) as ChartTone,
      }))} />
    <output data-swatch-value>{swatch}</output>
    <div className="w-64">
      <Heatmap variant="calendar" rows={7} cols={14} sizing="fit-square" navigation="grid"
        cells={Array.from({ length: 98 }, (_, index) => ({ key: String(index), row: index % 7,
          col: Math.floor(index / 7), level: 1, label: "合成日期 " + index }))}
        aria-label="按格导航日历" />
    </div>
    <Heatmap variant="weekHour" rows={7} cols={24} cells={cells} sizing="fit-square"
      colLabelsPosition="bottom" colLabels={[{ col: 0, label: "00" }, { col: 18, label: "18" }]}
      rowLabels={[{ row: 0, label: "一" }]} aria-label="适宽方格" />
    <DataTable size="compact" columns={[{ key: "name", label: "模型", render: (row: { key: string }) =>
      <span className="flex items-center">
        <TreeBranch />
        {row.key}
      </span> }]} rows={[{ key: "合成模型" }]} rowKey={row => row.key} rowEmphasis={() => true} />
  </Sample>;
}
export function MkbGallery() {
  const [value, setValue] = useState(30), [dataKey, setDataKey] = useState("one"), [active, setActive] = useState<string | null>(null), [hidden, setHidden] = useState<string[]>([]), [barActive, setBarActive] = useState<string | null>(null), [selectedBar, setSelectedBar] = useState(""), [lineActive, setLineActive] = useState<number | null>(null), [pinned, setPinned] = useState<number | null>(null), [range, setRange] = useState<[number, number] | null>(null), [applied, setApplied] = useState(""), [heatActive, setHeatActive] = useState<string | null>(null), [heatSelected, setHeatSelected] = useState<string | null>(null), [needle, setNeedle] = useState<number | null>(null), [preview, setPreview] = useState<number | null>(null), [stepActive, setStepActive] = useState<string | null>(null), [slide, setSlide] = useState(0), [items, setItems] = useState(["a", "b", "c", "d"]), [cardClicks, setCardClicks] = useState(0), [buttonClicks, setButtonClicks] = useState(0), [collapsed, setCollapsed] = useState<string | null>(null), [tab, setTab] = useState("composition"), [dates, setDates] = useState<{ from: string; to: string } | null>({ from: "2026-10-20", to: "2026-10-22" }), [draftDates, setDraftDates] = useState<{ from: string; to: string } | null>(null), [preset, setPreset] = useState("page"), [sheet, setSheet] = useState<"left" | "right" | "center" | null>(null), [layout, setLayout] = useState("stacked");
  const [allHidden, setAllHidden] = useState(false);
  const tip = (key: string | null) => <><span>合成完整读数 · {key ?? "全部"}</span><strong className="text-subtitle font-semibold tabular-nums">$0.000123456789</strong><span>未知值保持未知</span></>;
  const lineTip = (index: number) => <><strong>{x[index]?.label}</strong><Value value={index === 3 ? null : "$0.000123456789"}/></>;
  const series = [{ key: "codex", label: "Codex", tone: "series:codex" as ChartTone, values: [10, value, null, null, 20, 12], style: "area" as const }, { key: "claude", label: "Claude Code", tone: "series:claude" as ChartTone, values: [4, 12, null, 9, null, 8] }];
  const rings = [{ key: "short", value, tone: "agent:codex" as ChartTone, state: "normal" as const, tick: .6, label: "短窗口剩余 " + value + "%" }, { key: "stale", value: 60, tone: "agent:codex" as ChartTone, state: "stale" as const, label: "长窗口待刷新" }, { key: "unknown", value: null, tone: "agent:codex" as ChartTone, state: "unknown" as const, label: "未知" }];
  return <div data-mkb-gallery className="flex min-w-0 flex-col gap-8">
    <TipCardReadout variant="trend" />
    <TipCardReadout variant="calendar" />
    <TipCardReadout variant="weekHour" />
    <Sample name="distinct-tones" title="分类与模型的共享离散颜色">
      <ChartLegend variant="inline" minVisible={0} onToggle={() => {}}
        items={(["measure:input", "measure:output", "measure:cacheRead", "measure:cacheWrite", "measure:estimate",
          "model:0", "model:1", "model:2", "model:3", "model:4", "model:5", "model:6", "model:7", "model:8", "model:9"] as ChartTone[])
          .map(tone => ({ key: tone, label: tone, tone, hidden: false }))} />
    </Sample>
    <HeatmapLiveReadout variant="calendar" />
    <HeatmapLiveReadout variant="weekHour" />
    <Sample name="update" title="MK-b 数据更新和重新入场"><div className="flex flex-wrap items-center gap-3"><Button variant="secondary" onClick={() => setValue(v => v === 30 ? 75 : 30)}>更新图表数值</Button><Button variant="secondary" onClick={() => setDataKey(v => v === "one" ? "two" : "one")}>切换图表数据键</Button><span data-mkb-value>{value}</span></div></Sample>
    <Sample name="rings" title="圆环的全部档位"><div className="flex flex-wrap items-center gap-3">{(["dial", "card", "mini", "coverage"] as const).map(size => <RingChart key={size} variant="concentric" size={size} rings={size === "dial" ? rings : rings.slice(0, 1)} active={active} onActiveChange={setActive} onSelect={setSelectedBar} dataKey={dataKey} aria-label={"圆环 " + size} center={<Value value={active === "unknown" ? null : String(value) + "%"}/>}/>)}<RingChart variant="concentric" size="dial" rings={rings.slice(0, 1)} aria-label="单圈档位"/><RingChart variant="concentric" size="dial" rings={rings.slice(0, 2)} aria-label="双圈档位"/><RingChart variant="concentric" size="card" rings={[{ key: "out", value: 0, tone: "warn", state: "out", label: "窗口已用尽" }]} aria-label="耗尽圆环"/><RingChart variant="concentric" size="card" rings={[rings[2]]} aria-label="未知圆环" center={<Value value={null}/>}/></div></Sample>
    <Sample name="donut" title="圆环与图例联动"><div className="flex flex-wrap items-center gap-3">{(["full", "half"] as const).map(shape => <RingChart key={shape} variant="donut" size={shape === "full" ? "donut" : "donutCompact"} shape={shape} segments={[{ key: "codex", value: value, tone: "series:codex" as ChartTone, label: "Codex $0.000123456789" }, { key: "claude", value: 60, tone: "series:claude" as ChartTone, label: "Claude Code $0.000987654321" }].filter(item => !hidden.includes(item.key))} active={active} onActiveChange={setActive} dataKey={dataKey} aria-label={shape + " 费用构成"} center={<span>{active ?? "已计价"}</span>}/>)}</div><ChartLegend active={active} onActiveChange={setActive} minVisible={1} onToggle={key => setHidden(previous => previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key])} items={[{ key: "codex", label: "Codex", tone: "series:codex", hidden: hidden.includes("codex"), note: "$0.000123456789", title: "完整金额", ariaLabel: "Codex，完整金额，切换显示" }, { key: "claude", label: "Claude Code", tone: "series:claude", hidden: hidden.includes("claude") }, { key: "unpriced", label: "未计入", tone: "muted", hidden: false, disabled: true, note: "没有价格" }]}/><ChartLegend items={[{ key: "single", label: "可全隐藏图例", tone: "neutral", hidden: allHidden }]} onToggle={() => setAllHidden(previous => !previous)} minVisible={0}/></Sample>
    <Sample name="gauge" title="Gauge 区间与未知"><div className="flex flex-wrap gap-3"><RingChart variant="gauge" size="gauge" gauge={{ lower: value, upper: value + 12, projection: { lower: 80, upper: 96 }, max: 108 }} aria-label="本月推算区间" center={<Figure size="sm" text="$0.000123456789"/>}/><RingChart variant="gauge" size="gauge" gauge={{ lower: null, upper: null, projection: { lower: null, upper: 96 }, max: 108 }} aria-label="未知推算" center={<Value value={null}/>}/></div></Sample>
    <Sample name="bars" title="柱形的全部高度和状态">{(["strip", "hours", "days", "pair"] as const).map(height => <div key={height} data-mkb-bar={height}><BarChart variant="columns" height={height} bars={height === "pair" ? initialBars.slice(0, 2) : initialBars} active={barActive} onActiveChange={setBarActive} onSelect={setSelectedBar} ticks={height === "hours" ? ["00", "06", "12", "18", "23"].map((label, value) => ({ value, label })) : undefined} dataKey={dataKey} tooltip={height === "strip" || height === "hours" ? tip : undefined} aria-label={"柱 " + height}/></div>)}<output data-bar-selection>{selectedBar}</output></Sample>
    <Sample name="months" title="按月分组与堆叠"><Segmented value={layout} onChange={setLayout} items={[{ value: "stacked", label: "堆叠" }, { value: "grouped", label: "分组" }]} aria-label="柱布局"/><BarChart variant="months" height="months" groups={[{ key: "oct", label: "10 月", series: [{ key: "codex", lower: value, upper: value + 10, tone: "series:codex" }, { key: "claude", lower: 20, upper: 24, tone: "series:claude" }], projection: { lower: 70, upper: 90 } }, { key: "sep", label: "9 月", series: [{ key: "codex", lower: null, upper: null, tone: "series:codex" }] }]} ticks={[{ value: 0, label: "$0" }, { value: 50, label: "$50" }, { value: 100, label: "$100" }]} layout={layout as "grouped" | "stacked"} hidden={hidden} active={barActive} onActiveChange={setBarActive} readout={<Value value={barActive === "sep" ? null : "$0.000123456789"}/>} aria-label="按月费用"/></Sample>
    <Sample name="lines" title="折线、缺口、选区和读数">{(["trend", "stack", "detail", "spark"] as const).map(variant => <div data-mkb-line={variant} key={variant}><LineChart variant={variant} x={x} series={series} stacked={variant === "stack"} active={lineActive} onActiveChange={setLineActive} pinned={variant === "stack" ? pinned : undefined} onPinnedChange={variant === "stack" ? setPinned : undefined} range={variant === "stack" || variant === "trend" ? range : undefined} onRangeChange={variant === "stack" || variant === "trend" ? setRange : undefined} onApplyRange={v => setApplied(v.join(":"))} onSelect={v => setApplied("point:" + v)} ticks={{ left: [{ value: 0, label: "0" }, { value: 100, label: "100" }], x: x.map((item, index) => ({ index, label: item.label })) }} tooltip={lineTip} readout={variant === "stack" ? <Value value={lineActive === 3 ? null : "$0.000123456789"}/> : undefined} dataKey={dataKey} aria-label={"折线 " + variant}/></div>)}<div data-mkb-line="spark-hero"><LineChart variant="spark" size="hero" x={x} series={series} active={lineActive} onActiveChange={setLineActive} aria-label="首屏微图"/></div><LineChart variant="trend" x={[{ key: "unknown", label: "有记录，未知" }]} series={[{ key: "unknown", label: "未知", tone: "neutral", values: [null] }]} aria-label="全未知趋势"/><output data-line-applied>{applied}</output></Sample>
    <SharedLayoutOptions />
    <Sample name="heatmap" title="共享热力提示层">{(["calendar", "weekHour"] as const).map(variant => <Heatmap key={variant} variant={variant} rows={7} cols={variant === "calendar" ? 53 : 24} cells={Array.from({ length: 7 * (variant === "calendar" ? 53 : 24) }, (_, i) => ({ key: variant + i, row: variant === "calendar" ? i % 7 : Math.floor(i / 24), col: variant === "calendar" ? Math.floor(i / 7) : i % 24, level: i === 2 ? null : i % 5 as 0 | 1 | 2 | 3 | 4, disabled: i === 5, highlighted: i === 8, label: variant + " " + i + (i === 2 ? " 未观测" : i === 0 ? " 已观测 0 Token" : " 合成用量") }))} rowLabels={[{ row: 0, label: "一" }, { row: 6, label: "日" }]} colLabels={[{ col: 0, label: variant === "calendar" ? "10月" : "00" }]} selected={heatSelected} onSelect={setHeatSelected} active={heatActive} onActiveChange={setHeatActive} tooltip={variant === "calendar" ? tip : undefined} dataKey={dataKey} aria-label={"热力 " + variant}/>)}<output data-heat-selection>{heatSelected}</output></Sample>
    <Sample name="timeline" title="时间针和静默/过期标记"><Timeline start={start} end={end} step={hour} axis={[{ at: start + 6 * hour, label: "18:00" }, { at: start + 12 * hour, label: "明天" }]} lanes={[{ key: "reset", leading: <span>Codex 窗口</span>, markers: [{ key: "reset6", at: start + 6 * hour, kind: "reset", tone: "agent:codex", state: "normal", label: "18:00 重置" }], value: <Value value={needle && needle >= start + 6 * hour ? "满额" : "未知"}/> }, { key: "expiry", leading: <span>积分到期</span>, markers: [{ key: "expiry12", at: start + 12 * hour, kind: "expiry", tone: "agent:workbuddy", state: "normal", label: "明天 到期 123.456789 积分" }], value: <Value value="123.456789"/> }, { key: "silent", leading: <span>没有报告时间</span>, markers: [{ key: "unreported", at: null, kind: "reset", tone: "muted", state: "stale", label: "时间未报告" }], value: <Value value={null}/> }]} needle={needle} onNeedleChange={setNeedle} preview={preview} onPreviewChange={setPreview} aria-label="合成时间针" aria-valuetext={(needle === null ? "现在" : "所选时刻") + "，" + (needle && needle >= start + 6 * hour ? 1 : 0) + " 个窗口已重置"}/></Sample>
    <Sample name="steps" title="余额阶梯和聚合菱形"><StepChart steps={[{ key: "now", at: start, amount: 100, packs: 0, label: "100.123456789 积分" }, { key: "soon", at: start + 6 * hour, amount: 70, packs: 1, label: "30.123456789 积分到期" }, { key: "near", at: start + 6.5 * hour, amount: 60, packs: 2, label: "10 积分到期" }, { key: "later", at: start + 18 * hour, amount: 20, packs: 1, label: "40 积分到期" }]} unlimited={{ amount: 20, label: "20 积分不限期" }} start={start} end={end} tone="agent:workbuddy" active={stepActive} onActiveChange={setStepActive} ticks={[{ value: 0, label: "0" }, { value: 50, label: "50" }, { value: 100, label: "100" }]} axis={Array.from({ length: 5 }, (_, i) => ({ at: start + i * 6 * hour, label: i === 0 ? "今天" : "时段 " + i }))} aria-label="合成余额阶梯"/><Value value={stepActive}/></Sample>
    <Sample name="stack-tooltip" title="微条完整构成提示"><StackBar height={8} segments={[{ key: "input", value: .4, tone: "category:input", label: "输入 $0.000123456789" }, { key: "output", value: .6, tone: "category:output", label: "输出 未计入" }]} tooltip={tip} active={active} onActiveChange={setActive} aria-label="构成微条"/></Sample>
    <Sample name="carousel" title="文字圆点、键盘和拖动翻页"><Carousel slides={[{ key: "now", label: "现在", node: <div className="p-6"><p>现在合成内容</p><div data-carousel-ignore className="p-4">图内手势区域</div></div> }, { key: "next", label: "接下来", node: <div className="flex flex-col gap-3 p-6"><p>接下来合成内容</p><p>较高内容</p><p>第三行</p></div> }, { key: "wallet", label: "余额", node: <p className="p-6">余额合成内容</p> }]} index={slide} onIndexChange={setSlide} aria-label="合成首屏"/></Sample>
    <Sample name="sortable" title="长按和 Alt 方向键排序"><div className="grid grid-cols-2 gap-4"><Sortable items={items.map(key => ({ key, label: "排序 " + key, node: <Card onClick={() => setCardClicks(n => n + 1)}><p className="text-body">项目 {key}</p><Button variant="secondary" onClick={() => setButtonClicks(n => n + 1)}>独立动作 {key}</Button></Card> }))} onReorder={setItems} aria-label="合成排序"/></div><output data-card-count>{cardClicks}</output><output data-card-button-count>{buttonClicks}</output><output data-sort-order>{items.join("")}</output></Sample>
    <Sample name="reveal-ticket" title="上下界和钱包票据"><Reveal trigger={<Figure size="sm" text="$0.0001"/>} content={<span>$0.0001 – $0.000123456789 · 已计价部分</span>} aria-label="完整费用上下界"/><Card><Ticket tone="agent:workbuddy" title={<span title="合成积分包 · 到期说明">合成积分包</span>} figure={<Value value="123.456789"/>} caption="7 天内到期"/><Ticket tone="muted" title="不可用积分包" figure={<Value value={null}/>} muted/></Card></Sample>
    <Sample name="panes" title="两栏和标题 actions"><PaneGroup panes={[{ key: "where", title: "花在哪", actions: <Segmented value={tab} onChange={setTab} items={[{ value: "composition", label: "费用构成" }, { value: "subscriptions", label: "订阅对照" }]} aria-label="花在哪视图"/>, node: <p>{tab === "composition" ? "构成内容" : "订阅内容"}</p> }, { key: "months", title: "按月", node: <p>按月内容</p> }]} collapsed={collapsed} onCollapsedChange={setCollapsed}/></Sample>
    <Sample name="calendars" title="单日、第二次提交和草稿日历"><RangeCalendar value={dates} min="2026-01-01" max="2026-10-26" onChange={setDates} commit="second-click" marks={["2026-10-20"]} aria-label="两次提交日历"/><output data-calendar-result>{dates?.from + ":" + dates?.to}</output><DateRangePopover value={draftDates} min="2026-01-01" max="2026-10-26" maxDays={3660} preset={preset} presets={[{ key: "today", label: "今天" }, { key: "7", label: "7 天" }, { key: "30", label: "30 天" }, { key: "page", label: "跟随页面" }]} onApply={(range, key) => { setDraftDates(range); if (key) setPreset(key); }} onReset={() => { setDraftDates(null); setPreset("page"); }} triggerLabel="累计" marks={["2026-10-20"]} aria-label="趋势时间范围：合成完整日期"/><output data-draft-result>{draftDates?.from + ":" + draftDates?.to + ":" + preset}</output></Sample>
    <Sample name="sheet-tree-edge" title="侧边 Sheet、树线和边缘入口"><div className="flex flex-wrap items-center gap-3">{(["left", "right", "center"] as const).map(side => <Button key={side} variant="secondary" onClick={() => setSheet(side)}>打开 {side} Sheet</Button>)}</div><ListRow level={1} title="模型树枝" meta="原中性树线"/><Sheet open={sheet !== null} onOpenChange={open => { if (!open) setSheet(null); }} placement={sheet ?? "center"} dismissDrag size={sheet === "left" ? "lg" : "sm"} title="合成侧边 Sheet" footer={<Button variant="secondary" onClick={() => setSheet(null)}>完成</Button>}>{Array.from({ length: 35 }, (_, i) => <p key={i}>合成长内容 {i}</p>)}</Sheet><EdgeTrigger side="left" label="打开左侧日期范围" onOpen={() => setSheet("left")}/><EdgeTrigger side="right" label="打开右侧日期范围" onOpen={() => setSheet("right")}/><AgentMark agent="codex" variant="icon"/></Sample>
  </div>;
}
