# Agent Usage 第七版候选验收

日期 2026-10-07，独立候选 `dist/agents-20261007-r7`，主线 `m2/agents-r4`，主开发 Claude Code。授权见 `docs/SCOPE-LEDGER.md` 2026-10-07 各条。本记录为主线程验收，不代表独立审查通过。

## 包含的提交

| 提交 | 内容 |
|---|---|
| `e86e0ee` | 采集减负：常驻采集 worker 按文件缓存解析结果；源未变时跳过解析、校验、入账和写盘；账本内容不变不写 `statistics.json` |
| `c141eaf` | 未报告口径（来源不记录 / 含在输出中）；数据质量提示不再算读取失败、不再退避；成本去向、用量占比、活跃时段、效率四张卡；小时行覆盖全部历史；定价模型列表收起 |
| `3859657` | 排版：使用习惯两栏、去重复事实、趋势 Agent 筛选一行 |
| `fdc5318` | API 等价估算放大（clamp 68–116 px），说明合为一行 |
| `6fda329` | overview 界面测试改为新口径：无来源记录的字段显示"来源不记录" |

细节与真实数据测量见 `docs/m2/INSIGHTS-20261007.md`。

## 主线程验收

- **非界面检查**：verify（ESLint + 116/116），native（`passed`，694 token，tokscale 4.17.0，无网络），stress（无失败项），synthetic crypto，runtime audit（48 个模块）。
- **package audit**：ASAR 111 项与源码逐字节一致，比 r6 多 `insights.css`、`insights-math.js`、`insights.js`。
- **源码模式界面**：13/13（按退出码判定）。
- **Windows 打包版**（`QUOTA_PACKAGED_EXE`），共三轮完整运行：
  - 第一轮 10/13：overview 失败是测试仍断言旧文案"缓存写入未报告"，源码模式同样失败，属真实的测试与新口径不一致，已在 `6fda329` 改正；quota（合成登录取消按钮等待超时）与 detail（悬停展开未生效）在源码模式通过。
  - 第二轮 11/13：agent（截图超时）与 activity（切换范围后热力图日期断言）失败；随后两项各复跑 2/2 通过。
  - 第三轮 13/13 首次全部通过。
  - 判断：第一、二轮的 quota、detail、agent、activity 失败为时序偶发，未复现；运行期间用户本机的 r6 应用每 2 分钟一次约 18 CPU 秒的扫描可能加剧时序抖动（推测，未验证）。
- **解压验收**：测试 ZIP 的 CRC 正确，84 个文件逐字节一致，解压到 `artifacts/m2-agents-r7/extracted/验收 解压 r7`（路径含空格与中文）。在解压副本上运行 agent、quota、agent-conflict、agent-recovery、usage、functional，6/6 首轮通过。
- **证据**：`artifacts/m2-agents-r7`（`windows/logs-run1`、`windows/logs`、`windows/logs-run3`、`extracted-evidence/`）。构建时 electron-builder 下载了 Electron 运行时。
- 所有界面运行均使用独立 usage/quota 目录与合成 fixture home。另在 Electron 中以本机账本副本（采集关闭、用后删除）做过版面截图检查，不作为测试。

## 已知限制

- `desktop-performance-test` 的 20k 行范围切换 200 ms 断言在改动前的基线上同样失败（226–240 ms），本轮未处理。
- 九个来源均无真实样本核对标记（`realSampleVerified` 全为 false）；Gemini CLI、Cursor 本机无数据。下一批 Agent 接入未授权。
- 来源卡的"最近成功"只在某次扫描读到变化后更新；长时间无 Agent 使用时会停在最后一次变化的时间。
- 1280 px 以下窗口趋势 Agent 筛选仍会换行。
- r6 列出的定价与来源限制不变。
- 本轮开始时 `dist/` 有 r1–r6，构建 r7 时只剩 r6；r1–r5 不是本会话删除的。

## 交付

`dist/agents-20261007-r7`：`win-unpacked`、源码 ZIP、交付清单和 SHA256SUMS。源码 ZIP 排除真实输入、日志、数据库、认证、应用数据、依赖运行时、缓存与截图。
