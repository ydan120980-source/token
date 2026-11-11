# M8 逐断言映射 · 2026-10-27

**2026-10-28 原版对标修订：** 以下295项定位已逐项重新匹配当前源码，全部 anchor 可定位。与旧 G7 外观说明冲突时，以所有者批准的 `UI-MIG-M8-REFERENCE-FIDELITY-20261027.md` §4、§7 为准；不是删除旧语义断言。实际执行结果以日期为20261028的交付记录为准。

本轮原生 DOM 映射：原范围选中态是 `aria-pressed`；明细字段为四项 `li`；详情恢复440px；项目金额为原 `strong`；原按钮填色直接比原 text token；名称保留省略号并检查 overflow/ellipsis/nowrap，数值仍完整检查；同一表头的不同字体基线按相交文字行统计，真实换行仍失败；金额区间保留原 NBSP。对比度逐尺寸逐色分别激活A、C后测量，4.5/3阈值不改，不计不可交互的0.35透明度邻页。原说明文字按完整对标恢复。微图键盘检查从原生行按钮进入，保留焦点，Home/End读取真实首末日期。排序、滚动、详情关闭、隐私与账本检查全部保留。

依据盘点 §6.1、§6.2 的每个“原行号 # 次序”逐项登记。原表达式留在盘点；下表定位当前实际断言或 until 验证。数值、未知、隐私、精确小数、副作用、键盘、焦点和无错误不退役。G7 仅替换实现形态；新版范围入口以 tablist 或按钮的唯一 Tab 入口和实际 Home/ESC 验证。

主套件实际执行结果见交付记录。M7 的 functional/visual/polish 全套本步未执行；其未变的设置/用量断言保留在原文件，费用相关入口/无错误/窄屏/定价语义由已运行的 M8 cost、smoke、rebuild、workbench、unpriced-guidance 交叉覆盖，不能称这些整套已通过。

## cost-ui-test.js

| 盘点原行号 # 次序 | 当前目标 | 当前检查定位 / 替代依据 |
|---|---|---|
| 51 #1 | `scripts/m1/cost-ui-test.js:42` | `data-current-view`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 52 #1 | `scripts/m1/cost-ui-test.js:42` | `#windowPage`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 55 #1 | `scripts/m1/cost-ui-test.js:43` | `name:/^模型 /`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 56 #1 | `scripts/m1/cost-ui-test.js:44` | `/累计/`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 57 #1 | `scripts/m1/cost-ui-test.js:44` | `data-compare'),'false'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 58 #1 | `scripts/m1/cost-ui-test.js:45` | `assert.deepEqual(await c.names(page),['gpt-6.1-sol'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 60 #1 | `scripts/m1/cost-ui-test.js:46` | `/^未计入没有价格$/`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 61 #1 | `scripts/m1/cost-ui-test.js:47` | `80\.0%`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 64 #1 | `scripts/m1/cost-ui-test.js:48` | `来源没有单独报告推理 Token`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 65 #1 | `scripts/m1/cost-ui-test.js:49` | `name:'查看来源'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 66 #1 | `scripts/m1/cost-ui-test.js:50` | `缓存读取.*（部分未报告）`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 71 #1 | `scripts/m1/cost-ui-test.js:52` | `估算区间.*(缓存写入未报告`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 72 #1 | `scripts/m1/cost-ui-test.js:53` | `assert.equal(await c.detail(page).count(),1)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 76 #1 | `scripts/m1/cost-ui-test.js:54` | `assert.equal((await c.names(page)).length,8)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 76 #2 | `scripts/m1/cost-ui-test.js:55` | `收起，只看前 6 个',exact:true}).count()`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 77 #1 | `scripts/m1/cost-ui-test.js:56` | `assert.equal((await c.names(page)).length,7)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 80 #1 | `scripts/m1/cost-ui-test.js:57` | `includes(sorted[0])`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 80 #2 | `scripts/m1/cost-ui-test.js:57` | `sorted.at(-1)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 86 #1 | `scripts/m1/cost-ui-test.js:60` | `assert.equal(await dialog(page).count(),1)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 87 #1 | `scripts/m1/cost-ui-test.js:60` | `getByRole('heading').first().textContent(),'synthetic-unpriced'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 88 #1 | `scripts/m1/cost-ui-test.js:61` | `assert.equal(await c.detail(page).count(),0)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 92 #1 | `scripts/m1/cost-ui-test.js:62` | `data-compare'),'true'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 93 #1 | `scripts/m1/cost-ui-test.js:62` | `#periods [data-period="all"]`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 97 #1 | `scripts/m1/cost-ui-test.js:64` | `/^已计价`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 98 #1 | `scripts/m1/cost-ui-test.js:64` | `comp.locator('[data-legend-key]').count(),3`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 106 #1 | `scripts/m1/cost-ui-test.js:73` | `assert.notEqual(await center(),whole)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 107 #1 | `scripts/m1/cost-ui-test.js:73` | `assert.equal(await center(),whole)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 109 #1 | `scripts/m1/cost-ui-test.js:74` | `['输入','输出','缓存读取','缓存写入']`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 114 #1 | `scripts/m1/cost-ui-test.js:76` | `last().getAttribute('data-chart-key'),current`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 115 #1 | `scripts/m1/cost-ui-test.js:77` | `/推算整月`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 117 #1 | `scripts/m1/cost-ui-test.js:78` | `window.costHost.state().month),current`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 118 #1 | `scripts/m1/cost-ui-test.js:79` | `[data-reference-segment="费用时间范围"][aria-pressed="true"]')`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 122 #1 | `scripts/m1/cost-ui-test.js:92` | `getComputedStyle(e).boxShadow),'none'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 128 #1 | `scripts/m1/cost-ui-test.js:94` | `fee.inputValue(),'20'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 130 #1 | `scripts/m1/cost-ui-test.js:44` | `textContent(),/累计/`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 132 #1 | `scripts/m1/cost-ui-test.js:96` | `textContent(),/没有价格/`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 133 #1 | `scripts/m1/cost-ui-test.js:96` | `name:/设置计费`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 134 #1 | `scripts/m1/cost-ui-test.js:97` | `textContent(),/约省下/`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 138 #1 | `scripts/m1/cost-ui-test.js:98` | `['Codex','Claude Code','OpenCode']`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 141 #1 | `scripts/m1/cost-ui-test.js:100` | `window.m8FirstCostRow===document.querySelector`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 147 #1 | `scripts/m1/cost-ui-test.js:103` | `csv.startsWith`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 147 #2 | `scripts/m1/cost-ui-test.js:103` | `lines.length,4`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 148 #1 | `scripts/m1/cost-ui-test.js:103` | `/,Agent,Codex,,/`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 148 #2 | `scripts/m1/cost-ui-test.js:103` | `/价格目录中没有此模型/`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 154 #1 | `scripts/m1/cost-ui-test.js:106` | `cache.height<=cache.max`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 156 #1 | `scripts/m1/cost-ui-test.js:107` | `scrollTop>0`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 159 #1 | `scripts/m1/cost-ui-test.js:110` | `assert(geometry.left<24)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 162 #1 | `scripts/m1/cost-ui-test.js:118` | `getAnimations({subtree:true})`；退役 420ms 字面量；Q5/G7 改为 reduced/off 终态；打断和新目标见 MK-b gallery motion |
| 163 #1 | `scripts/m1/cost-ui-test.js:118` | `getAnimations({subtree:true})`；退役旧 easing 字面量；Q5/G7，同上；不删除终态和手势检查 |
| 164 #1 | `scripts/m1/cost-ui-test.js:110` | `assert.equal(geometry.width,440)`；退役旧 22px；Q5 改为 kit Sheet lg，规范圆角由 gallery/设计检查覆盖 |
| 165 #1 | `scripts/m1/ui-page-smoke-template.js:9` | `isolationViolations`；旧 price-editor 头部 padding 选择器退役；Q5 改为 kit Sheet，模板隔离 / 焦点验证替代 |
| 166 #1 | `scripts/m1/cost-ui-test.js:112` | `e.contains(document.activeElement)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 169 #1 | `scripts/m1/cost-ui-test.js:113` | `locator('[data-line-point]').first().focus()`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 170 #1 | `scripts/m1/cost-ui-test.js:114` | `e=>e===document.activeElement`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 181 #1 | `scripts/m1/cost-ui-test.js:118` | `getAnimations({subtree:true})`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 191 #1 | `scripts/m1/cost-migration-checks.js:22` | `assert.equal(geometry.overflow,false)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 191 #2 | `scripts/m1/cost-migration-checks.js:78` | `numeric cells do not overlap`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 191 #3 | `scripts/m1/cost-migration-checks.js:78` | `numeric text stays in its cell`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 193 #1 | `scripts/m1/cost-ui-test.js:123` | `getComputedStyle(e).position),'fixed'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 207 #1 | `scripts/m1/cost-ui-test.js:122` | `document.documentElement.scrollWidth<=document.documentElement.clientWidth`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 208 #1 | `scripts/m1/cost-ui-test.js:131` | `assert.deepEqual(errors,[])`；保留；角色 / 数据钩子替代旧 DOM（G7） |
## cost-layout-ui-test.js

| 盘点原行号 # 次序 | 当前目标 | 当前检查定位 / 替代依据 |
|---|---|---|
| 28 #1 | `scripts/m1/cost-layout-ui-test.js:28` | `estimated range exists`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 30 #1 | `scripts/m1/cost-layout-ui-test.js:30` | `assert(!after.includes('NaN'))`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 30 #2 | `scripts/m1/cost-layout-ui-test.js:30` | `assert.equal(after,before`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 44 #1 | `scripts/m1/cost-migration-checks.js:17` | `geometry.order.every`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 44 #2 | `scripts/m1/cost-migration-checks.js:18` | `geometry.months.y>=geometry.where.y`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 44 #3 | `scripts/m1/cost-migration-checks.js:18` | `ring/legend stay inside panel`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 44 #4 | `scripts/m1/cost-migration-checks.js:19` | `table headings stay on one text line`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 44 #5 | `scripts/m1/cost-migration-checks.js:20` | `every table column remains reachable`；Q3 DataTable 保留所有列，窄屏在表格内部横向可达 |
| 44 #6 | `scripts/m1/cost-migration-checks.js:21` | `assert(b.x>=a.right)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 44 #7 | `scripts/m1/cost-migration-checks.js:21` | `Math.abs(a.y-b.y)<2`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 44 #8 | `scripts/m1/cost-migration-checks.js:22` | `assert.equal(geometry.overflow,false)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 54 #1 | `scripts/m1/cost-migration-checks.js:26` | `assert(await plot.isVisible())`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 54 #2 | `scripts/m1/cost-migration-checks.js:30` | `bands remain within frame`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 54 #3 | `scripts/m1/cost-migration-checks.js:29` | `data-cost-trend-legend`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 55 #1 | `scripts/m1/cost-migration-checks.js:22` | `assert.equal(geometry.overflow,false)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 56 #1 | `scripts/m1/cost-layout-ui-test.js:43` | `t.includes('NaN')`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 56 #2 | `scripts/m1/cost-layout-ui-test.js:43` | `fs.readFileSync(path.join(usage,'statistics.json')),facts`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 58 #1 | `scripts/m1/cost-layout-ui-test.js:44` | `assert.deepEqual(errors,[])`；保留；角色 / 数据钩子替代旧 DOM（G7） |
## cost-compact-ui-test.js

| 盘点原行号 # 次序 | 当前目标 | 当前检查定位 / 替代依据 |
|---|---|---|
| 24 #1 | `scripts/m1/cost-compact-ui-test.js:25` | `ns.filter(n=>n.textContent!=='—').length),10`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 26 #1 | `scripts/m1/cost-compact-ui-test.js:26` | `ten-Agent readout above plot`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 35 #1 | `scripts/m1/cost-migration-checks.js:43` | `detail sections stack`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 35 #2 | `scripts/m1/cost-migration-checks.js:50` | `keyboard scrolling`；Q5 使用 scrollable Sheet body 与有界列表；旧“只有列表滚动”形态退役 |
| 35 #3 | `scripts/m1/cost-migration-checks.js:43` | `assert.equal(geometry.metrics,6)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 35 #4 | `scripts/m1/cost-migration-checks.js:43` | `Math.abs(geometry.chartWidth-geometry.contentWidth)<64`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 35 #5 | `scripts/m1/cost-migration-checks.js:43` | `assert(geometry.points>=1)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 35 #6 | `scripts/m1/cost-migration-checks.js:44` | `size>=10.9`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 35 #7 | `scripts/m1/cost-migration-checks.js:44` | `assert(geometry.axisInside)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 35 #8 | `scripts/m1/cost-migration-checks.js:22` | `assert.equal(geometry.overflow,false)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 36 #1 | `scripts/m1/cost-compact-ui-test.js:32` | `count(),25`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 36 #2 | `scripts/m1/cost-migration-checks.js:51` | `scrollTop>0`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 37 #1 | `scripts/m1/cost-compact-ui-test.js:34` | `data-cost-detail-fields] li:not(:has(.ff-ref-is-hatch))`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 37 #2 | `scripts/m1/cost-compact-ui-test.js:35` | `data-cost-detail-pricing] dd`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 37 #3 | `scripts/m1/cost-compact-ui-test.js:36` | `在用量页查看`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 37 #4 | `scripts/m1/cost-compact-ui-test.js:37` | `count(),10`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 37 #5 | `scripts/m1/cost-compact-ui-test.js:38` | `getAttribute('title'),longModel`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 38 #1 | `scripts/m1/cost-compact-ui-test.js:41` | `textContent()).includes(label)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 41 #1 | `scripts/m1/cost-migration-checks.js:43` | `detail sections stack`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 41 #2 | `scripts/m1/cost-migration-checks.js:22` | `assert.equal(geometry.overflow,false)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 41 #3 | `scripts/m1/cost-migration-checks.js:43` | `assert(geometry.points>=1)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 41 #4 | `scripts/m1/cost-compact-ui-test.js:46` | `statistics.json')),facts`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 41 #5 | `scripts/m1/cost-compact-ui-test.js:46` | `assert.deepEqual(errors,[])`；保留；角色 / 数据钩子替代旧 DOM（G7） |
## cost-composition-ui-test.js

| 盘点原行号 # 次序 | 当前目标 | 当前检查定位 / 替代依据 |
|---|---|---|
| 12 #1 | `scripts/m1/cost-composition-ui-test.js:12` | `assert(pair,`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 19 #1 | `scripts/m1/cost-composition-ui-test.js:19` | `trace.every`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 37 #1 | `scripts/m1/cost-composition-ui-test.js:37` | `data-cost-range-sheet]').count(),0`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 38 #1 | `scripts/m1/cost-composition-ui-test.js:39` | `getComputedStyle(e).opacity),'1'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 39 #1 | `scripts/m1/cost-composition-ui-test.js:41` | `for(const label of ['累计'`；Sheet 打开后四个真实快捷 tab 可见；Q2 原侧栏变为 Sheet |
| 40 #1 | `scripts/m1/cost-composition-ui-test.js:41` | `for(const label of ['累计'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 41 #1 | `scripts/m1/cost-composition-ui-test.js:42` | `!document.querySelector('[data-cost-range-sheet]')`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 42 #1 | `scripts/m1/cost-composition-ui-test.js:43` | `await c.openRange(page);await page.keyboard.press('Escape')`；旧按钮再次点击关闭改为 kit 模态关闭/ESC（Q2），保留再次开关 |
| 45 #1 | `scripts/m1/cost-composition-ui-test.js:45` | `width>=160`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 47 #1 | `scripts/m1/cost-composition-ui-test.js:47` | `assert(legend.rows>=6)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 47 #2 | `scripts/m1/cost-composition-ui-test.js:47` | `assert.equal(legend.clipped,0)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 48 #1 | `scripts/m1/cost-composition-ui-test.js:48` | `await c.tab(page,'圆环形状','半环')`；状态加半环实际 frame 比例断言，G7 SVG data-shape 在 gallery 同时保留 |
| 49 #1 | `scripts/m1/cost-composition-ui-test.js:49` | `r.width/r.height>1.7`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 50 #1 | `scripts/m1/cost-composition-ui-test.js:50` | `comp.locator('[data-arc-key]').evaluateAll`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 52 #1 | `scripts/m1/cost-composition-ui-test.js:54` | `new Set(grouped).size>1`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 53 #1 | `scripts/m1/cost-composition-ui-test.js:55` | `new Set(stacked).size,1`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 55 #1 | `scripts/m1/cost-composition-ui-test.js:56` | `new RegExp(Number(month.slice(5))+' 月')`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 55 #2 | `scripts/m1/cost-composition-ui-test.js:57` | `bars.locator('[data-month-key]').evaluateAll`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 56 #1 | `scripts/m1/cost-composition-ui-test.js:59` | `data-pane=months`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 57 #1 | `scripts/m1/cost-composition-ui-test.js:62` | `data-pane=where`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 59 #1 | `scripts/m1/cost-composition-ui-test.js:67` | `[...window.costHost.state().agents]`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 60 #1 | `scripts/m1/cost-composition-ui-test.js:68` | `path[fill="currentColor"]`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 61 #1 | `scripts/m1/cost-composition-ui-test.js:69` | `name:'每周'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 61 #2 | `scripts/m1/cost-composition-ui-test.js:70` | `name:'每月'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 61 #3 | `scripts/m1/cost-migration-checks.js:31` | `plot.locator('svg > text').count()<=6`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 61 #4 | `scripts/m1/cost-composition-ui-test.js:73` | `textContent(),pinned`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 61 #5 | `scripts/m1/cost-composition-ui-test.js:74` | `data-line-cursor]').count(),0`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 62 #1 | `scripts/m1/cost-composition-ui-test.js:76` | `selected&&selected.from<selected.to`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 63 #1 | `scripts/m1/cost-composition-ui-test.js:78` | `custom.from!==window.costHost.state().custom.to`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 67 #1 | `scripts/m1/cost-composition-ui-test.js:80` | `carousel.getAttribute('data-index'),'0'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 67 #2 | `scripts/m1/cost-composition-ui-test.js:81` | `name:'累计',exact:true}).getAttribute`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 68 #1 | `scripts/m1/cost-composition-ui-test.js:82` | `carousel.getAttribute('data-index'),'1'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 69 #1 | `scripts/m1/cost-composition-ui-test.js:83` | `data-carousel-slide=range]').evaluate(e=>e.inert)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 70 #1 | `scripts/m1/cost-composition-ui-test.js:85` | `days.filter(d=>d.state==='unobserved'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 71 #1 | `scripts/m1/cost-composition-ui-test.js:86` | `data-cost-month-sub`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 72 #1 | `scripts/m1/cost-composition-ui-test.js:87` | `page.keyboard.press('ArrowLeft')`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 73 #1 | `scripts/m1/cost-composition-ui-test.js:88` | `vp.x+vp.width*.25`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 74 #1 | `scripts/m1/cost-composition-ui-test.js:89` | `name:'上一页',exact:true}).click()`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 75 #1 | `scripts/m1/cost-composition-ui-test.js:89` | `window.costHost.state().period),'30'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 77 #1 | `scripts/m1/cost-composition-ui-test.js:92` | `document.documentElement.scrollWidth<=innerWidth`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 79 #1 | `scripts/m1/cost-composition-ui-test.js:95` | `playState==='running').length),0`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 79 #2 | `scripts/m1/cost-composition-ui-test.js:96` | `every(a=>a.playState!=='running')`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 82 #1 | `scripts/m1/cost-reference-cases.js:25` | `data-m8-case=per-agent-gap] [data-line-run]`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 83 #1 | `scripts/m1/cost-composition-ui-test.js:97` | `statistics.json')),facts`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 83 #2 | `scripts/m1/cost-composition-ui-test.js:97` | `assert.equal(audit.enabled,false)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 83 #3 | `scripts/m1/cost-composition-ui-test.js:97` | `audit.audit.authenticationReads,0`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 83 #4 | `scripts/m1/cost-composition-ui-test.js:97` | `audit.audit.sourceWrites,0`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 83 #5 | `scripts/m1/cost-composition-ui-test.js:97` | `audit.audit.networkAttempts,0`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 83 #6 | `scripts/m1/cost-composition-ui-test.js:97` | `assert.deepEqual(errors,[])`；保留；角色 / 数据钩子替代旧 DOM（G7） |
## cost-rebuild-ui-test.js

| 盘点原行号 # 次序 | 当前目标 | 当前检查定位 / 替代依据 |
|---|---|---|
| 29 #1 | `scripts/m1/cost-rebuild-ui-test.js:26` | `textContent(),'$30.00'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 29 #2 | `scripts/m1/cost-rebuild-ui-test.js:27` | `heading',{name:model`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 34 #1 | `scripts/m1/cost-migration-checks.js:22` | `assert.equal(geometry.overflow,false)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 34 #2 | `scripts/m1/cost-migration-checks.js:78` | `numeric cells do not overlap`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 34 #3 | `scripts/m1/cost-migration-checks.js:78` | `numeric text stays in its cell`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 40 #1 | `scripts/m1/cost-migration-checks.js:26` | `four rows plus top line`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 41 #1 | `scripts/m1/cost-migration-checks.js:27` | `height>=240`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 41 #2 | `scripts/m1/cost-migration-checks.js:28` | `width-e.parentElement.getBoundingClientRect().width`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 42 #1 | `scripts/m1/cost-migration-checks.js:31` | `plot.locator('svg > text').count()<=6`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 42 #2 | `scripts/m1/cost-migration-checks.js:31` | `.cost-chart-panel`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 43 #1 | `scripts/m1/cost-rebuild-ui-test.js:41` | `count(),18`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 43 #2 | `scripts/m1/cost-rebuild-ui-test.js:43` | `count(),14`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 43 #3 | `scripts/m1/cost-rebuild-ui-test.js:44` | `count(),12`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 45 #1 | `scripts/m1/cost-reference-cases.js:9` | `kit detail height`；Q1/G7 替换旧固定 446×218 为 kit 自适应宽、detail 高176 |
| 45 #2 | `scripts/m1/cost-reference-cases.js:10` | `g.text-micro line').count(),5`；UNIFY §3 四行加顶线，替换旧参考小图4线 |
| 45 #3 | `scripts/m1/ui-m8-gallery-ui-test.js:58` | `--cost-chart-grid`；Q1/F/CHART-GAP 使用现有原色 token；palette 原色另见成本前后图，不写死 RGB |
| 45 #4 | `scripts/m1/cost-reference-cases.js:11` | `textContent(),'$31.84'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 46 #1 | `scripts/m1/cost-reference-cases.js:12` | `/\$31\.84/`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 46 #2 | `scripts/m1/cost-reference-cases.js:14` | `/2026-10-13/`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 46 #3 | `scripts/m1/cost-reference-cases.js:15` | `getByRole('tooltip').count(),0`；原inspect/toggle节点退役，Q1 inline图；读数先显后隐藏，保留焦点 |
| 46 #4 | `scripts/m1/cost-reference-cases.js:16` | `Escape retains keyboard focus`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 47 #1 | `scripts/m1/cost-reference-cases.js:19` | `unknown dates split the curve`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 47 #2 | `scripts/m1/cost-reference-cases.js:20` | `textContent(),'$0'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 47 #3 | `scripts/m1/cost-reference-cases.js:21` | `textContent(),'未报告'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 47 #4 | `scripts/m1/cost-reference-cases.js:22` | `s.includes('e-')`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 47 #5 | `scripts/m1/cost-reference-cases.js:23` | `data-m8-case=empty] [data-detail-end]`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 47 #6 | `scripts/m1/cost-reference-cases.js:24` | `当前范围没有已计入估算的用量。`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 48 #1 | `scripts/m1/cost-rebuild-ui-test.js:46` | `assert(await c.detail(page).isVisible())`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 48 #2 | `scripts/m1/cost-rebuild-ui-test.js:48` | `statistics.json')),facts`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 50 #1 | `scripts/m1/cost-rebuild-ui-test.js:48` | `assert.deepEqual(errors,[])`；保留；角色 / 数据钩子替代旧 DOM（G7） |
## budget-overview-ui-test.js

| 盘点原行号 # 次序 | 当前目标 | 当前检查定位 / 替代依据 |
|---|---|---|
| 37 #1 | `scripts/m1/budget-overview-ui-test.js:38` | `assert.equal(new URL(page.url()).protocol,'file:')`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 37 #2 | `scripts/m1/budget-overview-ui-test.js:38` | `assert((await page.title()).startsWith('Agent Usage'))`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 38 #1 | `scripts/m1/budget-overview-ui-test.js:39` | `assert.equal(await page.locator('#main').getAttribute('data-current-view'),'cost')`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 40 #1 | `scripts/m1/budget-overview-ui-test.js:41` | `assert.equal(await page.locator('[data-cost-budget]').count(),edge?5:3,'the global budget list must include unselected saved sc…`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 44 #1 | `scripts/m1/budget-overview-ui-test.js:45` | `assert.equal(json.budget.state,'observed-below')`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 44 #2 | `scripts/m1/budget-overview-ui-test.js:45` | `assert.equal(json.issues.filter(i=>i.target==='workbench').length,0)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 45 #1 | `scripts/m1/budget-overview-ui-test.js:46` | `assert.match(await page.locator('[data-cost-budget-state]').textContent(),/低于预算/)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 45 #2 | `scripts/m1/budget-overview-ui-test.js:46` | `assert.equal(await page.locator('[data-cost-notice="budget"]').isVisible(),false,'selected-budget hint stays scoped')`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 47 #1 | `scripts/m1/budget-overview-ui-test.js:48` | `assert.equal(await page.locator('[data-attention-item="budget"]').count(),2)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 48 #1 | `scripts/m1/budget-overview-ui-test.js:49` | `assert.deepEqual(await page.locator('[data-attention-item="budget"]').evaluateAll(rows=>rows.map(row=>row.dataset.key).sort()),…`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 52 #1 | `scripts/m1/budget-overview-ui-test.js:53` | `assert.equal(acknowledged[projectIssue.id],projectIssue.fingerprint)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 52 #2 | `scripts/m1/budget-overview-ui-test.js:53` | `assert.equal(acknowledged[allIssue.id],undefined)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 57 #1 | `scripts/m1/budget-overview-ui-test.js:58` | `window.insightsHost.get().project),projectB`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 57 #2 | `scripts/m1/budget-overview-ui-test.js:58` | `assert.equal(await page.locator('[data-cost-budget]').count(),3,'the global list does not shrink with the editor selection')`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 60 #1 | `scripts/m1/budget-overview-ui-test.js:61` | `assert.equal(JSON.parse(fs.readFileSync(path.join(usage,'workbench.json'))).acknowledged[allIssue.id],allIssue.fingerprint)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 77 #1 | `scripts/m1/budget-overview-ui-test.js:78` | `assert.equal(await page.locator('[data-attention-item="budget"]').count(),0)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 80 #1 | `scripts/m1/budget-overview-ui-test.js:81` | `assert.equal(labels.filter(label=>label.includes('同名')).length,2)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 80 #2 | `scripts/m1/budget-overview-ui-test.js:81` | `assert(labels.some(label=>label.includes('项目 1'))&&labels.some(label=>label.includes('项目 2')))`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 81 #1 | `scripts/m1/budget-overview-ui-test.js:82` | `assert.equal(await page.locator('[data-cost-budgets] [data-budget-state="unpriced"]').count(),1)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 81 #2 | `scripts/m1/budget-overview-ui-test.js:82` | `data-budget-state="no-data"`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 81 #3 | `scripts/m1/budget-overview-ui-test.js:82` | `data-budget-state="scope-missing"`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 87 #1 | `scripts/m1/budget-overview-ui-test.js:88` | `window.insightsHost.get().project),'all'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 91 #1 | `scripts/m1/budget-overview-ui-test.js:92` | `assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 93 #1 | `scripts/m1/budget-overview-ui-test.js:94` | `assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),ledger)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 93 #2 | `scripts/m1/budget-overview-ui-test.js:94` | `assert.deepEqual(errors,[])`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 94 #1 | `scripts/m1/budget-overview-ui-test.js:95` | `assert(!text.includes('synthetic-private'))`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 94 #2 | `scripts/m1/budget-overview-ui-test.js:95` | `assert(!text.includes('RAW_PRIVATE'))`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
## renderer-lifecycle-ui-test.js

| 盘点原行号 # 次序 | 当前目标 | 当前检查定位 / 替代依据 |
|---|---|---|
| 24 #1 | `scripts/m1/renderer-lifecycle-ui-test.js:24` | `assert(await hero.locator('[data-carousel-slide=month]').evaluate(e=>!e.inert))`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 75 #1 | `scripts/m1/renderer-lifecycle-ui-test.js:59` | `assert.deepEqual(checks.failures, [])`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 76 #1 | `scripts/m1/renderer-lifecycle-ui-test.js:60` | `assert.deepEqual(errors, [])`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 76 #2 | `scripts/m1/renderer-lifecycle-ui-test.js:60` | `assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), before)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 77 #1 | `scripts/m1/renderer-lifecycle-ui-test.js:61` | `assert.match(await page.title(), /Agent Usage/)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 77 #2 | `scripts/m1/renderer-lifecycle-ui-test.js:61` | `assert.match(page.url(), /desktop-reference.*index\.html/)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
## render-performance-ui-test.js

| 盘点原行号 # 次序 | 当前目标 | 当前检查定位 / 替代依据 |
|---|---|---|
| 61 #1 | `scripts/m1/render-performance-ui-test.js:65` | `settled glyphs rest on whole digits`；盘点基线后 main 的 quota-shell 已替换旧 plain/transform 断言；保持 main 的 Figure字形终态，额度页不改 |
| 74 #1 | `scripts/m1/render-performance-ui-test.js:79` | `rolling.expectedStart`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 85 #1 | `scripts/m1/render-performance-ui-test.js:90` | `priced zero is not an unpriced Agent`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 87 #1 | `scripts/m1/render-performance-ui-test.js:92` | `afterPrice.sequence, free.sequence`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 87 #2 | `scripts/m1/render-performance-ui-test.js:92` | `afterPrice.revision > free.revision`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 91 #1 | `scripts/m1/render-performance-ui-test.js:96` | `assert.deepEqual(errors, [])`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 91 #2 | `scripts/m1/render-performance-ui-test.js:96` | `assert(report.ledgerUnchanged)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 92 #1 | `scripts/m1/render-performance-ui-test.js:97` | `burst.cards <= 1`；旧credit-chart在 main quota-shell 已退役，非M8删除；保留当前main的cards/React overview重建计数 |
| 93 #1 | `scripts/m1/render-performance-ui-test.js:97` | `burst.cards <= 1`；同上，当前main无credit renderer，原通知门槛与帧预算保留 |
| 94 #1 | `scripts/m1/render-performance-ui-test.js:65` | `settled glyphs rest on whole digits`；main已改为kit Figure；保持main字形完整行和静止终态，不回退额度页 |
| 95 #1 | `scripts/m1/render-performance-ui-test.js:98` | `readout.length >= 3`；最高裁决E/UNIFY §3：从金额插值改为fast淡入上移4px，采样至少3个中间透明度/transform |
| 96 #1 | `scripts/m1/render-performance-ui-test.js:99` | `p95Ms <= idle * 2 + 1`；保留；角色 / 数据钩子替代旧 DOM（G7） |
## workbench-ui-test.js

| 盘点原行号 # 次序 | 当前目标 | 当前检查定位 / 替代依据 |
|---|---|---|
| 33 #1 | `scripts/m1/workbench-ui-test.js:34` | `assert.equal(await page.locator('[data-view="workbench"]').count(),0)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 33 #2 | `scripts/m1/workbench-ui-test.js:34` | `page.locator('#workbench').count(),0`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 33 #3 | `scripts/m1/workbench-ui-test.js:34` | `assert.equal(await page.locator('[data-cost-projects]').isVisible(),true)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 33 #4 | `scripts/m1/workbench-ui-test.js:34` | `assert.equal(await page.locator('[data-cost-analysis]').isVisible(),false)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 33 #5 | `scripts/m1/workbench-ui-test.js:34` | `page.locator('#usage').isVisible(),false`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 34 #1 | `scripts/m1/workbench-ui-test.js:35` | `assert.equal(await page.locator('[data-cap-agent]').count(),11)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 34 #2 | `scripts/m1/workbench-ui-test.js:35` | `assert((await page.locator('#sourcesAttentionSection').innerText()).includes('来源暂不可读'))`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 34 #3 | `scripts/m1/workbench-ui-test.js:35` | `window.insightsHost.notices('cost').text`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 36 #1 | `scripts/m1/workbench-ui-test.js:37` | `assert.equal(JSON.parse(fs.readFileSync(settingsFile)).budgets['all:monthly'],.001)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 36 #2 | `scripts/m1/workbench-ui-test.js:37` | `assert((await page.locator('[data-cost-budget-state]').textContent()).includes('$0.001'),'a sub-cent budget keeps its exact use…`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 38 #1 | `scripts/m1/workbench-ui-test.js:39` | `dispatchEvent('compositionstart')`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 45 #1 | `scripts/m1/workbench-ui-test.js:46` | `assert.deepEqual(fs.readFileSync(preserved),settingsBytes)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 45 #2 | `scripts/m1/workbench-ui-test.js:46` | `assert.equal(JSON.parse(fs.readFileSync(preserved)).budgets['all:daily'],.0001)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 45 #3 | `scripts/m1/workbench-ui-test.js:46` | `cost.budgetField(page).inputValue(),'5'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 48 #1 | `scripts/m1/workbench-ui-test.js:49` | `assert.equal(await page.locator('[data-cost-project-totals] > div:first-child strong').textContent(),'<$0.01')`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 51 #1 | `scripts/m1/workbench-ui-test.js:52` | `assert.match(await page.locator('[data-cost-notice="cost"]').innerText(),/费用核对事项/)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 51 #2 | `scripts/m1/workbench-ui-test.js:52` | `assert.deepEqual(fs.readFileSync(statistics),before)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 52 #1 | `scripts/m1/workbench-ui-test.js:53` | `cost.budgetField(page).inputValue(),'123'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 53 #1 | `scripts/m1/workbench-ui-test.js:53` | `cost.budgetField(page).inputValue(),'123'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 53 #2 | `scripts/m1/workbench-ui-test.js:54` | `assert(fs.existsSync(csv))`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 53 #3 | `scripts/m1/workbench-ui-test.js:54` | `assert(text.includes('alpha'))`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 53 #4 | `scripts/m1/workbench-ui-test.js:54` | `assert(!text.includes('synthetic-private'))`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 53 #5 | `scripts/m1/workbench-ui-test.js:54` | `assert(!text.includes('PRIVATE_RAW'))`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 53 #6 | `scripts/m1/workbench-ui-test.js:54` | `assert(!text.includes(customRoot))`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 58 #1 | `scripts/m1/workbench-ui-test.js:59` | `assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 59 #1 | `scripts/m1/workbench-ui-test.js:60` | `assert.deepEqual(errors,[])`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 59 #2 | `scripts/m1/workbench-ui-test.js:60` | `assert.equal(persisted.budget.limitUsd,5)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 59 #3 | `scripts/m1/workbench-ui-test.js:60` | `assert(Math.abs(persisted.total.lower-.00084)<1e-12)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 60 #1 | `scripts/m1/workbench-ui-test.js:61` | `page.locator('[data-cost-analysis]').isVisible(),true`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 60 #2 | `scripts/m1/workbench-ui-test.js:34` | `assert.equal(await page.locator('[data-view="workbench"]').count(),0)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 61 #1 | `scripts/m1/workbench-ui-test.js:60` | `assert.deepEqual(errors,[])`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
## interaction-reliability-ui-test.js

| 盘点原行号 # 次序 | 当前目标 | 当前检查定位 / 替代依据 |
|---|---|---|
| 134 #1 | `scripts/m1/cost-ui-test.js:85` | `Number(groupEntry)+buttonEntries,1`；G7：Tab入口由模板tablist或按钮持有；实际 Home/ESC 行为保留 |
| 136 #1 | `scripts/m1/cost-ui-test.js:83` | `费用日期快捷范围`；实际 Home 后累计 aria-selected=true，见同一块 |
| 137 #1 | `scripts/m1/cost-ui-test.js:87` | `month),null,'keyboard range replaces month'`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 138 #1 | `scripts/m1/cost-ui-test.js:89` | `data-cost-range-sheet]').count(),0`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 260 #1 | `scripts/m1/cost-migration-checks.js:22` | `assert.equal(geometry.overflow,false)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 277 #1 | `scripts/m1/cost-migration-checks.js:21` | `original narrow-content stacking`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 278 #1 | `scripts/m1/cost-ui-test.js:46` | `/^未计入没有价格$/`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 279 #1 | `scripts/m1/cost-ui-test.js:131` | `assert.deepEqual(errors,[])`；保留；角色 / 数据钩子替代旧 DOM（G7） |
## unpriced-guidance-ui-test.js

| 盘点原行号 # 次序 | 当前目标 | 当前检查定位 / 替代依据 |
|---|---|---|
| 27 #1 | `scripts/m1/unpriced-guidance-ui-test.js:27` | `assert.equal(await sheet.count(),1,'the cost page opens the same model sheet')`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 28 #1 | `scripts/m1/unpriced-guidance-ui-test.js:28` | `assert((await writeHelp.innerText()).includes('只有确认不收费时'))`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 28 #2 | `scripts/m1/unpriced-guidance-ui-test.js:28` | `assert.equal(await write.count(),1,'the model stays listed')`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 29 #1 | `scripts/m1/unpriced-guidance-ui-test.js:29` | `assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),facts)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 29 #2 | `scripts/m1/unpriced-guidance-ui-test.js:29` | `assert.equal(new Store(usage,{}).records().find(r=>r.id==='b'.repeat(64)).cacheWrite,null)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 29 #3 | `scripts/m1/unpriced-guidance-ui-test.js:29` | `assert.equal(await read.isVisible(),true)`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 29 #4 | `scripts/m1/unpriced-guidance-ui-test.js:29` | `assert.match(await read.textContent(),/未计入/,'the other read gap remains')`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 30 #1 | `scripts/m1/unpriced-guidance-ui-test.js:30` | `assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth))`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
| 31 #1 | `scripts/m1/unpriced-guidance-ui-test.js:31` | `assert.deepEqual(errors,[])`；保留原断言的数值/语义，更新费用定位；未变的跨页段保留原文件 |
## style-alignment-ui-test.js

| 盘点原行号 # 次序 | 当前目标 | 当前检查定位 / 替代依据 |
|---|---|---|
| 21 #1 | `scripts/m1/ui-foundation-ui-test.js:9` | `cleanRoomDiff`；退役与未迁移 usage 相等；UNIFY §1 采用 kit，foundation/gallery 清洁房间和规范token检查替代 |
| 22 #1 | `scripts/m1/ui-page-smoke-template.js:9` | `isolationViolations`；同上，标题由kit/规范角色负责；不改旧用量样式使两页相等 |
| 22 #2 | `scripts/m1/ui-page-smoke-template.js:9` | `isolationViolations`；同上，Card由kit负责；规范圆角和隔离替代旧边框相等 |
| 24 #1 | `scripts/m1/cost-smoke-ui-test.js:40` | `budget submit retains original primary text-token fill`；保留前景token填色，读取模板背景层而非透明根按钮 |
| 24 #2 | `scripts/m1/workbench-ui-test.js:40` | `pickPeriod`；Select Escape 焦点返回另由 foundation/gallery原生模板检查 |
| 29 #1 | `scripts/m1/cost-migration-checks.js:22` | `assert.equal(geometry.overflow,false)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 29 #2 | `scripts/m1/cost-migration-checks.js:22` | `assert.equal(geometry.overflow,false)`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 30 #1 | `scripts/m1/cost-ui-test.js:34` | `statistics.json'))).digest('hex'),seedHash`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 31 #1 | `scripts/m1/cost-ui-test.js:131` | `assert.deepEqual(errors,[])`；保留；角色 / 数据钩子替代旧 DOM（G7） |
## visual-ui-test.js

| 盘点原行号 # 次序 | 当前目标 | 当前检查定位 / 替代依据 |
|---|---|---|
| 69 #1 | `scripts/m1/cost-ui-test.js:41` | `[data-open-cost]`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 74 #1 | `scripts/m1/cost-smoke-ui-test.js:17` | `page.locator('#costDialog').count(),0`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 90 #1 | `scripts/m1/cost-ui-test.js:131` | `assert.deepEqual(errors,[])`；保留；角色 / 数据钩子替代旧 DOM（G7） |
## polish-ui-test.js

| 盘点原行号 # 次序 | 当前目标 | 当前检查定位 / 替代依据 |
|---|---|---|
| 83 #1 | `scripts/m1/cost-smoke-ui-test.js:32` | `heading stays in content clear of navigation`；UI-LAYOUT-SPEC新外框：标题在内容内且与左导航间距>8；替代旧顶栏上下关系 |
| 84 #1 | `scripts/m1/cost-smoke-ui-test.js:18` | `window.uiDetail.activeCount),0`；保留；角色 / 数据钩子替代旧 DOM（G7） |
| 84 #2 | `scripts/m1/cost-ui-test.js:131` | `assert.deepEqual(errors,[])`；保留；角色 / 数据钩子替代旧 DOM（G7） |
## functional-ui-test.js

| 盘点原行号 # 次序 | 当前目标 | 当前检查定位 / 替代依据 |
|---|---|---|
| 67 #1 | `scripts/m1/functional-ui-test.js:67` | `assert.equal((await autoRow.textContent()).includes('未计入'),!autoMapped,'an unmapped route is marked as left out; the second sca…`；原断言保留，整套本步未执行；费用入口/键盘/无错误/数据语义见已执行 cost / smoke / unpriced / workbench |
| 70 #1 | `scripts/m1/functional-ui-test.js:70` | `assert.match(await mapping.textContent(),/openai\/gpt-6\.1-sol/)`；原断言保留，整套本步未执行；费用入口/键盘/无错误/数据语义见已执行 cost / smoke / unpriced / workbench |
| 72 #1 | `scripts/m1/functional-ui-test.js:72` | `assert(state.snapshot.daily.every(r=>r.pricedTokens===r.totalTokens),JSON.stringify(state.snapshot.daily.filter(r=>r.pricedToke…`；原断言保留，整套本步未执行；费用入口/键盘/无错误/数据语义见已执行 cost / smoke / unpriced / workbench |
| 92 #1 | `scripts/m1/functional-ui-test.js:92` | `assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)`；原断言保留，整套本步未执行；费用入口/键盘/无错误/数据语义见已执行 cost / smoke / unpriced / workbench |
| 93 #1 | `scripts/m1/functional-ui-test.js:93` | `assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)`；原断言保留，整套本步未执行；费用入口/键盘/无错误/数据语义见已执行 cost / smoke / unpriced / workbench |
| 94 #1 | `scripts/m1/functional-ui-test.js:94` | `assert.deepEqual(errors,[])`；原断言保留，整套本步未执行；费用入口/键盘/无错误/数据语义见已执行 cost / smoke / unpriced / workbench |

## 新增回归

`cost-live-readout-ui-test.js`：在真实费用页合成重估中检查同一提示节点/key/焦点、revision变化而sequence不变、key消失后清理、ledger字节不变。`ui-m8-gallery-ui-test.js` 对StackBar/BarChart/spark分别检查打开期间更新，生命周期保留30轮卸载观察者检查。

摘要相关新增预览检查按最高裁决 §4 撤回，未进入本次组件注册或页面；不影响以上旧断言映射。

所有者批准 TREND-PARITY-GAP §2 后，`chart-geometry.test.js` 补整桶未知 / Agent 自身缺值 / 观测零 / 输入不可变的回归；`ui-m8-gallery-ui-test.js` 在两色实际 SVG 上检查费用面积和独立折线的 runs / 桥、默认 palette 规则不变，以及 partial / cursor 的原色、透明度和虚线。它们补充原图形断言，不退役任何原数值或未知语义断言。
