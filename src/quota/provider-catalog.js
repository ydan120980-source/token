'use strict';
const routes = Object.freeze({
  'opencode-zen': { provider: 'opencode', kind: 'client-token', clientLogin: true, clientOnly: true, name: 'OpenCode Zen 按量余额 · Chrome 登录（推荐）', url: 'https://opencode.ai/console/api/billing/status', provenance: 'undocumented-api', note: '在日常 Chrome 完成官方 Console 设备授权，自动接收本次登录并读取所选工作区的 Zen 按量余额；无需复制 Cookie 或 Go key。与 Go 订阅窗口分开，不修改 OpenCode 配置或调用模型。' },
  'zcode-device': { provider: 'zcode', kind: 'client-token', clientLogin: true, clientOnly: true, name: 'ZCode 在 Chrome 登录（推荐）', url: 'https://zcode.z.ai/api/v1/zcode-plan/billing/balance', provenance: 'undocumented-api', note: '点击后在日常 Chrome 完成 ZCode 设备授权，应用自动接收结果并读取本账号额度，无需复制 Cookie 或安装 ZCode。服务成功返回空额度包时保持连接并显示额度未知，不当作零。与 Z.ai／BigModel API key 额度分开，非公开协议可能变更。' },
  'workbuddy-desktop': { provider: 'workbuddy', kind: 'client-token', clientLogin: true, clientOnly: true, name: 'WorkBuddy 当前客户端登录（推荐）', method: 'POST', url: 'https://www.codebuddy.cn/v2/billing/meter/get-user-resource', provenance: 'undocumented-api', note: '一键复用本机 WorkBuddy 国内版当前登录并读取积分包，无需复制 Cookie；只读当前账号，不修改客户端登录。客户端内登录后可重试；国际版不与国内积分混用。' },
  'claude-web': { provider: 'claude', websiteLogin: true, name: 'Claude 网站订阅额度（试验）', kind: 'cookie', url: 'https://claude.ai/api/organizations', provenance: 'undocumented-api', note: '在 Chrome 登录后手动连接 Claude，读取所选组织的订阅窗口；多组织账号须明确选择组织。不调用模型。' },
  'claude-oauth': { provider: 'claude', clientLogin: true, name: 'Claude 官方 CLI 登录', url: 'https://api.anthropic.com/api/oauth/usage', provenance: 'undocumented-api', note: '复用官方 CLI 的本人登录，或在应用独立目录中启动官方登录。需要 user:profile 授权；setup-token 不提供额度权限。' },
  'antigravity-cli': { provider: 'antigravity', clientLogin: true, name: 'Antigravity 官方 CLI 登录与报告（试验）', kind: 'local-report', provenance: 'official-cli', note: '使用应用独立登录目录，通过兼容版本的官方 /usage JSON 报告查询；不以模型提示替代命令。报告未提供账号身份时保持未知。' },
  'gemini-web': { provider: 'gemini', websiteLogin: true, name: 'Gemini app 网站登录（与 CLI 额度独立）', kind: 'cookie', url: 'https://gemini.google.com/_/BardChatUi/graphql/schemas/GEMINI_WEB_GRAPHQL/executeQuery?query_signature=' + encodeURIComponent('2/dWbCvkVB0X16r9NPnxifeOAAqdCqMf0xeWvau9yPy7g=') + '&variables=' + encodeURIComponent(JSON.stringify({ g1Request: { entrypoints: ['GEMINI_USAGE_SETTINGS_UPGRADE_BANNER'] }, workspaceRequest: { recommendationsForSurfaceRequests: [] } })), provenance: 'undocumented-api', note: '仅为 Gemini app 的 5 小时／周额度，与 Gemini CLI 的模型额度不同，不共享账号或缓存。' },
  'opencode-web': { provider: 'opencode', websiteLogin: true, name: 'OpenCode Console 网站登录（试验）', kind: 'cookie', url: 'https://opencode.ai/console/api/orgs', extra: { usage: 'https://opencode.ai/console/api/go/status' }, provenance: 'undocumented-api', note: '登录后读取所选工作区的 Go 订阅窗口；不会把 Zen 消费或其他上游视为 Go 余量。' },
  'deepseek-web': { provider: 'deepseek', websiteLogin: true, name: 'DeepSeek 平台网站余额（试验）', url: 'https://platform.deepseek.com/api/v0/users/get_user_summary', provenance: 'undocumented-api', note: '在 Chrome 登录后手动连接 API 平台，读取此网站会话的充值／赠送钱包。与手动 API key 连接独立，不推断二者属于同一账号。' },
  'workbuddy-web': { provider: 'workbuddy', websiteLogin: true, name: 'WorkBuddy 网站积分（试验）', kind: 'cookie', method: 'POST', url: 'https://www.workbuddy.cn/billing/meter/get-user-resource-summary', provenance: 'undocumented-api', note: '在 Chrome 登录后手动连接，保持匹配的浏览器 User-Agent；逐个资源包显示积分，冻结积分单列，不与余额相加。' },
  'claude-statusline': { provider: 'claude', name: 'Claude 官方状态栏观测', kind: 'passive', provenance: 'passive', note: '只接收官方状态栏已提供的 rate_limits；不会发起后台额度请求。需本人将导出命令合入现有状态栏配置，程序不修改设置或网络规则。重复值不刷新观测时间。' },
  'antigravity-statusline': { provider:'antigravity',name:'Antigravity 官方状态栏观测',kind:'passive',provenance:'passive',note:'只接收官方 CLI 状态栏已提供的 quota，读取剩余比例和明确的重置时间；不启动 CLI 或后台 /usage。需本人合入现有 statusLine 设置，不修改登录、配置或网络规则。相同观测不刷新年龄；未覆盖额度保持未知。' },
  'gemini-code-assist': { provider: 'gemini', clientLogin: true, name: 'Gemini CLI 官方登录与额度（试验）', kind: 'google-internal', method: 'POST', url: 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota', extra: { bootstrap: 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist' }, provenance: 'undocumented-api', note: '复用官方 CLI 登录或在独立目录启动官方登录，自动发现 Code Assist 项目。与 Gemini app 的网站额度分开；服务商账号资格限制会如实显示。' },
  'mimo-web': { provider: 'mimo', websiteLogin: true, name: 'MiMo 网站额度（可选 · 试验）', kind: 'cookie', url: 'https://platform.xiaomimimo.com/api/v1/balance', extra: { plan: 'https://platform.xiaomimimo.com/api/v1/tokenPlan/detail', usage: 'https://platform.xiaomimimo.com/api/v1/tokenPlan/usage' }, provenance: 'undocumented-api', note: '默认未连接。可在 Chrome 登录后手动连接并以 Windows 系统加密保持连接，也可手动提供本站 Cookie；仅保留白名单字段，不读取现有浏览器。分别读取 API 金额与 Token Plan Credits，不合并；非官方稳定接口。' },
  'cursor-web': { provider: 'cursor', websiteLogin: true, clientLogin: true, name: 'Cursor 网站额度（可选 · 试验）', kind: 'cookie', url: 'https://cursor.com/api/usage-summary', provenance: 'undocumented-api', note: '默认未连接。可在 Chrome 登录后手动连接并以 Windows 系统加密保持连接，也可手动提供一种本站 Cookie；不读取现有浏览器会话；客户端复用只在明确连接后读取固定登录字段。优先复用 Cursor 客户端当前登录，无需复制 Cookie；只展示已识别的服务端约束，不以 API 消耗推算新计划余额；非官方稳定接口。' },
  'deepseek-api': { provider: 'deepseek', clientLogin: true, name: 'DeepSeek API 余额', url: 'https://api.deepseek.com/user/balance', provenance: 'official-api', note: '优先复用已配置的 DeepSeek API key；也可手动输入并加密保存。余额按币种分别显示，不覆盖 Harness 的其他上游。' },
  'workbuddy-credit': { provider: 'workbuddy', name: 'WorkBuddy 个人积分', url: 'https://www.workbuddy.cn/openapi/v2/credit', provenance: 'official-api', note: '需要已授权 user.credit.readable 的短期 access token；仅聚合积分，不提供每个资源包到期日。公开 OAuth 接入仍需平台审核与服务端。' },
  'opencode-go': { provider: 'opencode', clientLogin: true, name: 'OpenCode Go 订阅', url: 'https://opencode.ai/zen/go/v1/usage', provenance: 'undocumented-api', note: '复用官方客户端已保存的 Go API key；仅显示 Go 窗口，不含 Zen 余额或其他服务商额度。服务端可能不返回账号标识。' },
  'zai-global': { provider: 'zcode', clientLogin: true, name: 'Z.ai Coding Plan（国际 · 试验）', url: 'https://api.z.ai/api/monitor/usage/quota/limit', provenance: 'undocumented-api', note: '复用 Z_AI_API_KEY，或手动输入并加密保存；只使用国际区 key。未返回的窗口、套餐到期日保持未知。' },
  'zai-cn': { provider: 'zcode', clientLogin: true, name: 'BigModel Coding Plan（中国 · 试验）', url: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit', provenance: 'undocumented-api', note: '复用中国区环境变量或已核对的 key 文件，或手动输入并加密保存。不跨区回退，不猜测企业组织／项目。' }
});
const loginContracts = Object.freeze({
  opencode: { mode: 'device-login', label: '在 Chrome 登录 OpenCode Console', note: 'Zen 按量余额通过 Console 授权读取；Go 订阅是另一种产品，需单独选择。' },
  zcode: { mode: 'device-login', label: '在 Chrome 登录 ZCode', note: 'ZCode 设备授权自动返回应用；API key 额度来源另行保留。' },
  codex: { mode: 'official-cli', label: '官方浏览器授权', note: '通过官方 Codex CLI 独立登录，凭据由官方客户端管理。' },
  claude: { mode: 'official-cli', label: '复用官方 CLI／浏览器授权', note: '网站登录、官方 CLI 登录与状态栏是独立来源。CLI 登录使用应用目录；过期后可一键重新登录。' },
  antigravity: { mode: 'official-cli', label: '官方 CLI 登录与报告', note: '在官方交互窗口完成登录后输入 /exit，应用验证 /usage 报告后保持连接。' },
  cursor: { mode: 'official-client', label: '复用 Cursor 当前登录', note: '优先一键复用 Cursor 客户端登录；网站手动连接另行保留。仅保存本站必要会话字段，以 Windows 系统加密保护，重启后可继续刷新。网站接口可能变更，不等同官方 OAuth。' },
  mimo: { mode: 'website-session', label: '网站登录并保持连接（试验）', note: '由你在 Chrome 登录后手动连接；仅保存本站必要会话字段，以 Windows 系统加密保护，重启后可继续刷新。网站接口可能变更，不等同官方 OAuth。' },
  workbuddy: { mode: 'official-client', label: '复用 WorkBuddy 当前登录', note: '推荐复用已登录的 WorkBuddy 国内版，点击即可验证积分并加密保持连接；网站手动连接另行保留。' },
  gemini: { mode: 'official-cli', label: '官方 CLI／Gemini app 登录', note: 'CLI 自动复用本人登录；新登录在独立官方窗口完成，输入 /exit 后验证。Gemini app 网站是独立额度来源。' }
});
const gaps = Object.freeze({
  claude: '提供网站、官方 CLI 与被动状态栏三种来源，真实账号验收仍需在本机完成。',
  antigravity: '主动读取兼容官方 CLI 的 /usage 报告；版本、账号身份和未覆盖额度保持明确边界。',
  gemini: 'CLI 登录与 Gemini app 登录分开；Google 账号资格与接口可用性需要真实验收。',
  mimo: '可选网站会话接入，默认关闭；Token Plan Credits 与普通 API 余额分离，非官方稳定接口。',
  cursor: '可选网站会话接入，默认关闭；仅覆盖已识别的个人／团队约束，不能保证覆盖新套餐全部额度。'
});
// Not something the provider publicly promises: a website session, an internal endpoint, a client's own login.
const experimental = route => route.provenance === 'undocumented-api' || route.websiteLogin === true || route.kind === 'google-internal' || /试验/.test(route.name);
const labelled = route => !experimental(route) || /试验/.test(route.name) ? route.name : /（推荐）$/.test(route.name) ? route.name.replace(/（推荐）$/, '（试验）') : route.name + '（试验）';
// Usage-only Agents whose account quota has a card and awaits its reader (docs/m2/UI-QUOTA-CARDS-BATCH-20261104.md). Adding a route is all a reader needs.
const planned = Object.freeze(['kimi', 'copilot', 'qwen', 'kilo', 'cline']);
function capabilities() {
  const catalog = require('../m1/agent-catalog').agents;
  return Object.entries(catalog).filter(([provider, meta]) => !meta.custom && (!meta.usageOnly || planned.includes(provider))).map(([provider, meta]) => ({ provider, name: meta.name, mode: provider === 'codex' ? 'official-cli' : planned.includes(provider) && !Object.values(routes).some(route => route.provider === provider) ? 'planned' : Object.values(routes).some(route=>route.provider===provider&&route.kind==='passive') ? 'passive' : Object.values(routes).some(route => route.provider === provider) ? 'explicit-token' : 'not-connected',
    adapters: Object.entries(routes).filter(([, route]) => route.provider === provider).map(([id, route]) => ({ id, name: labelled(route), experimental: experimental(route), websiteLogin: route.websiteLogin === true, clientLogin: route.clientLogin === true, clientOnly: route.clientOnly === true, clientMode: ['opencode-go', 'deepseek-api', 'zai-cn', 'zai-global'].includes(id) ? 'key' : null, kind: route.kind || 'http', provenance: route.provenance, note: route.note })).sort((a, b) => Number(b.clientLogin) - Number(a.clientLogin)),
    login: loginContracts[provider] || { mode: 'api-key', label: '复用配置／API key 连接', note: '优先复用已配置的 key。没有 key 时可打开官方页面获取，输入一次后以 Windows 系统加密保存。服务商需要自行创建 key 时会明确提示。' },
    reason: gaps[provider] || (provider === 'codex' ? '通过官方 CLI 独立授权连接。' : '验证额度后加密保持连接；服务商未支持的授权方式不伪装为 OAuth。') }));
}
module.exports = { routes, capabilities, experimental };
