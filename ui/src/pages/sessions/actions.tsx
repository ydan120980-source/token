import { useRef, useState } from "react";
import { IconCopy, IconFolder, IconInfoCircle, IconMessages } from "@tabler/icons-react";
import { Button, CopyButton, IconButton } from "@ui/kit";
import { useSessionsHost, type SessionRow } from "@ui/data";

// Opens a session's or project's working directory in Explorer through the host (one request at a time).
export function FolderAction({ sessionKey, enabled, kind = "row", title }: { sessionKey?: string; enabled: boolean; kind?: "row" | "project" | "inspector"; title: string }) {
  const host = useSessionsHost(), [busy, setBusy] = useState(false), pending = useRef(false);
  const open = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { await host.openFolder(sessionKey ?? "", kind); } finally { pending.current = false; setBusy(false); }
  };
  return <span title={title} data-session-folder={kind}>
    <IconButton icon={IconFolder} size="compact" label={kind === "project" ? "打开项目工作目录" : "打开工作目录"} disabled={!enabled || busy} onClick={() => { void open(); }} />
  </span>;
}

// Opens the session's conversation in the reading view (Agents with a reader only).
export function ReadAction({ session }: { session: SessionRow }) {
  const host = useSessionsHost();
  return host.readable(session.agent) ? <span data-session-read><Button variant="secondary" size="compact" leadingIcon={IconMessages} onClick={() => host.read(session)}>{"阅读对话"}</Button></span> : null;
}
// A row itself opens the conversation; its figures, name and identifiers are one step aside.
export function DetailAction({ onClick }: { onClick: () => void }) {
  return <span title="会话详情" data-session-detail-open><IconButton icon={IconInfoCircle} size="compact" label="会话详情" onClick={onClick} /></span>;
}
// Copies the official resume command; the person runs it in PowerShell themselves.
export function ResumeAction({ session, button = false, title }: { session: SessionRow; button?: boolean; title: string }) {
  const host = useSessionsHost(), [busy, setBusy] = useState(false), pending = useRef(false);
  const copy = async () => {
    if (pending.current) return false;
    pending.current = true; setBusy(true);
    try { return await host.copyResume(session.key); } finally { pending.current = false; setBusy(false); }
  };
  return <span title={title} data-session-resume>
    {button ?
      <Button variant="secondary" size="compact" loading={busy} disabled={!session.resumable} leadingIcon={IconCopy} onClick={() => { void copy(); }}>{"复制恢复命令"}</Button> :
      session.resumable ?
        <CopyButton size="compact" label="复制恢复命令" onCopy={copy} /> :
        <IconButton icon={IconCopy} size="compact" label="复制恢复命令" disabled onClick={() => {}} />}
  </span>;
}

// Copies a project's full path.
export function ProjectCopy({ cwd }: { cwd: string | null }) {
  const host = useSessionsHost();
  return <span title={cwd ? "复制项目完整路径" : "工作目录未记录或来源未确认"} data-session-project-copy>
    {cwd ?
      <CopyButton size="compact" label="复制项目完整路径" onCopy={() => host.copyText(cwd, "project")} /> :
      <IconButton icon={IconCopy} size="compact" label="复制项目完整路径" disabled onClick={() => {}} />}
  </span>;
}
