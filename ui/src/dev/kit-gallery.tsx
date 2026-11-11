import { useState, type ReactNode } from "react";
import { IconPlus, IconArrowRight, IconDots } from "@tabler/icons-react";
import { Button, IconButton, Segmented, SubTabs, Select, Menu, Switch, CheckboxGroup, RadioGroup, Slider, TextField, SearchField, Sheet, Disclosure, Badge, Banner, DataTable, ListRow, Card, PageHeader, SectionHeader, Value, Figure, AgentMark, EmptyState, Toast, toast, CarouselDots } from "@ui/kit";
import { M3kGallery } from "./kit-gallery-m3k";
import { MkaGallery } from "./kit-gallery-mka";
import { M4Gallery } from "./kit-gallery-m4";
import { MkbGallery } from "./kit-gallery-mkb";
import { M8Gallery } from "./kit-gallery-m8";

const noop = () => {};
const choices = [{ value: "codex", label: "Codex" }, { value: "claude", label: "Claude Code" }, { value: "gemini", label: "Gemini CLI" }];
function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="flex flex-col gap-3"><SectionHeader title={title} />{children}</section>;
}

// Review-only island. Every input and label is synthetic; it never calls a bridge.
export function KitGallery() {
  const [period, setPeriod] = useState("7d"), [compactPeriod, setCompactPeriod] = useState("today"), [subTab, setSubTab] = useState(0);
  const [selected, setSelected] = useState("codex"), [compactSelected, setCompactSelected] = useState("claude"), [placeholder, setPlaceholder] = useState("");
  const [checked, setChecked] = useState(true), [unchecked, setUnchecked] = useState(false);
  const [multi, setMulti] = useState(["codex"]), [radio, setRadio] = useState("claude"), [slider, setSlider] = useState(40);
  const [text, setText] = useState("合成示例"), [number, setNumber] = useState("42"), [search, setSearch] = useState("合成搜索"), [emptySearch, setEmptySearch] = useState("");
  const [sheet, setSheet] = useState<"sm" | "lg" | "xl" | null>(null), [disclosure, setDisclosure] = useState(false), [row, setRow] = useState(false), [slide, setSlide] = useState(0);
  const [figure, setFigure] = useState("1234.56"), [menuResult, setMenuResult] = useState("尚未执行操作");
  return <div className="flex flex-col gap-6 bg-background p-6 font-sans text-body text-foreground" data-kit-gallery>
    <M8Gallery />
    <PageHeader title="组件展示" description="M1 审核 · 全部为合成数据 · 不连接账号、不读取来源" actions={<Badge tone="neutral">仅供审核</Badge>} />
    <div className="flex flex-col gap-8">
      <Group title="按钮 Button">
        {(["primary", "secondary", "tertiary", "ghost"] as const).map(variant => <div key={variant} className="flex flex-wrap items-center gap-3" data-case={`button-${variant}`}>
          <Button variant={variant} onClick={noop}>{variant} · 默认</Button>
          <Button variant={variant} disabled onClick={noop}>{variant} · 禁用</Button>
          <Button variant={variant} loading onClick={noop}>{variant} · 加载中</Button>
          <Button variant={variant} size="compact" onClick={noop}>{variant} · 紧凑</Button>
        </div>)}
        <div className="flex items-center gap-3"><Button variant="ghost" tone="danger" onClick={noop}>断开连接</Button><Button variant="secondary" leadingIcon={IconPlus} trailingIcon={IconArrowRight} onClick={noop}>添加示例</Button></div>
      </Group>
      <Group title="图标按钮 IconButton"><div className="flex items-center gap-3">
        <IconButton icon={IconPlus} label="添加默认示例" onClick={noop} /><IconButton icon={IconPlus} label="添加紧凑示例" size="compact" onClick={noop} /><IconButton icon={IconPlus} label="禁用示例" disabled onClick={noop} />
      </div></Group>
      <Group title="分段切换 Segmented 与轻量分类 SubTabs">
        <Segmented value={period} onChange={setPeriod} items={[{ value: "today", label: "今日" }, { value: "7d", label: "7 天" }, { value: "30d", label: "30 天" }]} aria-label="默认范围" />
        <Segmented value={compactPeriod} onChange={setCompactPeriod} size="compact" items={[{ value: "today", label: "今日", icon: IconPlus }, { value: "7d", label: "7 天" }]} aria-label="紧凑范围" />
        <SubTabs value={subTab} onChange={setSubTab} items={["全部", "需要处理", "已连接"]} idPrefix="kit-review" />
      </Group>
      <Group title="下拉单选 Select"><div className="flex flex-wrap items-center gap-3">
        <div data-case="select-default"><Select value={selected} onChange={setSelected} options={choices} aria-label="默认 Agent" /></div>
        <div data-case="select-compact"><Select value={compactSelected} onChange={setCompactSelected} options={choices} size="compact" aria-label="紧凑 Agent" /></div>
        <div data-case="select-placeholder"><Select value={placeholder} onChange={setPlaceholder} options={choices} placeholder="选择合成 Agent" aria-label="尚未选择 Agent" /></div>
      </div></Group>
      <Group title="操作菜单 Menu"><div className="flex items-center gap-3">
        <Menu trigger={<Button variant="secondary" onClick={noop}>打开操作菜单</Button>} items={[{ label: "查看合成记录", onSelect: () => setMenuResult("已查看合成记录") }, { label: "不可用操作", onSelect: noop, disabled: true }, { label: "断开合成连接", onSelect: () => setMenuResult("已断开合成连接"), tone: "danger" }]} />
        <Menu trigger={<IconButton icon={IconDots} label="更多合成操作" onClick={noop} />} items={[{ label: "图标菜单操作", onSelect: () => setMenuResult("已执行图标菜单操作") }]} />
        <span className="text-caption text-muted-foreground" data-menu-result>{menuResult}</span>
      </div></Group>
      <Group title="开关 Switch"><div className="flex flex-wrap items-center gap-3">
        <Switch checked={checked} onChange={setChecked} label="开启示例" /><Switch checked={unchecked} onChange={setUnchecked} label="关闭示例" />
        <Switch checked disabled onChange={noop} label="已开启且禁用" /><Switch checked={false} disabled onChange={noop} label="已关闭且禁用" />
      </div></Group>
      <Group title="多选 CheckboxGroup 与单选 RadioGroup"><div className="grid grid-cols-2 gap-3">
        <CheckboxGroup value={multi} onChange={setMulti} items={choices} /><CheckboxGroup value={["claude"]} onChange={noop} items={choices} disabled />
        <RadioGroup value={radio} onChange={setRadio} items={choices} /><RadioGroup value="gemini" onChange={noop} items={choices} disabled />
      </div></Group>
      <Group title="数值 Slider"><Slider value={slider} onChange={setSlider} min={0} max={100} step={10} label="合成阈值" /></Group>
      <Group title="输入 TextField 与搜索 SearchField"><div className="grid grid-cols-2 gap-3">
        <TextField value={text} onChange={setText} label="示例名称" /><TextField value="" onChange={noop} label="空输入" placeholder="填写示例名称" />
        <TextField value={number} onChange={setNumber} label="数字输入" type="number" /><TextField value="示例错误" onChange={noop} label="错误输入" error="请检查合成内容" />
        <SearchField value={search} onChange={setSearch} placeholder="搜索合成数据" aria-label="合成搜索" /><SearchField value={emptySearch} onChange={setEmptySearch} placeholder="尚未输入" aria-label="空搜索" />
      </div></Group>
      <Group title="弹窗 Sheet"><div className="flex items-center gap-3">{(["sm", "lg", "xl"] as const).map(size => <Button key={size} variant="secondary" onClick={() => setSheet(size)}>打开 {size} 弹窗</Button>)}</div>
        <Sheet open={sheet !== null} onOpenChange={open => { if (!open) setSheet(null); }} size={sheet ?? "sm"} title="合成详情" description="仅供组件审核，不读取本机数据。" footer={<Button variant="primary" onClick={() => setSheet(null)}>完成</Button>}>
          <ListRow title="剩余额度" trailing={<Value value={null} />} /><ListRow title="精确余额" trailing={<Value value="0.10000000000000000001" />} />
        </Sheet>
      </Group>
      <Group title="展开收起 Disclosure">
        <Disclosure open={disclosure} onOpenChange={setDisclosure} summary="展开合成详情"><p className="text-body">这是受控的合成内容。</p></Disclosure>
        <Disclosure defaultOpen summary="默认展开的合成详情"><p className="text-body">这是默认展开的合成内容。</p></Disclosure>
      </Group>
      <Group title="状态 Badge 与通知 Banner"><div className="flex items-center gap-3"><Badge tone="neutral">已保存</Badge><Badge tone="warn">窗口已用尽</Badge></div>
        <div data-case="banner-info"><Banner tone="info" title="合成提示">正在加载合成数据。</Banner></div>
        <div data-case="banner-warn"><Banner tone="warn" title="窗口已用尽" action={<Button variant="ghost" onClick={noop}>查看详情</Button>}>等待窗口重置。</Banner></div>
        <div data-case="banner-error"><Banner tone="error" title="合成错误" action={<Button variant="secondary" onClick={noop}>重试</Button>}>读取失败，请重试。</Banner></div>
      </Group>
      <Group title="表格 DataTable 与列表行 ListRow">
        <DataTable columns={[{ key: "name", label: "合成记录", render: (row: { name: string; value: string | null }) => row.name }, { key: "value", label: "原始精确值", render: (row: { name: string; value: string | null }) => <Value value={row.value} /> }]} rows={[{ name: "精确余额", value: "0.10000000000000000001" }, { name: "未知额度", value: null }, { name: "部分数据", value: "12+" }]} rowKey={row => row.name} />
        <ListRow leading={<AgentMark agent="codex" variant="icon" />} title="默认行" meta="合成说明" trailing={<Value value="12+" />} />
        <ListRow title="选中行" meta="可用键盘操作" onClick={() => setRow(!row)} selected={row} trailing={<Value value={null} />} />
      </Group>
      <Group title="面板 Card 与标题"><div className="grid grid-cols-2 gap-3"><Card><div className="flex flex-col gap-3"><SectionHeader title="默认面板" /><Value value="合成内容" /></div></Card><Card compact><SectionHeader title="紧凑面板" /></Card></div></Group>
      <Group title="数值 Value 与 Figure"><div className="flex flex-wrap items-baseline gap-3" data-case="values">
        <Value value="0" /><Value value={null} /><Value value={undefined} /><Value value={null} unknown="未定价" /><Value value="0.10000000000000000001" /><Value value="至多 12.34" />
      </div><div className="flex flex-wrap items-baseline gap-3" data-case="figures">
        <Figure text={figure} size="xl" unit="积分" /><Figure text="234.56" size="lg" unit="美元" /><Figure text="12+" size="md" /><Figure text="0" size="sm" /><Figure text={null} size="md" /><Figure text={null} size="sm" unknown="未定价" />
      </div><div className="flex items-center gap-3"><Button variant="secondary" onClick={() => setFigure(figure === "1234.56" ? "9876.54" : "1234.56")}>更新同位数</Button><Button variant="secondary" onClick={() => setFigure("12.34")}>更新位数</Button></div></Group>
      <Group title="AgentMark 身份图标与圆点"><div className="flex flex-wrap items-center gap-3">{choices.map(agent => <div key={agent.value} className="flex items-center gap-2">{([16, 20, 24] as const).map(size => <span key={size} className="inline-flex items-center gap-2"><AgentMark agent={agent.value} variant="icon" size={size} /><AgentMark agent={agent.value} variant="dot" size={size} /></span>)}<span>{agent.label}</span></div>)}</div>
        <div className="flex items-center gap-3">{["opencode", "workbuddy", "mimo", "cursor", "zcode", "deepseek", "antigravity"].map(agent => <div className="flex items-center gap-2" key={agent}><AgentMark agent={agent} variant="icon" /><AgentMark agent={agent} variant="dot" /></div>)}</div>
      </Group>
      <Group title="空状态 EmptyState"><EmptyState message="暂无合成记录" /><EmptyState message="尚未添加示例" action={<Button variant="secondary" onClick={noop}>添加示例</Button>} /></Group>
      <M3kGallery />
      <MkaGallery />
      <M4Gallery />
      <MkbGallery />
      <Group title="底部提示 Toast"><div className="flex items-center gap-3"><Button variant="secondary" onClick={() => toast.show("合成操作已保存")}>显示普通提示</Button><Button variant="secondary" onClick={() => toast.show("合成窗口已用尽", { tone: "warn" })}>显示警示提示</Button></div></Group>
      <Group title="翻页圆点 CarouselDots"><CarouselDots count={3} value={slide} onValueChange={setSlide} getLabel={index => ["现在", "接下来", "余额"][index]} /><p className="text-caption text-muted-foreground">当前页：{["现在", "接下来", "余额"][slide]}</p></Group>
    </div><Toast />
  </div>;
}
