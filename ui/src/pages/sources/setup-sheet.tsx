import { Button, CodeBlock, SectionHeader, Sheet } from "@ui/kit";
import { sourcesModel, useSourcesHost } from "@ui/data";
import { QuotaLine } from "./quota-line";
import { Program } from "./program";
export function SetupSheet() {
  const host = useSourcesHost(),
    setup = host.setup(),
    current = setup.current,
    installers = host.installers();
  const labels: Record<string, string> = {
    paused: '读取已停用',
    error: '读取失败',
    partial: '部分读取',
    available: '已有用量观测',
    'not-read': '尚无确认结果'
  };
  return <Sheet
    scrollable
    open={Boolean(setup.selected)}
    onOpenChange={open => {
      if (!open) host.closeSetup();
    }}
    title={current?.name || host.catalog()[setup.selected!]?.name || "来源"}
    description={host.catalog()[setup.selected!]?.hint ? "读取 " + host.catalog()[setup.selected!].hint : undefined}
    size="lg"
    footer={<Button
      variant="primary"
      onClick={host.closeSetup}
    >完成</Button>}
  >
    <p
      role="status"
      data-setup-message
    >{setup.message}</p>
    {current && setup.selected ? <>
      {!host.catalog()[setup.selected]?.custom ? <>
        <SectionHeader title="程序" />
        {installers.snapshot?.rows.find(row => row.agent === setup.selected) ? <Program row={installers.snapshot.rows.find(row => row.agent === setup.selected)!} /> : <p>安装状态暂未获取，可稍后重试。</p>}
        <p role="status">{installers.selected === setup.selected ? installers.message : ""}</p>
      </> : null}
      <SectionHeader title={"用量读取：" + labels[current.usage.state]} />
      {current.usage.steps.map((step, i) => <p key={i}>{step}</p>)}
      <Button
        variant="tertiary"
        disabled={setup.busy}
        onClick={() => {
          const agent = setup.selected!;
          host.closeSetup();
          window.sourcesUi?.focus(agent);
        }}
      >查看读取位置</Button>
      <QuotaLine
        agent={setup.selected}
        detail
      />
      <SectionHeader title="安装与故障恢复" />
      <p className="text-subtitle">{current.title}</p>
      <p>{current.providerNote}</p>
      {current.steps.map((step, i) => <p key={i}>{i + 1}. {step}</p>)}
      {current.installation.command ? <div className="flex flex-col gap-2">
        <span className="text-caption text-muted-foreground">官方安装命令 · PowerShell</span>
        <CodeBlock
          text={current.installation.command}
          aria-label="官方安装命令"
        />
      </div> : null}
      <div className="flex flex-wrap gap-2">
        {current.actions.map(action => <span
          key={action.id}
          data-source-setup-action={action.id}
        >
          <Button
            variant="secondary"
            disabled={setup.busy}
            onClick={() => {
              void host.setupAction(action.id);
            }}
          >{action.label}</Button>
        </span>)}
      </div>
      <p>{current.quotaDescription}</p>
      {current.checkedAt ? <p className="text-caption text-muted-foreground">最近入口扫描：{sourcesModel().setupWhen(current.checkedAt)}</p> : null}
      <p>{current.notice}</p>
    </> : <p>{setup.busy ? "" : "状态尚未获取，可重试；已有统计保持不变。"}</p>}
    {!current && !setup.busy && setup.selected ? <Button
      variant="secondary"
      onClick={() => {
        void host.openSetup(setup.selected!);
      }}
    >重新获取</Button> : null}
  </Sheet>;
}
