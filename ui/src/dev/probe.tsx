import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabItem } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";

// The foundation check: one of each portalled and inline control, mounted only by the React layer
// smoke test (scripts/m1/ui-foundation-ui-test.js). Product pages never mount it.
export function Probe() {
  const [tab, setTab] = useState("7d");
  const [on, setOn] = useState(true);
  const [value, setValue] = useState("codex");
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4 bg-background p-6 text-body" data-probe>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabItem value="1d" label="24 小时" />
          <TabItem value="7d" label="7 天" />
          <TabItem value="30d" label="30 天" />
        </TabsList>
      </Tabs>
      <Switch label="每分钟自动刷新" checked={on} onToggle={() => setOn(v => !v)} data-probe-switch />
      <div className="w-48">
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger placeholder="选择 Agent" data-probe-select />
          <SelectContent>
            <SelectItem index={0} value="codex">Codex</SelectItem>
            <SelectItem index={1} value="claude">Claude Code</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="text-muted-foreground">剩余 <span data-value="unknown">未知</span></p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="secondary" data-probe-open>打开详情</Button>} />
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>额度详情</DialogTitle>
            <DialogDescription>合成数据</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="primary" data-probe-close>完成</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
