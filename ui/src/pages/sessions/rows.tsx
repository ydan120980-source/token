import { IconDots, IconPinFilled } from "@tabler/icons-react";
import { AgentMark, CheckMark, IconButton, Marquee, Menu, StackBar, StatusDot, Value, ValueButton, type FoldColumn, type FoldGroup } from "@ui/kit";
import { type SessionEstimate, type SessionGroup, type SessionRow, type SessionsViewModel } from "@ui/data";
import { DetailAction, FolderAction, ProjectCopy, ResumeAction } from "./actions";

// Name, last activity, Token, estimate, actions (owner 2026-11-02: the row keeps what tells sessions apart; path,
// model, ID and duration moved to the detail card). Heads and sessions share the columns, so every group lines up.
export const columns: FoldColumn[] = [
  { key: "what", span: 6 }, { key: "when", span: 2, align: "end" },
  { key: "tokens", span: 1, align: "end" }, { key: "cost", span: 1, align: "end" }, { key: "actions", span: 2, align: "end" },
];
const PREVIEW = 5;

export function Estimate({ value }: { value: SessionEstimate }) {
  return <Value value={value.lower === null ? null : value.text} unknown="未定价" />;
}

/** Picking sessions to act on together (UI-SESSIONS-MULTI-20261102.md). */
export interface SessionPicking { has(key: string): boolean; toggle(session: SessionRow): void }
function sessionCells({ session, group, model, readable, onOpen, onDetail, picking }: { session: SessionRow; group: SessionGroup; model: SessionsViewModel; readable: boolean; onOpen: () => void; onDetail: () => void; picking: SessionPicking | null }) {
  const view = model.sessionView(session, group);
  // A session without a name reads as its time under its project, and as its project in a list by time.
  const label = session.name || (group.kind === "project" ? view.time : session.project || view.time);
  const action = readable ? "阅读对话" : "查看明细";
  return {
    what: <span className="flex min-w-0 items-center gap-2" data-session-time>
      {picking ? <CheckMark checked={picking.has(session.key)} onChange={() => picking.toggle(session)} label={"选择 " + label} /> : null}
      <span className="flex shrink-0 items-center gap-1" title={view.meta.name} data-session-agent>
        <AgentMark agent={session.agent} variant="icon" size={16} />
        {view.isRecent ? <StatusDot tone="active" label="活跃：最近 1 小时内有活动" /> : null}
      </span>
      {session.pinned ? <IconPinFilled size={12} className="shrink-0 text-muted-foreground" aria-label="已置顶" data-session-pinned /> : null}
      <span className="min-w-0 flex-1 text-caption font-medium text-foreground" data-session-name>
        <Marquee text={label} title={label === view.time ? view.timeTip : label + "\n" + view.timeTip}>
          <ValueButton onClick={onOpen} aria-label={(label === view.time ? view.timeLabel : label + "，" + view.timeLabel) + "，" + (picking ? "选择" : action)}>{label}</ValueButton>
        </Marquee>
      </span>
    </span>,
    when: label === view.time ? null : <span className="truncate text-caption text-muted-foreground" title={view.timeTip} data-session-ended>{view.ended}</span>,
    tokens: <span className="flex w-full min-w-0 flex-col items-end gap-1" title={view.tokenTitle} data-session-tokens>
      <span className="text-caption text-foreground"><Value value={view.tokens} /></span>
      <span className="w-full" title={view.proportionTitle}>
        <StackBar width="full" height={4} segments={[{ key: session.key, value: view.fraction, tone: "accent", label: view.proportionTitle }]} aria-label={view.proportionTitle} />
      </span>
    </span>,
    cost: <span className="text-caption text-foreground" title={view.costTip} data-session-cost><Estimate value={view.estimate} /></span>,
    actions: picking ? null : <span className="flex items-center gap-1" data-session-actions>
      <DetailAction onClick={onDetail} />
      <ResumeAction session={session} title={session.resumable ? "复制 PowerShell 恢复命令，由你自己在终端里执行" : view.reason} />
    </span>,
  };
}

/** One project as a fold group (a plain builder, not a hook): its head row, its first sessions, and the rest behind "展开其余". */
export function projectGroup({ group, model, open, onOpenChange, drawer, onDrawer, readable, onOpen, onDetail, picking, onRenameGroup, onDissolveGroup }: {
  group: SessionGroup; model: SessionsViewModel; open: boolean; onOpenChange: (open: boolean) => void;
  drawer: boolean; onDrawer: (open: boolean) => void; readable: (session: SessionRow) => boolean;
  onOpen: (session: SessionRow) => void; onDetail: (session: SessionRow) => void; picking: SessionPicking | null;
  onRenameGroup: (name: string) => void; onDissolveGroup: (name: string) => void;
}): FoldGroup {
  const view = model.groupView(group), shown = drawer ? group.sessions : group.sessions.slice(0, PREVIEW), rest = group.sessions.length - PREVIEW;
  return {
    key: group.id, label: group.name, open, onOpenChange,
    attributes: { "data-session-group": group.id, "data-group-kind": group.kind, ...(group.unknown ? { "data-unknown": "" } : {}) },
    head: {
      what: <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 text-body font-semibold text-foreground" data-session-project><Marquee text={group.name} title={view.pathText} /></span>
        <span className="shrink-0 text-caption text-muted-foreground">{group.sessions.length + " 会话"}</span>
        {view.activeCount ? <span className="flex shrink-0 items-center gap-1 text-caption text-success" data-session-active-count>
          <StatusDot tone="active" label={view.activeCount + " 个活跃会话"} />{view.activeCount + " 个活跃"}
        </span> : null}
      </span>,
      tokens: <span className="text-caption text-foreground"><Value value={view.tokens} /></span>,
      cost: <span className="text-caption font-semibold text-foreground"><Estimate value={view.estimate} /></span>,
      actions: group.kind === "project" ? <span className="flex items-center gap-1" data-session-group-actions>
        <FolderAction enabled={Boolean(group.cwd)} sessionKey={view.firstKey} kind="project" title={group.cwd ? "在文件资源管理器中打开项目目录：" + group.cwd : "工作目录未记录或来源未确认"} />
        <ProjectCopy cwd={group.cwd} />
      </span> : group.kind === "collection" && !group.unknown ? <span data-session-collection-actions><Menu trigger={<IconButton icon={IconDots} size="compact" label={group.name + " 分组操作"} onClick={() => {}} />} items={[
        { label: "重命名分组", onSelect: () => onRenameGroup(group.name) },
        { label: "解散分组", onSelect: () => onDissolveGroup(group.name) },
      ]} /></span> : null,
    },
    // AnimatePresence keeps the previous body during exit. Closed groups do
    // not need row view models or React elements until the person opens them.
    rows: open ? shown.map(session => ({
      key: session.key, onOpen: () => picking ? picking.toggle(session) : onOpen(session), attributes: { "data-session": session.key },
      cells: sessionCells({ session, group, model, readable: readable(session), onOpen: () => picking ? picking.toggle(session) : onOpen(session), onDetail: () => onDetail(session), picking }),
    })) : [],
    footer: rest > 0 ? <span className="text-caption text-muted-foreground" data-session-more data-open={drawer}>
      <ValueButton onClick={() => onDrawer(!drawer)}>{drawer ? "收起" : "展开其余 " + rest + " 个会话"}</ValueButton>
    </span> : undefined,
  };
}
