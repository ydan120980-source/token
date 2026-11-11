# 保存预算总览接线与源码 UI 验收（2026-10-20）

所有者明确将后端交接中的预算接线交由本会话实施，并要求运行 workbench、usage、interaction-reliability 等源码 UI 套件；UI 样式改变须另获批准。本轮只完成数据接线与必要的列表内容，复用现有 `.wb-list` 展开行、`.wb-note` 和按钮，未修改任何 CSS、tokens、颜色、字号、间距或动画。

基础提交 `2c12b11958f19c9705695d078cf9b6ada28a42b8`，在同一 E 盘独立工作树及 `codex/backend-handoff-20261020` 主题分支继续。未合入共享 main，未同步远端或打包。

## 结果与合同

- 费用／项目与预算中，原预算表单下方列出全部 `general.budgetOverview.budgets`，不受编辑器当前 project/period 筛选。各行显示自身周期、项目区分标签、限制、状态，展开后显示自身日期范围、时区、估算与未定价覆盖。
- 来源管理的预算待办只取 `general.budgetOverview.issues`；原 general.issues 继续排除 target=workbench，避免重复。非预算待办及当前选中范围的预算提示保持原含义。
- “已知悉”和“恢复待办”都从总览找到原事项，以 `evidence.scope` 为 project、`evidence.period` 为 period，提交该事项的 id/fingerprint。动作不沿用编辑器当前选择；成功后重新读取当前选择及总览，不把缺失项目成功变更的 all 返回视图当成失败。
- “查看预算”按该预算自己的范围打开编辑器并展开对应行；已丢失项目保持 all 编辑视图，但定位并显示无法判断的原预算行，不构造不存在的项目选项。
- 已保存预算没有数据、价格未知或项目已丢失时，分别显示 no-data/unpriced/scope-missing 的说明；明确免费保持已观测估算为零，同名项目用后端 projectLabel 区分。不显示路径或原始身份。
- general.omittedIssues 与 budgetOverview.omittedIssues 分别显示“诊断”／“预算事项”的独立未返回数量。存在截断时标题明确是“已返回”数量；即使已返回事项全已知悉，也不能称全部待办已处理。

后端字段和白名单定义仍以 [BACKEND-HANDOFF-CONTRACT](BACKEND-HANDOFF-CONTRACT-20261020.md) 为准。本轮未扩展安全诊断的 UI 展示或安装器行为。

## 本轮验证

Browser plugin/browser skill 未提供；依项目工作流使用原生 Electron 与 Playwright。CodeGraph 不可调用，使用定向源码、真实 preload/IPC、合成 Store 和截图核对。每个 UI 场景都使用自己的 home、usage、quota，并传 `--m1-fixture-root`；没有真实来源或真实账号查询。

| 检查 | 结果与证据 |
| --- | --- |
| 新增 `node scripts/m1/budget-overview-ui-test.js` | 最终复跑通过：100%/150%，基本与边界场景，默认窗口和 800×600 暗色窗口；`artifacts/budget-overview-ui-20261020/final/results.json` |
| `node scripts/m1/workbench-ui-test.js` | 100%/150% 通过：项目与预算、原非预算确认、草稿、失败保存恢复、再计价、导出、重启及窄窗；`artifacts/budget-overview-ui-20261020/workbench/results.json` |
| `node scripts/m1/usage-ui-test.js` | 100%/150% 通过：用量、合成采集、停用、路径守卫、导出、重启；`artifacts/maintenance/usage-ui-results.json` |
| `node scripts/m1/interaction-reliability-ui-test.js` | 100%/150% 通过：合成 IME 事件策略、滚动打断、来源故障恢复、弹窗焦点及 800×600 布局；`artifacts/budget-overview-ui-20261020/interaction/results.json` |
| `npm.cmd run verify` | ESLint clean、fail 0；日志 `.planning/ui-budget-overview-20261020/verify-final.log` |
| `npm.cmd run audit:runtime` | 通过；日志 `.planning/ui-budget-overview-20261020/runtime.log` |
| `git diff --check`、CSS 差异核对 | 通过，CSS/tokens 相对基础提交无差异 |

专项用真实 UI 复现并验证：monthly/all 未超支，未选 daily/all 与 daily/项目 B 均超支，列表显示三份预算及两条独立待办；先在 monthly/all 确认项目 B，再切 daily/项目 B 确认 all，两者均写到各自事项；可恢复待办，再计价使旧指纹确认失效。另覆盖同名项目、免费、未知价格、无数据、丢失项目确认/恢复，以及独立截断计数和截断时的空状态。截断数字通过合成内存投影注入，验证前端读取独立字段，不声称做过 1000 行的前端性能验收。

已人工查看同一 monthly/all 状态的修改前与最终预算截图，以及最终来源待办、独立截断提示、800×600 暗色缺失项目截图。新列表沿用现有行组件；未见新增遮挡或横向溢出，专项未收到 pageerror/console error，interaction 套件 consoleErrors 为空。证据与日志在上述忽略目录，不进入提交。

首轮记录：新增专项在未接线代码上按预期失败（预算行 0，期望 3），保留 before 截图。接线后专项首次通过；后续新增页面身份断言曾把自绘栏“费用”误当 document.title，而现有 quota-ui 固定 document.title 为 Codex 额度。修正测试为产品标题 + 当前 cost 路由检查，产品标题与样式未改；最终专项复跑通过。没有把这次测试断言失败记为首轮全绿。

未做：真实数据/额度/凭据读取，真实 Windows IME 候选窗口人工验收，打包或解压副本验收，其他未受影响 UI 套件，代理/防火墙操作，子 Agent/跨会话通知，远端 Git 或共享 main 合并。预算接线的源码 `needs-ui-run` 已完成；正式发布候选仍按 CONTRIBUTING 另行授权与执行。
