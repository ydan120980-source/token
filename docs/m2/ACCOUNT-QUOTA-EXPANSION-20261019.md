# 账号额度接入扩展决定（2026-10-19）

所有者要求将现有 Agent 的账号额度可读能力做全，并明确允许本轮对已安装官方客户端当前登录账号各做一次已核实的只读额度查询。客户端可以在自身内部使用已有登录；本程序不直接读取/导出认证文件、不自动登录、不发模型请求、不修改网络规则。缺少安全查询或未登录的来源保持待连接。这取代此前“只实现 Codex 账号额度”的实现范围限制，不取代认证、外部服务和真实验收边界。

Agent 与上游服务不是一一对应。OpenCode、DeepSeek Harness 等可以消费其他服务的同一账号，不能生成第二份独立容量。每份观测必须保留实际适配器、单位、资源池、覆盖范围、新鲜度和身份核验情况；没有服务端账号标识时只称用户备注的连接，不自动去重/关联。

## 当前核对与实现边界

- Codex：沿官方 app-server 独立连接；补齐应用内安装的运行程序选择。按实际返回的 V2 资源展示，不固定套餐窗口。
- DeepSeek API：[官方余额接口](https://api-docs.deepseek.com/api/get-user-balance/)，仅固定 GET `/user/balance`，币种余额保持十进制字符串。属于 DeepSeek API 账号，不代表 Harness 所有上游。
- WorkBuddy：[官方积分接口](https://open.workbuddy.cn/en/docs/openapi)，仅固定 GET `/openapi/v2/credit`、`user.credit.readable`。可用显式提供的已授权 access token 查询聚合；没有逐包有效期。面向大众的一键 OAuth 仍需[审核应用和服务端凭据](https://open.workbuddy.cn/en/docs/third-party-app)，不能把发布者 secret 放入桌面包，也不在本次擅自部署公网中转服务。
- OpenCode Go：[服务方 GET handler](https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/routes/zen/go/v1/usage.ts)及[服务方接口讨论](https://github.com/anomalyco/opencode/issues/54283)可核对该只读路线。只有 Go 窗口，非所有上游/Zen 余额；账号归属未知不能按 key 当独立账号。字段兼容参考 Orca 固定提交，不能把其验收当作本程序验收。
- Claude：[官方状态栏](https://code.claude.com/docs/en/statusline)有真实 `rate_limits`，可作被动观测；只提取额度字段，不保存路径、会话 ID、提示词。尚无已核实的独立非交互查询合同，禁止猜测 `claude -p /usage`。原网络治理不变；不静默修改 settings 或状态栏脚本。
- Antigravity：[官方 `/usage`](https://antigravity.google/docs/cli/commands/usage/)和已准备的固定参数/解析/Windows 所有权边界继续适用。CLI 版本、程序身份和启动副作用未经核对时不启用；合成成功不是当前账号成功。
- ZCode 的 Z.ai/BigModel 监控 API 有[参考实现](https://github.com/steipete/CodexBar/blob/6480977b47f6e4ffd5dcaae1cb0c7fdf34ee449e/docs/zai.md)，公开官方稳定合同未建立；只能作为用户明确选择的试验路线，区域与凭据不可混用。
- Gemini：已核对[官方 CLI 类型](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/types.ts)和[只读请求](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/server.ts)，固定 POST `https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota`，只发送本人明确提供的项目 ID、OAuth access token。逐模型/单位桶保留 remainingFraction、remainingAmount、resetTime，二者是同一约束的不同表示而非两份容量。内部接口标试验；不读取 Google 认证文件、不执行 onboarding/生成/遥测；普通 API key 不适用。
- MiMo、Cursor：所有者明确批准可选的本地手动网站会话路线，默认未连接，界面单独确认“非官方稳定接口”。参考固定版本 [MiMo](https://github.com/steipete/CodexBar/blob/6480977b47f6e4ffd5dcaae1cb0c7fdf34ee449e/docs/mimo.md)与 [Cursor](https://github.com/steipete/CodexBar/blob/6480977b47f6e4ffd5dcaae1cb0c7fdf34ee449e/docs/cursor.md)，不执行参考代码、不读浏览器。MiMo 仅本站 balance / tokenPlan/detail / tokenPlan/usage，Cookie 只留 serviceToken、userId、ph、slh；Cursor 仅本站 usage-summary，只允许一种已知会话 Cookie。外站字段丢弃，重复/歧义拒绝。MiMo API 金额与 Credits 分离；Cursor 个体/团队/按需上限分离，不平均不同百分比、不把消费上限余量当预付余额。新套餐可能不完全覆盖，始终标部分数据。

新增 API 密钥/短期令牌/可选本站 Cookie 只能由用户在本地连接界面明确提供，不能从环境、源配置或浏览器获取。只在内存保管（包括 Google 项目上下文），重启后需重新提供；磁盘只存白名单额度观测与备注，不存密钥、原始响应或账号身份。明确连接/刷新才发送固定额度请求，无后台自动 API 请求、无重定向转发凭据；取消/移除中断在途请求，旧响应不能复活连接。MiMo 单次读取包含三个固定 GET；Gemini 单次读取是固定只读 POST，非模型调用。

V2 新增可选 `incomplete`（规范化默认 false）以表达已知覆盖不全，resourceView.partial 会纳入它；旧缓存兼容。精确金额/计数由 JSON 数字词法保留为十进制字符串，不先舍入再 stringify。缺失日期不猜时区；尤其 MiMo 不带时区的到期时间保持未知并记录 INVALID_TIME，但明确 expired 仍保留。401 仅代表凭据失效，403 不推断会员过期；过去的资格有效期要求重新核验，不清零余额、不自动补充。Claude 未返回的 rate_limits 替换旧值，重复观测不刷新年龄。

实现文件：provider-catalog / credentials / http / worker / resources / service，Claude passive exporter 与固定 PowerShell 辅助入口，现有额度页的最小连接 UI。旧 setup/installer 的动作合同不扩大；个人来源无执行/账号额度计划。Antigravity 仍因没有可核验 CLI 和启动隔离证据而不接线，不将进程容器等同于无配置/插件副作用证明。

实现、合成、真实查询与平台应用审核分别记录；没有完整实测与授权条件不能写“十个均可读”。
