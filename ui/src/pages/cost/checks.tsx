import type { ReactNode } from "react";
import { Button, Card, Disclosure, EmptyState, RingChart, StackBar, Value } from "@ui/kit";
import type { CostHost, CostSnapshot } from "@ui/data/cost-host";

/** One numbered step of the coverage list: its mark, what it is, and an optional action. */
function Step({ mark, title, note, details, action, code }: {
  mark: string; title: string; note?: ReactNode; details?: ReactNode; action?: ReactNode; code?: string;
}) {
  return <li className="flex items-start gap-3 py-3" data-cost-gap={code}>
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-caption text-foreground tabular-nums" aria-hidden="true">{mark}</span>
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <b className="text-body font-semibold text-foreground">{title}
        {note ? <em className="ml-2 font-normal not-italic text-caption text-muted-foreground tabular-nums">{note}</em> : null}
      </b>
      {details}
    </span>
    {action}
  </li>;
}
export function Checks({ host, snapshot, narrow }: { host: CostHost; snapshot: CostSnapshot; narrow: boolean }) {
  const { view } = snapshot, cov = view.coverage, cache = view.cache;
  const modelName = (key: string) => host.displayModel(view.models.find(item => item.key === key)?.model ?? key);
  const names = (models: { key: string }[]) => models.slice(0, 3).map(model => modelName(model.key)).join(" · ") +
    (models.length > 3 ? " 等 " + models.length + " 个" : "");
  const full = cov.unpricedTokens === 0, finalNumber = cov.gaps.length + 1;
  const involved = (text: ReactNode) => <Disclosure summary="涉及模型">
    <p className="text-caption text-muted-foreground">{text}</p>
  </Disclosure>;
  return <section data-cost-section="coverage" className={narrow ? "flex flex-col gap-4" : "grid grid-cols-2 gap-4"}>
    <section data-cost-coverage>
      <Card title="计价覆盖" fill>{!cov.tokens ?
        <EmptyState message="当前范围暂无用量。" /> :
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <RingChart
              variant="concentric"
              size="coverage"
              trackTone="cost:track"
              rings={[{
                key: "coverage", value: cov.coverage === null ? null : cov.coverage * 100,
                tone: "cost:hit", state: cov.coverage === null ? "unknown" : "normal", label: "计价覆盖",
              }]}
              center={<>
                <small>{"已计入"}</small>
                <b>{host.model.covered(cov.coverage)}</b>
                <small>{"按 Token"}</small>
              </>}
              aria-label={"已计入 " + host.model.covered(cov.coverage) +
                cov.gaps.map(gap => "，" + gap.title + " " + host.model.pct(gap.share)).join("")} />
            <div className="flex min-w-0 flex-col gap-1">
              <strong className="text-subtitle font-semibold text-foreground">{full ? "全部 Token 已计入" : host.short(cov.unpricedTokens) + " Token 未计入"}</strong>
              <span className="text-caption text-muted-foreground">{"读取 " + new Set(view.rows.map(row => row.agent)).size + " 个 Agent · " +
                view.items.filter(item => item.lower !== null).length + " / " + view.items.length + " 个模型有价格"}</span>
            </div>
          </div>
          <ol className="flex flex-col divide-y divide-border">
            {cov.gaps.map((gap, index) => <Step
              key={gap.code}
              code={gap.code}
              mark={String(index + 1)}
              title={gap.title}
              note={<>{host.short(gap.tokens)}{" · "}{host.model.pct(gap.share)}</>}
              details={involved(<>{names(gap.models)}{" · 不按 0 计"}</>)}
              action={<Button variant="ghost" size="compact" onClick={() => host.price(gap.models[0].key, !gap.fixable)}>
                {gap.fixable ? gap.code === "price-unverified" ? "核实价格" : "设置计费" : "处理方法"}
              </Button>} />)}
            {cov.range ? <Step
              code="range"
              mark="≈"
              title="估算区间"
              note={<>{"至多 +"}{host.model.money(cov.range.spread)}</>}
              details={involved(<>{names(cov.range.models)}{" · "}{host.model.rangeWords(cov.range.reasons)}</>)} /> : null}
            <Step
              mark={full ? "✓" : String(finalNumber)}
              title={full ? "全部 Token 已计入" : "补全后达到 100%"}
              details={!full ? involved(<>{host.short(cov.unpricedTokens)}{" Token 未计入；补全后合计不再带“+”"}</>) : undefined} />
          </ol>
        </div>}</Card>
    </section>
    <section data-cost-cache>
      <Card title="缓存" fill>{!cache.models.length ?
        <EmptyState message="当前范围暂无用量。" /> :
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <strong className="text-subtitle font-semibold text-foreground">{"约省下 "}
              <Value value={cache.savings === null ? null : host.model.money(cache.savings)} unknown="—" />
            </strong>
            <span className="text-caption text-muted-foreground">{cache.hitRate === null ? "命中率未报告" : "整体命中率 " + host.model.pct(cache.hitRate)}</span>
          </div>
          <div className="relative min-h-64 flex-1"><ul data-cost-cache-list className="ff-scroll-fade absolute inset-0 flex flex-col divide-y divide-border overflow-y-auto" tabIndex={0} role="region" aria-label="缓存模型列表">
            {view.cacheRows.map(row => <li key={row.key} data-cost-cache-row={row.key} className="flex items-center gap-3 py-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="break-words text-body text-foreground">{host.displayModel(row.model)}</span>
                <small className="break-words text-micro text-muted-foreground">
                  {row.users.map(user => host.model.agentName(user.agent!)).join(" · ")}
                  {row.priced ? "" : " · 没有价格"}{row.reported ? "" : " · 缓存读取未报告完整"}
                </small>
              </span>
              <span className="w-20 shrink-0">
                {row.hitRate !== null ? <StackBar height={4} aria-label="命中率"
                  segments={[{ key: row.key, value: row.hitRate, tone: "cost:hit", label: host.model.pct(row.hitRate) }]} /> : null}
              </span>
              <em className="w-14 shrink-0 text-right not-italic text-caption text-muted-foreground tabular-nums">
                <Value value={row.hitRate === null ? null : host.model.pct(row.hitRate)} unknown="未报告" />
              </em>
              <b className={"w-20 shrink-0 text-right text-body tabular-nums " + (row.savings === null ? "font-normal text-muted-foreground" : "font-semibold text-foreground")}>
                <Value value={row.savings === null ? null : host.model.money(row.savings)} unknown="无法估算" />
              </b>
            </li>)}
          </ul></div>
        </div>}</Card>
    </section>
  </section>;
}
