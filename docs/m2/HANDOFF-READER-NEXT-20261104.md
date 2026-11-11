# 交接：会话阅读功能的下一步 · 2026-11-04

**给下一个 Claude 会话。** 所有者要求上一会话做完后交接，由新会话推进会话页的阅读功能。Codex 已暂停推进。

## 1. 所有者的需求（原话）

> 首先把打开其他会话功能整合到左侧的目录功能中，目录上方加一个可以切换的功能，然后优化开其他会话后选择会话的内容细节模仿 codex 的设计，另外在每个会话前加入 agent logo 等细节多加一些，还有右侧的命令，文件，失败和对比，ui 做的都太简陋了，还是模仿 codex 的设计，只展示了 codex 文件的设计，其他的你来设计。

## 2. 我的理解（判断，不是所有者原话，有疑问先问）

| 位置 | 现在 | 要变成 |
|---|---|---|
| 阅读页顶部 | “+ 打开其他会话”按钮，弹出 `PanePicker` | 去掉这个入口 |
| 左栏 | 只有目录（`OutlineNav`） | 上方加切换：目录 / 会话。“会话”就是打开其他会话 |
| 选会话的列表 | 列表较朴素 | 参考 Codex 的会话侧栏：按项目分组（文件夹图标、可折叠、“展开显示”），当前项高亮，悬停出现操作。每个会话前加 Agent logo，并补更多细节，比如时间、状态 |
| 右栏“文件” | 平铺列表 | 参考 Codex 的文件树：顶部工作区名和“筛选文件…”，“所有更改”，按目录折叠的树，文件类型图标，右侧增减标记（绿色新增、红色删除） |
| 右栏“命令 / 失败 / 对比” | 简陋列表 | 没有参考图，由 Claude 按同样的密度和质感自行设计 |

## 3. 参考图

所有者发的 Codex 截图在本机，含真实会话名和路径，**不要提交进仓库**，也不要放进任何记录：

```
本机临时目录（路径不记录）
  27.webp   现在的阅读页，圈出了“打开其他会话”和右栏
  28.png    Codex 的会话侧栏（按项目分组）
  29.png    Codex 的文件更改树
```

临时目录可能被清理。如果读不到，请所有者重发。

## 4. 代码在哪

- **`ui/src/pages/sessions/reader.tsx`**：`SideColumn`（右栏，第 193 行附近）、`PanePicker`（第 257 行）、`ReaderPane`、`SessionReader`。行号以当前 main 为准。
- **`ui/src/pages/sessions/rows.tsx`**：`SessionPicking`，现有选会话的行。
- **`ui/src/pages/sessions/detail.tsx`**：`SessionFacts`，概况标签。
- **`ui/src/pages/sessions/compare.tsx`**、**`file-history.tsx`**、**`turns.ts`**（`ranCommands`）。
- **`design/desktop-reference/sessions-host.js`**：`readInSlot`、`also`、`holdAll`、`wantRecent`。
- **kit**：`OutlineNav`、`Segmented`、`SidePanel`、`SlideOver`、`AgentMark`（官方 logo，不要自己画）。
- 背景记录：`UI-SESSIONS-MULTI-20261102.md`、`UI-READER-FILE-HISTORY-20261102.md`、`UI-READER-RECOGNITION-20261102.md`。

## 5. 动手前必须先定：性能分支

**`claude/perf-20261103`（87edc93）还没合入 main。** 它大改了 `reader.tsx`（277 行，15 处），新的阅读页工作如果从现在的 main 开始，之后一定和它大面积冲突。

**建议：先把它合进来，再开始改阅读页。** 这需要所有者确认，因为它有未达成项，见它自己的 `docs/m2/HANDOFF-PERF-20261103.md`。

试合并（`git merge-tree`，分支 `ui/admin-20261103` 对 `claude/perf-20261103`）的冲突只有三个文件：

| 文件 | 处理 |
|---|---|
| `src/m1/transcript-tasks.js`、`src/m1/transcript-task-worker.js` | 两边都改了 operations 列表。保留性能分支的结构，把 `toolUse` 加进列表和判断 |
| `design/desktop-reference/ui/agent-ui.js` | 构建产物，合并后重新运行 `npm run build:ui` |

**合入后还要做**：性能分支的 memo、窗口化和跳转修复都依赖 `reader.tsx` 的现有结构，改界面时不要传入不稳定的属性，也不要让轮次高度变得不可预期。

Codex 暂停前提到（来自所有者转发的截图，未核实）：

- 性能分支上有两个探针要补强：采集基准增量未执行时仍输出 `valid: true`，要校验预期记录数、Token 增量和快照总量；V2 交互探针被透明遮挡层挡住仍判 hover 成功，要确认命中的是指定控件。
- 采集 2× 未达成、离开阅读页的 104ms 长任务、原生 150% 内存未覆盖，都还未完成。
- Codex 计划等源码统一后再出一个本地候选集中验收。

这些属于性能分支，不属于阅读页界面。要不要由新会话做，先问所有者。

## 6. 上一会话留下的待查项

- **`functional-ui-test` 偶发失败**：`ui/admin-20261103` 上 9 次过 6 次，基线 `25574d5` 上 3 次全过。两种现象：趋势图动画采样时 `[data-chart]` 取到空（`usage-functional-checks.js:84`）；`getByRole('tooltip')` 同时匹配到两个。这两处代码这轮没改，最后连续 4 次通过，可能和机器状态或鼠标位置有关，**原因没有证实**。如果再次出现，应该认真查。
- **用量来源卡片**：所有者说读取信息“太散”，已收成一行“今天 + 走势”加一段文字，所有者还没看过最新版。
- **Agent 管理只有合成数据验证**：`installed_plugins.json` 的具体结构和 Codex 记录里的 MCP 工具名都没有真实样本核对。

## 7. 所有者偏好（这几轮反复说过）

- **不要页面内第二列菜单**，和主菜单重复。分类放页面顶部一排。
- **不要扁平短卡片**，内容要看全，不截断；但也不能太散，相关信息要收在一起。
- **按钮不要一排灰色实心**：一个主操作，刷新用图标，其余用轻量样式。
- **直接参考 Codex 和 Claude Desktop 的做法**；不要自己发明简陋版本。
- 回复用简洁中文，先说结论；区分已实现、合成测试、真实测试、未执行。

## 8. 规则

- 本地开发：不推送、不开 PR，`git merge --no-ff` 合入本地 main；`docs/agents/` 是别人的未跟踪文件，不要动。
- 只用合成数据，不读真实来源和认证文件。
- 合入门禁：`npm run verify` fail 0、`npm run audit:runtime`、受影响的界面套件（约 20 分钟预算）。**不要把合入和测试写在同一条命令里。**
- **`TaskStop` 不一定能结束后台脚本的子进程**：上一轮因此两轮检查混在一起。重跑前先确认没有残留。
- 删除工作树前先删 `node_modules` 联接，否则主依赖会被清空。
- 界面规范：`docs/m2/UI-SPEC-20261025.md`，`tests/m1/ui-design-guard.test.js` 会检查（页面里不能有 `hover:`、`style=`、任意值）。

**建议测试**：`session-reader`、`sessions-reader-extras`（平滑滚动问题上次要多跑几次）、`sessions`、`app-shell`、`motion`。
