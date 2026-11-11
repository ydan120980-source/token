# M9 收尾执行记录 · 2026-10-29

范围：所有者本轮指令及 `UI-SHELL-M9-20261029.md` 第 3 节，按五个步骤各提交一次。起点为本地 `main` 的 `d876f61`；执行分支 `codex/m9-shell-closeout`。全程使用合成 fixture 和独立 usage/quota 目录，不读真实来源、不查询真实账号、不推送或开 PR。

## 1. 源码全量测试与修复（完成）

枚举并串行执行了 `scripts/m1/*-ui-test.js` 的全部套件。首轮 36 个通过、15 个失败；未把复跑通过写成首轮通过。失败的套件均已修复并复跑通过，汇总中没有缺项。另运行 `source-reliability-stress-test.js`，覆盖不变刷新、尾行恢复、写入失败回滚、重启和取消。

修复的产品问题：

- M9 未分层的纵向导航规则覆盖了既有 `≤800px` 横向布局，遮挡页面操作；恢复既有小窗横向导航规则。
- 来源路径重置后，按钮自身被移除时焦点丢失；回到该 Agent 的读取位置展开按钮。
- 长模型名撑宽明细表，打开费用详情后出现文档横向滚动；表格在自身范围内滚动，表头保持单行，名称允许断行。
- 费用图例的英文名称令滚动容器按最小内容宽度展开，金额越过面板边缘；允许名称在必要位置断行，保留完整金额。
- 月份或自定义范围没有对应快捷项时，分段控件没有 Tab 入口；保留首个可用项的入口，Home/End 可提交对应范围，继续保护 IME。
- 费用详情的指标标签在浅色子块上只有约 4.16:1 对比度；采用已有 `text-foreground`，满足规范检查。标题保留完整 `title` 供长名称读取。

测试迁移依据：`UI-COST-KIT-20261028.md` 第 4 节和 `UI-COST-DETAIL-CARD-20261028.md`。原参考模式的原生 dialog、旧来源 details、group/button/aria-pressed、日期入口和旧卡片几何，改查当前 kit 的真实控件与数据标记；分段控件查 tablist/tab/aria-selected，弹出层从共享 portal 定位。完整保留未知/零/未定价、部分字段、精确区间、账号隔离、键盘、焦点和不溢出的要求。费用构成的部分 Token 标记在当前悬停明细中检查。额度登录等待实际卡片包含新连接，避免在数据更新后、DOM 提交前断言。

`continuity` 首轮出现有限动效等待超时，复跑通过；记录保留，不宣称已复现并修复独立动效根因。等待辅助函数在失败时输出未完成动效，未放宽超时或断言。

验收：

| 检查 | 本轮结果 | 本机证据 |
|---|---|---|
| 全部源码 UI 套件 | 首轮及修复复跑合并后全部通过 | `artifacts/m9/source-acceptance.json` |
| 首轮原始结果 | 保留所有失败 | `artifacts/m9/source/results.json` 及逐套件日志 |
| 失败项复跑 | 全部通过；有多轮定位过程 | `artifacts/m9/source-rerun/`、`source-diagnostic/`、`source-repair/`、`source-fix-4/`、`source-final-cost/`、`source-final-2/` |
| `npm run verify` | `fail 0` | `artifacts/m9/headless/verify-step1-accepted.log` |
| `npm run audit:runtime` | 通过 | `artifacts/m9/headless/audit-step1-accepted.log` |
| `node scripts/m1/source-reliability-stress-test.js` | 通过 | `artifacts/m9/headless/source-reliability.log` |
| 六页深浅色像素对照 | 24 对，全部在 0.002 门槛内，无差异豁免 | `artifacts/m9/pixels/step1-diff/report.md` |

像素条件：1280×900、固定时钟、sRGB、关闭动效、同一合成账本与额度 fixture。`before/` 从原始 `d876f61` 捕获；`repaired/` 是第 1 步修复后重新拍摄的基线。该组默认状态不覆盖窄窗修复与费用详情标签，后者由对应交互套件的截图和对比度断言另行证明。截图是本机证据，不提交到源码；Claude 的视觉审定单独记录，测试通过不等于已审定。

复现全量源码套件：清除 `QUOTA_PACKAGED_EXE`，在仓库根目录串行执行 `Get-ChildItem scripts/m1 -Filter '*-ui-test.js' | Sort-Object Name` 返回的每个文件（`node <文件路径>`），逐项保留退出码和日志。套件自身建立合成 home 及独立存储；不运行 `validate:local`。

## 2. React app 根组件（完成）

`ui/src/app.tsx` 在唯一生产节点 `#app` 中直接组合标题栏、侧栏、六页、小组件和提示条。`app-store.ts` 接收用量 host 发布的外框事实；`app-shell.ts` 管理历史与滚动位置、侧栏保存、小组件停靠/浮动、键盘、原生菜单、窗口焦点和主题。启动的概览不会额外写入后退历史。输入框与 IME 中不处理数字切页快捷键。

`main.tsx` 先同步建立外框，供紧随其后的 classic 数据 host 使用，待 `DOMContentLoaded` 才在同一根节点内激活页面。页面保留原来的 CSS scope，但 scope 不是独立 React root。`preview.js` 保留用量与设置的公开接口、保存事实与数据投影，外框写入改为发布 App 状态。页面不再经 `islands.js` 挂载，生产页不再加载 renderer 的 `window-shell.js`。独立展示/clean-room 窗口仍可使用显式 fixture mount API，注册表位于 `ui/src/dev/fixtures.ts`；生产 App 不调用它。

六页、基础层和小组件冒烟全部通过。新增 `app-shell-ui-test.js` 在两个缩放下验证单根、六个快捷键、输入/IME、前进后退分支、深浅主题、侧栏/小组件、合成采集与窄窗 inert；`interaction-reliability`、`polish` 也通过。`verify` 首轮仅静态的旧岛屿加载顺序断言失败，改为核实数据 host 在页面激活前加载；完整复跑 `fail 0`，运行时审计通过。

证据：`artifacts/m9/step2-smoke/`、`step2-shell/`、`step2-shell-final/`；最终 `verify-step2-final.log`、`audit-step2.log` 在 `artifacts/m9/headless/`。`repaired/` 与 `react-root/` 的六页深浅色 24 对像素比较全部通过，最大差异 0.037%，仍为 0.002 门槛，无豁免；报告在 `artifacts/m9/pixels/step2-diff/`。

## 3. 删除 legacy 层（完成）

删除 renderer 的旧 CSS 文件、legacy/ui-reset 层和旧控制脚本；数据 hosts/models 与用量投影保留。当前外框与仍在使用的额度卡片叶节点规则收进 ui/src/theme/app-layout.css，字体独立为 fonts.css，引用相同 tokens。原样保留隐藏、滚动条、小窗布局、Agent 身份色和卡片动效；两个排版别名只隔离 Tailwind 的同名变量，字号值不变。

导航与额度筛选指示器由 React + 共享 spring 驱动；IME、动效偏好和可取消滚动收进 kit/app-presentation.ts。卡片持有局部 keyed 更新器 quota-card-dom.js，不再依赖通用 morph.js；卸载叶节点时释放进度动画。insights-ui.js 的旧 HTML 和事件控制器移除，保留数据投影、动作和角标。

同步收紧 serve.js 静态白名单、运行时退休路径检查、字体/隔离/构建字节测试。polish 移除已无调用者的 legacy number API 测试，真实 Figure 起始数字、连续更新和静止状态仍由 render-performance/continuity 验证。

首轮发现隐藏规则、滚动条与 Agent 色绑定遗漏，保留失败记录并恢复原样。静态测试改查当前 bundle，未放宽视觉门槛；独立进程 timeout 测试首轮偶发失败，定向复跑和完整 verify 均通过，未声称修复其独立根因。

验收：verify fail 0，audit:runtime 通过；单根、六页/基础层、布局、额度卡片、身份、连续性、IME/交互、polish、渲染性能检查通过。日志在 artifacts/m9/step3-smoke、step3-restore、step3-final 和 headless/verify-step3-final.log、audit-step3.log。删除后的默认深浅主题 24 对与 react-root 比较全部通过，最大差异低于 0.1%，无豁免；报告在 artifacts/m9/pixels/step3-restored-diff，截图在 no-legacy-restored。

## 4. 来源弹窗整理（完成）

sheets.tsx 只保留配置检查区与弹窗组合。独立的 SetupSheet、InstallSheet、CustomSheet、ManagerSheet、DemoSheet 各自持有原来的状态、关闭条件和动作；Program 继续复用安装行。保留同样的 DOM、文案、回调和数据 host，未扩大读写能力。原来超过 200 字符的 JSX 拆为逐行属性和分支，相关七个文件不再有超过 200 字符的行。

build:ui、完整 verify（fail 0）、audit:runtime 通过；agent-install、agent-setup、config-health、custom-sources、interaction-reliability 合成 UI 套件通过，覆盖三个缩放的十 Agent 恢复入口，以及管理预览/应用/撤销、自定义来源向导、IME/焦点。证据在 artifacts/m9/step4 与 headless/*step4.log。

## 5. 打包验收（完成）

正式无界面门槛、最终构建/ASAR 审计、全部 52 个打包 UI 套件、含中文和空格的解压副本采集恢复均通过。源码 ZIP 现包含 ui/；逐条校验源码归档、运行目录和解压副本的字节与 SHA-256。交付目录为 dist/20261029-M9-shell，完整结果和首轮失败记录见 RESULTS-M9-20261029.md。

打包验收追加修复：首次筛选指示器在 ref 就绪后测量布局，避开按下缩放；清除退休的 cleanup 接口，React TipCard 自身管理切页和隐藏清理；clean-room 显式选择相同动效模式。先定向检查通过，再将最终同一构建的 52 个 UI 套件全部重跑通过。

最终像素重拍在 artifacts/m9/pixels/final-presentation；原始 d876f61 与修复后的 repaired 两套基线各有 24 对比较，全部通过原 0.002 门槛，最大 0.09%，没有豁免。并排浏览页与给 Claude 的转发文字已补入审阅报告。所有者手动转交；Claude 尚未审定，main 留待审阅后按 --no-ff 合入。
