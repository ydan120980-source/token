import { useEffect, useState } from "react";
import { AgentMark, Button, EmptyState, StackBar, TextField, Value } from "@ui/kit";
import type { CostHost, CostSnapshot } from "@ui/data/cost-host";

function Fee({ host, agent, saved }: { host: CostHost; agent: string; saved: string }) {
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  return <TextField
    label={host.model.agentName(agent) + " 的订阅月费（美元）"}
    value={draft}
    onChange={setDraft}

    inputMode="decimal"
    maxLength={9}
    autoComplete="off"
    placeholder="未填"

    onCommit={value => void host.saveFee(agent, value).then(setDraft)} />;
}
export function Subscriptions({ host, snapshot, hidden = false }: { host: CostHost; snapshot: CostSnapshot; hidden?: boolean }) {
  const { view, state, fees } = snapshot, month = view.subsMonth;
  return <div data-cost-subscriptions hidden={hidden} className="flex flex-col gap-3">{!month ?
    <EmptyState message="暂无记录。" /> :
    <>
      <p className="flex flex-wrap items-baseline gap-2">
        <b className="text-body font-semibold text-foreground">{host.model.monthLabel(month.month)}{month.current ? "至今" : ""}</b>
        <span className="text-caption text-muted-foreground">{state.month ? "所选月份" : month.current ? "本月" : "最近一个完整月"}{" · 月费按美元填写"}</span>
      </p>{!view.subscriptions.length ?
        <EmptyState message="这个月没有用量。" /> :
        <ul className="flex flex-col divide-y divide-border" tabIndex={-1}>{view.subscriptions.map(entry => {
          const read = host.model.subscriptionView(entry), quota = host.model.quotaSummary(entry.agent);
          const supported = Boolean(window.agentCatalog.agents[entry.agent] && !window.agentCatalog.agents[entry.agent].custom);
          return <li key={entry.agent} data-cost-subscription={entry.agent} className="flex flex-col gap-3 py-4 first:pt-0">
            <div className="flex items-center gap-2">
              <AgentMark agent={entry.agent} variant="icon" />
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="text-body font-semibold text-foreground">{host.model.agentName(entry.agent)}</span>{quota || supported ?
                  <Button variant="ghost" size="compact" onClick={() => host.quota(entry.agent)}>{quota ?? "额度未连接"}{" ›"}</Button> :
                  <span className="text-caption text-muted-foreground">{"没有账号额度"}</span>}
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className={"text-figure-md font-semibold tabular-nums " + (read.ratio === null ? "text-muted-foreground" : "text-foreground")}>{read.ratio === null ?
                <Value value={null} unknown={entry.lower === null ? "未计入" : "—"} /> :
                <>{read.ratio.replace(/×$/, "")}
                  <i className="not-italic text-subtitle text-muted-foreground">{"×"}</i>
                </>}</span>
              <small className="text-caption text-muted-foreground">{read.note}</small>
            </div>
            <Fee host={host} agent={entry.agent} saved={String(fees[entry.agent] ?? "")} />
            <div className="flex flex-col gap-2">
              <StackBar
                height={8}
                segments={read.segments}
                markers={read.markers}
                unknown={entry.lower === null}

                aria-label={"API 等价 " + (entry.lower === null ? "未计入" : host.model.amount(entry.lower, entry.upper)) +
                  "；月费 " + (entry.fee ? host.model.money(entry.fee) : "未填写")} />
              <span className="flex justify-between gap-3 text-caption text-muted-foreground">
                <span>{"API 等价 "}
                  <b className="font-semibold text-foreground tabular-nums">
                    <Value value={entry.lower === null ? null : host.model.amount(entry.lower, entry.upper)} unknown="—" />
                  </b>
                </span>
                <span>{"月费 "}
                  <b className="font-semibold text-foreground tabular-nums">{entry.fee ? host.model.money(entry.fee) : "未填"}</b>
                </span>
              </span>
            </div>
          </li>;
        })}</ul>}
    </>}</div>;
}
