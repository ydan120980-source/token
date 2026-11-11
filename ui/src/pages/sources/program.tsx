import { Button, ListRow, StackBar, Value } from "@ui/kit";
import { sourcesModel, useSourcesHost, type SourceInstallerRow } from "@ui/data";
export function Program({
  row
}: {
  row: SourceInstallerRow;
}) {
  const host = useSourcesHost(),
    installers = host.installers(),
    model = sourcesModel(),
    display = model.installerView(row),
    {
      waiting,
      progress
    } = display;
  return <div
    className="flex flex-col gap-3"
    data-install-row={row.agent}
  >
    <ListRow
      title={row.name}
      meta={<span>{row.route} · {model.label(row)}{row.version ? row.managed ? " · 本应用管理" : " · 外部安装 · 未执行" : ""}{row.updateAvailable ? " · 有新版本 " + row.latest : ""}</span>}
    />
    {row.busy || waiting ? <>
      <p role="status">
        <Value value={display.stage} />
        {display.percent !== null ? <>
          {" · "}
          <Value value={display.percent} />
        </> : null}
        {display.attempt}
      </p>
      <StackBar
        height={4}
        unknown={progress === null}
        segments={progress === null ? [] : [{
          key: "downloaded",
          value: progress,
          tone: "muted",
          label: "已下载"
        }]}
        aria-label="安装进度"
      />
      {progress === null ? <Value value={null} /> : null}
    </> : null}
    {row.message ? <p className="text-caption text-muted-foreground">{row.message}</p> : null}
    <div className="flex flex-wrap gap-2">
      {model.installActions(row, Boolean(row.busy || installers.snapshot?.blocked || installers.loading === row.agent)).map(action => <span
        key={action.action}
        data-source-install-action={action.action}
      >
        <Button
          variant="secondary"
          disabled={action.disabled}
          onClick={() => {
            void host.installAction(row.agent, action.action);
          }}
        >{action.label}</Button>
      </span>)}
    </div>
  </div>;
}
