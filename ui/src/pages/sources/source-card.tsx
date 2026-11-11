import { useRef, type KeyboardEvent } from "react";
import { IconFolderOpen } from "@tabler/icons-react";
import { AgentMark, Badge, Button, Collapse, CopyButton, IconButton, MiniBars, PillToggle, Switch } from "@ui/kit";
import { sourcesModel, useSourcesHost, type AttentionCardRow } from "@ui/data";
import { useInsightsHost } from "@ui/data/insights-host";
import { openEditor, openFix } from "../settings/pricing/store";
import { QuotaLine } from "./quota-line";

/** A problem on its own Agent, in plain words: what it is, what it costs, and the one thing that can be done. */
function Issue({ row, lookOpen, onLook }: { row: AttentionCardRow; lookOpen: boolean; onLook: () => void }) {
  const insights = useInsightsHost(), busy = insights.get().busy;
  const price = () => { window.settingsUi?.openSection("pricing"); requestAnimationFrame(() => { if (row.models.length === 1) void openEditor(row.models[0]); else openFix(); }); };
  return <div className={"flex flex-wrap items-center gap-3 rounded-xl p-3 " + (row.kind === "accept" ? "bg-muted" : "bg-warn-soft")} data-source-issue={row.kind}>
    <div className="flex min-w-40 flex-1 flex-col gap-0.5"><span className="text-body font-medium text-foreground">{row.title}</span><span className="text-caption text-muted-foreground">{row.effect}</span></div>
    <div className="flex shrink-0 items-center gap-1">
      {row.kind === "act" ? <Button variant="primary" size="compact" onClick={price}>处理</Button> : null}
      {row.kind === "source" ? <Button variant="secondary" size="compact" aria-expanded={lookOpen} onClick={onLook}>{lookOpen ? "收起" : "查看"}</Button> : null}
      <Button variant="ghost" size="compact" disabled={busy} onClick={() => { void (async () => { for (const id of row.ids) await insights.acknowledge(id); })(); }}>{row.kind === "accept" ? "不再提醒" : "已知悉"}</Button>
    </div>
  </div>;
}

// One Agent: whether it reads, how it has gone lately, its problems, and its read locations and coverage folded.
export function SourceCard({ id, section, issues, spark, today, pathsOpen, capOpen, togglePaths, toggleCap, changePath, onDemo }: {
  id: string; section: string; issues: AttentionCardRow[]; spark: (number | null)[]; today: string; pathsOpen: boolean; capOpen: boolean;
  togglePaths: () => void; toggleCap: () => void; changePath: (action: string, agent: string, path?: string) => void; onDemo: (agent: string) => void;
}) {
  const host = useSourcesHost(), state = host.get(), model = sourcesModel(), insights = useInsightsHost(), meta = host.catalog()[id];
  const row = model.sourceRow(state, id, meta, host.demo), capability = insights.capabilityView(id);
  const program = model.programStatus(host.installers().snapshot?.rows.find(item => item.agent === id), (row.status?.observedRecords ?? 0) > 0);
  const line = [model.create(state, host.catalog()).sourceLine(row.source, row.status), program].filter(Boolean).join(" · ");
  const count = row.source?.paths.length ?? 0, card = useRef<HTMLElement>(null);
  // Folding gives focus back to the pill that opened it, which also brings it into view; the card keeps its place and width.
  const fold = (which: "paths" | "capability") => { (which === "paths" ? togglePaths : toggleCap)(); card.current?.querySelector<HTMLButtonElement>("[data-source-" + which + "] button")?.focus(); };
  const escape = (event: KeyboardEvent) => { if (event.key !== "Escape" || !(pathsOpen || capOpen)) return; event.stopPropagation(); if (pathsOpen) fold("paths"); if (capOpen) fold("capability"); };
  return <article ref={card} onKeyDown={escape} data-source-agent={id} data-source-section={section} data-stopped={row.stopped ? "" : undefined} aria-busy={state.busy} className="flex min-w-0 flex-col gap-4 rounded-2xl bg-card p-5 shadow-card">
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted"><AgentMark agent={id} variant="icon" size={24} /></span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 pt-2" title={row.tip}>
        <span className="break-words text-subtitle font-semibold text-foreground">{meta.name}</span>
        <Badge tone={row.label === "读取失败" || row.label === "部分支持" ? "warn" : "neutral"}>{row.label + (row.status?.realSampleVerified ? " · 真实样本已核对" : "")}</Badge>
      </div>
      {!meta.archived && row.source && host.available ? <Switch labelHidden label={"读取 " + meta.name} checked={Boolean(row.source.enabled)} disabled={state.busy || !row.source} onChange={value => { void host.change("enable", id, value); }} /> : null}
    </div>
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-4">
        <span className="min-w-0 text-body font-semibold text-foreground" data-source-today>{today}</span>
        <MiniBars values={spark} aria-label={meta.name + " 近 14 天每天的 Token"} />
      </div>
      <p className="break-words text-caption text-muted-foreground" data-source-reading title={meta.hint}><span>{line}</span><QuotaLine agent={id} prefix={line ? " · " : ""} /></p>
    </div>
    {issues.map(item => <Issue key={item.key} row={item} lookOpen={pathsOpen} onLook={togglePaths} />)}
    <div className="flex flex-wrap items-center gap-2">
      <span data-source-paths><PillToggle open={pathsOpen} onToggle={togglePaths} controls={"source-paths-" + id}>{"读取位置 " + count}</PillToggle></span>
      {capability ? <span data-source-capability><PillToggle open={capOpen} onToggle={toggleCap} controls={"source-cap-" + id}>{"字段覆盖"}</PillToggle></span> : null}
      <span className="flex-1" />
      {!meta.archived && !meta.usageOnly && !host.demo && host.available ? <Button variant="secondary" size="compact" aria-label={"管理 " + meta.name} onClick={() => { void host.openSetup(id); }}>管理</Button> : null}
    </div>
    <Collapse open={pathsOpen} id={"source-paths-" + id} aria-label={meta.name + " 读取位置"}>
      <div className="flex flex-col gap-2 pt-1">
        {row.issues.length ? <p className="text-caption text-warn">{row.issues.join("；")}</p> : null}
        {row.quality ? <p className="text-caption text-muted-foreground">{row.quality}</p> : null}
        {row.source?.mixedRules ? <p className="text-caption text-muted-foreground">{"部分历史使用旧规则"}</p> : null}
        {row.source?.paths.map(entry => {
          const path = model.path(entry, state.stale);
          return <div key={entry.path} data-source-path={entry.path} className="flex min-h-9 items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="break-all font-mono text-caption text-foreground" title={entry.path}>{entry.display}</span>
              <span className="text-caption text-muted-foreground">{path.meta + (path.issues.length ? " · " + path.issues.join("；") : "")}</span>
            </div>
            {host.available ? <span data-source-reveal><IconButton icon={IconFolderOpen} size="compact" label={"在资源管理器中显示 " + entry.display} onClick={() => { void host.reveal(entry.path); }} /></span> : null}
            <CopyButton size="compact" label={"复制 " + entry.display} onCopy={() => host.copyText(entry.path)} />
            {path.action && !meta.custom ? <span data-source-path-action={path.action.name}>
              <Button variant="tertiary" size="compact" aria-label={path.action.label + " " + entry.display} disabled={state.busy || !host.available} onClick={() => { void changePath(path.action!.name, id, entry.path); }}>{path.action.label}</Button>
            </span> : null}
          </div>;
        })}
        {!meta.archived && host.available ? <div className="flex flex-wrap gap-2">
          {meta.custom ? <>
            <Button variant="tertiary" size="compact" onClick={() => { void host.openCustom(id); }}>{"编辑规则"}</Button>
            <Button variant="tertiary" size="compact" onClick={() => { void host.customExport(id); }}>{"导出配置"}</Button>
            {row.source?.canRollback ? <Button variant="tertiary" size="compact" onClick={() => { void host.customChange(id, "rollback"); }}>{"回退上一版"}</Button> : null}
            <Button variant="tertiary" size="compact" onClick={() => { void host.customChange(id, "remove"); }}>{"移除来源"}</Button>
          </> : <>
            <span data-source-add={id}><Button variant="tertiary" size="compact" disabled={state.busy} onClick={() => { if (host.demo) onDemo(id); else void host.add(id); }}>{id === "cursor" ? "选择用量文件" : "添加目录"}</Button></span>
            {row.changed ? <span data-source-reset={id}><Button variant="tertiary" size="compact" disabled={state.busy} onClick={() => { void changePath("reset", id); }}>{"恢复自动发现的位置"}</Button></span> : null}
          </>}
        </div> : null}
        <div data-source-fold="paths"><Button variant="ghost" size="compact" onClick={() => fold("paths")}>收起读取位置</Button></div>
      </div>
    </Collapse>
    {capability ? <Collapse open={capOpen} id={"source-cap-" + id} aria-label={meta.name + " 解析能力"}>
      <div className="flex flex-col gap-2 pt-1" data-source-capability-detail>
        <p className="text-caption text-muted-foreground">{capability.note}</p>
        <p className="text-caption text-foreground">{capability.semantics}</p>
        {capability.fields.map(field => <div key={field.label} className="flex min-h-8 items-center justify-between gap-3 text-caption"><span className="text-muted-foreground">{field.label}</span><span className="text-right text-foreground">{field.value}</span></div>)}
        <p className="text-caption text-muted-foreground">{capability.summary}</p>
        <div data-source-fold="capability"><Button variant="ghost" size="compact" onClick={() => fold("capability")}>收起字段覆盖</Button></div>
      </div>
    </Collapse> : null}
  </article>;
}
