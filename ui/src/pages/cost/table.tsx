import { useState } from "react";
import { IconChevronRight } from "@tabler/icons-react";
import { AgentMark, Button, Card, DataTable, IconButton, EmptyState, LineChart, SearchField, Segmented, StackBar, TipCard, Value } from "@ui/kit";
import type { Column } from "@ui/kit";
import type { CostHost, CostRow, CostSnapshot } from "@ui/data/cost-host";
import { CostAmount } from "./amount";

export function RowSpark({ row }: { row: CostRow }) {
  const [active, setActive] = useState<number | null>(null);
  if (!row.points.length) return null;
  return <LineChart
    variant="spark"
    size="row"
    x={row.points.map(point => ({ key: point.key, label: point.label }))}

    series={[{ key: "tokens", label: "Token", tone: "cost:line", style: "area", values: row.points.map(point => point.value) }]}

    active={active}
    onActiveChange={setActive}
    tooltip={index => {
      const point = row.points[index];
      return point ? <TipCard title={point.key} rows={[{ key: "tokens", label: "Token", tone: "cost:line",
        value: <Value value={point.value === null ? null : point.readout.slice(point.key.length + 3)} unknown="未报告" /> }]} /> : null;
    }}

    aria-label={row.name + " 的每日 Token"} />;
}
export function CostTableView({ host, snapshot }: { host: CostHost; snapshot: CostSnapshot }) {
  const { state, view } = snapshot;
  const open = (row: CostRow) => row.other ? host.set({ all: true }) : host.set({ open: state.open === row.key ? null : row.key });
  const sort = (value: "tokens" | "cost", label: string) => <Segmented value={state.sort}
    onChange={sort => host.set({ sort })} items={[{ value, label }]} size="compact" aria-label="费用明细排序" />;
  const columns: Column<CostRow>[] = [
    {
      key: "mark", label: "", render: row => row.agent ?
        <AgentMark agent={row.agent} variant="icon" /> : null
    },
    {
      key: "name", label: state.by === "agent" ? "Agent · 模型数" : "模型 · 使用方", title: row => row.title,
      render: row => <>
        <span data-cost-row-name className="block w-44 break-words text-body text-foreground">{row.name}</span>
        <small className="block w-44 break-words text-micro text-muted-foreground">{row.sub}</small>
      </>
    },
    { key: "tokens", label: "Token", header: sort("tokens", "Token"), render: row => row.tokens },
    { key: "share", label: "占比", render: row => row.share },
    {
      key: "amount", label: "估算", header: sort("cost", "估算"), render: row => <>
        <span className={"flex whitespace-nowrap tabular-nums " + (row.unknown ? "text-muted-foreground" : "font-semibold text-foreground")}
          data-cost-row-amount data-value={row.unknown ? "unknown" : undefined}>
          <CostAmount text={row.amount} />
        </span>
        {row.note ? <small className="flex whitespace-nowrap text-micro text-muted-foreground">{row.note}</small> : null}
      </>
    },
    { key: "rate", label: "每百万", render: row => <Value value={row.rate} unknown="—" /> },
    {
      key: "mix", label: "构成", render: row => <div className="w-20"><StackBar
        height={6}
        segments={row.mix}
        unknown={row.unknown}

        tooltip={key => <TipCard title="费用构成 · 已计价部分" rows={row.mix.map(part => {
          const split = part.label.indexOf(" ");
          return { key: part.key, label: part.label.slice(0, split), value: part.label.slice(split + 1), tone: part.tone, hatched: part.pattern === "hatched", pointed: key === part.key };
        })} />}
        aria-label={row.name + " 的费用构成"} /></div>
    },
    ...(view.span.compare ? [{
      key: "change", label: view.span.compare,
      render: (row: CostRow) => <Value value={row.change} unknown="—" />
    }] : []),
    { key: "spark", label: "走势", render: row => <RowSpark row={row} /> },
    {
      key: "open", label: "", render: row => <IconButton icon={IconChevronRight} size="compact" onClick={() => open(row)}
        label={row.other ? "展开全部，" + row.name : row.name + " 的费用详情"} />
    },
  ];
  return <section data-cost-table-section>
    <Card title="费用明细" meta={<Segmented
          value={state.by}
          onChange={host.group}
          size="compact"
          aria-label="按什么分组"

          items={[{ value: "model", label: "模型 " + view.counts.model }, { value: "agent", label: "Agent " + view.counts.agent }]} />}>
        <div className="flex flex-col gap-3" data-cost-table data-compare={Boolean(view.span.compare)}>{view.search ?
          <SearchField
            value={state.query}
            onChange={query => host.set({ query })}

            placeholder={state.by === "agent" ? "筛选 Agent" : "筛选模型或 Agent"}
            aria-label="筛选列表" /> : null}
          <DataTable
            columns={columns}
            rows={view.table.map(row => ({ ...row, expanded: state.open === row.key }))}

            rowKey={row => row.key}
            size="compact"
            onRowClick={open} />{!view.table.length ?
                <EmptyState message={state.query ? "没有匹配“" + state.query + "”的" + (state.by === "agent" ? " Agent。" : "模型。") :
                  view.rows.length ? "当前范围没有可显示的用量。" : "当前范围暂无用量。"} /> : null}{state.all && !state.query && view.canFold ?
                    <Button variant="ghost" size="compact" onClick={() => host.set({ all: false })}>{"收起，只看前 6 个"}</Button> : null}
        </div>
    </Card>
  </section>;
}
