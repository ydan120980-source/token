import { useEffect, useRef, useState } from "react";
import { AgentMark, Button, Combobox, Disclosure, Select, TextField } from "@ui/kit";
import { getGlobals, type BillingDraft } from "@ui/data";
import { saveConfig, setResult, usePricing } from "./store";

const modes: { value: BillingDraft["mode"]; label: string }[] = [{ value: "actual", label: "实际记录模型" }, { value: "default", label: "指定默认模型" }];

// Per-Agent multiplier and default billing model. Drafts are kept while edited: a reload from a
// status or collector notification never replaces a rule the person is changing.
export function BillingRules() {
  const { uiPricing: pricing, pricingEditorModel: model } = getGlobals();
  const { billing, rows, names, savingBilling } = usePricing();
  const agents = Object.keys(names);
  const [drafts, setDrafts] = useState<Record<string, BillingDraft>>({}), [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = useRef(false), fields = useRef<Record<string, HTMLInputElement | null>>({});
  useEffect(() => {
    if (dirty.current) return;
    setDrafts(Object.fromEntries(agents.map(agent => [agent, model.billingDraft(billing, agent)]))); setErrors({});
    // agents comes from names, so names stands in for it here.
  }, [billing, names, model]);
  const edit = (agent: string, patch: Partial<BillingDraft>) => { dirty.current = true; setDrafts(current => ({ ...current, [agent]: { ...(current[agent] ?? model.billingDraft(billing, agent)), ...patch } })); };
  const targets = model.priceTargets(rows, pricing).map(value => ({ value, label: value }));
  const save = async () => {
    const defaults: Record<string, ReturnType<typeof model.billingValue>> = {}, nextErrors: Record<string, string> = {};
    let first: string | null = null;
    for (const agent of agents) {
      const draft = drafts[agent] ?? model.billingDraft(billing, agent), check = model.billingCheck(draft, rows, pricing);
      if (check.error) { nextErrors[agent] = check.error; first ??= agent; }
      defaults[agent] = model.billingValue(draft);
    }
    setErrors(nextErrors);
    if (first) { if (!model.billingCheck(drafts[first] ?? model.billingDraft(billing, first), rows, pricing).valid) fields.current[first]?.focus(); return; }
    const outcome = await saveConfig({ ...billing, defaults }, "计费规则已保存，历史估算已更新。", "panel");
    if (outcome.ok) dirty.current = false;
  };
  return <Disclosure flush summary={<span className="text-subtitle font-semibold text-foreground">Agent 计费规则</span>}>
    <div className="flex flex-col gap-3" data-billing-rules>
      {agents.map(agent => {
        const draft = drafts[agent] ?? model.billingDraft(billing, agent), name = names[agent];
        return <div key={agent} className="flex flex-col gap-2 border-b border-border py-3" data-billing-agent={agent}>
          <div className="flex flex-wrap items-end gap-3">
            <span className="flex items-center gap-2 text-body font-medium text-foreground"><AgentMark agent={agent} variant="icon" size={16} />{name}</span>
            <Select value={draft.mode} onChange={mode => edit(agent, { mode })} options={modes} aria-label={name + " 计费模式"} />
            <TextField ref={element => { fields.current[agent] = element; }} value={draft.multiplier} onChange={multiplier => edit(agent, { multiplier })} label={name + " 倍率"} type="number" min={0} max={1000} step="any" required inputMode="decimal" />
            {draft.mode === "default" ? <Combobox value={draft.model || null} onChange={value => edit(agent, { model: value })} options={targets} placeholder="搜索模型" searchPlaceholder="搜索模型" emptyText="目录中没有这个可计价模型。" aria-label={name + " 默认模型"} /> : null}
            <Button variant="tertiary" size="compact" onClick={() => { edit(agent, { mode: "actual", multiplier: "1", model: "" }); setErrors(current => ({ ...current, [agent]: "" })); setResult("已恢复此 Agent 的默认值，点击“保存规则”后生效。"); }}>恢复默认</Button>
          </div>
          {errors[agent] ? <span className="text-caption text-destructive" role="status">{errors[agent]}</span> : null}
        </div>;
      })}
      <div className="flex justify-end"><Button variant="primary" disabled={savingBilling} onClick={() => void save()}>保存规则</Button></div>
    </div>
  </Disclosure>;
}
