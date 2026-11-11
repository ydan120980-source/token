import { useEffect, useState } from "react";
import { Button, Disclosure, EmptyState, ListRow, SectionHeader, Select, Sheet, TextField } from "@ui/kit";
import { useSourcesHost } from "@ui/data";
const editLabels: Record<string, string> = {
  type: "连接方式",
  command: "新命令",
  args: "新参数（JSON 字符串列表）",
  url: "新 HTTP(S) 地址",
  prompt: "新提示内容",
  server: "新 MCP 服务名",
  tool: "新工具名",
  timeout: "新超时（秒）",
  name: "新技能名称",
  description: "新技能描述"
};
export function ManagerSheet({
  open,
  onClose
}: {
  open: boolean;
  onClose(): void;
}) {
  const host = useSourcesHost(),
    manager = host.manager(),
    selection = manager.selection,
    kind = selection?.kind,
    view = manager.view,
    preview = manager.preview,
    [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) setValues({});
  }, [open]);
  const fields = kind === "mcp" ? ["type", "command", "args", "url"] : kind === "hooks" ? ["command", "prompt", "url", "server", "tool", "timeout"] : ["name", "description"];
  return <Sheet
    scrollable
    open={open}
    onOpenChange={next => {
      if (!next && !manager.busy) onClose();
    }}
    title={(selection ? host.catalog()[selection.agent].name : "Agent 配置") + " · " + (kind?.toUpperCase() || "")}
    description={selection?.scope === "home" ? "用户级 · 明确选择的范围" : "项目级 · 明确选择的范围"}
    size="xl"
    footer={<>
      <p
        role="status"
        data-manager-message
      >{manager.message}</p>
      {preview ? <>
        <p>{preview.normalization ? "保存后不保留 JSON／TOML 注释，可撤销恢复原文件。" : "点击应用前不会写入；应用前保存加密恢复记录。"}</p>
        <div className="flex gap-2">
          <span data-source-manager-action="apply">
            <Button
              variant="primary"
              disabled={manager.busy}
              onClick={() => {
                void host.managerAction("apply");
              }}
            >应用这次修改</Button>
          </span>
          <span data-source-manager-action="discard">
            <Button
              variant="tertiary"
              disabled={manager.busy}
              onClick={host.managerDiscard}
            >取消预览</Button>
          </span>
        </div>
      </> : null}
    </>}
  >
    {view ? <p>管理位置：{view.target}</p> : null}
    <p>现有命令、参数、环境变量和请求头值不显示；留空保留原值。</p>
    <div className="flex flex-wrap gap-2">
      <span data-source-manager-action="import">
        <Button
          variant="secondary"
          disabled={manager.busy || !view}
          onClick={() => {
            setValues({});
            void host.managerAction("import");
          }}
        >从本地导入</Button>
      </span>
      <span data-source-manager-action="undo">
        <Button
          variant="secondary"
          disabled={manager.busy || !manager.undoAvailable}
          onClick={() => {
            setValues({});
            void host.managerAction("undo");
          }}
        >撤销最近修改</Button>
      </span>
      <span data-source-manager-action="reload">
        <Button
          variant="secondary"
          disabled={manager.busy}
          onClick={() => {
            setValues({});
            void host.managerAction("reload");
          }}
        >重新读取</Button>
      </span>
    </div>
    {view && kind === "hooks" ? <>
      <p>本文件显式开关：{view.enabled === null ? "未设置" : view.enabled ? "启用" : "停用"}。不推断其他配置层或运行状态。</p>
      <div className="flex gap-2">
        {[true, false].map(enabled => <span
          key={String(enabled)}
          data-source-config-global={String(enabled)}
        >
          <Button
            variant="secondary"
            disabled={manager.busy}
            onClick={() => {
              void host.managerAction("toggle", {
                enabled
              });
            }}
          >{enabled ? "启用" : "停用"}本文件 hooks</Button>
        </span>)}
      </div>
    </> : view && kind === "mcp" && selection?.agent === "claude" ? <p>只调整项目 MCP 的拒绝列表。恢复不会自动授信，仍需客户端确认。</p> : view && kind === "skills" ? <p>启用表示目录位于此 Agent 的技能目录；其他覆盖、信任和运行状态由客户端决定。</p> : null}
    <div data-source-managed-rows>
      {view?.rows.map(row => <ListRow
        key={row.id}
        title={row.name}
        trailing={<>
          <span data-source-config-edit={row.id}>
            <Button
              variant="tertiary"
              disabled={manager.busy}
              onClick={() => {
                setValues({});
                host.managerEdit(row.id);
              }}
            >编辑</Button>
          </span>
          {kind !== "hooks" ? <span data-source-config-toggle={row.id}>
            <Button
              variant="tertiary"
              disabled={manager.busy}
              onClick={() => {
                void host.managerAction("toggle", {
                  row: row.id,
                  enabled: !row.enabled
                });
              }}
            >{row.enabled ? "停用" : "启用"}</Button>
          </span> : null}
        </>}
      />)}
      {!view?.rows.length ? <EmptyState message={view ? "此管理文件中还没有配置项，可从本地导入。" : "配置列表尚未读取。请点击“重新读取”。"} /> : null}
    </div>
    {manager.editing !== null ? <section
      className="flex flex-col gap-3"
      data-config-edit
    >
      <SectionHeader title={"编辑：" + (view?.rows.find(row => row.id === manager.editing)?.name || "")} />
      <p data-config-edit-help>{kind === "mcp" ? "留空保留原值。切换连接方式会清除另一种方式的命令或地址。" : kind === "hooks" ? "仅修改所选处理器；事件和匹配条件保持原值，留空保留。" : "只修改名称和描述，保留正文及其他元数据。"}</p>
      {fields.map(field => <div
        key={field}
        data-source-config-field={field}
      >
        {field === "type" ? <Select
          key={field}
          value={values[field] || "keep"}
          options={[{
            value: "keep",
            label: "保留原方式"
          }, {
            value: "stdio",
            label: "本地命令"
          }, {
            value: "http",
            label: "HTTP"
          }]}
          onChange={value => {
            host.managerInvalidate();
            setValues(previous => ({
              ...previous,
              [field]: value === "keep" ? "" : value
            }));
          }}
          disabled={manager.busy}
          aria-label={editLabels[field]}
        /> : <TextField
          key={field}
          label={editLabels[field]}
          value={values[field] || ""}
          onChange={value => {
            host.managerInvalidate();
            setValues(previous => ({
              ...previous,
              [field]: value
            }));
          }}
          type={["command", "args", "url", "prompt", "server", "tool"].includes(field) ? "password" : "text"}
          maxLength={4096}
          autoComplete="off"
          placeholder="留空保留原值"
          disabled={manager.busy}
        />}
      </div>)}
      <span data-source-manager-action="preview">
        <Button
          variant="secondary"
          disabled={manager.busy}
          onClick={() => {
            void host.managerAction("preview", values);
          }}
        >预览修改</Button>
      </span>
    </section> : null}
    {preview ? <section
      data-config-preview
      className="flex flex-col gap-3"
    >
      <SectionHeader title="应用前预览" />
      <p>{preview.summary}</p>
      <p>应用前核对文件版本并保存加密恢复记录；加密不可用时不写入。</p>
      <p>{preview.normalization ? "JSON／TOML 将规范化格式；未修改字段的值保留，撤销恢复原字节。" : "Skill 元数据修改保留正文；目录操作不改文件内容。"}</p>
    </section> : null}
    <Disclosure summary="导入与撤销说明">
      <p>本地导入不下载依赖、不执行文件。仅可撤销本次打开期间最近一次成功修改；加密记录保留在应用数据目录。检查可能覆盖其他文件，管理只修改上方位置。Claude 用户级 MCP 混合账号文件不管理。</p>
    </Disclosure>
  </Sheet>;
}
