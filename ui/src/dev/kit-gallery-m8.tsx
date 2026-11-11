import { useState } from "react";
import { BarChart, Button, Carousel, EmptyState, ChartLegend, Figure, LineChart, RingChart, StackBar, Value } from "@ui/kit";

export function M8Gallery() {
  const [active, setActive] = useState<string | null>(null), [line, setLine] = useState<number | null>(null);
  const [hidden, setHidden] = useState<string[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [value, setValue] = useState(2), [shape, setShape] = useState<"full" | "half">("full");
  const [rolling, setRolling] = useState(45), [slide, setSlide] = useState(0);
  const [reference, setReference] = useState<number | null>(null);
  const toggle = (key: string) => setHidden(items => items.includes(key) ? items.filter(item => item !== key) : [...items, key]);
  const legend = [
    { key: "codex", label: "Codex", tone: "series:codex" as const, hidden: hidden.includes("codex"), note: "$" + value },
    { key: "claude", label: "Claude Code", tone: "series:claude" as const, hidden: hidden.includes("claude"), note: "$1" },
    { key: "unknown", label: "未计入", tone: "muted" as const, hidden: false, disabled: true, note: <Value value={null} /> },
  ];
  return <div data-m8-gallery className="flex min-w-0 flex-col gap-8">
    <div className="flex flex-wrap gap-3">
      <Button variant="secondary" onClick={() => setValue(v => v === 2 ? 6 : 2)}>更新费用组件</Button>
      <Button variant="secondary" onClick={() => setShape(s => s === "full" ? "half" : "full")}>切换费用圆环形状</Button>
    </div>
    <div data-m8-case="legend" className="flex flex-col gap-3">
      <ChartLegend variant="inline" items={legend} onToggle={toggle} minVisible={1} active={active} onActiveChange={setActive} />
      <ChartLegend variant="donut" items={legend} onToggle={toggle} minVisible={1} active={active} onActiveChange={setActive} />
      <output data-m8-selected>{selected}</output>
    </div>
    <div data-m8-case="stack">
      <StackBar variant="cost-hero" height={12}
        segments={[{ key: "a", value: .6, tone: "series:codex", label: "Codex $" + value },
          { key: "b", value: .4, tone: "series:claude", label: "Claude Code $1" }]}
        active={active} onActiveChange={setActive} tooltip={key => key + " · $" + value} aria-label="费用首屏分段条" />
    </div>
    <div data-m8-case="months" className="h-88">
      <BarChart variant="months" height="months" selected={selected} active={active} onActiveChange={setActive} onSelect={setSelected}
        ticks={[{ value: 0, label: "$0" }, { value: 8, label: "$8" }]}
        tooltip={key => key + " · $" + value}
        groups={[
          { key: "sep", label: "9 月", ariaLabel: "2026 年 9 月，$2，点选筛选这个月",
            series: [{ key: "codex", lower: value, upper: value, tone: "series:codex" }] },
          { key: "oct", label: "10 月", ariaLabel: "2026 年 10 月，未计入",
            series: [{ key: "codex", lower: null, upper: null, tone: "series:codex" }] },
        ]} aria-label="费用月份选择" />
    </div>
    <div data-m8-case="days">
      <BarChart variant="columns" height="days" active={active} onActiveChange={setActive}
        bars={[
          { key: "value", value: .02, tone: "series:codex", state: "value", label: "已计价 $0.02", mark: "today" },
          { key: "zero", value: 0, tone: "series:codex", state: "zero", label: "已观测 $0" },
          { key: "missing", value: null, tone: "series:codex", state: "unobserved", label: "没有记录" },
          { key: "unpriced", value: null, tone: "series:codex", state: "unpriced", label: "有用量，未计入" },
          { key: "future", value: null, tone: "series:codex", state: "future", label: "还没到" },
        ]} aria-label="费用每天四态" />
    </div>
    <div data-m8-case="line">
      <LineChart variant="detail" palette="cost"
        x={[{ key: "a", label: "10/20" }, { key: "b", label: "10/21", missing: true }, { key: "c", label: "10/22" }]}
        series={[{ key: "tokens", label: "Token", tone: "cost:line", values: [value, null, 3] }]}
        ticks={{ left: [{ value: 0, label: "0" }, { value: 8, label: "8" }] }}
        endLabel="3 Token" active={line} onActiveChange={setLine}
        tooltip={index => "2026-10-" + (20 + index) + " · 完整读数"} aria-label="费用详情坐标" />
    </div>
    <div data-m8-case="spark-tooltip">
      <LineChart variant="spark" size="row" aria-label="费用微图刷新"
        x={[{ key: "a", label: "10/20" }, { key: "b", label: "10/21" }]}
        series={[{ key: "spark", label: "费用", tone: "cost:line", values: [value, 3] }]}
        active={line} onActiveChange={setLine} tooltip={i => i + " · $" + value} />
    </div>
    <div data-m8-case="rings" className="flex flex-wrap gap-6">
      <RingChart variant="concentric" size="mini" trackTone="cost:track-strong"
        rings={[{ key: "hit", value: 80, tone: "cost:hit", state: "normal", label: "命中 80%" }]}
        aria-label="原费用缓存小环" />
      <RingChart variant="gauge" size="gauge" trackTone="cost:track" projectionTone="cost:track-strong"
        gauge={{ lower: null, upper: null, projection: null, max: 1 }} center={<Value value={null} />} aria-label="未知费用仪表" />
      <RingChart variant="donut" size="donut" trackTone="cost:track" shape={shape}
        segments={[{ key: "codex", value, tone: "series:codex", label: "Codex $" + value }]}
        active={active} onActiveChange={setActive} center={<span>Codex ${value}</span>} aria-label="费用圆环中心" />
    </div>
    <div data-m8-case="reference">
      <LineChart variant="detail" palette="cost" aria-label="参考费用曲线"
        x={[18, 25, 12, 30, 22, 17, 31.84].map((_, i) => ({ key: String(i), label: "2026-10-" + (12 + i) }))}
        series={[{ key: "reference", label: "费用", values: [18, 25, 12, 30, 22, 17, 31.84], tone: "cost:line", style: "area" }]}
        ticks={{ left: [0, 10, 20, 30, 40].map(value => ({ value, label: "$" + value })) }}
        active={reference} onActiveChange={setReference} endLabel="$31.84"
        tooltip={i => "2026-10-" + (12 + i) + " · $" + [18, 25, 12, 30, 22, 17, 31.84][i]} />
    </div>
    <div data-m8-case="sparse">
      <LineChart variant="detail" palette="cost" aria-label="未知零值曲线"
        x={Array.from({ length: 7 }, (_, i) => ({ key: String(i), label: "2026-10-" + (12 + i) }))}
        series={[{ key: "sparse", label: "费用", tone: "cost:line", values: [0, null, 1e-7, null, 1e-7, null, null] }]}
        ticks={{ left: [0, 1e-7, 2e-7, 3e-7, 4e-7].map(value => ({ value, label: value === 0 ? "$0" : "$" + value })) }}
        active={line} onActiveChange={setLine} endLabel="$1e-7"
        tooltip={i => [0, null, 1e-7, null, 1e-7, null, null][i] === null ? "未报告" : "$" + [0, null, 1e-7, null, 1e-7, null, null][i]} />
    </div>
    <div data-m8-case="empty">
      <LineChart variant="detail" aria-label="无数据曲线"
        x={[{ key: "empty", label: "未报告" }]} series={[{ key: "empty", label: "费用", tone: "cost:line", values: [null] }]}
        endLabel="未知" />
      <EmptyState message="当前范围没有已计入估算的用量。" />
    </div>
    <div data-m8-case="per-agent-gap">
      <LineChart variant="stack" aria-label="逐 Agent 缺口" x={[1, 2, 3].map(i => ({ key: String(i), label: String(i) }))}
        series={[{ key: "codex", label: "Codex", tone: "series:codex", values: [2, null, 4] },
          { key: "claude", label: "Claude", tone: "series:claude", values: [null, 3, null] }]} />
    </div>
    {([true, false] as const).map(stacked => <div key={String(stacked)} data-m8-case={stacked ? "cost-stack-gaps" : "cost-line-gaps"}>
      <LineChart variant="stack" palette="cost" stacked={stacked} aria-label={stacked ? "费用整桶缺口" : "费用独立折线缺口"}
        active={line} onActiveChange={setLine}
        x={Array.from({ length: 5 }, (_, i) => ({ key: String(i), label: String(i), missing: i === 2, partial: i === 1 }))}
        series={[
          { key: "codex", label: "Codex", tone: "series:codex", values: [2, null, null, 0, 4], style: stacked ? "area" : "line" },
          { key: "claude", label: "Claude", tone: "series:claude", values: [null, 3, null, null, null], style: stacked ? "area" : "line" },
        ]} />
    </div>)}
    <div data-m8-case="rolling">
      <Button variant="secondary" onClick={() => setRolling(v => v === 45 ? 46 : 45)}>更新滚动数字</Button>
      <Carousel index={slide} onIndexChange={setSlide} aria-label="生命周期轮播" slides={[
        { key: "first", label: "第一张", node: <Figure size="cost-hero" text={String(rolling)} /> },
        { key: "empty", label: "空本月", node: <Value value={null} /> },
      ]} />
    </div>
    <div data-m8-case="figure"><Figure size="cost-hero" text={"$" + value + ".00"} /></div>
  </div>;
}
