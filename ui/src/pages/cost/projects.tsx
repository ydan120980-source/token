import { useEffect, type ReactNode } from "react";
import { Banner, Button, Card, Disclosure, EmptyState, Form, Select, TextField } from "@ui/kit";
import { useInsightsHost } from "@ui/data/insights-host";

const note = "text-caption text-muted-foreground";

export function AttentionNotice({ kind }: { kind: "cost" | "budget" }) {
  const host = useInsightsHost(), notice = host.notices(kind);
  return notice.count ?
    <p data-cost-notice={kind} className={"flex flex-wrap items-center gap-3 " + note}>
      <span>{notice.text}</span>
      <Button variant="ghost" size="compact" onClick={() => host.openAttention(kind)}>{"在Agent 管理中处理"}</Button>
    </p> : null;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={"flex flex-col gap-1 " + note}>{label}{children}</label>;
}
/** A row of small facts under an open project or budget. */
function Facts({ children }: { children: ReactNode }) {
  return <div className={"flex flex-wrap gap-x-4 gap-y-1 tabular-nums " + note}>{children}</div>;
}
function Summary({ title, detail, value, attributes }: { title: string; detail: ReactNode; value: ReactNode; attributes: Record<string, string> }) {
  return <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
    <span {...attributes}>
      <strong className="font-semibold text-foreground">{title}</strong>
      <span className="text-muted-foreground">{detail}</span>
    </span>
    <span className="tabular-nums">{value}</span>
  </span>;
}
export function Projects() {
  const host = useInsightsHost(), snapshot = host.get(), { view, busy } = snapshot, f = host.format;
  const off = busy || !host.available;
  useEffect(() => { void host.projects.load(); }, [host]);
  useEffect(() => {
    if (!snapshot.focusBudget || !view) return;
    const frame = requestAnimationFrame(() => {
      const marker = document.querySelector<HTMLElement>('[data-cost-budget="' + CSS.escape(snapshot.focusBudget!) + '"]');
      const element = marker?.closest<HTMLElement>("[data-disclosure]") ?? marker?.closest<HTMLElement>("details");
      element?.scrollIntoView({ block: "nearest" });
      element?.querySelector<HTMLElement>("summary, button")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [snapshot.focusBudget, view]);
  return <div data-cost-projects className="flex flex-col gap-6" aria-busy={busy}>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="预算周期（自然日历）">
          <Select
            value={snapshot.period}
            onChange={period => void host.select({ period })}
            disabled={off}
            options={[{ value: "daily", label: "今日" }, { value: "weekly", label: "本周" },
              { value: "monthly", label: "本月" }, { value: "total", label: "累计" }]}
            aria-label="项目预算自然周期" />
        </Field>
        <Field label="项目">
          <Select
            value={snapshot.project}
            onChange={project => void host.select({ project })}
            disabled={off}
            options={[{ value: "all", label: "全部项目" }, ...(view?.projectOptions ?? []).map(p => ({ value: p.id, label: p.label || p.name }))]}
            aria-label="费用项目" />
        </Field>
        {view ? <span data-cost-project-range className={note}>
          {view.range.from || "已保存历史开始"}{" 至 "}{view.range.to}{" · "}{view.timezone}
        </span> : null}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={off} onClick={() => void host.projects.load()}>{"刷新项目"}</Button>
        <Button variant="secondary" disabled={off} onClick={() => void host.projects.export()}>{"导出项目 CSV"}</Button>
      </div>
    </div>
    {snapshot.error ? <div data-cost-project-error><Banner tone="error">{snapshot.error}</Banner></div> : null}
    <p data-cost-project-message role="status" aria-live="polite" className={note} hidden={!snapshot.message}>{snapshot.message}</p>
    {view ? <>
      <div data-cost-project-totals className="grid gap-4 sm:grid-cols-3" aria-label="当前范围汇总">
        {[
          ["API 等价估算 · 已计价部分", f.cost(view.total)],
          ["已观测 Token", f.count(view.total.totalTokens)],
          ["计价覆盖", view.total.records ? view.total.pricedRecords + " / " + view.total.records + " 条记录" : "暂无数据"],
        ].map(([label, value]) => <div key={label} className="flex flex-col gap-1">
          <span className={note}>{label}</span>
          <strong className="text-figure-sm font-semibold text-foreground tabular-nums">{value}</strong>
        </div>)}
      </div>
      <Card title="预算提醒">
        <Form onSubmit={() => void host.budget.save(snapshot.draft)} aria-label="当前项目与周期的预算">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-48">
          <TextField
            value={snapshot.draft}
            onChange={host.draft}
            label="预算 USD"
            inputMode="decimal"
            maxLength={24}
            autoComplete="off"
            placeholder="未设置"
            disabled={off} />
            </div>
            <Button variant="primary" type="submit" disabled={off}>{"保存预算"}</Button>
            <Button variant="ghost" disabled={off} onClick={() => void host.budget.remove()}>{"移除预算"}</Button>
          </div>
        </Form>
        <p data-cost-budget-state role="status" className="text-body text-foreground">
          {f.budgetStates[view.budget.state]}
          {view.budget.limitUsd !== null ? " 预算 " + f.budgetMoney(view.budget.limitUsd) + "。" : ""}
        </p>
        <p className={note}>{"未定价 " + f.count(view.total.unpricedTokens) + " Token · 历史起点 " + (view.historyStarts || "尚无记录")}</p>
        <div data-cost-budgets className="flex flex-col" aria-label="全部已保存预算">
          {snapshot.general?.budgetOverview ? snapshot.general.budgetOverview.budgets.length ?
            snapshot.general.budgetOverview.budgets.map(row => {
              const key = f.budgetKey(row), total = row.total;
              return <Disclosure
                key={key}
                open={snapshot.budgetOpen.has(key)}
                onOpenChange={open => host.toggle("budget", key, open)}
                summary={<Summary
                  attributes={{ "data-cost-budget": key, "data-budget-state": row.state }}
                  title={(f.periods[row.period] || row.period) + " · " + f.budgetName(row)}
                  detail={" · " + (f.budgetLabels[row.state] || "状态未知")}
                  value={"预算 " + f.budgetMoney(row.limitUsd!)} />}>
                <div className="flex flex-col gap-2">
                  <p className={note}>{row.range.from || "已保存历史开始"}{" 至 "}{row.range.to}{" · "}{view.timezone}</p>
                  <p className={note}>{f.budgetStates[row.state] || "当前预算状态未知。"}</p>
                  <Facts>
                    <span>{total.records ? "已估算 " + f.cost(total) : "暂无观测费用"}</span>
                    <span>{f.count(total.records)}{" 条记录"}</span>
                    <span>{"未定价 "}{f.count(total.unpricedTokens)}{" Token"}</span>
                  </Facts>
                  <div><Button variant="ghost" size="compact" onClick={() => void host.openBudget(key)}>{"查看此预算"}</Button></div>
                </div>
              </Disclosure>;
            }) :
            <EmptyState message="尚未保存预算。" /> :
            <EmptyState message="暂无法读取已保存预算，请重试。" />}
        </div>
      </Card>
      <Card title="项目用量与费用">
        <div data-cost-project-list className="flex flex-col">
          {view.projects.map(project => <Disclosure
            key={project.id}
            open={snapshot.open.has(project.id)}
            onOpenChange={open => host.toggle("project", project.id, open)}
            summary={<Summary
              attributes={{ "data-cost-project": project.id }}
              title={view.projectOptions.find(p => p.id === project.id)?.label || project.name}
              detail={project.id === "unknown" ? " · 未提供工作目录" : ""}
              value={f.cost(project)} />}>
            <div className="flex flex-col gap-2">
              <Facts>
                <span>{f.count(project.totalTokens)}{" Token"}</span>
                <span>{project.records}{" 条记录"}</span>
                <span>{project.sessions}{" 个会话"}</span>
                <span>{"未定价 "}{f.count(project.unpricedTokens)}{" Token"}</span>
              </Facts>
              {project.agents.map(agent => <div key={agent.agent} className="flex justify-between gap-3 text-caption tabular-nums">
                <span className="text-foreground">{f.agent(agent.agent)}</span>
                <span className="text-muted-foreground">{f.count(agent.totalTokens) + " Token · " + f.cost(agent)}</span>
              </div>)}
              <div><Button variant="ghost" size="compact" onClick={() => void host.select({ project: project.id })}>{"只看此项目"}</Button></div>
            </div>
          </Disclosure>)}
          {!view.projects.length ? <EmptyState message="当前范围没有已保存的用量记录。" /> : null}
        </div>
      </Card>
      <AttentionNotice kind="budget" />
    </> : <EmptyState message="项目与诊断暂不可用，请重试。" />}
  </div>;
}
