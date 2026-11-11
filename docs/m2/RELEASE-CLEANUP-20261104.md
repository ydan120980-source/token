# 发布前清理和无用代码 · 2026-11-04

**状态：第 1 步已做完，还不能发布。** 没有推送。其余步骤见 `AGENTS.md` 当前边界和本文“还没解决”。

## 发布内容

- **测试数据里的真实名字**：2026-11-04 的 `reader-nav-ui-test.js` 把所有者参考截图里的会话名和项目名改了几个字写进了测试，并被当成合成数据汇报。现在全部换成现编的名字。**旧名字还留在本地历史 `a4da0d9` 里，没有推送过。**
- **本机路径**：14 份记录里的路径换成了 `<repo>`、`<worktrees>`、`<temp>` 这类占位符。新增 `tests/m1/release-privacy.test.js`，之后再有本机路径进入已跟踪文件，`verify` 会失败。它拦不住名字，所以 `CONTRIBUTING.md` 和 `AGENTS.md` 写了来源规则。
- **文档**：README 增加预览状态、阅读会话和非官方路线的说明；NOTICE 换上 Inter、思源黑体和 React 层，去掉已移除的 Chart.js；CHANGELOG 去掉不存在的 v0.1.0 标签。

## 无用代码

判断依据：产品入口和 worker 的引用图、全仓库文本引用、Codex 分支和工作区里的引用。

| 删除 | 数量 | 依据 |
|---|---|---|
| `scripts/m1` 一次性探针和测量脚本 | 24 | 没有 npm 脚本、其他脚本、测试、记录引用，Codex 也没用 |
| `src` 模块多余的导出 | 14 个名字 | 其他文件都没用到；模块内部仍在用的保留 |
| `tokens.css` 没人读的令牌 | 92 行 | 全仓库没有引用；Agent 和系列色因为可能动态拼接，不动 |
| `ui/src/kit/overview.tsx` | 1 个文件 | 页面、开发页、测试都没引用 |
| 其他 | | `@radix-ui/react-tooltip` 依赖（现有依赖版本不变）、2 条无用样式、一个多余的导入 |

`agent-real-check.js` 也在其中：项目规则是只有 `validate:local` 能读真实来源，而它没人用。

### 看过但留下的

- `src/quota/provider-passive-export.js`：引用图上是孤立的，其实是用户配置给状态栏运行的脚本，UI 套件也在用。
- `src/m1/crypto.js`：`experiment:crypto` 在用。
- `scripts/m1/*-ui-test.js`：发布验收按通配符全部运行，没有文本引用不代表没用。
- `HANDOFF-PERF-20261103.md` 引用的探针：那里记着复现命令。

### 还可以再清，这轮没动

- **只有开发页在用的 kit 组件**：`Timeline`、`StepChart`、`Ticket`、`Slider`、`RadioGroup`、`CarouselDots`、`TreeBranch`、`Toast`。不进产品包，但要连开发页和验收一起改。
- **`reader.tsx` 第 3 行的 `IconPin`、`IconPinnedOff`**：改这一行会和 Codex 的第 4 行冲突，等它合入后再删。
- **`scripts/local/claude-governed/`**：所有者本机的维护工具，是否放在公开仓库由所有者决定。
- **`design/proposals/`、`research/`、`docs/m2/`**：不是代码，是否公开由推送方式决定。

## 验证

只用合成数据，源码模式。

| 项 | 状态 |
|---|---|
| `npm run verify`（fail 0）、`npm run audit:runtime` | 通过；第一轮有 1 个 lint 错误（新脚本重复的键），修好后通过 |
| `ui-geometry`（新增）、`reader-nav` | 通过；`reader-nav` 第一轮因漏改的旧名字失败，修好后通过 |
| `session-reader`、`reader-window`、`sessions`、`app-shell`、`motion`、`cost-smoke`、`usage-smoke`、`overview`、`widgets`、`settings-smoke` | 通过 |
| `sessions-reader-extras` | **不稳定，原因未查明。** 这个分支上跑 9 次失败 1 次，加上上一轮的 9 次失败 1 次，失败都在同一步：点“显示全部输出”后等不到“继续显示”。失败时按钮还在，文字没变，也没有“记录已更新”的提示。之后加了点击和读取的记录连跑 6 次都没复现，所以还分不清是点击没送达，还是读取没有返回。上一轮的失败发生在这次清理之前，所以不是这次清理引入的，但也不能排除是产品问题 |
| 打包验收、真实记录、内存复测 | 未执行 |
| 三栏内存（`multi-reader-workload.js`） | 未运行 |

UI 合计约 20 分钟，到了预算上限，所以没有继续复现。

## 还没解决

- **Codex 合入时**：它的四份新记录（`PERF-CONTINUATION`、`RESULTS-PERF-CONTINUATION`、`RESULTS-PERF-MEMORY`、`RESULTS-TRANSCRIPT-PREVIEW`）含本机路径，合入后 `release-privacy.test.js` 会失败，需要先换成占位符。`agent-ui.js` 要重新构建。
- **历史**：`a4da0d9` 的名字、记录里的路径都还在本地历史里，所以不能直接推送这些提交。
- **推送方式、非官方路线、证书**：等所有者决定。
