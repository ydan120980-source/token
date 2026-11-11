# 隐私与数据处理

本文说明 Agent Usage 读取什么、不读取什么、以及数据存在哪里。实现位置：`src/m1/policy.js`、`src/m1/sources.js`、`src/m1/extended-sources.js`、`src/quota/`。

## 读取范围

应用只读取你本机已经存在的 AI 编码 Agent 记录，内置来源仅限下面十个来源的白名单路径：

Codex、Claude Code、OpenCode、WorkBuddy、MiMo Code、Gemini CLI、Cursor、ZCode、DeepSeek Harness、Antigravity。自定义 JSONL/NDJSON 只读取你通过本机目录选择确认的范围，遵循 [自定义来源合同](m2/CUSTOM-JSONL-SOURCES-20261017.md)。

完整路径与各来源允许的文件类型定义在 `src/m1/policy.js:6`（`roots()`）与 `:23`（`allowedFile()`），逐来源字段口径见 [docs/m2/AGENT-INTEGRATION-CONTRACT-20261005.md](m2/AGENT-INTEGRATION-CONTRACT-20261005.md)。

**只有下面这些字段会进入统计**：模型标识、各 token 桶计数（input / output / cache read / cache write / reasoning）、时间戳、来源与 Agent 标识、会话级去重标识。

**会话页另外在本机保存两个字段**：原始会话 ID 和会话的工作目录（绝对路径），每个会话一份，用于本机显示、分组和已支持来源的"复制恢复命令"。Codex、Claude Code、OpenCode、Gemini CLI、DeepSeek Harness、WorkBuddy、MiMo Code、ZCode、Antigravity 在已有合同规定字段可用时保存；没有目录依据的记录归入"未知项目"。Cursor 和自定义来源不从目录名或会话 ID 猜测项目。Gemini CLI 的 `.project_root`、各来源会话表和 Antigravity 配对元数据仍按既有白名单读取；本轮工作台不增加来源读取。规则见 [会话合同](m2/SESSIONS-LAYER1-20261012.md)及[来源合同](m2/AGENT-INTEGRATION-CONTRACT-20261005.md)。

**会话阅读视图（2026-11-01）**：你点开一个会话的“阅读对话”时，应用才读取这个会话自己的记录（Codex、Claude Code、OpenCode、MiMo Code、Gemini CLI、DeepSeek Harness、Antigravity），在窗口里显示完整对话和工具调用（Markdown 只转成界面元素；只显示记录里自带的图片，不读取远程图片）。你点对话里的 http、https 链接时，它会在系统默认浏览器里打开；你点“复制这一轮”或“导出 Markdown”时，对话内容才会进入剪贴板或你选定位置的文件。在会话页点“搜对话内容”时，应用现读当前范围内这些会话的记录查找这个词，只把匹配的会话和几段上下文显示出来，不建索引。内容不写入统计库、统计导出、查询接口或日志，不缓存，关闭即丢弃；文件不会被修改或删除。见 [SESSIONS-READER-20261101.md](m2/SESSIONS-READER-20261101.md)。

**2026-11-01 起会话页还保存两样东西**：Agent 自己保存的会话标题（与会话 ID、工作目录同一规则，只在本机会话页显示），以及你给会话起的名称和置顶，后者保存在应用自己的 `session-labels.json`，按哈希后的会话键记录，不写入任何 Agent 的文件。两者都不进入统计快照、统计导出和查询接口。

**2026-11-02 起还记住读到哪**：只保存第几轮这一个数字，和名称、置顶存在同一个应用文件里，不保存对话内容；回到第一轮时删除。

**2026-11-02 起可以整理和对比多个会话**：你起的分组名和“已归档”标记也存在这个应用文件里，不进统计，也不改 Agent 的文件；归档只影响会话页的列表。可以同时打开几个对话并排阅读，读取方式和阅读单个对话相同。对比时才读取这些会话的记录，只把轮次、工具调用、失败等数字和改过的文件路径交给窗口，不包含对话文字，离开对比后不保留。

**2026-11-02 起可以查“还有哪些会话改过这个文件”**：只在你点按钮时扫描其他会话的记录，方式和跨会话搜索相同，不建索引；结果只有哪个会话、路径和增减行数，不保存。快速切换（Ctrl+K）只搜名称、项目等已有信息，不读对话内容，也不记搜索历史。

**2026-11-03 起有本机 Agent 管理后台**（来源管理 › Agent 配置）：只在你点“检查本机配置”时读取 Codex、Claude Code、Gemini CLI、OpenCode 的配置文件清单和你选的项目，不执行其中任何东西，不联网，不读认证文件和 `~/.claude.json`。页面只拿到名称、数量和健康结论，拿不到参数、环境变量值、请求头值和完整地址。你选的项目目录保存在本应用的数据目录里；指令文件只在你打开时读取内容。修改前先预览，写入前加密备份。“统计使用情况”只在你点击时扫描已读取的会话记录，只得到名称和次数，不保存。

## 用量采集不读取

- **认证与凭据文件。** 用量采集拒绝文件名以 `auth`、`credentials`、`config`、`settings`、`storage`、`token`（后随 `._-` 或结束）开头的文件。独立静态配置 CLI 仅在显式绝对范围内读取另行白名单的非认证配置，输出脱敏结构，不自动扫描；见 `m2/CONFIG-HEALTH-STATIC-20261020.md`。
- **会话正文。** 统计投影和会话页都不包含消息内容。会话标题只取 Agent 自己保存的标题字段（Codex 的 `session_index.jsonl`、Claude Code 的 `/rename` 记录、OpenCode/MiMo Code 会话表和 Antigravity 摘要库的 `title` 列），从不从消息截取；见 [SESSIONS-NEXT-20261101.md](m2/SESSIONS-NEXT-20261101.md)。
- **绝对路径不对外输出。** 统计快照和统计导出不含本机路径和原始会话 ID；工作目录只出现在本机的会话页里。
- **邮箱、设备名、凭据。** 不进入快照，不进入导出。
- **额度凭据。** 用量采集不接触额度凭据。独立额度功能可使用官方 CLI 的原生认证状态，或在明确连接／刷新时使用下文规定的客户端字段与应用加密凭据。

## 来源只读与显式配置管理

源数据库以只读方式打开：将原始字节（含已提交的 WAL 页）载入内存后由 sql.js 查询，不建立持久连接、不加写锁、不迁移 schema、不执行 checkpoint。用量采集不修改 Agent 的数据库或配置。

独立的 Agent 配置管理仅在本次明确选择的 Codex／Claude 范围内工作。检查保持只读；编辑、启停或本地导入须经过预览→应用，写入前检查版本并加密保存恢复记录。Skill 管理可读取所选目录的完整文件以保留内容和导入，脚本只作为数据复制，不执行、不安装依赖。撤销仅提供本次运行最近一次成功修改；目录停用或撤销导入会在所选根目录保留副本，重启不恢复范围授权。详见[配置管理合同](m2/AGENT-CONFIG-CENTER-20261022.md)。

## 不传输

应用不上传本机统计和会话内容。额度连接需要将你在本地明确提供的凭据发送给该服务的固定额度地址；没有第三方中转。启用本地 stdio 查询后，外部调用 Agent 可能把返回的聚合传给其模型服务商，是否启用由你按该客户端的数据处理规则决定。应用的出网点是：

1. 公开价格快照：固定 URL `https://models.dev/api.json`，在独立子进程中 GET（16 MB 上限、15 s 超时），子进程环境被裁剪为 `ELECTRON_RUN_AS_NODE` / `SYSTEMROOT` / `WINDIR` / `TEMP` / `TMP`，不传递 HOME 或代理变量。
2. Codex 官方 CLI：连接／刷新或用户启用的额度自动刷新可启动受控的只读额度查询；登录是独立的显式操作。
3. 程序安装管理：仅在你主动检查版本、安装或升级时，由独立子进程读取固定官方公开版本接口、npm 公共仓库及下载文件。HTTPS 重定向继续核验域名；不继承认证、代理凭据、npmrc 或 Agent 配置。CLI 安装与版本探测使用应用自己的隔离 HOME，npm 禁用生命周期脚本；不会登录或调用模型。桌面安装器核验发行者签名后交给 Windows 打开，后续官方安装界面由你操作。打开安装器、官方网页或复制命令不等于安装完成或额度就绪。
4. 额度适配器：明确连接／刷新及用户启用的自动刷新，只向所选提供商固定 HTTPS 额度接口发送必要凭据，拒绝重定向和错误正文回显，不调用模型。WorkBuddy billing summary 与 Gemini retrieveUserQuota/loadCodeAssist 是固定只读 POST。网站登录仅打开日常 Chrome 标签页，随后由用户手动提供必要凭据；不创建内置浏览器，不读取浏览器配置、现有标签页、Cookie 或本地存储，不开启调试端口。Claude/Gemini/Antigravity 可启动应用自有目录的官方 CLI 登录。明确选择复用客户端登录的连接／刷新路线才读取核对过的固定认证字段或有限环境变量/key 文件；启动恢复、状态查询、采集、自动刷新和配置健康不读取这些外部凭据。详见 [逐项合同](m2/CODEXBAR-LOGIN-PARITY-20261020.md)。

选择“保持连接”时，必要的 access token、本站 Cookie、匹配的 User-Agent、组织/workspace 选择和应用自有授权的续期上下文，以 Windows safeStorage/DPAPI 加密保存于 provider-quotas/website-secrets。系统加密不可用时拒绝保存，不降级为明文。手动连接可取消保持，仅在本次运行内存中使用。它不隔离同一 Windows 用户运行的恶意程序。重启恢复本身不访问网络；连接／刷新及已启用的自动刷新可查额度，应用自有 Claude/Gemini grant 可在刷新时通过固定 token 地址续期，不复制或轮换外部客户端的 refresh token。凭据、原始响应和续期上下文不进入 renderer、连接 JSON、日志或统计导出。

自动刷新使用一个共享定时器，仅处理已有的合格连接，跳过忙碌、冷却和未连接项，不补跑错过的周期；不启动登录，不重读外部 WorkBuddy/Cursor 客户端认证。参见[自动刷新合同](m2/LOGIN-STABILITY-20261023.md)。

网站手动备用路线只打开日常 Chrome，不读取既有浏览器会话。手动提供的 Cookie 仍按服务字段过滤；DeepSeek 网站使用用户在本地提供的 userToken。未知账号身份不会从备注推断；多组织／工作区不默认选首项。JS 运行时不能保证内存的物理擦除。

新增 WorkBuddy 客户端路线，仅在明确连接／刷新时读取当前固定认证文件的必要 access token、有效期和身份绑定字段；不读取历史账号，不复制外部 refresh token、不修改官方文件。读取加密字段前核对官方程序签名、产品和文件摘要，辅助程序只取得该版本的兼容字段密钥，密钥仅留进程内存。国内版固定账单 POST 与网站 Cookie 路线分开。

Cursor 仅在明确连接／刷新时查询客户端固定 state.vscdb 的 access-token 键；数据库及已提交 WAL 读入内存，不写源库、不创建 shm。ZCode 设备登录通过固定初始化／轮询地址与 Chrome 授权完成，不读取浏览器 Cookie；随机 flow secret 仅内存，必要 ZCode 登录 token 与设备绑定信息在账单响应验证后加密保存；成功空额度桶保持未知及登录，不当作零，不保留额外返回的第三方 token。均不领取奖励、不自动切换账号、不调用模型。详见[便利登录合同](m2/CLIENT-LOGIN-CONVENIENCE-20261021.md)。

ZCode 与 OpenCode Zen 的设备授权在专用子进程联网，主进程继续禁止网络。OpenCode Zen 通过固定 Console 的 device/code、device/token、必要时 orgs，以及 billing/status 获取授权和所选工作区按量余额；不读取浏览器、不请求远程配置、用户资料或模型。只将本应用创建的必要 access／refresh grant 加密保存；续期仍走固定 token 地址，组织变化会拒绝更新旧连接。Go 订阅与 Zen 余额独立，API key 连接不会被当作 Console 登录。详见[真实故障修复合同](m2/LOGIN-REAL-RECOVERY-20261021.md)。

官方 CLI 登录有每连接独立 home 和 Job Object 进程所有权；终端由官方客户端显示，stdout/stderr 不返回应用。Antigravity 明确登录时，仅从本次 Job 拥有且核对为同一固定程序映像的进程控制台输出单元识别完整 Google 授权地址，核对官方回调、state／PKCE 和必填参数后交给 Chrome；地址不保存到结果、日志或磁盘，识别后停止读取，不读取键盘输入或其他窗口。官方 CLI 可能在该自有目录保存原生格式认证文件，不能声称这些文件也由 vault 加密。取消／失败清理新的登录目录；移除连接在进程结束后清理相应自有目录和加密 vault，失败会提示。不会删除或退出外部客户端／浏览器账号。Antigravity 使用自有文件存储模式和受版本约束的 /usage JSON，缺少独立 token 时不启动后台登录；报告身份未知时保留未知。

Claude / Antigravity 既有被动状态栏路线仍独立保留，仅投影 rate_limits 或 quota，重复值不刷新年龄，不写原始路径／会话数据。新主动连接路线不修改原有状态栏配置；未收到额度不按上下文 token 推算。

产品安装器只写应用自有代次，不检查个人代理或防火墙，不替换外部 Claude。旧治理标记触发本机维护提示，备份保留。机器专用工具已移至源码中的 `scripts/local/claude-governed/`，由原所有者另行手动维护，不被产品加载或打包；见 `m2/PUBLIC-INSTALLER-BOUNDARY-20261020.md`。

渲染层 CSP 为 `connect-src 'none'`，主进程拒绝所有非 `file:` / `devtools:` 的请求。

会话页的"复制恢复命令"只在你点击时，由主进程把一条 PowerShell 命令写入系统剪贴板，应用不会执行它。

## 存储位置与清除

| 内容 | 位置 |
| --- | --- |
| 用量历史、会话 ID 与工作目录、采集偏好、统计备份 | `%APPDATA%\AgentUsage-M1` |
| 额度连接缓存、独立 CLI home | `%APPDATA%\AgentUsage-M1-Quota` |
| 新服务连接备注、规范额度快照与 Claude 被动白名单观测（不含凭据） | `%APPDATA%\AgentUsage-M1-Quota\provider-quotas` |
| 网站登录保留的白名单凭据（Windows 系统加密，按连接绑定） | `%APPDATA%\\AgentUsage-M1-Quota\\provider-quotas\\website-secrets` |
| 配置管理加密恢复记录（只提供本次运行最近一次修改的撤销） | `%APPDATA%\AgentUsage-M1-Quota\config-backups` |
| 界面偏好、个人资料、小组件布局与 Electron 本地存储 | `%APPDATA%\AgentUsage-M1-Quota` 下的 Electron 用户数据 |
| 应用内 Agent 安装、私有 Node/npm 缓存、安装状态 | `%APPDATA%\AgentUsage-M1-Quota\agent-tools` |

退出应用后删除这两个目录，可清除默认位置的应用统计、连接凭据、CLI home、安装和界面存储；自定义数据目录须另行清理。此前明确应用到外部 Agent 的配置和所选根目录中保留的 Skill 副本不会随之撤销，应在对应位置处理。应用不会删除你的原始 Agent 记录；删除应用目录也不等于退出外部客户端或浏览器账号。

统计导出功能只输出上述白名单字段，不包含原始记录、原始会话 ID、工作目录或身份信息。

费用页的 CSV 导出由主进程用本机统计快照重新计算，每个模型或 Agent 一行，只含聚合后的 Token 与估算数字，同样不含会话 ID、工作目录或任何路径。

费用页"订阅对照"里填的订阅月费由你本人输入，作为采集偏好的一部分保存在本机（同一目录的 `preferences.json`），只记每个 Agent 一个美元金额；不读取任何账号或账单，也不随统计导出。

## 项目、预算与来源诊断

费用、来源和会话页的分析只对已保存的规范用量与会话元数据聚合。其接口返回项目名、不透明分组键、用量/估算、来源能力与受控诊断，不返回工作目录、原始会话/调用 ID、配置映射或逐文件索引。项目 CSV 由主进程重建，只包含项目名、日期范围与聚合数字，不含不透明分组键。项目名取目录最后一级，可能包含你自定义的名称。

预算（日/周/月/累计）与事项已知悉状态保存在同一应用目录的 `workbench.json`，不进入统计或项目 CSV 导出。它们只用于本机估算提示，不读取真实账单，不控制 Agent。重新估算读取本应用的规范用量和价格，不扫描来源、不更新用量账本或身份。详见[分析能力合同](m2/WORKBENCH-INSIGHTS-20261018.md)及[页面融合决定](m2/INSIGHTS-INTEGRATION-20261018.md)。

## 本地聚合查询

CLI 与 stdio MCP 只读取所选应用数据目录中的 statistics.json、billing.json、pricing.json、model-pricing.json，复用 GUI 的计价核心。它不实例化会迁移写盘的 Store、不采集、不启动 tokscale/Agent/额度服务，不监听 HTTP/TCP，不下载价格。不会访问 preferences、workbench、来源配置、原始日志、会话 sessions 元数据或逐文件索引。文件损坏时查询受控失败，不隔离或修复。

查询 revision 仅由计算依据指纹、筛选、时区及公开聚合结果形成；不是原始账本、路径或会话/记录身份的散列。它用于拒绝跨版本分页，不提供身份查询、旧快照保存或新数据访问。读取器与 Store、来源/会话读取模块无依赖；旧的悬空计费目标保留为未定价，不自动修正规则或写回文件。

来源与额度概览只投影已在内存中的来源能力、读取状态和额度连接数量/新鲜度。该接口不返回账号 ID、备注、计划、额度窗口或凭据，不启动来源发现、采集、额度刷新或登录。它独立于 usage_query，不改变四文件查询合同；本轮没有 GitHub 账号接入或远端请求。

响应逐字段构造，仅包含固定维度和聚合数字；会话数只由已有不透明 sessionKey 在内存去重，不返回该键。模型/服务商只允许有限长度标识字符串，无效元数据日期不回显。没有路径、原始身份、配置映射、文件索引或项目。错误只给受控码，不回显参数、路径、堆栈或原文。进程内护栏拒绝常见写入、网络监听/连接和子进程；它不是 OS 沙箱。详细限额和一致性见[查询合同](m2/SAVED-QUERY-20261018.md)。

别名建议只使用已有价格目录与用户费率；选择候选本身不保存，明确保存才修改应用自己的 billing.json。费率/倍率也只改本应用的设置，不改任何 Agent 配置。早期[配置健康探索](m2/CONFIG-HEALTH-EXPLORATION-20261018.md)是历史记录；当前显式检查和管理入口遵循上文的[配置管理合同](m2/AGENT-CONFIG-CENTER-20261022.md)。

## 已知的隐私相关限制

- `docs/m1/DESKTOP-UI-BASELINE.md` 记录了界面参考来源；其中引用的公开主页属于设计参考，未复制进 fixtures 或可分发源码。
- 界面中的"个人资料"（名称、简介、头像）保存在浏览器 localStorage，仅本机使用，不上传。默认值不含任何个人信息，请在首次使用时自行填写。
- 应用无自动更新、无遥测、无崩溃上报。
