import { useState } from "react";
import { Button, ListRow, SectionHeader, SettingRow, Sheet, Value } from "@ui/kit";

// Owner-approved M4 supplements, with synthetic content only.
export function M4Gallery() {
  const [open, setOpen] = useState(false);
  return <section className="flex flex-col gap-3" data-m4-gallery>
    <SectionHeader title="M4 补充接口" />
    <div className="w-64" data-m4-default-row><ListRow title="默认行" meta="固定高度" /></div>
    <div className="w-64" data-m4-multiline-row><ListRow multiline title="完整来源信息" meta="合成说明 合成说明 合成说明 合成说明 合成说明 合成说明 合成说明 合成说明 合成说明 合成说明 合成说明 合成说明" /></div>
    <Button variant="secondary" onClick={() => setOpen(true)}>打开长内容弹窗</Button>
    <Sheet open={open} onOpenChange={setOpen} scrollable size="lg" title="合成长内容" description="验证正文滚动与固定动作。" footer={<Button variant="primary" onClick={() => setOpen(false)}>完成长内容验证</Button>}>
      {Array.from({ length: 30 }, (_, index) => <SettingRow key={index} title={"合成项目 " + (index + 1)} description={<Value value={index === 0 ? null : String(index)} />} />)}
    </Sheet>
  </section>;
}
