import { useState, type ReactNode } from "react";
import { IconSettings, IconRefresh, IconDatabase } from "@tabler/icons-react";
import { Button, Segmented, Select, Combobox, TextField, SearchField, Form, FileButton, Sheet, SettingRow, Card, SectionHeader, Value, ListRow, DataTable, CodeBlock, ScrollArea, Avatar, Meter } from "@ui/kit";

const noop = () => {};
const choices = [{ value: "codex", label: "Codex" }, { value: "claude", label: "Claude Code" }, { value: "gemini", label: "Gemini CLI" }];
const models = Array.from({ length: 24 }, (_, index) => ({ value: "provider/model-" + (index + 1), label: "合成模型 " + (index + 1), description: index % 3 ? "官方目录" : "手动价格" }));
type PriceRow = { key: string; model: string; rate: string | null };
const priceRows: PriceRow[] = [{ key: "a", model: "合成模型 A", rate: "1.25" }, { key: "b", model: "合成模型 B", rate: null }, { key: "c", model: "合成模型 C", rate: "0" }];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="flex flex-col gap-3"><SectionHeader title={title} />{children}</section>;
}

// M3k additions (docs/m2/UI-MIG-M1-M3-REVIEW-20261025.md section 3). Synthetic data only.
export function M3kGallery() {
  const [category, setCategory] = useState("general"), [lockedSelect, setLockedSelect] = useState("codex");
  const [model, setModel] = useState<string | null>(null), [sheetModel, setSheetModel] = useState<string | null>("provider/model-2"), [comboSheet, setComboSheet] = useState(false);
  const [name, setName] = useState(""), [rate, setRate] = useState("0"), [submitted, setSubmitted] = useState("尚未提交"), [search, setSearch] = useState("");
  const [file, setFile] = useState("尚未选择文件"), [picks, setPicks] = useState(0), [tone, setTone] = useState<"indigo" | "teal" | "coral">("indigo");
  const [opened, setOpened] = useState("尚未打开"), [coverage, setCoverage] = useState(0.6);
  return <>
    <Group title="M3k 分段禁用、下拉禁用与可搜索下拉 Combobox">
      <div data-case="segmented-disabled"><Segmented value={category} onChange={setCategory} aria-label="合成分类" items={[{ value: "general", label: "常规", icon: IconSettings }, { value: "collection", label: "采集", icon: IconRefresh }, { value: "pricing", label: "定价", icon: IconDatabase, disabled: true }]} /></div>
      <div className="flex flex-wrap items-center gap-3">
        <div data-case="select-disabled"><Select value={lockedSelect} onChange={setLockedSelect} options={choices} disabled aria-label="已禁用 Agent" /></div>
        <div data-case="combobox"><Combobox value={model} onChange={setModel} options={models} placeholder="选择合成模型" searchPlaceholder="搜索模型" emptyText="没有匹配的模型" aria-label="合成模型" /></div>
        <Combobox value="provider/model-1" onChange={noop} options={models} placeholder="选择合成模型" searchPlaceholder="搜索模型" emptyText="没有匹配的模型" size="compact" disabled aria-label="已禁用模型" />
        <Button variant="secondary" onClick={() => setComboSheet(true)}>在弹窗中选择</Button>
        <span className="text-caption text-muted-foreground" data-combobox-result>{model ?? "尚未选择"}</span>
      </div>
      <Sheet open={comboSheet} onOpenChange={setComboSheet} size="lg" title="弹窗中的可搜索下拉" description="Escape 只关闭下拉，弹窗保持打开。">
        <div data-case="combobox-sheet"><Combobox value={sheetModel} onChange={setSheetModel} options={models} placeholder="选择合成模型" searchPlaceholder="搜索模型" emptyText="没有匹配的模型" aria-label="弹窗合成模型" /></div>
      </Sheet>
    </Group>
    <Group title="M3k 表单 Form、输入属性与搜索">
      <div data-case="form"><Form onSubmit={() => setSubmitted("已提交：" + name + " / " + rate)} aria-label="合成表单">
        <div className="grid grid-cols-2 gap-3">
          <TextField value={name} onChange={setName} label="名称（必填）" required maxLength={48} name="name" />
          <TextField value={rate} onChange={setRate} label="每百万 Token 费率" type="number" min={0} max={100000} step="any" inputMode="decimal" name="rate" />
          <TextField value="只读示例" onChange={noop} label="只读输入" readOnly />
          <TextField value="" onChange={noop} label="禁用输入" disabled />
        </div>
        <div className="flex items-center gap-3"><Button variant="primary" type="submit">提交合成表单</Button><span className="text-caption text-muted-foreground" data-form-result>{submitted}</span></div>
      </Form></div>
      <div data-case="search-limited"><SearchField value={search} onChange={setSearch} placeholder="搜索设置项" maxLength={60} aria-label="限长搜索" /></div>
    </Group>
    <Group title="M3k 设置行 SettingRow、带标题的 Card 与头像 Avatar">
      <Card title="个人资料" meta="只保存在本机">
        <div>
          <SettingRow title="头像与名称" description="只显示在本机" control={<Avatar initials="本" label="本机用户" tone={tone} size={40} />} />
          <SettingRow title="头像色调" control={<Segmented value={tone} onChange={setTone} aria-label="头像色调" size="compact" items={[{ value: "indigo", label: "靛蓝" }, { value: "teal", label: "青绿" }, { value: "coral", label: "珊瑚" }]} />} />
          <SettingRow title="照片" description={<span data-file-result>{file}</span>} control={<FileButton label="选择照片" accept="image/png,image/jpeg,image/webp" onFile={chosen => { setPicks(picks + 1); setFile(chosen.name + " · 第 " + (picks + 1) + " 次选择"); }} />} />
          <SettingRow title="没有控件的设置行" description="只展示说明文字。" />
        </div>
      </Card>
      <div className="flex flex-wrap items-center gap-3" data-case="avatars">
        {(["indigo", "teal", "coral"] as const).map(entry => ([24, 40, 64] as const).map(size => <Avatar key={entry + size} initials="合" label={"合成头像 " + entry + " " + size} tone={entry} size={size} />))}
        <Avatar initials="照" label="合成照片头像" tone="indigo" size={40} photo="assets/agents/codex.svg" />
      </div>
    </Group>
    <Group title="M3k 覆盖进度 Meter、代码块 CodeBlock、滚动区 ScrollArea 与表格行">
      <div className="flex flex-col gap-3" data-case="meter">
        <Meter aria-label="合成覆盖：已计价、可补价格、用量缺失" segments={[{ value: coverage, tone: "done", label: "已计价" }, { value: 0.25, tone: "warn", label: "可补价格" }, { value: 0.15, tone: "muted", label: "用量缺失" }]} />
        <div className="flex items-center gap-3"><Button variant="secondary" onClick={() => setCoverage(coverage === 0.6 ? 0.3 : 0.6)}>更新覆盖</Button><Value value={null} /></div>
      </div>
      <CodeBlock aria-label="合成 JSON 预览" text={JSON.stringify({ schemaVersion: "LocalUsagePreviewV1", rows: 3, totals: { tokens: 1200, estimatedCostUsd: null }, sources: ["codex", "claude"] }, null, 2)} />
      <div data-case="scroll-area"><ScrollArea maxHeight="sm" aria-label="合成长列表">{Array.from({ length: 16 }, (_, index) => <ListRow key={index} title={"合成行 " + (index + 1)} onClick={() => setOpened("已打开合成行 " + (index + 1))} trailing={<Value value={index % 4 ? String(index * 10) : null} />} />)}</ScrollArea></div>
      <div data-case="scroll-short"><ScrollArea maxHeight="sm" aria-label="合成短列表"><ListRow title="只有一行" /></ScrollArea></div>
      <div data-case="table-rows"><DataTable<PriceRow> rowKey={row => row.key} onRowClick={row => setOpened("整行打开：" + row.model)}
        columns={[{ key: "model", label: "模型", render: row => <Button variant="ghost" size="compact" onClick={() => setOpened("按钮打开：" + row.model)}>{row.model}</Button> },
          { key: "rate", label: "输入费率", headerTitle: "每百万 Token 美元", title: row => row.rate == null ? "费率未知" : "输入 " + row.rate + " 美元", render: row => <Value value={row.rate} unknown="未定价" /> }]}
        rows={priceRows} /></div>
      <span className="text-caption text-muted-foreground" data-row-result>{opened}</span>
    </Group>
  </>;
}
