# 客户端登录复用与 Chrome 授权验收（2026-10-21）

本轮先实现所有者指定的第一类能力：复用已登录 WorkBuddy 桌面客户端，随后完善 Cursor 客户端复用、ZCode Chrome 设备授权和已有客户端来源的默认选择。范围与固定版本参考来源见 [实施决定](CLIENT-LOGIN-CONVENIENCE-20261021.md)。所有者在新版 WorkBuddy 窗口打开后明确选择“先继续完善代码，稍后实测”；窗口已关闭，本轮没有读取真实客户端凭据或请求真实服务商额度。

## 实际行为与限制

- WorkBuddy：明确点击连接／刷新后，读取固定当前认证文件的必要字段；加密 access token 只通过经过签名、产品身份与 SHA-256 检查的官方程序兼容辅助打开。辅助进程受 Job Object 和输出／时间限制，不复制或轮换外部 refresh token。固定国内账单接口按资源包保留精确额度与有效期；国际版不跨域回退。当前只取第一页，覆盖标为不完整。真实辅助、登录及账单响应仍待用户验收。
- Cursor：明确连接／刷新后，固定客户端数据库键在内存 SQLite 中读取，覆盖已提交 WAL；不创建源 shm、不修改数据库、不读 Chrome。只派生固定会话字段，额度验证成功才加密保存。没有可用账号，本轮只做合成验收。
- ZCode：新增独立设备授权来源，日常 Chrome 完成登录后自动接收主 token，再读固定 ZCode 额度接口。每次授权使用随机流程 secret、固定轮询地址、HTTPS 浏览器域白名单和超时／取消处理。不导出额外服务商 token、不兑换 key、不领积分、不请求模型。与原有 Z.ai／BigModel API key 路线分开；账面与可用桶不相加。
- Codex 继续使用 Chrome 官方授权；Claude、Gemini、Antigravity 继续使用既有官方独立 CLI 路线；OpenCode、DeepSeek 等已有客户端／环境 key 复用优先显示。客户端存在、授权页打开、凭据得到和额度验证成功分别判断。Antigravity 仍有兼容 CLI 前提，未新增桌面守护进程或系统凭据库扫描。
- MiMo 与 DeepSeek 网站套餐保留手动来源。参考项目的浏览器 Cookie／网站存储导入不属于本轮授权的浏览器范围，没有伪造通用 OAuth 回调。API key 额度不能当成网站套餐额度。

账号变化会拒绝把新客户端凭据接到旧账号，保留旧额度观测并要求重新连接。启动恢复不读取外部认证、不自动查额度；保存值使用现有 Windows safeStorage 加密库。连接前、后台用量及静态配置检查均不触发新客户端读取。没有改动 CSS、设计 tokens 或布局；GitHub 写操作与同步保持暂停。

## 源码验收

- `npm run verify`：ESLint 通过，单元测试 fail 0。新增固定文件／链接拒绝、加密信封与篡改、签名映像绑定、账号切换、Cursor UTF-16 与有效期、ZCode 授权／取消／超时／重定向、精确账单字段和来源选择测试。测试全部使用合成文件、响应及注入进程能力。
- `npm run audit:runtime`、`test:native`、`test:stress`、`experiment:crypto` 通过。原生采集夹具只读，Node 网络尝试为零；压力测试覆盖 SQLite 重复采集、重叠关闭、额度队列、RPC 分片及大统计投影，不是服务商负载测试。
- 受影响的源码 provider-client、provider-login、provider-quota、source-quota、interaction-reliability、usage、workbench 套件最终通过。首轮 provider-client 的新增 Cursor 夹具误用普通 Bearer 文本，改为实际 Cookie 格式后 100%／150% 复跑通过；产品凭据检查与失败保护没有放宽，初次失败及复跑日志保留。
- WorkBuddy 辅助 PowerShell 通过 AST 静态语法检查，没有执行真实辅助或读取真实认证文件。

## 本地集成与正式候选

实施提交 `267d9f6`，通过合入门槛后，以 no-ff 本地合入 main `ad4267a87e20aa6229f353dfd44173a765fe7d79`。合入前核对共享 main 干净、无进行中合并、index lock 或其他 Git 进程。没有 push、PR 或远程合并。

`npm run dist:win:dir -- --config.directories.output=dist/client-login-20261021` 成功；使用共享 main 的物理 node_modules，预构建 tokscale 版本及 SHA-256 检查通过。`audit:package` 通过，216 个源码、资源与文档和 ASAR 逐字节匹配。运行时由上述 main 提交构建，后续验收补丁仅含测试与本文，最终提交以 manifest 的 acceptanceCommit 为准。验收补丁合入前再跑 `verify`（ESLint 通过、fail 0）及 `audit:runtime`，均通过。

打包版全部 32 个 `scripts/m1/*-ui-test.js` 首轮通过，包含 workbench、usage、interaction-reliability、预算总览及新增登录来源。查看截图时发现 provider-client 在关闭动画中途采样，测试增加等待真实 dialog 关闭和有限动画结束，打包版 100%／150% 单独复跑通过；检查稳定截图确认遮罩已关闭。该验收补丁只改测试步骤和本文，不改运行时、样式或断言强度。

Windows ZIP 通过 CRC，88 个文件与构建目录及中文空格路径解压副本逐字节一致。解压副本的 agent-recovery、provider-client 和 quota 三个套件全部通过，覆盖实际合成采集、客户端连接选择、取消／失败保护、加密恢复与额度刷新／错误／重启。真实认证和服务商请求仍为零。

交付目录为 `dist/client-login-20261021/`，包含完整 `win-unpacked/`、Windows ZIP、源码 ZIP、交付 manifest 和 SHA256SUMS。源码归档只选择已跟踪文件，最终对照 main 工作树和 Git blob；ZIP CRC、原构建／解压副本的每个文件及 Windows ZIP 未变校验由 `delivery-validation.json` 记录。没有执行 runtime hardlink 共享或删除旧代次，manifest 不把可用脚本当作已执行步骤。

证据保存于 `artifacts/client-login-20261021/`：构建日志、`source-evidence/`（包含初次失败和复跑）、辅助语法检查、`packaged-ui/suite-results.json`、`packaged-ui-rerun/suite-results.json`、`extraction.json`、`extracted-ui/suite-results.json` 及最终 `delivery-validation.json`。不将 artifacts、真实数据或认证文件放入源码归档。CodeGraph 不可用，以定向源码、依赖审计及上述实际测试核对；没有调用子 Agent。

## 真实验收状态

本轮真实账号验收由用户明确推迟。WorkBuddy、DeepSeek、ZCode、Antigravity 只有用户表示账号可用，没有完成真实连接或额度读取；Cursor、MiMo 无可用账号。历史 Codex 成功记录仍只代表当时验收，本轮未重查。合成接口成功、加密恢复和浏览器分派不能证明服务商当前账号可用，不能报告“所有 Agent 一键登录已真实通过”。

没有执行真实浏览器／认证读取、模型调用、网络治理、现有配置修改或 GitHub 写操作。程序未做代码签名；长期服务商变更、真实输入法候选窗与屏幕阅读器人工验收未执行。既有交付代次保留。
