# M8 费用迁移盘点 · 2026-10-25

## 状态与基线

仅计划§9.2静态盘点，未实施或退役M8。分支`ui/mig-m4-m8-inventory`从本地main `4f7743773f6fbf9db8b541604ebccb7d85880d2b`建立，以下产品行号以该基线为准；阶段二复核。已按§0.1复读规范/计划，另读`UI-COST-V3-20261024.md`和`UI-COST-HERO-20261024.md`；首屏为所有者已选的A+C两页。默认renderer目录`design/desktop-reference/`，UI测试目录`scripts/m1/`。CodeGraph不可用，以当前源码/AST/ID和全局反向引用核对；无子代理。不改产品、kit/vendor/theme/token/guard/后端/preload/IPC，不读取真实来源/凭据/账户，不打包、不合main或远程写入。图表只记现状，接口/规范例外等待Claude。

## 1. 功能清单

| 编号 | 现有区块、控件、状态及边界 | 出处 |
|---|---|---|
| F1 | 费用标题；费用分析/项目与预算两视图，独立于五页外框；分析显示费用CSV，项目页显示刷新项目/项目CSV；页面hidden受原路由控制。 | `index.html:77–114`；`insights-ui.js:175–190` |
| F2 | 费用自己的全部/30/7/今天、单月、自选日期范围；coverageStart和今天夹边；前期比较按覆盖完整性；不改变用量页范围。首屏和侧栏同一范围状态，月chip取消。 | `cost-page.js:16–27、45–67、481–486、567–575` |
| F3 | 范围边缘按钮/遮罩/侧栏，开关aria-expanded与inert；日历独立折叠、记住折叠；Escape关闭侧栏并回焦、取消选日；初始rail收起。现有hover显露只是入口表现。 | `cost-page.js:24–27、559–575、635–645`；`cost.css:500–509` |
| F4 | 日历按自然月/周一，coverage前/未来日禁用，记录日点；上下月边界；两点成区间、同日再点单日，hover/focus预览；四方向只移动当前月允许日，选中回焦。 | `cost-page.js:101–126、619–644` |
| F5 | Agent图标筛选只列当前范围出现的Agent，全部/单个可切回全部；按目录排序、完整title/aria名称、选中摘要；筛选所有费用分析，但项目与预算另有自己的project/period。 | `cost-page.js:127–131、463–488、573–576` |
| F6 | 首屏A所选范围：费用下界/上界/partial、范围/日期/前期变化、计价覆盖、未计入Token可跳核对；API等价不是账单。Agent已计价金额构成条，未计价仅命名/斜线段，不画为金额0。 | `cost-page.js:140–161`；`cost-hero.js:19–30` |
| F7 | A构成条hover/focus：大数字读对应Agent及占已计价比例，离开恢复；三事实微图：日均近14日缺日断开、每百万与前期双柱、缓存命中小环/约省下；未知不补图。 | `cost-hero.js:11–30、49–53、63–81` |
| F8 | 首屏C本月至今：不随所选范围，仍随Agent；第N/M天、上月同期、上下界和覆盖；不足7个有用量日暂不推算，推算为模型不是账户/实际账单。 | `cost-page.js:162–179`；`cost-hero.js:31–43`；`src/m1/cost-insights.js:33–68` |
| F9 | C半环实色已用下界、浅色区间、虚线推算整月；每日柱已计价/有用量未计价/没有记录/未来四态、今天圈；hover/focus读当天金额或未计入/无记录并保留完整说明。 | `cost-hero.js:34–42、69–81` |
| F10 | 首屏左右箭头/带文字圆点/键盘方向、拖动/滑动/横向滚轮与边界阻力；非当前slide inert；随高度；首入图依次长出、数字滚动，记heroSlide；刷新保节点/hover最新值，不重播。 | `cost-hero.js:44–99`；`ui-carousel.js:56–131` |
| F11 | 走势日/周/月、每期/累计、面积/折线；auto>120天按周；桶按范围起始对齐；最大Agent在堆叠底；保留至少一已计价series可见。 | `cost-page.js:185–223、577–589` |
| F12 | 走势原地上方读数和legend：静止范围合计，指向/键盘换桶金额/日期、未计入Agent；图内只有顶部小胶囊，不遮曲线；缺日期/无已计价区间不补数值，轴下partial刻线。 | `cost-stack.js:14–58、85–116`；`cost-page.js:203–223` |
| F13 | 走势hover光标/各series点、离开恢复；Space固定，点别处解除，Left/Right/Home/End，Shift方向选范围，Enter应用/单桶drill，Escape清除；pointer拖>5px选多桶且抑制click，取消不drill。 | `cost-stack.js:117–137` |
| F14 | 走势切daily/cumulative/line/area/legend从当前几何morph，换范围/Agent重入；resize按真实内容宽重画，读数pin/hover同范围保留；reduced/off终态，无过渡残留。 | `cost-stack.js:61–82、119`；`cost-page.js:492–500、646–648` |
| F15 | 花在哪：Agent/类型切换、圆环/半环；只有已计价正数画弧，未计价仍legend可解释；图例toggle保留至少一正值项；hover/focus同时弧加粗和中心名称/金额/份额/Token，离开恢复；不压暗其它项。 | `cost-page.js:229–246`；`cost-donut.js:22–51、63–148` |
| F16 | 圆/半环按角度和底轨同步过渡，外框逐帧按最低点算高，不裁下弧；legend长列表bounded scroll/safe center；窄面板缩环/份额在中心，长名称title；未知不画零弧。 | `cost-donut.js:99–133`；`cost.css:585–611、673–680` |
| F17 | 按月：最近12月/全部、grouped/stacked、月总上下界、当前月推算、各Agent图例；没有该Agent记录为“—”、有用量未计价为“未计入”；最高刻度按niceStep*4，tiny非零保留。 | `cost-page.js:251–273`；`cost-bars.js:50–107` |
| F18 | 月列hover/focus上方读数/月份/投影/未计入，指向底带；roving方向/Home/End、Escape清读数；点月筛选整页，再点清月；隐藏series至少一项，变布局/隐藏从当前path过渡。 | `cost-bars.js:20–48、89–118`；`cost-page.js:570` |
| F19 | 花在哪与按月等高，两栏/独占一栏切换，收起侧变窄标题条，内容inert；窄屏上下排、按钮显隐；花在哪内费用构成/订阅对照，切换保持同一范围/Agent。 | `index.html:94–96`；`cost-page.js:539–558、581–582`；`cost.css:556–584、685–696` |
| F20 | 订阅对照：所选月或最近完整月/本月，不等任意custom范围；每Agent API估算/月费/倍数/上下界/文字/额度入口；原文“回本”保留待裁决，估算≠账单。每行以本行max(上界,fee)为尺度。 | `cost-page.js:276–315` |
| F21 | 月费decimal、maxlength9，change或Enter保存；可前导$，空移除，>0且≤100000，四舍五入分；非法恢复原值，失败保原值/toast，无bridge仅预览内存；IME不提交。 | `cost-page.js:515–525、629–640` |
| F22 | 订阅额度仅读M6已连接状态，不发provider请求；Codex V2优先/V1 fallback，最多主次两窗/否则余额，首账号+账号数；点入口到额度正确Agent，custom无额度；当前观测与所选月无关。 | `cost-page.js:283–315、591、649` |
| F23 | 计价覆盖环/文字/步骤：未定价/未完整来源/待核实费率各原因、涉及模型、份额；fixable开M3定价，不可修开解释；range标≈和至多+；未计入仍存在时不四舍五入100%，全部才done。 | `cost-page.js:32–43、321–338` |
| F24 | 缓存：整体命中和约省下、模型已报告/部分未报告/没有价格；命中条未知仍文字未报告；前5+未报告补位，展开全模型/收起，bounded scroll键盘到底，模型完整title。 | `cost-page.js:341–352、566` |
| F25 | 明细model/Agent两种group、Token/费用降序、计数、默认前6+其它合计，展开/收起；>12才搜索，匹配名字/key/使用方，输入节点与caret保留；“只看未计入”只过滤明细。 | `cost-page.js:355–369、422–460、593–597` |
| F26 | 行字段：图标/名/使用方、Token/份额/费用上下界/覆盖/每百万、构成微条/前期变化/小趋势；unknown/未计入/来源不全与partial；其它行保成员title并展开，不开伪详情。 | `cost-page.js:422–460` |
| F27 | 行内构成微条hover完整类别/金额/份额，趋势微图hover/focus+左右/Home/End读原始点，Escape收起；tooltip窗口内放置，滚动/点开详情清理，不触发数值业务变化。 | `cost-chart-ui.js:22–63` |
| F28 | 单一左侧费用详情：标题/身份/范围，金额/coverage/变化，六指标、四字段Token+费用/推理说明/区间，日Token图、全模型或全使用方、计价依据/映射/四费率/原因；所有长列表可到达。 | `cost-page.js:371–420` |
| F29 | 详情每日Token单调曲线、最多90点抽样；按内容宽防缩小刻字、缺失分段；终点标签在hover时隐藏避免叠；point按钮roving、Escape bare图关闭sheet；row spark30点、单点可见。 | `cost-page.js:84–96、408、426`；`cost-chart-ui.js:11–28、64–82`；`cost.css:725–727` |
| F30 | 详情关闭/遮罩/Escape/向左拖把手（距离或速度）；取消pointer恢复，回焦原行或分组；异步更新仍同一详情；换路由关闭。 | `cost-page.js:455–459、527–537、651` |
| F31 | 详情/核对开M3定价或解释先关闭原native modal，避免覆盖React层；去来源、去用量Agent/模型、copy模型ID的成功/失败；不改M3共享接口。 | `cost-page.js:384–407、598–606` |
| F32 | 费用CSV：busy禁止重入、取消/成功行数/失败反馈；main从同UMD重建csv，导出字段现未传Agent/缺口/排序，待Q6；不把renderer HTML当CSV。 | `cost-page.js:609–616`；`src/m1/cost-table.js:1–8` |
| F33 | 项目与预算独立自然日/周/月/累计、项目选择和时区/历史起点；总费用上下界/Token/记录覆盖，unknown project不按路径猜；同名脱敏标签与unattributed。 | `index.html:108–113`；`insights-ui.js:4–14、138–152` |
| F34 | 预算输入保留原精度（6位USD显示、极小<阈值），dirty草稿刷新/导出不覆盖；保存正数≤1000000，移除单独按钮；busy禁用，IME保护；只本机估算提醒，不控制Agent。 | `insights-ui.js:8–9、138–174、184–190` |
| F35 | 全部已保存预算不随当前项目/周期缩小；列period/scope/range/timezone/limit/费用/records/unpriced；not-set/no-data/unpriced/exceeded/possibly-exceeded/incomplete/observed-below/scope-missing各自说明；展开保持。 | `insights-ui.js:37–43、124–137、210–211` |
| F36 | 预算查看：换period/project、定位该预算并展开回焦；缺失scope回all但保scope-missing说明；从M4事项跳相同入口；知悉/恢复按对应预算scope+fingerprint，证据变再提醒。 | `insights-ui.js:131–137、192–218`；budget-overview套件 |
| F37 | 项目展开Agent聚合、只看项目、项目CSV（名称/聚合，无绝对路径/原始身份）；无记录/无bridge/失败保上次/无效scope回all/重试；版本丢弃旧read、pending read去重。 | `insights-ui.js:138–174、189–193` |
| F38 | 项目/预算事项一行notice链接M4需要处理，侧栏count后台小attention读而不render隐藏页；M4 capability/事项与M5notice仍使用同insights-ui，不能整段删。 | `index.html:108、113`；`insights-ui.js:17–33、59–123、153–218` |
| F39 | 数据/定价/额度/路由事件：usageData.rows未筛选，derive缓存按snapshot引用/范围/Agent；同sequence重估revision更新仍要反映，price0为已定价非未计价；隐藏不画，进入读新状态。 | `cost-page.js:463–513、648–658`；render-performance套件 |
| F40 | first-visible区块只入场一次，full/reduced/off、浅深色、800px窄窗与缩放、长名/多Agent/微小金额、无溢出/遮挡；observer/RAF/数字/drag卸载清理。 | `cost-page.js:655–658`；cost-donut/bars/hero onRemove；逐断言映射 |

## 2. 数据与语义

| 输入/动作/计算 | 来源 | 迁移保留规则 |
|---|---|---|
| 全部daily rows、today、coverageStart、recorded、subscription及公用formatter/nav | usageData（preview.js:862–864），cost-page.js:11–15 | 不读用量React DOM，不用M7当前filter结果；费用分析自己的范围，项目预算另有自己的scope；API等价是估算。 |
| table/sort/fold/points、composition/months/subscriptions/coverage/cache | src/m1/cost-table.js、cost-insights.js现有UMD；insightsMath.efficiency/costDestination | 共享main导出和renderer同函数；未知null/上下界/partial/记录缺失不造0；不把reasoning再加output。已有unit tests留用，提取页面新增纯投影至UMD并测。 |
| month/current projection | costInsights.months，cost-page.js:162–179、251–267 | 7个有用量日门槛、calendar月与上月同期、coverage约束不改；所有lower/upper/至多文字精度保留。图用几何0不等文字/业务0，见Q6。 |
| 值显示 | cost-page money/rate/pct/covered/amount、insights-ui money/budgetMoney | <半分仍<$0.01、极小单位/比例保数量级；coverage不足100不可显示100；未报告、未计入、未定价、没有记录各自含义，旧“—”如何Value映射见Q6。 |
| 显式月费 | usageBridge.setSubscription；currentFees/data.subscriptions | 原设置路径/验证/四舍五入规则，空移除，失败恢复，不触碰provider额度或外部账号。保存后usage-data-change清内存fees重读。 |
| 额度摘要 | quotaUi.state/providerQuotaUi.codex/state及quota-change | memory-only，不发真实请求；不跨账号/pool相加；首账号摘要/时效不完整见Q6，不通过UI迁移擅扩adapter。 |
| 费用CSV | usageBridge.exportCost | 保by/from/to/previousFrom/previousTo/cancel/error/busy；CSV由main重建、字段清洗和公式注入保护现测试保留；筛选不一致需裁决。 |
| 项目/预算/事项 | usageBridge.workbench/attention、saveWorkbench、exportProjects/onUpdate | 只四个已保存应用文件的批准投影；未知成本和scope-missing诚实；预算/知悉显式写，查询不采集、不扫描用户配置、不控制Agent。 |
| UI偏好/草稿 | agentusage.cost.v1；state、folds与insights-ui state | by/sort/calendar/heroSlide按原key兼容；rail虽写入但启动仍收起；其它筛选/隐藏/展开为会话state，不擅改持久化。budget dirty与异步版本保留。 |

## 3. DOM 与全局耦合

| 编号 | 当前耦合/引用 | 实施期处理 |
|---|---|---|
| C1 | #cost/#costAnalysis/#costProjects和动态#costDetailDialog/#costDetailTitle/#costCacheList等；cost-*.js根事件委托和data-cost-*/chart-/donut-/bars-/hero-*；insights-ui还更新M4/M5节点。 | 页内DOM/事件归ui/src/pages/cost/，legacy提供window.costHost、页面window.costUi，照M3结构；不留旧隐藏业务DOM，不把整个insights-ui删掉误伤M4/M5。详见附录反向ID候选表。 |
| C2 | 费用消费M7 usageData/usage-data-change、M3 uiPricingEditor.model/open/explain和pricing-change、M6 quotaUi.openSource/providerQuotaUi与quota-change。 | 维持原方法/数据/事件；M7接口若已迁再复核，不另建第二store/监听器。M3价格sheet换层先关当前详情再开，错误可回退。 |
| C3 | window.costPage.render/state由legacy页面与cost UI suites调用；costHero/costBars/costDonut/costStack/costCharts是现有组件全局，costChart是纯UMD。 | 兼容公开state读或按裁决迁新page Ui；不能制造fake全局骗旧测试。纯模块保UMD，图表API按Claude组件合同，旧组件确认无消费者再退役。 |
| C4 | sourceCostInsights.capability被sources-ui.js:164、192调用；insights-ui attentionItems/notice/ack/openBudget、sourceRows toggle与M5notice共用state.general/version/busy。 | M4–M5已迁时使用其Host/Ui接缝；预算数据/知悉保持唯一所有者，不能各页重复workbench读取/异步覆盖。退休前按当时源码核所有引用。 |
| C5 | ui-carousel由cost-hero及M6 quota-hero共用数字/gesture。计划要求M8删除；uiMorph.onRemove与uiMotion.follow/tooltip由图表依赖，剩余M9还在用detail/interactions/motion。 | M6和M8均迁且全局rg无消费者才删ui-carousel及script引用；若M6局部保留旧carousel按§9.4记录阻塞，不能强删或复制一份绕门槛。M9共享helpers不能整文件删。 |
| C6 | 新旧图表states/WeakMap、ResizeObserver、IntersectionObserver、abort与RAF；cost-page监听render和edgePosition；离页close native detail。 | React订阅/清理明确一份；图/tooltip/gesture所有者为裁决的共享组件，unmount终止一切且不用过期nodes。保刷新hover、cancel、inert、same-sequence reprice及静止文本清晰的原验收目的。 |
| C7 | 费用之外的data-open-cost点击由document委托转页；M3 settings定价与M7 Hero都有入口。 | 继续由原导航Host对接新页，不要求旧脚本查新内部DOM；M9迁移前公开入口保留。 |

## 4. kit 映射与图表现状

| 功能编号 | 已有kit直接映射 | 缺项/需裁决部分 |
|---|---|---|
| F1–5 | PageHeader、SubTabs/Segmented、IconButton、CheckboxGroup、AgentMark、Badge、Disclosure、Button | 两套独立状态不合并；日期范围calendar和边缘侧栏交互缺组件，Q2。Agent筛选如何组合既有kit与完整title见Q3。 |
| F6–10 | Figure/Value、Badge、Button/IconButton、CarouselDots、SectionHeader、Card、EmptyState | 图/构成条/首屏翻页拖动、高度/inert接缝Q1/Q3；不能用CarouselDots替掉全部手势行为。 |
| F11–19 | Segmented、SectionHeader、Button/IconButton、Value、EmptyState、ScrollArea | 走势/环/月柱/两栏伸缩与hover/keyboard读数共享组件Q1/Q3。 |
| F20–22 | ListRow、AgentMark、Value、TextField(inputMode decimal/maxLength9)、Banner、Button | TextField缺onBlur/onKeyDown/autocomplete；必须保change/Enter/空移除，Q4。订阅对照bar与月费marker不是Meter.done，Q1。 |
| F23–24 | SectionHeader、Badge、Disclosure、Button、Value、ListRow、ScrollArea、EmptyState | coverage可用既有Meter done/warn/muted呈相同数义，但原环/步骤的结构由Q1裁决；缓存命中图不等计价Meter。 |
| F25–32 | DataTable(rowKey/title/headerTitle)、Button、SearchField、Sheet、ScrollArea、Value、Figure、AgentMark、Toast | 原table嵌微图、其它汇总行、整行焦点、left drawer/drag/固定footer需要Q3/Q5明确结构；不重问已确定的DataTable/Sheet通用API。 |
| F33–38 | SubTabs/Select、Form、TextField(decimal/maxLength24)、Button、Value/Badge/Banner、Disclosure、ListRow、ScrollArea、Toast | 未知/预算label、共享事项/dirty草稿与focusKey以Host state提供；onBlur不是预算保存触发。M4/shared接口接缝Q7。 |
| F39–40 | 既有kit数字data档/主题；页面使用foundation mount | 无新视觉方案；图表生命周期所有权和共享阻塞按Q1/Q7；不把有意义性能/隐私断言退役。 |

| 图/结构 | 现有尺寸、数据、颜色 | 原动效、hover/键盘、空/未知/partial（不定义接口） |
|---|---|---|
| A金额/构成条/微图 | Agent已计价份额用series-*；14日spark96×36、两柱44×36、小环36×36/r13（cost-hero.js:19–30）；日均/每百万/缓存使用原UMD。 | 指向/聚焦换大数字再恢复；未计价斜线只说明；首入bar700ms+80/60stagger，数字uiCarousel.roll，非动画最终aria值。 |
| C仪表/日柱 | gauge240×132、r96/cx120/cy116、线16；max(投影上界,当前上界,.01)*1.08；已计价柱8–64px、未计价20、无记录4、未来frame；series-codex仅此仪表原色（cost-hero.js:34–42、cost.css:780–785）。 | enter gauge1100ms、日柱600ms+16stagger；未来disabled，hover/focus区分没有记录/未计入，未知不滚成业务0。 |
| 走势stack/line | 宿主内容宽≥320；高272，top34/bottom240/dateY262，4行+顶线，最多6日期，窄<560左右46/14否则52/20（cost-page.js:89–96）；series-*深浅palette tokens.css:62–64、246–248，非good/bad。 | monotone，niceStep*4；gap虚线桥和渐变不补点、partial2×5轴下标；原550msmorph；readout在图上/小tip在顶部，F12–14全部交互；无已计价独立空态。 |
| 花在哪圆/半环 | 几何D240、T16、active20、gap3.5计圆头；显示size208，窄168；Agent用series-*、类型用input/output/read/write；legacy轨道fill（cost-donut.js:9–33；tokens.css:211–212；cost.css:585–611、674）。 | 每段1000ms/90stagger，重排700ms、center800ms、160ms读数滑入；高度跟踪最低弧防clip；legendtoggle保至少1，hover不压其它，focus同读数；null只legend，0与null区分。 |
| 按月group/stack | 宿主≥240×160，默认min-height150，2panebody408；top10/bottom26/right4/left按tick长度，4row顶线；stack宽clamp4–52、group3–30/gap3、顶部radius≤6、stack间隔1.5（cost-bars.js:50–91；tokens.css:135、211）。 | 原enter800ms+月40/Agent25、update500；同path从当前d转；range斜纹/forecast虚框，仅stack且未hide全部series时；hoverband跟随、上方读数、键盘/月筛选；未知不造柱。 |
| 明细微图/日Token | rowspark108×32、30点、单点2.5；detail≤90点，folded frame高176/top26/bottom146，内容宽实测；旧reference446×218含heading53、compact280×120，color#07836b/深#63c5ae（cost-chart-ui.js:11–28；cost-page.js:84–96、408、426；tokens.css:174–186、259–262）。 | 单调Hermite不越界，null断曲线、0画真实0，tinyaxis科学计数；pointer/focus读原点、arrows/Home/End、Escape关闭bare详情；缺数据文字非零曲线。 |
| 订阅/覆盖/cache条 | 本行upper/fee同尺度，实色下界/斜纹上界/fee竖线（cost-page.js:303–315）；coverage112×112/r46；cache命中%，原warn/done文字；详情构成份额按upper。 | 原enter/follow由uiMotion；所有条有文字/aria，费率缺失/来源不全不变0；无图形API时不自行新增进度条或换颜色含义。 |

消息仍调用原usageData.toast，M9前不新增Toast宿主。

## 5. 按规范统一后的外观差异

控件36px、圆角8/12/16、六角色/figure/tabular-nums、统一spacing；原native select/checkbox/details/表单换已有kit；通知/空态/unknown换Banner/EmptyState/Value但词义待Q6。原left drawer的22px角/420ms、自写SVG/CSS/WAAPI计时与页面inline style不能搬进新页面；Sheet slow/exit、disclosure moderate、数据图统一data档。原左侧方向/拖关/六指标tiles/预算布局、图例24/36px密度、旧图形radius/字号/颜色的规范例外由Claude定。保图内原hover数据与focus等价，没有新增hover卡/scale/lift；未知/partial靠文字而非颜色。

## 6. 测试映射

(i)基础路由、主题/无错误、空错态、窄窗无溢出/焦点；(ii)共享UMD和新投影单元测试；(iii)新cost冒烟/页面回归及跨页合同；(iv)规范必然替换的旧实现细节，须在实施记录中给替代证据，待裁决不实际退役。逐条附表保留计划八套assert及多页片段。旧private API/DOM/class/geometry定位更新，不删断言所证明的数据、键盘、安全/隐私和成本精度目的。

(ii)保留cost-table/cost-insights/insightsMath/costChart现有单测；新增纯UMD覆盖range/previousWindow/coverage夹边、monthBefore/year界、partial/formatters、Agent/类型composition、trend日期桶/累计/hidden/缺桶、monthseries/null/0、heroModel/forecast gates、subscription validation/清空/round/异步fail、CSV输入边界。图的niceStep/geometry/runs/arc/layout/lowest/barPath/spark按Claude指定模块抽取配边界测试；不在TS另抄一份公式，不用单测取代真实focus/布局回归。

| 特别项目 | 测试迁移处理 |
|---|---|
| **已知失败：cost-ui-test.js:106–107** | 计划§5和M3记录已注明main环中心hover读数不稳定；本轮未复跑。保留(iii)“指向正确Agent/类型更新中心、离开恢复总数”及刷新仍读最新值；改新图表定位/settle，保动画中间值检查，不删、不忽略、不把timeout加长当修复。Q8需裁决可重复验收方法。 |
| **已知失败：范围栏点击** | M3记录三次一次通过、两次失败的历史证据包括范围入口；本轮不称新回归。cost-composition:37–42和cost-ui范围流程保持(iii)：可见可点、开/关/Escape、回焦、共享范围；新结构按Q2裁决，不绕过入口直接改state代替点击。 |
| **旧抽屉定值：cost-ui:162–164** | 拟(iv)退役420ms/独立cubic/22px断言，原因是规范要求Sheet slow/exit及8/12/16；新smoke验证统一token/动效终态和close返回focus，原左侧/手势/固定footer用途仍(iii)待Q5决定。其它精确金额与上下界不能随之退役。 |
| renderer-lifecycle:37–75 | 保留命名check全项：hover刷新读最新金额、IME不切页、pointercancel回原slide、quota节点和hover读数保留、30轮mount/remove observer为0；M6片段保留共用一次运行，不整套删。private uiMorph/global shape可替换，生命周期目的不变。 |
| render-performance | 费用环读数≥3中间值；已计价0显示$0.00且same sequence/revision增长；notification burst预算/ledger字节、静止普通文本/retarget和共享M6性能不倒退。未来uiCarousel删除后以Figure/新组件语义验证，不留旧fake对象。 |
| workbench/budget-overview | 全局预算不缩小、独立general/budget omitted计数、当前scope知悉/恢复、重估fingerprint失效、丢项目/同名/未知价格/没有数据/明确0、6位阈值、dirty草稿/失败保留、项目CSV无路径/原ID全保留。M4/M5相关段仍联合执行。 |
| cost-rebuild旧reference几何/颜色 | 446×218/旧绿色/SVG类名是现状，按Q1定新图表后替换定位/规范尺寸检查；原points值、微小非零、缺口/0/unknown、终点/tooltip/focus与空态检查仍(iii)。不先行称整套退役。 |

所有UI测试使用隔离HOME/usage/quota和synthetic fixtures；不读真实usage、auth或账号、不开始真实登录/刷新。迁移smoke基于模板并沿用settings-ui-helpers.js式wait/isolation，不另造并行框架。下面原assert表达式是静态抄录，不是本轮测试通过证据。

<!-- ASSERTIONS:M8 -->

### 6.1 最少套件：逐断言位置与目标

同一行多个调用分别编号；同一调用位于循环时保留全部fixture/参数，不把多个case缩成一次。表达式是静态源码抄录，不代表本轮执行成功。

#### scripts/m1/cost-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 51 #1 | (iii) | `` assert.equal(await page.evaluate(() => document.getElementById('main').dataset.currentView), 'cost') `` |
| 52 #1 | (iii) | `` assert.equal(await page.locator('#windowPage').textContent().catch(() => '费用'), '费用') `` |
| 55 #1 | (iii) | `` assert.equal(await page.locator('[data-cost-by="model"]').getAttribute('aria-pressed'), 'true') `` |
| 56 #1 | (iii) | `` assert.equal(await page.locator('#costRangeLabel').textContent(), '累计') `` |
| 57 #1 | (iii) | `` assert.equal(await page.locator('#costTable .cost-head.no-compare').count(), 1, 'no comparison over 累计') `` |
| 58 #1 | (iii) | `` assert.deepEqual(await names(page), ['gpt-6.1-sol', 'synthetic-unpriced', 'claude-sonnet-5-5', 'synthetic-a', 'synthetic-b', 'synthetic-c', '其他 2 个模型']) `` |
| 60 #1 | (iii) | `` assert.match(await row('synthetic-unpriced').locator('.cost-amount').textContent(), /^未计入没有价格$/, 'unpriced reads 未计入, not $0') `` |
| 61 #1 | (iii) | `` assert.match(await row('claude-sonnet-5-5').locator('.cost-amount small').textContent(), /^已计入 80\.0%$/) `` |
| 64 #1 | (iii) | `` assert.match(await page.locator('#costDetailDialog .cost-gaps').textContent(), /来源没有单独报告推理 Token/) `` |
| 65 #1 | (iii) | `` assert.equal(await page.locator('#costDetailDialog [data-cost-sources]').count(), 1) `` |
| 66 #1 | (iii) | `` assert.match(await page.locator('#costDetailDialog .cost-fields').textContent(), /缓存读取.*（部分未报告）/, 'a field some days lack is marked, not summed as complete') `` |
| 71 #1 | (iii) | `` assert.match(await page.locator('#costDetailDialog .cost-fields').textContent(), /估算区间(缓存写入未报告\|上下文长度未报告\|推理数量未报告\|按时段计价)/) `` |
| 72 #1 | (iii) | `` assert.equal(await page.locator('#costTable .cost-list > li.is-open').count(), 1, 'one row open at a time') `` |
| 76 #1 | (iii) | `` assert.equal((await names(page)).length, 8) `` |
| 76 #2 | (iii) | `` assert.equal(await page.locator('[data-cost-collapse]').count(), 1) `` |
| 77 #1 | (iii) | `` assert.equal((await names(page)).length, 7) `` |
| 80 #1 | (iii) | `` assert.ok(['gpt-6.1-sol', 'claude-sonnet-5-5'].includes(byCost[0])) `` |
| 80 #2 | (iii) | `` assert.equal(byCost.at(-1), '其他 2 个模型') `` |
| 86 #1 | (iii) | `` assert.equal(await dialog(page).count(), 1, 'price editor opens from the cost page') `` |
| 87 #1 | (iii) | `` assert.equal(await dialog(page).getByRole('heading').first().textContent(), 'synthetic-unpriced') `` |
| 88 #1 | (iii) | `` assert.equal(await page.locator('#costDetailDialog').evaluate(d => d.open), false, 'the cost detail steps aside for the sheet') `` |
| 92 #1 | (iii) | `` assert.equal(await page.locator('#costTable .cost-head.no-compare').count(), 0) `` |
| 93 #1 | (iii) | `` assert.equal(await page.locator('#periods [data-period="all"]').getAttribute('aria-pressed'), 'true', 'usage range unchanged') `` |
| 97 #1 | (iii) | `` assert.match(await page.locator('#costComposition .cost-donut-svg').getAttribute('aria-label'), /^已计价 \$/) `` |
| 98 #1 | (iii) | `` assert.equal(await page.locator('#costComposition .cost-donut-row').count(), 3, 'one legend row per Agent, priced or not') `` |
| 106 #1 | (iii) | `` assert.notEqual(await center(), whole, 'pointing at a row names it in the centre') `` |
| 107 #1 | (iii) | `` assert.equal(await center(), whole, 'leaving restores the total') `` |
| 109 #1 | (iii) | `` assert.deepEqual((await page.locator('#costComposition .cost-donut-row > span').allTextContents()).slice(0, 4), ['输入', '输出', '缓存读取', '缓存写入']) `` |
| 114 #1 | (iii) | `` assert.equal(await page.locator('#costMonths [data-cost-month]').last().getAttribute('data-cost-month'), current) `` |
| 115 #1 | (iii) | `` assert.match(await page.locator('#costMonths [data-cost-month="' + current + '"]').getAttribute('aria-label'), /推算整月 \$/, 'the current month is projected from its days with usage') `` |
| 117 #1 | (iii) | `` assert.equal(await page.locator('#costMonthChip').getAttribute('hidden'), null) `` |
| 118 #1 | (iii) | `` assert.equal(await page.locator('[data-cost-period][aria-pressed="true"]').count(), 0, 'a month replaces the preset') `` |
| 122 #1 | (iii) | `` assert.equal(await page.locator('#costSubs').evaluate(e => getComputedStyle(e).boxShadow), 'none', 'B cards have no enclosing card edge from the general cost-block rule') `` |
| 128 #1 | (iii) | `` assert.equal(await codexFee.inputValue(), '20', 'an invalid fee is not kept') `` |
| 130 #1 | (iii) | `` assert.equal(await page.locator('#costRangeLabel').textContent(), '累计') `` |
| 132 #1 | (iii) | `` assert.match(await page.locator('#costCoverage').textContent(), /没有价格/) `` |
| 133 #1 | (iii) | `` assert.equal(await page.locator('#costCoverage [data-cost-price]').count() > 0, true) `` |
| 134 #1 | (iii) | `` assert.match(await page.locator('#costCache').textContent(), /约省下/) `` |
| 138 #1 | (iii) | `` assert.deepEqual(await names(page), ['Codex', 'Claude Code', 'OpenCode']) `` |
| 141 #1 | (iii) | `` assert.equal(kept, true, 'rows are morphed, not rebuilt') `` |
| 147 #1 | (iii) | `` assert.ok(csv.startsWith(' 范围,分组,名称,')) `` |
| 147 #2 | (iii) | `` assert.equal(lines.length, 4, 'header and three Agents') `` |
| 148 #1 | (iii) | `` assert.match(lines[1], /,Agent,Codex,,/) `` |
| 148 #2 | (iii) | `` assert.match(csv, /价格目录中没有此模型/) `` |
| 154 #1 | (iii) | `` assert(cache.height <= cache.max && cache.scroll > cache.height, 'all cache rows remain in a bounded scroll region') `` |
| 156 #1 | (iii) | `` assert(await page.locator('#costCacheList').evaluate(e => e.scrollTop > 0), 'keyboard can scroll the full cache list') `` |
| 159 #1 | (iii) | `` assert(await page.locator('#costDetailDialog').evaluate(e => e.getBoundingClientRect().left < 24), 'drawer enters from the left') `` |
| 162 #1 | (iv)拟退役旧timing/radius；见Q5 | `` assert(drawerMotion.duration.startsWith('0.42s'), 'A drawer keeps its 420ms slide') `` |
| 163 #1 | (iv)拟退役旧timing/radius；见Q5 | `` assert(drawerMotion.easing.startsWith('cubic-bezier(0.32, 0.72, 0, 1)'), 'A drawer keeps its easing') `` |
| 164 #1 | (iv)拟退役旧timing/radius；见Q5 | `` assert.equal(drawerMotion.radius, '22px') `` |
| 165 #1 | (iii) | `` assert.equal(await page.locator('.cost-sheet-head').evaluate(e => getComputedStyle(e).padding), '0px', 'sheet uses A container padding once, without the price editor header padding') `` |
| 166 #1 | (iii) | `` assert(await page.evaluate(() => !!document.activeElement.closest('#costDetailDialog')), 'native modal contains keyboard focus') `` |
| 169 #1 | (iii) | `` assert.equal(await page.locator('#costDetailDialog').evaluate(e => e.open), false, 'Escape from the bare detail chart closes its drawer without a missing-toggle error') `` |
| 170 #1 | (iii) | `` assert(await row('gpt-6.1-sol').locator('.cost-row').evaluate(e => e === document.activeElement), 'closing returns focus to the row') `` |
| 181 #1 | (iii) | `` assert.equal(await page.locator('#costDetailDialog').evaluate(e => getComputedStyle(e).transform), 'none', mode + ' has no automatic drawer movement') `` |
| 191 #1 | (iii) | `` assert.equal(geometry.overflow, false) `` |
| 191 #2 | (iii) | `` assert.equal(geometry.subscriptionClipped, false) `` |
| 191 #3 | (iii) | `` assert.equal(geometry.coverageClipped, false) `` |
| 193 #1 | (iii) | `` assert.equal(geometry.rail, 'fixed', 'the hover-revealed range overlay keeps the full page width at every viewport') `` |
| 207 #1 | (i) | `` assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no horizontal overflow') `` |
| 208 #1 | (i) | `` assert.deepEqual(errors, []) `` |

#### scripts/m1/cost-layout-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 28 #1 | (iii) | `` assert(await ranged.count(),'synthetic ledger includes an estimated range') `` |
| 30 #1 | (iii) | `` assert(!after.includes('NaN'),'static ranges cannot enter usage-only counter animation') `` |
| 30 #2 | (iii) | `` assert.equal(after,before,'hover preserves both exact bounds and separator') `` |
| 44 #1 | (iii) | `` assert(geometry.order.every((y,i)=>!i\|\|y>geometry.order[i-1]),'estimate, trend, composition, subscriptions, detail') `` |
| 44 #2 | (iii) | `` assert(geometry.months>=geometry.wherePanel-1&&geometry.months<geometry.order[3],'the months sit beside or below where-it-went, above details, allowing the composition tab header') `` |
| 44 #3 | (iii) | `` assert.equal(geometry.clipped,0,'where-it-went rows stay inside the card') `` |
| 44 #4 | (iii) | `` assert(geometry.headLines<=1,'table headings stay on one line') `` |
| 44 #5 | (iii) | `` assert(geometry.columns.every(c=>c.visible),'desktop keeps every table column') `` |
| 44 #6 | (iii) | `` assert(b.x>=a.right,'checks stay side by side') `` |
| 44 #7 | (iii) | `` assert(Math.abs(a.y-b.y)<2,'paired card tops align') `` |
| 44 #8 | (iii) | `` assert.equal(geometry.overflow,false) `` |
| 54 #1 | (iii) | `` assert(await trend.locator('[data-chart="trend"]').isVisible()) `` |
| 54 #2 | (iii) | `` assert(await trend.locator('[data-chart="trend"] .cost-stack-svg').evaluate(svg=>{const top=Number(svg.viewBox.baseVal.y);return [...svg.querySelectorAll('.cost-stack-line')].every(p=>p.getBBox().y>=top);}),'the stacked bands stay inside the plot') `` |
| 54 #3 | (iii) | `` assert(await trend.evaluate(e=>e.querySelector('.cost-trend-legend').getBoundingClientRect().bottom<=e.querySelector('.cost-trend-plot').getBoundingClientRect().top+1),'the readout and legend sit above the plot instead of covering it') `` |
| 55 #1 | (i) | `` assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)) `` |
| 56 #1 | (iii) | `` assert(!await page.locator('#cost').innerText().then(t=>t.includes('NaN'))) `` |
| 56 #2 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),facts) `` |
| 58 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/cost-compact-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 24 #1 | (iii) | `` assert.equal(await page.locator('#costTrend [data-series-value]').evaluateAll(ns=>ns.filter(n=>n.textContent!=='—').length),10,'all ten Agents used today have a figure in the readout') `` |
| 26 #1 | (iii) | `` assert.deepEqual(clippedTip,[],'folded chart does not clip its tall ten-Agent readout') `` |
| 35 #1 | (iii) | `` assert.equal(geometry.threeColumns,false,'A drawer stacks its sections') `` |
| 35 #2 | (iii) | `` assert(geometry.scrolling.every(name=>name.includes('cost-users')),'only long user/model lists have an inner scroll region') `` |
| 35 #3 | (iii) | `` assert.equal(geometry.metrics,6,'six figures as tiles; the change against the earlier period is a chip beside the amount') `` |
| 35 #4 | (iii) | `` assert(geometry.chartWidth,'trend spans the detail') `` |
| 35 #5 | (iii) | `` assert(geometry.points>=1) `` |
| 35 #6 | (iii) | `` assert(geometry.labelFont>=10.9,'chart labels keep readable size') `` |
| 35 #7 | (iii) | `` assert(geometry.axisLabelsInside,'axis values cannot clip their first digits') `` |
| 35 #8 | (iii) | `` assert.equal(geometry.overflow,false) `` |
| 36 #1 | (iii) | `` assert.equal(await detail.locator('.cost-users li').count(),25,'every model is listed') `` |
| 36 #2 | (iii) | `` assert(await detail.locator('.cost-users').evaluate(e=>e.scrollTop>0),'keyboard reaches the end of the bounded model list') `` |
| 37 #1 | (iii) | `` assert.equal(await detail.locator('.cost-fields li').count(),4) `` |
| 37 #2 | (iii) | `` assert.equal(await detail.locator('.cost-rates div').count(),4) `` |
| 37 #3 | (iii) | `` assert.equal(await detail.locator('.cost-detail-foot button').count(),2) `` |
| 37 #4 | (iii) | `` assert.equal(await detail.locator('.cost-users li').count(),10,'every user is listed') `` |
| 37 #5 | (iii) | `` assert.equal(await detail.locator('.cost-detail-title').getAttribute('title'),longModel,'the full long title is available') `` |
| 38 #1 | (iii) | `` assert((await detail.locator('[data-chart="detail"] output').textContent()).includes(await point.getAttribute('data-chart-date'))) `` |
| 41 #1 | (iii) | `` assert(await detail.evaluate(e=>{const [a,b]=[...e.querySelectorAll(':scope > section')].map(x=>x.getBoundingClientRect());return b.top>=a.bottom-1;}),'narrow details stack their sections') `` |
| 41 #2 | (i) | `` assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)) `` |
| 41 #3 | (iii) | `` assert(await detail.locator('[data-chart="detail"]').isVisible()) `` |
| 41 #4 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),facts) `` |
| 41 #5 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/cost-composition-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 12 #1 | (iii) | `` assert(pair,'the chart has a real gap to cross: '+selector) `` |
| 19 #1 | (iii) | `` assert(trace.every(row=>Number(row.opacity)===1),'crossing cell gaps must never pulse other cells: '+selector+' '+JSON.stringify(trace)) `` |
| 37 #1 | (iii) | `` assert.equal(await page.locator('#costRailToggle').getAttribute('aria-expanded'),'false') `` |
| 38 #1 | (iii) | `` assert.equal(await page.locator('#costRailToggle').evaluate(e=>getComputedStyle(e).opacity),'1') `` |
| 39 #1 | (iii) | `` assert(await page.locator('#costRail').isVisible()) `` |
| 40 #1 | (iii) | `` assert.deepEqual(await page.locator('#costPeriods [data-cost-period]').allTextContents(),['累计','30 天','7 天','今日']) `` |
| 41 #1 | (iii) | `` assert.equal(await page.locator('#costRailToggle').getAttribute('aria-expanded'),'false') `` |
| 42 #1 | (iii) | `` assert.equal(await page.locator('#costRailToggle').getAttribute('aria-expanded'),'false','a second click closes the range') `` |
| 45 #1 | (iii) | `` assert(await page.locator('.cost-donut-figure').evaluate(e=>e.getBoundingClientRect().width>=160),'many Agents cannot shrink the ring') `` |
| 47 #1 | (iii) | `` assert(legend.inside&&legend.rows>=6,'every Agent has a legend row inside the panel '+JSON.stringify(legend)) `` |
| 47 #2 | (iii) | `` assert.equal(legend.clipped,0,'Agent names are not cut off in the legend') `` |
| 48 #1 | (iii) | `` assert.equal(await page.locator('.cost-donut').getAttribute('data-shape'),'semi') `` |
| 49 #1 | (iii) | `` assert(await page.locator('.cost-donut-figure').evaluate(e=>{const r=e.getBoundingClientRect();const ratio=r.width/r.height;return ratio>1.7&&ratio<2.1;}),'the half ring frame is about twice as wide as tall, fitted to the drawn arcs') `` |
| 50 #1 | (iii) | `` assert(await page.locator('.cost-donut-arc').evaluateAll(ns=>ns.every(n=>Number(getComputedStyle(n).opacity)===1))) `` |
| 52 #1 | (iii) | `` assert.notEqual(grouped[0],grouped[1]) `` |
| 53 #1 | (iii) | `` assert.equal(stacked[0],stacked[1]) `` |
| 55 #1 | (iii) | `` assert.match(await page.locator('#costMonths .cost-bars-when').textContent(),new RegExp(Number(firstMonth.slice(5))+' 月'),'pointing at a month reads it out above the bars, not in a covering card') `` |
| 55 #2 | (iii) | `` assert(await page.locator('.cost-month-col').evaluateAll(ns=>ns.every(n=>Number(getComputedStyle(n).opacity)===1))) `` |
| 56 #1 | (iii) | `` assert(await page.locator('#costMonthPanel .cost-panel-body').evaluate(e=>e.inert)) `` |
| 57 #1 | (iii) | `` assert(await page.locator('#costWherePanel .cost-panel-body').evaluate(e=>e.inert)) `` |
| 59 #1 | (iii) | `` assert.equal(await page.locator('#costAgentSummary').textContent(),'Claude Code') `` |
| 60 #1 | (iii) | `` assert(await page.locator('.cost-stack-area').evaluateAll(ns=>ns.every(n=>n.getAttribute('opacity')==='0'))) `` |
| 61 #1 | (iii) | `` assert.equal(await page.locator('[data-cost-trend="daily"]').textContent(),'每周') `` |
| 61 #2 | (iii) | `` assert.equal(await page.locator('[data-cost-trend="daily"]').textContent(),'每月') `` |
| 61 #3 | (iii) | `` assert(await page.locator('.cost-chart-date').count()<=6) `` |
| 61 #4 | (iii) | `` assert.equal(await page.locator('.cost-stack-tip').textContent(),pinned) `` |
| 61 #5 | (iii) | `` assert(await page.locator('.cost-stack-tip').isHidden()) `` |
| 62 #1 | (iii) | `` assert(selected&&selected.from<selected.to,'drag selects the whole range instead of immediately drilling one day') `` |
| 63 #1 | (iii) | `` assert(await page.evaluate(()=>window.costPage.state().custom.from!==window.costPage.state().custom.to),'keyboard range selection spans both buckets') `` |
| 67 #1 | (iii) | `` assert.equal(await heroSelected(),'0') `` |
| 67 #2 | (iii) | `` assert(await page.locator('[data-cost-range="all"]').getAttribute('aria-pressed')==='true','the range buttons live on the first slide') `` |
| 68 #1 | (iii) | `` assert.equal(await heroSelected(),'1') `` |
| 69 #1 | (iii) | `` assert(await page.locator('.cost-hero-slide[data-slide="range"]').evaluate(e=>e.inert),'the hidden slide is out of the tab order') `` |
| 70 #1 | (iii) | `` assert(days.length>=28&&days.every(text=>!/\$0\.00$/.test(text)),'no day without records reads as $0') `` |
| 71 #1 | (iii) | `` assert.match(await page.locator('.cost-hero-slide[data-slide="month"] [data-hero-sub]').textContent(),/当天已计价/) `` |
| 72 #1 | (iii) | `` assert.equal(await heroSelected(),'0','arrow keys switch the slide') `` |
| 73 #1 | (iii) | `` assert.equal(await heroSelected(),'1','a drag turns the page') `` |
| 74 #1 | (iii) | `` assert.equal(await heroSelected(),'0') `` |
| 75 #1 | (iii) | `` assert.equal(await page.locator('#costPeriods [data-cost-period="30"]').getAttribute('aria-pressed'),'true','the first screen and the rail share one range') `` |
| 77 #1 | (i) | `` assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),theme+' '+width+' must not overflow') `` |
| 79 #1 | (iii) | `` assert.equal(await page.locator('.cost-donut-arc').first().evaluate(e=>e.getAnimations().filter(a=>a.playState==='running').length),0) `` |
| 79 #2 | (iii) | `` assert.match(await page.locator('#costWherePanel').evaluate(e=>getComputedStyle(e).transitionDuration),/^0s/) `` |
| 82 #1 | (iii) | `` assert.equal(await page.locator('#costTrend .cost-stack-line').count(),3,'missing per-Agent observations split the line instead of drawing a zero') `` |
| 83 #1 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),facts) `` |
| 83 #2 | (iii) | `` assert.equal(audit.enabled,false) `` |
| 83 #3 | (iii) | `` assert.equal(audit.audit.authenticationReads,0) `` |
| 83 #4 | (iii) | `` assert.equal(audit.audit.sourceWrites,0) `` |
| 83 #5 | (iii) | `` assert.equal(audit.audit.networkAttempts,0) `` |
| 83 #6 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/cost-rebuild-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 29 #1 | (iii) | `` assert.equal(await page.locator('.cost-rates dd').first().textContent(),'$30.00','per-million rate is displayed once') `` |
| 29 #2 | (iii) | `` assert((await page.locator('.cost-detail-title').textContent()).includes(model)) `` |
| 34 #1 | (iii) | `` assert.equal(geometry.overflow,false,suffix) `` |
| 34 #2 | (iii) | `` assert.deepEqual(geometry.overlap,[],suffix) `` |
| 34 #3 | (iii) | `` assert.deepEqual(geometry.clipped,[],suffix+' text stays within its cell') `` |
| 40 #1 | (iii) | `` assert.equal(await trend.locator('[data-chart="trend"] .cost-chart-grid line').count(),5) `` |
| 41 #1 | (iii) | `` assert(await trend.locator('.cost-trend-plot').evaluate(e=>e.getBoundingClientRect().height)>=240,'the trend is tall enough to read without opening') `` |
| 41 #2 | (iii) | `` assert(await trend.locator('[data-chart="trend"]').evaluate(e=>Math.abs(e.getBoundingClientRect().width-e.parentElement.getBoundingClientRect().width)<2),'drawn at the card width') `` |
| 42 #1 | (iii) | `` assert((await trend.locator('[data-chart="trend"] .cost-chart-date').count())<=6) `` |
| 42 #2 | (iii) | `` assert.equal(await page.locator('.cost-chart-panel').count(),0,'nothing floats over the page') `` |
| 43 #1 | (iii) | `` assert.equal(await page.locator('#costCache .cost-cache-list li').count(),18,'all cache models remain accessible') `` |
| 43 #2 | (iii) | `` assert.equal(await page.locator('#costMonths .cost-month-col').count(),14) `` |
| 43 #3 | (iii) | `` assert.equal(await page.locator('#costMonths .cost-month-col').count(),12) `` |
| 45 #1 | (iii) | `` assert.deepEqual(await reference.evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),{width:446,height:218}) `` |
| 45 #2 | (iii) | `` assert.equal(await reference.locator('.cost-chart-grid line').count(),4) `` |
| 45 #3 | (iii) | `` assert.equal(await reference.locator('.cost-chart-line').evaluate(e=>getComputedStyle(e).stroke),'rgb(7, 131, 107)') `` |
| 45 #4 | (iii) | `` assert.equal(await reference.locator('.cost-chart-value').textContent(),'$31.84') `` |
| 46 #1 | (iii) | `` assert((await reference.locator('output').textContent()).includes('$31.84'),'pointer reads the actual point') `` |
| 46 #2 | (iii) | `` assert((await reference.locator('output').textContent()).includes('2026-10-13')) `` |
| 46 #3 | (iii) | `` assert.equal(await reference.locator('.cost-chart-inspect').getAttribute('hidden'),null) `` |
| 46 #4 | (iii) | `` assert(await reference.locator('.cost-chart-toggle').evaluate(e=>e===document.activeElement)) `` |
| 47 #1 | (iii) | `` assert.equal(await sparse.locator('.cost-chart-line').count(),3,'unreported dates split the curve') `` |
| 47 #2 | (iii) | `` assert.equal(await sparse.locator('[data-chart-index="0"]').getAttribute('data-chart-value'),'$0.00') `` |
| 47 #3 | (iii) | `` assert.equal(await sparse.locator('[data-chart-index="1"]').getAttribute('data-chart-value'),'未报告') `` |
| 47 #4 | (iii) | `` assert((await sparse.locator('.cost-chart-grid text').allTextContents()).some(s=>s.includes('e-')),'tiny nonzero axis values stay nonzero') `` |
| 47 #5 | (iii) | `` assert.equal(await page.locator('[data-chart="empty"] .cost-chart-end').count(),0) `` |
| 47 #6 | (iii) | `` assert(await page.locator('.cost-chart-empty').isVisible()) `` |
| 48 #1 | (iii) | `` assert(await page.locator('.cost-detail').isVisible()) `` |
| 48 #2 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),facts) `` |
| 50 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/budget-overview-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 37 #1 | (i) | `` assert.equal(new URL(page.url()).protocol,'file:') `` |
| 37 #2 | (i) | `` assert((await page.title()).startsWith('Agent Usage')) `` |
| 38 #1 | (iii) | `` assert.equal(await page.locator('#main').getAttribute('data-current-view'),'cost') `` |
| 40 #1 | (iii) | `` assert.equal(await page.locator('#wbBudgets > details').count(),edge?5:3,'the global budget list must include unselected saved scopes') `` |
| 44 #1 | (iii) | `` assert.equal(json.budget.state,'observed-below') `` |
| 44 #2 | (iii) | `` assert.equal(json.issues.filter(i=>i.target==='workbench').length,0) `` |
| 45 #1 | (iii) | `` assert.match(await page.locator('#wbBudgetState').textContent(),/低于预算/) `` |
| 45 #2 | (iii) | `` assert.equal(await page.locator('[data-attention-notice="budget"]').isVisible(),false,'selected-budget hint stays scoped') `` |
| 47 #1 | (iii) | `` assert.equal(await page.locator('[data-attention-item="budget"]').count(),2) `` |
| 48 #1 | (iii) | `` assert.deepEqual(await page.locator('[data-attention-item="budget"]').evaluateAll(rows=>rows.map(row=>row.dataset.key).sort()),json.budgetOverview.issues.map(issue=>issue.id).sort()) `` |
| 52 #1 | (iii) | `` assert.equal(acknowledged[projectIssue.id],projectIssue.fingerprint) `` |
| 52 #2 | (iii) | `` assert.equal(acknowledged[allIssue.id],undefined) `` |
| 57 #1 | (iii) | `` assert.equal(await page.locator('#wbProject').inputValue(),projectB) `` |
| 57 #2 | (iii) | `` assert.equal(await page.locator('#wbBudgets > details').count(),3,'the global list does not shrink with the editor selection') `` |
| 60 #1 | (iii) | `` assert.equal(JSON.parse(fs.readFileSync(path.join(usage,'workbench.json'))).acknowledged[allIssue.id],allIssue.fingerprint) `` |
| 77 #1 | (iii) | `` assert.equal(await page.locator('[data-attention-item="budget"]').count(),0) `` |
| 80 #1 | (iii) | `` assert.equal(labels.filter(label=>label.includes('同名')).length,2) `` |
| 80 #2 | (iii) | `` assert(labels.some(label=>label.includes('项目 1'))&&labels.some(label=>label.includes('项目 2'))) `` |
| 81 #1 | (iii) | `` assert.equal(await page.locator('#wbBudgets [data-budget-state="unpriced"]').count(),1) `` |
| 81 #2 | (iii) | `` assert.equal(await page.locator('#wbBudgets [data-budget-state="no-data"]').count(),1) `` |
| 81 #3 | (iii) | `` assert.equal(await page.locator('#wbBudgets [data-budget-state="scope-missing"]').count(),1) `` |
| 87 #1 | (iii) | `` assert.equal(await page.locator('#wbProject').inputValue(),'all') `` |
| 91 #1 | (i) | `` assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true) `` |
| 93 #1 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),ledger) `` |
| 93 #2 | (i) | `` assert.deepEqual(errors,[]) `` |
| 94 #1 | (iii) | `` assert(!text.includes('synthetic-private')) `` |
| 94 #2 | (iii) | `` assert(!text.includes('RAW_PRIVATE')) `` |

#### scripts/m1/renderer-lifecycle-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 24 #1 | (iii) | `` assert(await page.locator('#costOverview [data-slide="month"]').evaluate(e => !e.inert)) `` |
| 75 #1 | (iii) | `` assert.deepEqual(checks.failures, []) `` |
| 76 #1 | (i) | `` assert.deepEqual(errors, []) `` |
| 76 #2 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), before) `` |
| 77 #1 | (i) | `` assert.match(await page.title(), /Agent Usage/) `` |
| 77 #2 | (i) | `` assert.match(page.url(), /desktop-reference.*index\.html/) `` |

#### scripts/m1/render-performance-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 61 #1 | (iii) | `` assert(glyphs.digits > 0 && glyphs.plain && !glyphs.moving && glyphs.transform === 'none', 'settled glyphs use normal text rendering at ' + zoom) `` |
| 74 #1 | (iii) | `` assert(Math.abs(rolling.y - rolling.expectedStart) < rolling.digitHeight * .75, 'a settled digit resumes from its previous value, not zero') `` |
| 85 #1 | (iii) | `` assert.equal(await page.locator('.cost-bars-chip[data-bars-series="codex"] b').textContent(), '$0.00', 'a priced zero is not an unpriced Agent') `` |
| 87 #1 | (iii) | `` assert.equal(afterPrice.sequence, free.sequence) `` |
| 87 #2 | (iii) | `` assert(afterPrice.revision > free.revision) `` |
| 91 #1 | (i) | `` assert.deepEqual(errors, []) `` |
| 91 #2 | (iii) | `` assert(report.ledgerUnchanged) `` |
| 92 #1 | (iii) | `` assert(switched.credit <= 2, 'wallet entry must not redraw geometry for every height frame: ' + switched.credit) `` |
| 93 #1 | (iii) | `` assert(burst.cards <= 1 && burst.hero <= 1 && burst.credit <= 1, 'unchanged notification burst cannot rebuild each page: ' + JSON.stringify(report.burst)) `` |
| 94 #1 | (iii) | `` assert.equal(idleTrack, 'none', 'settled card text must leave the transformed track') `` |
| 95 #1 | (iii) | `` assert(readout.length >= 3, 'donut readout must have intermediate values, not just a text swap') `` |
| 96 #1 | (iii) | `` assert(report.burst.p95Ms <= idle * 2 + 1 && report.burst.maxMs < 50, 'notification work must meet the measured idle frame budget') `` |

### 6.2 多页套件补充定位

这里只映射本页相关段及其跨页结果；循环/流程的其它页分支仍归其它页，不能据此整套退役。

#### scripts/m1/workbench-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 33 #1 | (iii) | `` assert.equal(await page.locator('[data-view="workbench"]').count(),0) `` |
| 33 #2 | (iii) | `` assert.equal(await page.locator('#workbench').count(),0) `` |
| 33 #3 | (iii) | `` assert.equal(await page.locator('#costProjects').isVisible(),true) `` |
| 33 #4 | (iii) | `` assert.equal(await page.locator('#costAnalysis').isVisible(),false) `` |
| 33 #5 | (iii) | `` assert.equal(await page.locator('#usage').isVisible(),false) `` |
| 34 #1 | (iii) | `` assert.equal(await page.locator('[data-cap-agent]').count(),11) `` |
| 34 #2 | (iii) | `` assert((await page.locator('#sourcesAttentionSection').innerText()).includes('来源暂不可读')) `` |
| 34 #3 | (iii) | `` assert(!(await page.locator('[data-attention-notice="cost"]').textContent()).includes('来源暂不可读')) `` |
| 36 #1 | (iii) | `` assert.equal(JSON.parse(fs.readFileSync(settingsFile)).budgets['all:monthly'],.001) `` |
| 36 #2 | (iii) | `` assert((await page.locator('#wbBudgetState').textContent()).includes('$0.001'),'a sub-cent budget keeps its exact user-entered threshold') `` |
| 38 #1 | (iii) | `` assert.equal(JSON.parse(fs.readFileSync(settingsFile)).budgets['all:monthly'],.001) `` |
| 45 #1 | (iii) | `` assert.deepEqual(fs.readFileSync(preserved),settingsBytes) `` |
| 45 #2 | (iii) | `` assert.equal(JSON.parse(fs.readFileSync(preserved)).budgets['all:daily'],.0001) `` |
| 45 #3 | (iii) | `` assert.equal(await page.locator('#wbLimit').inputValue(),'5') `` |
| 48 #1 | (iii) | `` assert.equal(await page.locator('#wbCost').textContent(),'<$0.01') `` |
| 51 #1 | (iii) | `` assert.match(await page.locator('[data-attention-notice="cost"]').innerText(),/费用核对事项/) `` |
| 51 #2 | (iii) | `` assert.deepEqual(fs.readFileSync(statistics),before) `` |
| 52 #1 | (iii) | `` assert.equal(await page.locator('#wbLimit').inputValue(),'123') `` |
| 53 #1 | (iii) | `` assert.equal(await page.locator('#wbLimit').inputValue(),'123') `` |
| 53 #2 | (iii) | `` assert(fs.existsSync(csv)) `` |
| 53 #3 | (iii) | `` assert(text.includes('alpha')) `` |
| 53 #4 | (iii) | `` assert(!text.includes('synthetic-private')) `` |
| 53 #5 | (iii) | `` assert(!text.includes('PRIVATE_RAW')) `` |
| 53 #6 | (iii) | `` assert(!text.includes(customRoot)) `` |
| 58 #1 | (i) | `` assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true) `` |
| 59 #1 | (i) | `` assert.deepEqual(errors,[]) `` |
| 59 #2 | (iii) | `` assert.equal(persisted.budget.limitUsd,5) `` |
| 59 #3 | (iii) | `` assert(Math.abs(persisted.total.lower-.00084)<1e-12) `` |
| 60 #1 | (iii) | `` assert.equal(await page.locator('#costAnalysis').isVisible(),true) `` |
| 60 #2 | (iii) | `` assert.equal(await page.locator('[data-view="workbench"]').count(),0) `` |
| 61 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/interaction-reliability-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 134 #1 | (iii) | `` assert.equal(await page.locator('#costPeriods button[tabindex="0"]').count(), 1, 'month selection retains a range-group Tab entry') `` |
| 136 #1 | (iii) | `` assert.equal(await page.locator('#costPeriods [data-cost-period="all"]').getAttribute('aria-pressed'), 'true') `` |
| 137 #1 | (iii) | `` assert(await page.locator('#costMonthChip').evaluate(element => element.hidden), 'range keyboard selection clears the month') `` |
| 138 #1 | (iii) | `` assert.equal(await page.locator('#costRailToggle').getAttribute('aria-expanded'), 'false') `` |
| 260 #1 | (iii) | `` assert(geometry.width <= geometry.viewport + 2, view + ' page has no horizontal overflow: ' + JSON.stringify(geometry)) `` |
| 277 #1 | (iii) | `` assert.equal(await page.locator('.cost-pair').first().evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').length), 1, 'cost pair responds to its own container width') `` |
| 278 #1 | (iii) | `` assert((await page.locator('#cost').innerText()).includes('未计入') \|\| (await page.locator('#cost').innerText()).includes('未定价')) `` |
| 279 #1 | (i) | `` assert.deepEqual(errors, []) `` |

#### scripts/m1/unpriced-guidance-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 27 #1 | (iii) | `` assert.equal(await sheet.count(),1,'the cost page opens the same model sheet') `` |
| 28 #1 | (iii) | `` assert((await writeHelp.innerText()).includes('只有确认不收费时')) `` |
| 28 #2 | (iii) | `` assert.equal(await write.count(),1,'the model stays listed') `` |
| 29 #1 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),facts) `` |
| 29 #2 | (iii) | `` assert.equal(new Store(usage,{}).records().find(r=>r.id==='b'.repeat(64)).cacheWrite,null) `` |
| 29 #3 | (iii) | `` assert.equal(await read.isVisible(),true) `` |
| 29 #4 | (iii) | `` assert.match(await read.textContent(),/未计入/,'the other read gap remains') `` |
| 30 #1 | (i) | `` assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)) `` |
| 31 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/style-alignment-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 21 #1 | (iii) | `` assert.deepEqual({font:parity.cost.font,size:parity.cost.size,color:parity.cost.color},{font:parity.usage.font,size:parity.usage.size,color:parity.usage.color},'the cost header control matches the usage control') `` |
| 22 #1 | (iii) | `` assert.deepEqual(common.costType,common.usageType,'section typography matches usage') `` |
| 22 #2 | (iii) | `` assert.deepEqual(common.costEdge,common.usageEdge,'card edges match usage') `` |
| 24 #1 | (iii) | `` assert(await page.locator('#wbSaveBudget').evaluate(e=>{const s=getComputedStyle(e),probe=document.createElement('span');probe.style.color='var(--text)';document.body.append(probe);const color=getComputedStyle(probe).color;probe.remove();return s.backgroundColor===color;}),'budget primary uses the common foreground token') `` |
| 24 #2 | (iii) | `` assert(await page.locator('#wbPeriod-trigger').evaluate(e=>e===document.activeElement)) `` |
| 29 #1 | (i) | `` assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),view+' has no horizontal overflow') `` |
| 29 #2 | (i) | `` assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'cost analysis has no horizontal overflow') `` |
| 30 #1 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),facts) `` |
| 31 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/visual-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 69 #1 | (iii) | `` assert.equal(await page.locator('[data-open-cost]').isVisible(), true) `` |
| 74 #1 | (iii) | `` assert.equal(await page.locator('#costDialog').count(), 0) `` |
| 90 #1 | (i) | `` assert.deepEqual(errors, []) `` |

#### scripts/m1/polish-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 83 #1 | (iii) | `` assert(overlap.heading>overlap.navigation+8,JSON.stringify(overlap)) `` |
| 84 #1 | (iii) | `` assert.equal(await page.evaluate(()=>window.uiDetail.activeCount),0) `` |
| 84 #2 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/functional-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 67 #1 | (iii) | `` assert.equal((await autoRow.textContent()).includes('未计入'),!autoMapped,'an unmapped route is marked as left out; the second scale pass reuses the first pass mapping') `` |
| 70 #1 | (iii) | `` assert.match(await mapping.textContent(),/openai\/gpt-6\.1-sol/) `` |
| 72 #1 | (iii) | `` assert(state.snapshot.daily.every(r=>r.pricedTokens===r.totalTokens),JSON.stringify(state.snapshot.daily.filter(r=>r.pricedTokens!==r.totalTokens).slice(0,2))) `` |
| 92 #1 | (i) | `` assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true) `` |
| 93 #1 | (i) | `` assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true) `` |
| 94 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

<!-- /ASSERTIONS:M8 -->

## 7. 待 Claude 裁决

| 编号 | 问题及出处 | 实施前所需裁决 |
|---|---|---|
| Q1 | M8图类型与交互见§4：hero构成/微图/gauge、stackline/brush/pin、donut、monthly bars、detail spark、coverage/cache/sub条均没有完整kit图形接口。 | 写共享组件接口/图层读数/keyboard/动画与颜色尺寸例外；复用已定M6/M7接口而非本页另选。缺项按§9.4分局部/共享阻塞，不能把旧DOM插进React避guard。 |
| Q2 | 范围侧栏不是既有Menu/Sheet等价；月份日历与M7范围日历实现不同（M8两点后才应用/只当前月方向移动），还有边缘hover入口和遮罩。 | 指定calendar/范围层组件和入口布局、focus/close优先级；共享还是保差异由Claude定，保独立范围/单月/preset和键盘可达，不能自己合并M7状态。 |
| Q3 | 新kit已有DataTable、ListRow、CarouselDots/Segmented等，但旧表一行是button，嵌微图可键盘查看；两栏伸缩/窄条、首屏拖动/动态高/inert没有组合接口。 | 指定布局/交互组件组合及事件所有者，给表内图/其它合计行的语义定位；不再问通用kit API，只补缺失能力，不能丢原详情/微图访问。 |
| Q4 | 月费原onChange(原生失焦change)/Enter保存、空清除、非法/失败恢复；TextField现有decimal/maxLength足够，但缺onBlur/onKeyDown/autocomplete。 | 给允许的kit扩展或复用现组件接缝；不能擅改即时每字保存/加新保存按钮/降校验。预算仍显式Form submit，保高精度与dirty。 |
| Q5 | 原详情是440px左抽屉、22px角/420ms，拖把手向左关闭、固定footer；既有Sheet没有side/drag接口，规范要求统一Sheet。 | 确定统一Sheet下的方向/尺寸/gesture/固定footer和六指标结构，批准162–164旧值退役及替代测试；数据/长列表/键盘/嵌M3层不变。 |
| Q6 | 现有疑点：heroModel cost-page.js:172将未知lower/upper几何化0；quotaSummary:284–292只取首账号且未带freshness/state；CSV:613只传分组/日期，未传Agent/gapsOnly/search/sort；订阅:305“回本”是估算判断；money/rate/pct用“—”。 | 确认显示投影与业务未知边界、首账号摘要/过期提示、CSV与当前表格筛选契约、文案/Value unknown映射。只能依裁决改，不擅扩大IPC、聚合账号或改业务模型；API等价与账单区别必须保留。 |
| Q7 | insights-ui同时拥有M4 capability/attention、M5 notice和M8 budget/project，同一general/version/busy；ui-carousel M6局部仍旧时不能删。 | 定义唯一shared Host状态和M4–M8 Ui接缝/退役顺序，明确M6图阻塞时M8能完成部分与carousel保留记录；系统级缺项停全部，不把脚本删/复制绕过。 |
| Q8 | 既有main cost-ui环中心hover/范围入口点击有历史不稳定（计划§5；M3记录:47），新组件替换后仍须同功能验收。 | 批准保留语义而更新定位与settle/动画证据的具体方案；基于同fixture/theme/motion/viewport before/after，不把历史失败当免验收。 |

本轮仅静态盘点，未执行verify/audit/build/UI/真实数据检查，未改写任何测试或产品。五份盘点交付后停止；main出现裁决记录且M3示范存在后，下一阶段再从当时main新分支连续实施。

<!-- IDS:M8 -->

## 附录：ID 与反向引用静态检索

以下索引固定到main 4f77437。完整静态ID及脚本赋值ID如下；循环生成的data-*行/控制也必须按正文覆盖，不把这个索引误当全部功能。

```text
cost costSections costExport costAnalysis costEdge costRailToggle costRangeLabel
costRailScrim costRail costRangeToggle costRangeSummary costCalendarWrap costCalendar costPeriods
costMonthChip costGapsOnly costOverview costAgents costAgentSummary costTrend costDuo
costWherePanel costComposition costSubs costMonthPanel costMonths costGroup costTable
costCheck costCoverage costCache costProjects wbReload wbExport wbPeriod
wbProject wbRange wbError wbMessage wbCost wbTokens wbCoverage
wbBudgetForm wbLimit wbSaveBudget wbClearBudget wbBudgetState wbHistory wbBudgets
wbProjects costCacheList costDetailTitle costDetailDialog cost-bars-hatch
```

| 文件与行号 | 命中ID（候选，需按正文耦合表区分DOM访问/普通字段/注释） |
|---|---|
| display-values.js:8 | cost |
| display-values.js:24 | cost |
| focus.js:25 | cost |
| focus.js:29 | cost |
| insights.js:4 | cost |
| insights.js:47 | cost |
| insights.js:48 | cost |
| morph.js:2 | cost |
| preview.js:25 | cost |
| preview.js:26 | cost |
| preview.js:34 | cost |
| preview.js:43 | cost |
| preview.js:82 | cost |
| preview.js:83 | cost |
| preview.js:85 | cost |
| preview.js:87 | cost |
| preview.js:89 | cost |
| preview.js:130 | cost |
| preview.js:312 | cost |
| preview.js:379 | cost |
| preview.js:517 | cost |
| preview.js:538 | cost |
| preview.js:539 | cost |
| preview.js:540 | cost |
| preview.js:563 | cost |
| preview.js:590 | cost |
| preview.js:591 | cost |
| preview.js:600 | cost |
| preview.js:614 | cost |
| preview.js:615 | cost |
| preview.js:629 | cost |
| preview.js:634 | cost |
| preview.js:640 | cost |
| preview.js:643 | cost |
| preview.js:650 | cost |
| preview.js:654 | cost |
| preview.js:657 | cost |
| preview.js:674 | cost |
| preview.js:687 | cost |
| preview.js:692 | cost |
| preview.js:710 | cost |
| preview.js:712 | cost |
| preview.js:713 | cost |
| preview.js:769 | cost |
| preview.js:772 | cost |
| preview.js:778 | cost |
| preview.js:790 | cost |
| preview.js:791 | cost |
| preview.js:797 | cost |
| preview.js:799 | cost |
| preview.js:847 | cost |
| preview.js:891 | cost |
| preview.js:897 | cost |
| preview.js:928 | cost |
| preview.js:934 | cost |
| preview.js:935 | cost |
| pricing-data.js:24 | cost |
| quota-cards.js:671 | cost |
| serve.js:33 | cost |
| serve.js:37 | cost |
| sessions-ui.js:11 | cost |
| sessions-ui.js:29 | cost |
| sessions-ui.js:34 | cost |
| sessions-ui.js:55 | cost |
| sessions-ui.js:77 | cost |
| sessions-ui.js:154 | cost |
| sessions-ui.js:155 | cost |
| sessions-ui.js:158 | cost |
| sessions-ui.js:159 | cost |
| sessions-ui.js:189 | cost |
| sessions-ui.js:204 | cost |
| sessions-ui.js:228 | cost |
| sessions-ui.js:258 | cost |
| sessions-ui.js:297 | cost |
| sessions-ui.js:301 | cost |
| window-shell.js:4 | cost |

原始索引与assert全文保存在未跟踪的 `artifacts/ui-mig/inventory-20261025/index.json`，不属于运行验收。

<!-- /IDS:M8 -->

署名：Codex
