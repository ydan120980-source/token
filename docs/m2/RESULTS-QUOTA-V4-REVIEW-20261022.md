# 当前额度页 v4 检查包验收（2026-10-22 发起，10-23 完成）

所有者要求“打包我检查一下当前状态”。本次建立独立代次 `dist/quota-v4-review-20261022/`，保留原 `dist/win-unpacked`。构建基于干净本地 main `032c914072ad8c0cad9f65bda46df9ba8e38412a`，包含 Claude 最新钱包口袋提交 `3666b56` 及此前额度页 v4、配置中心和统计性能增量。本轮不重新设计、不扩展后端业务或读取真实账号／配置；GitHub 同步继续暂停，无子代理。

## 本包内容

- 额度卡片随窗口分列、概况栏与卡片区对齐；“全部刷新”显式覆盖其他服务商连接，自动刷新范围仍为 Codex。
- Agent 柔化色调、额度时间线和多种卡片形态；已知重复连接同卡呈现但不叠加额度。
- 分层详情、资源折叠、筛选、整卡点击、长按拖动、Esc 取消与键盘排序。
- 最新实色／纸片票据和钱包口袋，修复票据向上遮挡标题；不改变未知值、积分包排除和 BigInt 精确加法规则。
- Codex／Claude 配置只读检查与显式管理、轻量 attention 遗漏计数修复、统计 owner 线程及恢复增量均保留。

本次打包前，原 `dist/win-unpacked` 的卡片 JS、页面 CSS、tokens 与当前源码不同；本代独立构建，不把旧包结果移记到新包。

## 执行与环境

Windows x64，Electron 43.4.0、electron-builder 26.16.1。主构建目录的 node_modules 为真实目录，固定 tokscale 4.17.0 校验通过。工作在 `codex/release-quota-v4-20261022` 主题分支及已有自有 worktree，构建使用共享 main 的完整依赖。

Browser plugin not available，沿用项目已有原生 Electron／Playwright 套件。每个 UI 套件指定本代 EXE、独立 usage／quota／合成 home；配置目录选择器为合成替身。不运行 validate:local，不执行配置的 MCP／hook／Skill，不安装真实 Agent，不触发真实凭据或服务商查询。本轮不重跑源码全套 UI 或性能长测。

## 已执行检查

- `npm run verify`：lint clean，单元测试 fail 0。
- `audit:runtime`：通过，149 个可达产品模块，无退役入口或开发 harness 导入。
- `test:native`：新合成目录、固定 native 对照 694 Token，来源只读、Node 网络尝试 0。
- `test:stress`：SQLite 重复采集、WorkBuddy 增量、采集并发／关闭、额度队列、RPC 分片／溢出及统计投影通过。
- `experiment:crypto`：独立进程的密钥／篡改／重放／重复拒绝验证通过。
- 构建与 `audit:package`：233 个源码／资源／文档与 ASAR 逐字节一致，外置 helper 与固定 native 一致。
- 全部打包 UI：全部 37 个 scripts/m1/*-ui-test.js 对本代 EXE 顺序执行，首轮全部通过。涵盖最新 quota-v4、同账号、Provider、配置中心、usage、workbench 和 interaction-reliability 等，EXE／ASAR 首尾哈希一致。
- ZIP CRC、路径检查及中文空格路径解压：88 个文件、432771222 字节，逐文件内容和 SHA-256 与构建目录一致。
- 解压副本：从中文空格路径的实际解压 EXE 运行 agent-recovery 与 quota-v4，两个套件首轮通过；实际合成采集／native 对照及 100% 深色、150% 浅色的 v4 交互得到验证。
- 截图检查：已查看打包版 100% 深色／150% 浅色的额度页与 WorkBuddy 详情四张截图；这些捕获状态未见明显票据遮挡标题、横向溢出或详情布局缺陷。不是物理 DPI 或全部显示环境的验收。

UI 驱动识别包括 QUOTA_V4_EVIDENCE_DIR、CONFIG_UI_EVIDENCE 在内的各套件证据变量，避免把新套件的结果丢在系统临时目录；旧 usage／quota 套件的固定位置证据另归入本代。EXE／ASAR 在 UI 前后核对哈希，最终再核对全部运行文件及 Windows ZIP。

## 证据与交付

本轮证据：`artifacts/quota-v4-review-20261022/`。包含 headless、build／audit、packaged-ui、extracted-ui、extraction.json 与 delivery-verification.json。每个 suite 保留独立日志、返回码和截图；如有首次失败，必须保留并在此说明。

运行目录、Windows ZIP、源码 ZIP、交付 JSON 和 SHA256SUMS 位于本代 dist 目录。最终交付脚本核对源码 ZIP 与已提交 Git blob／工作树一致、无运行数据或凭据，复核运行目录／解压副本／ZIP 未因测试改变。精确源码提交与哈希以交付 manifest 和 delivery-verification.json 为准，避免把归档自身哈希循环写入内含文档。未执行跨代次硬链接共享。

## 限制

这是未签名便携运行目录／ZIP，不是已签名安装器。合成验收不证明本轮真实账号、真实分页、真实配置维护、物理 IME、Windows 安装／卸载／自启、所有显示环境或长期无泄漏。既有性能持续测试实际 24.94 分钟／99 次刷新，结论不被本轮改写。历史账号真实验收仍以对应记录为准。

没有新 UI 样式或业务功能改动；不 push、不 PR、不删除旧包或其他会话工作树，不自动开始其他 Backlog。
