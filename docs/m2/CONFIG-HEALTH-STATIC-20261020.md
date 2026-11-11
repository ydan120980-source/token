# Codex / Claude Code 静态配置检查（2026-10-20）

2026-10-22 的字段、读取一致性和分类汇总增量见[深入检查记录](CONFIG-HEALTH-DEEPENING-20261022.md)。本页的显式选根、文件白名单、限额和无执行边界继续有效。

所有者授权在批次一致性及公共安装器修复之后推进 MCP/hooks/skills，首批明确选择 Codex + Claude Code。GitHub 功能继续暂停，DIY、编排、真实配置读取及 UI 样式改动不在本轮授权内。2026-10-18 的探索文档继续作为隔离、白名单和脱敏基线；本文记录这次独立实施合同，验收结果随实现更新。

官方资料于 2026-10-20 重新核对：[Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)、[Codex hooks](https://learn.chatgpt.com/docs/hooks)、[Codex skills](https://learn.chatgpt.com/docs/build-skills)，以及 [Claude settings](https://code.claude.com/docs/en/settings)、[MCP](https://code.claude.com/docs/en/mcp)、[hooks](https://code.claude.com/docs/en/hooks)、[skills](https://code.claude.com/docs/en/skills)。这是文档形状合同，不代表已探测安装客户端版本或确认运行时生效。

独立读取器只接受显式绝对 home / 单项目根，不读取默认真实 home、不自动追踪 cwd/父目录/环境变量/插件。Codex 的候选为 `.codex/config.toml`、`.codex/hooks.json`、`.agents/skills/*/SKILL.md`，AGENTS.md 仅元数据；Claude 为 `.claude/settings.json`、项目 `.claude/settings.local.json`、项目 `.mcp.json`、`.claude/skills/*/SKILL.md`，CLAUDE.md 仅元数据。每个根独立检查，不模拟跨层合并或优先级。混合账号文件 `.claude.json` 一律不读，因此 Claude user/local MCP 明确未检查。系统托管、远端、插件、附加路径及实际命令存在/连接检查均未覆盖。

首版不新增运行时依赖。JSON 要求严格语法并拒绝重复键；TOML 支持受限的普通表/数组表、字符串、布尔、有限十进制数字、数组与内联表。无法安全解析的合法复杂 TOML 也返回未检查，绝不按空配置通过。Skill 只读取有界 frontmatter 到结束分隔符，不读取 Markdown 正文；首版 YAML 仅处理标量及普通折行描述，tag/alias/复杂结构返回未检查。Claude 的 name/description 是可选字段，不把缺少可选字段当成损坏；Codex 按其必需字段合同检查。

结果只有四态、固定 Agent/scope/文件类型、受控原因、计数和布尔值；原始名称、URL、命令、参数、env/header 名值、skill 名称/描述、路径和错误文本不进入输出。正常仅表示已覆盖的静态结构，不代表可运行、握手成功、已信任或模型可用。缺文件、拒读、超限、未知类型及无法确定版本行为都保持未检查。既有 usage policy、保存查询、统计导出及业务账本不变；不运行 MCP/hook/skill，不发网络、不写任何配置，不缓存原文。

实现入口为 `src/m1/config-health-entry.js`，例如 `node src/m1/config-health-entry.js --home <显式绝对目录> --project <显式绝对目录>`；两个参数可各自单独使用，无参数、相对路径、重复参数或额外字段直接拒绝，且不回显路径。此阶段没有 GUI、扫描 IPC、定时扫描或自动读取入口。每个客户端都有独立版本兼容性未检查项；整体 `state` 保持 `unchecked / PARTIAL_STATIC_SCOPE`，即使已覆盖字段结构通过，也不能将整个客户端标为健康。

限额：普通候选单文件 256 KiB，skill frontmatter 16 KiB，每个 skill 目录最多查看 64 个条目，整次内容读取 2 MiB，解析深度与节点数另有上限。目录联接、符号链接、文件硬链接、远程根、越界及文件在读取期间变化都拒绝或返回未检查；错误文本不外传。同客户端同 scope 的重复 skill 名在本次内存中比较，输出仅含受控重复诊断。

合成验收：`config-health.test.js` 验证严格 JSON/TOML 子集、重复键、不同客户端 handler 差异、可选字段、纯静态错误、生成结果脱敏、读取范围、正文边界、写入/网络/进程陷阱、文件字节不变、目录联接/硬链接、超限、拒读、文件替换、重复 skill 及真实 Node CLI 的显式范围要求。合法但不支持的复杂 TOML/YAML 明确未检查；未验证实际安装客户端版本、真实配置、GUI 或打包入口。
