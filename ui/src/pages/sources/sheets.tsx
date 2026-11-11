import { useState } from "react";
import { Badge, Button, Disclosure, EmptyState, ListRow, SectionHeader, Select, SubTabs } from "@ui/kit";
import { sourcesModel, useSourcesHost } from "@ui/data";
import { ManagerSheet } from "./manager-sheet";
import { SetupSheet } from "./setup-sheet";
import { InstallSheet } from "./install-sheet";
import { CustomSheet } from "./custom-sheet";
import { DemoSheet } from "./demo-sheet";
const kinds = ["mcp", "hooks", "skills"];
export function ConfigSection() {
  const host = useSourcesHost(),
    config = host.config(),
    [agent, setAgent] = useState("codex"),
    [scope, setScope] = useState("home"),
    [kind, setKind] = useState("mcp"),
    [open, setOpen] = useState(false);
  const view = sourcesModel().configProjection(config.state, agent, scope, kind, config.pending, config.message);
  return <section
    className="flex flex-col gap-3"
    data-config-center
  >
    <SectionHeader title="Agent 配置" />
    <div className="flex flex-wrap gap-3">
      <Select
        value={agent}
        onChange={setAgent}
        disabled={config.pending}
        options={Object.entries(host.catalog()).filter(([, meta]) => !meta.custom).map(([value, meta]) => ({
          value,
          label: meta.name
        }))}
        aria-label="配置检查 Agent"
      />
      <Select
        value={scope}
        onChange={setScope}
        disabled={config.pending}
        options={[{
          value: "home",
          label: "用户级"
        }, {
          value: "project",
          label: "项目级"
        }]}
        aria-label="配置范围"
      />
      {[['configChoose', '选择范围目录'], ['configCheck', '检查配置'], ['configForget', '清除选择']].map(([name, label]) => <span
        key={name}
        data-source-config-action={name}
      >
        <Button
          variant="secondary"
          disabled={view.busy || !view.known || name !== "configChoose" && !view.item || !host.available}
          onClick={() => {
            void host.configAction(name, agent, scope);
          }}
        >{label}</Button>
      </span>)}
      <span data-source-config-action="configManage">
        <Button
          variant="secondary"
          disabled={view.busy || !view.known || !view.item || !host.available}
          onClick={() => {
            setOpen(true);
            void host.openManager({
              agent,
              scope,
              kind
            });
          }}
        >管理当前类别</Button>
      </span>
      {config.state.busy ? <Button
        variant="secondary"
        onClick={() => {
          void host.configCancel();
        }}
      >取消检查</Button> : null}
    </div>
    <p
      data-config-selection
      className="text-caption text-muted-foreground"
    >{view.selection}</p>
    <p
      data-config-message
      role="status"
    >{view.message}</p>
    <SubTabs
      idPrefix="source-config"
      value={kinds.indexOf(kind)}
      onChange={index => setKind(kinds[index])}
      items={["MCP", "Hooks", "Skills"]}
    />
    <p
      data-config-summary
      className="text-caption text-muted-foreground"
    >{view.summary}</p>
    <div
      data-config-results
      className="flex flex-col gap-3"
    >
      {view.files.map((file, index) => <Disclosure
        key={index}
        summary={file.title}
      >
        {file.checks.map((check, i) => <div
          key={i}
          data-config-state={check.state}
        >
          <ListRow
            multiline
            title={<Badge tone={check.state === "issue" ? "warn" : "neutral"}>{check.label}</Badge>}
            meta={<span>{check.reason} {check.location}</span>}
          />
        </div>)}
      </Disclosure>)}
      {!view.files.length && view.empty ? <EmptyState message={view.empty} /> : null}
    </div>
    <ManagerSheet
      open={open}
      onClose={() => {
        if (host.closeManager()) setOpen(false);
      }}
    />
  </section>;
}
export function SourceSheets({
  sheet,
  setSheet,
  demoAgent
}: {
  sheet: 'install' | 'custom' | 'demo' | null;
  setSheet(value: 'install' | 'custom' | 'demo' | null): void;
  demoAgent: string;
}) {
  const host = useSourcesHost();
  return <>
    <SetupSheet />
    <InstallSheet
      open={sheet === 'install'}
      onClose={() => setSheet(null)}
    />
    <CustomSheet
      open={sheet === 'custom'}
      onClose={() => {
        if (host.closeCustom()) setSheet(null);
      }}
    />
    <DemoSheet
      open={sheet === 'demo'}
      onClose={() => setSheet(null)}
      demoAgent={demoAgent}
    />
  </>;
}
