# M5 会话迁移盘点 · 2026-10-25

## 状态与基线

计划§9.2的第二份静态盘点，仅文档，未实现M5。分支`ui/mig-m4-m8-inventory`从main `4f7743773f6fbf9db8b541604ebccb7d85880d2b`建立；行号固定该源码，实施前复核。产品文件默认在`design/desktop-reference/`，套件默认在`scripts/m1/`。按§0.1复读规范；M3示范和M3k已有API直接采用，未知视觉/接口留统一裁决。CodeGraph不可用，用定向源码与AST/ID/全局检索；无子代理、真实来源/账号/目录操作、执行恢复命令、产品修改或main/远程写入。

## 1. 功能清单

| 编号 | 行为、状态、控件与边界 | 来源 |
|---|---|---|
| F1 | 会话页标题与“只读取会话标识、工作目录和用量，不读取会话内容”说明；项目归属问题notice和“在来源管理中处理”。 | `index.html:115`；`insights-ui.js:115`–118 |
| F2 | Agent图标筛选，全部保留文字，其它只图标+title/aria；动态自定义Agent随source-catalog加入。今天/7天/30天/全部；成本/用量/最近三排序；选择状态/roving焦点/指示器。 | `index.html:115`；`sessions-ui.js:285`–289、332–345；`sessions.css:6`–10 |
| F3 | 搜索项目名、完整路径、完整会话ID、Agent名、全部模型，trim小写≤120；非空出现清空；点击和普通Escape清空并保持搜索焦点；IME不清。无匹配带“清空搜索条件”动作。 | `sessions-ui.js:142`–147、290–312、346–365、401–410 |
| F4 | full session list仅首次进入/可见且stale时读取；离页更新仅标stale，更新epoch取消旧结果、串行读取；失败且有旧数据保留列表并toast，无旧数据单独报错；snapshot-only明确不含会话。 | `sessions-ui.js:8`–12、39–47、292–294、569–574 |
| F5 | 无bridge合成演示，settingsHost.demo empty为空，demo-state-change重载；不能在snapshot-only伪造会话。 | `sessions-ui.js:21`–41、570 |
| F6 | 用量首屏/日详情请求sessionSummary({date,model})，不加载full list；缓存最多8个(date,model)，读取中/失败返回null；返回后sessions-change，按Agent取对应count。 | `sessions-ui.js:62`–74；`preview.js:220`–257 |
| F7 | 会话按cwd忽略大小写分项目，未知项目末尾；同会话按所选日期范围聚合；按成本/用量/最近排序并稳定tie-break，search只保留匹配会话。 | `sessions-ui.js:50`–60、141–167 |
| F8 | 页summary：日期范围、Agent、会话/项目数、Token、价格；额外无会话ID记录另提示“只计入用量页”，不补假会话。 | `sessions-ui.js:295`–302 |
| F9 | 初次选范围/Agent自动展开第一项目；项目全头点击开合（独立动作不冒泡），全部展开/折叠；刷新不重建节点/重播进入动画，展开与焦点保持。 | `sessions-ui.js:296`、303–309、314–323、338–344、367–377、498–507 |
| F10 | 项目首5个会话，更多藏于二级drawer；“展开其余N个会话/收起”，闭合内容不可Tab；收起时项目头在视口上方则滚回，full平滑、reduced/off直达。 | `sessions-ui.js:10`、208–234、502–507 |
| F11 | 项目头项目名、会话数、活跃数、完整路径title、Agent/模型汇总、Token/成本、打开项目目录/复制完整路径；未知项目两动作禁用且解释。 | `sessions-ui.js:168`–178、208–229 |
| F12 | 会话行Agent、时间段、时长badge、首模型/+其它模型、缩短ID、Token/项目占比条、API等价估算、目录/恢复动作；整行打开详情，时间按钮为键盘入口，其它动作不触发详情。 | `sessions-ui.js:179`–207、446–517 |
| F13 | 时间展示依list.timezone/today，跨日带日期；时长秒/分/时/天先四舍五入再拆，23.6小时不显示0天24时；缺失/非法时长badge不出现。 | `sessions-ui.js:16`–17、81–117 |
| F14 | 同本地日且end距现在<1h显示活跃点/项目计数；原7px绿点带2.4s无限脉冲（减少动效取消）；是现有行为，不在盘点选替代色或动画。 | `sessions-ui.js:183`–188、213–214；`sessions.css:135`–148 |
| F15 | 原title读数：完整Agent/全部模型、时间开始结束与持续、完整ID/路径、输入/输出/缓存/推理分解、命中率、费率覆盖与缓存节省、项目比例；不新增hover卡。 | `sessions-ui.js:131`–137、184–204、220–226 |
| F16 | 详情sheet：Agent/活跃、项目/时间/持续、当前范围Token/成本/命中率、输入输出缓存读写、推理说明、模型/完整ID/目录及复制/打开；多日按天倒序。 | `sessions-ui.js:238`–280 |
| F17 | 未报告字段null，不拿0替代；部分天报告带“部分未报告”；缓存命中率只有两输入完整且分母非0才给数值；cost沿displayValues.cost保留范围/+与未定价。详情当前cache unknown用“—”，见Q4。 | `sessions-ui.js:76`–79、120–139、243–273 |
| F18 | 复制项目路径、会话ID、详情内路径/ID，bridge.copyText优先，clipboard fallback，失败toast；项目复制/行恢复有1600ms check反馈。 | `sessions-ui.js:379`–425、447–452、484–494、529–533 |
| F19 | 打开目录只传opaque session.key，不让renderer自行选/拼路径；重复操作禁用/阻止指针；目录不存在/未记录/其它失败分别提示；预览不调用系统资源管理器。 | `sessions-ui.js:428`–475、535–549 |
| F20 | 复制恢复命令只传session.key，使用桥接生成的PowerShell引用；绝不执行。resumable=false缺ID/cwd或不支持则禁用并解释；busy/failure恢复。 | `sessions-ui.js:182`、194–196、250、276–278、477–495、551–563 |
| F21 | 详情关闭按钮、backdrop/Escape、焦点进入/范围/返回；复制或目录动作不冒泡成关闭。所有筛选可键盘，IME guard；暗色/窄屏无重叠，详情统计窄容器折为一列。 | `sessions-ui.js:339`–343、358–365、520–566；`sessions.css:106`–121、190–193；旧测试 |
| F22 | usage今日会话和逐Agent入口进入会话并选对应Agent/today；drillDown清展开/drawer并重置first-open；搜索和其它本机视图选择仍按旧逻辑，不擅自重置。 | `sessions-ui.js:324`–331、573；`preview.js:952`–965、991 |

## 2. 数据、纯计算与语义

| 数据 | 当前来源/计算 | 迁移约束 |
|---|---|---|
| 完整列表 | usageBridge.sessions()→SessionListV1，含sequence/timezone/today/sessions/unattributed | 不用统计快照代替；不读正文，不新增读取；key与raw id/cwd分离；首次可见加载、旧结果拒收。 |
| 首屏计数 | sessionSummary({date,model})、返回count/agents；sessionsUi.count | null表示尚未得到，不显示0；已有result里某Agent无会话的0是已知计数；8条cache、epoch与sessions-change保留。 |
| 会话/项目聚合 | within / groups，sessions-ui:50–59、141–167 | 旧lower/upper/coverage/已报告事实及排序原样UMD；跨Agent既有组/页汇总的范围由Q4裁决，不新增合计。 |
| 详情构成 | breakdown/cacheRate/fieldText/tokenTip，120–137 | 未报告null与明确0不同，部分天的known sum带partial；命中率未知不估算，推理沿原output语义。 |
| 费用 | displayValues.cost(lower,upper,coverage) | 沿既有formatter，不在TS重算或舍掉上界/+；summary目前把同lower传两次，见Q4，盘点不修。 |
| 数字/日期/时长/ID | short、format/span、durationParts/Text/Badge、shortId/displayModel、agentSummary/groupModelsSummary | 只拆纯计算，不换格式化、timezone/舍入规则；原输入输出单测，React只调用。 |
| 原生目录与剪贴板 | openFolder(key)、copyResume(key)、copyText(text) | 本地显式动作；命令只复制；安全引用/路径拒绝测试保留，不把id/cwd加入其它导出接口。 |
| 目录/缺归属提示 | agentCatalog + source-catalog；insights-ui的notice | 自定义Agent同步；缺raw session记录只计入unattributed，不能拿调用ID伪造会话。 |

建议提取的纯逻辑范围已按函数列出，具体UMD文件/API由裁决确认。旧页面须先调用同模块证明输出一致，再供React，签名以preload和旧调用为准；duration、聚合、cacheRate不能放TS重新写。DOM字符串渲染与事件绑定退役；count/summary服务仍需在用量页首屏可用。

## 3. 双向耦合与处理要求

M3模式：`ui/src/pages/sessions/`区块/列表/详情拆分、旧侧`window.sessionsHost`提供数据和动作，React对外`window.sessionsUi`。只在盘点列约束，精确接口与共享范围待统一裁决。

| 编号 | 当前耦合 | 迁移处理 |
|---|---|---|
| C1 | preview.js:172/220–257→sessionsUi.count、sessions-change；sessions-ui:62–74/573 | 首屏小summary服务必须早于/独立于完整页加载；React挂载不能引起full list自动读；loaded/count/reload/drillDown兼容，迟到summary不覆盖新epoch。 |
| C2 | preview.js:952–965/991→drillDown+view；list load后publish | 入口、Agent/range与渲染/焦点顺序保留，用窄接口而非新DOM查询；settingsHost demo事件不另造state。 |
| C3 | motion.js:106枚举sessionAgents/Range/Sort；segmented/interactions/focus/morph/scroll-fade通用事件 | kit拥有新指示器/层/IME，不让旧脚本作用React根；共享其它页能力留M9；稳定key保留行身份、drawer和焦点。 |
| C4 | insights-ui.js:16/87/115–118/149→会话notice和项目“查看会话”入口；M4来源attention可跳sessions | 只通过会话Ui导航；缺归属说明维持，与M4注意事项共享事实，M8项目/预算仍留旧侧，不整删insights-ui。 |
| C5 | agentCatalog对象+source-catalog，settingsHost.demo+demo-state-change；bridge.onUpdate | 动态Agent更新受控筛选；epoch/stale/cleanup保留；离页不重复完整读取，不增timer。 |
| C6 | index.html:115页section与121外置sessionDetailDialog；sessions.css的inspector规则也被其它页面复用 | 保留section attrs，改island host；详情迁Sheet后仅退役本页专用selectors，agent管理/费用详情仍在用的inspector样式保留。 |
| C7 | legacy.css/serve.js/资源图、旧套件硬编码id与class | 真正退役才同步删除入口；附录检索同时覆盖生成group id、data-session/group/drawer/inspector等动态键，不用死DOM适配器满足旧测试。 |

检索普通sessions字段、来源目录文字、morph注释不是会话DOM依赖；附录原始候选保留，C表给出处理结论。

## 4. kit 映射及图形现状

| 功能 | 已有kit | 缺口/限制 |
|---|---|---|
| 页头、summary、项目/会话事实 | PageHeader、SectionHeader、Value、Figure、ListRow、DataTable(rowKey)、AgentMark、Badge | 不能把多列会话行擅自改成卡片；具体列/断点、主数字档位等见Q1。 |
| Agent/范围/排序、搜索 | Segmented、SearchField(maxLength120)、IconButton | Agent仅图标的原行为/固定宽度与Segmented带文本接口映射见Q1；IME普通Escape可用M3k，不重复问已有能力。 |
| 项目折叠/其余会话 | Disclosure、Button、ScrollArea | 原头部还含复制/目录独立动作，不能嵌button到Disclosure trigger；组合/槽位见Q2。 |
| 详情/复制/目录/恢复 | Sheet、DataTable/ListRow、IconButton/Button、CodeBlock、Banner | Sheet尺寸、固定footer、copy check反馈需按裁决；CodeBlock只读路径/ID可用，动作仍键盘可达。 |
| 占项目消耗条 | 当前44×4px，背景fill-strong、填充accent、width360ms，title百分比；源码sessions-ui:185/197、sessions.css:83–84 | 是消耗比例而非已计价覆盖，不能套M3k Meter.done；接口/规范映射由Claude定，见Q2。 |
| 活跃点 | 原7px，light #34c759/dark #30d158、2.4s无限pulse，减少动效取消 | 这是旧行为描述，不授权颜色或无限动效；规范冲突见Q3。 |

## 5. 外观差异（只来自已定规范）

默认控件36px、圆角8/12/16、六级文字/figure/数字tabular-nums、间距与分隔行；所有对话框Sheet slow/exit、Disclosure moderate、数据图形按裁决用data档。旧52px多列头、rows padding、ID/模型截断和窄屏隐藏列如何映射没有自行决定。保留完整title悬停、原动作可见/禁用与键盘入口；禁止页面hover/内联图宽/自定颜色。原null的“—/未报告”与Value统一的差异列Q4，不擅自修聚合或改文案。

## 6. 测试映射

(i)页面基础/两主题/错误/窄屏/焦点；(ii)原样UMD与既有纯计算单测；(iii)新的会话页回归/继续保留的跨页流程；(iv)只可在统一裁决后退役旧实现形态。附录逐条记录sessions套件assert；数字、隐私、unknown、精确引用、键盘、目录动作不退役。

`sessions-ui-test.js`中的等待流程也保留：usage首屏summary ready但full list未读→点Agent会话进入→分组展开/二级drawer动画→恢复命令clipboard→目录动作→all范围→详情unknown→全部展开/收起→query清除/无匹配→reduced立即终态。截图、字体ready、稳定节点检查与断言一起迁，不只抄assert。

| 补充测试 | 本页部分的目标 |
|---|---|
| interaction-reliability搜索循环/原生菜单composition、narrow/inspector容器 | (iii)组字Escape/229/compositionend不误清、不触发全局菜单；(i)窄屏无横溢；其它页面保留。 |
| style-alignment会话详情+窄屏循环 | (i)深浅sheet打开/关闭、页面/容器宽度；旧费用/来源断言仍在原套件。 |
| workbench:52、56 | (iii)跨sessions不丢费用草稿；缺归属notice和去来源入口；预算/费用仍M8。 |
| custom-sources:52–53 | (iii)自定义Agent可筛，SessionList包括该Agent但不泄露raw private-session；仍用原导入fixture。 |
| 旧usage/activity首屏与今日明细入口 | (iii)summary计数/延后列表与drillDown；与M7共用同一场景，不能用M5挂载时读完整列表让它通过。 |

(ii)新增测试保留within上下界/partial、groups空/过滤/稳定排序/unknown项目末尾、duration边界、breakdown与cacheRate零分母/部分报告、短ID/完整copy值。`tests/m1/sessions.test.js`、归属/安全引用后端测试原样保留。`sessions-ui-test.js:112`旧`.motion-indicator`形状定位拟(iv)，其“选中指示器与项目对齐”目的由kit已审组件/新页状态与几何检查接替；需Claude批准，不删除键盘与选中语义。

<!-- ASSERTIONS:M5 -->

### 6.1 最少套件：逐断言位置与目标

同一行多个调用分别编号；同一调用位于循环时保留全部fixture/参数，不把多个case缩成一次。表达式是静态源码抄录，不代表本轮执行成功。

#### scripts/m1/sessions-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 49 #1 | (iii) | `` assert.equal(await page.evaluate(()=>window.sessionsUi.loaded),false,'the usage page must not load the full session list') `` |
| 52 #1 | (iii) | `` assert.equal(await page.locator('#todayClients .client-sessions').filter({ hasText: '7 个会话' }).count(), 1, 'Claude Code: seven sessions today') `` |
| 53 #1 | (iii) | `` assert.equal(await page.locator('#todayClients .today-columns').count(), 1) `` |
| 54 #1 | (iii) | `` assert(await page.locator('#todayClients .today-model .model-hit').first().textContent() !== '') `` |
| 55 #1 | (iii) | `` assert.equal(await page.locator('#todayTotals .today-kpi').count(), 4, 'Today totals has 4 clean KPI columns') `` |
| 60 #1 | (iii) | `` assert.equal(await page.locator('#sessions').getAttribute('hidden'), null, 'view switched to sessions') `` |
| 61 #1 | (iii) | `` assert.equal(await page.locator('#sessionAgents [data-agent="claude"]').getAttribute('aria-pressed'), 'true', 'claude agent selected') `` |
| 64 #1 | (iii) | `` assert.deepEqual(await groups(), ['work-alpha', "it's $(calc) `x`; dir", '未知项目'], 'projects by cost, unknown last; the old session is outside today') `` |
| 65 #1 | (iii) | `` assert.match(await page.locator('#sessionSummary').textContent(), /9 个会话 · 3 个项目/) `` |
| 66 #1 | (iii) | `` assert(await page.locator('.session-bar-bg').count() > 0, 'session token proportion bar rendered') `` |
| 67 #1 | (iii) | `` assert(await page.locator('.session-active-dot').count() > 0, 'active dot rendered for recent session') `` |
| 68 #1 | (iii) | `` assert(await page.locator('.session-duration-tag').count() > 0, 'duration tag rendered') `` |
| 69 #1 | (iii) | `` assert(await page.locator('.session-active-tag').count() > 0, 'active project badge rendered') `` |
| 77 #1 | (iii) | `` assert.deepEqual(kept, { same: true, replay: false }, 'a refresh rebuilt the session list') `` |
| 80 #1 | (iii) | `` assert.equal(await top.locator('.session-group-toggle').getAttribute('aria-expanded'), 'true') `` |
| 81 #1 | (iii) | `` assert.equal(await top.locator('.session-fold > .session-fold-inner > .session-list > .session-row').count(), 5) `` |
| 82 #1 | (iii) | `` assert.equal(await more.textContent(), '展开其余 2 个会话') `` |
| 83 #1 | (iii) | `` assert.equal(await top.locator('.session-drawer').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'closed drawer rows are not focusable') `` |
| 90 #1 | (iii) | `` assert(heights.some(h => h > 1 && h < heights.at(-1) - 1), 'intermediate drawer heights: ' + heights.slice(0, 8).join(',')) `` |
| 91 #1 | (iii) | `` assert.equal(await more.getAttribute('aria-expanded'), 'true') `` |
| 91 #2 | (iii) | `` assert.equal(await more.textContent(), '收起') `` |
| 98 #1 | (iii) | `` assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), "Set-Location -LiteralPath 'C:\\fixtures\\it''s $(calc) `x`; dir'; codex resume " + CODEX_ID) `` |
| 99 #1 | (iii) | `` assert.equal(await page.locator('.session-group.is-unknown .session-resume.is-off').count(), 1, 'WorkBuddy cannot resume') `` |
| 100 #1 | (iii) | `` assert(await page.locator('[data-folder]').count() > 0, 'sessions with cwd have open-folder button') `` |
| 101 #1 | (iii) | `` assert.equal(await page.locator('.session-group.is-unknown .session-folder-btn.is-off').count(), 1, 'WorkBuddy has no recorded directory') `` |
| 105 #1 | (iii) | `` assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), ALPHA) `` |
| 112 #1 | (iv)拟退役旧定位；见Q6 | `` assert.deepEqual(await page.evaluate(() => ['sessionAgents', 'sessionRange', 'sessionSort'].map(id => { const group = document.getElementById(id), marker = group.querySelector(':scope > .motion-indicator')?.getBoundingClientRect(), pressed = group.querySelector(':scope > button[aria-pressed="true"]').getBoundingClientRect(); return Boolean(marker) && Math.abs(marker.left - pressed.left) < 1.5 && Math.abs(marker.top - pressed.top) < 1.5 && Math.abs(marker.width - pressed.width) < 1.5; })), [true, true, true]) `` |
| 116 #1 | (iii) | `` assert.match(await page.locator('#sessionSummary').textContent(), /10 个会话/) `` |
| 118 #1 | (iii) | `` assert.equal(await page.locator('#sessionDetailDialog[open]').count(), 0, 'inspector dialog starts closed') `` |
| 120 #1 | (iii) | `` assert.equal(await page.locator('#sessionDetailDialog[open]').count(), 1, 'inspector dialog opened after row click') `` |
| 121 #1 | (iii) | `` assert(await page.locator('#sessionDetailTitle').isVisible(), 'inspector title visible') `` |
| 122 #1 | (iii) | `` assert(await page.locator('.inspector-stats').isVisible(), 'stats rendered') `` |
| 123 #1 | (iii) | `` assert.equal(await page.locator('.inspector-parts li').count(), 4, 'four usage parts') `` |
| 125 #1 | (iii) | `` assert.equal(await page.locator('#sessionDetailDialog[open]').count(), 0, 'inspector dialog closed after close button clicked') `` |
| 131 #1 | (iii) | `` assert.equal(await page.locator('#sessionDetailDialog[open]').count(), 1, 'unknown-project session opens') `` |
| 132 #1 | (iii) | `` assert.equal(await page.locator('#sessionDetailTitle').textContent(), '未知项目') `` |
| 133 #1 | (iii) | `` assert.match(await page.locator('.inspector-parts li').nth(2).textContent(), /缓存读取.*未报告/, 'an unreported field is unknown, not zero') `` |
| 135 #1 | (iii) | `` assert.equal(await page.locator('#sessionDetailDialog[open]').count(), 0, 'Escape closes the inspector') `` |
| 145 #1 | (iii) | `` assert.equal(noOverlap, true, 'session time and model columns must not overlap') `` |
| 149 #1 | (iii) | `` assert.equal(await page.locator('.session-group.is-open').count(), 3, 'all 3 groups expanded') `` |
| 151 #1 | (iii) | `` assert.equal(await page.locator('.session-group.is-open').count(), 0, 'all groups collapsed') `` |
| 155 #1 | (iii) | `` assert.deepEqual(await groups(), ['work-alpha', "it's $(calc) `x`; dir", '未知项目']) `` |
| 158 #1 | (iii) | `` assert.deepEqual(await groups(), ["it's $(calc) `x`; dir", '未知项目']) `` |
| 159 #1 | (iii) | `` assert.equal(await page.locator('#sessionSearchClear').isVisible(), true, 'clear button visible when query present') `` |
| 161 #1 | (iii) | `` assert.equal(await page.locator('#sessionSearch').inputValue(), '') `` |
| 162 #1 | (iii) | `` assert.equal(await page.locator('#sessionSearchClear').isVisible(), false, 'clear button hidden when query empty') `` |
| 165 #1 | (iii) | `` assert.equal(await page.locator('#sessionSearch').inputValue(), '') `` |
| 167 #1 | (iii) | `` assert.match(await page.locator('#sessionGroups').textContent(), /没有匹配/) `` |
| 169 #1 | (iii) | `` assert.equal(await page.locator('#sessionSearch').inputValue(), '') `` |
| 171 #1 | (iii) | `` assert.deepEqual(await groups(), ["it's $(calc) `x`; dir"]) `` |
| 175 #1 | (iii) | `` assert.equal(instant.motion, 'reduced') `` |
| 175 #2 | (iii) | `` assert(Math.abs(instant.height - instant.full) < 1, 'reduced motion: no fold transition') `` |
| 178 #1 | (i) | `` assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no horizontal overflow') `` |
| 179 #1 | (i) | `` assert.deepEqual(errors, []) `` |

### 6.2 多页套件补充定位

这里只映射本页相关段及其跨页结果；循环/流程的其它页分支仍归其它页，不能据此整套退役。

#### scripts/m1/interaction-reliability-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 81 #1 | (iii) | `` assert.equal(await page.evaluate(() => document.getElementById('main').dataset.currentView), view, 'native menu accelerator obeys composition policy') `` |
| 83 #1 | (iii) | `` assert.equal(await page.locator(selector).inputValue(), 'reliability', selector + ' keeps composed text') `` |
| 84 #1 | (iii) | `` assert.equal(await keyTrace(page, selector, 'Escape', { keyCode: 229 }), true) `` |
| 86 #1 | (iii) | `` assert.equal(await keyTrace(page, selector, 'Escape', { keyCode: 229 }), true, 'legacy 229 without an active composition is protected') `` |
| 87 #1 | (iii) | `` assert.equal(await page.locator(selector).inputValue(), 'reliability') `` |
| 88 #1 | (iii) | `` assert.equal(await page.locator(selector).inputValue(), '', selector + ' ordinary Escape clears') `` |
| 260 #1 | (iii) | `` assert(geometry.width <= geometry.viewport + 2, view + ' page has no horizontal overflow: ' + JSON.stringify(geometry)) `` |

#### scripts/m1/style-alignment-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 29 #1 | (i) | `` assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),view+' has no horizontal overflow') `` |
| 31 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/workbench-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 52 #1 | (iii) | `` assert.equal(await page.locator('#wbLimit').inputValue(),'123') `` |
| 56 #1 | (iii) | `` assert((await page.locator('[data-attention-notice="sessions"]').innerText()).includes('缺少项目归属')) `` |
| 61 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/custom-sources-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 53 #1 | (iii) | `` assert(sessions.sessions.some(s=>s.agent===id)) `` |
| 53 #2 | (iii) | `` assert(!JSON.stringify(sessions).includes('private-session')) `` |

<!-- /ASSERTIONS:M5 -->

## 7. 待决问题

| 编号 | 统一裁决需要决定什么 | 原因 |
|---|---|---|
| Q1 视觉映射 | 多列项目/会话行、当前显示与窄屏隐藏模型/ID、Agent仅图标筛选、详情Sheet尺寸/统计数字档位/固定footer。 | 规范只定组件基础，M3没有此组合；不自选列宽、密度、尺寸或重构信息架构。 |
| Q2 kit/图形 | 带独立动作的Disclosure头、会话44×4消耗条及其title、临时copy check反馈，给出批准组合/API。 | 不嵌套button；Meter.done只有已计价覆盖获准，不能拿来表示多少用量。 |
| Q3 活跃视觉 | 旧绿点与2.4s无限脉冲、时长“⏱”字形如何符合既有token/Tabler/无无限动效规范。 | 只描述旧行为，不能新增绿色token、动画或自己选替代图标；活跃不等数据质量。 |
| Q4 语义冲突 | 详情命中率“—”、字段“未报告”、缺ID“—/未记录”的Value/说明映射；跨Agent既有组/页Token/费用合计是否原样允许；summary把lower同时作为upper是否保留。 | sessions-ui:138/159–160/259/269/297–301；按§0.4只记录，不修上界或改语义。另活跃判定end可在未来（183/213/244未设负差下界），不自行修时钟问题。 |
| Q5 共享接口范围 | count/loaded/drillDown等注册时机，summary服务先于React页面可用；preview/motion/insights/shell解除DOM耦合的允许范围，以及跨M4/M7/M8事件协议。 | C1–C7；首屏不能为便捷而加载full list，亦不能出现未挂载Ui时丢跳转。 |
| Q6 断言替代 | :112旧motion-indicator定位的拟退役与替代几何证据；其它DOM选择器改语义定位。 | 只改变实现形态，键盘/对齐/刷新不丢节点/动画不重播等行为必须有接替，不能静默放宽。 |

## 8. 验证与交付边界

仅源码、bridge/global/ID与逐assert静态盘点，未运行M5测试或实现；不把M3前置样式对比记为M5通过。未来1280×900深浅+before同态、loading/error/stale/empty/unknown/partial、两层fold/详情/title、off/reduced与窄屏截图；每页build/verify fail0/runtime/foundation/smoke及映射落实，包装留M9。

一页一文档一提交。五份盘点完成后停止；main同时具备M3示范和统一RULINGS后才可另起连续实现分支。

<!-- IDS:M5 -->

## 附录：ID 与反向引用静态检索

以下索引固定到main 4f77437。完整静态ID及脚本赋值ID如下；循环生成的data-*行/控制也必须按正文覆盖，不把这个索引误当全部功能。

```text
sessions sessionAgents sessionRange sessionSearch sessionSearchClear sessionSort sessionSummary
sessionToggleAll sessionGroups sessionDetailTitle sessionDetailClose sessionClearQuery sessionDetailDialog sessionDetailContent
```

| 文件与行号 | 命中ID（候选，需按正文耦合表区分DOM访问/普通字段/注释） |
|---|---|
| insights-ui.js:16 | sessions |
| insights-ui.js:32 | sessions |
| insights-ui.js:37 | sessions |
| insights-ui.js:87 | sessions |
| insights-ui.js:115 | sessions |
| insights-ui.js:149 | sessions |
| morph.js:2 | sessions |
| motion.js:106 | sessionAgents、sessionRange、sessionSort |
| preview.js:897 | sessions |
| preview.js:935 | sessions |
| preview.js:956 | sessions |
| preview.js:965 | sessions |
| serve.js:37 | sessions |
| sources-ui.js:41 | sessions |
| window-shell.js:4 | sessions |

原始索引与assert全文保存在未跟踪的 `artifacts/ui-mig/inventory-20261025/index.json`，不属于运行验收。

<!-- /IDS:M5 -->

署名：Codex
