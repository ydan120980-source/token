# 同账号识别与 WorkBuddy 分页（2026-10-22）

所有者授权：先做同账号识别，WorkBuddy 分页一起做；仅合成验证，本地合入，不打包。需要大量 UI 修改时先告知。基线是本地 `main` 的 `8c88541`，包含交接后新增的采集诊断及标题栏／侧栏界面。本次主线程独立完成，不启动子代理。CodeGraph 未提供可调用工具，改用当前源码和定向测试核对调用链。

## 同账号／同凭据证据

`quota:providers` 的每一条账号行均返回：

| 字段 | 语义 |
| --- | --- |
| `duplicateKnown` | 已有证据确认与至少一个当前连接重复；`false` 不证明是不同账号。 |
| `duplicateAccountIds` | 同组的其他本机连接 ID，排序、不含自身。两组重复连接不会混在一起；数组是独立副本。Codex V1/V2 同时补齐此字段。 |
| `identityStatus` | `server-reported`、`client-bound`、`credential-match` 或 `unknown`，说明证据来源；不包含账号原文。 |

各路线的证据边界：

| 路线 | 证据与限制 |
| --- | --- |
| Codex | 延用官方响应的账号 ID，`server-reported`。保持既有换号保护；需要重新登录的行不再参与重复组。 |
| WorkBuddy desktop | `client-bound`：现有已验证的客户端 uid、国内域名、企业上下文。更换 token 后仍可匹配同一上下文；不同企业或域名不合并。 |
| ZCode device | `server-reported`：现有设备授权响应里的 userId；设备 ID 不影响同账号判定。 |
| Cursor 客户端复用 | `client-bound`：现有客户端 subject；必须先通过额度查询。没有客户端上下文的手动 Cookie 只做同凭据匹配。 |
| 其余 HTTP 路线 | `credential-match`：规范化后的相同凭据，且 adapter、区域、产品、组织／工作区／项目范围一致。API key 不同不等于账号不同。Cookie 顺序无关；不猜测任意 Cookie 或 JWT 中的账号 ID。 |
| Claude 网站、OpenCode 网站、Gemini CLI 自动选范围 | 子进程将本次查询实际使用的组织／工作区／项目放在内部 observation envelope 的 `identityContext`，主进程只用于内存比对。没有已确认范围时保持 `unknown`。它不进入 AccountQuotaV2、额度缓存或 renderer IPC。 |
| Claude/Antigravity 被动状态栏，Antigravity CLI 报告 | 当前合同没有可靠账号身份，保持 `unknown`。不把 `official-owned-login` 等固定占位串当成身份，不按 CLI home、套餐或相同额度猜账号。 |

新服务的比对使用每次进程启动随机的 HMAC 密钥；仅保存内存指纹。成功观测经过投影、校验并保存后才建立证据。账号原文、凭据和指纹不会写入普通连接缓存，也不返回界面。加密 vault 的既有凭据合同不变。

手动更换凭据、准备新的凭据、认证失败、客户端换号、移除和关闭会清除相应证据。失败／取消的重新登录保留原连接及其证据，不发布未保存的新账号。普通网络失败可保留同一份凭据先前成功的证据及历史额度。重启读取缓存／恢复加密连接不做网络，也不恢复识别指纹；下一次成功刷新再建立。

跨 adapter 不推断同账号。尤其不能仅因 WorkBuddy 网站和客户端余额相同，就合并这两种连接；OpenCode Zen、Go、网站路线也保持各自产品范围。当前接口没有提供更多可靠证据的情况诚实保持未知，没有新增个人资料请求或认证文件读取。

## WorkBuddy 客户端积分包分页

沿用固定 POST `https://www.codebuddy.cn/v2/billing/meter/get-user-resource`。`PageNumber` 从 1 顺序递增，`PageSize=100`；ProductCode、Status 和本次查询的起止时间过滤器跨页保持一致。没有新增网络地址、写操作、授权范围或刷新频率。

请求参数和 Accounts 包形状参照此前已经采用的 [XDTrees/dsh-xdpool 固定提交](https://github.com/XDTrees/dsh-xdpool/blob/2def4d01509784c7ebc4fe9b5d860f12a398a64f/src/upstream.ts) 中 `fetchCredits`。该参考代码仅请求第一页，没有证明多页在真实服务上的行为。本次是基于已有 PageNumber 合同的保守实现，仅完成合成验收；不将参考项目的说明当成本项目实测。WorkBuddy 网站摘要接口没有已核实的分页参数，本次不向它添加猜测参数。

- 继续读取直到后一页为空；短页本身不证明完整。最多 10 页、1000 个包、累计响应 JSON 2 MiB，并保留每次 HTTP 的 512 KiB／超时／取消／拒绝重定向和整个 worker 的现有超时限制。
- 达到页数上限则保留已读包并标 `incomplete: true`；空页确认终止才由 paginator 授予 `completePackages: true`。普通 raw 解析默认仍为不完整。
- 重复／重叠页、变化中的可选 TotalCount、与终止矛盾的总数、无效包、后页错误或取消均不发布新的额度结果，保留上次完整快照。包指纹忽略余量、已用、冻结等可变字段，防止同一个包改变余量后被重复相加。缺少已核实的稳定包 ID 时，跨页无法区分的包采取拒绝本次结果的保守策略；同页同形包延用原行为。
- 每包仍是独立资源池，保留原标签、credits 单位、金额字符串、月度窗口和到期时间，没有后端积分合计。仅 WorkBuddy 的资源合同容纳至 1000 pools／2000 items，其他服务商上限不变；单池上限不变。
- 连接缓存写入增加与启动读取一致的 4 MiB 上限。总缓存超限时报告保存失败，保留原字节，不写出下一次启动无法读取的文件。
- `incomplete: false` 只说明该次过滤范围的包枚举结束；`partial` 仍可因可用性等未知而为 true。不伪造套餐、冻结或可用性状态。没有可识别包时仍保持额度未知错误，不制造零。

## 界面交接与验证

此次没有修改 `design/desktop-reference/`、界面文案、卡片设置或自动刷新间隔／规则。无需大量 UI 修改。

Claude 后续可以用 `duplicateAccountIds` 做重复提示或选组；有重复并不授权跨账号／跨产品累计。默认未知时继续保留独立卡片。WorkBuddy 客户端确认 `quota.incomplete === false` 时可以调整“已返回的 N 个积分包”限定；达到上限、旧缓存、网站摘要仍保留限定。不要用 `partial === false` 代替分页完成判断。

影响的界面回归：`provider-quota-ui-test`（provider 行及已有凭据流程）、`quota-ui-test`（Codex 重复行、重启与自动刷新）。新分组合并 UI 本次不实现，交给 Claude；其后续接线需标 `needs-ui-run`。

已完成验证：

- `npm run verify` 最终复跑 lint clean、`fail 0`。新增用例覆盖全部 adapter 的保守证据、分组及防串号、登录保存失败回滚、换凭据／认证失败／取消／删除竞态、重启与隐私、205 包完整读取、1000 包上限、重复／重叠页、后页失败、累计响应及缓存上限、实际 HTTP 请求参数和 worker 调用接线。
- `npm run audit:runtime` 通过，单产品入口且没有开发 harness／退役模块引入。
- `provider-quota-ui-test` 和 `quota-ui-test` 均在源码模式的 100%／150% 缩放通过，含现有凭据流程、IPC、错误／取消、历史缓存与自动刷新选择恢复。每次测试自建 usage/quota 及合成 home；没有启动真实凭据进程或读取真实来源。
- 初轮新增测试误将分页完成等同于 `partial === false`，按资源状态源码核对后改为分别验证 `incomplete === false` 与 `partial === true`，复跑通过。首轮全量 verify 的既有开发用合成进程测试在 3 秒 reap 边界失败（`reaped: false`）；单独复跑通过，UI 完成后的最终全量复跑也通过。没有修改该测试或开发 harness，保留首轮失败日志；并发负载是可能因素，不作为已证实根因。
- 日志和界面证据在工作树 `artifacts/quota-identity-pagination-20261022/`；Codex 界面 suite 的原生证据沿用 `artifacts/quota/`。`git diff --check` 通过。

真实账号、真实来源、打包版／解压副本验收未执行；不 push、不 PR，不合并旧 cost-layout-preview 分支，不开始其他 Backlog。新分组合并／网站与客户端跨路线身份匹配仍非本次已验收功能。
