import { Button, EmptyState, Sheet } from "@ui/kit";
import { sourcesModel, useSourcesHost } from "@ui/data";
import { Program } from "./program";
export function InstallSheet({
  open,
  onClose
}: {
  open: boolean;
  onClose(): void;
}) {
  const host = useSourcesHost(),
    installers = host.installers(),
    upgrades = sourcesModel().installerUpgrades(installers.snapshot);
  return <Sheet
    scrollable
    open={open}
    onOpenChange={open => {
      if (!open) onClose();
    }}
    title="Agent 安装管理"
    size="xl"
    footer={<>
      <p
        role="status"
        data-install-message
      >{installers.message}</p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={Boolean(installers.loading)}
          onClick={() => {
            void host.installAction("all", "check-all");
          }}
        >检查版本与更新</Button>
        <Button
          variant="secondary"
          disabled={!upgrades || Boolean(installers.loading)}
          onClick={() => {
            void host.installAction("all", "upgrade-all");
          }}
        >全部升级（{upgrades}）</Button>
      </div>
    </>}
  >
    <p>直接安装与升级；官方下载网页始终保留为备用入口。</p>
    <p className="text-caption text-muted-foreground">CLI 安装在本应用独立目录；需要 Node.js 时自动准备私有环境。旧的本机专用维护记录需通过手动本机工具处理。桌面安装包核验后打开安装界面，完成后需复检。安装不会自动登录或连接额度。</p>
    {installers.snapshot?.rows.map(row => <Program
      key={row.agent}
      row={row}
    />)}
    {!installers.snapshot ? <EmptyState
      message="安装状态暂未获取，请重试。"
      action={<Button
        variant="secondary"
        onClick={() => {
          void host.loadInstallers();
        }}
      >重新获取</Button>}
    /> : null}
  </Sheet>;
}
