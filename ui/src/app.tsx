import { memo, useState } from "react";
import { useShell, viewNames } from "./app-store";
import { Navigation, QuotaFilters } from "./app-navigation";
import { ago, useCollection, useShellBehavior } from "./app-shell";
import { SettingsPage } from "./pages/settings";
import { QuotaPage, QuotaAfter } from "./pages/quota";
import { TitleReadout } from "./pages/widgets";
import { PageSummary } from "./pages/summary";
import { CostPage } from "./pages/cost";
import { UsagePage } from "./pages/usage";
import { SessionsPage } from "./pages/sessions";
import { SourcesPage } from "./pages/sources";
import { QuickSwitch } from "./pages/sessions/quick-switch";
import { useGithub } from "./data/github-host";

const Quota = memo(QuotaPage), AfterQuota = memo(QuotaAfter), Usage = memo(UsagePage), Cost = memo(CostPage);
const Sessions = memo(SessionsPage), Sources = memo(SourcesPage), Settings = memo(SettingsPage);
const Readout = memo(TitleReadout), Summary = memo(PageSummary);
function Image({ name }: { name: string }) { return <img src={"assets/ui/" + name + ".svg"} alt="" />; }
function Brand() {
  return <a href="#" className="brand" aria-label="Agent Usage">
    <svg className="brand-mark" viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="8" className="brand-tile" />
      <g className="brand-dots">
        <circle cx="8" cy="20" r="1.9" /><circle cx="14" cy="20" r="1.9" /><circle cx="20" cy="20" r="1.9" />
        <circle cx="14" cy="14" r="1.9" /><circle cx="20" cy="14" r="1.9" /><circle cx="20" cy="8" r="1.9" />
        <circle cx="8" cy="14" r="1.9" className="brand-dim" /><circle cx="8" cy="8" r="1.9" className="brand-dim" /><circle cx="14" cy="8" r="1.9" className="brand-dim" />
      </g>
    </svg><span className="brand-name">Agent Usage</span>
  </a>;
}
/** One production root. Existing data hosts publish facts; React owns the shell
 * and directly composes the pages. data-ui-root below is a CSS scope only. */
export function App() {
  const state = useShell(), shell = useShellBehavior(state.view, state.ready, state.dark), collection = useCollection(state.ready);
  const [scrolled, setScrolled] = useState(false), github = useGithub().state.connection, bound = github.status === "connected" || github.status === "expired";
  const profile = bound ? { ...state.profile, name: github.name || github.login || state.profile.name, photo: github.avatar ?? state.profile.photo } : state.profile;
  const status = !collection ? null : !collection.enabled ? ["paused", "采集已暂停", "历史统计保留；在Agent 管理或设置中恢复采集"] : collection.collecting ?
    ["busy", "正在采集…", "正在读取本机的用量记录"] : collection.checkedAt ?
      ["ok", "已采集 · " + ago(collection.checkedAt), "最近一次采集完成于 " + new Date(collection.checkedAt).toLocaleString("zh-CN", { hour12: false })] :
      ["idle", "尚未采集", "还没有完成过一次采集"];
  const editProfile = () => window.settingsUi?.openProfile();
  const theme = <button id="theme" className={shell.integrated ? "icon-button window-icon" : "icon-button"} aria-label={state.dark ? "切换浅色外观" : "切换深色外观"}
    onClick={() => window.settingsHost?.theme.set(state.dark ? "light" : "dark")}><Image name={state.dark ? "moon" : "sun"} /></button>;
  const badge = <span id="dataBadge" className="preview-badge" hidden={state.notice.hidden} role={state.notice.role ?? "status"} title={state.notice.title}
    data-message={state.notice.attention ? state.notice.text : undefined}>{state.notice.attention ? <><span>{state.notice.text}</span><button type="button" className="text-button" data-attention-open="sources" onClick={event => { event.stopPropagation(); window.sourcesUi?.openAttention?.("sources"); }}>查看原因</button></> : state.notice.text}</span>;
  return <>
    <a className="skip" href="#main">跳至内容</a>
    {state.ready ? <QuickSwitch /> : null}
    <header id="appTitlebar" className="app-titlebar" hidden={!shell.integrated} aria-label="应用工具栏"><div className="app-titlebar-inner">
      <button id="windowSidebar" className="window-icon" aria-label="显示或隐藏侧栏" aria-expanded={!shell.collapsed}
        title={shell.collapsed ? "展开侧栏 (Ctrl+B)" : "收起侧栏 (Ctrl+B)"} onClick={shell.toggleSidebar}><Image name="layout-sidebar" /></button>
      <button id="windowBack" className="window-icon" aria-label="后退" title="后退 (Alt+←)" disabled={shell.historyIndex === 0} onClick={() => shell.travel(-1)}><Image name="arrow-left" /></button>
      <button id="windowForward" className="window-icon" aria-label="前进" title="前进 (Alt+→)" disabled={shell.historyIndex === shell.historyLength - 1} onClick={() => shell.travel(1)}><Image name="arrow-right" /></button>
      <span className="window-title shell-crumb"><span className="shell-crumb-app">Agent Usage</span><span aria-hidden="true" className="shell-crumb-sep">/</span><span id="windowPage">{viewNames[state.view]}</span></span>
      <span id="titlebarPageStart" className="titlebar-page" data-ui-root="" />
      <div className="titlebar-tools">
        <span className="titlebar-readout" data-ui-root="" data-page-root="title-readout">{state.ready ? <Readout /> : null}</span>
        {shell.integrated ? badge : null}
        <button id="collectionStatus" className="titlebar-status" hidden={!status || !state.notice.hidden} data-tone={status?.[0]}
          title={status ? status[2] + " · 打开Agent 管理" : undefined} aria-label={status ? "采集状态：" + status[1] : undefined} onClick={() => shell.navigate("sources")}><i aria-hidden="true" /><span>{status?.[1]}</span></button>
        {shell.integrated ? theme : null}
        <button id="windowQuick" className="window-icon" aria-label="快速切换" title="快速切换 (Ctrl+K)" onClick={() => window.dispatchEvent(new Event("quick-switch"))}><Image name="search" /></button>
        <button id="windowMenu" className="window-icon" aria-label="更多操作" title="更多操作" onClick={() => { void window.windowBridge?.menu("app").catch(() => {}); }}><Image name="dots" /></button>
        <span id="titlebarPageEnd" className="titlebar-page" data-ui-root="" />
        <button id="windowSummary" className="window-icon window-summary" aria-label={shell.attention.count ? "概要 · " + shell.attention.label : "概要"} aria-pressed={shell.dock || shell.float} aria-keyshortcuts="Control+Shift+B"
          aria-controls="summaryPanel" title={(shell.dock || shell.float ? "隐藏概要" : "显示概要") + " (Ctrl+Shift+B)"} hidden={!shell.integrated || !shell.summaryOffered} onClick={shell.toggleSummary}>
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.5" stroke="currentColor" strokeWidth="1.5" /><path className="window-summary-pane" d="M9.5 3.5h2.25A1.75 1.75 0 0 1 13.5 5.25v5.5a1.75 1.75 0 0 1-1.75 1.75H9.5z" fill="currentColor" /></svg>
          <span className="window-summary-label">概要</span><span className="window-badge" hidden={!shell.attention.count} /></button>
      </div>
    </div></header>
    <header className="topbar" inert={shell.integrated && shell.collapsed && shell.narrow}><div className="topbar-inner">
      <Brand /><p className="sidebar-caption" hidden>本地 AI 工作记录</p>
      <Navigation view={state.view} collapsed={shell.integrated && shell.collapsed} badges={state.badges} onNavigate={shell.navigate} />
      <div className="top-actions">
        <div className="sidebar-profile">
          <button id="profileAvatar" className="profile-avatar sidebar-avatar" aria-label="更换头像" data-tone={profile.tone} onClick={editProfile}>
            {profile.photo ? <img src={profile.photo} alt="个人头像" /> : <span>{window.profileModel?.initials(profile.name) ?? "本"}</span>}
          </button>
          <div className="sidebar-identity"><strong id="profileName">{profile.name}</strong><p id="profileBio" hidden>{profile.bio}</p><p className="profile-meta" hidden>历史覆盖 <span id="historyStart">{state.historyStart}</span><span>·</span><span id="updated">{state.updated}</span></p></div>
          <button id="editProfile" className="icon-button profile-edit" aria-label="编辑资料" title="编辑资料" onClick={editProfile}><Image name="pencil" /></button>
        </div>
        {!shell.integrated ? <>{badge}{theme}</> : null}
        <span className="local-badge" hidden><Image name="shield-lock" />仅本地</span>
      </div>
    </div></header>
    <main id="main" tabIndex={-1} data-current-view={state.view}>
      <section id="quota" hidden={state.view !== "quota"} data-motion-surface="page">
        <div data-ui-root="" data-page-root="quota">{state.ready ? <Quota /> : null}</div>
        <div id="quotaCardsBar" className="quota-cards-bar" hidden>{state.ready ? <QuotaFilters /> : null}</div>
        <div id="quotaCards" className="quota-grid" aria-label="已连接的额度" />
        <p id="quotaHiddenLine" className="quota-hidden-line" hidden />
        <div data-ui-root="" data-page-root="quota-after">{state.ready ? <AfterQuota /> : null}</div>
      </section>
      <section id="usage" hidden={state.view !== "usage"} data-motion-surface="page"><div data-ui-root="" data-page-root="usage">{state.ready ? <Usage /> : null}</div></section>
      <section id="cost" hidden={state.view !== "cost"} data-motion-surface="page"><div data-ui-root="" data-page-root="cost">{state.ready ? <Cost /> : null}</div></section>
      <section id="sessions" hidden={state.view !== "sessions"} data-motion-surface="page"><div data-ui-root="" data-page-root="sessions">{state.ready ? <Sessions /> : null}</div></section>
      <section id="sources" hidden={state.view !== "sources"} data-motion-surface="page"><div data-ui-root="" data-page-root="sources">{state.ready ? <Sources /> : null}</div></section>
      <section id="settings" hidden={state.view !== "settings"} data-motion-surface="page"><div data-ui-root="" data-page-root="settings">{state.ready ? <Settings /> : null}</div></section>
      <footer hidden><span>Agent Usage · 本地用量与账号额度</span><span id="collectionState">{state.collectionState}</span></footer>
    </main>
    <div id="panelFrame" className="panel-frame" aria-hidden="true" />
    <aside id="summaryPanel" className={"summary-panel" + (scrolled ? " is-scrolled" : "")} aria-label="概要" data-summary-views="quota usage cost sessions sources" hidden={!shell.dock && !shell.float} onScroll={event => setScrolled(event.currentTarget.scrollTop > 0)}><div data-ui-root="" data-page-root="widgets">{state.ready ? <Summary view={state.view} /> : null}</div></aside>
    <div id="toast" role="status" hidden={!state.toast}>{state.toast}</div>
  </>;
}
