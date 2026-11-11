import { useSyncExternalStore } from "react";

// Application updates (docs/m2/AUTO-UPDATE-20261108.md). A packaged build finds a new version on GitHub Releases, downloads it in the
// background and offers a restart; nothing restarts on its own. Without the bridge (the browser preview) it reads as not configured.
export interface UpdateState {
  supported: boolean;
  status: "unconfigured" | "idle" | "checking" | "latest" | "available" | "downloading" | "downloaded" | "error";
  current: string | null;
  latest: { version: string; url: string | null; publishedAt: string | null } | null;
  progress: { percent: number; transferred: number; total: number; bytesPerSecond: number } | null;
  downloadedAt: string | null; checkedAt: string | null; error: string | null;
}
type Reply = { ok: true; state: UpdateState } | { ok: false; error: string; state: UpdateState };
export interface UpdateBridge {
  get(): Promise<Reply>; check(): Promise<Reply>; cancel(): Promise<Reply>; install(): Promise<Reply>;
  open(url: string): Promise<boolean>; onUpdate(callback: () => void): () => void;
}
declare global { interface Window { updateBridge?: UpdateBridge } }

export const UPDATE_MESSAGES: Record<string, string> = {
  UPDATE_NOT_CONFIGURED: "这个版本不含自动更新，请用发布页的安装包覆盖安装。",
  UPDATE_NOT_PUBLISHED: "还没有已发布的版本。",
  UPDATE_OFFLINE: "连不上更新服务器，请检查网络后重试。",
  UPDATE_REQUEST_FAILED: "检查更新没有完成，请重试。",
  UPDATE_VERIFY_FAILED: "下载的文件校验不通过，已删除，请重试。",
  UPDATE_BUSY: "上一步还在进行，请稍等。",
  UPDATE_NOT_READY: "还没有可安装的更新。",
  UPDATE_INSTALL_FAILED: "无法启动安装程序，请用发布页的安装包覆盖安装。",
};
export const updateMessage = (code: string | null) => code ? UPDATE_MESSAGES[code] ?? UPDATE_MESSAGES.UPDATE_REQUEST_FAILED : "";

const EMPTY: UpdateState = {
  supported: false, status: "unconfigured", current: null, latest: null, progress: null, downloadedAt: null, checkedAt: null, error: null,
};
let state = EMPTY, actionError = "", loaded = false;
const listeners = new Set<() => void>();
const publish = () => { for (const listener of listeners) listener(); };
async function apply(reply: Promise<Reply> | undefined) {
  if (!reply) return;
  try { const value = await reply; state = value.state; actionError = value.ok ? "" : updateMessage(value.error); }
  catch { actionError = updateMessage("UPDATE_REQUEST_FAILED"); }
  publish();
}
const load = () => apply(window.updateBridge?.get());
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!loaded) { loaded = true; void load(); window.updateBridge?.onUpdate(() => { void load(); }); }
  return () => { listeners.delete(listener); };
}
let version = 0, cached = { state, actionError };
const read = () => { if (cached.state !== state || cached.actionError !== actionError) { cached = { state, actionError }; version++; } return cached; };

export const updateActions = {
  check: () => apply(window.updateBridge?.check()),
  cancel: () => apply(window.updateBridge?.cancel()),
  install: () => apply(window.updateBridge?.install()),
  open: (url: string) => { void window.updateBridge?.open(url).catch(() => {}); },
};
export function useUpdate() { return useSyncExternalStore(subscribe, read); }
