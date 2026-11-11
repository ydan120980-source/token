import { useState } from "react";
import { Button, Disclosure } from "@ui/kit";
import { getGlobals, getUsageBridge, useBridge, useViewActive } from "@ui/data";

// Re-estimate the saved history at the current prices (moved from insights-ui.js) and the Codex
// usage rebuild (moved from codex-maintenance.js). The page only asks; main writes and backs up.
export function Reprice() {
  const bridge = getUsageBridge(), active = useViewActive("settings");
  const general = useBridge(() => bridge.workbench({ period: "total", project: "all" }), { enabled: active });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const total = general.data?.total;
  const run = async () => {
    if (busy) return; setBusy(true); setMessage("");
    try { await bridge.reprice(); setMessage("已按当前价格重新估算；用量账本与来源文件保持原样。"); }
    catch { setMessage("操作未完成，原有数据和设置保持不变；请重试。"); }
    finally { setBusy(false); void general.reload(); }
  };
  return <section className="flex items-start justify-between gap-3" data-reprice>
    <div className="flex flex-col gap-2">
      <span className="text-subtitle font-semibold text-foreground">历史费用估算</span>
      <p className="text-caption text-muted-foreground" data-price-basis>{total ? "已计价 " + total.pricedRecords + " 条 · 未计价 " + total.unpricedRecords + " 条" : ""}</p>
      <p className="text-caption text-foreground" role="status" data-reprice-status>{message}</p>
    </div>
    <Button variant="secondary" loading={busy} disabled={busy} onClick={() => void run()}>重新估算</Button>
  </section>;
}

export function CodexMaintenance() {
  const bridge = getUsageBridge();
  const [candidate, setCandidate] = useState<{ id: string } | null>(null), [scanning, setScanning] = useState(false), [applying, setApplying] = useState(false), [message, setMessage] = useState("");
  const preview = async () => {
    setCandidate(null); setScanning(true); setMessage("正在只读扫描…");
    try {
      const value = await bridge.previewCodex();
      if (!value) throw Error("NO_PREVIEW");
      setMessage(getGlobals().codexMaintenanceModel.previewText(value));
      setCandidate(value);
    } catch { setCandidate(null); setMessage("扫描未完成、来源不完整或已有采集正在运行；统计未修改，请稍后重试。"); }
    finally { setScanning(false); }
  };
  const apply = async () => {
    if (!candidate) return; setApplying(true);
    try { const result = await bridge.applyCodex(candidate.id); setMessage("applied" in result && result.applied ? "已备份并重建；原始日志和账号连接保留。" : "已取消，统计未修改。"); }
    catch { setMessage("预览已过期或应用失败，统计未替换；请重新扫描预览。"); }
    finally { setCandidate(null); setApplying(false); }
  };
  return <Disclosure flush summary={<span className="text-subtitle font-semibold text-foreground">Codex 用量维护</span>}>
    <div className="flex flex-col gap-3" data-codex-maintenance>
      <Disclosure summary="重建说明"><p className="text-caption text-muted-foreground">先预览差额，再备份并重建本应用中可重读的 Codex 会话。保留原始日志、其他来源、账号连接及无法重读的历史。缺失旧日志无法凭个人页总量恢复。</p></Disclosure>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" loading={scanning} disabled={scanning} onClick={() => void preview()}>扫描并预览重建</Button>
        <Button variant="primary" disabled={!candidate || applying} onClick={() => void apply()}>备份并应用重建</Button>
      </div>
      <p className="text-caption text-foreground" role="status" data-codex-status>{message}</p>
    </div>
  </Disclosure>;
}
