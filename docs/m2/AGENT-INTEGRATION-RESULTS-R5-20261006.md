# Agent Usage 接入 — 第五版候选验收

日期 2026-10-06，独立候选 `dist/agents-20261006-r5`，主线 `m2/agents-r4`。产品代码对应提交 `913c7c1`，测试与打包脚本对应 `ac9733a`。主开发自 2026-10-06 起为 Claude Code（见 `docs/SCOPE-LEDGER.md`）。用户决定不再派第四轮独立复验，改为用顺序无关测试收口快照选择逻辑；本记录为主线程验收，不代表独立审查通过。

## 修复

1. **快照选择顺序无关**（`c512388`）。原规则下：无效副本先读到会挤掉有效副本；"较小完整 / 较大缺字段"两份副本，结果取决于先读到哪份。新规则经用户确认（总量大的优先）：有效优先于无效，其次总量大的优先，缺字段则分类和费用显示未知；总量相等时，按质量、已知字段和模型信息选择，最后用规范值决胜。同总量 measured 冲突仍暂停计价。`tests/m1/snapshot-order.test.js` 覆盖：纯函数层四份以内观测的全部排列；真实 OpenCode/MiMo 扫描层的全部两两组合加 7 组三元组；持久账本分次入账加重启。
2. **采集被整体冻结**（`96d352e`）。native 核对复用固定路径和 `TOKSCALE_CONFIG_DIR`。tokscale 的 source-message 缓存假设文件只追加，投影中间一旦少了一条记录，之后每轮都报 `NATIVE_TOTAL_MISMATCH`，整轮采集被丢弃。现在每次核对使用全新临时目录，用完删除；`test:native` 增加"移除中间记录"回归检查。
3. **DeepSeek Harness 定价**（`96d352e`）。记录的提供方是 `workbuddy-xdpool`，实际按 `deepseek/…` 计价。缓存写入价为 0 时的豁免原先只认记录上的提供方，现在改按解析后的价格判断：写入价为 0 时，写入量未报告不影响费用，结果精确。
4. **界面**（`913c7c1`）。
   - 费用悬停：按钮保持不缩放的稳定感应区域，只有内层缩放；"+"保留占位、淡出。真实鼠标测试：修复前 1.5 秒内切换 230 次，修复后进入、离开各 1 次。
   - 页头：头像、时间范围和图标按钮合为一行。
   - "日均"成为一项事实数字，并附"今日 ±N%"标签。
   - 趋势图：Agent 改为可换行的"图标 + 名称"胶囊，有记录的排在前面，无记录的变淡。
   - 合成预览：修复 9 个 Agent 下显示 `$NaN` 的问题。
5. **测试基础设施**（`8b8c78a`、`ac9733a`）。
   - Playwright 1.63 的 `page.waitForFunction` 遇到 async 判断会立即放行（已实测），8 处等待改为 `until()` 真实轮询。
   - 恢复测试改为等页面稳定后再确认视图。
   - 自定义下拉框遇到滚动偏移就会关闭，`selectVisible` 改为最多重开三次。
   - visual 测试不再要求 10-05 起有意显示的趋势说明保持隐藏。
   - 交付记录改用 LF 换行。

## 真实数据核对（用户要求的只读审查，仅汇总）

- **今日 Claude Code**：真实来源解析得到 100 条，19,368,864 token（claude-opus-5-5）。用户应用账本的最后一次成功采集是 `2026-10-06T04:15:54Z`，之后全部采集被 native 失配丢弃，九个来源都未入账。
- **native 核对**：全新目录下九来源逐项通过，合计 4,647,980,239 token。
- **账本副本模拟**（在临时副本上入账，原账本未改动）：DeepSeek 定价覆盖率从 0% 升至 98.7%；今日 Claude Code 22,826,856 token 正常入账。

## 主线程验收

- **非界面检查**：
  - verify：ESLint 加 109/109 单元测试。
  - native：含缓存回归检查。
  - 六场景 stress、synthetic crypto。
  - runtime audit：44 个模块。
  - package audit：ASAR 104 项与源码逐字节一致，比 r4 多出 `pencil.svg`。
- **源码模式界面**：13/13 通过。包括 usage、nine-source、overview、continuity、functional、motion、detail、polish、visual、activity、quota、conflict、recovery。
- **Windows 打包版**（`QUOTA_PACKAGED_EXE`）：13 个界面测试中 12 个首轮通过。polish 首轮在窗口最大化等待处超时，复跑 2/2 通过，记为偶发。
- **解压验收**：测试 ZIP 的 CRC 正确，84 个文件逐字节一致，解压到 `artifacts/m2-agents-r5/extracted/验收 解压 r5`。
  - nine-source、quota、conflict、recovery、usage 均通过。
  - functional 在助手修复前 11 次失败 3 次（同期源码模式 0/6 失败），修复后 6/6 通过。
- **证据**：`artifacts/m2-agents-r5`。所有界面运行使用独立 usage/quota 目录和合成 fixture home；构建时 electron-builder 下载了 Electron 运行时。

## 已知限制

- 自定义下拉框在页面滚动偏移时关闭（设计如此），重新渲染时浏览器的滚动锚定也可能触发关闭。
- polish 的窗口最大化等待偶发超时。
- 定价相关：
  - OpenCode 免费模型（如 `qwen3.6-plus-free`）有缓存写入量但目录无写入价，约 7% token 未定价，需要手动设价。
  - Codex 新 GPT 模型未报告缓存写入，费用以区间显示（"+"）。
  - Codex 有 188 条 total-mismatch 记录未定价。
  - DeepSeek 有 56 条缺缓存命中量，未定价。
- 同一次扫描内，较新副本先读到时，较旧副本仍报 `SOURCE_USAGE_REGRESSION`，该诊断仍随读取顺序变化。
- Gemini/Cursor 没有真实样本；Harness 与 ZCode 的已接受限制同 r4。
- 用户当前运行的旧版应用需替换为 r5 才能恢复采集。`%APPDATA%\AgentUsage-M1\tokscale` 与 `projection` 目录已不再使用，但未删除。

## 交付

r1–r4 不再需要保留（用户 2026-10-06 指示），本轮未删除。r5 为独立目录：`win-unpacked`、源码 ZIP、交付清单和 SHA256SUMS。源码 ZIP 排除真实输入、日志、数据库、认证、应用数据、依赖运行时、缓存与截图。
