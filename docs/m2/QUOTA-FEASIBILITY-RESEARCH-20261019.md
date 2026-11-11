# Agent 额度可行性、会员生命周期与参考实现研究

核对日期：2026-10-19，Asia/Shanghai。基础为本地 main 的来源/额度状态对齐增量。本轮仅研究公开文档与公开源码并记录结论；当前程序仍只有 Codex 账号额度接入。研究提出的模型、优先级和验收用例均尚未实现，不代表所有来源已具备可发行的额度监控能力。

## 结论与推荐顺序

额度必须归属于实际服务商账号、组织/项目和资源池，Agent 只是消费入口。同一个 Agent 能接不同服务，一个服务的额度也可能被多个 Agent、设备和网页共同消费。已有来源管理负责本机用量；它不能自动取得账号全局余额。

推荐先扩展现有 Codex 额度合同，使其容纳可缺失窗口、多资源池、积分/金额余额、会员资格及逐项新鲜度；随后优先验证 Antigravity 官方 CLI 的结构化只读出口。WorkBuddy 同期完成官方接口与应用资格评估，但正式授权服务端方案需要另行决定。Claude、Go、ZCode 等按证据与授权条件逐项接入，不承诺十个来源同时可用。GitHub 只读项目监控的产品方向继续保留。

三个必须修正或细化的前提：

- **Codex Pro 当前没有五小时限制。** 当前官方英文定价页明确如此；旧翻译和旧索引仍有过去的说明，不能拿历史套餐表生成窗口。Plus/Standard Business 的五小时参考与可能的周限制另列。[官方定价](https://learn.chatgpt.com/docs/pricing)。
- **WorkBuddy 是积分账本。** 会员终止、周期积分刷新、加量包到期和活动积分失效是不同事件，不能用本地 token 数推算。[官方套餐与用量](https://www.workbuddy.cn/docs/workbuddy/Usage)、[加量包与有效期](https://www.workbuddy.cn/docs/workbuddy/Pricing)。
- **Antigravity 的模型数不等于额度池数。** 官方当前模型页展示 Gemini Models 与 Claude and GPT models 两组，后者含 GPT-OSS；没有据此证明 Claude 和 GPT 各自独立一池。以实际服务端分组为准，不能按品牌拆分。[官方模型与额度分组](https://antigravity.google/docs/models/)。

## 十个现有来源的可行性

“有官方查看功能”“有第三方实现”和“本程序已接入”是不同证据等级。以下没有任何新来源的真实账号验收。

| 来源 | 额度实际归属与单位 | 目前查实的读取证据 | 当前判断 |
| --- | --- | --- | --- |
| Codex | ChatGPT 账号/工作区；可空窗口、不同 bucket、额外 credits、重置次数 | 官方 app-server 的 account/read、account/rateLimits/read；产品已使用此路线 | 先完善现有合同，不能把 primary 固定称为5小时 |
| Claude Code | Claude 订阅共享窗口；另有额外使用、API 账单 | 官方状态行输出 rate_limits；独立查询的 OAuth/Web/PTY 是第三方路线 | 可研究显式启用的被动导出，暂不承诺独立全天后台查询 |
| OpenCode | Go/Go Plus、Console/Zen、外部订阅或 API | Go 官方有按模型5小时/周/月限制；Orca/CodexBar 有 usage API 实现 | 先识别服务类型，不能做一个统一 OpenCode 总额度 |
| WorkBuddy | 个人/企业、国内/海外；积分资源包 | 官方个人 credit 只读接口；XD Pool 有私有 billing 分包查询 | 官方聚合有望接入；分包有效期与授权条件仍有缺口 |
| MiMo Code | MiMo API 金额或 Token Plan Credits | 官方集成说明；CodexBar 有平台查询参考 | 有候选路径，官方第三方只读认证合同未建立 |
| Gemini CLI | Google 登录/API key/Vertex/Workspace，可能按用户或项目 | 官方 /stats model；第三方内部 quota API | 先核对认证模式、迁移状态和非交互能力 |
| Cursor | 新订阅周池、额外预付余额；旧计划月双池与按需消费 | 官方规则说明；CodexBar 网页读取参考 | 必须识别新旧计划，不固定为500请求或单一月金额 |
| ZCode | Z.ai/BigModel Coding Plan 的5小时、周、月工具池 | 官方端内远端额度页；Orca/CodexBar 解析实现 | 可行候选，先解决区域、计划和认证合同 |
| DeepSeek Harness | 取决于上游；DeepSeek API 可读币种余额 | DeepSeek 官方 user/balance；不覆盖 Harness 所有路由 | 可评估独立 DeepSeek API 余额适配，不能叫 Harness 通用额度 |
| Antigravity | 账号/套餐的模型组与窗口，另有 AI credits | 官方 CLI 非消费结构化命令；Orca/CodexBar 解析 | 通用合同之后，优先做第二个来源的可行性验证 |

### Codex：窗口可空，重置次数不是购买余额

官方 app-server 支持 rateLimitsByLimitId，多 bucket 各自有可空 primary/secondary、实际 windowDurationMins、resetsAt 及可选 credits、planType。rateLimitResetCredits 是 earned-reset 库存，有独立有效期，不是购买的 credits。[官方 app-server](https://learn.chatgpt.com/docs/app-server)。

当前源码 src/quota/contract.js 没有硬编码300分钟，并已跳过缺失窗口；它也支持多个 bucket。因此不应把现有实现描述为“所有账号固定五小时”。真实缺口是 AccountQuotaV1 主要承载百分比窗口与重置次数，不能完整承载金额/积分包、会员截止日或 credits-only 账户。src/quota/connection-state.js 目前要求存在 windows，未来不能据此把有效的余额型账户判作完全缺数据。

另发现 design/desktop-reference/quota-ui.js 的演示数据仍把“Pro · 示例”配成300分钟加每周窗口。这是需要随下一增量修正的过时示例；真实窗口标签按服务端durationMins显示，不能将两条路径混为一谈。修正示例时应补跑受影响的额度界面合成验收，本研究没有修改renderer。

保持官方 CLI 独立授权，不因第三方项目有网页接口而改读已有 auth.json 或解析 JWT。planType 只是计划标签；缺少到期字段时显示“会员到期时间未提供”。API key 计费与 ChatGPT 订阅额度分别表达。

### WorkBuddy：官方聚合读取与分包明细的取舍

官方公开接口 **GET https://www.workbuddy.cn/openapi/v2/credit**，权限 user.credit.readable，面向个人用户，返回 total_capacity_size、total_capacity_used；覆盖有效和用尽资源包，不区分订阅、加量、赠送包。只有两项均有效且口径一致时，才能计算该聚合口径的剩余值；不能由此还原包类型、每包到期日或未来发放量。[官方 Open API](https://open.workbuddy.cn/en/docs/openapi)。

官方第三方应用需要提交审核。当前授权文档要求 client_secret、服务端兑换及保存凭据；不能把发布者 secret 放进 Electron 安装包。尚未确认可免 secret 的桌面 public-client 路线，不能擅自创建凭据中转服务。文档总览与接口示例的 token 时效有差异，scope 总表也未完全同步；未来按实际 expires_in、已授予 scope 与平台确认实现。[官方第三方接入](https://open.workbuddy.cn/en/docs/third-party-app)。

官方说明会员到期未续费降级体验版，已生成内容保留；当前个人加量包有单独一个月有效期，到期未用积分失效。这不证明所有积分与会员同时清零，也不证明会员到期后所有加量包仍可使用；精确权限与包状态必须读取或明确标未知。[到期处理](https://www.workbuddy.cn/docs/workbuddy/Usage)、[加量包说明](https://www.workbuddy.cn/docs/workbuddy/Pricing)。

XD Pool 的 fetchCredits 查询 billing/meter/get-user-resource，按 CapacityType 区分周期包，读取 CycleCapacityRemain/CapacityRemain、CycleEndTime/ExpiredTime。可参考分包建模，但其实现只取第一页100条、未知数回退0，并用本地日期解析及 cycleEnd+1秒解释刷新；这些假设与本项目未知保留 null 的合同不相同，不能直接照搬。[固定提交源码](https://github.com/XDTrees/dsh-xdpool/blob/2def4d01509784c7ebc4fe9b5d860f12a398a64f/src/upstream.ts)。

### Antigravity：官方命令已有，仍须做 Windows 验证

官方发布记录 v1.1.11（2026-08-07）明确：print mode 的 /usage、/quota、/credits 等可输出结构化数据，不启动 Agent turn、不消费额度、不留下会话。官方 /usage 页面说明它刷新模型额度。[发布记录](https://antigravity.google/docs/changelog#v1111)、[额度命令](https://antigravity.google/docs/cli/commands/usage/)。

Orca 使用 agy -p /usage --output-format json，并检查最低版本；其源码特别指出加上 --disable-slash-commands 会使查询文字变为模型提示。解析采用 command.data.groups/buckets，保留 ID、模型组、窗口和 disabled，而非解析四舍五入的展示文本。这些是其实现/实测记录，不能写成本项目的 Windows 验收。[命令合同](https://github.com/stablyai/orca/blob/051708702c62367d1a9b91f68a5071bf8c21b21a/src/main/rate-limits/antigravity-usage-command.ts)、[结构化解析](https://github.com/stablyai/orca/blob/051708702c62367d1a9b91f68a5071bf8c21b21a/src/main/rate-limits/antigravity-usage-response.ts)。

官方套餐有不同刷新周期，部分只有周池；Pro/Ultra 还可按设置使用购买 AI credits 处理超额。基准池、超额开关、credits 余额及模型资格不能合成一个百分比。[官方套餐](https://antigravity.google/docs/plans)。未来验证须覆盖版本、账号归属、旧版本拒绝、无模型调用、CLI 启动插件/MCP 的副作用、输出边界、取消及子进程回收。无账户标识的本机报告只能标作该 CLI 当前账号，不能自动归给另一个已连接 Google 账号。

### 其他来源的关键差异

- Claude 官方状态行有独立可缺失的 five_hour / seven_day，且过 reset 会丢弃窗口。它在会话响应后出现，适合被动观察，不能从“有字段”跳到“有官方后台余额 API”。原始 JSON 还包含路径等信息，未来只能导出白名单额度字段。[状态行合同](https://code.claude.com/docs/en/statusline)。
- Claude 的订阅/额外使用与 Claude Platform API credits 分离。官方 Max/Team API 赠额规则说明，取消或降到不合资格计划后停止新赠额，已获余额仍可用至自身有效期；这是一项明确反例，说明“会员过期就把全部资源清零”不成立。[订阅额度](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)、[API credits 生命周期](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)。
- OpenCode Go/Go Plus 官方当前是每模型5小时/周/月约束，Use balance 可显式允许限额后转按量余额。OpenCode 调外部 Codex 或 MiMo 不会凭空产生一份 OpenCode 额度。[Go](https://opencode.ai/v2/docs/console/go/)。Orca 的 Go usage API 有 Bearer-key 读取，但公开规则页不等于第三方接口稳定性承诺；先核对正式支持条件。[参考实现](https://github.com/stablyai/orca/blob/051708702c62367d1a9b91f68a5071bf8c21b21a/src/main/rate-limits/opencode-go-usage-api.ts)。
- MiMo Code 官方同时支持按量 API 和 Token Plan，并引导在平台查看用量和有效期。应识别实际授权类型；平台 Credits、API 金额和本地 token 各自保留。[官方接入说明](https://mimo.mi.com/docs/zh-CN/tokenplan/integration/mimo-code)。第三方 cookie 查询参考不构成当前读取用户浏览器/认证文件的授权。[CodexBar MiMo](https://github.com/steipete/CodexBar/blob/6480977b47f6e4ffd5dcaae1cb0c7fdf34ee449e/docs/mimo.md)。
- Gemini CLI 官方按认证类型描述不同配额，并有 /stats model。非交互读取、个人/企业账户迁移及当前 API 权限仍需验证，不能仅靠同一个 Google 邮箱关联池。[配额](https://geminicli.com/docs/resources/quota-and-pricing/)、[命令说明](https://geminicli.com/docs/get-started/)。
- Cursor 当前官方同时说明新订阅周池与旧计划月双池；部分新资源与 Grok 共享，额外使用余额和月消费上限又是不同约束。规则代次必须保留。[官方规则](https://cursor.com/docs/models-and-pricing)。
- ZCode 官方把本地使用统计和 Z.ai/BigModel 远端计划分开，并有5小时、周、月工具池与有有效期的重置卡；区域及计划应隔离，监控不自动消费重置卡。[官方用量说明](https://zcode.z.ai/cn/docs/usage-stats)。
- DeepSeek 官方 GET /user/balance 返回币种、总余额、未到期赠送余额、充值余额及 is_available。非零余额不一定代表当前可调用，不同币种也不直接相加。该余额属于上游 API 账号，不覆盖 DeepSeek Harness 所有路由。[官方接口](https://api-docs.deepseek.com/api/get-user-balance)。该页面 web 工具抓取失败后，通过公共 HTTPS 获取页面并解析字段，没有调用余额接口。

## 四个用户参考与补充项目

| 项目 | 核对深度与快照 | 值得参考 | 适用边界 |
| --- | --- | --- | --- |
| Orca | README、额度查询/解析及部分 GitHub 限流源码；051708702c62367d1a9b91f68a5071bf8c21b21a | CLI结构化查询、独立资源池、实际窗口、错误分类与版本门禁 | 编排/执行型产品；不能复制其凭据读取、模型执行与Git写权限 |
| Todos | 公开 overview/providers/runtimes/github 文档 | Agent、运行时、账号、项目独立；连接撤销与重新连接 | BYO-PC/BYOK编排产品；本轮未建立其通用第三方额度采集证据，不把能运行订阅解释为能查余额 |
| XD Pool | README、upstream.ts及相关账号/状态源码；2def4d01509784c7ebc4fe9b5d860f12a398a64f | WorkBuddy资源包、余额和到期字段 | 含多账号凭据留存、转发、签到等；不作为本产品整体依赖 |
| AxonHub | quota types/normalization、Codex/Claude/Antigravity checker、状态schema、成本指南和NOTICE；8d3c3865dc642307cabe0950e241d2c231c08f42，unstable分支 | 服务商checker接口、资源窗口、共享账号归属、下次检查和错误建模 | 网关账单、上游额度、派生估计同时存在，必须逐路径筛选 |
| CodexBar | 文档及选定provider源码；6480977b47f6e4ffd5dcaae1cb0c7fdf34ee449e | 大量解析形态、独立身份/工作区、缓存与部分数据案例 | Swift/macOS实现；许多路径读cookie/OAuth/内部接口，不能视作Windows官方SDK |
| AIQuotaBar / quota-usage-monitor | 公开README；未做源码审计/运行 | Windows轻量展示、能力诚实表达、CLI路线 | 支持清单只是作者声明；AIQuotaBar明示Claude仅认证状态，不能据名称写成已支持其额度 |

Todos 的 GitHub 文档把账号连接、仓库选择和撤销恢复作为明确步骤，值得借鉴；它还自动推分支/合并PR，属于不同产品权限范围。本程序既定只读项目状态监控仍应按自己的合同推进。[Todos 概览](https://todos.dev/zh/docs/overview)、[GitHub](https://todos.dev/zh/docs/github)。补充项目：[AIQuotaBar](https://github.com/MDoots/AIQuotaBar)、[quota-usage-monitor](https://github.com/rozsazoltan/quota-usage-monitor)。

### AxonHub：有真实额度checker，也有不能直接采用的推导

源码的 QuotaChecker / QuotaData / Limits 是有价值的后端参考；状态schema另有 account_key 区分共享上游账号，避免把不同渠道当成独立容量。[类型合同](https://github.com/looplj/axonhub/blob/8d3c3865dc642307cabe0950e241d2c231c08f42/internal/server/biz/provider_quota/types.go)、[账号归属](https://github.com/looplj/axonhub/blob/8d3c3865dc642307cabe0950e241d2c231c08f42/internal/ent/schema/provider_quota_status.go)。

其中 EstimatePeriodQuota 用本渠道 PeriodCost / UsageRatio 估计周期总金额。这依赖消费覆盖完整且比例与金额同口径；本产品只有本地部分记录、其他设备也在消费时，不满足前提。它必须保持估算身份，不能用于剩余积分或到期计算。网关聚合成本也不是厂商账单。[推导源码](https://github.com/looplj/axonhub/blob/8d3c3865dc642307cabe0950e241d2c231c08f42/internal/server/biz/provider_quota/types.go)、[成本指南](https://github.com/looplj/axonhub/blob/8d3c3865dc642307cabe0950e241d2c231c08f42/docs/zh/guides/cost-tracking.md)。

Claude checker 会向 messages 发 POST，携带用户消息与 max_tokens:1，再取限流响应头；这构成模型请求，不能未经额外证据就当作零消耗的只读余额查询。本程序不采用此类主动模型探针。Codex checker 的私有网页接口及重置消费动作也不替换现有官方 CLI 路线。[Claude checker](https://github.com/looplj/axonhub/blob/8d3c3865dc642307cabe0950e241d2c231c08f42/internal/server/biz/provider_quota/claudecode_checker.go)、[Codex checker](https://github.com/looplj/axonhub/blob/8d3c3865dc642307cabe0950e241d2c231c08f42/internal/server/biz/provider_quota/codex_checker.go)。

许可证也不能只看仓库徽标：AxonHub NOTICE 说明一般目录 Apache-2.0、llm/ 为 LGPL-3.0，文件头条款可优先；未来若复制代码必须按实际文件核对并保留声明。本轮仅静态研究，没有复制其实现进入产品。[NOTICE](https://github.com/looplj/axonhub/blob/8d3c3865dc642307cabe0950e241d2c231c08f42/NOTICE)。Orca、XD Pool、CodexBar快照的根许可证为MIT，仍须检查拟复用文件和依赖声明。

## 下一增量的数据合同草案

以下是研究建议，未修改运行时schema或读路径。

| 对象 | 必须表达 | 约束 |
| --- | --- | --- |
| 消费入口 | agent/source、具体服务类型、关联状态 | 一个入口可有多个账号，一个账号可被多个入口使用 |
| 额度主体 | provider host/region、经确认的账号、组织/项目、池身份 | 不凭邮箱或模型名认定同池；无法确认归属时标“CLI当前账号/未验证归属” |
| 会员资格 | plan、active/trial/grace/expired/unknown、观察时间、可选有效期、取消生效时间 | 缺失有效期不推算；取消续费不等于已到期；计划变更建立新观察基线 |
| 资源池 | 服务端bucket ID、适用模型/功能、scope、单位、是否共享 | 模型组和展示名可变，不能靠名字拆成独立容量 |
| 窗口约束 | rolling/fixed/calendar/unknown、实际时长、开始/重置时间、百分比或绝对数 | primary/secondary保留源角色；多个约束通常需同时满足，不做百分比加总 |
| 积分/金额包 | reported total/used/remaining、unit/currency、validFrom/expiresAt、包类型、reserved及可用性 | 金额用十进制字符串/安全定点；Credits不可混币种、厂商、计价代次相加 |
| 观测状态 | official/undocumented/CLI-observed/local-estimate、接口/版本、fetchedAt、lastAttempt、逐池freshness与partial | 来源和有效期可独立未知；一项成功不覆盖失败兄弟项 |
| 补充容量 | 超额开关、消费上限、可选购买余额、是否允许fallback | 余额存在不等于可用，不自动开启按量计费、充值或兑换 |

必须区分 unknown、not-reported、not-applicable、disabled、exhausted、unlimited。无窗口不能直接译为无限、0%已用或100%剩余；只有明确服务端字段才能表示无限。用于显示的裁剪不得抹去异常观测，异常结构进入受控错误或partial。

同一资源池上的5小时和周限制是并行约束；订阅额度耗尽后可转购买余额则属于提供商确认的替代容量。分别建模约束与替代关系，不用“取最大剩余”“全部相加”生成总体额度。GitHub API 的 core/search/graphql 请求预算另属网络读取限额，不与Agent订阅池合并。[GitHub限额接口](https://docs.github.com/en/rest/rate-limit/rate-limit)。

## 会员过期与刷新状态机

| 事件 | 正确处理 | 不应推断 |
| --- | --- | --- |
| 用户关闭自动续费 | 若服务端仍active，保留当前权益及已知结束日 | 立刻降级或余额清零 |
| 到达已知会员结束日、尚无新响应 | 会员观测到期待核验；相关可用额度标待核验，尽快重读 | 已续费成功、永久失去资格或自动补满 |
| 新响应明确降级/计划变化 | 发布新资格及完整资源集合；旧计划池保留为历史，不能继续当可消费余额 | 重定价过去使用记录；把新旧grant混算 |
| 额度窗口到重置点 | 只标窗口待刷新；其他未过期包可保留其自身状态 | 根据时钟把剩余改100% |
| 积分包到明确expiresAt | 该包已知有效期已过；从当前可用投影剔除/标待核验并保留原观测历史 | 把同账号其他包和本地使用历史一起清零 |
| 服务端总量突然减少 | 记录新快照；可能是包失效、退款、计划调整或消费，未知原因不分类 | 差值全部算成新增消耗 |
| 401/invalid_grant | 认证需恢复；旧额度保留原时间但不可称为实时 | 证明会员到期或余额耗尽 |
| 403/无资格 | 按provider业务码区分权限、资格、客户端受限 | 一律提示密码错误/余额为0 |
| 429、离线、5xx、解析失败 | 分别退避/受控错误，保留旧观测和原时间；部分字段可独立有效 | 一律标额度耗尽，或刷新旧缓存的成功时间 |
| 账号切换、断开或并发刷新乱序 | 以账号/工作区/连接版本检查归属，丢弃旧请求结果 | 把A账号余额发到B账号卡片 |

会员到期日、token失效日、额度resetAt、积分expiresAt及账单周期各有语义。会员过期后的准确数额通常是再次读取服务端，而不是本地套一条统一计算式。服务端不给到期日时应明确“未提供”；允许将来经用户明确录入的提醒，但标注手工来源，不冒充实时权益。

## 实施拆分与验收门禁

1. 先做纯数据合同与旧Codex缓存迁移方案，保持现有授权网络边界；用合成数据验证窗口缺失、多池、余额型和计划变更，避免新增来源前再重构。
2. 单独提交 Antigravity CLI 只读合同与Windows验证方案：允许的命令、最低版本、用户选择的CLI、身份解释、启动副作用与超时清理均明确，再接入真实读取。安装/登录和读取真实账号不由本研究自动执行。
3. WorkBuddy 先确认个人credit只读scope申请资格、官方桌面授权是否可用及到期字段范围。若需要服务端，先给出部署成本、密钥托管、隐私与撤销方案供独立决定；官方聚合不足时保持“到期日未知”。
4. Claude被动导出、Go、ZCode、MiMo、Gemini、Cursor、DeepSeek API逐一按合同评估；支持状态必须说明账户/计划/平台/接口覆盖，不能只写品牌名。
5. GitHub只读项目监控仍按PRODUCT-DIRECTION-20261019.md推进；这次研究不恢复开发仓库远端同步、不扩展为模型转发/账号池/Agent远程执行平台。

下一增量至少覆盖以下合成案例：Pro仅周池；primary为周而secondary缺失；credits-only；未知单位；同池两个模型；同账号多入口；多账号一成一败；窗口已过reset但离线；周期/月包与活动包不同到期日；余额非零但不可用；冻结积分；取消续费仍有效；到期续费未确认；升级切换grant；过期包导致总量下降；部分/分页不全；401/403/429分类；乱序响应；空结果与缺字段；时钟/时区异常。每个适配另需无模型turn/无消费、无认证文件读取、无内容或凭据日志、断开与重启的验证。

## 研究证据与本轮边界

公开资料包括四个用户参考、CodexBar及Windows补充项目，以及十个现有来源的官方产品/接口资料。可重现研究框架、字段表、11个逐项JSON及生成报告位于忽略目录 .planning/quota-research-20261019/；公共源码快照、网页和manifest在 artifacts/quota-research-20261019/。这些缓存不进入源码包。

公共GitHub API首次查询触发匿名限流，改用公共Git只读引用和固定提交读取；没有使用开发机凭据。Orca首轮archive超出80MiB预算而中止，后改为无执行的稀疏源码读取。其初次引用与稍后clone的HEAD不同，报告源码统一引用实际检视的0517087；其余快照固定为表中提交。

官方页面或web抓取失败时，报告按实际证据降级或用公共HTTPS抓取并检查正文。未运行第三方项目、依赖安装或模型请求，未访问个人认证/浏览器cookie/源数据库，未连接真实额度账号，未部署服务端。本轮不把源码存在、作者的实测备注或schema校验视为本程序真实验收。规则会变化，正式接入与发布前须再次核对。

本轮复核：11份逐项JSON均覆盖6个必填字段，schema校验通过，全部明确保留真实账号未验收项；npm run verify 的lint与单元测试通过（fail 0），npm run audit:runtime通过，git diff --check通过。首次schema命令误把结果目录当文件而失败，改为明确的11份文件清单后复跑通过。这里只改研究文档与方向记录，没有renderer或运行时代码改动，未运行UI、真实采集或正式打包。
