import { useState } from "react";
import { Button, Card, Select, SettingRow, Switch } from "@ui/kit";
import { getSettingsHost, useCollection } from "@ui/data";
import { useUsage } from "@ui/data/widget-data";
import { ago } from "../../app-shell";
import { Block, Section } from "./search";

const intervals = [{ value: "0", label: "只手动" }, { value: "5000", label: "每 5 秒" }, { value: "15000", label: "每 15 秒" }, { value: "30000", label: "每 30 秒" }, { value: "60000", label: "每 1 分钟" }, { value: "300000", label: "每 5 分钟" }];

export function CollectionSection() {
  const collection = useCollection(), readOnly = collection.mode === "snapshot";
  // The switch says the current state (the legacy button named the action and a badge the state).
  // The legacy select showed the new choice at once and fell back when saving failed.
  const [pending, setPending] = useState<string | null>(null);
  const interval = pending ?? String(collection.intervalMs), usage = useUsage(), facts = usage?.collection, [busy, setBusy] = useState(false);
  const collectNow = async () => { setBusy(true); try { await window.usageBridge?.refresh(); } catch { /* The page's collection status reports it. */ } finally { setBusy(false); } };
  const changeInterval = (value: string) => { setPending(value); void getSettingsHost().collection.setInterval(Number(value)).finally(() => setPending(null)); };
  return <Section name="collection" title="采集">
    <Block keywords={intervals.map(item => item.label).join(" ")}>
      <Card title="采集状态">
        <div>
          <SettingRow title="自动采集"
            control={<Switch checked={collection.enabled} disabled={readOnly} label={readOnly ? "只读快照" : collection.enabled ? "运行中" : "已暂停"} onChange={value => void getSettingsHost().collection.setEnabled(value)} />} />
          <SettingRow title="多久采集一次"
            control={<Select value={interval} onChange={changeInterval} options={intervals} disabled={collection.mode !== "desktop"} aria-label="用量自动刷新" />} />
          <SettingRow title={facts?.checkedAt ? "上次采集 " + ago(facts.checkedAt) : "还没有采集过"}
            control={<Button variant="secondary" size="compact" disabled={busy || readOnly || Boolean(facts?.collecting)} onClick={() => void collectNow()}>{facts?.collecting || busy ? "正在采集" : "立即采集"}</Button>} />
        </div>
      </Card>
    </Block>
  </Section>;
}
