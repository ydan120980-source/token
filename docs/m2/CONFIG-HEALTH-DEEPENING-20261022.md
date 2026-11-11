# MCP / hooks / skills 静态检查深化（2026-10-22）

所有者请求“继续深入 MCP、hooks、skills 配置检查”。本轮承接 [首版静态合同](CONFIG-HEALTH-STATIC-20261020.md)，从本地 `main` 的 `ee96f37` 开主题分支。主线程独立实现，不启动子代理。仅合成验证、本地合入、不打包。现有文件白名单及显式绝对 home／单项目根要求保持不变，没有运行真实配置检查。CodeGraph 工具不可用，已用当前源码和定向测试核对读取／投影／CLI 链路。

## 已核对的资料和适用范围

2026-10-22 获取了 OpenAI Docs 的 [Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)、[hooks](https://learn.chatgpt.com/docs/hooks)、[skills](https://learn.chatgpt.com/docs/build-skills)，以及 Claude 官方的 [MCP](https://code.claude.com/docs/en/mcp)、[hooks](https://code.claude.com/docs/en/hooks)、[skills](https://code.claude.com/docs/en/skills)。只使用公开文档形状，不以此认定本机安装版本或运行时生效。

沿用对 Codex／Claude 的分别判定，不引入其他 Agent 的配置读路径。新出现或无法确认的 transport／handler／布尔兼容行为保持未检查；不复制客户端账号设置，不读取 `.claude.json`、认证文件、插件目录或额外路径。

## 判定改进

- MCP：确定的字段错误优先于未知 transport，修复 `args` 等字段错误被后续 transport 诊断降级的问题。补查双方的超时、Codex required／cwd／工具选择／env_vars 结构。零值超时不擅自判错；没有文档证据的双超时 alias 同时出现保持未检查。值只在当次内存判定，输出不带原命令、环境名称、工具名或 URL。
- 动态项：识别 URL 中的环境／文件等引用，只返回 `DYNAMIC_REFERENCE_UNCHECKED`；header helper 有效字符串返回 `DYNAMIC_HELPER_UNCHECKED`。不求值、不读环境、不跟随文件、不执行 helper。未知 transport 不套用 HTTP 协议限制；这不是新增 WebSocket 支持。
- hooks：Claude 已支持的 HTTP handler 检查字面 HTTP(S) URL、header map、允许环境列表的形状；Codex HTTP handler 仍保持未检查。两者 MCP-tool 的 server／tool 为必需字符串，input 若存在必须为对象；即使字段齐全也保持 `MCP_RUNTIME_UNCHECKED`，不验证连接或真实工具。补查 async、timeout、statusMessage，及 Codex Windows override／additionalContextLimit 的类型。
- skills：Claude 的缺省 name／description 继续合法，Codex 两字段仍必需。新增 Claude 调用开关、allowed-tools、常见字符串字段和 context 形状检查。yes/no/on/off/0/1 及字符串布尔值有客户端版本相关行为，返回 `BOOLEAN_COERCION_UNCHECKED`；不按缺失当前版本信息猜测。未知 context 为未检查，不启动 agent。
- YAML 有界子集：额外接受 JSON 风格 flow list 和有界同级简单 block list；仍拒绝 tag、alias、复杂嵌套和非支持列表语法。数字、布尔和 null 不再误作合法的字符串 name／description；其他 YAML 数字拼写保守返回未检查。只读 frontmatter 到关闭分隔符，Markdown 正文不读。
- 文件一致性：打开前、打开后、读取后、当前路径的 dev／ino／size／mtime／ctime／链接数保持一致，且 nlink 必须为 1。补上初次 stat 后新建硬链接等竞争窗口的拒读，失败时关闭文件描述符。不能据此声称文件系统对抗检查绝对无竞争窗口。

原有重复 Skill 名检查、JSON 重复键拒绝、读取预算、符号链接／junction 拒绝、指令文件元数据模式继续保留。未知行为不会填为正常，不修改任何选中配置。

## 返回合同

`schemaVersion` 继续为 `ConfigHealthV1`；`contract` 更新为 `codex-claude-static/20261022`。增加固定键 `summary.mcp`、`summary.hooks`、`summary.skills`，每项仅含：

```json
{"state":"unchecked","files":0,"counts":{"static-ok":0,"issue":0,"unchecked":0,"not-applicable":0},"runtimeVerified":false}
```

文件解析失败／拒读／缺失按候选可包含的类别计入未检查，避免空分类被误读为通过。分类里若有确定问题，state 为 issue；否则有未检查项或没有相关文件时为 unchecked；只有覆盖的检查均静态通过才给 static-ok。计数是诊断检查项，不是已连接服务数或真实可用 Skill 数。

整体仍是 `state: unchecked`、`PARTIAL_STATIC_SCOPE`，`clientVersionVerified` 和 `runtimeVerified` 仍为 false；分类静态通过不代表客户端总体健康、依赖存在、已信任、已连接或可执行。不模拟 home／project 的覆盖优先级，不追踪 MCP server 的跨文件引用，不读取 SKILL 正文验证工具权限。

## 验证和交接

新增 `config-health-deep.test.js` 覆盖错误降级回归、字段矩阵、动态值不求值、hook 形状、Skill 列表／标量／调用开关、分类缺失／解析失败、打开前后硬链接竞争和 ctime 变化；原有隐私测试继续验证网络／子进程／写入陷阱、正文不读、哨兵不泄漏及源文件字节不变，真实 Node CLI 仍要求显式根。

首次既有测试的固定“未检查”计数断言失败：最新已核对的 MCP-tool 必需字段和无效 HTTP hook URL 现在应为 issue。断言改为逐项状态验证，没有放宽判定；首轮日志保留。

最终 `npm run verify` 为 lint clean、`fail 0`；`npm run audit:runtime` 通过；`npm run test:native` 在新建的独立合成目录中通过、networkAttempts 为 0。`git diff --check` 通过。日志在 `artifacts/config-health-deepening-20261022/`，包括首轮既有断言失败和修正后的定向／全量结果。没有执行真实配置检查。

无 GUI、IPC、自动扫描、配置写入或运行时执行改动，因此本轮不运行 UI 套件，不更改额度／采集／保存查询合同。晚间向 Claude 统一交接实现和证据；真实配置检查、其他 Agent、GUI 接入、依赖执行／联通测试与发布不自动开始。

同日后续继续授权的事件适用性、关闭开关和脱敏序号定位见[后续记录](CONFIG-HEALTH-EVENT-COVERAGE-20261022.md)。
