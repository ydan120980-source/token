import { useEffect, useState } from "react";
import { Badge, Button, Card, Form, SettingRow, Sheet, TextField } from "@ui/kit";
import { changeWidgets, useWidgetState, widgetModel } from "@ui/data/widgets";
import { Block } from "./search";

type Naming = { kind: "rename"; id: string; name: string } | { kind: "new" } | null;

/** Names a layout: renames one, or copies the current layout under a new name. */
function NameSheet({ naming, onClose }: { naming: Naming; onClose: () => void }) {
  const [draft, setDraft] = useState(""), model = widgetModel();
  useEffect(() => { setDraft(naming?.kind === "rename" ? naming.name : ""); }, [naming]);
  const save = () => {
    if (!naming || !draft.trim()) return;
    changeWidgets((m, s) => naming.kind === "rename" ? m.renameLayout(s, naming.id, draft) : m.addLayout(s, draft));
    onClose();
  };
  return <Sheet open={Boolean(naming)} onOpenChange={open => { if (!open) onClose(); }}
    title={naming?.kind === "rename" ? "重命名布局" : "新建布局"} size="sm"
    footer={<Button variant="primary" disabled={!draft.trim()} onClick={save}>{naming?.kind === "rename" ? "保存" : "复制当前布局"}</Button>}>
    <Form onSubmit={save} aria-label="布局名字">
      <TextField value={draft} onChange={setDraft} label="名字" maxLength={model.NAME_MAX} required />
    </Form>
  </Sheet>;
}

// 设置 › 常规 › 小组件 (owner decision 2026-10-27): the saved layouts of the widget column.
export function WidgetLayouts() {
  const state = useWidgetState(), model = widgetModel(), [naming, setNaming] = useState<Naming>(null);
  return <Block keywords="小组件 侧栏 布局 摘要">
    <Card title="小组件">
      <div data-widget-layouts>
        {state.layouts.map(layout => <SettingRow key={layout.id} title={layout.name} control={<>
          {layout.id === state.active ? <Badge tone="neutral">使用中</Badge> : <Button variant="secondary" size="compact" onClick={() => changeWidgets((m, s) => m.activate(s, layout.id))}>使用</Button>}
          <Button variant="ghost" size="compact" onClick={() => setNaming({ kind: "rename", id: layout.id, name: layout.name })}>重命名</Button>
          <Button variant="ghost" size="compact" disabled={state.layouts.length < 2} onClick={() => changeWidgets((m, s) => m.removeLayout(s, layout.id))}>删除</Button>
        </>} />)}
        <SettingRow title="新建布局" control={<Button variant="secondary" size="compact" disabled={state.layouts.length >= model.MAX_LAYOUTS} onClick={() => setNaming({ kind: "new" })}>复制当前布局</Button>} />
        <SettingRow title="恢复默认小组件" control={<Button variant="ghost" size="compact" onClick={() => changeWidgets((m, s) => m.reset(s))}>恢复</Button>} />
      </div>
    </Card>
    <NameSheet naming={naming} onClose={() => setNaming(null)} />
  </Block>;
}
