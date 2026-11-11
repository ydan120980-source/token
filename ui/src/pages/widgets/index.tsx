import { useEffect, useState } from "react";
import { IconPlus, IconSettings, IconX } from "@tabler/icons-react";
import { AgentMark, Button, Segmented, Select, Sheet, Sortable, Switch, WidgetAddSlot, WidgetGrip, WidgetPlace, WidgetTool, WidgetTools } from "@ui/kit";
import { getGlobals, showView } from "@ui/data";
import { changeWidgets, useWidgetState, widgetModel, type WidgetBackground, type WidgetColor, type WidgetConfig, type WidgetSize, type WidgetType } from "@ui/data/widgets";
import { useWidgetQuota } from "@ui/data/widget-data";
import { WIDGETS } from "./registry";
import { quotaReadout } from "./quota";

const SIZE_NAMES: Record<WidgetSize, string> = { s: "小", m: "中", l: "大" };
const COLOR_NAMES: Record<WidgetColor, string> = { agent: "跟随 Agent", mono: "单色", ink: "墨色" };
const BACKGROUND_NAMES: Record<WidgetBackground, string> = { plain: "默认", soft: "浅灰", tint: "着色", inv: "反色" };
const PERIOD_NAMES: Record<string, string> = { "24h": "24 小时", "7d": "7 天", "7": "7 天", "14": "14 天", "30": "30 天", month: "本月", tokens: "Token", cost: "费用" };

function Widget({ config }: { config: WidgetConfig }) {
  const Component = WIDGETS[config.type];
  return <Component config={config} />;
}

/** One widget's options: size, colour, background, scope and, for quota windows, the title bar readout. */
function WidgetSettings({ config, onClose }: { config: WidgetConfig | null; onClose: () => void }) {
  const model = widgetModel(), type = config ? model.TYPES[config.type] : null, set = (patch: Partial<WidgetConfig>) => { if (config) changeWidgets((m, s) => m.update(s, config.key, patch)); };
  const agents = Object.entries(getGlobals().agentCatalog.agents).filter(([, meta]) => !meta.custom).map(([id, meta]) => ({ value: id, label: meta.name }));
  return <Sheet open={Boolean(config)} onOpenChange={open => { if (!open) onClose(); }} title={type?.name ?? "小组件"} placement="right" size="sm"
    footer={config ? <Button variant="secondary" onClick={() => { changeWidgets((m, s) => m.remove(s, config.key)); onClose(); }}>移除这个小组件</Button> : null}>
    {config && type ? <div className="flex flex-col gap-5" data-widget-settings={config.type}>
      <label className="flex flex-col gap-2"><span className="text-caption text-muted-foreground">尺寸</span>
        <Segmented value={config.size} onChange={size => set({ size })} aria-label="尺寸" items={model.SIZES.map(size => ({ value: size, label: SIZE_NAMES[size] }))} /></label>
      <label className="flex flex-col gap-2"><span className="text-caption text-muted-foreground">颜色</span>
        <Segmented value={config.color} onChange={color => set({ color })} aria-label="颜色" items={model.COLORS.map(color => ({ value: color, label: COLOR_NAMES[color] }))} /></label>
      <label className="flex flex-col gap-2"><span className="text-caption text-muted-foreground">背景</span>
        <Segmented value={config.background} onChange={background => set({ background })} aria-label="背景" items={model.BACKGROUNDS.map(background => ({ value: background, label: BACKGROUND_NAMES[background] }))} /></label>
      <label className="flex flex-col gap-2"><span className="text-caption text-muted-foreground">Agent</span>
        <Select value={config.agent} onChange={agent => set({ agent })} aria-label="小组件的 Agent 范围" options={[{ value: "all", label: "全部 Agent" }, ...agents]} /></label>
      {type.periods.length ? <label className="flex flex-col gap-2"><span className="text-caption text-muted-foreground">{config.type === "usage.week" ? "指标" : "时间"}</span>
        <Select value={config.period ?? type.periods[0]} onChange={period => set({ period })} aria-label="小组件的时间范围" options={type.periods.map(period => ({ value: period, label: PERIOD_NAMES[period] ?? period }))} /></label> : null}
      {type.readout ? <Switch checked={config.readout} onChange={readout => set({ readout })} label="在标题栏显示读数" /> : null}
    </div> : null}
  </Sheet>;
}

/** The widget library by category; each preview is the widget itself with the current data. */
function Gallery({ open, onClose }: { open: boolean; onClose: () => void }) {
  const model = widgetModel(), [category, setCategory] = useState<string>("all"), state = useWidgetState(), layout = model.activeLayout(state);
  const types = (Object.keys(model.TYPES) as WidgetType[]).filter(type => category === "all" || model.TYPES[type].category === category), full = layout.widgets.length >= model.MAX_WIDGETS;
  return <Sheet open={open} onOpenChange={value => { if (!value) onClose(); }} title="添加小组件" placement="right" size="lg" scrollable>
    <Segmented value={category} onChange={setCategory} aria-label="小组件分类" items={[{ value: "all", label: "全部" }, ...model.CATEGORIES.map(([value, label]) => ({ value, label }))]} />
    <div className="flex flex-col gap-6 pt-2" data-widget-gallery>
      {types.map(type => {
        const count = layout.widgets.filter(item => item.type === type).length;
        return <div key={type} className="flex flex-col gap-2" data-gallery-type={type}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-body font-semibold">{model.TYPES[type].name}<span className="pl-2 text-caption font-normal text-muted-foreground">{model.CATEGORIES.find(([key]) => key === model.TYPES[type].category)?.[1]}</span></span>
            <Button variant={count ? "secondary" : "primary"} size="compact" leadingIcon={IconPlus} disabled={full} onClick={() => changeWidgets((m, s) => m.add(s, type))}>{count ? "再添加一个" : "添加"}</Button>
          </div>
          <div inert className="w-full max-w-80"><Widget config={{ key: "preview-" + type, type, size: "m", color: "agent", background: "plain", agent: "all", period: model.TYPES[type].periods[0] ?? null, readout: false }} /></div>
        </div>;
      })}
    </div>
  </Sheet>;
}

// The widget board on 概览 (owner 2026-10-29, UI-POLISH-M10-20261029.md: the customizable widgets move from
// the right column to the home page), in the person's saved layout, flowing down columns so widgets of
// different heights pack without gaps. 编辑 shows the tools: drag (or Alt + arrow) to reorder, S/M/L,
// settings, remove, the library.
// A widget opens the page it summarizes; the quota widgets, already on 概览, bring the Agent cards into view.
const PAGE_OF: Record<string, string> = { cost: "cost", usage: "usage", sessions: "sessions", agents: "sources" };
function openFor(type: WidgetType) {
  const page = PAGE_OF[widgetModel().TYPES[type].category];
  if (page) showView(page as Parameters<typeof showView>[0]);
  else document.getElementById("quotaCards")?.scrollIntoView({ block: "start", behavior: document.body.dataset.motion === "full" ? "smooth" : "auto" });
}
export function WidgetBoard() {
  const state = useWidgetState(), model = widgetModel(), layout = model.activeLayout(state), [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState<string | null>(null), [gallery, setGallery] = useState(false);
  const chosen = layout.widgets.find(item => item.key === settings) ?? null;
  const slot = (config: WidgetConfig, index: number) => <div className="mb-4 flex min-w-0 break-inside-avoid flex-col gap-1" data-widget-slot={config.key}>
    {editing ? <WidgetTools index={index}>
      <WidgetGrip />
      {model.SIZES.map(size => <WidgetTool key={size} label={"尺寸" + SIZE_NAMES[size]} pressed={config.size === size} onClick={() => changeWidgets((m, s) => m.update(s, config.key, { size }))}>{size.toUpperCase()}</WidgetTool>)}
      <span className="flex-1" />
      <WidgetTool label={"设置" + model.TYPES[config.type].name} onClick={() => setSettings(config.key)}><IconSettings size={12} aria-hidden="true" /></WidgetTool>
      <WidgetTool label={"移除" + model.TYPES[config.type].name} onClick={() => changeWidgets((m, s) => m.remove(s, config.key))}><IconX size={12} aria-hidden="true" /></WidgetTool>
    </WidgetTools> : null}
    <WidgetPlace value={{ order: index, onOpen: editing ? undefined : () => openFor(config.type) }}><Widget config={config} /></WidgetPlace>
  </div>;
  return <section className="flex flex-col gap-3" aria-label="小组件" data-widget-board data-editing={editing || undefined}>
    <header className="flex h-9 items-center gap-2">
      <h2 className="text-subtitle font-semibold text-foreground">小组件</h2>
      {state.layouts.length > 1 ? <Select size="compact" value={state.active} onChange={id => changeWidgets((m, s) => m.activate(s, id))} aria-label="小组件布局" options={state.layouts.map(item => ({ value: item.id, label: item.name }))} /> : <span className="text-caption text-muted-foreground">{layout.name}</span>}
      <span className="flex-1" />
      <Button variant={editing ? "primary" : "secondary"} size="compact" onClick={() => setEditing(!editing)}>{editing ? "完成" : "编辑"}</Button>
    </header>
    <div className="ff-home-columns">
      {editing ? <Sortable aria-label="小组件顺序（按住拖动，或 Alt + 方向键）" onReorder={keys => changeWidgets((m, s) => m.reorder(s, keys))}
        items={layout.widgets.map((config, index) => ({ key: config.key, label: model.TYPES[config.type].name, node: slot(config, index) }))} />
        : layout.widgets.map((config, index) => <div key={config.key}>{slot(config, index)}</div>)}
      {editing || !layout.widgets.length ? <WidgetAddSlot onClick={() => setGallery(true)}><IconPlus size={16} aria-hidden="true" />添加小组件</WidgetAddSlot> : null}
    </div>
    <WidgetSettings config={chosen} onClose={() => setSettings(null)} />
    <Gallery open={gallery} onClose={() => setGallery(false)} />
  </section>;
}

// The reading a quota widget shows in the title bar when its eye is on. Opens the quota page.
export function TitleReadout() {
  const state = useWidgetState(), widget = widgetModel().readout(state), { grid } = useWidgetQuota();
  const reading = widget?.type === "quota.windows" ? quotaReadout(grid, widget.agent) : null;
  // The widget button carries a dot while a quota connection needs attention.
  useEffect(() => { window.uiShell?.summaryAttention(grid.warned.length, grid.warned.length + " 个额度连接需要处理"); }, [grid.warned.length]);
  if (!reading) return null;
  return <Button variant="ghost" size="compact" trimLabel={false} aria-label={"额度读数：" + reading.label} onClick={() => showView("quota")}>
    <span className="inline-flex items-center gap-2" data-title-readout><AgentMark agent={reading.agent} variant="icon" size={16} /><span className="tabular-nums">{reading.text}</span></span>
  </Button>;
}

declare global { interface Window { uiShell?: { summaryAttention(count: number, label: string): void; reading(open: boolean): void } } }
