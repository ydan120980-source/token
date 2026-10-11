# 变更记录

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构，版本号遵循语义化版本。

## [Unreleased]

### 修复

- 悬停估算金额展开区间时，大数字右侧的 Token / 记录 / 日均不再换行，下方的近 30 天柱与今天卡片不再整体下跳；区间缩放到原有宽度内。
- 近 30 天柱、日历、每小时点阵和单日小时柱的浮层改为出现在指针旁，矮柱的浮层不再远远浮在整列顶端；键盘聚焦时仍贴在元素上方。浮层更紧凑。

### 安全

- `@tokscale` 原生二进制在每次 spawn 前按固定 SHA-256 校验，不符时以 `NATIVE_BINARY_MISMATCH` 拒绝；`npm run audit:package` 同时核对打包目录 `app.asar.unpacked` 中的副本。构建仍未签名。

## [0.1.0] - 2026-10-08

首个发布版本。Windows 本地优先，完全离线。

### 新增

- **九来源本地用量采集**：Codex、Claude Code、OpenCode、WorkBuddy、MiMo Code、Gemini CLI、Cursor、ZCode、DeepSeek Harness，全部只读解析，来源白名单见 `src/m1/policy.js`。
- **用量界面**：累计 / 今日 / 7 天 / 30 天范围筛选；总览卡片、单日趋势、全年活动热力图、模型明细与分类构成。
- **成本估算**：基于内置 models.dev 定价快照，支持手动同步公开价格；未知保持 `null`，未定价不当作免费。
- **Codex 额度监控**：通过官方 CLI 子进程读取套餐、剩余窗口与刷新时间，凭据存于系统 keyring；支持多账号连接管理与独立 home。
- **来源管理**：逐来源状态、手动添加本地目录；拒绝 UNC 路径、认证类文件名与产品数据目录重叠。
- **统计导出**：仅导出白名单字段的快照 JSON。
- **增量采集**：文件监视 + 变更戳（stamp）机制，未变化的来源不重新解析；缓存失效自动回退全量扫描。

### 安全

- 四条硬边界：不读认证文件、不改源数据库/配置、不上传数据、不发起非预期网络请求。渲染层 CSP `connect-src 'none'`。
- 主进程全量硬化：禁用运行时网络请求、单实例锁、`contextIsolation` + `sandbox`、IPC 发送方与主框架校验、拒绝窗口打开与外部导航。
- 价格同步在独立子进程中运行，环境变量白名单裁剪，16 MB / 15 s 上限。
- Codex 凭据存储强制为系统 keyring（`cli_auth_credentials_store="keyring"`）。
- 损坏的存储文件被移入 `quarantine/` 而不是终止启动，原始字节保留；来源侧（JSONL/数据库/压缩帧）的损坏早已按文件隔离处理。

### 已知限制

- 构建未签名，`@tokscale` 原生二进制不校验哈希。
- 没有从 `backups/` 自动回滚历史数据的入口；损坏文件只做隔离，不尝试修复。
- 原生交叉验证失败会丢弃整轮采集结果。
- Gemini CLI 与 Cursor 仅有格式合成样本，无真实调用样本验收。
- ZCode 无官方数据库合同。
- 首次统计 2 万行数据时主线程阻塞约 334–364 ms。
- 物理 DPI 缩放、Windows 窗口吸附与长时间运行未系统化验收。
- 无 CI 之外的内核级网络审计；网络封锁为 Node 层拦截。

[0.1.0]: https://github.com/ydan120980-source/token/releases/tag/v0.1.0
