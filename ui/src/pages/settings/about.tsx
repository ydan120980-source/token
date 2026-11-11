import { useEffect, useState } from "react";
import { Button, Card, SettingRow } from "@ui/kit";
import { showView, useViewActive } from "@ui/data";
import { updateActions, updateMessage, useUpdate } from "@ui/data/update-host";
import { Block, Section } from "./search";

// 关于：版本、更新、统计引擎和入口。更新由 update-host 驱动 —— 打包版本才会检查，未打包的运行报告「不含自动更新」。
export function About() {
  const bridge = window.usageBridge, active = useViewActive("settings"), [version, setVersion] = useState<string | null>(null);
  const { state: update, actionError } = useUpdate();
  const busy = update.status === "checking" || update.status === "downloading";
  const percent = update.progress?.percent ?? 0;
  const summary = actionError ? actionError
    : update.error ? updateMessage(update.error)
    : update.status === "checking" ? "正在检查…"
    : update.status === "downloading" ? (update.progress?.total ? "正在下载 " + percent + "%" : "正在下载…")
    : update.status === "downloaded" ? "新版本已下载，重启后安装"
    : update.status === "available" ? "有新版本 " + update.latest?.version
    : update.status === "latest" ? "已是最新版本"
    : update.status === "unconfigured" ? updateMessage("UPDATE_NOT_CONFIGURED")
    : "启动后会检查更新";
  const control = update.status === "downloaded"
    ? <Button variant="primary" size="compact" onClick={() => { void updateActions.install(); }}>重启并更新</Button>
    : update.status === "downloading"
      ? <Button variant="secondary" size="compact" onClick={() => { void updateActions.cancel(); }}>取消下载</Button>
      : update.status === "available" && update.latest?.url
        ? <Button variant="primary" size="compact" onClick={() => updateActions.open(update.latest!.url!)}>打开下载页</Button>
        : <Button variant="secondary" size="compact" disabled={!update.supported || busy} onClick={() => { void updateActions.check(); }}>检查更新</Button>;
  useEffect(() => { if (active) void bridge?.dataInfo?.().then(info => setVersion(info.version)).catch(() => {}); }, [active, bridge]);
  return <Section name="about" title="关于">
    <Block>
      <Card title="系统信息">
        <div>
          <SettingRow title="应用版本" control={<span className="text-body text-muted-foreground" data-about-version>{(version ?? update.current ?? "—") + " · 预览版，未签名"}</span>} />
          <span data-about-update={update.status}><SettingRow title="应用更新" description={summary} control={control} /></span>
          <SettingRow title="统计引擎" control={<span className="text-body text-muted-foreground">tokscale 4.17.0 · 每次启动前校验 SHA-256</span>} />
          <SettingRow title="支持的 Agent" control={<Button variant="secondary" size="compact" onClick={() => showView("sources")}>查看 Agent 管理</Button>} />
        </div>
      </Card>
    </Block>
  </Section>;
}
