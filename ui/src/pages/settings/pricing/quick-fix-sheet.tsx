import { useEffect, useRef, useState } from "react";
import { Button, Combobox, Sheet, Switch } from "@ui/kit";
import { getGlobals, type PricePlan } from "@ui/data";
import { applyFix, closeFix, pricePlan, usePricing } from "./store";

const WHY: Record<string, string> = {
  "auto-off": "可自动匹配",
  "several-prices": "有多个候选且价格不同，需要你选一个",
  "no-whole-candidate": "候选的费率不全，选了也算不完",
  "no-candidate": "价格目录里没有相同的模型",
  "manual-incomplete": "手动价格缺少费率",
};

// One click for a gap, with what it will do shown before it does anything (owner 2026-11-03,
// docs/m2/UI-OWNER-FIVE-BATCHES-20261103.md). Every choice re-asks the backend, so the figures are exactly what
// applying does. A, B and the red C are separate and each can stay off.
export function QuickFixSheet() {
  const { uiPricing: pricing, uiPricingView: view, pricingEditorModel: model } = getGlobals();
  const store = usePricing(), { billing, rows, fixOpen } = store;
  const [auto, setAuto] = useState(true), [fallback, setFallback] = useState<string | null>(null), [partial, setPartial] = useState(false);
  const [plan, setPlan] = useState<PricePlan | null>(null), [failed, setFailed] = useState(false), request = useRef(0);
  useEffect(() => { if (fixOpen) { setAuto(true); setFallback(billing.fallback ?? null); setPartial(Boolean(billing.partialLowerBound)); setPlan(null); setFailed(false); } }, [fixOpen]);
  useEffect(() => {
    if (!fixOpen) return;
    const ask = ++request.current; setFailed(false);
    pricePlan({ auto, fallback, partial }).then(value => { if (ask === request.current) setPlan(value); }).catch(() => { if (ask === request.current) setFailed(true); });
  }, [fixOpen, auto, fallback, partial, billing]);
  const targets = model.priceTargets(rows, pricing).map(value => ({ value, label: value }));
  const apply = async () => {
    if (!plan) return;
    const next = { ...billing, mappings: { ...billing.mappings, ...plan.mappings }, fallback, partialLowerBound: partial };
    const outcome = await applyFix(next, "已应用：" + model.share(plan.after) + " 的用量已计入估算。");
    if (outcome.ok) closeFix();
  };
  const share = plan ? model.share(plan.after) : null, before = plan ? model.share(plan.before) : null;
  return <Sheet scrollable open={fixOpen} onOpenChange={open => { if (!open) closeFix(); }} title="一键处理" size="lg"
    footer={<div className="flex w-full flex-wrap items-center justify-between gap-3">
      <p className="text-body text-foreground" role="status" data-fix-result>{failed ? "试算没有完成，什么都没有改变；请重试。" : plan ? "已计入 " + before + " → " + share + (plan.after.lower !== null ? " · 估算 " + model.money(plan.after.lower) : "") : "正在试算…"}</p>
      <Button variant="primary" disabled={!plan || store.savingBilling} onClick={() => void apply()}>应用</Button>
    </div>}>
    <div className="flex flex-col gap-6" data-quick-fix>
      <section className="flex flex-col gap-2" data-fix-auto>
        <div className="flex items-center justify-between gap-3"><span className="text-subtitle font-semibold text-foreground">自动匹配</span><Switch checked={auto} onChange={setAuto} label="使用" /></div>
        {plan?.matched.length ? plan.matched.map(item => <div key={item.key} className="flex items-baseline justify-between gap-3 text-body" data-fix-match={item.key}>
          <span className="min-w-0 flex-1 break-words text-foreground">{item.key} → {item.target}</span><span className="shrink-0 text-caption tabular-nums text-muted-foreground">{view.short(item.tokens)} Token</span>
        </div>) : <p className="text-caption text-muted-foreground">{plan ? "没有能自动确定的模型" : ""}</p>}
      </section>
      <section className="flex flex-col gap-2" data-fix-fallback>
        <span className="text-subtitle font-semibold text-foreground">保底模型</span>
        <p className="text-caption text-muted-foreground">没有价格的模型都按它估算，已有价格的不变。费用里单独标“保底估算”。</p>
        <Combobox value={fallback} onChange={setFallback} options={targets} placeholder="不使用" searchPlaceholder="搜索目录模型" emptyText="目录中没有这个可计价模型。" aria-label="保底模型" />
        {fallback ? <Button variant="tertiary" size="compact" onClick={() => setFallback(null)}>不使用保底模型</Button> : null}
        {plan?.fallback ? <p className="text-body text-foreground" data-fix-fallback-gain>{plan.fallback.models.length + " 个模型、" + view.short(plan.fallback.tokens) + " Token 计入，约 " + model.money(plan.fallback.lower)}</p> : null}
        {!plan?.fallback && plan?.undecided.length ? <div className="flex flex-col gap-1" data-fix-undecided>{plan.undecided.map(item => <div key={item.key} className="flex items-baseline justify-between gap-3 text-caption">
          <span className="min-w-0 flex-1 break-words text-foreground">{item.key}</span><span className="shrink-0 text-muted-foreground">{WHY[item.why] ?? ""}</span>
        </div>)}</div> : null}
      </section>
      <section className="flex flex-col gap-2 rounded-xl bg-destructive-light p-3 ring-1 ring-destructive" data-fix-floor>
        <div className="flex items-center justify-between gap-3"><span className="text-subtitle font-semibold text-destructive">按已报告字段算下限（可选）</span><Switch checked={partial} onChange={setPartial} label="使用" /></div>
        <p className="text-caption text-destructive">这些记录缺数据。打开后只算已有字段，结果偏低，只能当作“至少这么多”。缺的字段不会被填成 0；两个来源冲突、记录自相矛盾的仍不计入。</p>
        {plan ? <p className="text-body text-foreground" data-fix-floor-gain>{plan.floor.tokens ? plan.floor.models.length + " 个模型、" + view.short(plan.floor.tokens) + " Token，至少 " + model.money(plan.floor.lower) : "没有可以这样算的记录"}</p> : null}
      </section>
      {plan?.after.left.length ? <section className="flex flex-col gap-2" data-fix-left>
        <span className="text-subtitle font-semibold text-foreground">仍不能计入</span>
        {model.leftLines(plan.after.left, pricing).map(line => <p key={line} className="text-caption text-muted-foreground">{line}</p>)}
      </section> : null}
    </div>
  </Sheet>;
}
