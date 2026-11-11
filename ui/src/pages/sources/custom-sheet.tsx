import { Button, Combobox, Disclosure, SectionHeader, Select, SettingRow, Sheet, TextArea, TextField, Value } from "@ui/kit";
import { sourcesModel, useSourcesHost } from "@ui/data";
export function CustomSheet({
  open,
  onClose
}: {
  open: boolean;
  onClose(): void;
}) {
  const host = useSourcesHost(),
    custom = host.custom(),
    form = custom.form,
    model = sourcesModel(),
    change = host.customField,
    steps = ["格式与目录", "记录字段", "计数方式", "解析预览", "保存启用"],
    summary = custom.preview?.summary;
  return <Sheet
    scrollable
    open={open}
    onOpenChange={next => {
      if (!next && !custom.busy) onClose();
    }}
    title={"第 " + (custom.step + 1) + " / 5 步 · " + steps[custom.step]}
    description={custom.editing ? "编辑来源规则" : "添加我的 Agent"}
    size="lg"
    footer={<>
      <p
        role="status"
        data-custom-status
      >{custom.message}</p>
      <div className="flex gap-2">
        {custom.step > 0 ? <Button
          variant="secondary"
          disabled={custom.busy}
          onClick={() => {
            void host.customAction("back");
          }}
        >上一步</Button> : null}
        <Button
          variant="primary"
          disabled={custom.busy || !form}
          onClick={() => {
            void host.customAction("next");
          }}
        >{custom.step === 2 ? "生成完整预览" : custom.step === 4 ? "保存并启用" : "下一步"}</Button>
      </div>
    </>}
  >
    {form ? <div
      aria-busy={custom.busy}
      className="flex flex-col gap-3"
    >
      {custom.step === 0 ? <>
        <SectionHeader title="选择格式与读取位置" />
        {!custom.editing ? <div className="flex flex-col gap-2">
          <p>已有导出的解析配置？导入后仍需选择读取目录并预览。</p>
          <Button
            variant="tertiary"
            disabled={custom.busy}
            onClick={() => {
              void host.customAction("import");
            }}
          >导入配置文件</Button>
        </div> : null}
        <TextField
          label="来源名称"
          value={form.name}
          onChange={value => change("name", value)}
          maxLength={80}
          required
          disabled={custom.busy}
        />
        <Select
          aria-label="记录格式"
          value={form.template}
          onChange={value => change("template", value)}
          options={[{
            value: "standard",
            label: "标准用量事件 JSONL"
          }, {
            value: "claude",
            label: "Claude JSONL 格式"
          }, {
            value: "mapped",
            label: "自定义字段映射"
          }]}
          disabled={custom.busy}
        />
        <p>新来源在完成预览前不会开始采集。每条记录需要稳定调用 ID 和时间。</p>
        <Button
          variant="secondary"
          disabled={custom.busy}
          onClick={() => {
            void host.customAction("choose");
          }}
        >选择本地用量目录</Button>
        <p
          data-custom-location
          role="status"
        >{custom.location}</p>
      </> : null}
      {custom.step === 1 ? <>
        <SectionHeader title="选择记录字段" />
        {form.template === "mapped" ? <>
          <Button
            variant="secondary"
            disabled={custom.busy}
            onClick={() => {
              void host.customAction("sample");
            }}
          >读取字段结构</Button>
          <p data-custom-sample-info>{custom.sampleInfo}</p>
          {Object.entries(model.labels).map(([key, label]) => <div
            key={key}
            data-custom-map={key}
            className="flex flex-col gap-2"
          >
            <span className="text-caption text-muted-foreground">{label}</span>
            <Combobox
              value={form.mapping[key] || null}
              allowCustom
              onChange={value => change("mapping:" + key, value)}
              options={custom.fields.map(field => ({
                value: field.path,
                label: field.path,
                description: field.type + (field.example === null ? "" : " · " + field.example)
              }))}
              aria-label={label}
              placeholder="选择字段路径"
              searchPlaceholder="搜索或输入字段路径"
              emptyText="没有匹配字段"
              disabled={custom.busy}
            />
          </div>)}
          <Disclosure summary="记录过滤（可选）">
            <p>只保留字段符合条件的行；多个条件同时满足。允许值可填写一组 JSON 字符串、数字或布尔值。</p>
            <TextArea
              label="记录过滤配置"
              value={form.filters}
              onChange={value => change("filters", value)}
              rows={6}
              mono
              spellCheck={false}
              disabled={custom.busy}
            />
            <p>示例：[{`{"path":"role","values":["assistant"]}`}]</p>
          </Disclosure>
        </> : <p>此格式使用固定字段，无需逐项填写。</p>}
      </> : null}
      {custom.step === 2 ? <>
        <SectionHeader title="确认计数方式" />
        <Select
          aria-label="用量记录方式"
          value={form.mode}
          onChange={value => change("mode", value)}
          options={[{
            value: "per-request",
            label: "每次调用独立用量"
          }, {
            value: "cumulative",
            label: "累计快照（首版不支持）"
          }, {
            value: "session-summary",
            label: "会话汇总（首版不支持）"
          }]}
          disabled={custom.busy}
        />
        {form.template === "mapped" ? <>
          <Select
            aria-label="输入 Token 是否包含缓存？"
            value={form.input || "unselected"}
            onChange={value => change("input", value === "unselected" ? "" : value)}
            options={[{
              value: "unselected",
              label: "请选择"
            }, {
              value: "inclusive",
              label: "已经包含缓存读取和写入"
            }, {
              value: "exclusive",
              label: "不包含缓存，分别相加"
            }]}
            disabled={custom.busy}
          />
          <Select
            aria-label="输出 Token 是否包含推理？"
            value={form.reason || "unselected"}
            onChange={value => change("reason", value === "unselected" ? "" : value)}
            options={[{
              value: "unselected",
              label: "请选择"
            }, {
              value: "yes",
              label: "已经包含推理"
            }, {
              value: "no",
              label: "不包含推理，分别相加"
            }]}
            disabled={custom.busy}
          />
          <Select
            aria-label="时间格式"
            value={form.time}
            onChange={value => change("time", value)}
            options={[{
              value: "iso",
              label: "带时区的 ISO 日期"
            }, {
              value: "ms",
              label: "Unix 毫秒"
            }, {
              value: "s",
              label: "Unix 秒"
            }]}
            disabled={custom.busy}
          />
        </> : <p>{form.template === "claude" ? "Claude 格式：输入不含缓存，输出包含推理。" : "标准事件：输入包含缓存，输出包含推理。"}</p>}
        <p>没有报告的用量保持未知；模型费用统一估算，不代表实际账单。</p>
      </> : null}
      {custom.step === 3 && summary ? <>
        <SectionHeader title="核对解析预览" />
        <div data-custom-preview>
          {model.previewRows(summary).map(([label, value]) => <SettingRow
            key={label}
            title={label}
            control={<Value value={value === null ? null : model.count(value)} />}
          />)}
        </div>
        {summary.errors.length ? <p>{summary.errors.join(" · ")}</p> : null}
        <p>读取失败或已缺失文件的历史会保留。修改规则后，这部分可能仍使用旧规则。</p>
      </> : null}
      {custom.step === 4 && summary ? <>
        <SectionHeader title="保存并启用" />
        <p>{form.name}：{model.count(summary.records)} 次调用，{model.count(summary.totalTokens)} Token。启用后按设置定期检查。</p>
        <p>配置与来源统计一次保存。只读取选定目录，不修改 Agent 文件；移除来源仍保留历史。</p>
      </> : null}
    </div> : null}
  </Sheet>;
}
