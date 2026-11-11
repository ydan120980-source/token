import { useState } from "react";
import { AgentFilter, Button, Combobox, CopyButton, Disclosure, Form, SectionHeader, Sheet, StackBar, StatusDot, TextArea, TextField, Value } from "@ui/kit";

const agents = [{ id: "codex", name: "Codex", recorded: true }, { id: "claude", name: "Claude Code", recorded: true }, { id: "gemini", name: "Gemini CLI", recorded: false }];
const noop = () => {};
export function MkaGallery() {
  const [text, setText] = useState("原值"), [commits, setCommits] = useState<string[]>([]), [secret, setSecret] = useState("");
  const [area, setArea] = useState("{\n  \"synthetic\": true\n}"), [areaSubmit, setAreaSubmit] = useState(0), [choice, setChoice] = useState<string | null>(null), [custom, setCustom] = useState<string | null>(null);
  const [icon, setIcon] = useState("all"), [chip, setChip] = useState("all"), [opened, setOpened] = useState(false), [actions, setActions] = useState(0);
  const [copyFail, setCopyFail] = useState(false), [copies, setCopies] = useState(0), [progress, setProgress] = useState(.4), [active, setActive] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false), [sheetText, setSheetText] = useState("焦点值");
  return <section className="flex flex-col gap-8" data-mka-gallery>
    <SectionHeader title="MK-a 控件扩展" description="全部使用合成值，不连接或写入真实数据。" />
    <div className="flex flex-col gap-3" data-case="mka-fields">
      <TextField value={text} onChange={setText} onCommit={next => setCommits(old => [...old, next])} label="提交输入" autoComplete="off" spellCheck={false} />
      <span data-mka-commits>{JSON.stringify(commits)}</span>
      <TextField value={secret} onChange={setSecret} type="password" label="合成凭据" autoComplete="new-password" spellCheck={false} maxLength={16384} />
      <TextField value="bad space" onChange={noop} pattern="[a-z]+" label="格式约束" autoComplete="off" error="只接受小写字母" />
      <Button variant="secondary" onClick={() => setSheetOpen(true)}>打开提交输入弹窗</Button>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="提交输入弹窗"><TextField value={sheetText} onChange={setSheetText} onCommit={next => setCommits(old => [...old, next])} label="弹窗草稿" /></Sheet>
    </div>
    <div className="flex flex-col gap-3" data-case="mka-area"><Form aria-label="合成多行表单" onSubmit={() => setAreaSubmit(old => old + 1)}>
      <TextArea label="合成 JSON 过滤" value={area} onChange={setArea} rows={6} mono spellCheck={false} maxLength={4096} />
      <TextArea label="三行说明" value="" onChange={noop} rows={3} placeholder="输入多行说明" />
      <TextArea label="禁用多行" value="不可编辑" onChange={noop} rows={3} disabled />
      <TextArea label="错误多行" value="{" onChange={noop} rows={6} mono error="合成 JSON 格式有误" />
      <Button variant="secondary" type="submit">提交多行表单</Button><span data-mka-area-submits>{areaSubmit}</span>
    </Form></div>
    <div className="flex flex-wrap gap-3" data-case="mka-combobox">
      <Combobox value={choice} onChange={setChoice} options={[{ value: "known", label: "已有字段" }]} placeholder="选择或输入字段" searchPlaceholder="输入自定义字段" emptyText="没有字段" allowCustom aria-label="自由字段" />
      <Combobox value={custom} onChange={setCustom} options={[]} placeholder="选择自定义值" searchPlaceholder="输入新路径" emptyText="没有路径" allowCustom customLabel={value => "采用路径：" + value} aria-label="自由路径" />
      <span data-mka-custom>{choice}</span><span data-mka-custom-label>{custom}</span>
    </div>
    <Disclosure open={opened} onOpenChange={setOpened} summary="独立动作的项目" actions={<Button variant="ghost" onClick={() => setActions(old => old + 1)}>项目独立动作</Button>}>
      <p>只由项目触发按钮展开。</p>
    </Disclosure><span data-mka-actions>{actions}</span>
    <div className="flex flex-col gap-3" data-case="mka-agents">
      <AgentFilter agents={agents} value={icon} onChange={setIcon} display="icon" allLabel="全部 Agent" aria-label="图标 Agent 筛选" />
      <AgentFilter agents={agents} value={chip} onChange={setChip} display="chip" aria-label="名称 Agent 筛选" />
      <span data-mka-agent-result>{icon + "/" + chip}</span>
    </div>
    <div className="flex flex-wrap items-center gap-3" data-case="mka-copy">
      <CopyButton label="复制合成路径" onCopy={async () => { setCopies(old => old + 1); return !copyFail; }} />
      <CopyButton label="复制紧凑合成路径" size="compact" onCopy={async () => true} />
      <CopyButton label="延迟复制合成值" onCopy={() => new Promise(resolve => setTimeout(() => resolve(true), 300))} />
      <Button variant="secondary" onClick={() => setCopyFail(!copyFail)}>切换复制失败</Button><span data-mka-copy-count>{copies}</span>
      <StatusDot tone="active" label="合成活跃会话" />
    </div>
    <div className="flex flex-col gap-3" data-case="mka-stacks">
      <StackBar segments={[{ key: "progress", value: progress, tone: "muted", label: "合成安装进度" }]} height={18} aria-label="合成安装进度条" />
      <StackBar segments={[]} unknown height={12} steps={30} aria-label="未知额度条" />
      <StackBar segments={[{ key: "zero", value: 0, tone: "muted", label: "明确的零" }]} height={8} aria-label="明确为零的额度条" />
      <StackBar segments={[{ key: "inline", value: .6, tone: "accent", label: "会话消耗 60%" }]} height={4} width="inline" aria-label="会话消耗条" />
      <StackBar segments={[{ key: "quota", value: .55, tone: "agent:codex", label: "合成 Codex 55%" }]} height={12} steps={16} markers={[{ key: "time", at: .7, kind: "time", label: "时间剩余70%" }]} aria-label="分段额度条" />
      <StackBar segments={[{ key: "cost", value: .3, tone: "series:claude", label: "已计价" }, { key: "range", value: .2, tone: "series:claude", pattern: "hatched", label: "估算上界" }, { key: "light", value: .1, tone: "series:claude", pattern: "light", label: "浅色区间" }]} height={8} markers={[{ key: "fee", at: .65, kind: "fee", label: "月费" }, { key: "today", at: .9, kind: "today", label: "今天" }]} active={active} onActiveChange={setActive} aria-label="费用上下界构成条" />
      <StackBar segments={[{ key: "input", value: .4, tone: "category:input", label: "输入" }, { key: "output", value: .3, tone: "category:output", label: "输出" }]} height={6} aria-label="Token 分类构成条" />
      <span data-mka-active>{active ?? "静止"}</span><Value value={null} />
      <Button variant="secondary" onClick={() => setProgress(progress === .4 ? .8 : .4)}>更新合成进度</Button>
    </div>
  </section>;
}
