import { Activity as ReactActivity, type ReactNode } from "react";
import { BarChart, Button, Card, EmptyState, Figure, SectionHeader, Value, ValueButton } from "@ui/kit";
import type { UsageHost, UsageSnapshot } from "@ui/data/usage-host";
import { Clients, Hovered, Price } from "./shared";

// One of today's four readings: caption over figure, right-aligned, spaced apart without rules.
function TodayFigure({ label, data, children }: { label: string; data: string; children: ReactNode }) {
  return <div className="flex flex-col items-end gap-1" {...{ ["data-usage-today-" + data]: "" }}>
    <span className="text-caption text-muted-foreground">{label}</span>
    {children}
  </div>;
}

export function Overview({ host, snapshot, showClients, mountClients }: { host: UsageHost; snapshot: UsageSnapshot; showClients: boolean; mountClients: boolean }) {
  const { hero, today } = snapshot.view;
  return <div className="flex min-w-0 flex-col gap-6">
    <section data-usage-hero>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span role="status" className="text-caption text-muted-foreground">{snapshot.view.scope}</span>
          {snapshot.view.filtered ?
            <Button variant="ghost" onClick={() => host.set({ agent: "all", source: "all", model: "all" })}>
              {"查看全部"}
            </Button> : null}
        </div>
        <div data-usage-total-tokens aria-label="总 Token">
          <Figure text={hero.tokens} size="xl" unit="Token" />
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2" data-usage-total-cost>
            <span className="text-caption text-muted-foreground">{"API 等价估算"}</span>
            <Price value={hero.price} size="md" />
          </div>
          <Button variant="ghost" onClick={host.cost}>{"查看费用明细"}</Button>
        </div>
        <div className="flex flex-wrap items-baseline gap-4 text-caption">
          <span>
            {"记录 "}
            <Value value={hero.records} />
          </span>
          {hero.average !== null ?
            <span title={hero.averageTitle}>
              {"日均 "}
              <Value value={hero.average} />
            </span> : null}
          {hero.comparison !== null ?
            <span>
              {"较前 "}{snapshot.state.period}{" 天 "}
              <Value value={hero.comparison} />
            </span> : null}
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-3 text-caption text-muted-foreground">
          <span>{"近 30 天"}</span>
          <span role="status">{hero.today}</span>
        </div>
        <div data-usage-strip>
          <Hovered>{(active, setActive) => <BarChart
            variant="columns"
            height="strip"
            bars={hero.bars}
            active={active}
            onActiveChange={setActive}
            tooltip={key => hero.bars.find(bar => bar.key === key)?.label}
            onSelect={host.selectDay}
            dataKey="usage-recent-30"
            aria-label="近 30 天用量，选择日期查看明细"
          />}</Hovered>
        </div>
      </Card>
    </section>
    <section data-usage-today>
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex items-baseline gap-3">
            <SectionHeader title="今天" />
            <span className="text-caption text-muted-foreground">{today.date}</span>
          </div>
          <div className="flex flex-wrap items-end gap-8">
            <TodayFigure label="Token" data="tokens"><Figure text={today.tokens} size="sm" animated={false} /></TodayFigure>
            <TodayFigure label="估算" data="cost"><Price value={today.price} size="sm" animated={false} /></TodayFigure>
            <TodayFigure label="记录" data="records"><Figure text={today.records} size="sm" animated={false} /></TodayFigure>
            <TodayFigure label="会话" data="sessions">
              {today.sessions !== null && today.sessions > 0 ?
                <ValueButton onClick={() => host.openSessions()} aria-label={"查看今天的 " + today.sessions + " 个会话"}>
                  <Figure text={String(today.sessions)} size="sm" animated={false} />
                  <span className="text-caption text-muted-foreground">{"›"}</span>
                </ValueButton> :
                <Figure text={today.sessions === null ? null : String(today.sessions)} size="sm" animated={false} />}
            </TodayFigure>
          </div>
        </div>
        {today.empty ?
          <EmptyState message={today.empty} action={
            <Button variant="ghost" disabled={snapshot.busy} onClick={() => void host.refresh()}>{"刷新今日"}</Button>
          } /> :
          mountClients ? <ReactActivity mode={showClients ? "visible" : "hidden"}><div className="mt-2"><Clients items={today.clients} host={host} today /></div></ReactActivity> : null}
      </Card>
    </section>
  </div>;
}
