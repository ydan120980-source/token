# Agent Usage 会话交接：M1 完成状态与 M2 起点

交接时间：2026-10-04，Asia/Shanghai。目的：用户转移至新会话继续第二阶段开发。本轮仅整理项目上下文、推进进度及持久记忆，不启动云服务、iOS 构建或新 provider 接入。

## 1. 新会话先读这些

1. 工作区 `E:/project/My_project/项目测试/codex/token` 的 `AGENTS.md`：当前权限、唯一入口、测试与 subagent 规则。
2. 本交接文档：当前有效决策、最新版本、遗留问题和 M2 待决策项。
3. `docs/m1/UI-POLISH-20261004.md`：最新实现与自动验收。
4. `docs/m1/DATA-CONTRACT.md`、`docs/m1/CRYPTO-EXPERIMENT.md`：同步可复用的数据边界和实验限制。
5. 涉及额度时再读 `docs/m1/CODEX-QUOTA.md`、`QUOTA-STABILITY-20261003.md`；涉及计算与费用时再读 `USAGE-PRICING-20261003.md`。

读取顺序优先当前源码、最新报告，旧研究和旧阶段记录仅作为历史。不要把早期文档中的“暂不写代码 / 未开始实现”、旧 GUI 路径、旧测试数量、旧价格或旧 ZIP 交付形态当成现状。

## 2. 产品目标与用户已确认需求

- 产品目标：Windows 采集本机 agent 用量，在外网通过 iPhone 查看统计和可接通的账号额度。
- iPhone / iOS 优先；手机只查看，不远程发任务、控制终端、改文件或切账号。
- 只同步统计，要求端到端加密，云端不能读取统计内容；不上传提示词、代码、回复、标题、认证或 provider 凭据。
- 希望逐步覆盖常用国内外 agent，订阅和按量 API 都关注。全面覆盖是方向，不代表每个工具都能提供同样的 token、额度和账单数据。
- 首批本机来源：Codex Desktop / CLI、Claude Code、OpenCode、WorkBuddy、MiMo Code。
- 真实账号额度首批只接 Codex，跑通后逐个扩展；Claude、Cursor、Trae 等账号接入未执行。
- 暂按个人自用。云区域/月预算、iOS 构建资源与分发、配对/恢复机制尚未确定。

必须分开：本机观测 token、账号级活动、订阅剩余额度、API 等价估算、服务商费用和最终账单。不能用 token 反推订阅剩余；不能把估算称为实际付款；unknown/null 不能显示为零；账号归属未知时不能归到当前登录账号。

## 3. 本会话推进过程与有效决策

| 推进段 | 已完成或确认 | 当前限制 |
| --- | --- | --- |
| 需求与 GitHub 调研 | Nowdex、tokens.ci、token-monitor、Tokscale、ccusage、TokenTracker、Win-CodexBar、Happy、HAPI 等对比；需求/来源/字段研究保留 | 版本与价格来自当时快照，M2 选云/iOS/依赖需重新核查 |
| 治理与 M1 基线 | 精简治理，保留边界/证据/验收；固定 token-monitor 与 Tokscale；实现五来源、本地合同、价格、持久化和合成加密实验 | 不启用完整 GitHub 事件链，不以计划记录授权后续阶段 |
| 桌面视觉与交互 | 初始桌面参考 tokens.ci 个人页，随后整体改为 Nowdex Mac 风格；四页、资料编辑、热力图、趋势、筛选、来源和导出 | 用户说的 Codex 个人资料指 Codex 应用内页面；不要再误认为 tokens.ci |
| Codex 账号额度 | 官方 CLI app-server、独立 CODEX_HOME、keyring-only、多连接 UI、剩余窗口/重置/更新时间、刷新/取消/移除 | 新增 provider、账号切换、重置权益消费、API 账单未做 |
| 稳定性与清理 | 队列/超时/退避/生命周期、压力检查；退役旧 GUI 和无引用的上游模块，五来源采集接入新界面 | 唯一产品入口是 src/quota/main.js，禁止自动恢复旧 GUI |
| 计数/费用修订 | Codex 优先逐请求 last usage；当前费率范围、未定价原因、手动价格规则、维护预览/备份/原子重建 | 本机历史与用户 tokens.ci 个人页的覆盖差额尚未充分解释，不能补猜测数据 |
| 活动图与全局动效 | 修复范围/图表交互；共享 motion、弹窗中断、键盘/焦点、reduced/off、卡片稳定更新 | 不宣称与 Nowdex 未展示的原生行为逐帧一致 |
| 数字细节与最新优化 | 估价改为原数字悬停展开范围；有界自定义选择菜单；留白；数字/滚动加减速；滚轮边界传递；功能顶栏 | 大数据同步重绘和人工手感仍有待改进 |

后续用户指令覆盖早期限制：原 M1 的“本阶段不接真实额度”后来追加了 Windows Codex 额度授权；原动效计划的“数字直接更新，不滚动计数”后来明确要求数字加减速，现在已实现。菜单最后一次更正是“文件/编辑/视图/帮助不适用”，当前使用 **统计 / 外观 / 关于**，不要恢复通用编辑器菜单。

## 4. 当前架构和接入位置

栈：Electron 43.4.0、普通 JavaScript/CSS、Web Animations API、Chart.js 本地 vendor、原子 JSON 存储；没有 React/Tauri 或新增业务数据库。Tokscale 固定 4.17.0；`sql.js` 1.14.2 用于源数据库内存读取。Node >=22.15，当前工具为 Node 24。

上游 provenance：token-monitor v0.65.0，提交 `db325fdf46ea7f7328feeb47a4f2005fe339909f`；MIT 与来源说明保留。当前项目已收敛并移除大量未使用上游功能，不能当作未经修改的 token-monitor。

| 文件/模块 | 职责 |
| --- | --- |
| `src/quota/main.js` | 唯一 Electron 入口、主进程权限、两个服务、IPC、窗口生命周期 |
| `src/quota/preload.js` | 白名单 bridge，renderer 不直接读文件或凭据 |
| `src/quota/service.js`、`rpc.js`、`contract.js`、`errors.js` | 独立账号/CLI、请求队列、账户额度合同与安全错误 |
| `src/quota/window-shell.js` | 统计/外观/关于原生菜单、展示状态及主题 IPC |
| `src/m1/policy.js`、`sources.js`、`sqlite-memory.js`、`normalize.js` | 只读五来源、源数据库内存映像、归一化和字段语义 |
| `src/m1/service.js`、`worker.js` | 采集、15 秒刷新、整轮 60 秒超时、30/60/120 秒退避、维护流程 |
| `src/m1/store.js`、`pricing.js`、`prices.json` | 自身 JSON 持久化、公共日汇总合同、固定/手动价格、覆盖率/上下界 |
| `src/m1/crypto.js` | 仅实验，当前 Windows 生产包明确排除，不是已接通的同步服务 |
| `design/desktop-reference/index.html`、`preview.js`、`quota-ui.js` | 当前实际产品界面，不是另外一个 GUI |
| `local-snapshot.js`、`usage-math.js`、`chart-ui.js` | renderer 安全投影、时间/统计数学、图表 |
| `motion.js/css`、`detail-interactions.js`、`select-ui.js` | 全局动效、中断、数字/滚动、选择菜单 |
| `window-shell.js/css` | 融合顶栏、页面历史/滚动恢复、侧栏、主题 |

默认统计目录 `%APPDATA%/AgentUsage-M1`，包括 statistics/preferences/pricing/validation 与自身备份。默认额度和 Electron userData `%APPDATA%/AgentUsage-M1-Quota`；连接的随机 ID 对应独立 `codex-homes/<id>`。测试始终显式传入 `--usage-data-dir`、`--quota-data-dir`、`--m1-fixture-root`，不得使用真实默认目录做维护测试。

主进程与 renderer 当前离线；只有用户发起的官方 Codex 专用子进程执行授权/额度网络。M2 同步将改变网络边界，应设计最小网络能力，保留采集离线能力，不能简单去掉现有网络禁用或恢复上游 Hub/Worker。

## 5. 本机统计、额度和同步合同

### 本机统计

`Store.snapshot()` 输出 `UsageSnapshotV1`：随机 deviceId、递增 sequence、采集/生成时间、IANA timezone、覆盖起点、每日 agent/entry/provider/model 统计、字段语义、费用上下界/覆盖/原因、价格版本/hash、来源状态。

本地 `statistics.json` 是私有持久层，含盐、匿名会话/记录标识；不能直接上传。公共快照不含标题、正文、代码、路径、机器名、邮箱、凭据、原始会话 ID。SourceCapability 是来源状态合同；真实标记只表示选定样本验收，不是跨版本全面支持。

renderer 接收的是 `LocalUsagePreviewV1` 安全投影（`local-snapshot.js`），不是原公共合同。M2 必须明确选定/版本化同步白名单，不把 UI 投影、私有存储和同步载荷混为一体。来源错误与自定义标识也应重新审计。

缓存/推理保持原义：output 包含 reasoning，不能重复相加；inputUncached 不含缓存。缺失字段为 null，已知零保持零；来源冲突/不完整保留最后有效历史。复制、归档、累计、fork、父子、共享数据库按当前稳定记录规则去重，不每轮累加。

费用为 USD 的 **API 等价估算**。当前 provider/model 精确匹配，缺规则/缺字段未定价；范围显示上下界，未知部分不当免费。设置支持手动规则、撤销及历史重新计算。内置费率不是自动在线更新，不应在新会话沿用历史调研价格当作当前官方价格。

### Codex 额度

与 UsageSnapshot 分开的 `AccountQuotaV1`；优先 rateLimitsByLimitId，兼容 rateLimits；剩余为 100-used（下限 0）；窗口不能相加；重置时间过去不能自动填满，必须再读取。

仅官方 CLI app-server 方法白名单：initialize、config/read（有效 keyring 校验）、account/read、account/login/start（chatgpt）、account/login/cancel、account/rateLimits/read、account/logout。无 thread/turn、工具调用、重置消费或账号切换。

官方 CLI 使用本机已有 codex.exe，不捆绑、不自动下载。历史核对 CLI 0.160.0，不代表当前版本永远相同。独立 CODEX_HOME、有效配置强制 keyring，无明文 fallback；不读取其他客户端认证，不导入 JWT。缓存不含邮箱/token/登录 URL；服务账号 ID 只在主进程内存。已有连接与独立历史验收连接保留，不自动 logout 或清除。

自动额度刷新每次启动默认关闭，可选 5 分钟；主进程串行队列，普通错误冷却 60 秒，结构化限流 15 分钟，手动也不跳过。失败保留最后成功值；重启/超过10分钟标历史；最近尝试、成功、缓存年龄分开。

### 加密实验及 M2 必须补齐的部分

实验 AES-256-GCM：32-byte 随机密钥、12-byte nonce、16-byte tag；AAD 为固定顺序 header（protocol/deviceId/sequence）的 JSON UTF-8；header.protocol 为 `M1-CRYPTO-EXPERIMENT/1`。独立 sender/receiver 进程验证正确解密、错误密钥、头部/密文篡改、旧序号与重复拒绝。

**highest 仅在接收进程内存，未实现重启后的持久防回放。** 没有配对、密钥管理、分发、恢复、撤销、生产 nonce 策略、真实同步或 iPhone 互操作。向量不含密钥，仅可做格式检查；需要解密互操作时重新生成合成密钥，并通过批准的本地测试渠道传递，不能发到聊天或写入仓库。AAD 序列化与 Swift/CryptoKit 互操作需规范化并单独验证。

## 6. 最新界面与动效状态

- 四页：额度监控、用量、来源管理、设置。默认简体中文、Nowdex Mac 式浅灰背景/白卡片/留白，深色模式；本地 Geist/GeistMono。
- 今日/最近7天/最近30天/累计，agent/model 筛选，图表 Token/费用、原始/滚动平均/累计总量等；热力图、日期详情、星期活动、模型和来源明细。
- 资料编辑有姓名/本地头像；头像不随 UsageSnapshot 同步，M2 若需要跨设备资料要另定白名单。
- 数字 **760ms sine-in-out**，最多约30Hz替换可读文本、内部 RAF 连续；重复同目标不重启，变目标从当前值续接。减少/关闭动态不进行数字滚动，未知不先变零。
- 金额悬停在原位置展开上下界，字号/命中区域固定；取消重复 hover/focus/click 重播。键盘行为保留。
- 跳转滚动520–900ms，加减速，可由用户滚轮/指针/键盘中断；切页/选同范围不重复入场。
- 共享 full/reduced/off，设置跟随系统/减少动态/关闭；系统减少动态不可被覆盖，reduced无位移缩放旋转，淡入最多80ms。
- 长 Agent/模型列表有界，短列表滚动页面，长列表在边界向页面传递；选择菜单内部隔离/有界，不恢复过长原生 select 的视觉表现。
- 顶栏44px，侧栏/历史/当前页 + **统计/外观/关于**，右侧 Windows 原生窗口按钮；800×600 下分层布局。快捷键 Ctrl+R/E/B、Ctrl+,、Alt+←/→。
- 参考 Nowdex 可观察网页效果和 Apple 原则，不做 Liquid Glass 改版，不宣称完整原生 Mac 逐帧复制。apple-design skill 已用，本轮不安装或覆盖全局 skills。

## 7. 交付版本与 Git 状态

最新可运行交付：`dist/polish-20261004/win-unpacked/Agent Usage Quota.exe`，本地未签名0.1.0，**必须保留整个目录**。

配套 `AgentUsage-CodexQuota-source.zip`、`AgentUsage-CodexQuota-delivery.json`、`SHA256SUMS.txt`。Windows目录84文件、415,013,249 bytes；源码 ZIP155文件、1,639,542 bytes。源码 ZIP不含依赖、真实输入、凭据、统计、备份、日志、缓存或 artifacts。

- 源码 ZIP SHA-256：`9e0af7b0cc9905bbe79a3ebff9a89592580e0a920650c3ea90b6c9cf724a9148`
- Windows目录树校验：`f9b137ed67e9271b3428e2e5c979ea9bc2f9cc39e21a7695cc2fb1ee6ae6dd62`（按 package-quota.py 的文件名/大小/hash算法，不是exe单文件hash）。

2026-10-04 复核修正：`dist/` 实际仅保留 polish-20261004 一代；此前“上一代 detail/motion/activity-fix/activity/nowdex/pricing 按代保留”的描述与实际不符（旧代何时/为何被清未留记录），此句以本修正为准。旧 M1 GUI/早期退役包按先前用户指令删除，不自动找回。当前不永久重复保留 Windows ZIP，跨代相同 runtime 用 NTFS 硬链接，`dist:share` 做逐字节/hash验证。构建下一代必须用新输出目录，不能原地修改共享文件。历史 manifest 的“~156 MB”是早期估算，不是当前整包大小。

本次交接新增文档不重写已冻结的交付 ZIP，也不改已打包的 CODEX-QUOTA/UPSTREAM。旧源码 ZIP是交付时快照；本交接文件位于工作区 `docs/handoff/`，需要单独保留。

2026-10-04交接核查：分支 main；HEAD `214facd`（最初M1交付）；基线 `f156470`（固定上游与研究）。添加交接文档前工作树有 **1,072 条状态记录**，加入本交接目录后为1,073条，包括经过授权的删除、后续新模块与未提交维护，不是干净仓库。当前最新版本远多于HEAD；不要 git reset/clean/checkout 恢复工作树，不能仅凭HEAD重建最新产品。未自动commit/push；后续要建新分支使用 codex/ 前缀，并保留现有工作树。

## 8. 已验证、历史真实验证与尚未验证

### 最新包的合成自动验证

- verify：ESLint +55单元测试通过。
- native：Tokscale4.17.0、6合成记录/694token、只读、Node网络尝试0。
- stress：16万SQLite记录重复采集、8千WorkBuddy记录、200并发刷新、20合成账号/1000批次、2000分片RPC、2万行统计数学六场景通过。
- 两个独立测试进程的合成crypto通过。
- source/packaged/extracted：polish、detail、motion、usage、quota、visual、activity、UI stress；100%/150%强制缩放，浅深色/800×600、快速操作、焦点、弹窗、滚轮、菜单路由和系统减少动态通过。（时点注记：此为当时验收所用的历史代际包名记录，非当前 dist/ 现状——当前仅存 polish-20261004，见上文复核修正。）
- runtime图30可达模块、唯一入口；ASAR78源码/资产/说明逐字节相等；独立中文/空格路径Windows84文件与原包相等；源码ZIP CRC/155当前文件相等，解压源码使用当前工作区依赖verify通过（不是全新干净安装）。
- 本轮测试窗口已退出；没有新真实登录、额度查询或logout。

证据：`artifacts/polish/` 的final日志、source/packaged/extracted；`artifacts/maintenance/`、`artifacts/quota/`、`artifacts/motion/`等历史/共享输出。artifact非源码输入，后续测试可能覆盖共享文件，重要结果按代保存。

### 历史真实核对

M1五来源选定样本有独立账本核对（不是当前各版本全面认证）。初期全扫描发现Codex total冲突和WorkBuddy reasoning异常，报告partial并不计价。后续Codex v2做独立真实匿名账本核对；用户tokens.ci更长覆盖的差额未全部解释。细节见ACCEPTANCE（历史）与USAGE-PRICING。

初始Codex额度阶段用户曾选择暂缓登录；随后稳定性阶段**一次真实单账号**官方登录、用户对照、重启/手动刷新与5分钟自动批次有历史验收（QUOTA-STABILITY及history记录）。真实logout延期，连接保留。最新polish维护包没有重复这些真实验收，不能自动推广。真实多账号、logout后的其他客户端隔离仍未验证。

### 仍待处理或人工验收

1. 2万行/100模型切范围同步重绘最大约334–364ms；full约340–350ms，存在主线程阻塞。端到端895/908ms包含760ms呈现，不能把它等同计算耗时。UI stress启动2520/2534ms，20并发投影3149/2869ms。下一阶段若动到数据层需继续避免放大此瓶颈。
2. 上一轮一次窗口关闭错误（Target page/context/browser closed）根因未定位；本轮未复现，已保留诊断。不允许靠force click、跳过或关闭测试放行。
3. 原生按钮物理点击、标题栏拖拽/Windows吸附、新版真实显示器手感、数小时持续运行、真实休眠恢复、全新机器安装/SmartScreen未完成本轮人工验收。强制缩放不能代替物理DPI验收。
4. 完整原生子进程syscall/网络抓包未做；零Node网络尝试和结构边界不是内核级审计。
5. 配对、外网同步、生产密钥、防回放持久化、iOS真机全部未做。不得称现有实验为生产E2EE。

## 9. 第二阶段建议起点（待新会话确认具体范围）

用户现在提出继续第二阶段；当前明确的长期目标是Windows → E2EE外网同步 → iPhone只读。具体M2拆分、云选型/付费/部署/iOS分发没有批准的执行计划，不能由旧研究建议或本交接文档自动授权。

建议新会话先完成当前源码的短只读核查与M2范围定义，之后实现获准的部分；无需重新从头做M1或换Electron底座。可考虑以下顺序，均为建议，不是已执行：

1. 冻结最小同步白名单与版本：UsageSnapshot日统计、采集/来源质量/过期状态；Codex额度若本阶段需要同步，单列安全合同，不同步备注中的个人信息或任何provider凭据。
2. 定义配对、设备身份、writer/reader权限、密钥轮换/撤销/恢复、持久防回放与nonce/AAD规则；写跨平台合成向量，并验证Windows与Swift/CryptoKit互操作。
3. 先实现可撤销的本地合成闭环/模拟不可信relay，验证服务器仅见密文与必要元数据、篡改/重放拒绝、断网补传/重复幂等。原离线采集不依赖网络成功。
4. 确认云区域/预算/账户、可访问性和保留策略后再部署获准的relay；电脑主动写，手机只读权限不能写/删/管理。
5. 确认Mac/Xcode/iPhone/Apple开发者账户与分发方式，再做iOS界面和真机；保留Nowdex审美及Apple交互，不能用Windows浏览器模拟冒充iPhone验收。
6. 验收外网/蜂窝、电脑离线/休眠、手机离线缓存/后台恢复、过期时间、重装/重新配对、设备撤销；目标60秒仅是待测目标。

新会话最关键的缺失信息：M2先做同步协议还是连同iOS；云部署区域和月预算；Mac/Xcode与iPhone构建测试资源；个人开发/TestFlight/公开发布方式；额度是否纳入首版同步；手机重装和丢失时的密钥恢复偏好。这些应在影响对应工作前确认，其他可逆细节继续自主推进。

远程控制、账号切换、其他provider、重置额度消费、autostart、公共排行、Android和商业化不是M2默认范围。

## 10. 执行、测试和安全恢复提示

- 禁止不经单次批准启用subagent。每次必须告知角色/精确模型/推理强度（明确或继承）、任务、读写权限、owned files、输出和预算，等待明确答复。
- CodeGraph先前不可用，已采用针对性源码/测试；新会话若有工具且仓库indexed按AGENTS先查，否则记录限制，不安装新全局工具来绕过。
- 实际WindowsPowerShell；Node/npm `E:/ai/node.exe`、`E:/ai/npm.cmd`；Python `C:/Users/yudan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe -X utf8`。不使用StorePython别名。
- 保留原始源、应用数据、历史连接、研究、未关联改动。测试使用独立home，不输出密码、token、认证URL、原CLIstdout/stderr或原日志正文。
- 临时`.cache/polish-delivery-check`仍保留合成解压验证材料；不是业务数据。不要因交接自动递归清理。任何后续删除先核对绝对范围、所有者/进程和重建性；遇到自动审批拒绝不得用另一shell或Python绕过。
- `docs/m1/CODEX-QUOTA.md`、UPSTREAM属于ASAR白名单，编辑后必须随新一代重建并audit；不改文件后继续声称旧包与当前源码一致。
- 构建/归档先核对package.json脚本。更新到新目录，保留上一代；源ZIP白名单排除runtime/真实输入/凭据/缓存/logs/artifacts；校验后再交付。

常用命令（在工作区；依赖已存在）：

```powershell
& E:/ai/npm.cmd run verify
& E:/ai/npm.cmd run test:native
& E:/ai/npm.cmd run test:ui
& E:/ai/npm.cmd run test:quota:ui
& E:/ai/npm.cmd run test:stress
& E:/ai/npm.cmd run experiment:crypto
& E:/ai/npm.cmd run test:polish:ui
& E:/ai/npm.cmd run test:detail:ui
& E:/ai/npm.cmd run test:motion:ui
& E:/ai/npm.cmd run test:visual:ui
& E:/ai/npm.cmd run test:activity:ui
& E:/ai/npm.cmd run test:stress:ui
& E:/ai/npm.cmd run audit:runtime
& E:/ai/node.exe scripts/m1/audit-package.js dist/polish-20261004/win-unpacked
```

验证旧包可设 `$env:QUOTA_PACKAGED_EXE` 为完整exe路径，各UI脚本会创建合成独立目录。注意每个PowerShell工具调用未必保留上次环境变量；同一调用中设置并运行。无需为了只读接手再次跑全套；实现M2后按受影响范围和项目要求验证。

完整读后即可在新会话接续，不需要用户重述之前的布局选择或重做基础采集。
