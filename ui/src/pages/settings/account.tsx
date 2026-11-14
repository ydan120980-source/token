import { useEffect } from "react";
import { Avatar, Button, Card, CopyButton, Disclosure, Select, SettingRow, Switch } from "@ui/kit";
import { githubActions, githubMessage, useGithub } from "@ui/data/github-host";
import { Block, Section } from "./search";

const when = (value: string | null) => { if (!value) return ""; const at = new Date(value); return (at.getMonth() + 1) + "/" + at.getDate() + " " + String(at.getHours()).padStart(2, "0") + ":" + String(at.getMinutes()).padStart(2, "0"); };

/** The person's GitHub: who is connected, and what goes to their own private repository. */
export function AccountSection() {
  const { state, actionError } = useGithub(), { connection, sync, repositories, repositoriesLoading, configured } = state;
  const connected = connection.status === "connected", repository = sync.repository;
  const syncing = sync.status === "syncing";
  useEffect(() => { if (connected) void githubActions.repositories(); }, [connected, connection.login, connection.connectedAt]);
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
          <SettingRow title="同步到我的私有仓库" control={<Switch labelHidden label="同步到我的私有仓库" checked={sync.enabled} disabled={!connected || syncing || repositoriesLoading || (!selected && !sync.enabled)} onChange={enabled => { void githubActions.setSync({ enabled, repository }); }} />} />
          <SettingRow title="仓库"
            description={connected && repositories !== null && !selected && repository ? "上次选择的仓库已不可用，请重新选择。" : connected && repositories?.length === 0 ? "在 GitHub 为应用授予个人私有仓库的访问权限后，刷新列表。" : undefined}
            control={<div className="flex flex-wrap items-center gap-2">
              <div className="w-64"><Select value={selected ? repository! : "none"} disabled={!connected || syncing || repositoriesLoading || !options.length} onChange={value => { if (value !== "none") void githubActions.setSync({ enabled: false, repository: value }); }} aria-label="同步到哪个私有仓库" options={[{ value: "none", label: repositoryHint }, ...options]} /></div>
              {connected ? <Button variant="secondary" size="compact" disabled={syncing || repositoriesLoading} onClick={() => { void githubActions.repositories(); }}>刷新仓库</Button> : null}
            </div>} />
          {connected ? <SettingRow title="仓库授权" control={<div className="flex flex-wrap gap-2">
            {state.installUrl ? <Button variant="secondary" size="compact" onClick={() => githubActions.open(state.installUrl!)}>授权仓库</Button> : null}
            <Button variant="ghost" size="compact" onClick={() => githubActions.open("https://github.com/settings/installations")}>管理 GitHub 授权</Button>
          </div>} /> : null}
          <SettingRow title="立即同步"
            description={sync.error ? githubMessage(sync.error) : sync.status === "syncing" ? "正在同步…" : sync.lastSuccess ? "最近同步 " + when(sync.lastSuccess) + (sync.days !== null ? " · " + sync.days + " 天的数据" : "") : undefined}
            control={<Button variant="secondary" size="compact" disabled={!sync.enabled || !connected || !selected || syncing || repositoriesLoading} onClick={() => { void githubActions.syncNow(); }}>同步</Button>} />
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
