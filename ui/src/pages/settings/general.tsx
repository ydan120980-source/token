import { useState } from "react";
import { Avatar, Button, Card, Select, SettingRow, Switch } from "@ui/kit";
import { useDesktopShell } from "@ui/data/shell-host";
import { openGuide } from "../quota/guide";
import { getGlobals, getSettingsHost, setMotionPreference, showView, useMotionPreference, useProfile, useTheme, type MotionPreference, type ThemePreference } from "@ui/data";
import { Block, Section } from "./search";
import { WidgetLayouts } from "./widgets";

const themes: { value: ThemePreference; label: string }[] = [{ value: "system", label: "跟随系统" }, { value: "light", label: "浅色" }, { value: "dark", label: "深色" }];
const motions: { value: MotionPreference; label: string }[] = [{ value: "system", label: "跟随系统" }, { value: "reduced", label: "减少动态" }, { value: "off", label: "关闭" }];

const STARTS = [["quota", "概览"], ["usage", "用量"], ["cost", "费用"], ["sessions", "会话"], ["sources", "Agent 管理"], ["settings", "设置"]].map(([value, label]) => ({ value, label }));
const START_KEY = "agentusage.startView";
const savedStart = () => { try { return localStorage.getItem(START_KEY) || "quota"; } catch { return "quota"; } };
const KEYS = [["Ctrl K", "快速切换会话、项目和页面"], ["Ctrl B", "显示或隐藏左侧菜单"], ["Ctrl Shift B", "显示或隐藏右侧概要"], ["Ctrl F", "在阅读的会话里查找"], ["Ctrl Enter", "在快速切换里并排打开"], ["Esc", "关闭弹窗，或清空搜索"]];

export function General({ onEditProfile }: { onEditProfile: () => void }) {
  const profile = useProfile(), theme = useTheme(), motion = useMotionPreference();
  const name = profile.name || "本机用户", [start, setStart] = useState(savedStart), shell = useDesktopShell();
  const changeStart = (value: string) => { setStart(value); try { localStorage.setItem(START_KEY, value); } catch { /* Stays the default next time. */ } };
  return <Section name="general" title="常规">
    <Block keywords={themes.map(item => item.label).join(" ") + " " + motions.map(item => item.label).join(" ")}>
      <Card title="外观与显示">
        <div>
          <SettingRow title="色彩外观" control={<Select value={theme} onChange={value => getSettingsHost().theme.set(value)} options={themes} aria-label="外观" />} />
          <SettingRow title="界面动效" control={<Select value={motion} onChange={setMotionPreference} options={motions} aria-label="界面动效" />} />
          <SettingRow title="启动时打开" control={<Select value={start} onChange={changeStart} options={STARTS} aria-label="启动时打开" />} />
        </div>
      </Card>
    </Block>
    {shell.state ? <Block keywords="托盘 开机 自启 后台 关闭窗口 引导 连接">
      <Card title="后台运行">
        <div data-settings-desktop>
          {shell.state.tray ? <SettingRow title="关闭窗口后留在托盘" control={<Switch labelHidden label="关闭窗口后留在托盘" checked={shell.state.closeToTray} onChange={value => shell.set({ closeToTray: value })} />} /> : null}
          <SettingRow title="开机时启动，留在托盘" description={shell.state.login.available ? undefined : "安装版才能设置"} control={<Switch labelHidden label="开机时启动，留在托盘" checked={shell.state.login.open} disabled={!shell.state.login.available} onChange={value => shell.set({ login: value })} />} />
          <SettingRow title="连接你的 Agent" control={<span data-settings-guide><Button variant="secondary" size="compact" onClick={() => { showView("quota"); openGuide(); }}>{"打开引导"}</Button></span>} />
        </div>
      </Card>
    </Block> : null}
    <WidgetLayouts />
    <Block keywords="快捷键 键盘">
      <Card title="快捷键">
        <div data-settings-keys>{KEYS.map(([keys, what]) => <SettingRow key={keys} title={what} control={<span className="text-caption tabular-nums text-muted-foreground">{keys}</span>} />)}</div>
      </Card>
    </Block>
    <Block>
      <Card title="个人资料">
        <div className="flex items-center justify-between gap-3" data-profile-summary>
          <div className="flex min-w-0 items-center gap-3">
            <Avatar initials={getGlobals().profileModel.initials(name)} label={name} tone={profile.tone} photo={profile.photo} size={40} />
            <div className="flex min-w-0 flex-col gap-1"><span className="text-subtitle font-semibold text-foreground">{name}</span><span className="text-caption text-muted-foreground">{profile.bio}</span></div>
          </div>
          <Button variant="secondary" onClick={onEditProfile}>编辑资料</Button>
        </div>
      </Card>
    </Block>
  </Section>;
}
