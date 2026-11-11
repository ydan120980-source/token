# 六项交互可靠性优化：实现与主线程交接（2026-10-17）

状态：六项均已实现并通过源码 Electron 合成回归，等待主线程审查与合入。没有合入 main，没有推送、PR 或新发布候选。真实 Windows 中文输入法候选窗的人工验收未执行；合成事件通过不能代替该项验收。

## 交付身份与边界

- Worktree：独立执行工作树；本机绝对位置保存在未跟踪的 `artifacts/interaction-reliability/final-verification.json`，不写入可分发文档。
- 主题分支：`codex/interaction-reliability-20261017`
- 批准基线 / base：`ab767bf6fe445270e5722604c025ccf7abfb31da`，来自本地 main；开工核对工作树干净，未采用 origin/main。
- 交付 HEAD：本记录与代码、测试所在的同一提交。完整 SHA 随最终交接消息给出；可用 `git log -1 --format=%H -- docs/m2/INTERACTION-RELIABILITY-20261017.md` 定位这个提交，避免将提交自身的 SHA 写回造成循环变更。
- 单线程执行；未创建、恢复或给其他代理派工，未发送线程消息。
- 保留现有静态 HTML/CSS/classic JS 与原生 dialog。以既有批准 UI 和 tokens 为目标，没有新设计、ImageGen、框架或依赖变更。
- 仅维护渲染层、相关验证脚本及来源设置状态传递。未修改适配器、policy 白名单、认证、价格计算、额度冷却或 Workbench 阶段 2–4；未启动 R4/R6/A4。
- 没有读取真实来源、真实应用数据或认证文件，没有上传；没有执行 `validate:local`。所有运行均指定独立 usage/quota 目录和合成 fixture home。
- 源码检查使用当前文件与定向搜索。当前会话未提供可用 CodeGraph；不存在已完成 CodeGraph 检查的主张。
- 使用 `build-web-apps:frontend-testing-debugging` 技能。Browser plugin not available；该会话没有 Browser 插件及 browser 技能，原生 Electron 沿用项目 Playwright 套件，未更改用户浏览器。
- 工作树 `node_modules` 为指向现有依赖的目录联接，仅复用已安装依赖；没有安装新依赖或修改主目录依赖。不以此工作树制作包。

## 六项交接清单

| 项目 | 完成状态与用户可见变化 | 主要文件 | 对应行为验证 |
| --- | --- | --- | --- |
| 1. 中文输入法保护 | 已实现、合成测试过。统一检查 `isComposing`、229、composition 生命周期及 compositionend 同一事件轮的确认键。模型 Enter/Escape/方向键、会话/设置/费用搜索 Escape、原生 dialog cancel、表单提交和原生菜单转发命令都服从同一保护。候选取消不清空输入、不关闭层；普通键盘仍可操作。未使用全局 stopPropagation。 | `interactions.js`；`select-ui.js`、`sessions-ui.js`、`settings-ui.js`、`cost-page.js`、`preview.js`、`pricing-controller.js`、`quota-ui.js`、`window-shell.js` 等实际处理器 | 新套件的活动合成、独立 229、isComposing 事件、compositionend-before-Enter、普通 Enter/方向键/Escape、dialog cancel/submit、原生菜单命令；functional 的实际模型与价格流程 |
| 2. 用户优先滚动 | 已实现、合成测试过。`keepPlace` 与动画跳转共享取消机制及任务代次。用户 wheel/touch/pointer/滚动键、新任务、离页、resize、刷新可以取消旧修正。捕获阶段能看到子控件消费前的滚动意图；不存在跨页后续 RAF 抢位置。原保位空间在离页/resize/显式刷新时清理，没有聊天追底或固定 150 ms 锁。 | `detail-interactions.js`、`preview.js`；保留 `focus.js` 的意图判断 | 新套件的 wheel 中断、连续筛选、显式跳转、离页、resize、刷新取消；layout 的 filterHoldsTrend；polish 的历史位置与双向滚轮交接 |
| 3. 来源状态与失败恢复 | 已实现、合成测试过。区分保存、发现、采集；进行中状态有文字。偏好已写而发现失败返回 `saved: true`、确认的 selection 与独立 discoveryError，界面显示新设置和待检查文件信息，允许只重试检查。保存失败恢复内存中的旧 scope，界面回到上次确认的开关并提供重试。新路径保存后发现失败仍展示新路径和采集暂停。历史统计保留。重新检查由一个流程顺序执行发现与采集，避免旧双监听；来源提示只有一个 owner。 | `sources-ui.js`、`morph.js`、`preview.js`、`src/quota/main.js` | 新套件在 Service/Store 层注入发现、保存、采集失败；核对真实写入的合成 preferences 字节；快速开关/批量/刷新；新目录已保存后失败；旧发现与新偏好并发；历史总量不变；agent 套件的路径选择、取消、重叠保护与原生采集对照 |
| 4. 容器宽度适配 | 已实现、合成测试过。原生 CSS 容器查询覆盖费用双列/表格/块、会话工具栏、检查器、来源行和价格表；保留主数字、金额、操作及未知/未定价说明，辅助图形/比例按空间折叠。新增视觉值在 tokens 中。容器断点为 CSS 结构条件，因原生 size query 不接受 var()，条件本身使用固定阈值并在样式注释说明。 | `containers.css`、`tokens.css`、`index.html`、`serve.js`、`detail-ui.css` | 新套件：800×600 CSS 内容区，100%/150% 强制 device scale，五页面无文档横向溢出；420 CSS px 检查器容器，注入超长模型文本、大数字与合成长路径，验证自身无横向溢出与单列 stats；layout、motion resize、functional、cost |
| 5. 键盘与焦点规则 | 已实现、合成测试过。分段、Agent 条和设置导航复用小型 roving 机制；方向键/Home/End 按组切换，选中项作为 Tab 停靠点。输入框保留编辑键，模型搜索的 Home/End 不再被列表截获。Escape 先关嵌套模型层再关原生 dialog；Tab/Shift+Tab 由原生模态规则管理。列表原地刷新保留节点；来源操作消失时回到本行 summary；其他被移除控件有可见控件回落，dialog opener 不可用时回到当前页可操作控件。 | `interactions.js`、`segmented.js`、`agent-picker.js`、`sessions-ui.js`、`settings-ui.js`、`select-ui.js`、`morph.js`、`cost-page.js`、`pricing-controller.js`、`pricing-view.js` | 新套件的组导航、输入编辑键、普通 Enter、嵌套 Escape、多轮 Tab/Shift+Tab、移除 reset 按钮后的 summary 焦点、来源 switch 节点身份；sessions、functional、cost、motion 的刷新与原生弹层 |
| 6. 局部滚动渐隐 | 已实现、合成测试过。仅模型选项与价格行列表使用动态纵向渐隐；无溢出不渐隐，顶/底对应边缘清晰，内容/尺寸变化后重算。聚焦列表/子项时移除 mask，活动模型留出边缘空间，避免焦点和值落在渐隐区。无需动画或 wheel 拦截，减少/关闭动效同样正确；没有统计整页遮罩。 | `scroll-fade.js`、`containers.css`、`tokens.css`、`select-ui.js`、`detail-ui.css`、`index.html`、`serve.js` | 新套件的顶/中/底、短列表、筛选、尺寸变化、focus mask、reduced/off、真实滚轮内部滚动和上下边界向页面交接；functional 的模型列表滚动与选择 |

表内渲染文件均位于 `design/desktop-reference/`。完整变更范围可用 `git show --stat <交付提交>` 检查。

## 协议与实现选择

1. `usage:sourceChange` 在持久化完成后返回独立的保存结果，发现失败不再以整个 IPC 失败代表“没有保存”。返回的 selection 只包含已允许来源的本机读取设置，未扩大读取能力。已有发现若在旧 scope 上运行，先等待其结束，再发现新 scope。
2. `usage:chooseSource` 保留原有状态字段，新增 `sourceSaved` 和成功保存后的 `sourceSelection`；取消不会声称已保存。添加目录仍暂停采集，产品目录重叠与 Cursor 文件校验保留。
3. `saveSource` 只在本轮设置写入抛错时恢复旧内存 scope；没有删除、改写原始来源或历史账本。
4. 来源行与价格行复用现有 morph，来源及路径、价格行增加稳定 key。checkbox 的 dirty checked 属性显式与确认状态同步，失败/忙碌操作不会留下假开关。
5. busy 的来源控件使用 aria-disabled 与入口防重入以保留焦点；原生无操作可做的批量按钮仍 disabled。复制路径和展开详情仍可使用。
6. 查询过滤与刷新不替换原生 dialog，不引入上游伪焦点陷阱；焦点回落不捕获 Tab。

## 参考与归属

只读核对参考仓库 [open-claude-ui，ddf3aea](https://github.com/Caho1/open-claude-ui/tree/ddf3aea1711db62fd6d24343bbab500a5ae69f64) 的本地克隆 HEAD，读取 `code-examples/ScrollFadeContainer.tsx` 与 `ConfirmationDialog.tsx`，没有运行其脚本、安装依赖或采纳其开发文档为指令。

本轮独立实现通用交互机制，没有复制或改写该仓库代码。保留本项目原生 dialog；渐隐仅做项目需要的单一纵轴，不采用上游双轴分支或七段 alpha 常量。没有引入其 React/Framer/Tailwind 组件，因此无需为本轮增加该仓库的 MIT 代码归属；既有 NOTICE/LICENSES 保持。

## 实际命令与结果

以下均在本 worktree、源码模式下运行；没有设置 `QUOTA_PACKAGED_EXE`。UI 脚本自行创建并指定合成 fixture home 和 usage/quota 目录。

| 命令 | 结果 | 证据位置（相对 worktree） |
| --- | --- | --- |
| `npm.cmd run verify` | 首轮与最终均通过：ESLint 干净、node --test `fail 0` | `artifacts/interaction-reliability/verify-first.log`、`verify-final.log` |
| `npm.cmd run audit:runtime` | 通过；唯一产品入口、退休路径不在运行图、静态资源存在 | `artifacts/interaction-reliability/runtime-final.log`；`artifacts/maintenance/runtime-audit.json` |
| `node scripts/m1/interaction-reliability-ui-test.js` | 修复后通过；最终扩展版本在两档缩放全部通过，无 renderer console/page errors | `artifacts/interaction-reliability/interaction-final.log`、`results.json` |
| `node scripts/m1/functional-ui-test.js` | 首轮通过；容器/列表细化后复跑通过 | `artifacts/interaction-reliability/existing-functional.log`、`functional-final.log`；`artifacts/m2-functional/source/results.json` |
| `node scripts/m1/sessions-ui-test.js` | 通过 | `artifacts/interaction-reliability/existing-sessions.log`；`artifacts/m2-sessions/source/results.json` |
| `node scripts/m1/agent-ui-test.js` | 通过；含合成来源、原生投影对照、路径选择与保护 | `artifacts/interaction-reliability/existing-agent.log`；`artifacts/m2-agents/source/results.json` |
| `node scripts/m1/cost-ui-test.js` | 通过 | `artifacts/interaction-reliability/existing-cost.log`；`artifacts/m2-cost/source/results.json` |
| `node scripts/m1/overview-ui-test.js` | 通过 | `artifacts/interaction-reliability/existing-overview.log`；`artifacts/m2-overview/source/results.json` |
| `node scripts/m1/polish-ui-test.js` | 通过；历史位置、短/长列表与双边界滚轮交接等 | `artifacts/interaction-reliability/existing-polish.log`；`artifacts/polish/source/results.json` |
| `node scripts/m1/motion-ui-test.js` | 通过；全动效/减少/关闭、原生模态与 resize | `artifacts/interaction-reliability/existing-motion.log`；`artifacts/motion/results.json` |
| `node scripts/m1/layout-ui-test.js` | 通过；几何、溢出、筛选保位等 | `artifacts/interaction-reliability/existing-layout.log`；`artifacts/layout/layout-ui-results.json` |
| `node scripts/m1/desktop-performance-test.js` | 首轮第二个窗口初始化失败；完整复跑通过 | `artifacts/interaction-reliability/existing-desktop-performance.log`、`performance-rerun.log`；`artifacts/m2-desktop/source/performance.json` |
| `git diff --check` | 通过 | 最终提交前工作树检查 |

现有套件汇总：`artifacts/interaction-reliability/existing-results.json` 保留首轮各退出码，性能项首轮的失败没有改写成通过；复跑结果由独立日志及 performance.json 证明。

性能复跑使用合成 20,000 条记录、100 个模型、200 天。100%/150% 最大范围切换同步耗时分别约 74.1 / 74.1 ms，均低于现有 200 ms 门槛；费用页计算约 23.6 / 13.7 ms。图表实例复用、仅状态更新不重画、同 sequence 重新定价与曲线正确性通过；真实账号请求为 0。本轮没有跑同机基线 A/B，不能据此宣称相对基线加速或消除所有掉帧。

## 首轮失败与修复复跑记录

- 新套件初稿的注入代码假定 Electron 求值环境有全局 `require`；实际没有。改用现有套件使用的 `process.mainModule.require`，并保证恢复注入失败也会关闭 app，避免 teardown 覆盖原始失败。首个合成窗口进程树已按其 fixture 参数核对后停止；遗留的那一个合成临时目录已用项目 temp.remove 清理。
- 初稿 lint 有 Event 重复声明和 WheelEvent 缺失全局声明，已修复，最终 verify 干净。
- 直接 check/uncheck 被自定义 switch-track 遮挡；改为点击用户实际使用的 label。相关失败日志保留，不采用 force-click。
- 恢复断言随后暴露真实产品问题：preview 还会重建/隐藏来源 notice，覆盖来源页刚显示的“已保存但发现失败”。已把提示所有权收拢到 sources-ui；恢复提示与持久化结果一致。
- `interaction-first.log` 至 `interaction-fifth.log` 为上述失败；`interaction-sixth.log`、`interaction-expanded.log` 与最终 `interaction-final.log` 为修复后通过记录。最终版本增加原生菜单命令、独立 229、事件轮末确认、并发发现、新路径保存后失败、采集失败、实际滚轮交接及检查器容器压力。
- 性能首轮已完成 100% 缩放，150% 窗口的 keepVisible 主进程求值返回 `Resulting promise was garbage collected`；没有把它计为通过。未改测试门槛，原命令完整复跑，两档全部通过。未发现重复发生的产品异常；该初始化失败作为已知测试环境风险保留。

## 证据位置

所有证据均在忽略的 artifacts 内，不提交运行日志、截图、合成 fixture 或真实业务数据。

- 以下位置相对于独立执行工作树；本机绝对位置见本地验收 JSON。
- 最终六项行为结果：`artifacts/interaction-reliability/results.json`
- 最终命令日志根：`artifacts/interaction-reliability/`
- 来源已保存但发现失败截图：`artifacts/interaction-reliability/saved-discovery-failed-1.png`、`saved-discovery-failed-1.5.png`
- 最小窗口五页面截图：上述目录中的 `usage-800-*`、`cost-800-*`、`sessions-800-*`、`sources-800-*`、`settings-800-*`。
- 窄检查器与大数字截图：`artifacts/interaction-reliability/inspector-800-1.png`、`inspector-800-1.5.png`。长模型和极大数字由测试直接注入展示层，与来源解析合同独立；不能用此截图宣称真实日志具有这些值。
- 性能完整结果：`artifacts/m2-desktop/source/performance.json`
- 运行图审计：`artifacts/maintenance/runtime-audit.json`

## 已知限制与未执行验收

- 已实现 / 合成测试过：六项全部；源 Electron 100%/150% device scale、800×600 CSS 内容区，以及更窄的内部容器。
- 真实数据验证过：本轮无。未读取真实来源、账号、认证文件，未执行 `validate:local`，不能声称真实来源或账号验收通过。
- 真实 Windows IME 人工验收：未执行。需要用实际中文输入法确认候选选择 Enter、取消 Escape、方向键和候选窗事件顺序；本套件只验证应用接收到对应事件时的策略。
- 打包、解压副本与发布候选：未执行，不属于该独立线程授权。新增渲染资源由既有 build.files 通配纳入，runtime audit 已检查本地引用；仍需发布负责人在下一次正式候选做规定验收。
- `test:native`/`test:stress` 独立命令未另跑；本轮未改 src/m1/service、采集器或数据语义。agent UI 已实际运行合成原生对照，性能套件已运行大数据展示压力。
- 没有本轮基线 A/B 性能对比；通过的是项目既有门槛和正确性断言。
- 动态渐隐为短距离纵向 mask；列表键盘聚焦时刻意完全清晰。未进行辅助技术读屏人工验收、额外硬件/触屏测试。

## 建议主线程复核步骤

1. 核对 worktree、分支与 base；读取最终消息中的完整 HEAD，检查 `git show --stat`、本记录及 `src/quota/main.js` 的来源状态协议。不要以 origin/main 为基准合入。
2. 查看 `verify-final.log`、`runtime-final.log`、`interaction-final.log`、现有套件结果及性能首轮/复跑日志，核对合成与人工验收边界。
3. 可复跑 `node scripts/m1/interaction-reliability-ui-test.js`；会短时打开 Electron，始终使用自己的临时 usage/quota/fixture。重点复核“已保存但发现失败”、来源 switch 节点/焦点、嵌套 Escape、用户滚轮中断和最小窗口。
4. 在有真实 Windows 中文输入法的桌面补做人工候选验收；不因此读取真实 Agent 数据或凭据。
5. 按本地合入规则由主线程完成审查及 main 合入，本执行线程只提供主题提交。发布验收留给发布负责人，不因本记录自动出候选。
