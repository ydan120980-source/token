# M7 用量迁移盘点 · 2026-10-25

## 状态与基线

仅执行计划§9.2静态盘点，未实现或退役M7。分支`ui/mig-m4-m8-inventory`从本地main `4f7743773f6fbf9db8b541604ebccb7d85880d2b`建立；产品行号均固定该基线，阶段二开始前复核。已按§0.1复读规范和计划。下文默认renderer文件在`design/desktop-reference/`，UI测试在`scripts/m1/`。CodeGraph不可用，采用定向源码、AST逐assert和ID/全局反向引用；没有子代理。本轮不改产品、kit/vendor/theme/token/guard/后端/preload/IPC，不读真实来源或账户，不合main/远程写入。图表现状只供Claude裁决，不定义新图表API。

## 1. 功能清单

| 编号 | 现有功能、状态、控件及边界 | 出处 |
|---|---|---|
| F1 | 用量标题；全部/30天/7天/今天；刷新；导出打开M3共用导出sheet；hidden rangeTitle/scopeSummary仍被更新，不能遗漏程序接口。 | `index.html:49–76`；`preview.js:865–903、1044–1057` |
| F2 | 总Token、记录数、API等价费用下界/上界/partial、价格覆盖；上下界展开、完整aria-label、未知未定价；点击费用去费用页。数值格式/最终值与动画中间值分开。 | `preview.js:35–67、301–392`；`detail-interactions.js:31–44、70–110` |
| F3 | Agent/来源/模型三层范围：Agent选择重置不属于该Agent的模型，来源与模型联动；reset清空；scopeContext写当前范围；筛选不改历史或账户。 | `preview.js:264–294、914–919`；`agent-picker.js:6–40` |
| F4 | Agent图标+名字chips换行；全部第一、其余按已记录Token排序，无记录弱化；选中不改几何；动态目录更新保留焦点；roving方向/Home/End及IME保护。原隐藏select仍是筛选接口。 | `agent-picker.js:6–40` |
| F5 | 平均每天按有记录日期算；与前一等长窗口比较先检查覆盖起点；今天与昨天为截至当前时刻的含义提示；没有比较基础不算增长。 | `preview.js:301–337、810–814` |
| F6 | 固定近30天条带，独立于页面period；未观测日、观测为0、正值分开；最高/今天标识；hover/focus tooltip，点击定位日明细，键盘可操作。更新复用条节点，不因只换period重播。 | `preview.js:338–371`；`rhythm.css:58–86` |
| F7 | 今日日期、Token/估算/记录/会话四栏；无记录时区分采集中、失败、暂停、尚无记录、筛选空；不伪造0费用/会话；午夜换日刷新。 | `preview.js:297–300、373–392、1132–1149` |
| F8 | Token分类由disjointMix/categoryView统一算：输入不含缓存、输出不含推理、cache读写、推理；未知、部分下限、含输出、来源不记录分别title/文字，不把推理重复相加。 | `preview.js:14–19、132–170、259–261` |
| F9 | 今日Agent→模型树：入口名、会话数、记录数、总Token/份额、输出/缓存命中与费用；空记录说明；neutral树线；模型名完整title与别名。日详情用另一紧凑布局。 | `preview.js:172–215` |
| F10 | 会话计数按日/Agent异步填充，不加载完整会话列表；请求失效/页面变更不覆盖新状态；点会话去M5筛选定位，未知与不支持不补零。 | `preview.js:218–256` |
| F11 | 活跃日历：近365天/具体年，周一开始七行，首尾pad/未来日不交互；月份标签不挤；选中日、焦点和aria-pressed；范围切换重建保焦。 | `preview.js:393–455` |
| F12 | 四色盘orange/blue/green/mono，记住agentusage.heatColor.v1，主题变化应用对应palette；等级0–4按当前范围最大值.12/.33/.65阈值；未记录与已记录0分开。 | `preview.js:413–455、1019–1025` |
| F13 | 热力格hover/focus共享#heatTooltip，日期/星期/完整Token或未观测；aria-describedby、窗口内避让；pointer离开/blur/Escape关闭；方向键按日/周移动，Enter/Space选日。 | `preview.js:474–487`；`insights.js:155–183`；`detail-interactions.js:125–140` |
| F14 | 选日展开inline日明细，关闭回原日；总量、费用、分类、Agent/模型、会话；未观测日明确无观测；不是新增dialog。 | `preview.js:488–520` |
| F15 | 活跃统计：有用量日、当前/最长连续、最忙连续3小时；今日暂未记录不截断此前连续天。按现有insightsMath计算。 | `insights.js:8–22` |
| F16 | 周×24小时168格；高峰/所选roving入口；四方向跨周/小时循环；hover/focus tooltip；选择时段侧栏Agent前4+其它占比、Token/估算；筛选后热力日历高亮匹配日期。Escape退出时段。 | `insights.js:23–61、112–183` |
| F17 | 选日24小时柱：今天未来小时单独样式，尚未加载/无小时/已记录零不混同；最忙小时/总量/记录数；hover/focus完整值；Left/Right/Home/End移动；回周视图。 | `insights.js:62–111、155–183` |
| F18 | 趋势metric Token/费用；mode分项/总量/模型；费用隐藏分项并把当前分项切总量；display每日/移动平均/累计；grain自动/天/周/月。每项变化保留符合条件的状态。 | `preview.js:589–781、984–1018` |
| F19 | 趋势范围独立于page period：今天/7/30/跟随页面、from/to日历、重置/应用/跟随；校验必填、顺序、最多3660天；选区摘要和当前preset。 | `preview.js:980–1018`；`date-range.js:11–87` |
| F20 | 日历42格，周一起始，coverageStart到今天外禁用，首点单日第二点成区间，hover预览；前后月边界；方向键/PageUp/PageDown、开关焦点、IME。popup上下择位和窗口避让。 | `date-range.js:11–87` |
| F21 | 一天且hourlyReady用小时；今天只到当前小时；其它自动>366天用周，否则天；模型前5+其它；分项含输出总量（含推理）并单列cache，费用独立右轴。 | `preview.js:604–675` |
| F22 | 真实缺日期用虚连接但不伪造点；记录存在而值未知是硬缺口；周/月partial标注；累计/平均按原seriesByModel/AVERAGE_MIN，不补日历零。 | `chart-ui.js:4–57`；`preview.js:676–700` |
| F23 | tooltip外部渲染：日期/桶范围、最多6正值行、0/未知数量、partial和缺口说明、费用独立；pointer贴近命中点并避让图边。即使所有dataset无point也可读缺日期。 | `preview.js:524–570、722–768` |
| F24 | 点击单日/小时转日明细，点击周/月桶缩小范围并改day；canvas键盘Left/Right/Enter/Escape同功能；拖动>6px不误点击，pointercancel收尾。 | `preview.js:746–768、803–807` |
| F25 | legend显示/隐藏系列，可全隐藏；default费用overlay隐藏；偏好agentusage.trendHidden.v1最多64项；同样淡出/重标轴，右轴保持56px不横跳。 | `preview.js:24–26、784–802` |
| F26 | 同一chart/series复用，≤400points数据变更morph；仅范围/metric/Agent等view变更才重入；首可见reveal、卸载/隐藏/动效关闭即终态，不能重复动画/积累observer。 | `preview.js:572–586、701–721、839–844` |
| F27 | 趋势底部变动、峰值、主模型、每记录量；无对照基础或未知显示原文案；计算值不从图表动画中间值取。 | `preview.js:770–781` |
| F28 | 来源摘要启用/空闲/异常/数量与title；点击去来源页；导出使用当前page范围和三层筛选，或全部未筛选data；只导出允许的聚合。 | `preview.js:823–828、913、1044–1057` |
| F29 | 使用快照revision检测同sequence重估；小时缓存失效、统计通知合并/串行；坏结果保留上次有效数据；collection error与saved data状态分开。后台隐藏页也发布数据变化供费用/来源/侧栏。 | `preview.js:97–128、1028–1038、1092–1153` |
| F30 | 外框navBadge/navTitle、dataBadge/updated/historyStart/refresh；导航保存/恢复滚动、取消旧任务；不能把M9外框连同preview.js删除。 | `preview.js:827–903`；`detail-interactions.js:46–68、112–121` |
| F31 | usageData/usageCalendar/agentUsageTotals/usageModels及自定义事件是跨页读合同；M3导出Host、M8费用、M5/M4与定价、M9菜单仍依赖，保留名称/数据/时序。 | `preview.js:862–889、1044–1090、1092–1139` |
| F32 | 页面重新进入、快速筛选、同数据通知、resize、浅深色、full/reduced/off和窄屏；图不阻输入，不读真实源、不触发账号刷新。 | 逐断言映射；`preview.js:865–889、909–912` |

## 2. 数据与语义

| 输入/计算/动作 | 当前来源 | 迁移保留边界 |
|---|---|---|
| daily/hourly/snapshot时区、coverageStart、revision/sequence | previewUsage、usageBridge.get/onUpdate/hourly；preview.js:7–30、97–128、1092–1153 | saved data层与collector不合并；get不等新采集，小时异步保序。timezone用原usageMath，不换UTC日界。 |
| Agent目录/入口/模型显示 | agentCatalog、entryName、displayModel；preview.js:121–123、913–919 | 动态custom Agent也能显示；模型/provider身份不按label去重，保留原排序/筛选行为。 |
| 总量/费用/覆盖/上下界 | sum/aggregate、displayValues.cost/usd；preview.js:129–131、42–67 | 原公式移到UMD并单测，React只渲染；未知Token字段的现有sum策略及费用未知疑点见Q5，不擅改。API等价≠订阅账单。 |
| 分类/统计/趋势 | usageMath、insightsMath、chartUi；preview.js:132–170；chart-ui.js | 原disjointMix/categoryView、seriesByModel、calendarBuckets、gaps/平均/累计逻辑复用，不复制到TS。缺日期/未知/零三态保留。 |
| 会话摘要 | sessionsUi计数接口；preview.js:218–256 | 与M5共用缓存，按日/Agent请求可失效，不提前加载全列表/真实会话。 |
| collection | usageStatus；usage-collection detail | 只公开错误/阶段/允许诊断；旧快照可见≠刷新成功。不能把未知费用/没有usage误叫未安装/未登录。 |
| UI偏好 | trendHidden/heatColor localStorage | key/合法值/默认/异常fallback兼容；page/filter/range/selectedDay为当前会话状态，不能擅自持久化。 |
| 导出/刷新/导航 | M3 settingsHost.exportStatistics、usageBridge.refresh、usageData.view/showModel/showAgent | 旧代码保留window.usageHost提供状态与原动作，页面window.usageUi接收原入口；最终签名按裁决。不得让legacy查React内部DOM取filter。 |

## 3. DOM/全局耦合与拆分边界

| 编号 | 当前耦合/位置 | 实施期要求 |
|---|---|---|
| C1 | #usage及内部ID由preview/agent-picker/date-range/insights读写；section外#heatTooltip与趋势动态tooltip。 | 页面DOM/事件归ui/src/pages/usage/；只有经裁决的共享图表/日历组件能提供图形交互，不能留旧隐藏表单假装React已接管。完整ID见附录。 |
| C2 | usageData.ready/rows/today/coverageStart/recorded/subscriptions/collection及badge/navTitle/displayModel/short/icon/escapeHtml/toast/view/showAgent/showModel（preview.js:862–864）。 | rows()给未筛选data，M8自行范围；subscription为副本；ready与loading兼容。cost-page、cost-chart-ui、cost-bars/donut/stack/hero、insights-ui、quota-cards/quota-ui、sources-ui、window-shell均消费；不能缩成只给M7当前rows。 |
| C3 | usageCalendar（preview.js:874）、agentUsageTotals/usageModels（1075–1090），agent-options/agent-usage/usage-models/usage-data-change/usage-collection事件。 | 保留payload、发布时机与hidden时发布；usageModels用于定价按provider/model加权和缺口原因，sessions-ui排序消费agent-usage。不能迁移时只更新新页忘记旧消费者。 |
| C4 | preview包含M3 settingsHost/theme/profile、M9 view/navigation/sidebar/error/busy、M8桥接公共formatter。 | 分层剥离，禁止整文件删；settingsHost导出含current filter（1044–1057），导航showAgent/showModel通过纯状态更新。M9外框行为维持。 |
| C5 | shared detail-interactions的number/scroll/keepPlace/placeTooltip/cost-value委托；UiMorph/uiMotion、Chart观察器。 | 新页数值用Figure/Value和data档；旧M8和外框仍消费shared helpers。只退役本页订阅/监听，并证明unmount取消RAF、异步、tooltip、observer；跨页滚动不偷位置。 |
| C6 | interactions.js把select/segment/native calendar表面增强，agent-picker隐藏原select；测试依赖trigger和selectOptions。 | 新页用kit，移除本页旧增强入口，保留其它旧页；不双绑change/submit或把DOM当共享store。新语义定位仍检验同一键盘与焦点目的。 |

## 4. kit 映射及图表现状

既有kit API已确定：PageHeader/SectionHeader/Card/ListRow、Button/IconButton、Segmented/SubTabs、Select/Combobox、Figure/Value/AgentMark、Badge/Banner/EmptyState、Disclosure、ScrollArea、Toast、M3k的Form/CodeBlock等按现接口使用。不重新设计组件。Agent筛选的图标/name和空项映射及图表/范围日历缺项见Q1–Q4。Meter只有既有已计价done语义，不拿它代Token分类/份额。页面不引Motion/裸业务button，不在TS自写style。

| 功能编号 | 已有kit直接映射 | 缺项/边界 |
|---|---|---|
| F1–5、F28、F32 | PageHeader、Button/IconButton、Segmented、Select/Combobox、AgentMark、Value/Figure、Badge/Banner | Agent chips的组合映射Q3；偏好/筛选只提供状态，不借DOM串页。 |
| F6–10 | SectionHeader、Value/Figure、AgentMark、ListRow/DataTable、Button、EmptyState | 条带/类别份额图/树形结构Q1；上下界可读组件Q4；会话点击仍M5公开入口。 |
| F11–17 | SectionHeader、Select、Button/IconButton、Value、EmptyState、Disclosure | 热力/小时图键盘和图形例外Q1；日明细仍inline、不是擅增Sheet。 |
| F18–27 | Segmented、Select/Combobox、Button、Value/Figure、EmptyState | 趋势图/legend/tooltip/brush由Q1接口；日期范围popover Q2；不把Menu当日历。 |
| F29–31 | Banner/Badge、Value、原Host状态与foundation mount | 刷新/导出/导航回旧动作；消息继续共用usageData.toast/旧toast，M9前不新增Toast宿主；不整体退役preview或共享helpers。 |

| 图/结构 | 现有尺寸/数据/颜色 | 动效/hover/键盘/空未知（仅记录，不定义新API） |
|---|---|---|
| 近30天条带 | 30列；gap clamp4–8px，高132px+cover*.34；≤760px96px+cover*.34（rhythm.css:58–86）；记录总Token/天，最高与今天原中性/强调标记。 | 首入560ms逐14ms；后续height更新不重播。每条完整title/tooltip、可选日；缺日dotted stub、有记录0与正值不同（preview.js:338–371）。 |
| 分类堆叠/今日份额树 | 五个分类原色见preview.js:14–19、dark categoryColor:70；份额按当前总量；34×18SVG中性树枝（173–215）。 | stack-bar/title与categoryView文字；not-recorded/combined/partial不能靠颜色代替；份额0不等整组未知，图不加good/bad色。 |
| 日历热力图 | 7行、53左右列按日期，min-width620px、gap3、方格radius4（rhythm.css:106–109）；heat0–4，四palette及深浅定义preview.js:1019–1025、tokens.css:68–72、244。 | 原340ms sweep+7ms/列，切palette280ms，hover静环/聚焦环；范围或首次25%可见触发，非每次数据刷新；未知淡底、未来非按钮；tooltip与键盘见F11–14。 |
| 周×小时 | 22px周标签+24×max20px方格，gap3、radius4；左网格右侧事实（rhythm.css:140–155），≤960px单列（217）。 | heat palette，168cells，原340ms渐入；hover/focus完整格值，roving与时段选择高亮匹配日；无小时数据明确空态。 |
| 选日小时柱 | 24列gap5，高156px，最小可见8px，未来outline（rhythm.css:182–200）；heat3/heat4。 | 原520ms入场/420ms更新；title/tooltip，键盘同F17；未知/0/未来分开；usage.css:87–100覆盖取消旧hover装饰，以最终级联为准。 |
| 趋势折线/面积 | Chart.js canvas、monotone tension.35，线2.4px，cost2px dash5,5；flow蓝/绿/紫/黄与cost粉，total深#9aabff/浅#796be7、其它灰，modelColor按model hash（preview.js:122、524–781）。 | 原650ms easeOutQuart、reveal720ms、legend fade520/200、reduced150；新实现用规范data档。point常0/单点4/hover5；crosshair3,4、图内externaltooltip；gap虚线不填数据；click/drill/drag/keyboard与legend全部保留。hover仅图内原数据交互，不新增卡。 |

## 5. 规范统一的外观差异

六角色/figure、tabular-nums、36px控件、8/12/16圆角与规范spacing全部按规范和裁决；当前24px热力格/4px格角、图内字号/配色属于需要Claude定义的图表特例，页面不能自行解释。旧hover费用上下界交互已存在，应保留数据与等价focus/click读取；如何纳入kit由Q4裁决。没有获准的图形/日历组件前不在页面写Canvas/SVG/动态style/过渡。当前多个非规范timing只记录，迁移按data档且保持reduced/off终态和不重播目的。

## 6. 测试映射

(i)基础主题、空/错、窗口/无溢出、焦点与无脚本错误；(ii)纯计算UMD单测；(iii)迁移后usage回归或跨页共用流程；(iv)仅待Claude批准的旧形态定位/计时退役。下面逐条保留计划最少六套assert和补充套件（overview/agent/continuity为M6共享流程，在此增加用量映射；sessions只映射今日计数段，其余见M5）；表达式中的旧ID、Chart.getChart、animation.duration、transform/class名是现状，不能机械保留死DOM/全局测试假对象，也不能丢掉其原数值、几何、无副作用和交互目的。

(ii)覆盖sum/aggregate费用上下界/coverage、tiles与分类排他、filterRows/period/previousWindow、记录日期/小时分桶、hour totals/model排行、gapPlan/segmentKind、平均最低观察数/累计/partial、palette等级、session范围/失效和导出范围；既有usageMath/insightsMath/chartUi原函数提取/复用并测未知/0/混合/年界/DST，不另写一份TS计算。graph实现API由Claude给后，再为纯几何/投影写有意义单测。

现有flow须保留：首次只读启动→saved data→刷新busy/失败保留旧数据→revision改变但sequence相同的重估→隐藏页仍通知费用→三层筛选/Agent排序→范围日历和gap键盘drill→日/周小时联动→M5会话定位→M3导出/价格重估→返回滚动/异步取消。测试隔离HOME/usage/quota且只synthetic；不执行真实采集或登录。

布局套件的具体旧高度/时间（如activity首屏下、Chart右轴、cost范围单向收起、42日历格、图例fade）在新布局中如何改断言需裁决，但保留不遮挡/不跳变/不截字/不横溢出/等价可键盘操作。不得把安全审计、ledger字节、unknown、snapshot revision和真实零断言退役。

<!-- ASSERTIONS:M7 -->

### 6.1 最少套件：逐断言位置与目标

同一行多个调用分别编号；同一调用位于循环时保留全部fixture/参数，不把多个case缩成一次。表达式是静态源码抄录，不代表本轮执行成功。

#### scripts/m1/usage-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 33 #1 | (iii) | `` assert.equal(initial.snapshot.daily.reduce((sum, r) => sum + r.totalTokens, 0), f.total) `` |
| 34 #1 | (iii) | `` assert.equal(initial.audit.networkAttempts, 0) `` |
| 34 #2 | (iii) | `` assert.equal(initial.audit.authenticationReads, 0) `` |
| 34 #3 | (iii) | `` assert.equal(initial.audit.sourceWrites, 0) `` |
| 35 #1 | (i) | `` assert.equal(await page.title(), 'Agent Usage · Codex 额度') `` |
| 35 #2 | (iii) | `` assert.equal(await page.evaluate(() => typeof window.require), 'undefined') `` |
| 37 #1 | (iii) | `` assert.equal(await page.locator('#totalTokens').textContent(), '694') `` |
| 38 #1 | (iii) | `` assert.equal(await page.locator('#totalTokens').textContent(), '180') `` |
| 39 #1 | (iii) | `` assert.equal(await page.locator('#totalTokens').textContent(), '524') `` |
| 41 #1 | (iii) | `` assert.equal(await page.locator('#sourceRows .source-row').count(), SOURCES.length) `` |
| 42 #1 | (iii) | `` assert.rejects(page.evaluate(() => window.usageBridge.chooseSource('unsupported-agent')), /SOURCE_REJECTED/) `` |
| 44 #1 | (iii) | `` assert.rejects(page.evaluate(() => window.usageBridge.chooseSource('codex')), /SOURCE_PRODUCT_OVERLAP/) `` |
| 54 #1 | (iii) | `` assert.equal((await page.evaluate(() => window.usageBridge.pricing())).models.find(r => r.provider === 'openai' && r.model === 'gpt-4.1').rates.inputUncached, 5) `` |
| 56 #1 | (iii) | `` assert(Math.abs(codexCost - .000765) < 1e-12) `` |
| 61 #1 | (iii) | `` assert.match(await page.locator('[data-codex-status]').textContent(), /180 → 180 token/) `` |
| 63 #1 | (iii) | `` assert.equal(fs.existsSync(path.join(data,'backups')),false) `` |
| 67 #1 | (iii) | `` assert.equal(fs.readdirSync(path.join(data,'backups')).length,1) `` |
| 67 #2 | (iii) | `` assert.equal((await page.evaluate(() => window.usageBridge.get())).snapshot.daily.reduce((n,r) => n+r.totalTokens,0),f.total) `` |
| 73 #1 | (iii) | `` assert.equal(await download.getAttribute('aria-busy'), 'true') `` |
| 75 #1 | (iii) | `` assert.notEqual(await download.getAttribute('aria-busy'), 'true') `` |
| 75 #2 | (iii) | `` assert.equal(await download.isDisabled(), false) `` |
| 76 #1 | (iii) | `` assert.equal(/M1_PRIVATE_SENTINEL\|authUrl\|accountId/.test(bytes), false) `` |
| 76 #2 | (iii) | `` assert.equal(bytes.includes(dir), false) `` |
| 76 #3 | (iii) | `` assert.equal(JSON.parse(bytes).schemaVersion, 'LocalUsagePreviewV1') `` |
| 82 #1 | (iii) | `` assert.ok(visibilityLatencyMs < 60000) `` |
| 87 #1 | (iii) | `` assert.equal(paused.snapshot.daily.reduce((sum, r) => sum + r.totalTokens, 0), 704) `` |
| 89 #1 | (iii) | `` assert.equal((await page.evaluate(() => window.quotaBridge.get())).state.autoRefresh, 'off') `` |
| 89 #2 | (i) | `` assert.deepEqual(errors, []) `` |
| 93 #1 | (iii) | `` assert.equal(value.snapshot.daily.length, evidencePausedRows) `` |
| 93 #2 | (iii) | `` assert.equal(value.collecting, false) `` |

#### scripts/m1/activity-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 40 #1 | (i) | `` assert.equal(await page.title(), 'Agent Usage · Codex 额度') `` |
| 41 #1 | (iii) | `` assert.match(await page.locator('#todayTotals').textContent(), /2\.0M/) `` |
| 45 #1 | (iii) | `` assert.deepEqual(await page.locator('#heatmap button').evaluateAll(buttons => buttons.map(button => button.dataset.date)), gridDates) `` |
| 46 #1 | (iii) | `` assert.equal(await page.locator('#heatRange').isEnabled(), true) `` |
| 47 #1 | (iii) | `` assert.equal(await page.locator('#heatMonths').isVisible(), true) `` |
| 48 #1 | (iii) | `` assert.equal(await page.locator('#heatmap button span, #heatmap button b').count(), 0) `` |
| 50 #1 | (iii) | `` assert(sizes.every(r => r.width < 24 && r.height < 24 && Math.abs(r.width - r.height) < 1)) `` |
| 51 #1 | (iii) | `` assert.equal(await page.locator('#heatmap').getAttribute('class'), 'heatmap') `` |
| 60 #1 | (iii) | `` assert.match(await page.locator('#heatTooltip').textContent(), /2,000,000 Token/) `` |
| 61 #1 | (iii) | `` assert.equal(await known.getAttribute('aria-describedby'), 'heatTooltip') `` |
| 63 #1 | (iii) | `` assert.match(transition, /0\.14s/) `` |
| 67 #1 | (iii) | `` assert.equal(await page.locator('#heatmap :focus').getAttribute('data-date'), '2026-12-24') `` |
| 69 #1 | (iii) | `` assert.equal(await page.locator('#heatTooltip').getAttribute('aria-hidden'), 'true') `` |
| 71 #1 | (iii) | `` assert.match(await page.locator('#heatTooltip').textContent(), /未观测到记录/) `` |
| 73 #1 | (iii) | `` assert.match(await page.locator('#heatTooltip').textContent(), /0 Token/) `` |
| 74 #1 | (iii) | `` assert.equal(await page.locator('#dayDetail').isVisible(), true) `` |
| 75 #1 | (iii) | `` assert.equal(await zero.getAttribute('aria-pressed'), 'true') `` |
| 76 #1 | (iii) | `` assert.equal(await zero.evaluate(button => button === document.activeElement), true) `` |
| 80 #1 | (iii) | `` assert.equal(await page.locator('#todayDate').textContent(), '2027-01-01') `` |
| 81 #1 | (iii) | `` assert.match(await page.locator('#todayTotals').textContent(), /6\.0M/) `` |
| 82 #1 | (iii) | `` assert.equal(await page.locator('#heatRange').inputValue(), '2027') `` |
| 84 #1 | (iii) | `` assert(newYearSize.width < 24 && newYearSize.height < 24 && Math.abs(newYearSize.width - newYearSize.height) < 1) `` |
| 87 #1 | (iii) | `` assert.equal(await page.locator('#totalTokens').textContent(), '6,000,000') `` |
| 95 #1 | (iii) | `` assert.doesNotMatch(reducedProperties, /transform\|all/) `` |
| 95 #2 | (iii) | `` assert.match(reducedProperties, /background-color/) `` |
| 97 #1 | (iii) | `` assert.match(await zero.evaluate(button => getComputedStyle(button).transitionDuration), /^0s/) `` |
| 103 #1 | (iii) | `` assert.equal(tooltipBounds, true) `` |
| 104 #1 | (i) | `` assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true) `` |
| 108 #1 | (iii) | `` assert.equal(await page.locator('#todayDate').textContent(), '2027-01-02') `` |
| 109 #1 | (iii) | `` assert.match(await page.locator('#todayClients').textContent(), /采集已暂停/) `` |
| 110 #1 | (iii) | `` assert.equal(await page.locator('#todayTotals button').count(), 0) `` |
| 111 #1 | (iii) | `` assert.equal(await page.locator('#todayTotals').textContent(), 'Token—估算—记录—会话—') `` |
| 118 #1 | (iii) | `` assert.match(await page.locator('#todayClients').textContent(), /Codex/) `` |
| 120 #1 | (iii) | `` assert.equal(state.enabled, false) `` |
| 120 #2 | (iii) | `` assert.equal(state.audit.authenticationReads, 0) `` |
| 120 #3 | (iii) | `` assert.equal(state.audit.sourceWrites, 0) `` |
| 120 #4 | (iii) | `` assert.equal(state.audit.networkAttempts, 0) `` |
| 121 #1 | (i) | `` assert.deepEqual(errors, []) `` |

#### scripts/m1/agent-recovery-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 20 #1 | (iii) | `` assert.equal(native.status,'passed') `` |
| 20 #2 | (iii) | `` assert.equal(native.tokens,140) `` |
| 26 #1 | (iii) | `` assert.equal(row.agent,first) `` |
| 26 #2 | (iii) | `` assert.equal(row.totalTokens,140) `` |
| 26 #3 | (iii) | `` assert.equal(row.inputUncached,100) `` |
| 26 #4 | (iii) | `` assert.equal(row.output,40) `` |
| 26 #5 | (iii) | `` assert(Math.abs(row.estimatedCostUsd-1.8)<1e-12) `` |
| 26 #6 | (iii) | `` assert.equal(Number(await page.locator('#totalCost .cost-value').getAttribute('data-cost-lower')),1.8) `` |
| 27 #1 | (iii) | `` assert(!label.includes('未定价')) `` |
| 27 #2 | (iii) | `` assert(label.includes('1.80')) `` |
| 27 #3 | (iii) | `` assert.deepEqual(hashes(),before) `` |
| 28 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/statistics-worker-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 14 #1 | (iii) | `` assert.equal(await page.evaluate(()=>window.sessionsUi.loaded),false) `` |
| 16 #1 | (iii) | `` assert(guard) `` |
| 20 #1 | (iii) | `` assert(await app.evaluate(()=>globalThis.statisticsFixture.store===undefined&&globalThis.statisticsFixture.facts().records===undefined)) `` |
| 22 #1 | (iii) | `` assert(diagnostics.owner.storage.stages.projection.count>0) `` |
| 23 #1 | (iii) | `` assert(!/statistics\.json\|salt\|deviceId\|sessionKey/.test(JSON.stringify(diagnostics))) `` |
| 26 #1 | (iii) | `` assert(restored.revision>first.revision) `` |
| 26 #2 | (iii) | `` assert.equal(restored.sequence,first.sequence) `` |
| 27 #1 | (iii) | `` assert.equal(await page.locator('#cost').isVisible(),true) `` |
| 28 #1 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),ledger) `` |
| 28 #2 | (i) | `` assert.deepEqual(errors,[]) `` |
| 34 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/layout-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 17 #1 | (iii) | `` assert.ok(Math.abs(actual - expected) <= tolerance, label + ' by ' + Math.round(actual - expected) + ' px') `` |
| 78 #1 | (iii) | `` assert.equal(await page.evaluate(() => window.uiMotion.mode), 'full') `` |
| 86 #1 | (i) | `` assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal scroll at ' + w) `` |
| 91 #1 | (iii) | `` assert.ok(top >= 1000, 'activity block on the first screen at ' + Math.round(top)) `` |
| 98 #1 | (iii) | `` assert.equal(await page.locator('#totalCost button').evaluate(b => b.classList.contains('cost-expanded')), true, 'not expanded') `` |
| 104 #1 | (iii) | `` assert.ok(over <= 1, 'range runs ' + Math.round(over) + ' px past the row') `` |
| 105 #1 | (iii) | `` assert.ok(rights.at(-1) < rights[0] - 20, 'range did not fold') `` |
| 106 #1 | (iii) | `` assert.ok(right <= row + 1, 'folding range left the row by ' + Math.round(right - row) + ' px') `` |
| 106 #2 | (iii) | `` assert.ok(right <= rights[i - 1] + 1, 'range grew ' + Math.round(right - rights[i - 1]) + ' px while folding') `` |
| 113 #1 | (iii) | `` assert.ok(Math.min(Math.abs(tip.y + tip.height - pointer.y), Math.abs(tip.y - pointer.y)) < 60, 'tooltip ' + Math.round(pointer.y - tip.y - tip.height) + ' px above the pointer') `` |
| 122 #1 | (iii) | `` assert.equal(cut, '', selector + (index < 0 ? ' last' : ' first') + ': ' + cut) `` |
| 130 #1 | (iii) | `` assert.ok(grid.overflow <= 0, 'scrolls horizontally by ' + grid.overflow) `` |
| 131 #1 | (iii) | `` assert.ok(grid.unsquare < 1, 'an hour cell is ' + grid.unsquare + ' px off square') `` |
| 132 #1 | (iii) | `` assert.equal(grid.empty, 0, 'hour cells narrower than 8 px') `` |
| 140 #1 | (iii) | `` assert.equal(swept, true, 'no sweep on a range change') `` |
| 142 #1 | (iii) | `` assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('#heatmap button')).transitionProperty), /background-color/, 'cells do not cross-fade') `` |
| 150 #1 | (iii) | `` assert.notEqual(todayAfter, today, 'fixture no longer changes the height above ' + sectionSelector) `` |
| 163 #1 | (iii) | `` assert.equal(calendar.cells, 42) `` |
| 163 #2 | (iii) | `` assert.equal(calendar.outside, 0, calendar.outside + ' days outside the popover') `` |
| 163 #3 | (iii) | `` assert.equal(calendar.firstRow, 1, 'first week wraps') `` |
| 176 #1 | (iii) | `` assert.ok(log.some(frame => frame.visible && frame.alpha > 0 && frame.alpha < 1), key + ' toggled without a fade') `` |
| 178 #1 | (iii) | `` assert.equal((await area())[1], base[1], key + ' moved the right edge of the plot') `` |
| 189 #1 | (iii) | `` assert.equal(off, 0, 'shown ' + gap + ' ms after hiding: ' + off + ' cost points off the plot') `` |
| 199 #1 | (iii) | `` assert.ok(bars, 'no day bars after choosing a day') `` |
| 200 #1 | (iii) | `` assert.ok(bars.share > .5, 'day bars take ' + (bars.share * 100).toFixed(0) + '% of the hour card') `` |
| 201 #1 | (iii) | `` assert.ok(bars.used > 0) `` |
| 201 #2 | (iii) | `` assert.equal(bars.thin, 0, bars.thin + ' used hours draw no visible bar') `` |
| 205 #1 | (iii) | `` assert.deepEqual(failures, [], 'layout regressions:\n ' + failures.join('\n ')) `` |
| 206 #1 | (i) | `` assert.deepEqual(errors, []) `` |

#### scripts/m1/detail-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 26 #1 | (iii) | `` assert.equal(await page.locator('#costDialog').count(),0) `` |
| 27 #1 | (iii) | `` assert(upper > lower) `` |
| 33 #1 | (iii) | `` assert.equal(await price.locator('.cost-upper').textContent(), await page.evaluate(v=>window.displayValues.usd(v),upper)) `` |
| 34 #1 | (iii) | `` assert.equal(await price.evaluate(b=>b.classList.contains('cost-expanded')),true) `` |
| 36 #1 | (iii) | `` assert.equal(await price.evaluate(b=>b.classList.contains('cost-expanded')),false) `` |
| 37 #1 | (iii) | `` assert.equal(await price.evaluate(b=>b.classList.contains('cost-expanded')),true) `` |
| 45 #1 | (iii) | `` assert.equal(frames.final,frames.label) `` |
| 45 #2 | (iii) | `` assert(frames.samples.some(s=>s.text!==frames.final)) `` |
| 48 #1 | (iii) | `` assert(sampledValues.every((value,i)=>i===0 \|\| value<=sampledValues[i-1])) `` |
| 50 #1 | (iii) | `` assert(parseTokens(frames.samples[0].text)-parseTokens(early.text) < parseTokens(middle.text)-parseTokens(late.text)) `` |
| 52 #1 | (iii) | `` assert.equal(await page.locator('#totalTokens').textContent(),await page.locator('#totalTokens').getAttribute('aria-label')) `` |
| 54 #1 | (iii) | `` assert.equal(await page.locator('#selectOptions [role="option"]').count(),1) `` |
| 55 #1 | (iii) | `` assert.equal(await page.locator('#modelFilter').inputValue(),'model-99') `` |
| 55 #2 | (iii) | `` assert.equal(await page.locator('#modelFilter-trigger').evaluate(b=>document.activeElement===b),true) `` |
| 56 #1 | (iii) | `` assert.equal(await page.locator('#selectOptions [role="option"]').count(),0) `` |
| 58 #1 | (iii) | `` assert.equal(await page.locator('.heat-palette [data-value="mono"]').evaluate(button => button === document.activeElement), true) `` |
| 59 #1 | (iii) | `` assert.equal(await page.locator('#heatColor').inputValue(),'mono') `` |
| 61 #1 | (iii) | `` assert(bounds.height <= 360.1 && bounds.y >= 8) `` |
| 61 #2 | (iii) | `` assert(bounds.y+bounds.height <= await page.evaluate(()=>innerHeight)-8) `` |
| 65 #1 | (iii) | `` assert.equal(await unknown.locator('.cost-lower').textContent(),'未定价') `` |
| 65 #2 | (iii) | `` assert.equal(await unknown.locator('.cost-plus').count(),0) `` |
| 66 #1 | (iii) | `` assert(inset.left>=18 && inset.right>=18) `` |
| 69 #1 | (iii) | `` assert(scrolling.active>0) `` |
| 73 #1 | (iii) | `` assert.equal(await page.locator('#totalTokens').textContent(),await page.locator('#totalTokens').getAttribute('aria-label')) `` |
| 73 #2 | (iii) | `` assert.equal(await page.evaluate(()=>window.uiDetail.activeCount),0) `` |
| 74 #1 | (iii) | `` assert.equal(await page.locator('body').getAttribute('data-motion'),'reduced') `` |
| 77 #1 | (iii) | `` assert(narrow.x>=8 && narrow.x+narrow.width<=await page.evaluate(()=>innerWidth)) `` |
| 77 #2 | (iii) | `` assert(narrow.y>=8 && narrow.y+narrow.height<=await page.evaluate(()=>innerHeight)) `` |
| 79 #1 | (i) | `` assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true) `` |
| 79 #2 | (i) | `` assert.deepEqual(errors,[]) `` |

### 6.2 多页套件补充定位

这里只映射本页相关段及其跨页结果；循环/流程的其它页分支仍归其它页，不能据此整套退役。

#### scripts/m1/overview-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 30 #1 | (iii) | `` assert.match(await page.locator('#scopeContext').textContent(),/Codex · 累计/) `` |
| 30 #2 | (iii) | `` assert.notEqual(await page.locator('#totalTokens').textContent(),before) `` |
| 31 #1 | (iii) | `` assert.equal(await page.locator('#todayClients .client-name').count(),1) `` |
| 31 #2 | (iii) | `` assert.match(await page.locator('#todayClients .client-name').textContent(),/Codex/) `` |
| 32 #1 | (iii) | `` assert.equal(await page.locator('#activeDays,#availableSources').count(),0) `` |
| 32 #2 | (iii) | `` assert.equal(await page.locator('#recordCount').isVisible(),true) `` |
| 33 #1 | (iii) | `` assert.equal(await page.locator('#overviewWeek button').count(),30) `` |
| 33 #2 | (iii) | `` assert(await page.locator('#overviewWeek .is-unrecorded').count()>0) `` |
| 34 #1 | (iii) | `` assert.equal(await page.locator('#totalTokens').textContent(),before) `` |
| 34 #2 | (iii) | `` assert.equal(await page.locator('#todayClients .client-name').count(),2) `` |
| 38 #1 | (iii) | `` assert.equal(await page.locator('#dayDetail .model-name').filter({hasText:'模型未记录'}).count(),0) `` |
| 40 #1 | (iii) | `` assert.equal(await page.locator('#dayDetail .day-categories .is-unreported').count(),0) `` |
| 40 #2 | (iii) | `` assert.equal(await page.locator('#dayDetail .day-categories .is-structural').textContent(),'缓存写入来源不记录') `` |
| 40 #3 | (iii) | `` assert.equal(await page.locator('#dayDetail .mix-unreported').count(),0) `` |
| 41 #1 | (iii) | `` assert.equal(ledger.records[empty.id].totalTokens,0) `` |
| 41 #2 | (iii) | `` assert.equal(ledger.records[empty.id].cacheWrite,null) `` |
| 44 #1 | (iii) | `` assert.equal(await page.locator('#dayDetail .model-name').filter({hasText:'模型未记录'}).count(),1) `` |
| 50 #1 | (iii) | `` assert.equal(await page.evaluate(p=>document.elementFromPoint(p.x,p.y).id,hit),'trendCanvas') `` |
| 52 #1 | (iii) | `` assert.equal(await page.locator('#dayDetail').isVisible(),false,'scrubbing must not open a day detail on mouse release') `` |
| 58 #1 | (iii) | `` assert.equal(await page.locator('#quotaCards .quota-fill').first().evaluate(l=>l.getAnimations().length),0) `` |
| 62 #1 | (iii) | `` assert.equal(await page.locator('#quotaCards .quota-segments').first().getAttribute('aria-valuenow'),'78') `` |
| 64 #1 | (iii) | `` assert.equal(await page.locator('#quotaCards .quota-fill').first().evaluate(l=>l.getAnimations().length),0) `` |
| 65 #1 | (i) | `` assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true) `` |
| 66 #1 | (i) | `` assert.deepEqual(errors,[]) `` |
| 66 #2 | (iii) | `` assert.equal(fs.existsSync(path.join(quota,'codex-homes')),false) `` |

#### scripts/m1/agent-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 37 #1 | (iii) | `` assert.equal(state.snapshot.daily.reduce((s,r) => s+r.totalTokens,0),fixture.total) `` |
| 37 #2 | (iii) | `` assert.equal(state.audit.networkAttempts,0) `` |
| 39 #1 | (iii) | `` assert.equal(await page.locator('#agentPicker button').count(),SOURCES.length + 1) `` |
| 40 #1 | (iii) | `` assert(await page.locator('#agentPicker img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0))) `` |
| 43 #1 | (iii) | `` assert.equal(await page.locator('#agentFilter').inputValue(),agent) `` |
| 43 #2 | (iii) | `` assert.equal(Number((await page.locator('#totalTokens').innerText()).replaceAll(',','')),tokens) `` |
| 44 #1 | (iii) | `` assert((await page.locator('#scopeContext').innerText()).includes(await page.locator('#agentPicker [data-agent="'+agent+'"]').getAttribute('aria-label'))) `` |
| 45 #1 | (iii) | `` assert.equal(await page.locator('#agentPicker [aria-pressed="true"]').count(),1) `` |
| 47 #1 | (iii) | `` assert.equal(await page.locator('#agentFilter').inputValue(),'all') `` |
| 81 #1 | (iii) | `` assert.equal(state.snapshot.daily.reduce((s,r)=>s+r.totalTokens,0),fixture.total) `` |
| 81 #2 | (iii) | `` assert(!JSON.stringify(state.snapshot).includes(fixture.sentinel)) `` |

#### scripts/m1/continuity-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 41 #1 | (iii) | `` assert(new Set(frames.map(f=>f.clip)).size>5) `` |
| 41 #2 | (iii) | `` assert(frames.every(f=>f.aria==='45')) `` |
| 41 #3 | (iii) | `` assert.equal(frames[0].easing,'cubic-bezier(0.42, 0, 0.2, 1)') `` |
| 46 #1 | (iii) | `` assert.equal(redirected,interrupted) `` |
| 48 #1 | (iii) | `` assert.equal(await page.locator('#quotaCards .quota-fill').first().evaluate(l=>getComputedStyle(l).clipPath),'inset(0px 10% 0px 0px)') `` |
| 49 #1 | (iii) | `` assert.equal(await layerHandle.evaluate(l=>l.getAnimations().length),0) `` |
| 50 #1 | (iii) | `` assert.equal(cadence.state.autoRefresh,'1min') `` |
| 50 #2 | (iii) | `` assert(Date.parse(cadence.state.nextAutoAt)-Date.now()<=60000) `` |
| 57 #1 | (iii) | `` assert(frames.length>15) `` |
| 64 #1 | (iii) | `` assert.equal(await page.locator('#agentPicker button').count(),SOURCES.length + 1) `` |
| 64 #2 | (iii) | `` assert.equal(await page.locator('#agentFilter-trigger').count(),0) `` |
| 66 #1 | (iii) | `` assert(continuity.some(d=>d.nulls>10)) `` |
| 66 #2 | (iii) | `` assert(continuity.some(d=>d.segments.some(s=>s?.borderDash?.join(',')==='2,4')),'real chart must draw missing-date bridges') `` |
| 67 #1 | (iii) | `` assert(continuity.find(d=>d.key==='cost').segments.some(s=>s?.borderColor==='transparent'),'recorded unknown costs must retain a gap') `` |
| 70 #1 | (iii) | `` assert.equal(await page.evaluate(()=>Chart.getChart(document.getElementById('trendCanvas')).getActiveElements().length),0) `` |
| 72 #1 | (iii) | `` assert.equal(await page.locator('#agentFilter').inputValue(),key) `` |
| 72 #2 | (iii) | `` assert.equal(await page.locator('#agentPicker [aria-pressed="true"]').count(),1) `` |
| 73 #1 | (iii) | `` assert.equal(await page.locator('#agentFilter').inputValue(),'all') `` |
| 73 #2 | (iii) | `` assert.equal(await page.locator('#agentFilter').inputValue(),SOURCES.at(-1)) `` |
| 74 #1 | (iii) | `` assert.equal(await page.evaluate(()=>Chart.getChart(document.getElementById('trendCanvas')).id),before) `` |
| 75 #1 | (i) | `` assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true) `` |
| 76 #1 | (iii) | `` assert(logos.every(l=>l.loaded)) `` |
| 79 #1 | (iii) | `` assert.equal(await page.locator('#quotaCards .quota-fill').first().evaluate(l=>l.getAnimations().length),0) `` |
| 79 #2 | (iii) | `` assert.equal(await page.locator('#quotaCards .quota-segments').first().getAttribute('aria-valuenow'),'0') `` |
| 80 #1 | (i) | `` assert.deepEqual(errors,[]) `` |
| 80 #2 | (iii) | `` assert.equal(fs.existsSync(path.join(quota,'codex-homes')),false) `` |

#### scripts/m1/sessions-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 49 #1 | (iii) | `` assert.equal(await page.evaluate(()=>window.sessionsUi.loaded),false,'the usage page must not load the full session list') `` |
| 52 #1 | (iii) | `` assert.equal(await page.locator('#todayClients .client-sessions').filter({ hasText: '7 个会话' }).count(), 1, 'Claude Code: seven sessions today') `` |
| 53 #1 | (iii) | `` assert.equal(await page.locator('#todayClients .today-columns').count(), 1) `` |
| 54 #1 | (iii) | `` assert(await page.locator('#todayClients .today-model .model-hit').first().textContent() !== '') `` |
| 55 #1 | (iii) | `` assert.equal(await page.locator('#todayTotals .today-kpi').count(), 4, 'Today totals has 4 clean KPI columns') `` |

#### scripts/m1/agent-conflict-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 21 #1 | (iii) | `` assert.equal(row.totalTokens,120) `` |
| 21 #2 | (iii) | `` assert.equal(row.estimatedCostUsd,null) `` |
| 21 #3 | (iii) | `` assert.equal(row.inputUncached,null) `` |
| 21 #4 | (iii) | `` assert.deepEqual(row.knownUsage,{}) `` |
| 21 #5 | (iii) | `` assert.equal(await page.locator('#totalCost .cost-value').getAttribute('data-cost-lower'),'') `` |
| 21 #6 | (iii) | `` assert((await page.locator('#totalCost .cost-value').getAttribute('aria-label')).includes('未定价')) `` |

#### scripts/m1/custom-sources-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 50 #1 | (iii) | `` assert.equal(await page.locator('#agentFilter').inputValue(),id) `` |
| 51 #1 | (iii) | `` assert.equal(Number((await page.locator('#totalTokens').innerText()).replaceAll(',','')),120) `` |
| 61 #1 | (iii) | `` assert.equal((await page.evaluate(()=>window.usageBridge.get())).snapshot.daily.reduce((n,r)=>n+r.totalTokens,0),120) `` |
| 67 #1 | (iii) | `` assert.equal((await page.evaluate(()=>window.usageBridge.get())).snapshot.daily.reduce((n,r)=>n+r.totalTokens,0),120) `` |
| 81 #1 | (iii) | `` assert.equal((await page.evaluate(()=>window.usageBridge.get())).snapshot.daily.reduce((n,r)=>n+r.totalTokens,0),120) `` |
| 105 #1 | (iii) | `` assert.equal((await page.evaluate(()=>window.usageBridge.get())).snapshot.daily.reduce((n,r)=>n+r.totalTokens,0),325) `` |

#### scripts/m1/functional-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 24 #1 | (iii) | `` assert.equal(await page.locator('#costHelp').count(),0) `` |
| 27 #1 | (iii) | `` assert(lead>=64,'token total leads') `` |
| 27 #2 | (iii) | `` assert(rest.font>=28&&rest.font<lead,'estimate is the second figure') `` |
| 32 #1 | (iii) | `` assert.equal(await hero.locator('.cost-separator').textContent(),'') `` |
| 32 #2 | (iii) | `` assert.equal(await hero.evaluate(e=>e.classList.contains('cost-expanded')),true) `` |
| 32 #3 | (iii) | `` assert.equal(await hero.locator('.cost-upper').textContent(),await page.evaluate(v=>window.displayValues.usd(v),Number(await hero.getAttribute('data-cost-upper')))) `` |
| 38 #1 | (iii) | `` assert.equal(await page.evaluate(()=>Chart.getChart(document.getElementById('trendCanvas')).data.datasets.length),5) `` |
| 39 #1 | (iii) | `` assert(await page.evaluate(()=>Chart.getChart(document.getElementById('trendCanvas')).$revealFrames)>10) `` |
| 41 #1 | (iii) | `` assert(captured.length>15) `` |
| 42 #1 | (iii) | `` assert.equal(await page.locator('[data-trend-mode="flow"]').isVisible(),false) `` |
| 42 #2 | (iii) | `` assert.equal(await page.evaluate(()=>Chart.getChart(document.getElementById('trendCanvas')).data.datasets.length),1) `` |
| 46 #1 | (iii) | `` assert.equal(await page.locator('#modelFilter option').count(),2) `` |
| 47 #1 | (iii) | `` assert.equal(await page.locator('#trendTotal').textContent(),(sourceTotal/1e6).toFixed(1)+'M') `` |
| 48 #1 | (iii) | `` assert.equal(await page.locator('#sourceFilter option').count(),2) `` |
| 49 #1 | (iii) | `` assert.equal((await page.evaluate(()=>window.usageBridge.get())).enabled,false) `` |
| 50 #1 | (iii) | `` assert.equal(await page.locator('#chartLegend button').count(),6) `` |
| 51 #1 | (iii) | `` assert.equal(await legend.getAttribute('aria-pressed'),'false') `` |
| 51 #2 | (iii) | `` assert.equal(await legend.getAttribute('aria-pressed'),'true') `` |
| 52 #1 | (iii) | `` assert.equal(await page.locator('#display').inputValue(),'total') `` |
| 52 #2 | (iii) | `` assert.equal(await page.locator('#display').inputValue(),'daily') `` |
| 52 #3 | (iii) | `` assert(await page.evaluate(()=>Chart.getChart(document.getElementById('trendCanvas')).data.labels.length)<=5) `` |
| 53 #1 | (iii) | `` assert.equal(await page.locator('#trendFrom').inputValue(),weekStart) `` |
| 53 #2 | (iii) | `` assert.equal(await page.locator('#trendTo').inputValue(),calendarToday) `` |
| 53 #3 | (iii) | `` assert.equal(await page.evaluate(()=>Chart.getChart(document.getElementById('trendCanvas')).data.labels.length),7) `` |
| 54 #1 | (iii) | `` assert.equal(await page.locator('#trendTooltip').isVisible(),true) `` |
| 54 #2 | (iii) | `` assert.equal(await page.locator('#trendTooltip').isVisible(),false) `` |
| 61 #1 | (iii) | `` assert(motion.length>10) `` |
| 61 #2 | (iii) | `` assert(new Set(motion.map(frame=>frame.y?.toFixed(5))).size>10,'curve coordinates must move, not just RAF callbacks') `` |
| 61 #3 | (iii) | `` assert.equal(await page.evaluate(()=>Chart.getChart(document.getElementById('trendCanvas')).id),chartId) `` |
| 63 #1 | (iii) | `` assert(agentMotion.points>31,'needs a range longer than a month: '+agentMotion.points) `` |
| 63 #2 | (iii) | `` assert(agentMotion.shapes>5,'switching Agent must morph the trend: '+JSON.stringify(agentMotion)) `` |
| 91 #1 | (iii) | `` assert.equal(await page.locator('body').getAttribute('data-motion'),'reduced') `` |
| 91 #2 | (iii) | `` assert.equal(await page.evaluate(()=>Chart.getChart(document.getElementById('trendCanvas')).options.animation),false) `` |
| 92 #1 | (i) | `` assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true) `` |
| 93 #1 | (i) | `` assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true) `` |
| 94 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/interaction-reliability-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 124 #1 | (iii) | `` assert.equal(await page.locator('#agentPicker button').last().getAttribute('aria-pressed'), 'true') `` |
| 125 #1 | (iii) | `` assert.equal(await page.locator('#agentFilter').inputValue(), 'all') `` |
| 127 #1 | (iii) | `` assert.equal(await segments.locator('button').last().getAttribute('aria-checked'), 'true') `` |
| 152 #1 | (iii) | `` assert(Math.abs(position - 600) < 2, reason + ' cancels pending corrections') `` |
| 161 #1 | (iii) | `` assert(Math.abs(interrupted - 650) < 2, 'user wheel cancels every pending correction') `` |
| 168 #1 | (iii) | `` assert(Math.abs(superseded - 750) < 2, 'explicit jump supersedes keepPlace') `` |
| 170 #1 | (iii) | `` assert.equal(await page.evaluate(() => window.scrollY), 0, 'old route cannot steal new route position') `` |
| 279 #1 | (i) | `` assert.deepEqual(errors, []) `` |

#### scripts/m1/polish-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 35 #1 | (iii) | `` assert.equal(await chips(),chipRow,'chips moved when an Agent was chosen') `` |
| 36 #1 | (iii) | `` assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#overviewWeek i')].reduce((n,e)=>n+e.getAnimations().length,0)),0,'the 30-day strip replayed on a range change') `` |
| 52 #1 | (iii) | `` assert(Math.abs(await page.evaluate(()=>window.scrollY)-savedScroll)<2) `` |
| 53 #1 | (iii) | `` assert.match(await exportSheet.textContent(),/导出统计/) `` |
| 59 #1 | (iii) | `` assert.equal(after.font,before.font) `` |
| 59 #2 | (iii) | `` assert.equal(after.top,before.top) `` |
| 59 #3 | (iii) | `` assert.equal(after.height,before.height) `` |
| 59 #4 | (iii) | `` assert(after.expanded) `` |
| 59 #5 | (iii) | `` assert(after.over<=1,'range runs past its row') `` |
| 59 #6 | (iii) | `` assert.equal(after.upper,await page.evaluate(v=>window.displayValues.usd(v),Number(await price.getAttribute('data-cost-upper')))) `` |
| 63 #1 | (iii) | `` assert.equal(repeated.final,'100') `` |
| 63 #2 | (iii) | `` assert(Number(repeated.middle)>10&&Number(repeated.middle)<90) `` |
| 63 #3 | (iii) | `` assert.equal(repeated.active,0) `` |
| 82 #1 | (i) | `` assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true) `` |
| 84 #1 | (iii) | `` assert.equal(await page.evaluate(()=>window.uiDetail.activeCount),0) `` |
| 84 #2 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/motion-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 48 #1 | (iii) | `` assert.equal(await page.locator('#main').getAttribute('data-current-view'), 'usage') `` |
| 49 #1 | (iii) | `` assert.equal(await page.locator('main > section:not([hidden])').count(), 1) `` |
| 50 #1 | (iii) | `` assert.equal(await page.locator('#totalTokens').textContent(), '2,000,000') `` |
| 97 #1 | (iii) | `` assert.equal(await page.locator('#totalTokens').textContent(), '2,000,000') `` |
| 99 #1 | (iii) | `` assert(changes.system.maxCommitMs < 3000) `` |
| 99 #2 | (iii) | `` assert(changes.system.averageCommitMs < changes.off.averageCommitMs * 1.5 + 20) `` |
| 113 #1 | (i) | `` assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true) `` |
| 116 #1 | (i) | `` assert.deepEqual(errors, []) `` |
| 116 #2 | (iii) | `` assert.equal(fs.existsSync(path.join(quota, 'codex-homes')), false) `` |

#### scripts/m1/visual-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 63 #1 | (iii) | `` assert.equal(Number(await page.locator('#totalCost button').getAttribute('data-cost-lower')), lower) `` |
| 64 #1 | (iii) | `` assert.equal(Number(await page.locator('#totalCost button').getAttribute('data-cost-upper')), upper) `` |
| 65 #1 | (iii) | `` assert.match(await page.locator('#totalCost .cost-lower').textContent(), /^\$[\d,.]+$/) `` |
| 73 #1 | (iii) | `` assert.equal(await page.locator('#totalCost button').evaluate(b => b.classList.contains('cost-expanded')), true) `` |
| 75 #1 | (iii) | `` assert.match(await page.locator('#totalCost button').getAttribute('aria-label'), /仅包括已定价部分/) `` |
| 85 #1 | (i) | `` assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true) `` |
| 87 #1 | (i) | `` assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true) `` |
| 90 #1 | (i) | `` assert.deepEqual(errors, []) `` |

#### scripts/m1/style-alignment-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 21 #1 | (iii) | `` assert.deepEqual({font:parity.cost.font,size:parity.cost.size,color:parity.cost.color},{font:parity.usage.font,size:parity.usage.size,color:parity.usage.color},'the cost header control matches the usage control') `` |
| 22 #1 | (iii) | `` assert.deepEqual(common.costType,common.usageType,'section typography matches usage') `` |
| 22 #2 | (iii) | `` assert.deepEqual(common.costEdge,common.usageEdge,'card edges match usage') `` |
| 29 #1 | (i) | `` assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),view+' has no horizontal overflow') `` |
| 30 #1 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),facts) `` |
| 31 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

<!-- /ASSERTIONS:M7 -->

## 7. 待 Claude 裁决

| 编号 | 具体问题及证据 | 实施前需要的裁决 |
|---|---|---|
| Q1 | kit没有日历热力、周×小时/日小时、趋势图；图里轴/series/tooltip/legend/roving/drill/unknown/partial都有业务语义，现状见§4和F11–27。 | 提供共享组件/API、图形/格/轴/颜色/spacing例外和交互所有权；确认旧Chart实例与timing/DOM断言替代策略。不能直接移旧内联style/Canvas进页面绕guard。 |
| Q2 | date-range.js是42格日期范围popover，不等Select或Sheet；anchored popup、from/to草稿/校验/开关焦点由旧DOM控制。 | 提供日期范围控件/portal/焦点和Host状态接口；保留F19–20全部行为。无控件时按§9.4局部阻塞范围保留旧实现，不自行选外部日历包。 |
| Q3 | Agent chips有图标、全名、usage排序与disabled-like空项但仍可选；Segmented/AgentMark已存在，未定义组合的排序/键盘/换行结构。 | 指定既有kit组合方式/必要接口扩展，不能改成新视觉或把无记录禁用；明确current filters与M3导出/M8/侧栏事件状态接缝。 |
| Q4 | costHtml提供hover/focus/click读上下界；shared detail-interactions对#totalCost测量、range-fit与数值动画，kit Value/Figure本身不提供此交互。 | 指定复用组件/API及紧凑今日/日详情/hero不同布局，保留aria最终完整值、未知/partial/上界与无裁剪。旧几何/hover缩字断言的合规替代由Claude决定。 |
| Q5 | insights.js:43–49按已知cost求和但初值0，全部费用未知时可显示$0；preview.js:634–649分项桶初值0，只累加已报值；preview.js:778覆盖用coverage??0；sum:129也将null当0。 | 确认哪些是明确总量/空集零，哪些须保持未知或partial。规范要求未知不补0，不能由迁移者自行改聚合；给出修复/保留边界和相应单测预期。旧“—”/未报告按Value规范的文案映射同裁决。 |
| Q6 | preview同时拥有M3 settingsHost、M8 usageData与M9 shell，insights-ui混合M4 attention/capability与M8 budget。 | 明确usageHost/usageUi与旧公开接口兼容范围；跨页事件不改名、不二次订阅；保留未迁页和M9，分阶段退役而非整文件删。对共享系统级缺项按§9.4停全部，页内图表缺项保留局部。 |

本盘点未采用任何待裁决方案。只提交本文，尚未运行verify/audit/build/UI/真实数据检查。M3深浅对比的独立执行结果见`UI-MIG-M3-20261025.md`追加记录，不能当作M7运行验收。

<!-- IDS:M7 -->

## 附录：ID 与反向引用静态检索

以下索引固定到main 4f77437。完整静态ID及脚本赋值ID如下；循环生成的data-*行/控制也必须按正文覆盖，不把这个索引误当全部功能。

```text
usage periods refresh rangeTitle scopeSummary scopeContext resetUsageScope
totalTokens totalLabel totalCost priceCoverage recordCount dailyComparison periodComparison
todaySummary overviewWeek overviewAxis totalMix todayDate todayTotals todayMix
todayClients activityBlock heatRange rhythmStats heatmap heatMonths heatHover
heatColor hourCard dayDetail trend trendScope trendTotal trendTotalLabel
agentFilter sourceFilter modelFilter trendRangeButton trendRangeLabel trendRangeFollow trendModes
display trendNote trendGrain trendRangePopover trendRangeForm trendFrom trendTo
rangeCalendar rangeSummary trendRangeReset trendCanvas chartEmpty chartLegend trendChange
trendPeak trendLead trendPerRecord clientChips todaySessions closeDay trendTooltip
agentPicker
```

| 文件与行号 | 命中ID（候选，需按正文耦合表区分DOM访问/普通字段/注释） |
|---|---|
| agent-setup-ui.js:3 | usage |
| agent-setup-ui.js:22 | usage |
| agent-setup-ui.js:25 | usage |
| agent-setup-ui.js:36 | refresh |
| agent-setup-ui.js:37 | refresh |
| agent-setup-ui.js:38 | refresh |
| config-health-ui.js:60 | refresh |
| config-manager-ui.js:41 | refresh |
| cost-chart-ui.js:3 | display |
| cost-chart-ui.js:9 | trend |
| cost-chart-ui.js:28 | trend |
| cost-chart-ui.js:58 | trend |
| cost-chart-ui.js:60 | trend |
| cost-page.js:4 | usage |
| cost-page.js:8 | usage |
| cost-page.js:19 | trend |
| cost-page.js:28 | usage |
| cost-page.js:45 | usage |
| cost-page.js:69 | totalTokens |
| cost-page.js:88 | trend |
| cost-page.js:144 | totalTokens |
| cost-page.js:171 | totalTokens |
| cost-page.js:194 | totalTokens |
| cost-page.js:199 | trend |
| cost-page.js:209 | trend |
| cost-page.js:222 | trend |
| cost-page.js:234 | totalTokens |
| cost-page.js:400 | trend |
| cost-page.js:426 | trend |
| cost-page.js:434 | trend |
| cost-page.js:492 | trend |
| cost-page.js:494 | trend |
| cost-page.js:498 | trend |
| cost-page.js:583 | trend |
| cost-page.js:646 | trend |
| cost-stack.js:2 | trend |
| cost-stack.js:61 | trend |
| custom-sources-ui.js:74 | totalTokens |
| custom-sources-ui.js:76 | totalTokens |
| focus.js:4 | usage |
| focus.js:25 | usage |
| focus.js:40 | usage、activityBlock |
| focus.js:49 | usage |
| insights-ui.js:32 | totalTokens |
| insights-ui.js:144 | totalTokens |
| insights-ui.js:149 | totalTokens |
| morph.js:2 | refresh |
| motion.js:26 | usage、trend |
| motion.js:106 | periods |
| motion.js:127 | trendTooltip |
| motion.js:129 | heatmap |
| pricing-data.js:37 | usage |
| pricing-data.js:39 | usage |
| pricing-data.js:41 | usage |
| pricing-data.js:43 | usage |
| pricing-data.js:77 | usage |
| pricing-data.js:78 | usage |
| pricing-editor-model.js:19 | usage |
| pricing-editor-model.js:32 | usage |
| pricing-editor-model.js:34 | usage |
| pricing-editor-model.js:39 | usage |
| pricing-view.js:5 | usage |
| pricing-view.js:6 | usage |
| pricing-view.js:16 | display |
| pricing-view.js:53 | usage |
| pricing-view.js:54 | usage |
| pricing-view.js:65 | usage |
| quota-cards.js:13 | display |
| quota-cards.js:127 | refresh |
| quota-cards.js:151 | usage |
| quota-cards.js:322 | refresh |
| quota-cards.js:324 | refresh |
| quota-cards.js:367 | refresh |
| quota-cards.js:368 | refresh |
| quota-cards.js:389 | refresh |
| quota-cards.js:439 | display |
| quota-cards.js:447 | refresh |
| quota-cards.js:448 | refresh |
| quota-cards.js:471 | refresh |
| quota-cards.js:635 | display |
| quota-cards.js:638 | display |
| quota-cards.js:809 | refresh |
| quota-cards.js:810 | refresh |
| quota-ui.js:2 | refresh |
| quota-ui.js:45 | refresh |
| quota-ui.js:50 | refresh |
| quota-ui.js:76 | refresh |
| quota-ui.js:81 | display |
| serve.js:37 | usage |
| sessions-ui.js:3 | usage |
| sessions-ui.js:25 | usage |
| sessions-ui.js:34 | totalTokens |
| sessions-ui.js:53 | totalTokens |
| sessions-ui.js:61 | usage |
| sessions-ui.js:118 | usage |
| sessions-ui.js:273 | totalTokens |
| sessions-ui.js:288 | usage |
| source-connections-ui.js:3 | refresh |
| sources-ui.js:45 | display |
| sources-ui.js:55 | display |
| sources-ui.js:69 | refresh |
| sources-ui.js:139 | display |
| sources-ui.js:142 | display |
| sources-ui.js:159 | display |
| usage-data.js:5 | usage |
| usage-data.js:8 | refresh |
| window-shell.js:4 | usage |
| window-shell.js:42 | usage |
| window-shell.js:43 | usage、refresh |

原始索引与assert全文保存在未跟踪的 `artifacts/ui-mig/inventory-20261025/index.json`，不属于运行验收。

<!-- /IDS:M7 -->

署名：Codex
