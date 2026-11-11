import type { KeyboardEvent } from "react";
import { motion } from "motion/react";
import { spring } from "@ui/design/motion";
import { chartTone, type ChartTone } from "./charts/tones";
import { isComposing } from "./ime";
import { useKitMotion } from "./motion-mode";

interface SwatchChoice { value: string; label: string; tone: ChartTone }
export function SwatchGroup({ value, onChange, items, "aria-label": label }: {
  value: string; onChange: (value: string) => void; items: SwatchChoice[]; "aria-label": string;
}) {
  const { mode } = useKitMotion();
  const entry = items.some(item => item.value === value) ? value : items[0]?.value;
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isComposing(event) || !items.length) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]")];
    const index = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    const next = { ArrowLeft: (index + items.length - 1) % items.length, ArrowUp: (index + items.length - 1) % items.length,
      ArrowRight: (index + 1) % items.length, ArrowDown: (index + 1) % items.length, Home: 0, End: items.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault(); event.stopPropagation(); buttons[next]?.focus(); onChange(items[next].value);
  };
  return <div role="radiogroup" aria-label={label} className="inline-flex items-center" data-swatch-group onKeyDown={keyDown}>
    {items.map(item => {
      const checked = value === item.value, colour = chartTone(item.tone);
      return <button key={item.value} type="button" role="radio" aria-label={item.label} title={item.label}
        aria-checked={checked} tabIndex={item.value === entry ? 0 : -1} data-swatch-key={item.value}
        className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => onChange(item.value)}>
        <svg width={28} height={28} viewBox="0 0 28 28" aria-hidden="true">
          <circle data-swatch-dot cx={14} cy={14} r={8} className={colour.fill} />
          {mode === "off" ?
            <circle data-swatch-ring cx={14} cy={14} r={12.5} fill="none" strokeWidth={2}
              className={colour.stroke} opacity={checked ? 1 : 0} /> :
            <motion.circle data-swatch-ring cx={14} cy={14} r={12.5} fill="none" strokeWidth={2}
              className={colour.stroke} initial={false} animate={{ opacity: checked ? 1 : 0 }} transition={spring.fast} />}
        </svg>
      </button>;
    })}
  </div>;
}
