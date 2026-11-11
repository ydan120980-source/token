import { useState, type ReactNode } from "react";
import { AgentMark, DataTable, Figure, Reveal, StackBar, Value, ValueButton, type Column } from "@ui/kit";
import type { UsageCategories, UsageClient, UsageFact, UsageHost, UsagePrice } from "@ui/data/usage-host";

/** Holds one chart's hovered key, so a hover re-renders that chart alone, not the page section around it. */
export function Hovered({ children }: { children: (active: string | null, setActive: (key: string | null) => void) => ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  return <>{children(active, setActive)}</>;
}

export function Price({ value, size, animated = true }: { value: UsagePrice; size?: "xl" | "md" | "sm"; animated?: boolean }) {
  return <span className="inline-flex" data-usage-price-lower={value.lowerValue ?? ""} data-usage-price-upper={value.upperValue ?? ""}>
    <Reveal
      aria-label={value.label}
      trigger={size ?
        <Figure text={value.lower} size={size} unknown="未定价" animated={animated} /> :
        <Value value={value.lower} unknown="未定价" />}
      content={
        <>
          <Value value={value.bounds} />
          <span>
            {"定价覆盖 "}
            <Value value={value.coverage} />
          </span>
        </>
      }
    />
  </span>;
}

export function Facts({ items, onDay, inline = false }: {
  items: UsageFact[]; onDay?: (day: string) => void; inline?: boolean;
}) {
  return <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
    {items.map(item =>
      <div key={item.label} className={inline ? "flex items-baseline gap-1" : "flex min-w-0 flex-col gap-1"} title={item.title}>
        <span className="text-caption text-muted-foreground">{item.label}</span>
        <span className="font-semibold">
          {item.day && onDay ?
            <ValueButton onClick={() => onDay(item.day!)}>{item.value}</ValueButton> :
            <Value value={item.value} />}
        </span>
      </div>
    )}
  </div>;
}

/** Labelled values beside a chart; a value with an action (the old facts list's buttons) opens what it names. */
export function AsideFacts({ items, actions = {} }: { items: UsageFact[]; actions?: Record<string, (() => void) | undefined> }) {
  return <div className="flex min-w-0 flex-col" data-usage-aside-facts>
    {items.map(item =>
      <div key={item.label} className="flex min-h-9 items-center justify-between gap-3">
        <span className="text-caption text-muted-foreground">{item.label}</span>
        <span className="text-right text-body font-semibold">
          {actions[item.label] && item.value !== null ? <ValueButton onClick={actions[item.label]!}>{item.value}</ValueButton> : <Value value={item.value} />}
        </span>
      </div>
    )}
  </div>;
}

export function Categories({ value }: { value: UsageCategories }) {
  return <div className="flex min-w-0 flex-col gap-3" data-usage-categories>
    <StackBar segments={value.segments} height={6} unknown={value.unknown} aria-label="Token 分类构成" />
    <div className="flex flex-wrap gap-4">
      {value.tiles.map(tile =>
        <span key={tile.key} title={tile.title} className="flex items-baseline gap-2 text-caption"
          data-usage-category={tile.key} data-category-state={tile.state}>
          <span className="text-muted-foreground">{tile.label}</span>
          <Value value={tile.text} />
        </span>
      )}
    </div>
  </div>;
}

interface ClientRow { key: string; client: UsageClient; model?: UsageClient["models"][number] }
export function Clients({ items, host, today = false }: { items: UsageClient[]; host: UsageHost; today?: boolean }) {
  const rows: ClientRow[] = items.flatMap(client => [
    { key: client.id, client }, ...client.models.map(model => ({ key: client.id + "/" + model.key, client, model })),
  ]);
  const numeric = (label: string) => <span className="flex justify-end text-right">{label}</span>;
  const columns: Column<ClientRow>[] = [
    { key: "name", label: "模型", render: row => row.model ?
      <span className="flex min-w-40 items-center pl-8 text-caption" data-usage-client-model={row.model.key}>
        <span className="break-all" title={row.model.name}>{row.model.name}</span>
      </span> :
      <span className="flex min-w-48 flex-wrap items-center gap-3" data-usage-client={row.client.id}>
        <AgentMark agent={row.client.id} variant="icon" size={20} />
        <span className="text-body font-semibold">{row.client.name}</span>
        <span className="flex items-baseline gap-1 text-caption text-muted-foreground">
          {today && row.client.sessions !== null && row.client.sessions > 0 ?
            <span data-usage-session-agent={row.client.id}>
              <ValueButton onClick={() => host.openSessions(row.client.id)}>{row.client.sessions}{" 个会话"}</ValueButton>
              {" · "}
            </span> : null}
          <span data-usage-client-records>{row.client.records}{" 条记录"}</span>
        </span>
      </span> },
    { key: "share", label: "占比", header: numeric("占比"), render: row => row.model ?
      <span className="flex min-w-24 items-center justify-end gap-3">
        <span className="w-12">
          <StackBar height={4} unknown={row.model.fraction === null}
            segments={row.model.fraction === null ? [] : [{ key: row.key, value: row.model.fraction,
              tone: "ink:3", label: row.model.name + " " + (row.model.share ?? "未知") }]} aria-label={row.model.name + " 占比"} />
        </span>
        <span className="text-caption">
          <Value value={row.model.share} />
        </span>
      </span> : null },
    { key: "output", label: "输出", header: numeric("输出"), render: row => row.model ?
      <span className="flex justify-end text-right text-caption">
        <Value value={row.model.output} />
      </span> : null },
    { key: "hit", label: "缓存命中", header: numeric("缓存命中"), render: row => row.model ?
      <span className="flex justify-end text-right text-caption">
        <Value value={row.model.hit} />
      </span> : null },
    { key: "tokens", label: "Token", header: numeric("Token"), render: row =>
      <span className={"flex justify-end text-right text-caption " + (row.model ? "" : "font-semibold")}>
        <Value value={(row.model ?? row.client).tokens} />
      </span> },
    { key: "cost", label: "估算", header: numeric("估算"), render: row =>
      <span className={"flex justify-end text-caption " + (row.model ? "" : "font-semibold")}>
        <Price value={(row.model ?? row.client).price} />
      </span> },
  ];
  return <div className="min-w-0 overflow-x-auto" data-usage-clients>
    <DataTable size="compact" variant="plain" columns={columns} rows={rows} rowKey={row => row.key}
      rowEmphasis={row => !row.model} groupStart={row => !row.model} />
  </div>;
}
