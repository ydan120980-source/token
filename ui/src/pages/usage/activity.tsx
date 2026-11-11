import { AgentMark, BarChart, Button, Card, EmptyState, Heatmap, IconButton, ScrollArea,
  SectionHeader, Segmented, SwatchGroup, TipCard, Value, type ChartTone } from "@ui/kit";
import { IconX } from "@tabler/icons-react";
import type { UsageHost, UsageSnapshot } from "@ui/data/usage-host";
import { AsideFacts, Categories, Clients, Facts, Hovered, Price } from "./shared";

const weekdays = ["一", "二", "三", "四", "五", "六", "日"].map((label, row) => ({ row, label }));
const hours = [{ col: 0, label: "0" }, { col: 6, label: "6" }, { col: 12, label: "12" }, { col: 18, label: "18" }];
const palettes = [
  { value: "orange", label: "橙色", tone: "palette:orange" as ChartTone },
  { value: "blue", label: "蓝色", tone: "palette:blue" as ChartTone },
  { value: "green", label: "绿色", tone: "palette:green" as ChartTone },
  { value: "mono", label: "单色", tone: "palette:mono" as ChartTone },
];
const intensity = Array.from({ length: 5 }, (_, level) => ({ key: String(level), row: 0, col: level,
  level: level as 0 | 1 | 2 | 3 | 4, disabled: true, label: "强度 " + level }));

export function Activity({ host, snapshot }: { host: UsageHost; snapshot: UsageSnapshot }) {
  const { state, view } = snapshot, { calendar, activity, day } = view;
  return <section className="flex min-w-0 flex-col gap-4" data-usage-activity>
    <SectionHeader title="Token 活动" />
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div data-usage-calendar-range>
          <Segmented
            value={state.heatRange}
            onChange={heatRange => host.set({ heatRange })}
            items={[{ value: "365", label: "最近一年" }, { value: snapshot.today.slice(0, 4), label: snapshot.today.slice(0, 4) + " 年" }]}
            aria-label="活动日期范围"
          />
        </div>
        <Facts inline items={activity.stats} />
      </div>
      <span className="text-caption text-muted-foreground">{"每天"}</span>
      <div data-usage-calendar>
        <Hovered>{(calendarActive, setCalendarActive) => <Heatmap
          variant="calendar"
          rows={7}
          cols={calendar.columns}
          cells={calendar.cells}
          colLabels={calendar.labels}
          colLabelsPosition="bottom"
          navigation="grid"
          selected={state.selectedDay}
          active={calendarActive}
          onActiveChange={setCalendarActive}
          onSelect={day => host.set({ selectedDay: day })}
          tooltip={key => {
            const cell = calendar.cells.find(cell => cell.key === key);
            return cell ? <TipCard {...cell.tip} /> : null;
          }}
          dataKey={calendar.start + ":" + calendar.end}
          aria-label="每日 Token 活动"
        />}</Hovered>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div data-usage-palette>
          <SwatchGroup value={state.palette} onChange={palette => host.set({ palette })}
            items={palettes} aria-label="活动配色" />
        </div>
        <div className="flex items-center gap-1 text-caption text-muted-foreground" aria-label="活动强度由低到高">
          <span>{"低"}</span>
          <div className="w-20">
            <Heatmap variant="calendar" rows={1} cols={5} cells={intensity} sizing="fit-square" aria-label="活动强度色阶" />
          </div>
          <span>{"高"}</span>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3 pt-2">
        <SectionHeader title="每小时" actions={state.selectedDay ?
          <Button variant="ghost" onClick={host.closeDay}>{"回到星期 × 小时"}</Button> : activity.slot ?
            <Button variant="ghost" onClick={() => host.set({ slot: null })}>{"全部时段"}</Button> : null} />
        <span className="text-caption text-muted-foreground">{state.selectedDay ?? activity.rangeLabel}</span>
        <div className="grid min-w-0 grid-cols-1 items-center gap-6 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            {activity.hours ?
              <div className="flex min-w-0 flex-col gap-3" data-usage-hours>
                {activity.hours.ready && activity.hours.draw ?
                  <Hovered>{(hourActive, setHourActive) => <BarChart
                    variant="columns"
                    height="hours"
                    bars={activity.hours?.hours ?? []}
                    active={hourActive}
                    onActiveChange={setHourActive}
                    ticks={activity.hours?.ticks}
                    tooltip={key => {
                      const hour = activity.hours?.hours.find(hour => hour.key === key);
                      return hour?.tip ? <TipCard {...hour.tip} /> : null;
                    }}
                    dataKey={state.selectedDay ?? "hours"}
                    aria-label="每小时用量，左右方向键逐小时查看"
                  />}</Hovered> : <EmptyState message={activity.hours.empty} />}
              </div> : activity.empty ? <EmptyState message={activity.empty} /> :
                <div className="min-w-0" data-usage-week-hour
                  onKeyDownCapture={event => {
                    if (event.key === "Escape" && !event.nativeEvent.isComposing && event.keyCode !== 229 && state.slot)
                      host.set({ slot: null });
                  }}>
                  <Hovered>{(weekActive, setWeekActive) => <Heatmap
                    variant="weekHour"
                    rows={7}
                    cols={24}
                    cells={activity.cells}
                    rowLabels={weekdays}
                    colLabels={hours}
                    colLabelsPosition="bottom"
                    sizing="fit-square"
                    selected={activity.slot?.key ?? null}
                    active={weekActive ?? activity.peakSlot}
                    onActiveChange={setWeekActive}
                    tooltip={key => {
                      const cell = activity.cells.find(cell => cell.key === key);
                      return cell ? <TipCard {...cell.tip} /> : null;
                    }}
                    onSelect={key => {
                      const [day, hour] = key.split(":").map(Number);
                      host.set({ slot: activity.slot?.key === key ? null : { day, hour } });
                    }}
                    dataKey={calendar.start + ":week-hour"}
                    aria-label="按星期和小时的用量分布，方向键移动，回车查看明细"
                  />}</Hovered>
                </div>}
          </div>
          <div className="min-w-0">
            {activity.hours ? activity.hours.ready ? <AsideFacts items={activity.hours.facts} /> : null : activity.slot ?
              <div className="flex min-w-0 flex-col gap-3" data-usage-slot>
                <span className="text-subtitle font-semibold">{activity.slot.label}</span>
                <div className="flex flex-wrap items-baseline gap-4">
                  <Value value={activity.slot.tokens} />
                  <Price value={activity.slot.price} />
                </div>
                {activity.slot.shares.map(item =>
                  <div key={item.key} className="flex flex-wrap items-center gap-3">
                    {item.key !== "other" ? <AgentMark agent={item.key} variant="icon" size={16} /> : null}
                    <span className="text-body" title={item.name}>{item.name}</span>
                    <Value value={item.tokens} />
                    <Value value={item.share} />
                  </div>
                )}
              </div> : <AsideFacts items={activity.facts} actions={{ "最集中的时段": activity.peakSlot ? () => {
                const [day, hour] = activity.peakSlot!.split(":").map(Number);
                host.set({ slot: { day, hour } });
              } : undefined }} />}
          </div>
        </div>
      </div>
    </Card>
    {day ?
      <section tabIndex={-1} data-usage-day={day.date} className="outline-none">
        <Card>
          <SectionHeader title={day.date} actions={
            <IconButton icon={IconX} label="关闭当日明细" onClick={host.closeDay} />
          } />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Facts inline items={[{ label: "总 Token", value: day.tokens }, { label: "用量记录", value: day.records }]} />
            <div data-usage-day-cost>
              <Price value={day.price} size="sm" />
            </div>
          </div>
          {day.observed ?
            <>
              <Categories value={day.categories} />
              <ScrollArea maxHeight="lg" aria-label="当日 Agent 与模型明细">
                <Clients items={day.clients} host={host} />
              </ScrollArea>
            </> : <EmptyState message="未观测到该日记录" />}
        </Card>
      </section> : null}
  </section>;
}
