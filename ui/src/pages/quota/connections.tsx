import { useEffect, useRef, useState } from "react";
import { Button, CheckboxGroup, Form, Select, Sheet, TextField } from "@ui/kit";
import type { QuotaCapability, QuotaHost, QuotaRoute } from "@ui/data/quota-host";

/** Codex: the official CLI signs in through the system browser; this app only starts and cancels it. */
export function CodexConnection({ host, open, onClose }: { host: QuotaHost; open: boolean; onClose: () => void }) {
  const [alias, setAlias] = useState(""), [status, setStatus] = useState(""), input = useRef<HTMLInputElement>(null);
  const snapshot = host.get(), busy = Boolean(snapshot.state.pendingLogin) || snapshot.requesting;
  useEffect(() => {
    if (!open) return;
    setAlias(""); setStatus("");
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    if (snapshot.state.pendingLogin) setStatus("请在官方浏览器页面完成授权，完成后会读取额度。");
    else if (status && !busy) setStatus(snapshot.error || snapshot.state.accounts.some(account => account.status === "login-failed") ? snapshot.error || "登录未完成，可关闭后重试。" : "连接流程结束，请查看 Codex 卡片的状态。");
  }, [snapshot.state.pendingLogin, busy, snapshot.error, snapshot.state.accounts, status]);
  const close = () => { void host.closeLogin().then(onClose); };
  return <Sheet open={open} onOpenChange={value => { if (!value) close(); }} title="连接 Codex 账号" size="sm" scrollable
    footer={<><Button variant="ghost" onClick={close}>{snapshot.state.pendingLogin ? "取消本次连接" : "关闭"}</Button><Button variant="primary" loading={busy} disabled={busy} onClick={() => { void host.login(alias); }}>打开官方登录</Button></>}>
    <p className="text-body text-foreground">授权在系统浏览器的官方页面完成。添加其他账号时，请在该页面选择相应账号。</p>
    <div data-quota-alias-field><TextField ref={input} value={alias} onChange={setAlias} maxLength={48} label="账号备注" placeholder="例如：个人 / 工作" /></div>
    <p className="text-caption text-muted-foreground">官方 CLI 管理授权，使用系统凭据存储；本应用不收集密码，不导入现有 Codex 认证文件，也不切换其他应用的登录。</p>
    <p role="status" className="text-caption text-muted-foreground" data-quota-login-status>{status || snapshot.error}</p>
  </Sheet>;
}

// The ways one adapter can connect, in the order offered (provider-quota-ui.js before M6).
function methodsOf(route: QuotaRoute | undefined) {
  if (!route) return [];
  const fresh = ["claude-oauth", "gemini-code-assist", "antigravity-cli", "zcode-device", "opencode-zen"].includes(route.id);
  return [
    ...(route.clientLogin ? [{ value: "client", label: route.clientMode === "key" ? "复用本机已配置的 API key" : ["zcode-device", "opencode-zen"].includes(route.id) ? "在 Chrome 授权并自动连接" : "复用已有登录／官方登录（推荐）" }] : []),
    ...(route.websiteLogin ? [{ value: "website", label: "在 Chrome 登录后手动连接" }] : []),
    ...(fresh ? [{ value: "client-new", label: "换账号／重新授权" }] : []),
    ...(route.kind === "local-report" || route.clientOnly ? [] : [{ value: "manual", label: "手动提供凭据" }]),
  ];
}
const CONSENT = "我选择连接并读取此账号额度；客户端复用仅读取已核对的本人凭据，网站登录仅打开 Chrome，不自动读取浏览器会话。验证后以 Windows 系统加密保存，可随时移除；非公开接口可能变更。";

/**
 * Any other Agent: pick the adapter and the way to connect, then hand the one call to the host.
 * Secrets live in this form's state only until submit; switching route or method, closing and
 * submitting all clear them. Nothing here persists a credential.
 */
export function ProviderConnection({ host, selection, onClose }: { host: QuotaHost; selection: { capability: QuotaCapability; id: string | null } | null; onClose: () => void }) {
  const row = host.get().providerState?.accounts.find(account => account.id === selection?.id);
  const [adapter, setAdapter] = useState(""), [method, setMethod] = useState(""), [alias, setAlias] = useState("");
  const [credential, setCredential] = useState(""), [project, setProject] = useState(""), [userAgent, setUserAgent] = useState(""), [organization, setOrganization] = useState(""), [workspace, setWorkspace] = useState("");
  const [remember, setRemember] = useState(true), [consent, setConsent] = useState(false), [error, setError] = useState("");
  const form = useRef<HTMLDivElement>(null), secret = useRef<HTMLInputElement>(null), aliasRef = useRef<HTMLInputElement>(null), generation = useRef(0);
  const current = selection?.capability, route = current?.adapters.find(item => item.id === adapter);
  // Experimental routes are offered once the person has turned them on, or for the connection they already have.
  const allowed = host.get().providerState?.experimentalEnabled === true, offered = current?.adapters.filter(item => allowed || !item.experimental || item.id === row?.adapter) ?? [];
  const cookie = route?.kind === "cookie", google = route?.kind === "google-internal", website = Boolean(route?.websiteLogin && method === "website");
  const client = Boolean(route?.clientLogin && ["client", "client-new"].includes(method)), hidden = route?.kind === "passive" || website || client;
  const pending = host.get().connecting, workbuddy = route?.id === "workbuddy-web" && !website && !client;
  const clear = () => { setCredential(""); setProject(""); setUserAgent(""); setOrganization(""); setWorkspace(""); setConsent(false); };

  useEffect(() => {
    generation.current++; clear(); setError(""); setRemember(true);
    if (selection) {
      const first = selection.capability.adapters.find(item => item.id === row?.adapter) || selection.capability.adapters.find(item => allowed || !item.experimental);
      setAdapter(first?.id ?? ""); setMethod(methodsOf(first)[0]?.value || ""); setAlias(row?.alias || selection.capability.name);
    }
    return () => { generation.current++; };
    // A new selection starts a new form; the row is read once for it.
  }, [selection]);
  useEffect(() => {
    if (!selection) return;
    const frame = requestAnimationFrame(() => (hidden ? aliasRef.current : secret.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [selection, hidden]);

  const close = () => { generation.current++; clear(); host.cancelProvider(); onClose(); };
  const label = route?.id === "deepseek-web" ? "DeepSeek 平台 userToken（不是完整请求或密码）" : cookie ? current?.provider === "mimo" ? "本站 Cookie：api-platform_serviceToken 与 userId（可带 ph / slh）" : "所选网站的会话 Cookie" : google ? "Google OAuth access token（不是 Gemini API key）" : "API key 或已授权 access token";
  const help = website ? "只打开你日常使用的 Chrome 标签页；登录后回到此处手动提供凭据。打开网站不会自动连接或读取额度。"
    : !hidden && route?.websiteLogin ? route.id === "deepseek-web" ? "在 Chrome 登录 API 平台后，从开发者工具「应用 → 本地存储」复制 userToken 的值；不要提供密码或整份存储。"
      : "在 Chrome 登录所选官网，用开发者工具「网络」查看本站额度请求，仅复制请求头 Cookie 的值。" + (workbuddy ? " 同时复制该请求的 User-Agent；两项必须来自同一登录会话。" : "") + " 多组织／工作区账号需同时填写官网额度请求对应的 ID。不要提供密码、完整请求或其他网站数据。" : "";
  const submitLabel = website ? "在 Chrome 打开登录页" : client && route?.clientMode === "key" ? "读取已配置的 API key" : client && ["zcode-device", "opencode-zen"].includes(route?.id || "") ? "在 Chrome 登录并连接" : client ? "连接／登录并读取" : route?.kind === "passive" ? "创建被动观测连接" : "连接并读取一次";

  const submit = async () => {
    if (!route || pending || !selection) return;
    if ((cookie || website || client) && !consent) {
      const required = document.createElement("input"); required.type = "checkbox"; required.required = true;
      setError(required.validationMessage);
      form.current?.querySelector<HTMLElement>('[data-provider-consent] [role="checkbox"]')?.focus();
      return;
    }
    const input = { route, method, id: selection.id, alias, credential, project, userAgent, organization, workspace, remember, consent };
    setCredential(""); setProject(""); setUserAgent(""); setOrganization(""); setWorkspace("");
    const epoch = generation.current;
    setError(website ? "正在 Chrome 打开官网登录页。登录后请回到这里手动提供凭据。" : client ? "正在连接所选账号并验证额度。复用客户端登录时无需复制凭据；若打开官方 CLI 交互窗口，请完成登录后输入 /exit。" : "");
    const result = await host.connectProvider(input);
    if (epoch !== generation.current) return;
    if (result.ok) { clear(); onClose(); return; }
    if (result.manual) { setMethod("manual"); setConsent(false); requestAnimationFrame(() => secret.current?.focus()); }
    setError(result.error);
  };

  return <Sheet open={Boolean(selection)} onOpenChange={value => { if (!value) close(); }} title={(current?.name ? current.name + " · " : "") + "连接账号额度"} size="lg" scrollable
    footer={<><Button variant="ghost" onClick={() => { if (route) void host.guide(route.id).then(setError); }}>授权与官方说明</Button><Button variant="primary" loading={pending} disabled={pending} onClick={() => form.current?.querySelector("form")?.requestSubmit()}>{submitLabel}</Button></>}>
    {!offered.length && current ? <div className="flex flex-col items-start gap-3" data-provider-experimental-off>
      <p className="text-body text-foreground">{current.name + " 目前只有试验性路线。服务商没有公开承诺，可能失效，也可能受服务商条款限制。"}</p>
      <Button variant="secondary" onClick={() => { close(); window.settingsUi?.openSection("quota"); }}>去设置里打开</Button>
    </div> : null}
    <div ref={form} data-provider-connect hidden={!offered.length}>
      <Form onSubmit={() => { void submit(); }} aria-label="连接账号额度">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2" data-provider-adapter data-selection={adapter}>
            <span className="text-caption text-muted-foreground">读取服务</span>
            <Select value={adapter} onChange={value => { clear(); setAdapter(value); setMethod(methodsOf(current?.adapters.find(item => item.id === value))[0]?.value || ""); }} options={offered.map(item => ({ value: item.id, label: item.name }))} disabled={Boolean(selection?.id) || pending} aria-label="读取服务" />
            <p className="text-caption text-muted-foreground" data-provider-route-note>{[cookie ? null : current?.login?.note, route?.note].filter(Boolean).join(" ")}</p>
          </div>
          {route?.websiteLogin || route?.clientLogin ? <div className="flex flex-col gap-2" data-provider-method data-selection={method}>
            <span className="text-caption text-muted-foreground">连接方式</span>
            <Select value={method} onChange={value => { clear(); setMethod(value); }} options={methodsOf(route)} disabled={pending} aria-label="连接方式" />
          </div> : null}
          <div data-provider-field="alias"><TextField ref={aliasRef} value={alias} onChange={setAlias} maxLength={48} required label="连接备注" autoComplete="off" disabled={Boolean(selection?.id)} /></div>
          {hidden ? null : <div data-provider-field="credential"><TextField ref={secret} value={credential} onChange={setCredential} type="password" label={label} required maxLength={16384} autoComplete="off" spellCheck={false} /></div>}
          {google && !client ? <div data-provider-field="project"><TextField value={project} onChange={setProject} label="Google Cloud 项目 ID" required pattern="[a-z][a-z0-9-]{4,98}[a-z0-9]" maxLength={100} autoComplete="off" /></div> : null}
          {workbuddy ? <div data-provider-field="user-agent"><TextField value={userAgent} onChange={setUserAgent} required label="此网站请求的 User-Agent" maxLength={512} autoComplete="off" spellCheck={false} /></div> : null}
          {route?.id === "claude-web" && !website ? <div data-provider-field="organization"><TextField value={organization} onChange={setOrganization} label="组织 ID（多组织账号需填写）" maxLength={36} pattern="[a-fA-F0-9-]{36}" autoComplete="off" /></div> : null}
          {route?.id === "opencode-web" && !website ? <div data-provider-field="workspace"><TextField value={workspace} onChange={setWorkspace} label="工作区 ID（多工作区账号需填写）" maxLength={104} pattern="(wrk_|org_)[A-Za-z0-9_-]{1,100}" autoComplete="off" /></div> : null}
          {help ? <p className="text-caption text-muted-foreground">{help}</p> : null}
          {hidden ? null : <div data-provider-remember><CheckboxGroup value={remember ? ["remember"] : []} onChange={value => setRemember(value.includes("remember"))} items={[{ value: "remember", label: "以 Windows 系统加密保持连接" }]} /></div>}
          {cookie || client || website ? <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3" role="group" aria-label={CONSENT} data-provider-consent data-required="true">
            <CheckboxGroup value={consent ? ["consent"] : []} onChange={value => setConsent(value.includes("consent"))} items={[{ value: "consent", label: "我选择连接并读取此账号额度" }]} />
            <p className="text-caption text-muted-foreground">客户端复用仅读取已核对的本人凭据，网站登录仅打开 Chrome，不自动读取浏览器会话。验证后以 Windows 系统加密保存，可随时移除；非公开接口可能变更。</p>
          </div> : null}
          <p className="text-caption text-muted-foreground">额度请求只发送到所选服务的固定接口；网站登录在日常 Chrome 标签页中完成，随后手动提供本站凭据，仅在你选择复用登录时读取已核对的客户端凭据，不调用模型。备注不是服务端已验证的账号身份。</p>
          <p role="alert" className="text-caption text-muted-foreground" data-provider-connect-error>{error}</p>
        </div>
      </Form>
    </div>
  </Sheet>;
}
