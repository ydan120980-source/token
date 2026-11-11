import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Combobox, Disclosure, Form, Segmented, Sheet, TextField } from "@ui/kit";
import { focusSource, getGlobals, type PriceCoverage, type PriceField } from "@ui/data";
import { closeEditor, openFix, probePrice, resetPrice, saveConfig, savePrice, tryPrice, usePricing } from "./store";

type Mode = "map" | "manual";
const modes: { value: Mode; label: string }[] = [{ value: "map", label: "按目录模型计费" }, { value: "manual", label: "手动价格" }];
const PROBE_DELAY_MS = 250;
const RANK: Record<string, number> = { full: 0, some: 1, none: 2, empty: 3 };
const TONE: Record<string, string> = { full: "text-success", some: "text-warn", none: "text-destructive", empty: "text-muted-foreground" };

// One sheet per model: what is left out and why, alias suggestions, the catalog mapping and the
// manual rate. Opened from the settings table and from the cost page (window.uiPricingEditor).
export function PriceEditorSheet() {
  const { uiPricing: pricing, uiPricingView: view, pricingEditorModel: model } = getGlobals();
  const store = usePricing(), { editor, rows, billing, models, gaps } = store;
  const key = editor.key;
  const [mode, setMode] = useState<Mode>("manual");
  const [provider, setProvider] = useState(""), [modelId, setModelId] = useState("");
  const [rates, setRates] = useState<Record<PriceField, string>>({ inputUncached: "", output: "", cacheRead: "", cacheWrite: "" });
  const [mappingTo, setMappingTo] = useState<string | null>(null), [mappingNote, setMappingNote] = useState("");
  const [template, setTemplate] = useState(""), [probe, setProbe] = useState(""), [manual, setManual] = useState(false), [saving, setSaving] = useState(false);
  const cacheWrite = useRef<HTMLInputElement>(null), firstField = useRef<HTMLInputElement>(null);
  const probeToken = useRef(0), probeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const heading = useMemo(() => model.editor(key, models, rows, pricing), [key, models, rows, pricing, model]);
  const gap = key ? gaps.find(item => item.key === key) ?? null : null;
  const status = view.status(gap, pricing), suggestions = gap ? view.suggestions(gap.key, gap.suggestions) : null;
  // Dry runs of the candidates and of whatever is chosen: whether it will count is known before saving.
  const [trials, setTrials] = useState<Record<string, PriceCoverage>>({}), [handPriced, setHandPriced] = useState(false), trial = useRef(0);
  const closable = !status || status.lines.some(line => line.fixable);
  const ranked = useMemo(() => [...suggestions?.candidates ?? []].sort((a, b) => RANK[model.verdict(trials[a.target], pricing).kind] - RANK[model.verdict(trials[b.target], pricing).kind]), [suggestions, trials, model, pricing]);
  const tryTargets = (targets: string[]) => {
    if (!key || !targets.length) return;
    const ask = ++trial.current;
    tryPrice(key, targets.slice(0, 16)).then(value => { if (ask !== trial.current) return; setHandPriced(value.manual); setTrials(current => ({ ...current, ...Object.fromEntries(value.results.map(item => [item.target, item.coverage])) })); }).catch(() => {});
  };
  const choose = (value: string) => { setMappingTo(value); setMappingNote(model.mappingPreview(value, rows, pricing)); if (!trials[value]) tryTargets([value]); };

  const entry = (values = rates, id = { provider, model: modelId }) => pricing.entry(id.provider, id.model, values);
  const cancelProbe = () => { ++probeToken.current; clearTimeout(probeTimer.current); };
  // Dry run: the backend reports what a save would touch, without writing.
  const runProbe = (values = rates, id = { provider, model: modelId }) => {
    const value = entry(values, id);
    if (!model.probeReady(value)) { setProbe(""); return; }
    const token = ++probeToken.current;
    probePrice(value).then(result => { if (token === probeToken.current) setProbe(model.probeText(result, pricing)); })
      .catch(error => { if (token === probeToken.current) setProbe(model.probeErrorText(error)); });
  };
  const scheduleProbe = (values = rates, id = { provider, model: modelId }) => { clearTimeout(probeTimer.current); probeTimer.current = setTimeout(() => runProbe(values, id), PROBE_DELAY_MS); };
  const switchMode = (next: Mode, target = mappingTo) => {
    cancelProbe(); setMode(next);
    if (next === "manual") scheduleProbe(); else setMappingNote(model.mappingPreview(target ?? "", rows, pricing));
  };

  // A new opening (serial) starts from the model's current rule.
  useEffect(() => {
    if (!editor.open) { cancelProbe(); return; }
    const values = Object.fromEntries(pricing.FIELDS.map(field => [field, heading.fill && heading.fill[field] != null ? String(heading.fill[field]) : ""])) as Record<PriceField, string>;
    const id = { provider: heading.provider, model: heading.model };
    setProvider(id.provider); setModelId(id.model); setRates(values); setManual(heading.manual);
    setMappingTo(key ? billing.mappings[key] || null : null); setTemplate(""); setProbe(""); setMappingNote(""); setTrials({}); setHandPriced(false);
    if (key) tryTargets([...new Set([...(billing.mappings[key] ? [billing.mappings[key]] : []), ...(gaps.find(item => item.key === key)?.suggestions?.candidates ?? []).map(candidate => candidate.target)])]);
    cancelProbe(); setMode(heading.startMode);
    if (heading.startMode === "manual") { if (editor.probe) runProbe(values, id); else scheduleProbe(values, id); }
    else setMappingNote(model.mappingPreview(key ? billing.mappings[key] || "" : "", rows, pricing));
    if (!key) requestAnimationFrame(() => firstField.current?.focus());
    return cancelProbe;
    // Only a new opening resets the form; reloads keep what the person typed.
  }, [editor.open, editor.serial]);

  const setRate = (field: PriceField, value: string) => { const next = { ...rates, [field]: value }; setRates(next); scheduleProbe(next); };
  const submitMapping = async () => {
    if (!key || !mappingTo) return;
    const outcome = await saveConfig({ ...billing, mappings: { ...billing.mappings, [key]: mappingTo } }, key + " 现按 " + mappingTo + " 计费，原始模型标识保留。", "editor");
    if (outcome.message) setMappingNote(outcome.message);
    if (outcome.ok) closeEditor();
  };
  const unmap = async () => {
    if (!key) return; const mappings = { ...billing.mappings }; delete mappings[key];
    const outcome = await saveConfig({ ...billing, mappings }, "已恢复自动匹配：" + key + " 按实际记录模型计费。", "editor");
    if (outcome.message) setMappingNote(outcome.message);
    if (outcome.ok) closeEditor();
  };
  const submitPrice = async () => {
    cancelProbe(); if (saving) return; setSaving(true);
    const failed = await savePrice(entry()); setSaving(false);
    if (failed) setProbe(failed); else setTemplate("");
  };
  const removePrice = async () => { cancelProbe(); const failed = await resetPrice(entry()); if (failed) setProbe(failed); else setManual(false); };
  const templates = view.templateOptions(rows, template);
  const targets = model.priceTargets(rows, pricing).map(value => ({ value, label: value }));

  return <Sheet open={editor.open} onOpenChange={open => { if (!open) closeEditor(); }} title={heading.title} description={heading.eyebrow + " · " + heading.meta} size="lg">
    <div className="flex flex-col gap-3" data-price-editor={key ?? ""}>
      {status ? <section className="flex flex-col gap-2" data-gap-help={status.key}>
        <span className="text-subtitle font-semibold text-foreground">{status.title} <span className="text-caption text-muted-foreground">{status.amount}</span></span>
        <ul className="flex flex-col gap-1">{status.lines.map(line => <li key={line.text} className="text-body text-foreground">{line.text}</li>)}</ul>
        <span className="text-subtitle font-semibold text-foreground">处理方法</span>
        {!closable ? <p className="text-body text-foreground" data-gap-plain>这是记录本身缺数据，改价格算不进去。其余记录不受影响。</p> : null}
        {status.guides.map(guide => <div key={guide.title} className="flex flex-col gap-1"><span className="text-body font-medium text-foreground">{guide.title}</span><Disclosure summary={<span className="text-caption text-muted-foreground">查看步骤</span>}><ol className="flex list-decimal flex-col gap-1 pl-4">{guide.steps.map(step => <li key={step} className="text-caption text-muted-foreground">{step}</li>)}</ol></Disclosure></div>)}
        {!closable || status.checkManual || status.sources.length ? <div className="flex flex-wrap items-center gap-3">
          {!closable ? <Button variant="secondary" size="compact" onClick={openFix}>一键处理</Button> : null}
          {status.checkManual ? <Button variant="secondary" size="compact" onClick={() => { switchMode("manual"); requestAnimationFrame(() => cacheWrite.current?.focus()); }}>核对手动费率</Button> : null}
          {status.sources.map(source => <Button key={source.id} variant="secondary" size="compact" onClick={() => { closeEditor(); focusSource(source.id); }}>{source.label}</Button>)}
        </div> : null}
      </section> : null}
      {key ? <div className="flex flex-col gap-2">
        {status ? <span className="text-subtitle font-semibold text-foreground">计费方式</span> : null}
        <Segmented value={mode} onChange={next => switchMode(next)} items={modes} aria-label="计费方式" />
      </div> : null}
      {mode === "map" && key ? <Form onSubmit={() => void submitMapping()} aria-label="按目录模型计费">
        <p className="text-caption text-muted-foreground">适用于路由别名或代理模型：费用按所选目录模型计算，日志中的模型名称保持不变。</p>
        {handPriced ? <p className="text-body text-warn" data-mapping-blocked>这个模型已有手动价格，手动价格优先，选这里不会生效。要改用目录模型，先到“手动价格”移除它。</p> : null}
        {suggestions && closable ? <div className="flex flex-col gap-2" data-suggestions>
          <p className="text-caption text-muted-foreground"><span className="font-semibold text-foreground">{suggestions.title}</span> {suggestions.note}</p>
          {ranked.map(candidate => <div key={candidate.target} className="flex items-center justify-between gap-3 border-b border-border py-2" data-candidate={candidate.target} data-chosen={candidate.target === mappingTo ? "" : undefined}>
            <div className="flex min-w-0 flex-col gap-1"><span className="text-body font-medium text-foreground">{candidate.target}</span><span className="text-caption text-muted-foreground">{candidate.reason}</span><span className="text-caption text-muted-foreground">{candidate.provenance}</span><span className="text-caption text-muted-foreground">{candidate.rates}</span>
              {trials[candidate.target] ? <span className={"text-caption font-semibold " + TONE[model.verdict(trials[candidate.target], pricing).kind]} data-candidate-verdict={model.verdict(trials[candidate.target], pricing).kind}>{model.verdict(trials[candidate.target], pricing).label}</span> : null}</div>
            <Button variant={candidate.target === mappingTo ? "secondary" : "tertiary"} size="compact" onClick={() => { choose(candidate.target); switchMode("map", candidate.target); }}>选择此模型</Button>
          </div>)}
          {suggestions.more ? <p className="text-caption text-muted-foreground">{suggestions.more}</p> : null}
        </div> : null}
        <Combobox value={mappingTo} onChange={choose} options={targets} placeholder="搜索目录模型" searchPlaceholder="搜索目录模型" emptyText="目录中没有这个可计价模型。" aria-label="计费模型" />
        <p className="text-caption text-muted-foreground" role="status" data-mapping-note>{mappingNote}</p>
        {mappingTo && trials[mappingTo] && !handPriced ? <div className="flex flex-col gap-1 rounded-xl bg-muted p-3" role="status" data-mapping-result={model.verdict(trials[mappingTo], pricing).kind}>
          <span className={"text-body font-semibold " + TONE[model.verdict(trials[mappingTo], pricing).kind]}>{model.verdict(trials[mappingTo], pricing).label}</span>
          <span className="text-body text-foreground">{model.verdict(trials[mappingTo], pricing).detail}</span>
          {model.verdict(trials[mappingTo], pricing).left.map(line => <span key={line} className="text-caption text-muted-foreground">{line}</span>)}
        </div> : null}
        <div className="flex items-center justify-end gap-3">
          {billing.mappings[key] ? <Button variant="tertiary" disabled={store.savingBilling} onClick={() => void unmap()}>恢复自动匹配</Button> : null}
          <Button variant="primary" type="submit" disabled={!mappingTo || store.savingBilling || handPriced || Boolean(mappingTo && trials[mappingTo] && model.verdict(trials[mappingTo], pricing).kind === "none")}>按此模型计费</Button>
        </div>
      </Form> : null}
      {mode === "manual" ? <Form onSubmit={() => void submitPrice()} onInvalid={() => setProbe("请填写有效的模型标识与每百万 Token 非负价格（最高 100000）。输入和输出必填，缓存留空表示未知，明确免费请填 0。")} aria-label="手动价格">
        {!key ? <div className="grid grid-cols-2 gap-3">
          <TextField ref={firstField} value={provider} onChange={value => { setProvider(value); scheduleProbe(rates, { provider: value, model: modelId }); }} label="服务商标识" placeholder="例如 openai" required maxLength={99} />
          <TextField value={modelId} onChange={value => { setModelId(value); scheduleProbe(rates, { provider, model: value }); }} label="模型标识" placeholder="例如 gpt-6.1-sol" required maxLength={179} />
        </div> : null}
        <Combobox value={templates.selected} onChange={value => { setTemplate(value); const row = model.templateRow(rows, value); if (row) { const next = Object.fromEntries(pricing.FIELDS.map(field => [field, row.rates[field] != null ? String(row.rates[field]) : ""])) as Record<PriceField, string>; setRates(next); scheduleProbe(next); } }}
          options={templates.options} placeholder="不复制" searchPlaceholder="搜索目录模型" emptyText="没有匹配的模型" aria-label="从目录模型复制价格（可选）" />
        <div className="flex items-center justify-between gap-3"><span className="text-subtitle font-semibold text-foreground">每百万 Token 价格</span><span className="text-caption text-muted-foreground">USD</span></div>
        <div className="grid grid-cols-2 gap-3">
          {pricing.FIELDS.map((field, index) => <TextField key={field} ref={field === "cacheWrite" ? cacheWrite : undefined} value={rates[field]} onChange={value => setRate(field, value)} label={pricing.LABELS[field]}
            type="number" step="any" min={0} max={100000} inputMode="decimal" required={index < 2} placeholder={view.fieldPlaceholder(field, index)} name={field} />)}
        </div>
        <p className="text-caption text-muted-foreground">只有供应商不单独收取缓存写入费时，才在“缓存写入”填 0。不确定就留空：这部分会显示为未计入估算，而不是按 0 计算。</p>
        <p className="text-caption text-foreground" role="status" data-probe>{probe}</p>
        <div className="flex items-center justify-end gap-3">
          <Button variant="tertiary" tone="danger" disabled={!manual} onClick={() => void removePrice()}>移除手动价格</Button>
          <Button variant="primary" type="submit" disabled={saving}>保存价格</Button>
        </div>
      </Form> : null}
    </div>
  </Sheet>;
}
