# M6 额度迁移盘点 · 2026-10-25

## 状态与基线

仅计划§9.2盘点，未实现/退役M6。分支`ui/mig-m4-m8-inventory`从main `4f7743773f6fbf9db8b541604ebccb7d85880d2b`建立，产品行号固定该基线；阶段二复核。默认产品目录`design/desktop-reference/`，UI套件目录`scripts/m1/`。已按§0.1复读规范并读`UI-QUOTA-HERO-20261024.md`；图表只记录现状，不定义API或替Claude选视觉。CodeGraph不可用，采用源码/AST/ID/全局索引；无子代理。未执行真实账户读取、连接、凭据获取、CLI、浏览器登录或安装；不改后端/preload/IPC/kit/vendor/theme/token/guard，不合main/远程写入。

## 1. 功能清单

| 编号 | 现有功能/状态/控件与边界 | 出处 |
|---|---|---|
| F1 | 额度页标题、remaining/used切换、自动刷新off/每分钟、复制摘要、全部刷新、上次批次成功/失败/跳过数、合成示例提示/入口、缓存受损说明与来源管理链接。 | `index.html:37`–47；`quota-ui.js:21`–41、66–72 |
| F2 | 从quota.get/providers/getV2读已保存状态，去重/串行合并刷新通知；初始quota页、无连接诚实显示；页离开不使全卡重复render，hidden通知仍维护侧栏badge。 | `quota-ui.js:73`–90；`provider-quota-ui.js:22`–26；`quota-cards.js:623`–674 |
| F3 | 全部刷新仅显式动作/原有已授权服务timer：所有eligible连接各读一次；busy/cooldown/无凭据且不可恢复跳过；Codex和其它路线批次合计的是操作计数，不合并额度。 | `quota-ui.js:43`–59 |
| F4 | 自动刷新偏好agentusage.quotaAutoRefresh.v1，off默认/记住1min，重启恢复后等首个间隔；共享timer由服务拥有，renderer不加provider轮询；30秒仅本地age/display刷新。 | `quota-ui.js:9`–15、67、82–90 |
| F5 | 同一账号重复连接仅按服务给的duplicateKnown/duplicateAccountIds合并，不猜身份；最早连接作稳定卡key，优先健康再最近成功作lead；sheet仍列每连接；身份未知后可拆开。 | `quota-cards.js:317`–345、355–365 |
| F6 | 普通卡图标/名称/套餐/别名/刷新年龄、主/次窗口、余额或钱包、失败带、状态/footer明细；未知/尚未读取/没有额度项不同；没有额度项不等于0。 | `quota-cards.js:159`–178、203–310、382–398 |
| F7 | 多窗口按primary/secondary和pool顺序；used缺失但remaining已知时按既有100-remaining读数；unlimited单独文字；重置已过stale不自动满额，不用“耗尽”结论替代待刷新。 | `quota-cards.js:99`–157、274–289、526–530 |
| F8 | 卡片的百分比分段条/时间刻线，OpenCode两环+第三细条，其余最多主条/两子行/一余额；超过项数在详情全部可见。aria-valuenow为确认值，unknown无数值并aria-valuetext。 | `quota-cards.js:159`–178、263–289；`quota-progress.js:32`–40 |
| F9 | 钱包主数/票据/口沿/组成条，blocked项弱化但保留；单池total不再与parts相加；WorkBuddy同账号可花积分包是唯一额外合计例外，冻结/过期/禁用/未生效/不可用排除，unknown份数与分页范围提示。 | `quota-cards.js:180`–261 |
| F10 | 精确十进制字符串：数字分组/最多两位仅显示层，完整值留title和详情；BigInt定点合计；图形几何可用Number，不能把它反写金额或改精确文案。 | `quota-cards.js:51`–76、180–200、402–406 |
| F11 | 卡片显示偏好names/hidden/order/measure/range/filter/slide用原key agentusage.quotaCards.v1；名字≤32，空名恢复默认，异常偏好回默认；不改连接/额度。 | `quota-cards.js:29`–49、440–443、684–697 |
| F12 | 全部/需要处理/正常过滤仅卡片grid；隐藏卡保持隐藏，showHidden展开/收起；筛选数量，0结果文案，≥2张才有筛选条。首屏按未隐藏的shown建模，不随filter缩小。 | `quota-cards.js:32`–38、640–668、792–805 |
| F13 | 需要处理：前三条+另N，保留全文title与修复动作；依次定位/短暂标记/回焦；“1天未更新”按age定位，会改变挡住目标的filter；隐藏偏好不被擅自恢复。 | `quota-cards.js:300`–310、371–381、604–621 |
| F14 | 未连接Agent行：连接/说明，unsupported说明，Codex找不到CLI可选codex.exe；不能以安装/用量状态推断已连接或额度0。 | `quota-cards.js:346`–352、382–385、462–470 |
| F15 | 首屏只加入有数据的pane，顺序现在→接下来→余额，原slide偏好；箭头/文字圆点、键盘、拖动/触摸/横向滚轮；非当前slide inert/aria-hidden，外框随高，第一次入场一次，resize保留。 | `quota-hero.js:185`–244；`ui-carousel.js:56`–131 |
| F16 | 现在：每池最多3圈，单窗口多池可并一dial；外圈最短窗口；时间刻线；默认最快恢复/最紧；point/focus读数切窗口，离开恢复；点击开该Agent/账号详情；stale虚线、unknown仅底圈、out空弧。 | `quota-cards.js:524`–569；`quota-hero.js:18`–53、190–206 |
| F17 | 现在左侧数字逐位滚动、单位、恢复/重置倒计时、时间与额度对照、估算节奏；钱包小胶囊跳余额；已连接N/总数和一天未更新两按钮，不是跨Agent额度总数。 | `quota-hero.js:32`–51；`quota-cards.js:152`–157、566–569 |
| F18 | 接下来：按卡分组，组内最急优先，7行阈值整组折叠（首组可超过7行）、+N/收起；没有报告时间只图标列；24h/7d/30d范围与偏好。 | `quota-cards.js:490`–523、570–588；`quota-hero.js:56`–72 |
| F19 | 时间针：轨道hover预览、点击/拖动固定、点圆/菱形跳时刻、Home/End、Left/Right按范围1h/6h/1d移动、回现在；区分ghost与pinned，离开恢复固定位置；与翻页手势互不抢。 | `quota-hero.js:74`–134；`ui-carousel.js:79` |
| F20 | 时间针右侧按所指时刻显示：过重置的窗口→↻满额/used0%，金额窗按已报total或“已重置”，到期积分扣除；左侧仅统计窗口/批次数。不预测期间消耗，不更新实际账号观测。 | `quota-cards.js:578`–585；`quota-hero.js:74`–97 |
| F21 | 余额tile各账户自己的单位、unknown/unlimited/blocked/没有额度项；WorkBuddy按到期7d/30d/更久/不限期分段；tile点击开详情；账户图标切阶梯图。 | `quota-cards.js:533`–546、589–601；`quota-hero.js:137`–144 |
| F22 | 阶梯图：按expiry下降，不限期虚线；近时间包聚菱形；hover菱形/区段读到期数、包数、之后余额，离开复原；窗口高度跟随不触发每帧重建几何。 | `quota-cards.js:590`–597；`quota-hero.js:145`–182、196–206 |
| F23 | 图形动画：bar观察可见/首次/60秒再入、从当前clip retarget、不在screen/减少/关闭即终态；首屏ring/lanes/steps/数字原入场与读数中断；阶段二按统一data档重做，不能改变数据。 | `quota-progress.js:7`–46；`quota-hero.js:167`–172、217–225；`ui-carousel.js:11`–53 |
| F24 | 卡片长按350ms且移动容差6px才拾取；拖动按真实layout slot，移位动画；release存顺序，Escape/pointercancel复原并抑制click；Alt+四箭头同样移位并回焦；隐藏/过滤项保留原位置。 | `quota-cards.js:698`–767 |
| F25 | 摘要复制是本机显式copyText，卡片原名/读数/生命周期/duplicate说明/age及日期；没有可复制额度、失败分别状态；当前summary不应用filter，见Q5。 | `quota-cards.js:769`–786 |
| F26 | 共用额度详情sheet按Agent列全部账号，可跳账号锚点；三事实、资源/precision、state/freshness/expiry/reset、套餐/资格、最近成功/尝试、partial、记住/重复、刷新/取消/移除/重新连接/被动配置；卡片名字/顺序/隐藏偏好一份。 | `quota-cards.js:402`–472、675–697、787–818 |
| F27 | WorkBuddy详情按7天内到期/可用/关闭项分组并展开更多；其它资源按pool，不能汇总异种资源；复制/完整title保留真实decimal，未报告total不补0。 | `quota-cards.js:402`–438 |
| F28 | Codex登录sheet：备注、官方登录、pending busy/status/取消；关闭与Escape走cancel，失败说明；选官方CLI、刷新/移除带busy/cooldown；示例不调用bridge写操作。 | `index.html:124`；`quota-ui.js:16`–19、42、60–79 |
| F29 | 非Codex连接：选择route、备注、client复用/换号、普通Chrome后手动连接、manual、passive；route-note/guide、连接方式按适配器能力显隐，不创造新路线。 | `provider-quota-ui.js:8`–17、27–50 |
| F30 | Secret输入password≤16384，不回显已有值；Google project pattern、WorkBuddy UA、Claude organization、OpenCode workspace上下文、明确consent、Windows加密remember；换route/method/关闭/提交前清理敏感输入。 | `provider-quota-ui.js:9`、15–17、27–61、64 |
| F31 | 网站打开≠已连接/读额度，回manual再填；client key缺失回manual；可选fresh授权；错误只公开码/存储阶段，成功/失败/取消与后续刷新分离；禁止把凭据进共享可序列化快照或诊断。 | `provider-quota-ui.js:18`–20、39–43、54–70 |
| F32 | provider刷新/移除/取消/重新提供凭据、被动状态栏片段复制（不写用户配置）；操作后来源内存摘要重载；cacheError/cleanupError保留警示，读取失败保留旧显示。 | `provider-quota-ui.js:22`–26、64–76 |
| F33 | 所有sheet焦点进入/Tab/返回、Escape与嵌套层、IME；命名Enter不吞组字；卡片文本选择不误开详情、drag不误点；浅/深色和小窗/缩放/长名称无裁剪。 | `quota-cards.js:787`–818；`quota-ui.js:64`；`interactions.js`；测试映射 |

## 2. 数据与语义

| 数据/动作 | 当前来源 | 保留规则 |
|---|---|---|
| Codex控制V1与资源V2 | quotaBridge.get/onUpdate、providerQuotaUi.codex来自getV2；cards.accounts合并V1/V2 | V1用于busy/error，V2资源优先，V1仅现有fallback；unknown不补0，缓存/freshness不等实时成功。 |
| providers/capabilities | quotaBridge.providers、getV2、onProviderUpdate | saved-fact/memory读取；查看不刷新真实provider；capabilities缺失用原只读预览fallback，不猜安装/身份。 |
| 显式刷新/自动频率 | refresh/refreshAll/providerAction(refresh)、setAutoRefresh | service拥有cooldown、率限、连接恢复和共享timer；renderer不重复实现调度或读外部auth/client文件。 |
| 登录/取消/CLI选择 | login(alias)、cancel、chooseExecutable；providerClientLogin/WebsiteLogin动态调用；providerConnect/Action | 仍显式原动作、固定adapter/context/consent/remember；UI迁移不授权真实验收，测试全部注入synthetic。 |
| 本机copy/说明 | usageBridge.copyText、providerGuide/providerPassiveGuide | 只按原动作复制或打开批准说明，不执行片段/命令，不修改真实配置。 |
| 资源投影 | parts/fromV1/percentOf/windowNote/age/providerStatus/cardsOf | lifecycle、availability、freshness各自保留；不同Agent/账号/pool不相加；重复连接只服务确认。 |
| 精确金额 | decimal/amount/exactAmount/addDecimals/creditTotal | 原字符舍入/BigInt原样UMD；WorkBuddy同一账号例外原范围，partial/分页/unknown包提示不得删除。 |
| 首屏模型 | heroModel/lanesOf/ticksOf/heroWindow/tileOf | 只shown（含当前filter不影响首屏），时刻可比较，金额不跨账户；future针是显示模型不是自动refill或额度更新。 |
| 偏好 | localStorage两个既有key | 原字段、key、默认与兼容，hide/order不改任何连接；错误仅当次有效。 |
| 图形数据/精度 | hero steps的Number几何、exact字符串labels；progress aria真实值 | React不得把几何float当新的金额formatter；空bucket的0与未报告值区别保留。 |

纯计算按§2.4原样抽取UMD并配单测：prefs解析、decimal/amount、WB合计、身份合并、可见顺序/资源/窗口/节奏、hero模型与时间针读数、summary；先供旧页面调用证明同值，再给React。DOM拼接、事件和动画不混进纯模块。接口名由统一裁决，不能在TS重写这些函数。

## 3. 双向耦合与边界

目标结构按M3：`ui/src/pages/quota/`分toolbar/cards/hero/details/connections，旧侧`window.quotaHost`，React拥有`window.quotaUi`；本表是约束不是自行批准的新API。

| 编号 | 当前交叉引用 | 迁移处理 |
|---|---|---|
| C1 | cost-page.js:284读取quotaUi.state/providerQuotaUi.state，591点账户入口调用quotaUi.openSource；quota-change通知cost订阅比较 | 直到M8迁移保留可用的只读状态/订阅与openSource接口，不以新页面mount改账号模型；费用不读取React DOM。 |
| C2 | M4 source-connections-ui:33→quotaUi.openSource；provider:61/70/72→sourceConnectionsUi.reload | 同一Agent卡定位/Sheet入口兼容；M4已迁后走其窄接口；连接改变只刷新来源内存，不能顺便账号读。 |
| C3 | quotaUi/providerQuotaUi/quotaCardsUi相互读状态/调schedule/open/act；provider getV2同时供Codex资源 | 保留一份状态与节流/请求串行，不出现两个缓存/两个刷新批次；旧渲染与HTML函数退役，动作Host保留。哪些兼容公开对象保留由Q2确认。 |
| C4 | quotaCards→quotaHero/uiCarousel/quotaProgress；cost-hero.js:10/46/61也用uiCarousel | M6不能删除/改坏旧ui-carousel；只有M8按计划退役。新kit CarouselDots之外的轨道/手势/数字/动态高度由裁决定，不页面直接用Motion。 |
| C5 | preview/main路由、window-shell refresh命令直接#quotaRefreshAll、motion指示器quotaMeasure/Range/Filter、select-ui/scroll-fade/focus通用选择器 | 保留section属性，旧命令改窄Ui动作；kit拥有新DOM；共享其它页逻辑留原阶段，不整删共用脚本。 |
| C6 | localStorage prefs、quota-change/installer/source events、document visibility、30秒age计时、rAF签名 | 原事件含义、后台badge更新/前台lazy render、去重及卸载清理不丢；新hook不加provider轮询。 |
| C7 | quotaSheet/Content在index:120，quotaLoginDialog在124，providerConnectDialog动态body；详情→连接先关闭原sheet | 迁Sheet、嵌套/焦点/取消语义保持；禁止留下隐藏旧dialog给另一路操作；secret清理不能变持久state。 |
| C8 | pages.css含quota与carousel，同时M8用cost；tokens/全局style/polish/motion；legacy/serve/资源图 | 按selector退役；仅quota特定规则移除，共享carousel至M8、外框至M9；tokens/主题不改。 |

其它脚本ID反向候选在附录，普通quota/sources字段与注释不当作DOM消费者；另核对上述公开对象及data-quota/provider/card/hero/credit/needle属性。

## 4. kit 映射与图表现状（不定接口）

| 功能 | 可直接复用的M3/M3k组件 | 需裁决处 |
|---|---|---|
| 页头/频率/读数/筛选 | PageHeader、SettingRow、Select、Segmented/SubTabs、Button/IconButton、Value/Figure | Figure档位、toolbar compact范围按裁决；不改偏好/选项语义。 |
| 卡片/说明/状态/详情 | Card、AgentMark、Badge、Banner、Sheet、Disclosure、DataTable、ScrollArea | wallet图形/同账号合卡布局、状态色、详情/登录尺寸与固定动作，Q3。 |
| 登录/凭据 | Form、TextField、Select、CheckboxGroup、Button | **TextField没有password、pattern、autocomplete、spellcheck属性**；不以text显示secret，Q1。 |
| 名称与order/hide | TextField(maxLength32)、Button | 长按拖动/Alt箭头需kit层交互，现Card无此API，Q1。 |
| 首屏切换 | CarouselDots；Figure | 轨道/拖动/滚轮/inert/高度不是CarouselDots自身能力，Q1/Q2。 |
| 圆环/条/时间线/阶梯/票据 | 无已审图表kit | 以下只描述原几何/数据/颜色/动效/键盘/空态，由Claude给接口。 |

| 图形 | 原尺寸/颜色/状态与交互（出处） |
|---|---|
| 首屏同心环 | viewBox -70 -70 140 140；1/2/3圈半径[56]/[58,42]/[60,47,34]，stroke11或9；外圈最短，内圈opacity .66；每dial最小112/最大136，左读数272（tokens.css:138–144、quota-hero:18–30、pages.css:458–482）。Agent色、底圈fill、文字色时间tick；unknown空底圈、stale虚线、out警示底圈。pointer/focus改同一读数，button开详情，无新tooltip定位。 |
| 卡片条/小圆环 | 30段主条/16段mini，时间刻线；条18px，meters12px、thin8px；OpenCode圆环SVG72、r30、显示64px（quota-cards:159–173/263–270，pages.css:104/120/210–216）。aria确认值与unknown保留；progress原820ms retarget、50%入视阈值、60秒再入策略，规范动效交裁决。 |
| 接下来时间线 | 左读数188、名字148、值108的旧token；lane44px、rail8px，点/菱形固定时刻（tokens.css:139/143–144、pages.css:522–530）；axis按24h六小时/7d逐天/30d逐周边界；hover ghost、pointer拖动固定，左右步1h/6h/1d、Home/End，role=slider含时刻/重置数。unknown时间只图标；stale行不假设下一次重置。 |
| 余额阶梯 | H150，W=max(240,实际宽或600)，左46右10、绘图区y10–124；三个水平刻度、四段时间刻度；12×12菱形、rx2.5；step/floor/area分别Agent线/虚线/混色，近expiry按横向跨度/20合并（quota-hero:145–182、cards:590–597；pages.css:577–587）。hover包/时间/after精确label，离开还原。原节点为SVG rect，未提供独立键盘游标；底层条目在可键盘打开的详情可读，等价可达方式由Claude明确。 |
| 钱包口袋/到期分段 | 票据最多2、弯口SVG、不可用金额与expired条目仍详情保留；7d/30d/更久/不限期4段6px，Agent色/现警示混色，原title是各段合计（cards:212–261、pages.css:162–201）。这些是图形现状，不授权Card套Card或新颜色。 |

## 5. 规范统一的外观差异

控件36px/圆角8/12/16、六角色/figure、tabular-nums、规范spacing；dialog→Sheet slow/exit，disclosure/菜单moderate，图/数字data档；原820/1000ms、票据与环字号/加粗/透明状态如何映射由裁决指定。页面不写hover/内联样式、不引Motion；图表内部保留原hover数据/触发/位置。card方形/各状态/钱包、窄屏断点不自行重排。已有unknown文字用Value，原“—”见Q5。保留Agent身份色与真正耗尽警示，不把低余量或登录故障随意标好坏。

## 6. 测试映射

(i)页面、主题、空态/错误、窄屏与焦点基础；(ii)原UMD与既有resource/amount/identity合同单测；(iii)新quota页回归/联合旧流程；(iv)经裁决的旧实现形态退役。附录A逐条覆盖计划最少8套断言及补充套件；不把未知/精确小数/隔离/去重/不登录/键盘/CSP/sandbox断言退役。DOM查询改语义/新页自有hook，不能降低数值/字节/副作用约束。

等待流程同样保留：load缓存→刷新busy/cooldown/失败留历史→连接pending取消/成功与重启恢复→provider route显隐/consent/secret清空→重复账号合卡/拆卡→三pane指针与键盘→rename/order/hide持久→文本选择/长按取消→sheet保留节点/焦点与异步到达。fixture主进程注入不变，不调用真实登录/官网/账号。

| 补充套件/范围 | 映射目的 |
|---|---|
| motion额度片段 | (iii)quota登录取消、换页不误触、卡片和详情节点身份、异步quota更新、reduced/off、卸载；M3 profile动画断言仍已迁M3。 |
| visual额度片段 | (iii)三张方形等宽≥260、0与未知aria不同、stale待刷新、完整资源行；(i)深浅narrow/无错误；成本上下界仍M7/M8，不在M6改。 |
| render-performance额度片段 | (iii)稳定数字普通text、重入从当前值roll、阶梯几何不随高度帧重绘、相同通知burst不重建、rest track无transform、ledger不变；费用donut/zero reprice仍M8。 |
| source-quota（逐条在M4盘点） | (iii)source→quota只导航，不开始登录/读取；quota-change回来源只内存摘要，完整额度不跨账号加；本页引用同一断言，不增重复套件。 |
| cost-ui订阅quota账户入口 | (iii)M8前读取既有quotaUi/providerQuotaUi状态与事件，点击定位正确Agent；其它费用断言不改。 |

(ii)decimal字符串边界/进位/大数，WB合计排除与unknown/分页，同账号合并/拆分稳定key，prefs校验/过滤/隐藏顺序，parts/percent/freshness/lifecycle/heroLead/timeline/future读数/expiry分组与exact labels全部原样提取并测；资源、身份、transport/vault合同现有单测保留，不能在TS另建逻辑只测新结果。

<!-- ASSERTIONS:M6 -->

### 6.1 最少套件：逐断言位置与目标

同一行多个调用分别编号；同一调用位于循环时保留全部fixture/参数，不把多个case缩成一次。表达式是静态源码抄录，不代表本轮执行成功。

#### scripts/m1/quota-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 31 #1 | (i) | `` assert.equal(await page.title(), 'Agent Usage · Codex 额度') `` |
| 32 #1 | (iii) | `` assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true) `` |
| 33 #1 | (iii) | `` assert.equal(await page.evaluate(() => typeof window.require), 'undefined') `` |
| 34 #1 | (iii) | `` assert.equal(await page.locator('#main').getAttribute('data-current-view'), 'quota') `` |
| 35 #1 | (iii) | `` assert.equal(await page.locator('#usage').isVisible(), false) `` |
| 36 #1 | (iii) | `` assert.equal(await page.locator('#quotaCards').getByText('剩余 未知', { exact: true }).count(), 1) `` |
| 37 #1 | (iii) | `` assert.equal(await page.locator('#quotaExample').isVisible(), false) `` |
| 41 #1 | (iii) | `` assert.deepEqual(await page.locator('#quotaCards .quota-card').boundingBox(), before) `` |
| 42 #1 | (iii) | `` assert.equal(await page.locator('#quotaLoginDialog').evaluate(el => el.open), false) `` |
| 45 #1 | (i) | `` assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true) `` |
| 46 #1 | (iii) | `` assert.ok(['full', 'reduced'].includes(await page.locator('body').getAttribute('data-motion'))) `` |
| 47 #1 | (i) | `` assert.deepEqual(errors, []) `` |
| 48 #1 | (iii) | `` assert.equal(state.state.accounts.length, 1) `` |
| 48 #2 | (iii) | `` assert.equal(state.state.pendingLogin, null) `` |
| 49 #1 | (iii) | `` assert.equal(fs.existsSync(path.join(data, 'codex-homes')), false) `` |
| 78 #1 | (iii) | `` assert.equal((await page.evaluate(() => window.quotaBridge.get())).state.pendingLogin, null) `` |
| 78 #2 | (iii) | `` assert.equal((await page.evaluate(() => window.quotaBridge.get())).state.accounts.length, 1) `` |
| 82 #1 | (iii) | `` assert.equal((await page.evaluate(() => window.quotaBridge.get())).state.accounts.length, 2) `` |
| 90 #1 | (iii) | `` assert.equal(await page.locator('#quotaCards').getByText('剩余 75%', { exact: true }).count(), 1) `` |
| 91 #1 | (iii) | `` assert.equal(await page.locator('#quotaCards').getByText('剩余 64%', { exact: true }).count(), 1) `` |
| 92 #1 | (iii) | `` assert.equal(await page.locator('#quotaCards [data-quota-refresh]:disabled').count(), 2) `` |
| 93 #1 | (iii) | `` assert.equal(await page.locator('#quotaCards').getByText(/服务读取失败 · 60 秒冷却/).count(), 2) `` |
| 98 #1 | (iii) | `` assert.equal(/SECRET_SENTINEL\|SENTINEL@example\|authUrl/.test(persisted), false) `` |
| 104 #1 | (iii) | `` assert.equal(await page.locator('#quotaLoginStart').getAttribute('aria-busy'), 'true') `` |
| 107 #1 | (iii) | `` assert.equal((await page.evaluate(() => window.quotaBridge.get())).state.accounts.length, 1) `` |
| 108 #1 | (iii) | `` assert.equal(await app.evaluate(() => { const req = process.mainModule.require.bind(process.mainModule); return Object.values(req('node:module')._cache).find(m => /[/\\]src[/\\]quota[/\\]service\.js$/.test(m.filename)).exports.QuotaService.prototype.testFixture.active; }), 0) `` |
| 109 #1 | (i) | `` assert.deepEqual(errors, []) `` |
| 113 #1 | (iii) | `` assert.equal(result.state.autoRefresh, '1min', 'the auto-refresh choice made before the restart is remembered') `` |
| 113 #2 | (iii) | `` assert.equal(result.state.accounts[0].status, 'cached') `` |
| 113 #3 | (iii) | `` assert.equal(result.state.accounts[0].busy, false) `` |
| 113 #4 | (iii) | `` assert(Date.parse(result.state.nextAutoAt) > Date.now() + 30000, 'a remembered choice waits a full interval before its first read') `` |
| 113 #5 | (iii) | `` assert.equal(await page.evaluate(() => localStorage.getItem('agentusage.quotaAutoRefresh.v1')), 'off') `` |

#### scripts/m1/quota-v4-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 47 #1 | (iii) | `` assert.deepEqual(await hero.locator('[data-hero-go]').allInnerTexts(), ['现在', '接下来', '余额']) `` |
| 48 #1 | (iii) | `` assert.match(who, /Codex/) `` |
| 48 #2 | (iii) | `` assert.match(who, /5 小时/) `` |
| 48 #3 | (iii) | `` assert.match(who, /最快恢复/) `` |
| 49 #1 | (iii) | `` assert.equal(await hero.locator('[data-now-read] [data-hero-number]').getAttribute('aria-label'), '0') `` |
| 50 #1 | (iii) | `` assert.match(await hero.locator('[data-now-when]').innerText(), /恢复/) `` |
| 51 #1 | (iii) | `` assert.equal(await hero.locator('.quota-hero-ring.is-stale').count(), 2, 'stale windows are dashed rings') `` |
| 53 #1 | (iii) | `` assert.equal(await hero.locator('[data-now-read] [data-hero-number]').getAttribute('aria-label'), '84', 'pointing at a ring reads that window') `` |
| 55 #1 | (iii) | `` assert.match(await hero.locator('.quota-hero-pills').innerText(), /3,114 积分/) `` |
| 55 #2 | (iii) | `` assert.match(await hero.locator('.quota-hero-stats').innerText(), /1 天未更新/) `` |
| 60 #1 | (iii) | `` assert.equal(await hero.locator('.quota-hero-lane').count(), 4, 'WorkBuddy expiry, two Codex windows and one waiting Antigravity lane') `` |
| 61 #1 | (iii) | `` assert.equal(await hero.locator('.quota-hero-band.is-stale').count(), 1, 'stale windows of one connection share a lane') `` |
| 62 #1 | (iii) | `` assert.match(await hero.locator('.quota-hero-silent').getAttribute('title'), /OpenCode、ZCode 没有报告时间/) `` |
| 63 #1 | (iii) | `` assert.deepEqual(await hero.locator('.quota-hero-rail').evaluateAll(rails => rails.map(rail => rail.innerText.trim()).filter(Boolean)), [], 'the rail carries only shapes, never words') `` |
| 65 #1 | (iii) | `` assert.equal(await hero.locator('[data-tally-reset]').innerText(), '2') `` |
| 65 #2 | (iii) | `` assert.equal(await hero.locator('[data-tally-expire]').innerText(), '2') `` |
| 67 #1 | (iii) | `` assert(values.includes('2,994 积分'), 'expired credits leave the balance: ' + values) `` |
| 67 #2 | (iii) | `` assert(values.filter(value => value === '100%').length === 2, 'a window past its reset reads as full: ' + values) `` |
| 69 #1 | (iii) | `` assert.equal(await hero.locator('[data-needle-big]').innerText(), '现在') `` |
| 71 #1 | (iii) | `` assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('agentusage.quotaCards.v1')).range), '1d') `` |
| 72 #1 | (iii) | `` assert.equal(await hero.locator('.quota-hero-band.is-open').count() > 0, true, 'a reset beyond the range runs off the rail') `` |
| 75 #1 | (iii) | `` assert.match(await page.locator('#quotaSheetContent').innerText(), /Codex/) `` |
| 80 #1 | (iii) | `` assert(tiles.some(text => /WorkBuddy[\s\S]*3,114/.test(text)) && tiles.some(text => /ZCode[\s\S]*没有额度项/.test(text)) && tiles.some(text => /OpenCode[\s\S]*0\.00/.test(text)), 'tiles: ' + tiles) `` |
| 81 #1 | (iii) | `` assert(await hero.locator('.quota-hero-steps .is-drop').count() > 0) `` |
| 87 #1 | (iii) | `` assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('agentusage.quotaCards.v1')).slide), 'next') `` |
| 89 #1 | (iii) | `` assert.equal(await hero.locator('[data-quota-old]').isDisabled(), false) `` |
| 90 #1 | (iii) | `` assert.equal(await page.locator('#quotaCards .quota-card[data-attention-flash] .quota-age.is-old').count(), 1, 'the stale count walks to a card that is more than a day old') `` |
| 94 #1 | (iii) | `` assert.match(await attention.innerText(), /需要处理 2/) `` |
| 94 #2 | (iii) | `` assert.equal(await attention.locator('[data-provider-action="credential"]').count(), 2) `` |
| 98 #1 | (iii) | `` assert.equal(await workbuddy.count(), 1) `` |
| 98 #2 | (iii) | `` assert.equal(await workbuddy.getAttribute('data-connections'), data.ids.desktop + ' ' + data.ids.web) `` |
| 99 #1 | (iii) | `` assert.match(await workbuddy.locator('.quota-alias').innerText(), /2 个连接 · 同一账号/) `` |
| 99 #2 | (iii) | `` assert.equal(await workbuddy.locator('.quota-status').innerText(), '1 / 2 个连接需要处理') `` |
| 100 #1 | (iii) | `` assert.equal(await workbuddy.locator('.quota-ticket').count(), 2) `` |
| 100 #2 | (iii) | `` assert.match(await workbuddy.locator('.quota-ticket').first().innerText(), /新人活动奖励/) `` |
| 101 #1 | (iii) | `` assert.equal(await workbuddy.locator('.quota-wallet-total strong').innerText(), '3,114 积分') `` |
| 101 #2 | (iii) | `` assert.match(await workbuddy.innerText(), /7 天内到期 120 积分/) `` |
| 102 #1 | (iii) | `` assert.equal(await workbuddy.locator('.quota-problem').count(), 0, 'one working connection keeps the full reading') `` |
| 104 #1 | (iii) | `` assert.match(await opencode.locator('.quota-problem').innerText(), /授权已过期/) `` |
| 104 #2 | (iii) | `` assert.equal(await opencode.locator('.quota-status').innerText(), '需要处理') `` |
| 105 #1 | (iii) | `` assert.match(await page.locator('#quotaCards [data-provider-row="zcode"]').innerText(), /这不代表额度为 0/) `` |
| 107 #1 | (iii) | `` assert.equal(await codex.locator('.quota-tick').count(), 2, 'both windows mark where their time stands') `` |
| 107 #2 | (iii) | `` assert.match(await codex.innerText(), /节奏充裕/) `` |
| 108 #1 | (iii) | `` assert.equal(await codex.locator('.quota-fill i').nth(40).evaluate(i => { const hex = getComputedStyle(document.body).getPropertyValue('--agent-codex').trim(), [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)); return getComputedStyle(i).backgroundColor === 'rgb(' + r + ', ' + g + ', ' + b + ')'; }), true, 'Codex bars take the Codex tone') `` |
| 113 #1 | (iii) | `` assert.deepEqual(await order(page), ['opencode', 'workbuddy']) `` |
| 114 #1 | (iii) | `` assert.deepEqual(await order(page), ['codex', 'zcode', 'antigravity']) `` |
| 115 #1 | (iii) | `` assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('agentusage.quotaCards.v1')).filter), 'ready') `` |
| 116 #1 | (iii) | `` assert.equal(await page.locator('#quotaCards .quota-card').count(), 5) `` |
| 120 #1 | (iii) | `` assert.equal(await sheet.evaluate(dialog => dialog.open), true) `` |
| 121 #1 | (iii) | `` assert.equal(await sheet.locator('.quota-sheet-nav button').count(), 2) `` |
| 123 #1 | (iii) | `` assert.equal(await desktop.locator('.quota-sheet-facts > div').count(), 3) `` |
| 123 #2 | (iii) | `` assert.match(await desktop.locator('.quota-sheet-facts').innerText(), /新人活动奖励 到期/) `` |
| 124 #1 | (iii) | `` assert.deepEqual(await desktop.locator('.quota-sheet-pool > h4').allInnerTexts().then(list => list.map(text => text.split('\n')[0])), ['7 天内到期', '可用']) `` |
| 125 #1 | (iii) | `` assert.match(await desktop.locator('.quota-sheet-pool > h4').first().innerText(), /2 个 · 120 积分/) `` |
| 126 #1 | (iii) | `` assert.equal(await desktop.locator('.quota-sheet-more').count(), 2, 'the long list and the expired packages are folded') `` |
| 127 #1 | (iii) | `` assert.match(await desktop.locator('.quota-sheet-pool li').first().innerText(), /新人活动奖励/) `` |
| 136 #1 | (iii) | `` assert.equal(await page.locator('#quotaCards .quota-card.is-dragging').count(), 1) `` |
| 138 #1 | (iii) | `` assert.equal(moved[2], before[0]) `` |
| 138 #2 | (iii) | `` assert.equal(await sheet.evaluate(dialog => dialog.open), false, 'a drag is not a click') `` |
| 139 #1 | (iii) | `` assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('agentusage.quotaCards.v1')).order.length), 5) `` |
| 142 #1 | (iii) | `` assert.deepEqual(await order(page), moved, 'Escape cancels the drag') `` |
| 144 #1 | (iii) | `` assert.equal((await order(page))[1], moved[2]) `` |
| 144 #2 | (iii) | `` assert.equal(await page.locator('#providerQuotaMessage').innerText(), '已移到第 2 位。') `` |
| 146 #1 | (i) | `` assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal page overflow') `` |
| 147 #1 | (iii) | `` assert(await card.locator('.quota-card-body').evaluate(body => body.scrollHeight <= body.clientHeight + 1), 'card content fits its square') `` |
| 148 #1 | (i) | `` assert.deepEqual(errors, []) `` |
| 149 #1 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), ledger) `` |
| 149 #2 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(quota, 'quota-cache.json')), codexBytes) `` |

#### scripts/m1/quota-identity-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 34 #1 | (iii) | `` assert.equal(result.ok, true, result.error) `` |
| 52 #1 | (i) | `` assert.match(page.url(), /^file:/) `` |
| 52 #2 | (i) | `` assert.match(await page.title(), /Agent Usage/) `` |
| 52 #3 | (iii) | `` assert(await page.locator('#quotaIdle').innerText()) `` |
| 56 #1 | (iii) | `` assert.equal(await page.locator('#quotaCards [data-provider-row="workbuddy"]').count(), 2, 'each known account is one card; the two accounts stay apart') `` |
| 57 #1 | (iii) | `` assert.match(await card(page, id).locator('.quota-status').innerText(), /同一账号 · 2 个连接/) `` |
| 57 #2 | (iii) | `` assert.match(await card(page, id).locator('.quota-alias').innerText(), /2 个连接/) `` |
| 58 #1 | (iii) | `` assert.notEqual(await card(page, a).getAttribute('data-card-key'), await card(page, b).getAttribute('data-card-key')) `` |
| 59 #1 | (iii) | `` assert.equal(await card(page, a).locator('.quota-wallet-total strong').innerText(), '30 积分') `` |
| 59 #2 | (iii) | `` assert.equal(await card(page, b).locator('.quota-wallet-total strong').innerText(), '70 积分') `` |
| 60 #1 | (iii) | `` assert.doesNotMatch(await card(page, a).innerText(), /已返回/) `` |
| 60 #2 | (iii) | `` assert.match(await card(page, b).innerText(), /已返回的 2 个积分包/) `` |
| 61 #1 | (iii) | `` assert.equal(backend.accounts.find(row => row.id === a).quota.partial, true, 'unknown availability is independent of finished pagination') `` |
| 66 #1 | (iii) | `` assert.match(await sheetRow(page, a).locator('[data-duplicate-note]').innerText(), /甲二/) `` |
| 66 #2 | (iii) | `` assert.doesNotMatch(await sheetRow(page, a).locator('[data-duplicate-note]').innerText(), /乙一\|乙二/) `` |
| 67 #1 | (iii) | `` assert.match(await sheetRow(page, a).locator('.quota-sheet-total').innerText(), /分页已读完/) `` |
| 67 #2 | (iii) | `` assert.match(await sheetRow(page, b).locator('.quota-sheet-total').innerText(), /已返回/) `` |
| 68 #1 | (iii) | `` assert.equal(await sheetRow(page, aa).locator('[data-card-name]').count(), 0, 'a shared card keeps one name, under its first connection') `` |
| 69 #1 | (iii) | `` assert.match(await sheetRow(page, a).locator('[data-duplicate-note]').innerText(), /甲二 <b>名称<\/b>/) `` |
| 69 #2 | (iii) | `` assert.equal(await sheetRow(page, a).locator('[data-duplicate-note] b').count(), 0, 'peer display names are text, not markup') `` |
| 72 #1 | (iii) | `` assert.match(summary, /分页已读完/) `` |
| 72 #2 | (iii) | `` assert.match(summary, /已返回的/) `` |
| 72 #3 | (iii) | `` assert.match(summary, /同一账号的 2 个连接：甲一、甲二/) `` |
| 72 #4 | (iii) | `` assert(!summary.includes('SYNTHETIC_ACCOUNT')) `` |
| 74 #1 | (iii) | `` assert.equal(website.ok, true) `` |
| 77 #1 | (iii) | `` assert.doesNotMatch(await card(page, webId).locator('.quota-status').innerText(), /重复连接/) `` |
| 77 #2 | (iii) | `` assert.match(await card(page, webId).innerText(), /已返回/) `` |
| 78 #1 | (iii) | `` assert.equal(webCopy.ok, true) `` |
| 80 #1 | (iii) | `` assert.match(await sheetRow(page, webId).locator('[data-duplicate-note]').innerText(), /相同凭据及读取范围的重复连接：网站副本/) `` |
| 80 #2 | (iii) | `` assert.doesNotMatch(await sheetRow(page, webId).locator('[data-duplicate-note]').innerText(), /甲一\|乙一/) `` |
| 81 #1 | (iii) | `` assert.equal(passive.ok, true) `` |
| 82 #1 | (iii) | `` assert.equal(passive.state.accounts.find(row => row.id === unknownId).identityStatus, 'unknown') `` |
| 82 #2 | (iii) | `` assert.doesNotMatch(await card(page, unknownId).locator('.quota-status').innerText(), /重复连接/) `` |
| 85 #1 | (iii) | `` assert.equal(await card(page, a).locator('.quota-status').innerText(), '1 / 2 个连接需要处理') `` |
| 85 #2 | (iii) | `` assert.match(await card(page, a).locator('.quota-status').getAttribute('title'), /甲二 <b>名称<\/b>/) `` |
| 86 #1 | (iii) | `` assert.equal(await card(page, a).locator('.quota-problem').count(), 0, 'the card keeps the reading of the connection that still works') `` |
| 87 #1 | (iii) | `` assert.match(await page.locator('#quotaAttention').innerText(), /甲一/) `` |
| 88 #1 | (iii) | `` assert.equal(await card(page, a).locator('.quota-wallet-total strong').innerText(), '30 积分') `` |
| 89 #1 | (iii) | `` assert.match(await sheetRow(page, a).locator('[data-duplicate-note]').innerText(), /甲二/) `` |
| 91 #1 | (iii) | `` assert.equal(await sheetRow(page, a).locator('[data-duplicate-note]').count(), 0) `` |
| 91 #2 | (iii) | `` assert.match(await sheetRow(page, b).locator('[data-duplicate-note]').innerText(), /乙二/) `` |
| 94 #1 | (iii) | `` assert.match(await sheetRow(page, b).locator('.quota-sheet-total').innerText(), /分页已读完/) `` |
| 94 #2 | (iii) | `` assert.match(await sheetRow(page, bb).locator('.quota-sheet-total').innerText(), /已返回/) `` |
| 95 #1 | (iii) | `` assert.doesNotMatch(await card(page, b).innerText(), /已返回/, 'the shared card reads the connection that read last') `` |
| 97 #1 | (i) | `` assert.deepEqual(errors, []) `` |
| 97 #2 | (i) | `` assert(await page.locator('#quotaCards').evaluate(element => element.scrollWidth <= element.clientWidth + 1)) `` |
| 98 #1 | (iii) | `` assert(prior > 0) `` |
| 101 #1 | (iii) | `` assert(restored.every(row => !row.duplicateKnown && row.identityStatus === 'unknown')) `` |
| 102 #1 | (iii) | `` assert.doesNotMatch(await card(page, b).locator('.quota-status').innerText(), /重复连接/) `` |
| 102 #2 | (iii) | `` assert.equal(await card(page, b).locator('h3').innerText(), '乙一 保留名称') `` |
| 102 #3 | (iii) | `` assert.doesNotMatch(await card(page, b).innerText(), /已返回/) `` |
| 103 #1 | (iii) | `` assert.match(await card(page, bb).innerText(), /已返回/) `` |
| 103 #2 | (iii) | `` assert.match(await card(page, webId).innerText(), /已返回/) `` |
| 104 #1 | (iii) | `` assert.equal((await page.evaluate(() => window.quotaBridge.get())).state.autoRefresh, 'off') `` |
| 105 #1 | (iii) | `` assert.doesNotMatch(await card(page, b).locator('.quota-status').innerText(), /重复连接/) `` |
| 105 #2 | (iii) | `` assert.match(await card(page, b).locator('.quota-status').innerText(), /同一账号/) `` |
| 105 #3 | (iii) | `` assert.equal(await card(page, b).locator('h3').innerText(), '乙一 保留名称') `` |
| 106 #1 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), ledger) `` |
| 106 #2 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(quota, 'quota-cache.json')), codex) `` |

#### scripts/m1/provider-quota-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 41 #1 | (iii) | `` assert.match(await page.locator('[data-provider-row="mimo"]').innerText(), /网站接口可能变更/) `` |
| 41 #2 | (iii) | `` assert.equal(await page.locator('[data-provider-row="mimo"] [data-provider-connect]').count(), 1) `` |
| 43 #1 | (iii) | `` assert.equal(await page.locator('#providerCookieConsent').isChecked(), false) `` |
| 43 #2 | (iii) | `` assert.equal(await page.locator('#providerCookieConsent').getAttribute('required'), '') `` |
| 44 #1 | (iii) | `` assert.match(await page.locator('#providerCredentialLabel').innerText(), /api-platform_serviceToken/) `` |
| 45 #1 | (iii) | `` assert.equal((await page.evaluate(() => window.quotaBridge.providers())).state.accounts.length, 0) `` |
| 46 #1 | (iii) | `` assert.equal(await page.locator('#providerCredential').inputValue(), '') `` |
| 47 #1 | (iii) | `` assert(await page.locator('#providerProject').isVisible()) `` |
| 47 #2 | (iii) | `` assert.equal(await page.locator('#providerProject').getAttribute('required'), '') `` |
| 50 #1 | (iii) | `` assert(!JSON.stringify((await page.evaluate(() => window.quotaBridge.providers())).state).includes('private-test-project')) `` |
| 50 #2 | (iii) | `` assert(!fs.readFileSync(path.join(quota, 'provider-quotas/connections.json'), 'utf8').includes('private-test-project')) `` |
| 53 #1 | (iii) | `` assert.equal(await page.locator('#providerCookieConsent').isChecked(), false) `` |
| 59 #1 | (iii) | `` assert.match(await row.innerText(), /9,007,199,254,740,993\.13 CNY/, 'the card groups digits and rounds on the decimal string, never through a float') `` |
| 59 #2 | (iii) | `` assert.equal(await row.locator('[title="9007199254740993.125 CNY"]').count() > 0, true, 'the card keeps the reported value in its tooltip') `` |
| 60 #1 | (iii) | `` assert.equal(await sheet.evaluate(value => value.open), true) `` |
| 60 #2 | (iii) | `` assert.match(await sheet.innerText(), /9007199254740993\.125 CNY/) `` |
| 60 #3 | (iii) | `` assert.match(await sheet.innerText(), /总额与组成不可相加/) `` |
| 61 #1 | (iii) | `` assert(!JSON.stringify(state).includes('SYNTHETIC_SECRET')) `` |
| 62 #1 | (iii) | `` assert(!fs.readFileSync(path.join(quota, 'provider-quotas/connections.json'), 'utf8').includes('SYNTHETIC_SECRET')) `` |
| 64 #1 | (iii) | `` assert.equal((await page.evaluate(() => window.quotaBridge.providers())).state.accounts[0].quota.fetchedAt, first) `` |
| 69 #1 | (iii) | `` assert.equal(await app.evaluate(electron => electron.shell.providerFixture.calls.length), calls + 1, 'the provider connection is read by 全部刷新') `` |
| 75 #1 | (iii) | `` assert.equal(await dialog.locator('#providerCredential').isVisible(),false) `` |
| 86 #1 | (iii) | `` assert.equal(exported.status,0,exported.stderr) `` |
| 86 #2 | (iii) | `` assert(!JSON.stringify(exported).includes('PRIVATE_')) `` |
| 89 #1 | (iii) | `` assert.equal(await page.locator('#quotaCards [data-provider-row="'+provider+'"] .quota-figure').first().textContent(),provider==='antigravity'?'剩余 75%':'剩余 58%') `` |
| 95 #1 | (iii) | `` assert.equal(copied.length, 2) `` |
| 95 #2 | (iii) | `` assert(copied[0].includes('claude-statusline-export.ps1')) `` |
| 95 #3 | (iii) | `` assert(!copied[0].includes('PRIVATE_SOURCE_PATH')) `` |
| 96 #1 | (iii) | `` assert.equal(connections.rows.find(row => row.agent === 'deepseek').quota.connections, 1) `` |
| 96 #2 | (iii) | `` assert.equal(connections.rows.find(row => row.agent === 'claude').quota.connections, 1) `` |
| 96 #3 | (iii) | `` assert.equal(connections.rows.find(row=>row.agent==='antigravity').quota.connections,1) `` |
| 97 #1 | (i) | `` assert(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)) `` |
| 98 #1 | (i) | `` assert.deepEqual(errors, []) `` |
| 98 #2 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), ledger) `` |
| 98 #3 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(quota, 'quota-cache.json')), codexBytes) `` |
| 101 #1 | (iii) | `` assert.equal(after.find(row => row.provider === 'deepseek').credentialReady, false) `` |
| 101 #2 | (iii) | `` assert.equal(after.find(row => row.provider === 'deepseek').status, 'cached') `` |
| 101 #3 | (iii) | `` assert.equal(after.find(row => row.provider === 'deepseek').quota.fetchedAt !== null, true) `` |

#### scripts/m1/provider-login-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 37 #1 | (iii) | `` assert.equal(blocked.errorCode, 'PROVIDER_FIXTURE_BLOCKED') `` |
| 41 #1 | (iii) | `` assert.equal(await page.locator('#providerLoginMethod').inputValue(), 'website') `` |
| 42 #1 | (iii) | `` assert.equal(await app.evaluate(() => global.chromeFixture.urls.length), index) `` |
| 46 #1 | (iii) | `` assert.equal(app.windows().length, 1) `` |
| 46 #2 | (iii) | `` assert.equal(await page.locator('#providerLoginMethod').inputValue(), 'website') `` |
| 49 #1 | (iii) | `` assert.equal(app.windows().length, 1) `` |
| 49 #2 | (iii) | `` assert.equal(await page.locator('#providerConnectDialog').isVisible(), true) `` |
| 51 #1 | (iii) | `` assert.equal(opened.accounts.length, index) `` |
| 51 #2 | (iii) | `` assert.equal(opened.pendingWebsiteLogin, null) `` |
| 51 #3 | (iii) | `` assert.equal(await app.evaluate(() => global.chromeFixture.calls.length), index) `` |
| 54 #1 | (iii) | `` assert.equal(await app.evaluate(() => global.chromeFixture.calls.length), index) `` |
| 57 #1 | (iii) | `` assert.equal(connected.accounts.length, index + 1) `` |
| 57 #2 | (iii) | `` assert(connected.accounts.every(row => row.remembered && row.status === 'ready')) `` |
| 60 #1 | (iii) | `` assert.equal(fs.readdirSync(secretDir).length, providers.length) `` |
| 61 #1 | (iii) | `` assert(!fs.readFileSync(path.join(secretDir, file)).includes(Buffer.from('SYNTHETIC_LOGIN_SECRET'))) `` |
| 62 #1 | (iii) | `` assert(!JSON.stringify(state).includes('SYNTHETIC_LOGIN_SECRET')) `` |
| 62 #2 | (iii) | `` assert(!fs.readFileSync(path.join(quota, 'provider-quotas', 'connections.json'), 'utf8').includes('SYNTHETIC_LOGIN_SECRET')) `` |
| 65 #1 | (iii) | `` assert((await page.evaluate(() => window.quotaBridge.providers())).state.accounts.every(row => row.remembered && row.credentialReady && !row.busy)) `` |
| 65 #2 | (iii) | `` assert.equal(await app.evaluate(() => global.chromeFixture.calls.length), 0) `` |
| 67 #1 | (iii) | `` assert.equal(await app.evaluate(() => global.chromeFixture.calls[0].userAgent), 'Synthetic Chrome/150') `` |
| 70 #1 | (iii) | `` assert.equal((await page.evaluate(() => window.quotaBridge.providers())).state.accounts.length, providers.length) `` |
| 70 #2 | (iii) | `` assert.equal(await page.locator('#providerCredential').inputValue(), '') `` |
| 72 #1 | (iii) | `` assert.equal((await page.evaluate(() => window.quotaBridge.providers())).state.accounts.find(row => row.id === cursor.id).status, 'login-required') `` |
| 72 #2 | (iii) | `` assert(!fs.existsSync(path.join(secretDir, cursor.id + '.bin'))) `` |
| 73 #1 | (iii) | `` assert(!fs.existsSync(path.join(secretDir, workbuddy.id + '.bin'))) `` |
| 74 #1 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), ledger) `` |
| 74 #2 | (i) | `` assert.deepEqual(errors, []) `` |

#### scripts/m1/provider-client-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 42 #1 | (iii) | `` assert.equal(blocked.errorCode, 'PROVIDER_FIXTURE_BLOCKED') `` |
| 45 #1 | (iii) | `` assert.equal(await page.locator('#providerCredential').isVisible(), false) `` |
| 45 #2 | (iii) | `` assert.equal(await page.locator('#providerProject').isVisible(), false) `` |
| 46 #1 | (iii) | `` assert.equal(await page.locator('#providerConnectDialog').evaluate(dialog => dialog.open), false, adapter + ': ' + await page.locator('#providerConnectError').textContent()) `` |
| 48 #1 | (iii) | `` assert.deepEqual(calls.map(value => value.fresh), [true, false, true, false, false, false, false]) `` |
| 49 #1 | (iii) | `` assert.match(await page.locator('#providerLoginMethod option:checked').innerText(), /API key/) `` |
| 49 #2 | (iii) | `` assert.equal(await page.locator('#providerLoginMethod').inputValue(), 'manual') `` |
| 49 #3 | (iii) | `` assert.equal(await page.locator('#providerCredential').isVisible(), true) `` |
| 49 #4 | (iii) | `` assert.match(await page.locator('#providerConnectError').innerText(), /PROVIDER_CLIENT_CREDENTIAL_MISSING/) `` |
| 49 #5 | (iii) | `` assert.equal(await page.locator('#providerRemember').isChecked(), true) `` |
| 51 #1 | (iii) | `` assert.equal(state.accounts.length, 8) `` |
| 51 #2 | (iii) | `` assert(state.accounts.every(row => row.remembered && row.status === 'ready')) `` |
| 51 #3 | (iii) | `` assert(!JSON.stringify(state).includes('SECRET')) `` |
| 51 #4 | (iii) | `` assert.equal(emptyZcode.quota.hasMeasurements,false) `` |
| 51 #5 | (iii) | `` assert.deepEqual(emptyZcode.quota.pools,[]) `` |
| 51 #6 | (iii) | `` assert.equal(emptyZcode.quota.partial,true) `` |
| 51 #7 | (iii) | `` assert.match(await page.locator('#quotaCards [data-provider-row="zcode"]').innerText(),/服务没有返回额度项/) `` |
| 51 #8 | (iii) | `` assert.match(await page.locator('#quotaCards [data-provider-row="zcode"]').innerText(),/额度未知/) `` |
| 52 #1 | (iii) | `` assert(!fs.readFileSync(path.join(secretDir, name)).includes(Buffer.from('SYNTHETIC_'))) `` |
| 53 #1 | (iii) | `` assert(!fs.readFileSync(path.join(quota, 'provider-quotas/connections.json'), 'utf8').includes('SECRET')) `` |
| 55 #1 | (iii) | `` assert.match(await page.locator('#providerConnectError').innerText(), /失效/) `` |
| 56 #1 | (iii) | `` assert.equal(state.accounts.length, 8) `` |
| 56 #2 | (iii) | `` assert.equal(state.accounts.find(row => row.provider === 'claude').status, 'ready') `` |
| 57 #1 | (iii) | `` assert.equal((await page.evaluate(() => window.quotaBridge.providers())).state.accounts.length, 8) `` |
| 63 #1 | (iii) | `` assert.equal(await retry.isEnabled(), true) `` |
| 66 #1 | (iii) | `` assert.equal(await app.evaluate(() => global.clientFixture.calls.length), logins) `` |
| 73 #1 | (iii) | `` assert.equal((await page.evaluate(() => window.quotaBridge.providers())).state.accounts.filter(row => row.adapter === 'workbuddy-desktop' && row.remembered && row.credentialReady).length, 1) `` |
| 79 #1 | (iii) | `` assert.equal(await app.evaluate(() => global.clientFixture.waiters.length), 8) `` |
| 87 #1 | (iii) | `` assert.equal(afterAuto.reads - beforeAuto, 8) `` |
| 87 #2 | (iii) | `` assert.deepEqual(afterAuto.batch, { success: 8, failed: 0, skipped: 0 }) `` |
| 94 #1 | (iii) | `` assert(fit.gap >= 0 && fit.textFits && fit.arrowGap >= 0 && fit.nativeHidden, JSON.stringify(fit)) `` |
| 98 #1 | (iii) | `` assert.equal(restored.accounts.length, 8) `` |
| 98 #2 | (iii) | `` assert(restored.accounts.every(row => row.remembered && row.credentialReady && !row.busy)) `` |
| 98 #3 | (iii) | `` assert.equal(restored.accounts.find(row=>row.adapter==='zcode-device').quota.hasMeasurements,false) `` |
| 99 #1 | (i) | `` assert.deepEqual(errors, []) `` |
| 99 #2 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), originalLedger) `` |

#### scripts/m1/continuity-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
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

#### scripts/m1/overview-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
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

### 6.2 多页套件补充定位

这里只映射本页相关段及其跨页结果；循环/流程的其它页分支仍归其它页，不能据此整套退役。

#### scripts/m1/motion-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 74 #1 | (iii) | `` assert.equal(await page.locator('#quotaLoginDialog').evaluate(d => d.open), false) `` |
| 110 #1 | (iii) | `` assert.equal(await page.evaluate(handles => handles[0] === document.querySelector('#quotaCards .quota-card') && handles[1] === document.querySelector('#quotaCards [data-quota-details]') && handles[2] === document.querySelector('#quotaSheet .quota-sheet-account') && document.querySelector('#quotaSheet').open, handles), true) `` |
| 113 #1 | (i) | `` assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true) `` |
| 115 #1 | (iii) | `` assert.equal(await page.evaluate(() => window.uiMotion.activeCount), 0) `` |
| 116 #1 | (i) | `` assert.deepEqual(errors, []) `` |
| 116 #2 | (iii) | `` assert.equal(fs.existsSync(path.join(quota, 'codex-homes')), false) `` |

#### scripts/m1/visual-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 35 #1 | (iii) | `` assert(fromLegacy(account.quota, account.plan), 'Synthetic quota must satisfy the current cache contract') `` |
| 44 #1 | (iii) | `` assert.equal(sizes.length, 3) `` |
| 44 #2 | (iii) | `` assert(size.width >= 260, 'cards are at least 260 px') `` |
| 44 #3 | (iii) | `` assert(Math.abs(size.width - size.height) < .01, 'cards are squares') `` |
| 44 #4 | (iii) | `` assert(Math.abs(size.width - sizes[0].width) < .01, 'cards share one size') `` |
| 47 #1 | (iii) | `` assert.equal(await zero.locator('.quota-segments').first().getAttribute('aria-valuenow'), '0') `` |
| 48 #1 | (iii) | `` assert.equal(await zero.locator('.quota-segments').nth(1).getAttribute('aria-valuenow'), null) `` |
| 49 #1 | (iii) | `` assert.equal(await zero.getByText('待刷新', { exact: true }).count(), 1) `` |
| 52 #1 | (iii) | `` assert.deepEqual(await dimensions(), expected) `` |
| 56 #1 | (iii) | `` assert.equal(await page.locator('#quotaSheet [data-provider-account="' + await zero.getAttribute('data-connection') + '"] .quota-sheet-pool li').count(), 3) `` |
| 85 #1 | (i) | `` assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true) `` |
| 87 #1 | (i) | `` assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true) `` |
| 90 #1 | (i) | `` assert.deepEqual(errors, []) `` |
| 91 #1 | (iii) | `` assert.equal(audit.enabled, false) `` |
| 91 #2 | (iii) | `` assert.equal(audit.collecting, false) `` |
| 91 #3 | (iii) | `` assert.equal(audit.audit, null) `` |

#### scripts/m1/render-performance-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 61 #1 | (iii) | `` assert(glyphs.digits > 0 && glyphs.plain && !glyphs.moving && glyphs.transform === 'none', 'settled glyphs use normal text rendering at ' + zoom) `` |
| 74 #1 | (iii) | `` assert(Math.abs(rolling.y - rolling.expectedStart) < rolling.digitHeight * .75, 'a settled digit resumes from its previous value, not zero') `` |
| 91 #1 | (i) | `` assert.deepEqual(errors, []) `` |
| 91 #2 | (iii) | `` assert(report.ledgerUnchanged) `` |
| 92 #1 | (iii) | `` assert(switched.credit <= 2, 'wallet entry must not redraw geometry for every height frame: ' + switched.credit) `` |
| 93 #1 | (iii) | `` assert(burst.cards <= 1 && burst.hero <= 1 && burst.credit <= 1, 'unchanged notification burst cannot rebuild each page: ' + JSON.stringify(report.burst)) `` |
| 94 #1 | (iii) | `` assert.equal(idleTrack, 'none', 'settled card text must leave the transformed track') `` |
| 96 #1 | (iii) | `` assert(report.burst.p95Ms <= idle * 2 + 1 && report.burst.maxMs < 50, 'notification work must meet the measured idle frame budget') `` |

<!-- /ASSERTIONS:M6 -->

## 7. 待决问题

| 编号 | 统一裁决内容 | 原因/范围 |
|---|---|---|
| Q1 kit控制能力 | Password字段与pattern/autocomplete/spellcheck的批准API；拖动排序/Alt箭头、轮播轨道/动态高度/inert/手势的kit实现接口。 | M3k尚缺，不能输入secret用明文text或页面直接Motion；pattern原Google/组织/工作区校验必须保留。 |
| Q2 图表和共享边界 | 由Claude给环/条/时间针/阶梯/钱包图形及数据滚动的接口；确认quotaHost/Ui、provider只读状态与M4/M8兼容公开对象，M6保留ui-carousel直到M8。 | 依§9.2只列现状，无自选chart属性；影响多页，裁决前不开始实现。 |
| Q3 视觉映射 | 方形卡/钱包/失败带/同账号合卡、主数字档位、Sheet尺寸/多账号导航/固定footer、需求处理与生命周期/登录故障颜色；过期弱化对比不小于规范要求。 | 旧样式有非规范字号/透明/700字重/混色；不自行选色/加例外或借Meter.done。 |
| Q4 悬停与无障碍 | 环、时间针、阶梯、票据原title/读数和keyboard/等价详情数据表的接口；指针滑动与翻页、长按排序冲突处理。 | 原阶梯菱形只有pointer读数；不得凭迁移新增/删掉hover或丢键盘可达，需明确等价检查。 |
| Q5 旧数据/文案疑点 | tileOf与时间针未报告用“—”映射Value；summary复制不按当前filter但原注释称“页上卡片”；详情旧“凭据只在内存/重启需提供”与实际remembered加密恢复不符。 | cards:535–536、summary:769–779、renderSheet:464、hero:85；只记录，既有文案/数据不得自行修。 |
| Q6 旧测试形态 | 图形几何和DOM内部选择器如何换到新kit；保留方形/命中/稳定节点/延时与性能目的，旧动画时长用规范终态/中断证据接替的具体清单。 | 本次没有放宽/删除断言；若单项须保留legacy按§9.4留原代码/DOM/测试，不用假placeholder。 |

## 8. 验证与停止点

本页只静态源码/AST逐assert/ID/公开全局/图形CSS与token读取，未执行本页build/verify/runtime/foundation/smoke/账号或provider测试；M3前置十组静态页面对比不等于三首屏/连接态验收。

实施后应按计划1280×900深浅+同态before，三pane及卡片/详情/连接route/菜单全部打开态，unknown/0/partial/stale/no-resource/error/busy/cooldown，circle/title/针/阶梯读数、off/reduced、窄屏/缩放、跨页/drag/IME。每页门槛与映射落地后才下一页，正式打包留M9。五份盘点写完交付并停，不因本文件问题替Claude做选择。

<!-- IDS:M6 -->

## 附录：ID 与反向引用静态检索

以下索引固定到main 4f77437。完整静态ID及脚本赋值ID如下；循环生成的data-*行/控制也必须按正文覆盖，不把这个索引误当全部功能。

```text
quota quotaSummary quotaMeasure quotaInterval quotaCopy quotaRefreshAll quotaNotice
quotaError providerQuotaMessage quotaOverview quotaAttention quotaCardsBar quotaFilter quotaCards
quotaHiddenLine quotaIdleSection quotaIdleTitle quotaIdle quotaSourcesLink quotaExample quotaSheetTitle
quotaRange providerConnectForm providerConnectTitle providerAdapter providerRouteNote providerAlias providerCredentialField
providerCredential providerConnectError providerGuide providerConnectSubmit providerLoginMethodField providerLoginMethod providerRememberField
providerRemember providerProjectField providerProject providerCookieField providerCookieConsent providerUserAgentField providerUserAgent
providerOrganizationField providerOrganization providerWorkspaceField providerWorkspace providerCredentialHelp providerConnectDialog providerCredentialLabel
quotaLoginDialog quotaLoginTitle quotaClose quotaAlias quotaLoginStart quotaLoginStatus quotaCancel
quotaSheet quotaSheetContent
```

| 文件与行号 | 命中ID（候选，需按正文耦合表区分DOM访问/普通字段/注释） |
|---|---|
| agent-setup-ui.js:3 | quota |
| agent-setup-ui.js:42 | quota |
| cost-page.js:281 | quota |
| cost-page.js:282 | quota |
| cost-page.js:283 | quotaSummary |
| cost-page.js:285 | quota |
| cost-page.js:287 | quota |
| cost-page.js:307 | quota、quotaSummary |
| cost-page.js:308 | quota |
| insights-ui.js:32 | quota |
| motion.js:106 | quotaMeasure、quotaFilter、quotaRange |
| motion.js:145 | quotaError、quotaLoginStatus |
| preview.js:897 | quota |
| preview.js:935 | quota |
| serve.js:34 | quota |
| source-connections-ui.js:11 | quota |
| source-connections-ui.js:12 | quota |
| source-connections-ui.js:14 | quota |
| source-connections-ui.js:20 | quota |
| source-connections-ui.js:23 | quota |
| source-connections-ui.js:32 | quota |
| source-connections-ui.js:33 | quota |
| sources-ui.js:145 | quota |
| sources-ui.js:148 | quota |
| sources-ui.js:149 | quota |
| window-shell.js:4 | quota |
| window-shell.js:43 | quota、quotaRefreshAll |

原始索引与assert全文保存在未跟踪的 `artifacts/ui-mig/inventory-20261025/index.json`，不属于运行验收。

<!-- /IDS:M6 -->

署名：Codex
