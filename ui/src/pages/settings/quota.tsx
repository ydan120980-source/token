import { Card, Segmented, Select, SettingRow, Switch } from "@ui/kit";
import type { QuotaPrefs } from "@ui/data/quota-host";
import { useWidgetQuota } from "@ui/data/widget-data";
import { useDesktopShell } from "@ui/data/shell-host";
import { Block, Section } from "./search";

// How quota reads everywhere, in the one place a person looks for it; 概览 keeps the same two controls beside the cards.
export function QuotaSettings() {
  const { host } = useWidgetQuota(), snapshot = host.get(), experimental = snapshot.providerState?.experimentalEnabled === true, shell = useDesktopShell(), watch = shell.state?.watch;
  return <Section name="quota" title="额度">
    <Block keywords="剩余 已用 每分钟 关闭">
      <Card title="额度显示">
        <div>
          <SettingRow title="百分比表示" control={<Segmented value={snapshot.prefs.measure} onChange={value => host.setPreference("measure", value)} aria-label="额度百分比表示" items={[{ value: "remaining" as QuotaPrefs["measure"], label: "剩余" }, { value: "used" as QuotaPrefs["measure"], label: "已用" }]} />} />
          <SettingRow title="自动刷新" control={<Select value={snapshot.state.autoRefresh === "1min" ? "1min" : "off"} onChange={host.setAuto} disabled={!host.available || snapshot.example} aria-label="额度自动刷新频率" options={[{ value: "off", label: "关闭" }, { value: "1min", label: "每分钟" }]} />} />
        </div>
      </Card>
    </Block>
    {watch ? <Block keywords="提醒 通知 快用完 重置 恢复">
      <Card title="额度提醒">
        <div data-quota-watch={watch.enabled ? "on" : "off"}>
          <SettingRow title="额度快用完时提醒" control={<Switch labelHidden label="额度快用完时提醒" checked={watch.enabled} onChange={value => shell.set({ watch: { enabled: value } })} />} />
          <SettingRow title="剩余低于" control={<Select value={String(watch.low)} onChange={value => shell.set({ watch: { low: Number(value) } })} disabled={!watch.enabled} aria-label="剩余低于多少时提醒" options={(shell.state?.lows ?? []).map(low => ({ value: String(low), label: low + "%" }))} />} />
          <SettingRow title="快重置和恢复时也提醒" control={<Switch labelHidden label="快重置和恢复时也提醒" checked={watch.reset} disabled={!watch.enabled} onChange={value => shell.set({ watch: { reset: value } })} />} />
        </div>
      </Card>
    </Block> : null}
    <Block keywords="试验 非官方 Cookie 网站 内部接口 复用登录">
      <Card title="读取路线">
        <div data-quota-experimental={experimental ? "on" : "off"}>
          <SettingRow title="试验性额度路线" description="网站 Cookie、内部接口和复用客户端登录。服务商没有公开承诺，可能失效，也可能受服务商条款限制。" control={<Switch labelHidden label="试验性额度路线" checked={experimental} disabled={!host.available} onChange={value => { void window.quotaBridge?.providerExperimental?.(value); }} />} />
        </div>
      </Card>
    </Block>
  </Section>;
}
