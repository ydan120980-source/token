# QuotaDock · 额度台

Windows 本地 AI 编码 Agent 用量统计、会话阅读与账号额度监控。本地优先，用量统计离线可用，额度由官方客户端、固定额度接口或明确配置的被动观测提供。

> **预览阶段。** 没有签名、安装器和自动更新，从源码运行或自行打包，Windows SmartScreen 会告警。内存目标（整个进程 500 MiB 以内）尚未达成；会话阅读只用合成记录测过，部分格式依据公开源码和第三方说明，没有对真实记录逐一核对。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20x64-lightgrey)
![Node](https://img.shields.io/badge/node-%3E%3D22.15.0-green)

## 这是什么

一个 Windows 桌面应用（Electron），只读解析本机多个 AI 编码 Agent 的会话记录与本地数据库，把 token 用量、模型分布、时间趋势汇总成一个界面，按项目列出每个会话的用量与成本，并分别展示已连接服务账号的额度、余额与刷新窗口。当前后端登记十七个内置来源；新增七个来源的范围见[第一组合同](docs/m2/AGENT-BATCH1-CONTRACT-20261102.md)及[其余四来源合同与对接](docs/m2/AGENT-BATCH1-EXTRA-20261102.md)，前端适配、真实记录与打包验收另行完成。

额度页与来源页共同展示支持能力、账号连接和数据新鲜度。本地用量不等于账号额度；新接入服务的覆盖范围、授权条件和试验标记见下表。Codex 有历史真实读取记录；2026-10-21 修复后 WorkBuddy 一次只读积分查询、OpenCode Zen 的 Chrome 授权与余额读取也已成功，Zen 重启加密恢复通过；ZCode 授权与连接保持已通过，但该账号返回空额度桶，数值仍未知。Antigravity 随后完成首次设置并退出官方 CLI，两次真实额度报告读取成功；其重启恢复仍未验证。其余路线仍须分别验收，不能称为全部真实可读。个人来源只接入用量。

产品面向公开用户，支持来源与额度状态、GitHub 账号绑定和手动同步每日用量汇总。GitHub 连接需要在构建中配置项目自己的 GitHub App。选定仓库的只读项目监控与有限 Git 能力见[产品方向记录](docs/m2/PRODUCT-DIRECTION-20261019.md)。

## 这不是什么

设计上刻意不做的四件事，也是本项目的安全边界：

- **用量采集不读取认证文件。** 采集策略拒绝 `auth` / `credentials` / `config` / `settings` / `storage` / `token` 文件。独立额度连接只有在你选择复用登录时，才读取已核对的官方客户端凭据；不会让采集器或静态配置检查扫描认证。
- **用量采集不修改来源数据库或配置。** 源 SQLite 字节（含已提交 WAL 页）读入内存后由 sql.js 只读查询，不建连接、不加写锁、不迁移、不 checkpoint（`src/m1/policy.js`、契约见 `docs/m2/AGENT-INTEGRATION-CONTRACT-20261005.md`）。独立的 Agent 配置管理只在明确选择范围并预览、应用后修改指定配置，写入前加密备份，可撤销本次最近修改。
- **不上传本机统计。** 统计留在 `%APPDATA%\AgentUsage-M1`。额度凭据只发送到所选服务的固定接口；选择保持连接时使用 Windows 系统加密保存，详情见[连接与持久状态](docs/m2/CODEXBAR-LOGIN-PARITY-20261020.md)。
- **不发送推理或工具调用。** 额度只读取窗口与用量数字，不含会话内容。

采集只依赖本机已有文件。应用的网络功能包括公开模型价格快照、Codex 官方 CLI、你明确连接或刷新的服务额度接口，以及你主动点击“检查版本 / 安装 / 升级”时使用的固定官方安装来源；不上传本机统计。

来源管理的“安装与更新”支持十个内置 Agent 的版本检查、直接安装、升级、进度、取消与失败重试，并保留官方下载入口。普通 CLI 放在本应用独立管理的目录，需要 Node.js 时准备私有运行环境。安装后必须通过 `--version` 复检才切换。桌面程序下载并核验签名后打开官方安装界面，完成后点击“复检安装”。安装不会自动登录，也不表示账号额度已接入。个人来源只提供格式与路径引导。详见[安装管理合同](docs/m2/DIRECT-AGENT-INSTALL-20261019.md)。

Codex/Claude 原生安装直接下载并核验平台包，不依赖 npm 的可选依赖成功状态，也无需额外 Node；下载有字节进度、断点恢复和有限重试。Claude 只安装应用自有代次，不替换外部安装或检查个人代理/防火墙。历史本机维护逻辑已移至手动 `scripts/local/claude-governed/` 工具，产品遇到旧维护标记会停止该 Claude 操作并提示本机处理。需要 Node 的其他 CLI 才使用私有 Node。详见[公共安装器边界](docs/m2/PUBLIC-INSTALLER-BOUNDARY-20261020.md)。


## 阅读会话

点开一个会话才读取它自己的记录，支持 Codex、Claude Code（含子 Agent 记录）、OpenCode、MiMo Code、Gemini CLI、DeepSeek Harness 和 Antigravity；ZCode、WorkBuddy、Cursor 暂不支持。

- 对话正文只在阅读时存在于内存，关闭后不保留，不进统计、导出、日志或缓存。应用只记下你读到第几轮，以及你起的名称、分组和置顶。
- 跨会话搜索和“还有哪些会话改过这个文件”在你发起时才扫描记录，不建全文索引。
- 复制、导出 Markdown、打开链接都只由你的操作触发。
- 最多并排三个会话，每列最多上下两个；按住栏头或左栏里的会话可以拖动摆放，“更多”菜单里有等价的键盘操作。

## Codex / Claude Code 配置结构检查

独立 CLI 仅在显式给出绝对 home 或项目根时检查白名单 MCP/hooks/skills；不使用默认 home，不跟随父目录、插件或配置引用，不执行任何命令、MCP、hook、skill，不联网、不改配置或业务账本。只读检查的 Skill 仅看有界 frontmatter，指令文件只看元数据。检查结果不含原名称、命令、URL、参数、环境值、路径或错误原文；不接入保存查询与统计导出。

```powershell
# 仅示意；将参数替换为你明确选定的范围后才运行
node src/m1/config-health-entry.js --home 'C:\explicit\home' --project 'C:\explicit\project'
```

来源管理现有“Agent 配置”入口：选择 Codex／Claude Code 及用户级／项目级范围，明确选择目录后手动检查；目录和结果只在本次打开期间保留，其他 Agent 明确未适配。四态区分静态结构通过、问题、未检查、不适用；不证明安装版本兼容、连接成功或 hook 已受信任。复杂 TOML/YAML 无法安全解析时为未检查；Claude 混合账号文件 `.claude.json`、托管/插件/远端配置不读，用户和 local MCP 因此未覆盖。入口与验收见[统一配置入口](docs/m2/AGENT-CONFIG-CENTER-20261022.md)，详细白名单和限额见[静态配置合同](docs/m2/CONFIG-HEALTH-STATIC-20261020.md)。

配置检查现已补充 MCP 超时／环境白名单／工具选择字段、HTTP hook URL 与参数、MCP-tool hook 必需字段及 Claude Skill 调用开关和工具列表；无法求值的动态 URL、helper 和版本相关布尔别名保持未检查。JSON 结果的 `summary.mcp` / `summary.hooks` / `summary.skills` 给出脱敏分类计数；解析失败和缺文件也计入，整体仍不宣称客户端健康。详见[深入检查记录](docs/m2/CONFIG-HEALTH-DEEPENING-20261022.md)。

后续补充了 hook 事件与 handler 适用性、异步和条件字段、显式关闭 hooks 的本文件设置。诊断可通过 `location` 的固定 section 和从 1 开始的序号定位解析后的配置项，不输出原名称、matcher 或路径；这不是行号或跨次扫描稳定 ID。不会合并各配置层判断最终开关，也不执行条件。详见[事件适用性与定位记录](docs/m2/CONFIG-HEALTH-EVENT-COVERAGE-20261022.md)。

“管理当前类别”提供单独的本地管理面板：查看配置项名称、编辑指定字段、调整本文件开关、从本地配置或 Skill 目录导入，先预览再应用。已有命令参数、环境变量和请求头不回显，留空保留；只接收原生选择器授权的文件或目录，同名导入不覆盖。写入前要求系统加密备份及版本一致，JSON/TOML 会规范化并丢弃注释，撤销恢复原字节。Skill 停用及撤销导入保留目录副本。备份保留，但 UI 目前仅撤销本次打开期间最近一次修改；不自动下载依赖、执行脚本或授信。覆盖文件及未覆盖的配置层见[管理合同](docs/m2/AGENT-CONFIG-CENTER-20261022.md)。


## 十 Agent 额度读取条件

部分路线不是服务商公开承诺的接口，比如网站 Cookie、客户端内部额度查询和复用客户端登录。它们可能随时失效，也可能受服务商条款限制；是否使用由你决定，下面标为试验的路线请先看清条件。

十个内置 Agent 都有“连接／登录”入口，按 [CodexBar 登录对齐合同](docs/m2/CODEXBAR-LOGIN-PARITY-20261020.md) 选择服务商实际支持的方式：Chrome 设备授权自动返回、官方 CLI 登录、已有客户端凭据或 API key 复用，以及网页手动备用路线。验证额度后保持连接，重启恢复不主动联网。没有可复用 key 的服务仍需从官方页面获取一次；不把它伪装成 OAuth。实现、合成验收与真实账号验收分开记录：Codex 有历史记录，2026-10-21 修复后 WorkBuddy 当前客户端的一次只读积分查询、OpenCode Zen 的真实授权与余额读取也成功，后者重启可恢复；其他真实结果以各轮验收记录为准。

本轮便利接入：WorkBuddy 优先复用国内版桌面客户端当前登录；Cursor 优先复用客户端登录；ZCode 新增 Chrome 设备授权，完成后自动返回并读取 ZCode 自身额度，与 Z.ai／BigModel API key 路线分开。OpenCode 默认通过 Chrome 授权读取 Console／Zen 按量余额，Go 另选；Claude、Gemini 优先现有客户端，DeepSeek API 优先配置 key。MiMo 与 DeepSeek 网站来源保留手动备用，不读取现有浏览器。协议、读取白名单和限制见[客户端便利登录合同](docs/m2/CLIENT-LOGIN-CONVENIENCE-20261021.md)。

Claude、Antigravity 的旧状态栏观测仍可选择。新的 Antigravity 官方 CLI 路线使用独立登录目录和受版本约束的 `/usage` JSON 报告；不将上下文 token 比例当额度。Gemini app 网站额度与 Gemini CLI 额度独立。字段缺失、服务端拒绝或缓存过期都不表示零额度或无限额度。

## 环境要求

- Windows 10 / 11 x64
- Node.js `>=22.15.0`（见 `package.json` 的 `engines`）
- 可选：本机已安装 `codex` CLI（仅"额度监控"需要）

其他平台不在支持范围内：`package.json` 只声明 `win` x64 target，且 `src/m1/policy.js` 的来源根路径按 Windows 约定解析。

## 快速开始

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js
npm.cmd start
```

第二条命令是必需的：`--ignore-scripts` 会跳过 Electron 的 postinstall，该脚本才会真正下载 Electron 二进制；跳过它 `npm start` 会直接失败。

首次启动后界面可能显示空数据，这是正常的——本机还没有任何 Agent 的会话记录。数据目录 `%APPDATA%\AgentUsage-M1` 也在首次运行时才创建。

只想看界面（不启动 Electron、不调用原生采集）：

```powershell
node design/desktop-reference/serve.js
# 打开 http://127.0.0.1:4178/
```

这是合成数据的开发预览，不连接真实来源、不能登录账号。

## 支持的来源

| Agent | 读取位置 | 读取内容 |
| --- | --- | --- |
| Codex | `~/.codex/sessions`, `~/.codex/archived_sessions` | 会话 JSONL |
| Claude Code | `~/.claude/projects`, `~/.claude/transcripts` | 会话 JSONL |
| OpenCode | `~/.local/share/opencode` | 消息 JSON / SQLite |
| WorkBuddy | `~/.workbuddy/projects`, `workbuddy.db` | JSONL / SQLite |
| MiMo Code | `~/.local/share/mimocode` | SQLite |
| Gemini CLI | `~/.gemini/tmp`（路径含 `chats`） | 会话 JSON/JSONL |
| Cursor | `~/.cursor/projects` | SDK `index.db` / `runs.ndjson` / usage CSV |
| ZCode | `~/.zcode/cli/db/db.sqlite` | SQLite |
| DeepSeek Harness | `~/.dsh/sessions`, `~/.dsh/profiles/desktop/sessions` | 会话 JSONL（含 zstd） |
| Antigravity | `~/.gemini/antigravity/brain`（另含 `-cli`、`-ide`） | 对话 transcript JSONL；模型取自同名对话库 |
| GitHub Copilot CLI（仅用量） | `~/.copilot/session-state`；可选已有 `otel` 文件 | shutdown 逐模型累计用量的区间差分；OTel 只接受单次 chat span，两模式不混计 |
| Cline（仅用量） | VS Code 的 `globalStorage/saoudrizwan.claude-dev/tasks`；`~/.cline/data/sessions` | IDE `ui_messages.json`、CLI `<session>.messages.json` 的调用用量 |
| Pi（仅用量） | `~/.pi/agent/sessions` | v3 session JSONL 中的 assistant usage；其他格式未适配 |
| Continue（仅用量 · 估算） | `~/.continue/dev_data/devdata.sqlite` | `tokens_generated` 数值；客户端估算标记 partial，不作精确定价 |
| Kilo Code（仅用量） | VS Code 的 `kilocode.kilo-code/tasks`；`~/.local/share/kilo/kilo.db` | 当前 IDE 用量事件 / CLI message token；旧 IDE 口径不明的行拒绝 |
| Qwen Code（仅用量） | `~/.qwen/projects/*/chats/*.jsonl` | assistant `usageMetadata`；reasoning 重叠不明时输出保持未知 |
| Kimi CLI / Code（仅用量） | `~/.kimi/sessions`、`~/.kimi-code/sessions` | `wire.jsonl` 中的 StatusUpdate / turn-scoped usage.record；不读配置猜模型 |

路径定义在 `src/m1/policy.js:6`。逐个来源的字段口径、去重规则与已知限制见 [AGENT-INTEGRATION-CONTRACT-20261005.md](docs/m2/AGENT-INTEGRATION-CONTRACT-20261005.md)。

也可在“来源管理 → 添加我的 Agent”配置个人来源：首版支持 Claude JSONL 格式复用、自定义逐请求字段映射与标准用量事件。先预览再启用；规则修改重算可读文件，保留无法重读的历史。详见 [自定义来源使用说明](docs/m2/CUSTOM-JSONL-USAGE-20261017.md)。

“设置 → 定价”的未计入估算列表可展开处理方法，并定位对应来源；费用页的计价覆盖也能打开具体模型的说明。缺价格、缺用量字段和冲突分别处理，原文件未记录的历史不补零。详见[未计入估算处理指南与公开 Agent 配置实验](docs/m2/UNPRICED-USAGE-GUIDE-20261018.md)。

项目用量与预算已融入“费用”页的“项目与预算”切换；按当前价格重新估算位于“设置 → 定价”。来源、费用、会话与预算的核对事项合并在“来源管理 → 需要处理”，其他页面只保留一行提示和链接。各来源的解析能力与字段覆盖可在“来源管理”的对应来源中展开；程序安装、用量读取、账号额度与故障恢复集中在每个 Agent 的“管理”面板。未知项目不猜测，未知费用不填零；改价或重新估算不修改用量事实。项目 CSV 不含绝对路径或原始身份。详见[使用与数据边界](docs/m2/WORKBENCH-INSIGHTS-20261018.md)及[页面融合决定](docs/m2/INSIGHTS-INTEGRATION-20261018.md)。

| 账号服务 | 额度路线与覆盖范围 | 连接条件 |
| --- | --- | --- |
| Codex | 官方 CLI 返回的资源池、窗口与余额；不固定套餐规则 | 独立官方授权；历史真实读取通过，本轮未重查 |
| Claude Code | 网站组织订阅窗口、CLI OAuth usage；状态栏保留 | Chrome 登录后手动提供本站凭据，或复用／启动官方 CLI 登录 |
| DeepSeek API | API 按币种余额；平台网站的充值／赠送钱包另列 | Chrome 网站登录后手动连接、已有 key 复用或手填；不覆盖 Harness 其他上游 |
| WorkBuddy | 当前国内版客户端逐包积分／有效期；网站与官方聚合路线另列 | 推荐复用已登录客户端，无需复制 Cookie；真实界面连接、积分读取和重启恢复通过；网站备用需 Cookie 与同次请求 User-Agent；接口为试验路线 |
| OpenCode Go | 所选 Console 工作区 Go 约束或 Go key 窗口 | Chrome 网站登录后手动连接、已有 key 复用或手填；不混入其他上游或 Zen 消费 |
| OpenCode Zen | 所选 Console 工作区的预付按量余额；不含 Go 或月预算 | Chrome 设备授权自动返回并加密保存，无需复制 Cookie；真实授权、余额读取与重启恢复已通过；只续期应用自己创建的授权 |
| ZCode / Z.ai / BigModel | ZCode 自身额度桶、个人 Coding Plan 约束分别显示，中国区与国际区分开 | ZCode 可在 Chrome 设备授权自动返回；Z.ai／BigModel 复用对应区 key 或手填，不把 key 来源伪装为 OAuth |
| Gemini | CLI `retrieveUserQuota` 按模型/单位分池；Gemini app 网站窗口独立 | 复用／启动官方 CLI 登录，自动发现项目；也可选Chrome app 网站登录后手动连接，二者额度不同 |
| MiMo | 普通 API 金额与 Token Plan Credits 独立显示 | 默认未连接；在 Chrome 登录后手动提供本站 Cookie，可加密保持连接；非官方稳定接口 |
| Cursor | 已识别的个人与团队消费约束；新套餐可能仅部分覆盖 | 默认未连接；可复用当前客户端登录，网站手动 Cookie 为备用；非官方稳定接口 |
| Antigravity | 受版本约束的官方 CLI `/usage` JSON 报告；状态栏保留 | 独立官方 CLI 登录，报告须证明零模型轮次；首次设置后输入 /exit，真实额度读取已通过；重启恢复待验证 |

在“额度监控”里该 Agent 的卡片上连接（未连接的 Agent 列在页面下方）。ZCode／OpenCode Zen 的设备授权在 Chrome 完成后自动返回应用；其他网站手动备用路线在本机 Chrome 日常标签页打开官网，随后回到应用手动提供本站 Cookie／Token；应用不自动读取 Chrome 个人资料、现有标签页、Cookie 或本地存储，不创建内置网页登录窗口。WorkBuddy 网站备用路线还需同一次请求的 User-Agent；Claude／OpenCode 网站手动路线的多组织账号需填写对应组织／工作区 ID。Codex 的官方授权页也明确使用 Chrome；其他官方 CLI 保留其外部官方授权流程。勾选系统加密保持连接时，先验证额度再保存；未勾选的手动凭据只在内存，移除会删除应用保存的凭据。启动恢复不联网，失效后重新提供。**不要在聊天里发送凭据。** 复用已有客户端登录是另一个明确操作，仅使用已核对的固定文件合同，不由网页登录或后台采集触发。接口缺字段、订阅资格未知或读取失败都不补零；到期不自动续额，独立充值余额不随订阅推定失效。见 [Chrome 登录修复](docs/m2/CHROME-LOGIN-RECOVERY-20261021.md) 与 [账号登录合同](docs/m2/CODEXBAR-LOGIN-PARITY-20261020.md)。

已知缺口需要在贡献前了解：Gemini CLI 与 Cursor 目前**只有格式合成样本与 Electron 测试，没有真实调用样本**，因此不能认为这两个来源的真实数据已被验收；ZCode 没有官方数据库合同，按投影字段读取。

## GitHub 账号与同步

- 维护者在 GitHub 注册项目自己的 GitHub App，启用设备流程，仓库权限设为 **Contents: Read and write**、**Metadata: Read-only**。公共分发时，将 App 配置为其他用户也可安装。在 `package.json` 填写公开的 Client ID（`githubAppClientId`）和 App slug（`githubAppSlug`，即 `github.com/apps/` 后的名称）。本机测试也可在启动前设置环境变量 `AGENT_USAGE_GITHUB_CLIENT_ID`。设备流程无需 Client Secret 或私钥。
- 用户在「设置 → 账号与同步」点击「连接 GitHub」，在 GitHub 输入设备代码并确认授权。把 GitHub App 安装到自己选定的私有仓库，返回「刷新仓库」。选择仓库、打开同步开关，再点击「同步」。
- 同步会在该仓库默认分支提交 `agent-usage/<设备 ID>.json`，其中是每日各 Agent、各模型的 Token 和估算费用汇总。每台电脑写自己的文件，应用只在点击「同步」后发出写入。GitHub 和有权限的仓库协作者能看到该文件。
- 「断开」会清除本机的加密登录与同步设置，已上传文件保留。可在 GitHub 的 [Applications 设置](https://github.com/settings/installations) 中管理安装授权。

## 数据位置

| 内容 | 位置 |
| --- | --- |
| 用量历史与采集偏好 | `%APPDATA%\AgentUsage-M1` |
| 额度连接、缓存、独立 CLI home | `%APPDATA%\AgentUsage-M1-Quota` |

删除这两个目录即可完全清除本应用产生的数据。应用不会删除你的原始 Agent 记录。

## 隐私与数据处理

见 [docs/PRIVACY.md](docs/PRIVACY.md)。关键是：统计只包含白名单字段（模型名、token 桶、时间戳、来源标识），不含会话正文、标题、绝对路径、邮箱、凭据或设备名。正文只在你打开“阅读会话”时读取，不写入统计。

## 定价模型

未计入估算列表支持本地模型别名建议：展示完整候选、服务商、匹配理由与费率，选择后仍需点击保存才建立映射；不同版本、日期或歧义不会自动定价。自定义费率支持新增、再次编辑、移除；倍率空白拒绝、显式 0 保留，保存失败保留输入并可重试。费用原排版、紧凑展开与完整趋势均保留。

被映射或默认模型引用的手动费率，在没有有效参考价可回退时须先解除引用才能移除；价格目录更新也不能使有效引用失效。清空统计和偏好保存失败时，内存继续使用原状态。

内置 `src/m1/models-dev-prices.json` 定价快照，可手动同步公开价格数据。三条硬规则：

- 未知用量永远不填 0；缺失保持 `null` 并显示为"未知"。
- 未知价格永远不当作免费；显示为"未定价"。
- 冲突保护不为了凑总额而关闭。

因此界面上的 API 等价估算只是估算，未定价的模型会单列而不是计成 0。

价格快照的更新流程见 [docs/m1/PRICING-SYNC-20261004.md](docs/m1/PRICING-SYNC-20261004.md)；用 `npm run pricing:check` 检查当前快照是否偏离已评审来源，`npm run pricing:sync` 重新生成。

## 开发

```powershell
npm.cmd run verify          # ESLint + 全部单元测试，要求 fail 0
npm.cmd run test:native     # 需要 tokscale 原生二进制
npm.cmd run test:ui         # 需要 Playwright + 显示器
npm.cmd run test:quota:ui
npm.cmd run test:stress
npm.cmd run experiment:crypto
npm.cmd run audit:runtime
```

`verify` 之外的大多数脚本需要 Playwright、Electron 或真实显示器。所有维护用 UI 测试都使用独立的 usage/quota 目录和合成 fixture home，不触碰真实数据。

**唯一会读取你真实用量来源的是 `npm run validate:local`**，它不是例行测试，不纳入 `verify`。

贡献流程、数据语义铁律与已知陷阱见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 项目结构

```
src/quota/      Electron 主进程、IPC、额度 RPC、窗口外壳（产品入口）
src/m1/         共享统计库：来源策略、解析、存储、定价（不是第二个应用）
design/desktop-reference/   渲染层 HTML/CSS/JS
scripts/m1/     开发与验收脚本
tests/m1/       单元测试
docs/m1/, docs/m2/   设计与验收记录
```

`src/m1/` 是共享库，不是"M1 版应用"——历史上曾有一个独立的 M1 界面，已删除。

## 本地只读 CLI / MCP

可让已有 Agent 查询本应用保存的用量聚合，不触发采集、不读取 Agent 配置或原始会话元数据。只支持本地 CLI 和 stdio，不监听 HTTP/TCP：

```powershell
node src/m1/query-entry.js query
node src/m1/query-entry.js mcp
```

缺省读取 `%APPDATA%\AgentUsage-M1` 中的归一化账本与已保存计费设置；启动时可用 `--data-dir` 选择应用数据目录。工具只返回日期、Agent、模型、服务商、入口维度的聚合及会话计数；不返回路径、身份、映射、配置或文件索引。未知保持 null，费用仅为 API 等价估算。**调用方 Agent 可能把聚合结果发给它的模型服务商；本应用不新增上传。** 打包 EXE 的启动配置、筛选/分页和错误口径见[已保存查询合同](docs/m2/SAVED-QUERY-20261018.md)。

配置检查已有[独立静态 CLI 和来源管理中的显式入口](docs/m2/AGENT-CONFIG-CENTER-20261022.md)，首批支持 Codex／Claude Code；历史[逐 Agent 候选探索](docs/m2/CONFIG-HEALTH-EXPLORATION-20261018.md)不代表其他 Agent 已适配。

## 打包

```powershell
npm.cmd run dist:win:dir -- --config.directories.output=dist/r10
```

输出为未签名的 `win-unpacked/` 目录，必须整体保留（不能只复制 exe）。

## 已知限制

- 构建产物**未签名**（`signAndEditExecutable: false`），Windows SmartScreen 会警告。`@tokscale` 原生二进制在每次 spawn 前按 `src/m1/native.js` 中固定的 SHA-256 校验，不符时以 `NATIVE_BINARY_MISMATCH` 拒绝且不启动（目前这会让该轮采集整体失败，与其他原生校验失败相同）。校验与启动之间仍有极短的检查-使用间隔；它防的是二进制损坏或被单独替换，不替代代码签名，也不防已能写入安装目录的本地攻击者。
- 存储文件损坏时不会退出：损坏文件被移入数据目录下的 `quarantine/`，应用以空数据启动并在界面上说明，原始字节保留供人工检查。旧的自动备份仍在（`backups/statistics-before-*.json`），但没有"从备份一键回滚"的按钮。
- 原生验证（tokscale 交叉校验）失败会丢弃整轮采集结果，而不是保留本轮扫描。
- 摘要首次统计 2 万行数据时主线程会阻塞约 334–364 ms。
- 物理 DPI 缩放、Windows 窗口吸附、长时间连续运行未做系统化验收。曾出现过一次窗口关闭错误，根因未定位。
- 没有内核级网络审计；网络封锁是 Node 层的 API 拦截（`src/m1/policy.js:66`）。
- 未使用读屏软件实测；无障碍检查见 [A11Y-REVIEW-20261008.md](docs/m2/A11Y-REVIEW-20261008.md)。
- 配对、跨设备同步、生产密钥与 iOS 端均未开始。本项目目前只有 Windows 桌面端。

## 文档索引

- [Agent 交接说明](docs/AGENT-HANDOFF.md)——给第一次接手本项目的 AI 编码 Agent
- [数据合同与去重](docs/m1/DATA-CONTRACT.md)
- [Codex 登录与额度边界](docs/m1/CODEX-QUOTA.md)
- [来源接入合同](docs/m2/AGENT-INTEGRATION-CONTRACT-20261005.md)
- [桌面端范围与同步边界](docs/m2/DESKTOP-SCOPE-20261004.md)
- [上游来源与复用边界](docs/m1/UPSTREAM.md)
- [第三方资产归属](design/desktop-reference/LICENSES.md)

## 贡献与安全

- 贡献流程：[CONTRIBUTING.md](CONTRIBUTING.md)
- 安全报告：[SECURITY.md](SECURITY.md)

## 许可与归属

MIT，见 [LICENSE](LICENSE)。第三方组件、图标、字体与定价数据来源见 [NOTICE](NOTICE) 与 [design/desktop-reference/LICENSES.md](design/desktop-reference/LICENSES.md)。

本项目源自 [token-monitor](https://github.com/Javis603/token-monitor)（MIT，Javis）的维护分支，上游 provenance 与复用边界见 [docs/m1/UPSTREAM.md](docs/m1/UPSTREAM.md)。
