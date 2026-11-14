import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, Button, Card, CopyButton, Disclosure, Select, SettingRow, Switch } from "@ui/kit";
import { useViewActive } from "@ui/data";
import { githubActions, githubMessage, useGithub } from "@ui/data/github-host";
import { Block, Section } from "./search";

const when = (value: string | null) => { if (!value) return ""; const at = new Date(value); return (at.getMonth() + 1) + "/" + at.getDate() + " " + String(at.getHours()).padStart(2, "0") + ":" + String(at.getMinutes()).padStart(2, "0"); };

/** The person's GitHub: who is connected, and what goes to their own private repository. */
export function AccountSection({ active }: { active: boolean }) {
  const { state, actionError } = useGithub(), { connection, sync, repositories, repositoriesLoading, configured } = state;
  const visible = useViewActive("settings") && active;
  const [setup, setSetup] = useState<"authorize" | "choose" | null>(null);
  const [checkingSetup, setCheckingSetup] = useState(false);
  const [browserFailed, setBrowserFailed] = useState(false);
  const checking = useRef(false);
  const connected = connection.status === "connected", repository = sync.repository;
  const syncing = sync.status === "syncing";
  useEffect(() => {
    if (visible && connected) void githubActions.repositories();
  }, [visible, connected, connection.login, connection.connectedAt]);
  useEffect(() => {
    if (!connected) { setSetup(null); setBrowserFailed(false); }
  }, [connected, connection.login]);

  const configure = useCallback(async (openBrowser: boolean, target?: string) => {
    if (checking.current) return;
    checking.current = true;
    setCheckingSetup(true);
    setBrowserFailed(false);
    try {
      if (target) {
        if (await githubActions.setSync({ enabled: true, repository: target })) setSetup(null);
        return;
      }
      const refreshed = await githubActions.repositories();
      if (!refreshed?.repositories || refreshed.connection.status !== "connected") return;
      if (refreshed.repositories.length === 0) {
        setSetup("authorize");
        if (openBrowser && !await githubActions.open(refreshed.installUrl ?? "https://github.com/settings/installations")) setBrowserFailed(true);
        return;
      }
      const only = refreshed.repositories.length === 1 ? refreshed.repositories[0] : null;
      if (only) {
        if (await githubActions.setSync({ enabled: true, repository: only })) setSetup(null);
      } else setSetup("choose");
    } finally {
      checking.current = false;
      setCheckingSetup(false);
    }
  }, []);
  useEffect(() => {
    if (!visible || !connected || setup !== "authorize") return;
    const returned = () => { void configure(false); };
    window.addEventListener("focus", returned);
    return () => window.removeEventListener("focus", returned);
  }, [visible, connected, setup, configure]);

  const busy = syncing || repositoriesLoading || checkingSetup;
  const options = (repositories ?? []).map(value => ({ value, label: value }));
  const selected = options.some(option => option.value === repository);
  const repositoryHint = !connected ? "连接后选择" : repositoriesLoading ? "正在读取仓库…" : repositories === null ? "仓库列表暂不可用" : options.length ? "选择私有仓库" : "没有可用的私有仓库";
  const shown = connection.name || connection.login || "";
  return <Section name="account" title="账号与同步">
    <Block keywords="GitHub 登录 绑定 账号 连接 断开">
      <Card title="GitHub 账号">
        <div data-github-connection={connection.status} data-configured={configured || undefined}>
          {connection.status === "none" ? <SettingRow title="未连接"
            description={!configured ? githubMessage("GITHUB_NOT_CONFIGURED") : connection.error ? githubMessage(connection.error) : undefined}
            control={<Button variant="primary" size="compact" disabled={!configured} onClick={() => { void githubActions.connect(); }}>连接 GitHub</Button>} /> : null}
          {connection.status === "pending" && connection.device ? <div className="flex flex-col gap-3 py-2">
            <p className="text-body text-foreground">在 GitHub 页面输入这个代码</p>
            <div className="flex flex-wrap items-center gap-3">
              <code className="rounded-xl bg-muted px-4 py-2 font-mono text-title font-semibold tracking-widest text-foreground" data-github-code>{connection.device.userCode}</code>
              <CopyButton label="复制代码" onCopy={githubActions.copyCode} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="compact" onClick={() => githubActions.open(connection.device!.verificationUri)}>打开 GitHub</Button>
              <Button variant="ghost" size="compact" onClick={() => { void githubActions.cancel(); }}>取消</Button>
              <span className="text-caption text-muted-foreground">{"正在等待授权 · " + when(connection.device.expiresAt) + " 前有效"}</span>
            </div>
          </div> : null}
          {connected || connection.status === "expired" ? <SettingRow
            title={<span className="flex items-center gap-3">
              <Avatar initials={shown.slice(0, 1).toUpperCase() || "G"} label={shown} tone="indigo" size={40} photo={connection.avatar} />
              <span className="flex min-w-0 flex-col"><span className="truncate text-body font-semibold text-foreground">{shown}</span>{connection.name && connection.login ? <span className="truncate text-caption text-muted-foreground">{"@" + connection.login}</span> : null}</span>
            </span>}
            description={connection.status === "expired" ? githubMessage("GITHUB_AUTH_REQUIRED") : undefined}
            control={<span className="flex items-center gap-2">
              {connection.status === "expired" ? <Button variant="primary" size="compact" onClick={() => { void githubActions.connect(); }}>重新连接</Button> : null}
              <Button variant="secondary" size="compact" disabled={syncing || repositoriesLoading} onClick={() => { void githubActions.disconnect(); }}>断开</Button>
            </span>} /> : null}
        </div>
        {actionError ? <p role="alert" className="text-caption text-warn-text">{actionError}</p> : null}
      </Card>
    </Block>
    <Block keywords="同步 数据 仓库 私有 备份">
      <Card title="同步数据">
        <div data-github-sync={sync.status}>
          {connected && (!sync.enabled || !selected || setup) ? <SettingRow title={setup === "authorize" ? "等待仓库授权" : setup === "choose" ? "选择同步仓库" : "配置私有仓库同步"}
            description={browserFailed ? "未能打开 GitHub，请重试。" : setup === "authorize"
              ? state.installUrl ? "在 GitHub 选择个人账号和要授权的私有仓库，确认后返回这里。" : "请在 GitHub 管理现有授权。首次授权需要该版本提供安装链接。"
              : setup === "choose" ? "有多个可用仓库，请在下方选择一个。" : "选定仓库后即可手动同步每日用量。"}
            control={<div className="flex flex-wrap items-center gap-2">
              {setup === "authorize" ? <>
                <Button variant="primary" size="compact" disabled={busy} onClick={() => { void configure(false); }}>检查授权</Button>
                <Button variant="secondary" size="compact" disabled={busy} onClick={() => { void configure(true); }}>打开 GitHub</Button>
              </> : setup !== "choose" ? <Button variant="primary" size="compact" disabled={busy} onClick={() => { void configure(true); }}>{checkingSetup ? "正在配置…" : "一键配置同步"}</Button> : null}
              {setup ? <Button variant="ghost" size="compact" disabled={busy} onClick={() => { setSetup(null); setBrowserFailed(false); }}>取消配置</Button> : null}
            </div>} /> : null}
          <SettingRow title="同步到我的私有仓库" control={<Switch labelHidden label="同步到我的私有仓库" checked={sync.enabled} disabled={!connected || busy || (!selected && !sync.enabled)} onChange={enabled => { void githubActions.setSync({ enabled, repository }); }} />} />
          <SettingRow title="仓库"
            description={connected && repositories !== null && !selected && repository ? "上次选择的仓库已不可用，请重新选择。" : connected && repositories?.length === 0 ? "在 GitHub 为应用授予个人私有仓库的访问权限后，刷新列表。" : undefined}
            control={<div className="flex flex-wrap items-center gap-2">
              <div className="w-64"><Select value={selected && setup !== "choose" ? repository! : "none"} disabled={!connected || busy || !options.length} onChange={value => {
                if (value === "none") return;
                if (setup === "choose") void configure(false, value);
                else void githubActions.setSync({ enabled: false, repository: value });
              }} aria-label="同步到哪个私有仓库" options={[{ value: "none", label: repositoryHint }, ...options]} /></div>
              {connected && !setup ? <Button variant="secondary" size="compact" disabled={busy} onClick={() => { void githubActions.repositories(); }}>刷新仓库</Button> : null}
            </div>} />
          {connected && !setup ? <SettingRow title="仓库授权" control={<div className="flex flex-wrap gap-2">
            {state.installUrl ? <Button variant="secondary" size="compact" onClick={() => githubActions.open(state.installUrl!)}>授权仓库</Button> : null}
            <Button variant="ghost" size="compact" onClick={() => githubActions.open("https://github.com/settings/installations")}>管理 GitHub 授权</Button>
          </div>} /> : null}
          <SettingRow title="立即同步"
            description={sync.error ? githubMessage(sync.error) : sync.status === "syncing" ? "正在同步…" : sync.lastSuccess ? "最近同步 " + when(sync.lastSuccess) + (sync.days !== null ? " · " + sync.days + " 天的数据" : "") : undefined}
            control={<Button variant="secondary" size="compact" disabled={!sync.enabled || !connected || !selected || busy || setup !== null} onClick={() => { void githubActions.syncNow(); }}>同步</Button>} />
        </div>
        <Disclosure flush summary="会同步什么">
          <div className="flex flex-col gap-1 text-caption text-muted-foreground" data-github-sync-scope>
            <p>会同步：每天各 Agent、各模型的 Token 和估算费用。</p>
            <p>不会同步：对话内容、路径、会话 ID、项目名和你自己添加的来源。</p>
            <p>只在你点“同步”时发送。仓库里的内容没有额外加密，GitHub 和仓库的协作者能看到。</p>
          </div>
        </Disclosure>
      </Card>
    </Block>
  </Section>;
}
