import { useEffect, useState } from "react";
import { IconDownload } from "@tabler/icons-react";
import { Button, Card, Select, SettingRow } from "@ui/kit";
import { getSettingsHost, useDemoState, useViewActive, type DemoState } from "@ui/data";
import { Block, Section } from "./search";

const demoStates: { value: DemoState; label: string }[] = [{ value: "normal", label: "正常" }, { value: "partial", label: "部分字段缺失" }, { value: "empty", label: "暂无数据" }, { value: "error", label: "读取失败，保留历史" }];
// The privacy statements follow docs/PRIVACY.md and UI-PRIVACY-COPY-20261025.md.
const pillars = [
  { title: "不上传统计", body: "统计只在本机计算和保存，没有遥测。只在这些时候联网：下载 models.dev 公开价格、连接或查询服务额度、你点击检查版本、安装或升级。" },
  { title: "凭据由你决定", body: "用量采集不读取认证文件。只有你选择复用客户端登录时，才读取对应官方客户端的凭据；保持连接的凭据由 Windows 加密保存，只发往该服务的固定接口。" },
  { title: "只读来源", body: "采集只读取用量字段，不修改各 Agent 的数据库和配置。配置管理只改你选定的配置，应用前可预览，写入前加密备份，可撤销最近一次修改。" },
];

export function Privacy({ onExport }: { onExport: () => void }) {
  const demo = useDemoState(), host = getSettingsHost(), bridge = window.usageBridge, active = useViewActive("settings");
  const [data, setData] = useState<{ path: string; bytes: number } | null>(null), [copied, setCopied] = useState(false);
  useEffect(() => { if (active) void bridge?.dataInfo?.().then(setData).catch(() => {}); }, [active, bridge]);
  const copyDiagnostics = async () => { if (!bridge) return; await bridge.copyText(JSON.stringify(await bridge.statisticsDiagnostics(), null, 2)); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return <Section name="privacy" title="数据与安全">
    <Block keywords={host.demo.available ? demoStates.map(item => item.label).join(" ") : ""}>
      <Card title="统计数据">
        <div>
          <SettingRow title="导出统计" control={<Button variant="secondary" leadingIcon={IconDownload} onClick={onExport}>导出</Button>} />
          {data ? <SettingRow title={"数据目录 · " + (data.bytes >= 1073741824 ? (data.bytes / 1073741824).toFixed(1) + " GB" : Math.max(1, Math.round(data.bytes / 1048576)) + " MB")} control={<Button variant="secondary" size="compact" onClick={() => void bridge?.openData()}>打开</Button>} /> : null}
          {bridge ? <SettingRow title="诊断信息" control={<Button variant="secondary" size="compact" onClick={() => void copyDiagnostics()}>{copied ? "已复制" : "复制"}</Button>} /> : null}
          {host.demo.available ? <SettingRow title="演示数据状态" control={<Select value={demo} onChange={value => host.demo.set(value)} options={demoStates} aria-label="演示状态" />} /> : null}
        </div>
      </Card>
    </Block>
    <Block>
      <Card title="隐私">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3" data-privacy>
          {pillars.map(pillar => <div key={pillar.title} className="flex flex-col gap-2"><span className="text-subtitle font-semibold text-foreground">{pillar.title}</span><p className="text-caption text-muted-foreground">{pillar.body}</p></div>)}
        </div>
      </Card>
    </Block>
  </Section>;
}
