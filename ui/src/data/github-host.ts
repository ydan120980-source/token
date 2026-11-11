import { useSyncExternalStore } from "react";

// GitHub identity and sync (docs/m2/GITHUB-AND-UPDATE-20261104.md). The window holds no token: it sees the service's
// state and asks it to act. Without the bridge (the browser preview) everything reads as not configured.
// Application updates are a separate host: they need no GitHub account (./update-host).
export interface GithubState {
  schemaVersion: "GithubStateV1"; configured: boolean;
  connection: { status: "none" | "pending" | "connected" | "expired"; login: string | null; name: string | null; avatar: string | null; connectedAt: string | null; device: { userCode: string; verificationUri: string; expiresAt: string } | null; error: string | null };
  sync: { enabled: boolean; repository: string | null; status: "idle" | "syncing" | "ok" | "error"; lastSuccess: string | null; days: number | null; error: string | null; device: string | null };
  repositories: string[] | null;
}
type Reply = { ok: true; state: GithubState } | { ok: false; error: string };
export interface GithubBridge {
  get(): Promise<Reply>; connect(): Promise<Reply>; cancel(): Promise<Reply>; disconnect(): Promise<Reply>; repositories(): Promise<Reply>;
  setSync(request: { enabled: boolean; repository: string | null }): Promise<Reply>; syncNow(): Promise<Reply>;
  copyCode(): Promise<boolean>; open(url: string): Promise<boolean>; onUpdate(callback: () => void): () => void;
}
declare global { interface Window { githubBridge?: GithubBridge } }

export const GITHUB_MESSAGES: Record<string, string> = {
  GITHUB_NOT_CONFIGURED: "这个版本还没有配置 GitHub 连接。",
  GITHUB_OFFLINE: "连不上 GitHub，请检查网络后重试。",
  GITHUB_RATE_LIMITED: "GitHub 暂时限制了请求，请稍后再试。",
  GITHUB_AUTH_REQUIRED: "授权已失效，请重新连接。",
  GITHUB_FORBIDDEN: "没有这个仓库的写入权限，请在 GitHub 上给应用授权这个仓库。",
  GITHUB_REQUEST_FAILED: "GitHub 请求没有完成，请重试。",
  GITHUB_DENIED: "你在 GitHub 上取消了授权。",
  GITHUB_CODE_EXPIRED: "验证码已过期，请重新连接。",
  GITHUB_SECURE_STORAGE_REQUIRED: "这台电脑无法加密保存登录，所以没有连接。",
  GITHUB_REPOSITORY_INVALID: "请选择一个私有仓库。",
  GITHUB_NOT_CONNECTED: "请先连接 GitHub。",
  GITHUB_BUSY: "上一步还在进行，请稍等。",
};
export const githubMessage = (code: string | null) => code ? GITHUB_MESSAGES[code] ?? GITHUB_MESSAGES.GITHUB_REQUEST_FAILED : "";

const OFFLINE: GithubState = {
  schemaVersion: "GithubStateV1", configured: false,
  connection: { status: "none", login: null, name: null, avatar: null, connectedAt: null, device: null, error: null },
  sync: { enabled: false, repository: null, status: "idle", lastSuccess: null, days: null, error: null, device: null },
  repositories: null,
};
let state = OFFLINE, actionError = "", loaded = false;
const listeners = new Set<() => void>();
const publish = () => { for (const listener of listeners) listener(); };
async function apply(reply: Promise<Reply> | undefined) {
  if (!reply) return;
  try { const value = await reply; if (value.ok) { state = value.state; actionError = ""; } else actionError = githubMessage(value.error); }
  catch { actionError = githubMessage("GITHUB_REQUEST_FAILED"); }
  publish();
}
const load = () => apply(window.githubBridge?.get());
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!loaded) { loaded = true; void load(); window.githubBridge?.onUpdate(() => { void load(); }); }
  return () => { listeners.delete(listener); };
}
let version = 0, cached = { state, actionError };
const read = () => { if (cached.state !== state || cached.actionError !== actionError) { cached = { state, actionError }; version++; } return cached; };

export const githubActions = {
  connect: () => apply(window.githubBridge?.connect()),
  cancel: () => apply(window.githubBridge?.cancel()),
  disconnect: () => apply(window.githubBridge?.disconnect()),
  repositories: () => apply(window.githubBridge?.repositories()),
  setSync: (request: { enabled: boolean; repository: string | null }) => apply(window.githubBridge?.setSync(request)),
  syncNow: () => apply(window.githubBridge?.syncNow()),
  copyCode: async () => { try { return await window.githubBridge?.copyCode() ?? false; } catch { return false; } },
  open: (url: string) => { void window.githubBridge?.open(url).catch(() => {}); },
};
export function useGithub() { return useSyncExternalStore(subscribe, read); }
