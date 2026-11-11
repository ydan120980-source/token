# 配置中心与 Windows 发布代次验收（2026-10-22）

最终候选 `config-center-20261022-r2` 已通过本记录所列合成发布验收。首包失败、修复及复验完整保留；这不等于真实账号／配置或安装器人工验收。

## 范围与构建

所有者先要求继续配置面板的局部可用性步骤，再明确要求正式打包验收。面板实现提交 `95471da`、本地合入 `f4f539f`；后续验收修复提交 `7dab120`、本地合入 `ea78de0`。最终包基于 `ea78de0b50aa5e64e8a69b0ee5d1bfe781f69266`，保留此前配置可靠性修复与另一会话的统计性能增量。首代次 `dist/config-center-20261022` 保留，最终交付为 `dist/config-center-20261022-r2`；未覆盖旧交付，没有执行跨代次 runtime 去重。

构建使用共享 main 的真实 node_modules，electron-builder 26.16.1／Electron 43.4.0，Windows x64 目录形式；构建器明确跳过所有者签名和资源编辑，交付是未签名便携目录／ZIP，不能称为已签名安装器。最终源码在此包通过后只补充本验收文档，精确源码提交由交付 manifest 的 sourceCommit 记录；ASAR 再次按当前源码审计。

本轮仅合成目录、账本、账号响应和原生选择器替身。没有维护真实配置、读取真实凭据、请求真实账号、执行配置的 MCP／hooks／Skills、安装真实 Agent、上传或 GitHub 操作。

## 已完成的源码和无界面检查

- 源码完整 verify：lint clean／fail 0；运行依赖审计和 diff check 通过。
- 受影响源码配置 UI：100% 浅色／150% 深色，增加 680 高度状态，应用操作始终位于滚动正文之外且窗口内，分类说明正确，原有写入／失败／撤销流程通过；截图已查看。
- Native：固定 tokscale 4.17.0，合成 694 Token 对照，Node 网络尝试 0、来源只读。
- Stress：160,000 条 SQLite、三轮采集与独立 native 对照、WorkBuddy 追加、采集重叠／退出、额度排队、RPC 分片／溢出、20,000 行投影均通过，网络尝试 0。此压力场景的事件循环和内存采样不等同产品性能指标。
- Crypto：独立发送／接收进程，错误密钥、篡改、重放和重复拒绝，密钥不落盘。
- 构建及 audit:package：当前源码／资源／文档与 ASAR 逐字节匹配，运行元数据一致，外置 PowerShell／C# helper 与固定 native 哈希匹配。

## 打包界面验收

清点所有 `scripts/m1/*-ui-test.js`，每个脚本都必须包含打包 EXE 入口和独立 usage／quota／fixture home 参数；逐个对同一生成 EXE 执行，避免窗口焦点与测试负载互相干扰。最终 r2 全部通过，EXE／ASAR 首尾哈希一致。完整清单、每个脚本日志、时间与返回码在 `artifacts/config-center-release-20261022/packaged-ui-r2/`，源码全套 UI 没有在发布阶段重复运行。

覆盖用量、额度与供应商连接、同账号／分页提示、来源安装／恢复、统计线程、会话、费用／预算／定价、配置检查／本地管理、诊断、连续性、布局／视觉／动画、交互可靠性和工作台。各套件按其支持的 100%／125%／150% 缩放及浅／深、窄窗口状态运行；不是每个套件都具有全部组合。已查看打包版配置面板浅／深 680 高度预览、预算遗漏提示、来源已保存但发现失败等截图；关键控件可达，无观察到的明显遮挡。测试没有页面／console 阻断错误，不将自动事件模拟写成物理 Windows IME 人工验收。

首轮预算总览遗漏计数注入、交互可靠性的来源失败注入超时：旧脚本修改主进程 Store／Service 原型，但当前统计所有权已在独立线程，假数据未作用到实际请求。首轮完整日志和失败截图在 `packaged-ui-first/` 保留。预算脚本在保留实际 sender-guarded 请求的基础上包装工作台／attention 的合成 projection；交互脚本在实际 owner-command 边界注入保存、发现、延迟和采集错误。仍保留原有遗漏计数、保存字节、历史保留、忙时保护及恢复断言，未放宽结果；在原首包的 `harness-recheck/` 中复验均通过。

定向复核又发现实际产品字段遗漏：轻量 attention 未保留普通诊断 omittedIssues。新真实统计 owner 回归先复现完整结果有 11 项未返回、轻量结果 undefined，修复后普通与预算遗漏计数独立且账本字节不变。为此重新构建 r2，并对最终包重跑全部 UI，而非用旧包结果替代。详见 `ATTENTION-SUMMARY-CONTRACT-20261022.md`。

## ZIP／解压副本及交付

Windows ZIP 已解压至 `artifacts/config-center-release-20261022/解压 验收副本/win-unpacked`，路径同时包含空格与非 ASCII。88 个文件、432,706,657 字节的文件集合、大小和逐文件 SHA-256 与构建目录一致。验证记录为 `extracted-verification.json`。

从该解压副本 EXE 运行 `agent-recovery-ui-test.js`，OpenCode／MiMo 首次归属场景在 100%／150% 都通过：实际合成采集、native 140 Token 对照、恢复估算 USD 1.80、未知费用不当零、来源哈希不变、页面无错误。日志与结果在 `extracted-ui/`，没有使用源码 Electron 替代该副本。

交付目录保留 `win-unpacked/`、`AgentUsage-CodexQuota-Windows-x64.zip`、`AgentUsage-CodexQuota-source.zip`、`AgentUsage-CodexQuota-delivery.json` 与 `SHA256SUMS.txt`。源码 ZIP 仅来自提交后白名单文件，显式使用本记录替代工具默认旧 R15 文档。最终生成后逐项验证源码 ZIP 内容与干净提交检出一致、无运行数据／凭据／构建目录，Windows ZIP 哈希与已测解压 ZIP 一致，manifest 和 SHA256SUMS 匹配。具体字节与哈希以交付记录及 `delivery-verification.json` 为准，避免把源码 ZIP 自身哈希循环写进其内含文档。

本次顺序是 verify／native／stress／crypto／runtime → 构建 → audit:package → 所有打包 UI → ZIP 解压／全文件比对／采集恢复 → 最终文档与源码归档／校验。每次 UI 都指定 `QUOTA_PACKAGED_EXE`，测试脚本自己设置隔离的 usage／quota／fixture home。首包、修复复验、最终包和解压副本证据分开保存。

## 限制

自动验收不证明真实账号／本地配置维护、真实系统选择器、第三方客户端最终生效、所有者签名、Windows 安装／卸载或开机自动运行。没有重新执行另一会话的 60 分钟性能长测；其所有者提前结束的实际时长和刷新数仍以 `RESULTS-PERFORMANCE-20261022.md` 为准，不改写结论。

Browser 插件和 CodeGraph 本轮不可用，分别采用项目已有 Electron／Playwright与当前源码／定向测试；没有安装新浏览器依赖。发布只在本地完成，GitHub 同步继续暂停。更多 Agent 配置适配、在线市场、真实配置验收或其他 Backlog 未随本次交付自动开始。
