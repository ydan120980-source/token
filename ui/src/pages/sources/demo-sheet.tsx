import { useRef, useState } from "react";
import { Button, Form, Sheet, TextField } from "@ui/kit";
import { useSourcesHost } from "@ui/data";
export function DemoSheet({
  open,
  onClose,
  demoAgent
}: {
  open: boolean;
  onClose(): void;
  demoAgent: string;
}) {
  const host = useSourcesHost(),
    [demoName, setDemoName] = useState('本地用量目录'),
    demoInput = useRef<HTMLInputElement>(null);
  return <Sheet
    open={open}
    onOpenChange={open => {
      if (!open) onClose();
    }}
    title="选择本地来源"
  >
    <p>{host.catalog()[demoAgent]?.name} · 选择只读的用量来源目录。</p>
    <Form
      onInvalid={() => demoInput.current?.setCustomValidity("请输入演示目录名称")}
      onSubmit={() => {
        if (!demoName.trim()) return;
        onClose();
        window.usageData?.toast("已应用演示目录名称；没有读取或保存本机路径。");
      }}
    >
      <TextField
        ref={demoInput}
        label="演示目录名称"
        value={demoName}
        onChange={value => {
          setDemoName(value);
          demoInput.current?.setCustomValidity("");
        }}
        required
        maxLength={40}
        pattern=".*\S.*"
      />
      <p>正式版使用系统目录选择器，只读用量文件。此处不会打开或读取目录。</p>
      <Button
        variant="primary"
        type="submit"
      >应用演示选择</Button>
    </Form>
  </Sheet>;
}
