# M8 已打开胶囊的数据刷新缺口 · 2026-10-27

状态：所有者 2026-10-27 已批准 §2 最小修复并要求记录后继续 M8。授权仅覆盖共享胶囊内部刷新、原 key 消失时清理及对应验证，不新增公共属性、token 或设计决定。原失败证据保留。

## 1. 实际证据

- 本轮已批准并应用 `UI-MIG-M8-CHART-GAP-20261027.md` §1 四组补充。
- 迁移后的生命周期套件使用现有 `kit-gallery` 中的真实 React 组件，不伪造 `costHero`、`costBars`、`costDonut` 或计数器。
- `renderer-lifecycle-ui-test.js` 在分段条保持焦点、胶囊已打开时，把合成金额从 `$2` 改为 `$6`，检查已打开提示是否包含最新金额。该检查未通过；其它命名检查没有报告失败。
- 实际命令：`LIFECYCLE_EVIDENCE_DIR=artifacts/ui-mig/M8/lifecycle node scripts/m1/renderer-lifecycle-ui-test.js`。Windows 实际由 PowerShell 设置同名环境变量后调用 node。
- 日志 `.cache/m8-lifecycle-first.log`，结构化证据 `artifacts/ui-mig/M8/lifecycle/checks.json`。失败输出：

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ [ 'active hover refresh uses latest amount' ]
- []
```

源码定位：`ui/src/kit/charts/common.tsx` 的 `useSharedChartTooltip.show` 将传入的 ReactNode 保存为打开时的 `content`；`StackBar` 只在 pointer move / focus 时调用 `tooltip(key)`，数据变更没有刷新已保存内容。`BarChart` 和 `LineChart` 的 spark 也使用这条共享路径。因此推断同一缺口会影响费用页在读数打开期间收到重估或新快照的情况；尚未完成独立实页重估复现，不将推断冒充已通过的验证。

这不是四组已批准补充中的段间距、每天四态、坐标色或环底轨，不能借该批准直接修改。

## 2. 最小补充申请

允许在 `common.tsx` 及 `StackBar`、`BarChart`、`LineChart` 使用共享胶囊的内部路径中，修复以下现有行为：

1. 胶囊打开且原 key 仍存在时，用调用方当前 `tooltip(key)` 的结果更新内容；不要求移开、再次指向或重新聚焦。
2. 保留同一个提示节点、当前 key、焦点、位置和显示状态，不重播入场；原 key 已消失则清理提示。
3. 不增加公共 kit 属性、token、颜色、尺寸、文案或动效；不修改 vendor、设计检查、额度页、后端或 IPC。
4. 保留当前失败断言，补上真实费用页在胶囊打开时重估的合成验证，再运行受影响 gallery、生命周期、cost 与门槛。不能以再次 pointer move / focus 或重挂载提示来使断言通过。

这是修复已有读数的新鲜度，不申请新的提示形式或交互设计。批准后记录裁决并继续 M8；M7 和最终 Claude 审核停止点保持不变。

计划 §9.4：**“影响 kit、规范、vendor、theme、tokens、设计检查，或影响后面多页：停止全部工作并提问。不得自己扩展 kit 接口、加设计例外或换写法。”**

## 3. 暂停时的验收状态

已执行且通过：纯计算测试、`npm run verify`（fail 0）、cost 主套件单次、cost-layout、cost-compact、cost-composition、cost-rebuild、workbench、budget-overview，以及较早轮次的 M8 gallery / 冒烟。完整页面矩阵保留原合成 fixture、两色、视口及缩放范围。

未完成：本次生命周期、render-performance、最终 build 后的 gallery / 冒烟 / foundation、完整逐断言映射、cost 同 fixture 连续三次、五个未改页面像素门槛、费用页正式前后对照与差异清单、最终交付提交。不得称 M8 已完成。

当前工作区 `ui/mig-m7-m8` 的改动尚未提交；原 M6 工作区没有被操作。当前最高裁决文件 §4 撤回费用摘要，已移除 cost-summary 岛和未被页面使用的 SummarySection；配色值未改。
