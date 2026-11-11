# Agent 配置统一入口与本地管理（2026-10-22）

所有者明确这些能力属于“对应 Agent 配置检查和统一管理”，允许另起模块或并入现有模块；随后选择先做统一入口和只读检查，再做编辑／启停／安装，借鉴 CC Switch。安装来源明确选择用户选定的本地配置或目录，不接在线市场。此决定 supersede 历史首版“无 GUI”的实现阶段限制；静态扫描仍不执行、不修改配置。写入必须走独立管理路径，不能让检查、切页或选择范围触发写入。

## 参考和页面归属

核对 CC Switch 当前公开[中文 README](https://github.com/farion1231/cc-switch/blob/main/README_ZH.md)、[MCP 手册](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/zh/3-extensions/3.1-mcp.md)、[Skills 手册](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/zh/3-extensions/3.3-skills.md)。它采用全局分类页、按应用启用矩阵、编辑／导入与备份。本项目借鉴统一分类、应用归属、显式导入与可恢复操作，保留现有 Electron／classic JS 和中性灰 tokens，不搬运其实现／资源，不接供应商切换、代理路由、在线仓库、WSL 或其凭据库。

在现有来源管理中新增“Agent 配置”子模块，复用 Agent 目录。选择 Agent、用户级／项目级范围，再查看 MCP／hooks／skills。首批只支持 Codex、Claude Code；其他内置 Agent 明确未适配。用量采集、安装状态和配置检查仍是分别的能力。

## 阶段一：只读入口

原生目录选择器建立仅本次进程内有效的 Agent＋scope 授权；不采用默认真实 home、session cwd 或采集目录。选择只校验目录元数据，点击检查才读取原白名单。renderer 不能传入任意路径替换授权，只传固定 Agent／scope。切换和清除分别作用于各授权；重启不恢复目录或结果。

独立工作线程运行已有静态读取器，只扫描所选一个 Agent／scope，执行 network lockdown，30 秒超时并可取消，不阻塞主窗口。主进程和页面仅保留脱敏结果；失败显示受控原因并保留上次结果标记。已有 CLI 仍默认检查两个 Agent；额外的 Agent 参数只供受控内部调用。

结果按 MCP／hooks／skills 给出问题、未检查和静态通过计数，展开固定文件类型查看中文原因与解析后序号；不显示服务名、事件原键、命令、环境值或原路径。Claude 混合账号文件未覆盖、语法未知、缺文件和版本未核对继续明确显示，不能称为整体健康。

源码合成验收：新增服务测试验证选择不读取内容、授权隔离、sender guard、并发 picker／检查拒绝、取消和真正工作线程结果。新增原生 UI 套件在 100% 浅色／150% 深色通过目录选择→手动检查→分类→切换 Agent／scope→清除；无横向溢出、无页面异常，合成配置和统计账本字节不变。第一轮展开后立即读取 innerText 尚未稳定，增加既有 settle 后通过。截图已查看；沿用现有样式，与参考的差别是单 Agent 分类列表而非全应用矩阵。

阶段一 verify lint clean/fail 0、runtime audit、native 合成与 diff check通过。Browser plugin not available，使用现有 Playwright/Electron；仅 Windows 桌面视口，无移动端产品承诺。没有真实配置／凭据读取、配置执行、网络或打包验证。CodeGraph 不可用，以当前源码／定向搜索／测试核对。

## 阶段二边界

管理使用单独预览／应用流程，固定目标、并发修改保护和恢复机制。本地导入只读取用户这次明确选定的配置或目录；不自动安装依赖、不执行包脚本、MCP 或 hooks，不进行第三方网络获取。管理界面只在用户明确打开后显示本地配置项名称；现有命令／参数／URL、环境变量和请求头值不回显，未填写字段保留原值。管理名称不进入静态检查、用量账本、保存查询、统计导出或外部日志。

| 类别 | Codex 用户级／项目级 | Claude Code 用户级 | Claude Code 项目级 |
| --- | --- | --- | --- |
| MCP | `.codex/config.toml` 中 mcp_servers；编辑命令／参数／地址／连接方式，enabled 开关，本地配置合并导入 | 不覆盖混合账号 `.claude.json` | `.mcp.json`，对应拒绝列表在 `.claude/settings.local.json` |
| hooks | `.codex/hooks.json` 中 handler 指定字段与本地导入；总开关写 `.codex/config.toml` 的 features.hooks | `.claude/settings.json` 中 handler 和 disableAllHooks | `.claude/settings.local.json` 中 handler 和 disableAllHooks |
| Skills | `.agents/skills/*/SKILL.md` 元数据编辑，目录导入及启停 | `.claude/skills/*/SKILL.md` | `.claude/skills/*/SKILL.md` |

面板标明具体管理文件／目录；只读检查还可能包含未在管理面板编辑的其他文件，如 Codex config 内联 hooks 或 Claude 项目共享 settings。当前不编辑这些额外文件，不计算合并配置。hooks 开关作用于本文件层；Skill 启用仅表示目录位于对应技能目录，不覆盖客户端信任、skill overrides 或其他配置层。

Claude 项目 MCP 停用只增删本地 settings 的 `disabledMcpjsonServers`，恢复时只删除本文件的拒绝项，不写 `enabledMcpjsonServers`、不自动授信；其他设置层的拒绝仍可能生效。官方 [MCP](https://code.claude.com/docs/en/mcp#disable-a-server-without-removing-it) 区分这一设置与混合账号文件中的 disabledMcpServers，具体位置核对了 [settings reference](https://code.claude.com/docs/en/settings-reference#disabledmcpjsonservers)。文档 HTML 超出抓取限制后读取同站 Markdown 核对，不能据此称本机客户端真实生效。Codex enabled 字段核对 [OpenAI Docs 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。

编辑只接收受控字段，无法安全解析的复杂配置拒绝修改。受支持 JSON／TOML 会重新序列化，未修改的解析字段值保留，格式／注释不保留；这一点在应用前提示，撤销恢复原字节。Skill 编辑仅名称／描述，规范化前言，保留正文和其他可解析字段。管理为了备份／保留内容可读取选定 Skill 的完整文件，这不是扩大只读检查的 frontmatter 范围。

本地 JSON／TOML 导入只合并当前类别，最多 64 个新增键，遇到同名键拒绝、不覆盖，不复制其他类别或 auth 根字段。Skill 来源须是普通本地目录、先存在有效 SKILL.md，再读取目录内容；ASCII 目录名最长 64，最多 128 个文件／目录节点、8 层、单个资源 1 MiB、总量 4 MiB。拒绝链接／硬链接、UNC／相对路径、`.git`、auth／credentials／token／secret／env 类文件名和越限。脚本作为数据复制，不安装依赖、不执行。没有 ZIP／在线市场安装。

应用前比较预览所依赖文件和导入源的 SHA-256；实际替换前再次检查文件身份、链接与内容。普通文件通过同目录临时文件提交，新建使用独占目标链接避免覆盖；未通过一致性检查不写入。操作前必须调用 Windows safeStorage 加密恢复记录，失败时阻止修改，没有明文回退。配置编辑记录包含原始字节；目录移动／导入记录保存恢复位置和摘要，原文件或导入目录保留。非恶意并发修改有拒绝／撤销测试，但不能声称对抗任意文件系统竞态绝无窗口。

Skill 停用同根移动到 `.agent-usage/disabled-skills/<agent>/`；启用移回原技能目录，不做软链接。撤销导入将副本移到同根 `.agent-usage/undone-imports/`，不递归删除可能被其他程序编辑的目录。目标冲突或应用后已有新内容时撤销会拒绝。恢复记录保存在应用数据目录 `config-backups/*.bin`；只提供本次打开期间最近一次成功修改的撤销入口，尚无跨重启恢复历史 UI，不自动回滚其他程序的后续修改。

阶段二定向合成测试已覆盖配置修改／原字段保留、预览不写入、加密不可用、密文不含哨兵、原字节撤销、并发／陈旧预览／未知字段拒绝、Claude 拒绝列表不授信、按类别导入／碰撞／源版本变化、Skill 目录导入／启停／元数据正文保持、链接／超限／认证类文件拒绝、写入失败与撤销不删除新增文件。首次发现 Skill 撤销误走 JSON/TOML 解析器，修为原始字节恢复后通过，首轮日志保留。

最终原生 UI 在 100% 浅色／150% 深色通过预览→应用→撤销、Skill 导入／停用／恢复／编辑、MCP 本地导入／参数出错修正／编辑，以及重启不恢复范围。选择器返回值使用合成 fixture 替代，没有操作真实系统选择器或读取真实目录；面板未显示秘密值、未改用量账本。最终截图已查看：复用编辑面板，压缩字段的重复外边距后无横向溢出，操作可滚动到达。没有框架错误覆盖或页面／console error。现有 source-quota UI 在 100%／125%／150% 通过来源能力、新鲜度、独立生命周期、隐私、失败重试和窄布局回归。

最后加入“无有效 SKILL.md 时先拒绝，不读取其他包内容”和 UNC／相对路径拒绝测试后，最终 `npm run verify` 为 lint clean／`fail 0`；`npm run audit:runtime`、`npm run test:native`、`git diff --check` 通过，native 网络尝试 0、来源只读。日志在 `artifacts/agent-config-center-20261022/`，包括首次 Skill 撤销失败和修正后的结果；代码与测试在同一增量提交。两阶段分别提交后一起本地合入，不做源码 ZIP／发布代次。本增量没有真实配置／凭据维护、真实 MCP／hook／Skill 执行、网络安装或打包验收。
