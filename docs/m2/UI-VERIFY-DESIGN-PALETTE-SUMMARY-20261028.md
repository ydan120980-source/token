# 配色 / 概览 / 小组件分支：全量执行与卡片诊断 · 2026-10-28

**状态：本轮执行完成，不能作为51项全通过记录。** 51项已串行实际执行：44项满足门槛，5项exit 0但不足10秒不计通过，2项为交接已知失败。获批快捷键修复及过时测试修正已提交；最终verify / runtime及两尺寸六页前后对照见第8–10节。M7未开始，交付后停止等待Claude审核。第2–6节保留授权前诊断与原始失败状态，第7节记录授权后修正。

审核入口：[51项完整账本](../../artifacts/ui-verify-design-palette-summary/full/runs.json)、[48对完整前后图](../../artifacts/ui-verify-design-palette-summary/captures/pairs/index.md)、[证据SHA-256](../../artifacts/ui-verify-design-palette-summary/evidence-index.json)。证据保存在本验证工作区，未提交artifacts。图中品红色块是原截图工具的时间遮挡，本轮未新增或修改。

## 1. 分支和依据

- 来源：`ui/design-palette-summary` 的最新提交 `53dce4964ad2454cd885c00c221ff1d1cef6d04f`。
- 本分支：`codex/verify-design-palette-summary`，工作区 `<worktrees>/verify-design-palette-summary-20261028`。
- main只读核对为 `b594692462f54a27c4366e794aa077ea6e265a77`，M8已合入；配色 / 概览 / 小组件分支尚未合入。没有改动Claude工作区或旧M6工作区。
- 读取两份新交接，以及palette proposal、widgets、home、surfaces和当前AGENTS。当前设计为概览启动、导航176、C配色、Apple式卡片、小组件栏和无说明小字；未改设计。
- Browser plugin / browser skill未提供，按frontend-testing-debugging使用现有Playwright Electron工作流。CodeGraph不可用，根因通过当前源码、实际DOM和几何核对。
- `scripts/m1/*-ui-test.js` 清单确为51项，保存在 `artifacts/ui-verify-design-palette-summary/suite-inventory.json`。没有把早先M8的通过记录充作本分支结果。

## 2. 正式基线复现

实际命令（源码模式，脚本自己创建独立合成home / usage / quota，IPC只返回合成fixture）：

```powershell
$env:QUOTA_V4_EVIDENCE_DIR='artifacts/ui-verify-design-palette-summary/baseline/quota-v4'
node scripts/m1/quota-v4-ui-test.js
```

退出码1，真实进程时长8.403秒，日志505字节；不记通过。实际输出：

```text
AssertionError [ERR_ASSERTION]: card content fits its square: {"scroll":214,"client":174,"key":"00000000-0000-4000-8000-0000000000a1","width":244,"bodyStyle":null,"cardStyle":null,"cardH":284,"kids":["quota-card-content:159:"]}
```

位置为 `scripts/m1/quota-v4-ui-test.js:131`，与交接一致。运行计量为 `baseline/quota-v4-run.json`，失败图为 `baseline/quota-v4/1/failure.png`，原日志副本为 `logs/dps-baseline-quota-v4.log`。

卡片a1实际是 **WorkBuddy共享卡片**，Codex是e1。诊断早期口头把a1称作Codex不准确，这里按fixture与DOM更正。

## 3. “用量启动则通过”是假阳性

对照诊断只在临时Playwright驱动内，使用已有session reload恢复协议设为usage；未修改 `preview.js`，产品默认页仍是quota / 概览。

原套件包含：聚焦卡片详情按钮 → 按Alt+ArrowLeft → 检查顺序 → 检查正文尺寸。实际情况是：

1. `quota-card-grid.js:238–247` 处理Alt+方向键排序，只调用 `preventDefault()`。
2. 同一事件继续冒泡，`window-shell.js:12` 的窗口级Alt+←监听器执行后退。它的guard只检查IME，未检查defaultPrevented。
3. 有usage→quota历史时，排序之后页面退回usage。诊断最终读取到 `main.dataset.currentView === 'usage'`、`quota.hidden === true`。
4. 隐藏页面的所有卡片 `clientHeight / scrollHeight / bounding box` 都是0，`0 <= 0 + 1`让原几何检查通过。该诊断两档日志虽然打印PASS，**不能计入51套件通过**。
5. 默认概览时没有上一页可退，卡片保持可见，因此原214/174差值暴露。这不能证明改默认页解决了布局问题。

诊断文件：`diagnostic/start-usage-view/{1,1.5}/view-final.json`、`final.json`及 `logs/dps-start-usage-view.log`。view-final中含合成页面DOM，仅作本地诊断。

临时驱动再只阻断卡片Alt+方向键的冒泡，未改产品源码，重放同一用量→概览流程。最终页面保持quota且可见，原214/174断言再次失败。证据为 `diagnostic/keys-isolated/1/`、`logs/dps-keys-isolated.log`。这证明后退冲突确实掩盖了原检查，不能通过恢复usage默认页来验收。

## 4. 40px差值的来源

对卡片初次显示和排序后的实际DOM，与每次送给 `uiMorph.update` 的目标HTML逐项对比；忽略进度层的受控inline style后，差异仅为刷新按钮由busy管理添加的 `aria-busy="false"`。没有发现重复节点、丢失节点或卡片结构残留；当前证据不支持交接中的morph结构推测。

实际深层结构是 `.quota-card-content > .quota-wallet.is-pocket > .quota-wallet-total.quota-pocket`。`pages.css:183` 原设计给口袋背景负底边距40px，并增加相应底部padding，使背景延伸到卡片footer后方；`:has(.quota-wallet.is-pocket)`明确允许正文overflow visible。这些是已有样式，不是本轮新增。

在保持quota可见、仅诊断性阻断快捷键冒泡时，a1的实测值：

| 项 | 值 |
|---|---|
| 卡片上下界 | 283 → 566.547 |
| 正文上下界 | 352.797 → 526.547 |
| footer起点 | 526.547 |
| 正文scrollHeight / clientHeight | 214 / 174 |
| 正文非空文字范围 | 375.750 → 508.750 |
| 超出正文上下界的文字 | 无 |

`scrollHeight`把口袋背景预留的40px也计入；此样本的实际文字没有进入footer，也没有被正文截断。背景本身按原设计延伸到卡片底部。因此不能仅凭214/174判定内容被裁切，更不能改默认页或改卡片CSS来消除数字。

几何原始数据为 `root-cause-summary.json`、`diagnostic/keys-isolated/1/meaningful-geometry.json`。初始 / 最终模板和全部深层计算样式在 `diagnostic/quota-probe/1/{initial,final}.json`，失败图保留。

## 5. 供裁决的最小方案，尚未应用

### 产品修复

只在 `quota-card-grid.js` 已识别并处理的卡片Alt+方向键分支中阻止冒泡，让同一按键只移动卡片，不触发窗口历史导航：

```diff
-    event.preventDefault();
+    event.preventDefault(); event.stopPropagation();
```

未应用补丁为 `artifacts/ui-verify-design-palette-summary/proposals/card-key-propagation.patch`。仅在临时诊断驱动中验证了等效事件隔离，不能写成产品修复已通过；需要正式应用后再跑原交互与全量验收。不改变普通窗口后退、卡片顺序语义、视觉、数据或IPC。

### 测试修正

建议在quota-v4 / visual的几何检查前后增加“当前仍在quota、卡片可见、尺寸非0”的前置断言；内容裁切断言应保留并核对实际文字、读数、控件和图形与正文 / footer的边界，区分已有口袋装饰背景的延伸。不能删除裁切检查或放大容差来取得通过，也不能把隐藏页面的0尺寸计作通过。保留至少方形、同行等高、精确金额、未知和键盘 / 焦点断言。

这个测试方向依据已批准的“Agent卡片保持原设计 / Apple式卡片”及现有口袋结构，不申请新样式。新发现的快捷键问题属于产品行为，故尚未直接实施上述方案。

## 6. 验收状态与停止点

| 项 | 状态 |
|---|---|
| 51项套件盘点 | 已完成，尚未全跑 |
| 原quota-v4正式运行 | 失败，证据保留 |
| 临时A/B及事件隔离诊断 | 已完成，仅用于根因，不计正式通过 |
| verify / audit:runtime | 本分支本轮未执行 |
| 两尺寸浅深全部页面main / 候选对照 | 未执行 |
| 产品、测试、kit、theme、token、后端、IPC修改 | 均未实施；只有本记录和本地诊断材料 |
| interaction-reliability / quota-identity | 未修改，按交接另行任务处理 |
| M7 | 未开始，仍须本分支经Claude审核并合入main |

停工依据是交接 §1 的明确产品问题门槛，而不是工具故障或新设计选择。所有原图、原始JSON和日志保存在本工作区 `artifacts/ui-verify-design-palette-summary/`，SHA-256见 `evidence-index.json`；不包含真实来源或账号读取。没有子代理、main合并、远程Git、打包、上传或默认页改动。

## 7. 所有者授权后的最小修复与定向验收

所有者回复“授权上述最小修复并继续51”：仅在卡片处理Alt+方向键的分支加stopPropagation；quota-v4 / visual加入当前额度页、可见和非零尺寸前置检查，区分原有口袋装饰背景，保留实际文字、读数、控件、图形的正文与footer边界，以及至少方形、同行等高检查。随后执行全部51套件、verify、runtime和两尺寸全页对照；其它新产品问题仍须停止交Claude，不开始M7。

- 产品只改 `quota-card-grid.js` 一行，未改默认页、morph、卡片样式、数据、后端或IPC。
- 新增仅供测试的 `scripts/m1/quota-card-fit-check.js`，两个原套件共同使用。非口袋卡片保留原scroll检查；口袋卡片检查可见正文而非40px装饰延伸，没有增加原1px边界容差。
- quota-v4增加隐藏页与1px人为裁切两个负例，均必须被检查拒绝；卡片排序后检查仍在quota，卡片之外的普通Alt+←仍能后退。
- 新增用量→概览历史准备后，拖动坐标必须先把首卡滚入视口。第一轮定向执行在拖动断言失败（11.793秒，exit 1），已修正测试驱动的滚动准备，原日志保留。

| 实际命令 | 退出码 | 秒 | 日志字节 | 结果 |
|---|---:|---:|---:|---|
| `node scripts/m1/quota-v4-ui-test.js` | 0 | 20.014 | 53 | 两档DPI、浅深色、原交互与新增负例通过 |
| `node scripts/m1/visual-ui-test.js` | 0 | 18.523 | 843 | 两档DPI、深浅与窄窗、几何及原语义通过 |

证据分别为 `fix/quota-v4-v2-run.json`、`fix/visual-run.json`、`fix/quota-v4-v2/`、`fix/visual/`；对应完整日志为 `.cache/dps-fix-quota-v4-v2.log` 与 `.cache/dps-fix-visual.log`。quota-v4输出末尾为 `PASS quota v4 UI 1 dark` / `PASS quota v4 UI 1.5 light`；visual输出末尾的结构化结果标记 `darkAndNarrow`、`exactEstimateBounds`、`unknownAndZeroDistinct`、`keyboardDialogs`、`noPageErrors` 均为true。全量结果完成后追加，不把定向检查冒充51项全过。

### 全量中修正的过时测试准备：continuity

第11项continuity首次在 `frames.every(f=>f.aria==='45')` 失败。临时诊断保留原断言，只额外记录实际帧：100%档全部45，150%档依次78、45、45、45、45、45、45。来源是已批准的概览首页（`UI-HOME-20261028.md`）把卡片推到首屏下方；点击刷新先滚入卡片，触发同样820ms的旧值入场动画，早于合成RPC刷新完成。原准备仅等“存在820ms动画”，会把它误当刷新动画。

只修 `continuity-ui-test.js`：等待已确认的aria目标值45再采样，后续90、65、0也先确认再检查；所有45、反向连续性、820ms/easing、缺口桥、reduced-motion和精确值断言原样保留。没有改产品或增加sleep。复跑exit 0、29.647秒、274字节日志，末尾为 `PASS: quota acceleration/retarget, minute cadence, honest gap connections and logo filters at 100%/150%.`。原失败日志、复跑日志及计量见 `full/runs.json`、`full/continuity-ui-test.js{,.attempt-2}.log`；诊断原始帧见 `diagnostic/continuity/probe-{1,1.5}.json`。不是新的产品读数问题。

### 全量中修正的过时测试准备：overview

旧用量概览套件的额度冷却重播检查在等待动画时超时。补滚入后仍失败；原两轮日志与各自截图保留。临时驱动只观测IntersectionObserver和Element.animate，记录确认：冷却后的动画在performance 8729.6ms已实际启动；导航滚动在8903.1 / 9006.5ms把条移出50%视口阈值，产品按原规则结束；9546ms再进入时仍处于60秒冷却。原套件等导航滚动后才采样，所以错过动画，并非产品未重播。

依据已批准的 `UI-HOME-20261028.md`，只修 `overview-ui-test.js` 的视口准备：初次实际滚入卡片，冷却重播前先以instant滚到页顶，并由真实IntersectionObserver确认退出，再使用原有+61000ms时钟和滚入动作采样。快速重入、78%、冷却重播、reduced-motion及其它原断言都保留；不增加sleep，不改产品滚动、动画或冷却实现。第三次正式运行exit 0、24.021秒、275字节，末尾为 `PASS: overview scope, honest day detail, tooltip pointer/wheel pass-through, quota cooldown at 100%/150%.`。证据为 `full/overview-attempt-3/`、对应log与 `diagnostic/overview/probe-1.json`。第1、2次失败也在全量账本中保留。

### 全量中修正的过时测试前提：sessions

原 `sessions-ui-test.js` 在切到usage后要求 `sessionsUi.loaded === false`，首次exit 1、3.128秒。该前提不再适用：已批准的默认概览及 `UI-HOME-20261028.md` 今天活动需要保存的会话列表，当前 `HomeActivity → useSessions → sessionsUi.reload` 会先读取应用保存的列表，不采集外部来源。

只修测试为“概览完成列表读取后，切到用量不额外读取”：用真实IPC计数断言 `usage:sessions` 新调用为0，并断言保持同一个列表对象。其余今日会话数、分组、精确金额、未知、恢复命令字面量、隐私和动效断言保留。第二次正式运行exit 0、22.077秒、110字节，末尾为 `PASS: session page groups, drawer motion, literal resume command, range/search and today counts at 100%/150%.`。原失败日志及 `full/sessions-attempt-2/` 原图均保留；没有改产品会话加载或数据边界。

statistics-worker也含同一个过时的loaded=false前提，首次exit 1、3.844秒。按同一已批准首页决定，测试同样改为切到用量新增完整列表IPC为0、对象保持不变，结果字段改为准确的 `usageReusesHomeSessions`。IPC发送方拒绝、主进程不持有账本、工作线程重启前后总量/sequence、启用状态恢复采集、重估导航、字节不变和无渲染错误检查均保留。第二次正式运行exit 0、11.448秒、449字节，输出这些字段均为true且realAccountRequests为0。证据为 `full/statistics-worker-ui-test.js{,.attempt-2}.log`、`full/statistics-worker-attempt-2/results.json`。

### 过时费用定位：style-alignment

首次在M8前的 `[data-cost-section="analysis"]` 超时。M8已按 `UI-MIG-M8-REVIEW-20261028.md` 审核合入main b594692，本轮基线就含React费用页；原套件的costSections / costOverview / costComposition / wbPeriod / wbLimit / wbSaveBudget等旧DOM定位已失效。只将它们映射到现有cost-ui-helpers、data-cost-*和真实角色控件；保留费用与用量的控件字体/字号/颜色、分区字体、卡片圆角/阴影/底色完全相等，以及主按钮token、预算范围、键盘Escape焦点、窄屏与账本字节断言。没有改interaction-reliability这个另行任务。

中间两次仍在“本月”选项超时。初步滚动/定位范围猜测未得到支持；真实toggle只记录closed→open，四项可见。ARIA快照确认已选项的完整名称为“本月 ✓”，旧helper用exact“本月”匹配不到。测试本地精确匹配“本月”或“本月 ✓”两种状态，再确认host.period；没有改kit或共享helper。第四次暴露新增等待回调未传key的测试代码错误，已改为浏览器内等待busy结束、在测试侧对period做严格断言。

第五次正式运行exit 0、57.702秒、247字节，末尾为 `PASS: style alignment and original controls at100/150, light/dark and800x600.`。五轮日志与各自图片均保留，诊断为 `diagnostic/style/{probe-1,scopes}.json` 和ARIA快照。所有修改仅在该测试脚本中，不增加sleep、不强制点击、不改原设计或放宽样式断言。

### 过时底色：ui-foundation

首次在light background严格比较失败：实际rgb(236,236,238)，旧预期rgb(246,246,246)。按已批准的 `UI-SURFACES-20261028.md` 及tokens.css，仅把测试窗口底色预期更新为浅色#ececee、深色#111112；前景、字体、干净房间逐属性隔离、默认kit、弹层、焦点、生命周期和动效断言不变。第二次exit 0、9.758秒、287字节，输出为 `PASS: React layer foundation — bundle, island lifecycle, portals, tokens in both themes, motion setting, isolation.`。**尽管断言完成，因不足10秒，按交接规则不计验收通过。** 没有加sleep或专门制造负载。证据为 `full/ui-foundation-ui-test.js{,.attempt-2}.log` 和 `full/ui-foundation-attempt-2/`。

## 8. 全量实际执行账本

51项最新结果分布：{"pass":44,"short-run-not-accepted":5,"known-failure":2}。严格保留交接“日志非空且至少10秒”规则；短运行没有加sleep、重排累计时长或标成通过。此表是本轮执行结果，不等于全量验收通过。

串行执行，源码模式，每个套件自身创建独立合成home / usage / quota；共享launch使用ui-smoke.js的同样隔离。未设置QUOTA_PACKAGED_EXE；没有validate:local、真实来源/账号、打包或远程操作。精确启动时间、环境变量、HEAD、dirty、秒数、退出码、日志字节及完整末尾在 `artifacts/ui-verify-design-palette-summary/full/runs.json`。临时驱动 `.cache/dps-run.cjs` 只编排现有套件，不替换断言或计时。

| 套件 / 实际命令 | 尝试 | exit | 实际秒数 | 日志字节 | 结论 |
|---|---:|---:|---:|---:|---|
| `node scripts/m1/activity-ui-test.js` | 1 | 0 | 22.204 | 767 | 通过 |
| `node scripts/m1/agent-conflict-ui-test.js` | 1 | 0 | 8.450 | 370 | exit 0但不足10秒，不计通过 |
| `node scripts/m1/agent-install-ui-test.js` | 1 | 0 | 23.133 | 320 | 通过 |
| `node scripts/m1/agent-recovery-ui-test.js` | 1 | 0 | 12.708 | 1567 | 通过 |
| `node scripts/m1/agent-setup-ui-test.js` | 1 | 0 | 18.796 | 305 | 通过 |
| `node scripts/m1/agent-ui-test.js` | 1 | 0 | 34.323 | 311 | 通过 |
| `node scripts/m1/billing-query-ui-test.js` | 1 | 0 | 20.407 | 377 | 通过 |
| `node scripts/m1/budget-overview-ui-test.js` | 1 | 0 | 14.087 | 143 | 通过 |
| `node scripts/m1/collection-diagnostic-ui-test.js` | 1 | 0 | 5.829 | 1422 | exit 0但不足10秒，不计通过 |
| `node scripts/m1/config-health-ui-test.js` | 1 | 0 | 20.874 | 288 | 通过 |
| `node scripts/m1/continuity-ui-test.js` | 2 | 0 | 29.647 | 274 | 通过 |
| `node scripts/m1/cost-compact-ui-test.js` | 1 | 0 | 16.137 | 329 | 通过 |
| `node scripts/m1/cost-composition-ui-test.js` | 1 | 0 | 22.790 | 405 | 通过 |
| `node scripts/m1/cost-layout-ui-test.js` | 1 | 0 | 12.330 | 323 | 通过 |
| `node scripts/m1/cost-live-readout-ui-test.js` | 1 | 0 | 2.843 | 273 | exit 0但不足10秒，不计通过 |
| `node scripts/m1/cost-rebuild-ui-test.js` | 1 | 0 | 34.526 | 257 | 通过 |
| `node scripts/m1/cost-reference-motion-ui-test.js . <worktrees>\verify-design-palette-summary-20261028\artifacts\ui-verify-design-palette-summary\full\cost-reference-motion after` | 1 | 0 | 147.493 | 381 | 通过 |
| `node scripts/m1/cost-smoke-ui-test.js` | 1 | 0 | 12.659 | 271 | 通过 |
| `node scripts/m1/cost-ui-test.js` | 1 | 0 | 12.869 | 315 | 通过 |
| `node scripts/m1/custom-sources-ui-test.js` | 1 | 0 | 37.739 | 108 | 通过 |
| `node scripts/m1/detail-ui-test.js` | 1 | 0 | 27.055 | 848 | 通过 |
| `node scripts/m1/functional-ui-test.js` | 2 | 0 | 75.480 | 851 | 通过 |
| `node scripts/m1/interaction-reliability-ui-test.js` | 1 | 1 | 18.999 | 685 | 交接已知失败，未修改 |
| `node scripts/m1/layout-ui-test.js` | 1 | 0 | 23.211 | 335 | 通过 |
| `node scripts/m1/motion-ui-test.js` | 1 | 0 | 49.105 | 31210 | 通过 |
| `node scripts/m1/overview-ui-test.js` | 3 | 0 | 24.021 | 275 | 通过 |
| `node scripts/m1/polish-ui-test.js` | 1 | 0 | 37.797 | 909 | 通过 |
| `node scripts/m1/provider-client-ui-test.js` | 1 | 0 | 50.051 | 66 | 通过 |
| `node scripts/m1/provider-login-ui-test.js` | 1 | 0 | 44.809 | 162 | 通过 |
| `node scripts/m1/provider-quota-ui-test.js` | 1 | 0 | 59.013 | 52 | 通过 |
| `node scripts/m1/quota-identity-ui-test.js` | 1 | 1 | 2.893 | 376 | 交接已知失败，未修改 |
| `node scripts/m1/quota-ui-test.js` | 1 | 0 | 26.365 | 743 | 通过 |
| `node scripts/m1/quota-v4-ui-test.js` | 1 | 0 | 19.578 | 51 | 通过 |
| `node scripts/m1/render-performance-ui-test.js` | 1 | 0 | 15.578 | 357 | 通过 |
| `node scripts/m1/renderer-lifecycle-ui-test.js` | 1 | 0 | 11.583 | 239 | 通过 |
| `node scripts/m1/sessions-ui-test.js` | 2 | 0 | 22.077 | 110 | 通过 |
| `node scripts/m1/settings-smoke-ui-test.js` | 1 | 0 | 13.354 | 302 | 通过 |
| `node scripts/m1/source-quota-ui-test.js` | 1 | 0 | 26.782 | 317 | 通过 |
| `node scripts/m1/statistics-worker-ui-test.js` | 2 | 0 | 11.448 | 449 | 通过 |
| `node scripts/m1/style-alignment-ui-test.js` | 5 | 0 | 57.702 | 247 | 通过 |
| `node scripts/m1/ui-disclosure-motion-ui-test.js` | 1 | 0 | 19.147 | 326 | 通过 |
| `node scripts/m1/ui-foundation-ui-test.js` | 2 | 0 | 9.758 | 287 | exit 0但不足10秒，不计通过 |
| `node scripts/m1/ui-kit-gallery-ui-test.js` | 1 | 0 | 67.753 | 285 | 通过 |
| `node scripts/m1/ui-m8-gallery-ui-test.js` | 1 | 0 | 7.386 | 622 | exit 0但不足10秒，不计通过 |
| `node scripts/m1/ui-mkb-gallery-ui-test.js` | 1 | 0 | 25.567 | 678 | 通过 |
| `node scripts/m1/ui-motion-mode-ui-test.js` | 1 | 0 | 11.188 | 317 | 通过 |
| `node scripts/m1/unpriced-guidance-ui-test.js` | 1 | 0 | 22.393 | 104 | 通过 |
| `node scripts/m1/usage-ui-test.js` | 1 | 0 | 66.406 | 288 | 通过 |
| `node scripts/m1/visual-ui-test.js` | 1 | 0 | 18.085 | 841 | 通过 |
| `node scripts/m1/widgets-ui-test.js` | 1 | 0 | 18.733 | 282 | 通过 |
| `node scripts/m1/workbench-ui-test.js` | 1 | 0 | 19.471 | 137 | 通过 |

### verify与runtime

- `npm.cmd run verify`：exit 0，47.374秒，61896字节，通过。完整日志：`artifacts/ui-verify-design-palette-summary/full/verify.attempt-2.log`。

```text
✔ failed cadence/subscription updates do not publish settings, reschedule or notify (1150.7681ms)
✔ referenced manual price removal is rejected before write; removing references permits deletion (1653.8354ms)
✔ catalog replacement preserves referenced targets or fails atomically; valid catalog fallback permits manual removal (264.131ms)
✔ legacy dangling billing target remains unpriced in GUI and query without rewriting saved files; new writes reject it (331.2388ms)
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 37743.0917
```

- `npm.cmd run audit:runtime`：exit 0，0.430秒，182字节，通过。完整日志：`artifacts/ui-verify-design-palette-summary/full/audit-runtime.attempt-2.log`。

```text
> agent-usage@0.1.0 audit:runtime
> node scripts/m1/audit-runtime.js

PASS: 153 reachable product modules; one entry, no retired paths/development imports, local UI assets present.
```

### 每项输出末尾

以下保留各项真实日志的末尾（最多800字符，完整内容见对应日志）；短运行和失败也列出。

#### activity-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/activity-ui-test.js.log`

```text
(node:26196) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
[{"scale":1,"packaged":false,"annualGridIndependentOfSummaryPeriod":true,"allPeriodsKeepSmallSquares":true,"hoverExactTokens":true,"keyboardAndClick":true,"zeroVersusUnknown":true,"midnightAndNewYear":true,"todayIpcRefresh":true,"reducedMotion":true,"narrowTooltipBounds":true,"noPageErrors":true},{"scale":1.5,"packaged":false,"annualGridIndependentOfSummaryPeriod":true,"allPeriodsKeepSmallSquares":true,"hoverExactTokens":true,"keyboardAndClick":true,"zeroVersusUnknown":true,"midnightAndNewYear":true,"todayIpcRefresh":true,"reducedMotion":true,"narrowTooltipBounds":true,"noPageErrors":true}]
```

#### agent-conflict-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/agent-conflict-ui-test.js.log`

```text
[{"scale":1,"packaged":false,"nativeTokens":120,"visibleConflict":true,"diagnosticInViewport":true,"unpricedLower":true,"unknownBuckets":true,"sourceHashesUnchanged":true,"errors":[]},{"scale":1.5,"packaged":false,"nativeTokens":120,"visibleConflict":true,"diagnosticInViewport":true,"unpricedLower":true,"unknownBuckets":true,"sourceHashesUnchanged":true,"errors":[]}]
```

#### agent-install-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/agent-install-ui-test.js.log`

```text
PASS 1: direct install/upgrade, progress, cancel/retry, desktop handoff/postcheck and official fallback.
PASS 1.25: direct install/upgrade, progress, cancel/retry, desktop handoff/postcheck and official fallback.
PASS 1.5: direct install/upgrade, progress, cancel/retry, desktop handoff/postcheck and official fallback.
```

#### agent-recovery-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/agent-recovery-ui-test.js.log`

```text
t":"opencode","scale":1.5,"packaged":false,"nativeTokens":140,"actualCollector":true,"knownBuckets":true,"recoveredCostUsd":1.8,"firstAttribution":true,"sourceHashesUnchanged":true,"label":"API 等价估算 $1.80；定价覆盖 100.0%。仅包括已定价部分，未知费用不计为零，API 等价估算不代表订阅账单。","errors":[]},{"first":"mimo","scale":1,"packaged":false,"nativeTokens":140,"actualCollector":true,"knownBuckets":true,"recoveredCostUsd":1.8,"firstAttribution":true,"sourceHashesUnchanged":true,"label":"API 等价估算 $1.80；定价覆盖 100.0%。仅包括已定价部分，未知费用不计为零，API 等价估算不代表订阅账单。","errors":[]},{"first":"mimo","scale":1.5,"packaged":false,"nativeTokens":140,"actualCollector":true,"knownBuckets":true,"recoveredCostUsd":1.8,"firstAttribution":true,"sourceHashesUnchanged":true,"label":"API 等价估算 $1.80；定价覆盖 100.0%。仅包括已定价部分，未知费用不计为零，API 等价估算不代表订阅账单。","errors":[]}]
```

#### agent-setup-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/agent-setup-ui-test.js.log`

```text
PASS 1: ten Agent setup guides, fixed actions, actual IPC, failure recovery and narrow dark layout.
PASS 1.25: ten Agent setup guides, fixed actions, actual IPC, failure recovery and narrow dark layout.
PASS 1.5: ten Agent setup guides, fixed actions, actual IPC, failure recovery and narrow dark layout.
```

#### agent-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/agent-ui-test.js.log`

```text
(node:7628) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: 10 format-backed sources, independent native totals, 100%/150% Electron scopes/logos, pricing defaults, file picker, guards and restart.
```

#### billing-query-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/billing-query-ui-test.js.log`

```text
PASS 1: explicit aliases, rate/multiplier add/edit/reset; validation, zero/null, failure retry and saved-query consistency.
PASS 1.25: explicit aliases, rate/multiplier add/edit/reset; validation, zero/null, failure retry and saved-query consistency.
PASS 1.5: explicit aliases, rate/multiplier add/edit/reset; validation, zero/null, failure retry and saved-query consistency.
```

#### budget-overview-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/budget-overview-ui-test.js.log`

```text
PASS: global saved budgets, independent issues/omission counts, own-scope acknowledge/restore, unknown states and narrow dark UI at 100%/150%.
```

#### collection-diagnostic-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/collection-diagnostic-ui-test.js.log`

```text
,"effect":"已有数据保留不变 · 出错环节：扫描来源文件 · 检查该位置的访问权限后重新检查","title":"错误代码 COLLECTION_FAILED · 原因代码 EACCES"},{"name":"native","what":"最近一次采集没有完成：统计组件校验不一致，已拒绝运行","effect":"已有数据保留不变 · 出错环节：统计组件核对 · 重新安装本应用后再试","title":"错误代码 NATIVE_BINARY_MISMATCH"},{"name":"controlled","what":"最近一次采集没有完成：读取位置不被允许","effect":"已有数据保留不变 · 出错环节：扫描来源文件 · 可以重新检查","title":"错误代码 SOURCE_PATH_REJECTED"},{"name":"timeout","what":"最近一次采集没有完成：采集超时","effect":"已有数据保留不变 · 出错环节：采集进程 · 稍后重试","title":"错误代码 COLLECTION_TIMEOUT"},{"name":"unknown","what":"最近一次采集没有完成：原因未知","effect":"已有数据保留不变 · 出错环节：采集 · 可以重新检查","title":"错误代码 COLLECTION_FAILED"},{"name":"unreported","what":"最近一次采集没有完成：原因未报告","effect":"已有数据保留不变 · 可以重新检查","title":"错误代码 COLLECTION_FAILED"}],"badgeOpensList":true,"retryUsesSourceRefresh":true,"clears":true,"noPageErrors":true}
```

#### config-health-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/config-health-ui-test.js.log`

```text
{"status":"passed","scales":[1,1.5],"readonlyChecks":true,"localManagement":true,"realConfigurations":false,"output":"<worktrees>\\verify-design-palette-summary-20261028\\artifacts\\ui-verify-design-palette-summary\\full\\config-health"}
```

#### continuity-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/continuity-ui-test.js.attempt-2.log`

```text
(node:27420) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: quota acceleration/retarget, minute cadence, honest gap connections and logo filters at 100%/150%.
```

#### cost-compact-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/cost-compact-ui-test.js.log`

```text
(node:41052) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: A drawer (25 models, 10 users, bounded model lists), full titles, readable trends and point readout at 100/125/150; narrow stacking and ledger unchanged.
```

#### cost-composition-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/cost-composition-ui-test.js.log`

```text
(node:22608) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: actual gap paths, large full/semi ring, grouped/stacked morph, integrated subscriptions, coordinated panels, icon picker, hover range edge, pointer/keyboard brush, pinned readout, dark/narrow/reduced/off and unchanged usage facts
```

#### cost-layout-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/cost-layout-ui-test.js.log`

```text
(node:14844) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: section order, unclipped composition, one-line headings, every desktop column, in-place trend, finite hover bounds, paired checks and narrow safety
```

#### cost-live-readout-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/cost-live-readout-ui-test.js.log`

```text
(node:37564) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: real cost capsule refreshes during synthetic repricing, same node/key/focus and ledger unchanged.
```

#### cost-rebuild-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/cost-rebuild-ui-test.js.log`

```text
(node:27472) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: whole cost page, expanded rows, 4 widths, light/dark, 100/150 and unchanged facts
```

#### cost-reference-motion-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/cost-reference-motion-ui-test.js.log`

```text
(node:16728) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS real motion capture: after 33 scenarios, <worktrees>\verify-design-palette-summary-20261028\artifacts\ui-verify-design-palette-summary\full\cost-reference-motion
```

#### cost-smoke-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/cost-smoke-ui-test.js.log`

```text
(node:29172) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: M8 cost smoke from page template, both themes, isolated layers, data semantics and sheet focus.
```

#### cost-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/cost-ui-test.js.log`

```text
(node:41356) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
range Tab entries {"groupEntry":false,"buttonEntries":1}
PASS cost-ui run 1 seed 2aab3ac26b4beec4ca6090acc9916581e0e9d6998960cccb03aa4b1a6dbc1624
```

#### custom-sources-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/custom-sources-ui-test.js.log`

```text
PASS: custom JSONL source wizard, mapping, registry, pricing, history and private-data guards at 100%/150%.
```

#### detail-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/detail-ui-test.js.log`

```text
experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
[{"scale":1,"packaged":false,"inlineRange":{"lower":8.97,"upper":20.825000000000003},"retarget":true,"searchAndKeyboard":true,"menuMaxHeight":360,"detailInset":{"left":25,"right":25},"scrollInterruption":true,"reducedAndSystemPreference":true,"darkNarrow":true,"noErrors":true,"realLogin":false,"numberFrames":236},{"scale":1.5,"packaged":false,"inlineRange":{"lower":8.97,"upper":20.825000000000003},"retarget":true,"searchAndKeyboard":true,"menuMaxHeight":359.33331298828125,"detailInset":{"left":24.666671752929688,"right":24.666702270507812},"scrollInterruption":true,"reducedAndSystemPreference":true,"darkNarrow":true,"noErrors":true,"realLogin":false,"numberFrames":232}]
```

#### functional-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/functional-ui-test.js.attempt-2.log`

```text
erimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
[{"scale":1,"packaged":false,"rest":{"font":40.12,"width":207.390625,"transform":"none","top":296.46875},"allSyntheticModelsPriced":true,"manualMapping":true,"defaultsPersistent":true,"offlineSyncFailurePreservesCache":true,"trendAnimationFrames":196,"chartReused":true,"reducedMotion":true,"noHorizontalOverflow":true,"errors":[]},{"scale":1.5,"packaged":false,"rest":{"font":40.12,"width":207.39584350585938,"transform":"none","top":296.4895935058594},"allSyntheticModelsPriced":true,"manualMapping":true,"defaultsPersistent":true,"offlineSyncFailurePreservesCache":true,"trendAnimationFrames":170,"chartReused":true,"reducedMotion":true,"noHorizontalOverflow":true,"errors":[]}]
```

#### interaction-reliability-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/interaction-reliability-ui-test.js.log`

```text
CHECK 1 composition-search sessions
CHECK 1 composition-search settings
CHECK 1 composition-search cost
FAILURE STATE 重试操作 正在检查读取位置…
locator.click: Timeout 15000ms exceeded.
Call log:
[2m  - waiting for locator('[data-cost-by="model"]')[22m

    at <worktrees>\verify-design-palette-summary-20261028\scripts\m1\interaction-reliability-ui-test.js:77:77 {
  log: [ `  - waiting for locator('[data-cost-by="model"]')` ],
  name: 'TimeoutError'
}
```

#### layout-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/layout-ui-test.js.log`

```text
(node:3876) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: layout geometry and interaction regressions (overflow, cover, expand, tooltip, edge hover, hour grid, calendar, filter hold, range calendar, legend, cost line).
```

#### motion-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/motion-ui-test.js.log`

```text
":true},{"t":440.5999999985106,"opacity":1,"transform":"matrix(1, 0, 0, 1, -200, -243)","focusInside":true},{"t":443.8999999985099,"opacity":1,"transform":"matrix(1, 0, 0, 1, -200, -243)","focusInside":true},{"t":447.3999999985099,"opacity":1,"transform":"matrix(1, 0, 0, 1, -200, -243)","focusInside":true},{"t":450.69999999850916,"opacity":1,"transform":"matrix(1, 0, 0, 1, -200, -243)","focusInside":true}],"transitionFrames":{"samples":138,"averageMs":3.647101449267264,"maxMs":9.899999999999636},"closing":{"ms":236},"changes":{"off":{"maxCommitMs":84.10000000149012,"averageCommitMs":57.759999999962744,"maxFrameGapMs":166.70000000000073,"samples":20},"system":{"maxCommitMs":112.59999999962747,"averageCommitMs":68.075,"maxFrameGapMs":170,"samples":20}},"noPageErrors":true,"realLogin":false}]
```

#### overview-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/overview-ui-test.js.attempt-3.log`

```text
(node:35048) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: overview scope, honest day detail, tooltip pointer/wheel pass-through, quota cooldown at 100%/150%.
```

#### polish-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/polish-ui-test.js.log`

```text
 at any time
(Use `node --trace-warnings ...` to show where the warning was created)
[{"scale":1,"packaged":false,"productMenus":["统计","外观","关于"],"history":true,"sidebar":true,"stableHoverGeometry":true,"continuousTarget":{"middle":"53","final":"100","active":0},"shortCardWheel":true,"longCardWheel":true,"bothBoundaryHandoffs":true,"themeAndNativeMaximize":true,"narrowHeaderSafeArea":true,"reduced":true,"noErrors":true,"realLogin":false},{"scale":1.5,"packaged":false,"productMenus":["统计","外观","关于"],"history":true,"sidebar":true,"stableHoverGeometry":true,"continuousTarget":{"middle":"53","final":"100","active":0},"shortCardWheel":true,"longCardWheel":true,"bothBoundaryHandoffs":true,"themeAndNativeMaximize":true,"narrowHeaderSafeArea":true,"reduced":true,"noErrors":true,"realLogin":false}]
```

#### provider-client-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/provider-client-ui-test.js.log`

```text
PASS provider client login UI 1
PASS provider client login UI 1.5
```

#### provider-login-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/provider-login-ui-test.js.log`

```text
PASS ordinary Chrome dispatch, no embedded login windows, manual quota validation/encryption, browser error retry, restart, expiry and removal. No live accounts.
```

#### provider-quota-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/provider-quota-ui-test.js.log`

```text
PASS provider quota UI 1
PASS provider quota UI 1.5
```

#### quota-identity-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/quota-identity-ui-test.js.log`

```text
AssertionError [ERR_ASSERTION]: each known account is one card; the two accounts stay apart

1 !== 2

    at <worktrees>\verify-design-palette-summary-20261028\scripts\m1\quota-identity-ui-test.js:60:14 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: 1,
  expected: 2,
  operator: 'strictEqual',
  diff: 'simple'
}
```

#### quota-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/quota-ui-test.js.log`

```text
(node:17888) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
[{"packaged":false,"scale":1,"nativeRenderer":true,"quotaCacheAndUnknown":true,"routeAndModal":true,"syntheticLoginRefreshLogoutThroughIpc":true,"allRefreshErrorCooldownCancel":true,"credentialProcessStarted":false,"noPageErrors":true,"restartRemembersAutoRefreshHistoricalCache":true},{"packaged":false,"scale":1.5,"nativeRenderer":true,"quotaCacheAndUnknown":true,"routeAndModal":true,"syntheticLoginRefreshLogoutThroughIpc":true,"allRefreshErrorCooldownCancel":true,"credentialProcessStarted":false,"noPageErrors":true,"restartRemembersAutoRefreshHistoricalCache":true}]
```

#### quota-v4-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/quota-v4-ui-test.js.log`

```text
PASS quota v4 UI 1 dark
PASS quota v4 UI 1.5 light
```

#### render-performance-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/render-performance-ui-test.js.log`

```text
(node:14452) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS render performance: <worktrees>\verify-design-palette-summary-20261028\artifacts\ui-verify-design-palette-summary\full\render-performance
```

#### renderer-lifecycle-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/renderer-lifecycle-ui-test.js.log`

```text
PASS: renderer lifecycle, empty month, live hover, IME and cancelled swipe; <worktrees>\verify-design-palette-summary-20261028\artifacts\ui-verify-design-palette-summary\full\renderer-lifecycle
```

#### sessions-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/sessions-ui-test.js.attempt-2.log`

```text
PASS: session page groups, drawer motion, literal resume command, range/search and today counts at 100%/150%.
```

#### settings-smoke-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/settings-smoke-ui-test.js.log`

```text
(node:20724) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: settings page — {"view":"settings","synthetic":true,"viewport":[1280,900],"themes":["light","dark"],"dialogs":3,"errors":[]}
```

#### source-quota-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/source-quota-ui-test.js.log`

```text
PASS 1: source/quota capability, freshness, independent lifecycle, privacy, status retry and narrow UI.
PASS 1.25: source/quota capability, freshness, independent lifecycle, privacy, status retry and narrow UI.
PASS 1.5: source/quota capability, freshness, independent lifecycle, privacy, status retry and narrow UI.
```

#### statistics-worker-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/statistics-worker-ui-test.js.attempt-2.log`

```text
(node:10492) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
{"packaged":false,"senderGuard":true,"usageReusesHomeSessions":true,"noLedgerInMain":true,"workerRestartPreservesTotals":true,"enabledRestartResumesCollection":true,"repriceNavigation":true,"noRendererErrors":true,"ledgerUnchangedBeforeEnabledPhase":true,"realAccountRequests":0}
```

#### style-alignment-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/style-alignment-ui-test.js.attempt-5.log`

```text
(node:27400) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: style alignment and original controls at100/150, light/dark and800x600.
```

#### ui-disclosure-motion-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/ui-disclosure-motion-ui-test.js.log`

```text
(node:4356) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: same mounted Disclosure, full intermediate height, dynamic system/app reduced and off next-frame open/close, both themes, keyboard/focus/node identity.
```

#### ui-foundation-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/ui-foundation-ui-test.js.attempt-2.log`

```text
(node:29012) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: React layer foundation — bundle, island lifecycle, portals, tokens in both themes, motion setting, isolation.
```

#### ui-kit-gallery-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/ui-kit-gallery-ui-test.js.log`

```text
(node:39660) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: kit gallery — both themes, clean room, semantics, controls, popups, keyboard/focus, motion and screenshots.
```

#### ui-m8-gallery-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/ui-m8-gallery-ui-test.js.log`

```text
(node:27476) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
live capsule: [data-m8-case=stack] [data-stack-key=a]
live capsule: [data-m8-case=months] [data-chart-key=sep]
live capsule: [data-m8-case=spark-tooltip] [data-line-point="0"]
live capsule: [data-m8-case=stack] [data-stack-key=a]
live capsule: [data-m8-case=months] [data-chart-key=sep]
live capsule: [data-m8-case=spark-tooltip] [data-line-point="0"]
PASS: M8 approved kit interfaces, original colours, keyboard, capsule, unknown/zero and reduced/off.
```

#### ui-mkb-gallery-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/ui-mkb-gallery-ui-test.js.log`

```text
light: bars/lines/shared hints
light: heatmap/timeline/steps
light: carousel/sort/card/reveal/panes
light: calendars/side sheets
light: reduced/off, retarget and pointer gestures
dark: rings/gauge/legend
dark: bars/lines/shared hints
dark: heatmap/timeline/steps
dark: carousel/sort/card/reveal/panes
dark: calendars/side sheets
dark: reduced/off, retarget and pointer gestures
PASS: MK-b gallery, controlled charts, unknown/zero, keyboard, focus, tooltip ownership and side sheets.
```

#### ui-motion-mode-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/ui-motion-mode-ui-test.js.log`

```text
(node:7336) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: real motion preference and system changes during Sheet entry/exit, both themes, synthetic visibility interruption, focus and pointer released.
```

#### unpriced-guidance-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/unpriced-guidance-ui-test.js.log`

```text
PASS: actionable unpriced reasons, targeted sources, fee confirmation and unchanged facts at 100%/150%.
```

#### usage-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/usage-ui-test.js.log`

```text
(node:34420) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: unified desktop usage controls at 100%/150%; five sources, refresh, pause, directory guards, export and restart.
```

#### visual-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/visual-ui-test.js.log`

```text
 is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
[{"scale":1,"packaged":false,"fixedWidgets":[{"width":283.53125,"height":283.546875},{"width":283.546875,"height":283.546875},{"width":283.53125,"height":283.546875}],"darkAndNarrow":true,"exactEstimateBounds":true,"unknownAndZeroDistinct":true,"threeWindowPanel":true,"keyboardDialogs":true,"noPageErrors":true},{"scale":1.5,"packaged":false,"fixedWidgets":[{"width":283.6458435058594,"height":283.6458435058594},{"width":283.6458435058594,"height":283.6458435058594},{"width":283.6458435058594,"height":283.6458435058594}],"darkAndNarrow":true,"exactEstimateBounds":true,"unknownAndZeroDistinct":true,"threeWindowPanel":true,"keyboardDialogs":true,"noPageErrors":true}]
```

#### widgets-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/widgets-ui-test.js.log`

```text
(node:29612) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS: widget column on every page but settings, default layout, edit, library, settings, readout, saved layouts.
```

#### workbench-ui-test.js

`artifacts/ui-verify-design-palette-summary/full/workbench-ui-test.js.log`

```text
PASS: insights integrated into existing cost, source and session pages, private export, failed-save recovery and repricing at 100%/150%.
```

### 失败及复跑处理

- continuity：首次旧值入场/刷新采样竞态，已按第7节修正测试准备，原数值与动效断言保留；正式复跑通过。
- overview：原套件漏采导航滚动中已开始又退出结束的重播；按第7节建立稳定视口退出后再推进原冷却时钟，所有原断言保留，第三次正式运行通过。
- sessions：已批准概览首页会读取保存的会话列表；将过时的“尚未加载”前提替换为切到用量新增usage:sessions IPC为0、列表对象不变，其余原断言保留，第二次正式运行通过。
- statistics-worker：同一个已批准首页列表读取前提修正，其余发送方/工作线程/字节/启用采集检查保留，第二次正式运行通过。
- style-alignment：M8前旧DOM定位映射到当前费用页；完整样式相等、预算与键盘断言保留。已选项真实ARIA名称含✓，本地匹配两个明确状态；中途测试key参数错误已修正。第五次正式运行通过，全部失败日志保留。
- ui-foundation：仅按UI-SURFACES批准的两个窗口底色更新旧预期，隔离/焦点/动效等原断言保留；exit 0但9.758秒，严格不计通过。
- functional：首次在用量费用读数悬停等待处超时。仅增加观测的临时诊断中，两档DPI都得到hover=true、cost-expanded=true，并完成后续流程；随后原套件源码不变正式复跑exit 0、75.480秒。首次原因尚未确定，不能据此宣称已修产品问题；原失败日志与hero-rest图、诊断及复跑证据均保留。
- interaction-reliability / quota-identity：按交接另行任务，未修改源码；实际结果以本表与日志为准。

## 9. 两尺寸全页面前后对照

| 实际捕获命令 | exit | 秒 | 输出末尾 |
|---|---:|---:|---|
| `node scripts/m1/ui-pixel-gate.js capture <repo> <worktrees>\verify-design-palette-summary-20261028\artifacts\ui-verify-design-palette-summary\captures\before-1180x850 --size 1180x850` | 0 | 48.111 | (node:35320) ExperimentalWarning: SQLite is an experimental feature and might change at any time<br>(Use `node --trace-warnings ...` to show where the warning was created)<br>captured 12 views from b594692 into <worktrees>\verify-design-palette-summary-20261028\artifacts\ui-verify-design-palette-summary\captures\before-1180x850 |
| `node scripts/m1/ui-pixel-gate.js capture <worktrees>\verify-design-palette-summary-20261028 <worktrees>\verify-design-palette-summary-20261028\artifacts\ui-verify-design-palette-summary\captures\after-1180x850 --size 1180x850` | 0 | 45.925 | (node:15108) ExperimentalWarning: SQLite is an experimental feature and might change at any time<br>(Use `node --trace-warnings ...` to show where the warning was created)<br>captured 12 views from a19d218 into <worktrees>\verify-design-palette-summary-20261028\artifacts\ui-verify-design-palette-summary\captures\after-1180x850 |
| `node scripts/m1/ui-pixel-gate.js capture <repo> <worktrees>\verify-design-palette-summary-20261028\artifacts\ui-verify-design-palette-summary\captures\before-1440x900 --size 1440x900` | 0 | 45.832 | (node:3312) ExperimentalWarning: SQLite is an experimental feature and might change at any time<br>(Use `node --trace-warnings ...` to show where the warning was created)<br>captured 12 views from b594692 into <worktrees>\verify-design-palette-summary-20261028\artifacts\ui-verify-design-palette-summary\captures\before-1440x900 |
| `node scripts/m1/ui-pixel-gate.js capture <worktrees>\verify-design-palette-summary-20261028 <worktrees>\verify-design-palette-summary-20261028\artifacts\ui-verify-design-palette-summary\captures\after-1440x900 --size 1440x900` | 0 | 48.845 | (node:37248) ExperimentalWarning: SQLite is an experimental feature and might change at any time<br>(Use `node --trace-warnings ...` to show where the warning was created)<br>captured 12 views from a19d218 into <worktrees>\verify-design-palette-summary-20261028\artifacts\ui-verify-design-palette-summary\captures\after-1440x900 |

main为b594692，候选为当前产品源码。两尺寸1180×850、1440×900，light / dark，quota / usage / cost / sessions / sources / settings；每项首屏和整页。原始capture使用相同冻结时钟、fixture mtime及sRGB参数，manifest记录实际HEAD与错误。没有改变算法、预算、遮挡或截图后颜色转换。本轮按交接只作前后审核，不用像素通过判定。

完整对照入口：`artifacts/ui-verify-design-palette-summary/captures/pairs/index.md`（48对，左main、右候选）；原图、尺寸与路径清单：`pairs/index.json`。原PNG不缩放、不裁切，拼图中的留白只补较短一侧。

## 10. 交付与停止

本轮产品修复为8ca6cf0；continuity测试准备修正为7467e0f；overview视口准备修正为20f9249；sessions为7363017；statistics-worker为171d70b；style-alignment为4d2440a；ui-foundation为13ac81c。最终源码基线为a19d218（仅在13ac81c后补overview的IntersectionObserver ESLint全局注释，测试运行逻辑不变），交付记录提交只改文档。每次实际运行HEAD/dirty保留在账本，先前通过的产品字节自8ca6cf0后没有变化。产品样式、kit、theme、token、morph、后端、IPC没有修改。原始失败没有删除，证据SHA-256为 `artifacts/ui-verify-design-palette-summary/evidence-index.json`。

没有合main、push、PR、打包、上传、真实数据验收或子代理；Claude原工作区与旧M6工作区保持原样。M7未开始。交付后停止，等待Claude审核与所有者合并；不足10秒的套件仍不计通过，已知失败仍未处理。
