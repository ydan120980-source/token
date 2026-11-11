# 配置检查：事件适用性和脱敏定位（2026-10-22）

所有者要求在上一轮深入检查后“继续”。本增量从本地 main `589de41` 开始，继续现有 Codex／Claude 静态检查，不接入 GUI、其他 Agent 或新读取路径。沿用[首版边界](CONFIG-HEALTH-STATIC-20261020.md)和[字段深化记录](CONFIG-HEALTH-DEEPENING-20261022.md)：显式选定根、固定白名单、有界读取、无配置执行、仅合成验证、本地合入、不打包。单主线程实现，无子代理。CodeGraph 不可用，使用当前源码、定向搜索和测试核对。

## 已核对资料

2026-10-22 重新获取 [OpenAI Docs 的 Codex hooks](https://learn.chatgpt.com/docs/hooks) 和 [Claude hooks reference](https://code.claude.com/docs/en/hooks)，核对事件、handler、异步字段和关闭开关的公开合同。文档适用性不等于本机客户端版本已验证；没有运行客户端探测，也不读取托管、插件、会话或远端配置。

## 本轮变化

- 已知事件与 handler 组合不适用时报告确定问题：例如 Codex SessionEnd 的 MCP-tool，Claude PermissionRequest 的 agent、SessionStart／Setup 的 HTTP，以及不接受模型 handler 的事件。Claude Setup 的 MCP-tool 按文档始终跳过，报告 `MCP_SETUP_UNAVAILABLE`；SessionStart 的 MCP-tool 取决于启动／清理／压缩上下文，保持 `MCP_STARTUP_CONTEXT_UNCHECKED`，不推断连接。补齐当前公开文档列出的 Claude 事件；未知事件保持未检查。
- 未知事件不再直接跳过内部结构检查。非法组、handler 或已知字段仍能报告 issue，未知事件不能掩盖确定错误。不评估未知事件的运行语义。
- async 对非 command handler、Codex SessionEnd 强制同步、Claude settings 中 once 被忽略等行为给出未检查诊断；不误称字段生效，也不把这些可解析但忽略的选项一律认定语法无效。
- Claude `if` 只在文档规定的工具事件上适用；放在已知其他事件时报告 `CONDITION_EVENT_UNSUPPORTED`。适用事件上的条件保持 `CONDITION_UNCHECKED`，不解析权限语法、不执行模式、不检查当前工具调用。补查 `asyncRewake`／`once` 布尔类型、command args 的字符串列表和模型 handler 的 model 字符串类型。
- Codex config 中 `[features].hooks`／旧 alias `codex_hooks`、Claude settings／local 中 `disableAllHooks` 按布尔字段检查；显式关闭返回 `HOOKS_DISABLED_IN_FILE`。`configuredEnabled` 只表示该文件该字段的值。alias 和同时出现的新旧开关保守未检查；不计算用户／项目／local／托管层覆盖，不据此认定最终运行开关。关闭状态不会隐藏同一文件中的无效 handler。
- MCP 和 hooks 检查增加 `location`。section 只用程序内固定字符串；entry／event／group／handler 从 1 开始，表示本次解析后枚举位置。例如 `{"section":"hooks","event":2,"group":1,"handler":3}`。不输出服务名、事件原键、matcher、路径、参数或命令，不提供行号；对象数字键遵循 JavaScript 枚举规则，不能当成源码行顺序或跨次扫描稳定 ID。
- Skill frontmatter 标注固定 section；Codex skills.config 改为逐项报告结构和引用未跟随，最多检查 64 项，其余明确 ENTRY_LIMIT。原始路径不返回、不跟随。计数仍为诊断检查项，不能等同于真实已安装或生效的能力数量。

schemaVersion 仍为 `ConfigHealthV1`，contract 更新为 `codex-claude-static/20261022-events`。总体仍 `state: unchecked`、`runtimeVerified: false`、`clientVersionVerified: false`；各分类保持确定问题优先。现有文件白名单、读取预算、前言停止、链接拒读和总量限制均未扩大。

## 验证和交接

新增合成测试覆盖事件／handler 矩阵、启动上下文、未知事件错误优先、忽略选项、条件不求值、显式关闭／alias、ordinal 定位脱敏、有界 skill override，以及禁止网络／进程／写入的集成扫描。既有隐私和文件竞态测试继续运行。

首轮新测试在结束清理时失败：测试自身的禁止写入 mock 尚未撤销，阻止了合成临时目录清理。调整测试清理顺序，先恢复 mock 后调用既有 remove；定向测试随后通过。首轮日志保留，不记为产品写入或权限失败。

最终 `npm run verify` 为 lint clean、`fail 0`；`npm run audit:runtime` 和 `npm run test:native` 通过，native 的 `nodeNetworkAttempts: 0`、`sourceReadOnly: true`。`git diff --check` 通过。实际日志记录在 `artifacts/config-health-event-coverage-20261022/`，包括首轮清理失败及修正后的定向和全量结果。

未读取真实配置／凭据，未运行配置中的命令、MCP、hooks、skills 或模型。无 UI／IPC 改动，因此未跑 UI；未打包、上传或远程提交。晚间交接追加本增量与证据，不自动执行 GUI、真实配置检查或其他 Backlog。
