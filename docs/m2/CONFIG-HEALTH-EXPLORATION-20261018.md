# 阶段 3：配置静态健康审计远期方案（2026-10-18）

**仅探索，未实现配置读取、解析器、扫描入口或审计 IPC。** 本文的白名单是未来实现建议，不是本轮读取授权；本轮只看公开官方资料与项目源码，没有打开真实 Agent 配置。阶段 2 查询、当前 usage policy 和来源读取范围均不变。阶段 4 DIY/编排不启动。

## 独立边界

未来模块独立于 `policy.allowedFile/localPath`，不得把 config/settings 从用量采集拒绝表移除。首先只支持用户明确选择的本机全局根与单个项目根，不从会话 cwd、父目录、WSL、远端组织配置、插件安装目录或云账号自动追踪位置。每个候选有固定 Agent、适用版本、文件名、可读取键与限额；官方来源未明确的候选白名单为空，显示未检查。

默认检查结构，不保证可连接、可执行或对模型可用。“正常”只表示当前选中范围内的静态项目通过。绝不启动 MCP、执行 hook/插件/命令、发请求、打开认证、下载 schema 或跟随 include/环境变量/URL/file 占位符。只可对明确的可执行文件名查 PATH 是否存在，不运行 `--version`。

## 官方资料与逐 Agent 文件/字段候选

资料核对日为 2026-10-18；实际安装版本仍需未来独立核对。`~` 仅表示用户选择的 home，不是本轮对该目录的访问。P 表示用户明确选中的项目根。下面字段只读取类型、条目数、布尔开关与可安全形成的结构判断；不保存原值。

| Agent | 未来候选文件白名单 | 可解析的结构键与限制 | 证据、尚缺事项 |
| --- | --- | --- | --- |
| Codex | `~/.codex/config.toml`；P 下 `.codex/config.toml`；明确选择根中的 `AGENTS.md`；`~/.agents/skills/*/SKILL.md` 与 P 下 `.agents/skills/*/SKILL.md` | `mcp_servers` 的条目数、enabled、command 是否单一可执行文件、args 数量、env/headers 是否存在；hooks 的事件/处理器类型与数量；skills.config 的 enabled 和路径是否给出；SKILL frontmatter 只检验必要字段存在/类型 | [配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)、[skills 位置](https://learn.chatgpt.com/docs/build-skills)。不读 auth、state、model provider 值、notify 内容或动态管理 hook 目录；不自动跟随 skills.config.path。项目 config 与 AGENTS 根优先级应在实现时对安装版本补核对 |
| Claude Code | `~/.claude/settings.json`、P 下 `.claude/settings.json`/`settings.local.json`、P 下 `.mcp.json`、`~/.claude/skills/*/SKILL.md`、P 下 `.claude/skills/*/SKILL.md`；`~/.claude.json` 作为混合文件的单独受限候选 | settings 只取 hooks/启用开关结构；MCP 仅 mcpServers 的类型、transport、command 形状与 enabled；混合 `.claude.json` 最初只准顶层 mcpServers，不遍历 projects（键含路径）或账号区；SKILL 检验 name/description 类型与存在，不返回正文 | [settings](https://code.claude.com/docs/en/settings)、[MCP 存储作用域](https://code.claude.com/docs/en/mcp)、[hooks](https://code.claude.com/docs/en/hooks)、[skills](https://code.claude.com/docs/en/skills)。认证文件照旧拒绝；managed/插件包不在首批。混合文件未能保证白名单解析时未检查 |
| OpenCode | 用户明确选定的全局目录内 `opencode.json`/`opencode.jsonc`，P 下相同文件；不自动读取自定义环境路径 | `mcp`（旧 schema）或版本明确后的 `mcp.servers`（v2）的条目结构、type/disabled 或 enabled、command 数组首项的文件名和后续项数量；instructions/plugin 只计数，不解析内容/路径 | [配置](https://opencode.ai/docs/config/)、[v2 MCP](https://dev.opencode.ai/v2/docs/mcp-servers/)。官网同时存在两代 schema，禁止混合解读；无法识别版本为未检查。provider、OAuth、headers/environment 值全部丢弃；skills/hooks 文件布局首批未核对 |
| WorkBuddy | **首批为空**；`~/.workbuddy/mcp.json`/P 下同路径是搜索索引中的候选，尚未由成功获取的正文确认，不开放读取 | 只确认有 MCP 设置与启停能力；JSON 根键和持久化格式待核对 | [官方 MCP 页面](https://www.codebuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide) 可访问的英文正文只说明产品设置入口。中文结果声称文件路径但正文获取失败，不能当已验证文件合同。不能用 CodeBuddy CLI 文档替代 WorkBuddy；skills/hooks 未检查 |
| MiMo Code | 用户明确选定的 config 目录内 `config.json`、`mimocode.json`、`mimocode.jsonc`；P 下 `mimocode.json(c)`/`.mimocode/mimocode.json(c)`；明确选择的 `skills/*/SKILL.md` | mcp 条目 type/local/remote、enabled、command 数组形状；skills.paths/urls、instructions/plugin 只计数，不展开；frontmatter 检验 name/description/hidden 类型 | [配置](https://mimo.xiaomi.com/mimocode/config-files)、[位置和覆盖](https://mimo.xiaomi.com/mimocode/config-overrides)、[MCP](https://mimo.xiaomi.com/mimocode/mcp-servers)、[skills](https://mimo.xiaomi.com/mimocode/skills)。MIMOCODE_HOME 会改变布局，Windows 的默认解析不凭 Linux 示例推断。auth.json、内联 config/auth 环境值一律不读取；不沿兼容目录递归扩读 |
| Gemini CLI | `~/.gemini/settings.json`、P 下 `.gemini/settings.json` | mcpServers 的条目/type/command/timeout 结构；mcp allowed/excluded 数量；hooksConfig 开关、hooks 事件及 handler 类型/数量；skills 开关/disabled 数量 | [配置参考](https://geminicli.com/docs/reference/configuration/)、[MCP](https://geminicli.com/docs/tools/mcp-server/)、[hooks](https://geminicli.com/docs/hooks/reference/)。系统 ProgramData、扩展 hooks 目录和 GEMINI 指令文件元数据布局不在首批；不读认证或 env 展开值 |
| Cursor | `~/.cursor/mcp.json`、P 下 `.cursor/mcp.json`；`~/.cursor/hooks.json`、P 下 `.cursor/hooks.json` | mcpServers 的类型、command 是否单一文件、args 数量、URL 是否存在；hooks version、事件与 handler type/count | [MCP](https://cursor.com/docs/mcp)、[hooks](https://cursor.com/docs/hooks)。只覆盖文件配置；扩展 API 动态注册、云 Agent 配置、插件包和 skills/rules 未核对，不据此判断整个 Cursor 健康 |
| ZCode | `~/.zcode/cli/config.json`、P 下 `.zcode/config.json`；对应 scope 的 `.agents/mcp.json` 仅在本地原生配置没有条目时按合同判断 | 原生 mcp.servers 或兼容 mcpServers；enable 布尔值、transport、command 形状、args 数量；不读任何提供商配置值 | [官方 MCP](https://zcode.z.ai/en/docs/mcp-services)。原生文件与兼容文件不合并；相同 scope 原生有条目时兼容文件被跳过。用户/项目优先级需依官方版本执行；skills/hooks 已有产品概念，但文件合同首批未核对 |
| DeepSeek Harness | **自动目录白名单为空**；未来只对用户明确指定的某个 profile 的 `cordis.patch.yml` 与 `package.json` 做受限候选 | package.json 只检查 dsh.profile.bundles 的结构/数量；YAML 仅识别固定 `@deepseek-ai/dsh-mcp-client` 插件条目的 config.serverName/transport、command 形状、参数数目与开关；不解析其他插件或执行表达式 | [官方 CLI profile 结构](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md)、[MCP 字段](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)。官方示例含 `!!js`，未来必须使用不执行自定义 tag 的解析器；遇 tag、alias 展开或版本不明时未检查。全局 home patch 与 Desktop profile 位置未核对，不猜测 |
| Antigravity | `~/.gemini/config/mcp_config.json`、P 下 `.agents/mcp_config.json` | mcpServers 的条目、command 形状、args 数目、serverUrl 是否存在和 enabled/disabled 的经确认结构；URL 不留下任何组成部分 | [官方 MCP](https://antigravity.google/docs/mcp)。官网 CLI/IDE 明确这些位置和 serverUrl；不能沿用旧 brain 目录推断配置。App 自有位置、skills/rules/hooks 的读取合同未核对，不沿 Gemini CLI 配置冒充支持 |

路径/字段未确认不是“不适用”。目前上述 Agent 的整个配置审计均为未检查。未来“不适用”只用于已核对的版本/能力清单明确没有该检查项，例如一个远程 MCP 条目的本机 executable 存在性；缺文件、没有选择范围、解析失败、没有权限或版本不明都不能显示正常/不适用。

## 投影与脱敏

未来的 UI/持久化模型仅包括：固定 Agent ID、文件类型枚举、固定白名单相对文件名、状态枚举、受控原因、计数、布尔值和检查时间。行名优先用“MCP 1 / Hook 1 / Skill 1”等生成标签；原始键名也可能含凭据，不能未经处理透传。配置中的任意字符串都按不可信数据处理。

- `env/environment`、`headers/http_headers`、`args` 和 command 数组的其余项只保留存在与数量，连键名也不保留；禁止模板/变量/文件引用求值。
- URL 最多用于在内存判定字段类型和 transport 是否兼容；userinfo、主机、路径、query、fragment 均丢弃。oauth 和凭据节点整体跳过。
- command 只在确认是单个字面可执行路径时取文件名；含脚本、参数拼接、shell 符号或变量时为未检查，不能为了解析去启动 shell。文件名如有秘密样式同样不展示。
- hooks 只检事件枚举、handler 类型和数量；command/prompt/agent 文本不保存。SKILL 只读有界 frontmatter，正文不读取；description/name 的内容不进入投影，只保留类型/存在性、重复情况。
- AGENTS/CLAUDE/GEMINI 等指令文件在各自经确认的固定路径仅允许文件存在/大小/修改时间，不读正文。额外路径、glob、插件引用只计数，不跟随。
- 解析错误只给受控码；不记录 exception.message/stack/原文/路径。原始 Buffer 与解析对象只在主进程的本次内存处理，离开后不缓存，不允许持久化原文作诊断。
- 相对路径仅可由本机 UI 使用固定文件类型拼出；任何导出、日志和阶段 2 查询都不含审计路径、配置值、映射或索引。未来审计结果不会复用 UsageSnapshotV1，不混入现有查询/导出。

## 四态与示例

| 状态 | 判定 | 例子 |
| --- | --- | --- |
| 正常（静态） | 版本/文件/字段合同已确认，所选范围的检查完成且无结构问题 | MCP 条目结构完整，单个字面命令存在；不承诺能握手 |
| 问题 | 合同明确且有确定结构证据 | 必需 command 缺失、同 scope 重复键、handler 类型非法；原因用受控码 |
| 未检查 | 无法安全检查或未选范围 | 未找到文件、拒绝访问、未知版本、JSON/TOML/YAML 解析失败、含可执行 tag、来源不明确 |
| 不适用 | 已确认该版本/该条目不具备该项概念 | remote MCP 的本机 executable 检查；不把“不知道”包装成不适用 |

## 未来实现前的验收方案（本轮均未执行）

1. 每个 Agent 独立版本化 fixture 与白名单测试；覆盖用户/项目覆盖关系及未确认分支。先纯解析模块，再审计 IPC，再本机 UI；不在本轮引入运行入口。
2. 合成 config 在 env、headers、args、command 数组、URL userinfo/path/query/fragment、名称、description、错误 JSON 后半段各埋不同假密钥。对快照、IPC、stderr/日志、阶段 2、所有 CSV/JSON 导出做逐字节全目录哨兵搜索，要求全部无泄漏。
3. 单独拒绝 auth/credentials/token、符号链接、目录联接、越界 include、`{file:...}`、未选根路径、超大文件、YAML tag/alias 炸弹；被拒条目的读取计数必须为零。不扩展 usage policy。
4. 用网络、child_process、worker、shell 和写入陷阱证明静态审计不会启动 MCP、执行 hook、运行模型、下载 schema 或修改配置；前后文件 SHA-256 一致。
5. 所有不能检查的情况显示未检查。明确“正常（静态）”的限制，提供检查范围和受控原因；不显示可误读为运行连接成功的绿点。
6. UI 使用当前共享 tokens 与既有 sheet/行布局；只在未来实现授权后决定页面位置。本轮不加设置入口、按钮、任务、后台监听或自动化。

阶段 3 下一步是补齐 WorkBuddy、Windows 根路径与各版本字段差异的合同，并按所有者批准范围实现纯合成解析器；任何真实读取仍要等待独立实施与验收。本文不能被后续线程当作已通过的隐私测试记录。
