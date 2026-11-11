# 十 Agent 额度路线检查与交付决定（2026-10-20）

所有者要求先查明全部 Agent 是否可读额度，缺口继续推进，完成后本地合入并打包；随后明确选择“先补齐可安全实现的能力并打包，保留真实验收限制”。因此本轮不发起新的真实账号查询、不获取凭据、不修改 Agent 设置或网络治理，不恢复 GitHub。保留先前预算、账本一致性、安装器隔离和静态配置检查增量，沿同一主题分支验证和交付。UI 只改必要动作与说明，样式不改。

## 检查结论及补齐

起点不是“十个已经可读”：九个具有已实现路线，真实账号验收记录只有 2026-10-19 的 Codex；Antigravity 主动 CLI 因身份、版本和启动副作用边界未满足而保持关闭。其他账号缺少本地凭据或状态栏回调，未验证真实响应。

2026-10-20 重新读取 [Antigravity 官方状态栏文档](https://antigravity.google/docs/cli/statusline/)：其 stdin JSON 包含 `product`、`version`、`quota`，每个模型/桶项可含 `remaining_fraction`、`reset_time`、`reset_in_seconds`。这提供了独立于主动 `/usage` 的被动读取路线。沿用现有 Claude 导出 host 和应用自有 incoming 文件，按连接 adapter 固定选择解析器；不执行客户端、不访问认证或原配置、不联网。配置片段仅由用户复制并合入现有 statusLine，不能覆盖原有功能。主动 `/usage`、安装、登录和版本探测不由该路线触发。

Antigravity 导出只保留规范化 CLI 版本、剩余比例和明确的绝对重置时间。原始桶名用稳定摘要和生成标签替代；不保存 email、cwd、会话/对话 ID、上下文 token、套餐文本。相对重置秒数不推导为绝对时间；上下文余量不冒充账号额度。桶集合仅作未知归属容器，不推断独立或共享容量，不累加，始终标部分覆盖。缺字段替换旧额度为未知；相同观测保持原观测时间。过量、格式非法或绑定错误拒绝，不发布成新成功。

修正来源管理引导中“尚未接入”的陈旧文案，按当前 provider catalog 描述条件。公共安装器的个人网络例外已迁出；隐私文档同步说明。源码归档包含隔离的手动本机工具及其测试依赖；Windows 运行包仍不包含 `scripts/`。

## 各 Agent 可用条件与真实验收

| Agent | 本产品读取路线 | 使用条件与覆盖 | 真实账号证据 |
| --- | --- | --- | --- |
| Codex | 官方 app-server | 独立授权连接；服务端实际资源 | 历史一次通过；本轮不重查 |
| Claude Code | 官方状态栏 rate_limits 被动观测 | 本人手动合并导出片段；非后台查询、部分覆盖 | 未实测回调 |
| OpenCode | Go usage | 本地输入 Go key；不代表其他上游/Zen 余额 | 未实测 |
| WorkBuddy | 官方 credit GET | 已授权短期 token；聚合积分，公开 OAuth 仍需审核/服务端 | 未实测 |
| MiMo Code | 可选本站网站会话 GET | 本地输入白名单 Cookie 并确认试验接口；API 金额与 Credits 分开 | 未实测 |
| Gemini CLI | 官方 CLI 内部 retrieveUserQuota 只读 POST | 本地 OAuth token + 项目 ID；内部试验合同，非普通 API key | 未实测 |
| Cursor | 可选本站 usage-summary | 本地网站 Cookie；部分个人/团队约束，不保证全部新套餐 | 未实测 |
| ZCode | Z.ai / BigModel 监控 GET | 本地输入正确区域 key；个人 Coding Plan 试验接口 | 未实测 |
| DeepSeek Harness | 官方 DeepSeek API balance | 本地输入 DeepSeek API key；不代表 Harness 其他上游额度 | 未实测 |
| Antigravity | 官方 CLI 状态栏 quota 被动观测（本轮补齐） | 本人手动合并导出片段；客户端需实际提供 quota；主动查询仍关闭 | 未实测回调 |

完成后可以表述为“十个 Agent 均有显式读取或被动观测路线”，不能表述为“十个当前账号全部读通”或“完整覆盖所有套餐”。代码、合成、真实与打包验收分别记录于本代次验收文件。
