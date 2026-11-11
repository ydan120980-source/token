import { Fragment, useState } from "react";
import { Badge, Button, Card, DataTable, Figure, Meter, ScrollArea, SearchField, Switch, Value } from "@ui/kit";
import { getGlobals, type UsedModel } from "@ui/data";
import { Block, Section } from "../search";
import { BillingRules } from "./billing";
import { CodexMaintenance, Reprice } from "./maintenance";
import { openEditor, openFix, setAutoSync, syncNow, undoFix, usePricing } from "./store";

// The pricing section: how much of the usage is priced, the used models with what each is billed
// as, Agent rules, re-estimation, Codex maintenance and the catalog's provenance.
export function PricingSection() {
  const store = usePricing();
  return <Section name="pricing" title="定价">
    {store.available ? <PricingPanel /> : <Block><Card><p className="text-body text-muted-foreground">成本定价与 Codex 用量维护在桌面应用中可用。</p></Card></Block>}
  </Section>;
}

function PricingPanel() {
  const { uiPricing: pricing, uiPricingView: view, pricingEditorModel: model } = getGlobals();
  const store = usePricing(), { data, models, gaps } = store;
  const [query, setQuery] = useState(""), [expanded, setExpanded] = useState(false);
  const coverage = pricing.coverage(window.usageModels ?? {}), totals = pricing.unpricedTotals(gaps);
  const percent = model.coverageText(coverage), shares = model.shares(coverage, totals), legend = view.coverageLegend(coverage, totals);
  const legendText = legend.empty ?? legend.items.map(item => item.label + " " + item.tokens).concat(legend.total).join(" · ");
  const table = model.table(models, gaps, query, expanded, pricing);
  const columns = [
    { key: "model", label: "模型", render: (item: UsedModel) => { const row = view.row(item, table.byGap[item.key], pricing); return <span className="flex flex-col items-start gap-1"><Button variant="ghost" size="compact" aria-label={row.openLabel} onClick={() => void openEditor(item.key, true)}>{row.model}</Button><span className="pl-3 text-caption text-muted-foreground">{row.detail}</span></span>; } },
    { key: "basis", label: "计费依据", title: (item: UsedModel) => view.row(item, table.byGap[item.key], pricing).routedTo ?? undefined,
      render: (item: UsedModel) => { const row = view.row(item, table.byGap[item.key], pricing); return <span className="flex flex-col items-start gap-1"><Badge tone={row.scope === "priced" ? "neutral" : "warn"}>{row.basis}</Badge>{row.routedTo ? <span className="text-caption text-muted-foreground">按 {row.routedTo}</span> : null}</span>; } },
    { key: "rates", label: "每百万 Token 价格", headerTitle: "输入 · 输出 · 缓存读取 · 缓存写入", title: (item: UsedModel) => view.rates(item.row, pricing).title || undefined,
      render: (item: UsedModel) => { const rates = view.rates(item.row, pricing); return rates.priced ? <span className="tabular-nums">{rates.values.map((value, index) => <Fragment key={index}>{index ? " · " : ""}<Value value={value} /></Fragment>)}</span> : <Value value={null} unknown="未定价" />; } },
    { key: "usage", label: "用量", title: (item: UsedModel) => view.row(item, table.byGap[item.key], pricing).leftOut?.title,
      render: (item: UsedModel) => { const row = view.row(item, table.byGap[item.key], pricing); return <span className="flex flex-col items-end gap-1 tabular-nums"><span>{row.tokens}</span>{row.leftOut ? <span className={"text-caption " + (row.leftOut.fixable ? "text-warn-text" : "text-muted-foreground")}>{row.leftOut.text}</span> : row.share ? <span className="text-caption text-muted-foreground">{row.share}</span> : null}</span>; } },
  ];
  return <>
    <Block>
      <Card>
        <div className="flex flex-col gap-3" data-pricing-summary>
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Figure text={percent} size="md" unit="的用量已定价" />
              <Meter aria-label={legendText} segments={[{ value: shares.priced, tone: "done", label: "已定价" }, { value: shares.fixable, tone: "warn", label: "可设置价格" }, { value: shares.incomplete, tone: "muted", label: "来源未报告完整" }]} />
              <p className="text-caption text-muted-foreground" data-coverage-legend>{legendText}</p>
              {gaps.length ? <div className="flex flex-wrap items-center gap-3" data-fix-entry>
                <span className="text-body text-foreground">{gaps.length + " 个模型有 " + view.short(totals.fixable + totals.incomplete) + " Token 没算进费用"}</span>
                <Button variant="primary" size="compact" onClick={openFix}>一键处理</Button>
              </div> : null}
              {store.active?.fallbackTokens ? <p className="text-caption text-muted-foreground" data-fix-active="fallback">{"其中 " + view.short(store.active.fallbackTokens) + " Token 是保底估算（" + model.money(store.active.fallbackUsd) + "），按 " + store.billing.fallback + " 计算"}</p> : null}
              {store.active?.floorTokens ? <p className="text-caption text-destructive" data-fix-active="floor">{"其中 " + view.short(store.active.floorTokens) + " Token 只算了已报告字段，实际至少 " + model.money(store.active.floorUsd)}</p> : null}
              {store.undo ? <div className="flex flex-wrap items-center gap-3" data-fix-undo><span className="text-caption text-muted-foreground">刚才的一键处理</span><Button variant="tertiary" size="compact" disabled={store.savingBilling} onClick={() => void undoFix()}>撤销</Button>{!gaps.length ? <Button variant="tertiary" size="compact" onClick={openFix}>调整</Button> : null}</div> : null}
            </div>
            <div className="flex flex-col items-end gap-2">
              <p className="text-caption text-muted-foreground" role="status" data-sync-state>{model.syncText(store.syncing ? { enabled: store.billing.autoSync, syncing: true } : data?.sync, pricing)}</p>
              <div className="flex items-center gap-3">
                <Switch checked={store.billing.autoSync} onChange={value => void setAutoSync(value)} label="自动同步" />
                <Button variant="secondary" size="compact" disabled={store.syncing || Boolean(data?.sync?.syncing)} onClick={() => void syncNow()}>立即同步</Button>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </Block>
    <Block>
      <Card title="模型价格" meta={table.count}>
        <div className="flex flex-col gap-3" data-price-models>
          {gaps.length ? <p className="text-caption text-muted-foreground">{model.attentionText(gaps, totals)}</p> : null}
          <SearchField value={query} onChange={setQuery} placeholder="筛选模型或服务商" aria-label="筛选已用模型" />
          {table.rows.length ? <ScrollArea maxHeight="lg" aria-label="已用模型与计费依据">
            <DataTable rows={table.rows} rowKey={item => item.key} onRowClick={item => void openEditor(item.key, true)} columns={columns} />
          </ScrollArea> : <p className="text-body text-muted-foreground">{table.empty}</p>}
          <div className="flex flex-wrap items-center gap-3">
            {table.folded ? <Button variant="tertiary" size="compact" onClick={() => setExpanded(!expanded)}>{table.expandText}</Button> : null}
            <Button variant="tertiary" size="compact" onClick={() => void openEditor(null)}>为其他模型添加价格</Button>
          </div>
        </div>
      </Card>
    </Block>
    <Block>
      <Card>
        <div className="flex flex-col gap-3">
          <BillingRules />
          <Reprice />
          <p className="text-caption text-foreground empty:hidden" role="status" data-price-result>{store.result}</p>
        </div>
      </Card>
    </Block>
    <Block><Card><CodexMaintenance /></Card></Block>
    <p className="text-caption text-muted-foreground" title={view.catalogTitle(data)} data-catalog-line>{view.catalogLine(data, pricing)}</p>
  </>;
}
