# 成本定价与设置清理：本代实现与已执行检查（2026-10-04）

本代目录 `dist/pricing-20261004/`。开发基线是 `dist/m2-desktop-20261004/`（未做任何 reset/clean，也未恢复已退役实现）。
本代只做两件事：把设置页被黄圈标出的两处 UI 删掉，并深度优化成本定价。

## 1. 删除设置页两处 UI

- 删除 `清空统计并暂停` 按钮与它下方的灰色 notice 长条（`本地采集与账号额度各自独立。模型名按日志字段展示；统计不会自动归属到账号。`）。
- 连带清掉的死代码：`src/quota/preload.js` 的 `clearStatistics`、`src/quota/main.js` 的 `usage:clear` 处理器（该处理器在删除按钮后已无任何调用者）。`src/` 与 `design/desktop-reference/` 下已零残留。
- 被删提示的正文没有丢：完整并入 `design/desktop-reference/preview.js:569` 的 `#collectionHelp`（只读五来源分支），暂停/恢复语义不变。
- `#settingsPause` 的 `role="switch"` 与 `aria-checked` 从原 `maintenance-ui.js` 迁到 `preview.js:522`，因为它才是该控件的权威写入者。
- `scripts/m1/usage-ui-test.js` 同步改写：不再点击已删除的按钮，改为断言「暂停后总量仍为 704，历史行数不变」，重启后按实测行数比对。
- `README.md:17` 中「确认清空统计并暂停」的描述已改为暂停/恢复语义。

## 2. 成本定价优化

**构建期零网络同步**（运行期仍然完全离线）
- 新链路：`fetch（人工/CI）-> .cache/openai-pricing.md -> scripts/m1/pricing-sync.js -> src/m1/prices.json`。
- `scripts/m1/pricing-sync.js` 只 require `node:fs`/`node:path`/`node:crypto`，**自身零网络请求**；快照随源码一起被审阅，重生成总是从确切字节复现。
- 只按**表头签名精确匹配**认表：旗舰 9 列（仅 `Standard pricing data` / `Grouped Pricing Table data`）与专用 5 列（仅 `Standard` 档且类别 ∈ Codex/ChatGPT/Search/Life Sciences）。Batch/Flex/Fast/Ultrafast、Embedding、Moderation、微调、按分钟或按模态计价的表一律显式记入 notes 并忽略，不猜列。
- 冲突即失败（`PRICING_SOURCE_CONFLICT`），读不懂的金额即失败（`PRICING_SOURCE_UNREADABLE`），不把未知当 0；非 openai 条目字节不变地沿用。
- 详见 [PRICING-SYNC-20261004.md](../m1/PRICING-SYNC-20261004.md)。

**补全模型**：新增 4 个此前永远取不到价的 openai 键 —— `chat-latest`（5/0.5/30）、`gpt-5.3-codex`（1.75/0.175/14，Standard 档）、`gpt-rosalind-research`（5/0.5/25）、`gpt-5-search-api`（1.25/0.125/10）；单位 USD/百万，`cacheWrite` 按官方不单列记 `null`。目录由 94 键增至 100 键，其中 openai 50（含 4 个别名）。Fast 档 gpt-5.3-codex（3.5/0.35/28）只写进说明，不作为默认价。

**前端拆分为可测模块**：`maintenance-ui.js` 从 56 行巨型单行 innerHTML 拆为
`pricing-data.js`（纯函数：分类/筛选/分组/缺口/试算文案）、`pricing-view.js`（HTML 生成）、`pricing-controller.js`（事件与 IPC 编排）、`codex-maintenance.js`（Codex 预览/应用），`maintenance-ui.js` 只保留「保证容器存在」。三者均为 UMD，可被 `node --test` 直接 require。
面板新增：按来源范围（全部/已定价/待核实/未定价）与关键词筛选、按 provider 分组并显示「N 个模型 · 未定价 X · 待核实 Y」、目录版本与 hash 行（`计价依据 <version> · 获取于 <时间> · 目录 <sha 前 10>`）、已定价计数、未定价明细可点回填、编辑前的只读试算（`usage:priceProbe`，返回受影响记录数与金额范围，不写盘）、价格模板仅列 official/manual 来源。

## 3. 已执行的检查

| 检查 | 结果 |
| --- | --- |
| `npm.cmd run verify`（lint + 单元测试） | exit 0，75 tests / 75 pass / 0 fail |
| `npm.cmd run test:native` | exit 0，`{"status":"passed","records":6,"tokens":694,"engine":"tokscale/4.17.0","nodeNetworkAttempts":0,"sourceReadOnly":true}` |
| `npm.cmd run test:stress` | exit 0，6 场景全 passed |
| `npm.cmd run governance` | exit 0，`PASS: unified entry, frozen runtime, minimal dependencies, offline collector and independent keyring quota boundary.` |
| `npm.cmd run pricing:check` | exit 0，`OK: rebuilt official-review-2026-10-04 sha256 bfe0e15bb4… (100 models, 50 openai)` |
| 重生成幂等 | 用快照重跑 `pricing-sync` 写入副本，与出货 `src/m1/prices.json` SHA-256 逐字节相同 |
| `node scripts/m1/audit-package.js dist/pricing-20261004/win-unpacked` | exit 0，`PASS: 82 source/assets/docs match ASAR byte-for-byte; runtime package metadata matches.`（重打包后复跑仍通过） |
| 设计服务器 HTTP 冒烟 | `/pricing-data.js`、`/pricing-view.js`、`/pricing-controller.js`、`/codex-maintenance.js`、`/preview.js`、`/maintenance.css` 均 200；目录穿越与白名单外文件 404 |
| `npm.cmd run dist:share` + `dist:share:verify` | exit 0，status OK，82 组跨代共用，`failures: []` |

压力场景逐项：SQLite 重复采集 160,000 记录 / 3 轮 / databaseUnchanged true；WorkBuddy 明细增长 8,000 记录 / 960,000 token；采集重叠与关停 200 并发刷新 / 实际采集 1 次 / maxActiveChildren 1；额度队列风暴 20 账号 / 1,000 批量 / 20,000 次请求 / 实际读取 1,000 / pendingAtEnd 0；RPC 分片 2,000 / 超长帧被丢弃；大统计投影 20,000 行 / 3,000 次图表计算 / 2,000,000 token。

## 4. 未执行与不得声称

- `npm.cmd run test:ui` 在本机稳定失败于 `Error: Process failed to launch!`（`node_modules/playwright-core/lib/coreBundle.js:44106`），属于**环境阻塞，不是代码缺陷**；因此面板的端到端点击流本次**未执行**，只能由单元测试与前端冒烟覆盖。同类 UI 脚本（`test:quota:ui`、`test:stress:ui`、`test:visual:ui`、`test:motion:ui`、`test:detail:ui`、`test:polish:ui`、`test:desktop:performance`）依赖同一个启动器，同样未执行。
- 未做真实账号验收：没有真实登录/登出，没有连接真实用量来源；`validate:local` 未运行。
- 未做物理 DPI、鼠标窗口按钮、数小时运行、真实休眠恢复、干净机器与代码签名验收。本代未签名。
- 未宣称稳定 60 FPS；性能数字是合成负载下的同步提交耗时，不是长时间分位数。
- `catalogHash()` 已就绪但**尚未接线**：「内置价已更新，是否重算」的提示目前不会弹出，属于已知未落地项。
