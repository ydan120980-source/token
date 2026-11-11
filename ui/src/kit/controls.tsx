import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode, type ReactElement, type FormEvent, type KeyboardEvent } from "react";
import { IconSearch, IconX } from "@tabler/icons-react";
import { Button as FluidButton } from "@/components/ui/button";
import { Tabs, TabsList, TabItem } from "@/components/ui/tabs";
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle";
import { Select as FluidSelect, SelectTrigger, SelectContent, SelectItem, triggerVariants } from "@/components/ui/select";
import { DropdownMenu, DropdownTrigger, DropdownContent, DropdownSearch, DropdownEmpty } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Switch as FluidSwitch } from "@/components/ui/switch";
import { CheckboxGroup as FluidCheckboxGroup, CheckboxItem } from "@/components/ui/checkbox-group";
import { RadioGroup as FluidRadioGroup, RadioItem } from "@/components/ui/radio-group";
import { Slider as FluidSlider } from "@/components/ui/slider";
import { InputGroup, InputField } from "@/components/ui/input-group";
import { CarouselDots as FluidCarouselDots } from "@/components/ui/carousel-dots";
import type { IconComponent } from "@/lib/icon-context";
import { useSize } from "@/lib/size-context";
import { useShape } from "@/lib/shape-context";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";
import { isComposing } from "./ime";

type Size = "default" | "compact";
export interface ButtonProps {
  variant: "primary" | "secondary" | "tertiary" | "ghost";
  tone?: "danger";
  size?: Size;
  trimLabel?: boolean;
  type?: "button" | "submit";
  leadingIcon?: IconComponent;
  trailingIcon?: IconComponent;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  "aria-label"?: string; "aria-expanded"?: boolean; "aria-controls"?: string;
}

// Construct the native fluid element once so Radix can compose its own trigger
// attributes without widening the public kit Button API.
function buttonElement({ variant, tone, size = "default", trimLabel, type = "button", leadingIcon, trailingIcon, loading, disabled, onClick, children, "aria-label": label, "aria-expanded": expanded, "aria-controls": controls }: ButtonProps) {
  return <FluidButton type={type} variant={tone === "danger" ? "ghost" : variant} size={size}
    className={tone === "danger" ? "text-destructive hover:text-destructive" : undefined}
    leadingIcon={leadingIcon} trailingIcon={trailingIcon} loading={loading} disabled={disabled} trimLabel={trimLabel}
    aria-busy={loading || undefined} aria-label={label} aria-expanded={expanded} aria-controls={controls} onClick={onClick}>{children}</FluidButton>;
}
export function Button(props: ButtonProps) { return buttonElement(props); }

export interface IconButtonProps { icon: IconComponent; label: string; onClick: () => void; size?: Size; disabled?: boolean }
function iconButtonElement({ icon: Icon, label, onClick, size = "default", disabled }: IconButtonProps) {
  return <FluidButton type="button" variant="ghost" size={size === "compact" ? "icon-compact" : "icon"}
    aria-label={label} onClick={onClick} disabled={disabled}><Icon size={size === "compact" ? 14 : 16} /></FluidButton>;
}
export function IconButton(props: IconButtonProps) { return iconButtonElement(props); }

export function Segmented<T extends string>({ value, onChange, items, size = "default", "aria-label": label }: {
  value: T; onChange: (value: T) => void; items: { value: T; label: string; icon?: IconComponent; disabled?: boolean }[]; size?: Size; "aria-label": string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const hasSelection = items.some(item => item.value === value && !item.disabled);
  useLayoutEffect(() => {
    if (!hasSelection) list.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.setAttribute("tabindex", "0");
  }, [hasSelection, items]);
  return <Tabs value={value} onValueChange={next => { const item = items.find(item => item.value === next); if (item && !item.disabled) onChange(item.value); }} size={size}>
    <TabsList ref={list} aria-label={label} onKeyDown={event => {
      if (isComposing(event) || !["Home", "End"].includes(event.key)) return;
      const enabled = items.filter(item => !item.disabled), item = event.key === "Home" ? enabled[0] : enabled.at(-1);
      if (item) onChange(item.value);
    }}>{items.map(item => <TabItem key={item.value} value={item.value} label={item.label} icon={item.icon} disabled={item.disabled} />)}</TabsList>
  </Tabs>;
}

export function SubTabs({ value, onChange, items, idPrefix }: { value: number; onChange: (index: number) => void; items: string[]; idPrefix: string }) {
  return <TabsSubtle selectedIndex={value} onSelect={onChange} idPrefix={idPrefix}>
    {items.map((label, index) => <TabsSubtleItem key={label} index={index} label={label} />)}
  </TabsSubtle>;
}

export function Select<T extends string>({ value, onChange, options, placeholder, size = "default", disabled, "aria-label": label }: {
  value: T; onChange: (value: T) => void; options: { value: T; label: string }[]; placeholder?: string; size?: Size; disabled?: boolean; "aria-label": string;
}) {
  return <FluidSelect value={value} onValueChange={next => { const option = options.find(option => option.value === next); if (option) onChange(option.value); }} size={size} disabled={disabled}>
    <SelectTrigger placeholder={placeholder} aria-label={label} />
    <SelectContent>{options.map((option, index) => <SelectItem key={option.value} index={index} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </FluidSelect>;
}

// A single choice from a long list, with a search field in the popup. The trigger draws exactly
// like Select's; the popup is fluid's dropdown, so Escape closes only the popup inside a Sheet.
export function Combobox<T extends string>({ value, onChange, options, placeholder, searchPlaceholder, emptyText, size = "default", disabled, allowCustom = false, customLabel = text => `使用 “${text}”`, "aria-label": label }: {
  value: T | null; onChange: (value: T) => void; options: { value: T; label: string; description?: string }[];
  placeholder: string; searchPlaceholder: string; emptyText: string; size?: Size; disabled?: boolean; allowCustom?: boolean; customLabel?: (text: string) => string; "aria-label": string;
}) {
  const [query, setQuery] = useState(""), sizeClasses = useSize(size), shape = useShape();
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter(option => [option.label, option.description ?? "", option.value].some(text => text.toLowerCase().includes(needle))) : options;
  }, [options, query]);
  const custom = allowCustom && query.trim() && !options.some(option => option.value === query)
    ? { value: query as T, label: customLabel(query), description: undefined } : null;
  const choices = custom ? [custom, ...shown] : shown;
  const current = options.find(option => option.value === value) ?? (allowCustom && value !== null ? { value, label: value } : undefined);
  const checked = choices.findIndex(option => option.value === value);
  const trigger = <button type="button" aria-label={label} disabled={disabled} data-placeholder={current ? undefined : ""}
    className={cn(triggerVariants({}), sizeClasses.control, sizeClasses.text, sizeClasses.px, sizeClasses.gap, size === "compact" ? "min-w-32" : "min-w-40", shape.input)}>
    <span className={cn("min-w-0 flex-1 truncate text-left", current ? "text-foreground" : "text-muted-foreground")}>{current?.label ?? placeholder}</span>
    <svg width={sizeClasses.icon} height={sizeClasses.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
  </button>;
  return <DropdownMenu size={size} disabled={disabled}><DropdownTrigger render={trigger} />
    <DropdownContent checkedIndex={checked >= 0 ? checked : undefined}>
      <DropdownSearch value={query} onValueChange={setQuery} placeholder={searchPlaceholder} aria-label={searchPlaceholder}
        onKeyDown={event => { if (isComposing(event)) { event.stopPropagation(); if (event.key === "Enter" || event.key === "Escape" || event.key.startsWith("Arrow")) event.preventDefault(); } }} />
      {choices.length ? choices.map((option, index) => <MenuItem key={option.value} index={index} label={option.description ? option.label + " · " + option.description : option.label}
        checked={option.value === value} onSelect={() => onChange(option.value)} />) : <DropdownEmpty>{emptyText}</DropdownEmpty>}
    </DropdownContent>
  </DropdownMenu>;
}

export function Menu({ trigger, items }: { trigger: ReactElement; items: { label: string; onSelect: () => void; tone?: "danger"; disabled?: boolean }[] }) {
  const nativeTrigger = trigger.type === Button ? buttonElement(trigger.props as ButtonProps)
    : trigger.type === IconButton ? iconButtonElement(trigger.props as IconButtonProps) : trigger;
  return <DropdownMenu><DropdownTrigger render={nativeTrigger} />
    <DropdownContent>{items.map((item, index) => <MenuItem key={item.label} index={index} label={item.label}
      onSelect={item.onSelect} disabled={item.disabled} className={item.tone === "danger" ? "text-destructive **:text-destructive" : undefined} />)}</DropdownContent>
  </DropdownMenu>;
}

// labelHidden: the label names the switch for assistive technology only (a list row already says what it switches).
export function Switch({ checked, onChange, label, disabled, labelHidden = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean; labelHidden?: boolean }) {
  return <FluidSwitch checked={checked} onToggle={() => onChange(!checked)} label={label} disabled={disabled} className={labelHidden ? "ff-switch-quiet" : undefined} />;
}

type Choice = { value: string; label: string };
export function CheckboxGroup({ value, onChange, items, disabled = false }: { value: string[]; onChange: (value: string[]) => void; items: Choice[]; disabled?: boolean }) {
  return <FluidCheckboxGroup checkedIndices={new Set(items.flatMap((item, index) => value.includes(item.value) ? [index] : []))}>
    {items.map((item, index) => <CheckboxItem key={item.value} index={index} label={item.label} checked={value.includes(item.value)}
      aria-disabled={disabled} tabIndex={disabled ? -1 : 0} className={disabled ? "pointer-events-none" : undefined}
      onToggle={() => { if (!disabled) onChange(value.includes(item.value) ? value.filter(entry => entry !== item.value) : [...value, item.value]); }} />)}
  </FluidCheckboxGroup>;
}
export function RadioGroup({ value, onChange, items, disabled = false }: { value: string; onChange: (value: string) => void; items: Choice[]; disabled?: boolean }) {
  return <FluidRadioGroup value={value} onValueChange={next => { if (!disabled) onChange(next); }} aria-disabled={disabled}>
    {items.map((item, index) => <RadioItem key={item.value} value={item.value} index={index} label={item.label}
      aria-disabled={disabled} {...(disabled ? { tabIndex: -1 } : {})} className={disabled ? "pointer-events-none" : undefined} />)}
  </FluidRadioGroup>;
}

export function Slider({ value, onChange, min, max, step, label, format }: { value: number; onChange: (value: number) => void; min: number; max: number; step: number; label: string; format?: (value: number) => string }) {
  return <FluidSlider value={value} onChange={next => { if (typeof next === "number") onChange(next); }} min={min} max={max} step={step} label={label} formatValue={format} />;
}

export interface TextFieldProps {
  value: string; onChange: (value: string) => void; label: string; placeholder?: string; type?: "text" | "password" | "number"; error?: string;
  required?: boolean; maxLength?: number; min?: number; max?: number; step?: number | "any"; disabled?: boolean; readOnly?: boolean;
  inputMode?: "text" | "decimal" | "numeric"; name?: string;
  pattern?: string; autoComplete?: "off" | "new-password"; spellCheck?: boolean; onCommit?: (value: string) => void;
}
// Radix handles Escape at document capture and can remove a field before React's group capture
// runs. Register the restoration dispatcher with the module, before a sheet can mount. Entries
// are weak, explicitly removed on field unmount, and this never prevents the layer's dismissal.
const escapeFields = new WeakMap<HTMLInputElement, () => void>();
if (typeof document !== "undefined") document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !isComposing(event) && event.target instanceof HTMLInputElement) escapeFields.get(event.target)?.();
}, true);
// The ref reaches the native input, so a page can focus the first field in error.
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ value, onChange, label, placeholder, type = "text", error, required, maxLength, min, max, step, disabled, readOnly, inputMode, name, pattern, autoComplete, spellCheck, onCommit }, ref) {
  const wrapper = useRef<HTMLDivElement>(null);
  const focusValue = useRef(value), committedValue = useRef(value);
  useImperativeHandle(ref, () => wrapper.current?.querySelector("input") as HTMLInputElement, []);
  useLayoutEffect(() => {
    const input = wrapper.current?.querySelector("input"); if (!input || disabled || readOnly) return;
    escapeFields.set(input, () => { committedValue.current = focusValue.current; onChange(focusValue.current); });
    return () => { escapeFields.delete(input); };
  }, [onChange, disabled, readOnly]);
  // Capture on the group rather than replacing InputField's own focus styling handlers.
  return <InputGroup onFocusCapture={() => { focusValue.current = committedValue.current = value; }}
    onBlurCapture={event => { const next = (event.target as HTMLInputElement).value; if (!disabled && !readOnly && !isComposing() && next !== committedValue.current) { committedValue.current = next; onCommit?.(next); } }}
    onKeyDownCapture={event => {
      if (disabled || readOnly || isComposing(event)) return;
      if (event.key === "Enter" && onCommit) { event.preventDefault(); committedValue.current = value; onCommit(value); }
    }}><InputField ref={wrapper} index={0} value={value} onChange={onChange} label={label} placeholder={placeholder} type={type} error={error}
    required={required} maxLength={maxLength} min={min} max={max} step={step} disabled={disabled} readOnly={readOnly} inputMode={inputMode} name={name}
    pattern={pattern} autoComplete={autoComplete} spellCheck={spellCheck} /></InputGroup>;
});

// variant "filled": a full-width grey search bar, as the old sessions toolbar (owner 2026-10-29).
export function SearchField({ value, onChange, placeholder, maxLength, variant = "plain", "aria-label": label }: { value: string; onChange: (value: string) => void; placeholder: string; maxLength?: number; variant?: "plain" | "filled"; "aria-label": string }) {
  const id = useId();
  const clear = () => { onChange(""); document.getElementById(id)?.focus(); };
  return <div className={variant === "filled" ? "ff-search-filled flex w-full items-center gap-1 rounded-xl bg-surface-2 pr-1" : "flex items-center gap-2"}>
    <div className={variant === "filled" ? "min-w-0 flex-1" : "contents"}><InputGroup><InputField id={id} index={0} value={value} onChange={onChange} label={label} labelHidden placeholder={placeholder} icon={IconSearch} maxLength={maxLength}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key !== "Escape" || !value) return; event.preventDefault(); if (!isComposing(event)) clear(); }} /></InputGroup></div>
    {value ? <IconButton icon={IconX} label="清空搜索" size={variant === "filled" ? "compact" : "default"} onClick={clear} /> : null}
  </div>;
}

// A native form, so required/maxLength/min/max keep the platform's own validity messages.
// onInvalid lets a form add its own hint next to the platform message; the browser blocks an
// invalid submit before it fires, so the hint follows the fields' invalid events.
export function Form({ onSubmit, onInvalid, children, "aria-label": label }: { onSubmit: () => void; onInvalid?: () => void; children: ReactNode; "aria-label"?: string }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isComposing()) return;
    if (!event.currentTarget.checkValidity()) { event.currentTarget.reportValidity(); return; }
    onSubmit();
  };
  return <form aria-label={label} className="flex flex-col gap-3" onSubmit={submit} onInvalidCapture={() => onInvalid?.()}
    onKeyDown={event => { if (event.key === "Enter" && isComposing(event)) event.preventDefault(); }}>{children}</form>;
}

// A secondary button that picks one local file. The input is cleared after every pick so the
// same file can be chosen again.
export function FileButton({ label, accept, onFile, disabled, busy }: { label: string; accept: string; onFile: (file: File) => void; disabled?: boolean; busy?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <Button variant="secondary" disabled={disabled} loading={busy} onClick={() => input.current?.click()}>{label}</Button>
    <input ref={input} type="file" accept={accept} hidden tabIndex={-1} aria-hidden="true"
      onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) onFile(file); }} />
  </>;
}

export function CarouselDots({ count, value, onValueChange, autoplay, progress, getLabel }: Pick<ComponentProps<typeof FluidCarouselDots>, "count" | "value" | "onValueChange" | "autoplay" | "progress" | "getLabel">) {
  return <FluidCarouselDots count={count} value={value} onValueChange={onValueChange} autoplay={autoplay} progress={progress} getLabel={getLabel} />;
}
