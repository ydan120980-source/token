import { IconCalendar } from "@tabler/icons-react";
import { AnchoredPopover, Button, CheckboxGroup, RangeCalendar, Segmented, focusCalendarDay } from "@ui/kit";
import type { CostHost } from "@ui/data/cost-host";

const periods = [{ value: "all", label: "累计" }, { value: "30", label: "30 天" }, { value: "7", label: "7 天" }, { value: "today", label: "今日" }];

/** The date range of the cost page: a small popover from its button in the hero. */
export function RangePicker({ host, label }: { host: CostHost; label: string | null }) {
  const { state, folds, view } = host.get();
  return <AnchoredPopover open={folds.rail} onOpenChange={host.rail} label="日期范围" onOpenFocus={focusCalendarDay} data-cost-range-sheet=""
    trigger={<Button variant="ghost" size="compact" leadingIcon={IconCalendar} onClick={() => host.rail(!folds.rail)} aria-label="用日历选择范围">{label ?? "日历"}</Button>}>
    <RangeCalendar
      value={{ from: view.span.from ?? host.coverageStart() ?? host.today(), to: view.span.to ?? host.today() }}
      min={host.coverageStart() ?? host.today()}
      max={host.today()}
      onChange={span => host.selectRange(span.from, span.to)}
      marks={[...new Set(view.all.map(row => row.date))]}
      commit="second-click"
      aria-label="费用日期范围" />
    <Segmented value={state.month || state.custom ? "" : state.period} onChange={host.period} size="compact" items={periods} aria-label="费用日期快捷范围" />
    {state.month || state.custom ?
      <div><Button variant="tertiary" size="compact" onClick={() => host.set({ month: null, custom: null, cal: null })}
        aria-label={state.month ? "取消按月查看 " + host.model.monthLabel(state.month) : "取消自定义范围 " + view.span.label}>
        {state.month ? host.model.monthLabel(state.month) : view.span.label}
        <span aria-hidden="true">{" ×"}</span>
      </Button></div> : null}
    <CheckboxGroup value={state.gapsOnly ? ["gaps"] : []}
      onChange={values => host.set({ gapsOnly: values.includes("gaps"), all: false })}
      items={[{ value: "gaps", label: "明细只看未计入" }]} />
  </AnchoredPopover>;
}
