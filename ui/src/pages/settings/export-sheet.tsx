import { useEffect, useState } from "react";
import { Button, CheckboxGroup, CodeBlock, Disclosure, Select, Sheet } from "@ui/kit";
import { getSettingsHost } from "@ui/data";

const ranges: { value: "all" | "current"; label: string }[] = [{ value: "all", label: "全部历史" }, { value: "current", label: "当前用量详情的筛选结果" }];

// The statistics export opened from settings, the usage page and the native menu. The shell builds
// the whitelisted snapshot (window.settingsHost.exportStatistics); this sheet only asks and reports.
export function ExportSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const host = getSettingsHost();
  const [range, setRange] = useState<"all" | "current">("all"), [sources, setSources] = useState(true);
  const [busy, setBusy] = useState(false), [result, setResult] = useState(""), [json, setJson] = useState<string | null>(null);
  // Every opening starts clean, with the preview folded away.
  useEffect(() => { if (open) { setResult(""); setJson(null); } }, [open]);
  const run = async () => {
    if (busy) return;
    setBusy(true); setResult("正在导出统计…");
    try { const outcome = await host.exportStatistics({ range, sources }); setResult(outcome.message); setJson(outcome.kind === "preview" ? outcome.json ?? null : null); }
    finally { setBusy(false); }
  };
  return <Sheet open={open} onOpenChange={onOpenChange} title="导出统计" description={host.exportHelp} size="lg">
    <div className="flex flex-col gap-3" data-export-sheet>
      <Select value={range} onChange={setRange} options={ranges} aria-label="导出范围" />
      <CheckboxGroup value={sources ? ["sources"] : []} onChange={value => setSources(value.includes("sources"))} items={[{ value: "sources", label: "包含来源状态" }]} />
      <span className="text-caption text-muted-foreground">不包含会话正文、账号、凭据或本机路径。</span>
      <Button variant="primary" loading={busy} disabled={busy} onClick={() => void run()}>导出统计 JSON</Button>
      <p className="text-caption text-foreground" role="status" data-export-result>{result}</p>
      {json !== null ? <Disclosure summary="查看导出内容"><CodeBlock text={json} aria-label="导出的统计 JSON" /></Disclosure> : null}
    </div>
  </Sheet>;
}
