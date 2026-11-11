# M4 来源管理迁移盘点 · 2026-10-25

## 状态、基线与边界

仅交付计划 §9.2 的盘点，不实现、不退役旧代码，等待五页统一裁决。分支 `ui/mig-m4-m8-inventory` 从本地 main `4f7743773f6fbf9db8b541604ebccb7d85880d2b` 新建。下文行号固定到这个基线；阶段二须复核当前源码。无目录前缀的产品文件均在 `design/desktop-reference/`，UI 套件在 `scripts/m1/`。

已按指定顺序复读计划§9、M1–M3审核、M3示范记录，再依§0.1复读全部规范。M3收尾1已先通过，证据和范围见 `UI-MIG-M3-20261025.md` 新增的Codex收尾记录。CodeGraph不可用，采用源码、AST断言索引、ID和全局双向检索；无子代理。本轮仅盘点，不运行真实来源、配置、安装、登录、额度、网络或外部命令，不改后端/preload/IPC，不动kit/vendor/theme/token/设计检查，不合main或远程写入。

## 1. 功能清单

| 编号 | 旧行为、状态、控件与边界 | 出处 |
|---|---|---|
| F1 | 来源页标题、sourceSummary、全部读取/全部停用、重新检查；bulk仅出现当前适用动作，无来源禁用；切换bulk时焦点随可见动作转移。 | `index.html:116`；`sources-ui.js:201`–235、278–280 |
| F2 | 首次进入检查位置；普通进入只discover，显式重新检查才discover后refresh；busy分阶段文字、aria-busy、阻止重复与恢复错误开关；采集中禁用刷新。 | `sources-ui.js:59`–93、210–224、280–281 |
| F3 | 保存来源成功但discover失败，显示新开关/路径且文件信息待检查；只重试检查，不能误报保存失败或重复写；真正失败保留上次确认状态并允许重试原动作。 | `sources-ui.js:50`–57、79–105、218–223 |
| F4 | 内置Agent每行官方图标、名称、读取状态、真实样本核对标记、程序状态、账号额度摘要、问题入口；unverified文案是“已读取”，不伪装真实验证。 | `sources-ui.js:19`–34、122–133、147–192 |
| F5 | 单Agent读取switch；停用保留历史；路径状态included/excluded/stopped分别显示。恢复自动位置只在有自定义路径/排除时出现。 | `sources-ui.js:108`–120、166–192、273 |
| F6 | 读取位置disclosure记住展开Agent；同事件回合render不吞展开意图；每路径来源、文件/目录、缺失/无法读取/文件数/问题原因；未知文件数不是0。 | `sources-ui.js:134`–144、189–191、274–277 |
| F7 | 手动路径“移除”、自动路径“排除”、已排除“重新读取”；添加目录，Cursor选择用量文件；选路径后暂停采集，检查失败仍保留已保存路径；取消/重叠拒绝不删历史。 | `sources-ui.js:94`–105、134–144、183–184、251–263 |
| F8 | 完整路径原生title与点击/Enter/Space复制；优先clipboard，失败用bridge.copyText，成功toast含完整路径；提示属于本机，不加入导出。 | `sources-ui.js:139`、239–249、264–272 |
| F9 | 暂不支持Agent只展示目录marker，未发现/未检查分别空文案；读取summary显示enabled/全部/记录文件数量。 | `sources-ui.js:212`–235 |
| F10 | snapshot/无bridge只读模式与纯演示模式不同；演示合成discover与路径开关不访问本机；来源不可用保留旧发现和历史。 | `sources-ui.js:8`–10、39–49、62–78、108–120 |
| F11 | 来源行“管理”打开对应Agent的共用管理sheet：程序、用量读取、账号额度、安装与恢复；打开仅读saved-fact状态，失败可重新获取；新请求/关闭使旧结果失效。 | `agent-setup-ui.js:1`–35、39 |
| F12 | 管理sheet的指南步骤、官方只读安装命令、最近入口扫描和覆盖限制；显式复制/打开指南/元数据扫描，含revision；执行中禁用，取消/失败/成功分别现有文案；查看位置关闭sheet再聚焦来源。 | `agent-setup-ui.js:14`–28、40–54 |
| F13 | 安装与更新总sheet：每Agent状态/本应用管理或外部安装/版本未知/最新版本；检查全部、全部升级、安装/升级/重装、官方下载、复检、安装界面已关闭、取消、复制启动命令按能力出现。 | `agent-install-ui.js:5`–43、57–63 |
| F14 | 安装stage、下载百分比与尝试次数；异步更新串行合并，当前行进度和焦点保留；本机维护标记禁用产品安装，无rollback入口；awaiting-installer不能当已安装。 | `agent-install-ui.js:13`–56 |
| F15 | 来源账号摘要通过connections内存读取；只支持用量的来源无额度入口；失效读取保留上次状态并标stale；点击支持的摘要导航额度卡，不启动登录/查询。30秒只读内存timer仅页可见。 | `source-connections-ui.js:1`–44 |
| F16 | Agent配置：内置Agent选择、用户级/项目级、MCP/Hooks/Skills类别；目前Codex/Claude，其它禁用并明确不适配；选择目录不读内容，选择会话内有效。 | `config-health-ui.js:4`–20、22–31 |
| F17 | 配置选择/检查/清除/取消；检查busy、timeout、cancel、permission/parse/limit/变化错误；仍显示上次结果；按文件disclosure列结构定位和脱敏原因。无结果和该类无覆盖项不同。 | `config-health-ui.js:20`–61 |
| F18 | 管理当前类别共用sheet，显示精确管理位置、范围；list/重新读取/导入/编辑/开关/预览/应用/撤销；现有命令、参数、环境和请求头不回显，空白保留原值。 | `config-manager-ui.js:3`–35、46–51 |
| F19 | MCP type/command/args/url；hooks command/prompt/url/server/tool/timeout；skill name/description；maxLength4096、autocomplete off；JSON参数格式错误与空patch拒绝；编辑仅草稿，输入使preview失效。 | `config-manager-ui.js:56`–68 |
| F20 | 开关与本文件hooks全局开关均先preview；规范化格式/注释提示、备份加密/CAS与操作摘要；导入不覆盖同名、不执行；取消预览不写；错误保持原内容。 | `config-manager-ui.js:12`、17–20、45、53–70 |
| F21 | 应用/撤销成功与随后health/list刷新失败分开报告；不能重复应用；undo仅本次打开最近成功修改；busy不能close/cancel；关闭release不泄漏上下文。 | `config-manager-ui.js:15`、35–44、50–54、71 |
| F22 | 添加我的Agent五步：格式/目录→字段→计数→预览→保存；standard/claude固定语义，mapped字段映射；name必填≤80；未预览不采集。 | `custom-sources-ui.js:7`–18、22–31、46–60 |
| F23 | 导入配置仍需选目录；读字段结构最多200行/1MiB、只展示字段路径/类型与合规示例，不显示正文/原始身份；datalist可手输路径；可选JSON过滤textarea。 | `custom-sources-ui.js:11`–12、36–55、59–66 |
| F24 | mapped需明确input含缓存、output含推理、时间ISO/ms/s；累计/汇总仍显示不支持，不能相加；未知计量保持未知；前后步切换、busy、IME确认键。 | `custom-sources-ui.js:13`、20、36–45、68–84 |
| F25 | 完整预览展示文件、调用、Token、新增/替换/移除/保留/重复/冲突/invalid/filtered/unsupported/priced及逐字段unknown计数；修改后preview失效，stale不应用。 | `custom-sources-ui.js:69`–81 |
| F26 | 保存并启用使用preview opaque id，成功关sheet重载来源；编辑、启停、移除保留历史、导出配置、回退上一版，archived不留写入口，混合旧规则提示。 | `custom-sources-ui.js:56`、79–94；`sources-ui.js:154`–165 |
| F27 | “需要处理”集中来源/费用/会话/预算，live采集失败置顶且不可知悉；筛选、六条折叠/全部、已知悉/恢复待办、显示已知悉、omitted不宣称全健康。 | `insights-ui.js:34`–119、191–208；`index.html:116` |
| F28 | 问题操作去来源/定价/会话/预算；采集错误显示阶段/原因/只允许公开代码title，重试只触发原refresh；侧栏计数与其它页摘要同步；定位后标题焦点。 | `insights-ui.js:59`–70、78–122、195–208 |
| F29 | 解析能力disclosure：格式、规则/混合历史、真实验证层级、输入缓存/输出推理语义、逐字段已报告记录、Token/成本/会话；价格未知仍未定价，不能从用量推账号额度。 | `insights-ui.js:30`–32、212–213 |
| F30 | 原生title读数：路径全名、Agent hint、status验证说明、采集诊断公开代码；不新增或删除hover卡，原普通控件hover保留kit自带反馈。 | `sources-ui.js:139`、151、186；`insights-ui.js:70`、108 |
| F31 | 键盘switch/按钮/分类/disclosure；行刷新回原控制；sheet进入/Tab/Escape/回焦；嵌套跳转先关旧sheet；窄屏footer应用动作仍可见；reduced/off完成终态。 | `sources-ui.js:195`–209、264–277；`agent-setup-ui.js:39`–42；`config-manager-ui.js:50`–51；旧套件映射 |

## 2. 数据清单

| 数据/动作 | 现有接口或模块 | 必须保留的语义 |
|---|---|---|
| 位置发现/显式采集 | usageBridge.sources / refresh；sources-ui:59–78 | discover不是读取内容；显式refresh才采集；无新自动扫描或外部路径。 |
| 来源保存/选择 | changeSource(name,agent,value)、chooseSource(agent) | sourceSaved/selection/discovery分开；已保存但检查失败保留新状态；历史不删除。 |
| 已保存source状态、collection | preview.js向sourcesUi.render/collection/notice喂snapshot | partial描述扫描，价格仍按记录质量；lastSuccess和当前错误并列，不伪装刷新成功。 |
| 账号摘要 | connections、connectionState.projectConnections/quotaDescription/CAPABILITY_LABELS；source-connections-ui:5–30 | saved-memory-only，unsupported/partial/disconnected/stale区别；不调用provider刷新/登录，不跨账号相加。 |
| 管理与指南 | agentSetup(agent)、agentSetupAction({agent,actionId,revision}) | 打开只读，固定动作；不传任意URL/命令/路径，不执行发现的程序。 |
| 安装saved facts/显式动作 | installers、installerAction({agent,action,revision})、onInstallUpdate | 程序version unknown不等missing；进度/awaiting不等成功；M4仅迁现有UI，合成验收不能真实安装。 |
| 静态配置 | configState/Choose/Check/Forget(agent,scope)、configCancel | 选择不读取；不适配不扫描；检查只结构且脱敏，不执行命令/MCP/hook/Skill。 |
| 配置管理 | configManage(action,agent,scope,kind,request)：list/import/preview/apply/undo/release | scope精确、opaque id/revision不丢、先预览后写、加密失败拒绝、写成功但刷新失败不能重写；留空保密值保留。 |
| 自定义来源 | customDraft/Import/Choose/Sample/Preview/Apply/Export/Change | 只传opaque grant/preview id，不接收外部文件正文；fields与unknown计数保留；未报告字段不是0；源目录重叠、链接、规则过期按原错误拒绝。 |
| 需要处理/能力 | insights-ui的workbench/attention、saveWorkbench(acknowledge)、usageData.collection；sourceCostInsights.capability | 只聚合保存事实；跨页诊断保留；omitted不当全量；live故障不允许知悉隐藏；不会停止Agent。 |
| 格式化/排序/预览 | sources-ui:17–18、50–57、108–144；install:23–26；custom:36–45、74–76；insights:30–122 | 旧侧纯计算/文案原样提取UMD并测，再供React；既有displayValues/connectionState/pricingLabels复用，不在TS重算或替换formatter。 |

桥接签名以 `src/quota/preload.js` 为准；M2桥接已包含上述方法，computed key调用configChoose/Check/Forget也在清单内，不能因静态点号索引漏掉。文件与记录数中的明确0是已发现计数；path.files=null显示“无法读取”；stale优先显示待检查。其它null缺省疑点见问题表，未修正数据。

## 3. 耦合及迁移处理提案

本节只描述必须保留的边界，不代写尚未裁决的新接口。实现结构照M3：`ui/src/pages/sources/`按区块拆；旧侧`window.sourcesHost`给数据/动作，React拥有`window.sourcesUi`；旧模块不查React DOM。Host精确契约和共享文件范围由统一裁决确认。

| 编号 | 依赖/反向消费者 | 处理要求 |
|---|---|---|
| C1 | preview.js:824–825、941、985、1119→sourcesUi；外框路由897/935；window-shell.js:34/43直接定位sourceRefresh | 保留render(statuses)/collection/notice/reload/focus的行为与事件；原生刷新改窄接口；section属性保留，不能保留隐藏旧按钮供旧代码点击。 |
| C2 | `sourcesUi`公开在sources-ui:282–293；M3 `ui/src/data/settings-host.ts` focusSource；定价帮助、usage来源、quotaSourcesLink、费用data-cost-sources都跳此页 | focus(agent)导航、展开、滚动、焦点，刷新/路由后意图保留；其它页不读取新DOM。 |
| C3 | source-connections-ui→sourcesUi.render、quotaUi.openSource；onUpdate/30秒timer/visibility；导出sourceHtml/sheetHtml给source/setup；provider-quota-ui.js:61/70/72→sourceConnectionsUi.reload | 改纯数据/text→kit组合，同页旧HTML消费者一起退役；额度调用仍用现有openSource；provider端连接/移除/更新后仍能刷新来源内存状态，保留兼容reload及timer卸载，不变provider节流。 |
| C4 | agentInstallUi.status/section/reload被sources与agentSetup使用；installer-change/connections-change更新管理sheet | 一份saved state，多表面共享；保留订阅、串行加载、关闭/换Agent旧响应不覆盖；不复制第二安装状态机。 |
| C5 | configHealthUi.refresh由config-manager finishWrite调用；manager读取configAgent/Scope/Categories DOM | 用明确selection数据替代DOM查值；先保存结果再尝试刷新，坏刷新不否认写成功；scope改动丢旧preview/context，release保留。 |
| C6 | customSourceAdd插入sourceRefresh前；custom-source监听sourceRows；自定义更新agentCatalog/source-catalog供用量/会话/定价 | 用React统一所有权，写入与目录grant仍旧Host；编辑/停用/归档不丢历史，动态Agent名称/图标随原catalog通知。 |
| C7 | insights-ui.js:96–122、191–213访问sourcesAttention/attentionFilter/sourceRows；同时拥有费用预算/项目和跨页notice | M4仅迁来源“需要处理”和能力渲染；M8预算/项目仍旧侧，注意事项action/state不可拆成不连通副本；边界见Q2。 |
| C8 | insights-ui的sourceCostInsights.capability返回HTML给sources行；其它页面notice通过data-attention-open定向 | 计算/文案UMD，React组kit；跨页openAttention(kind)入口仍兼容。kind=budget动作最终进费用预算，不把预算写逻辑搬M4。 |
| C9 | sourceDialog/demoDirectory/selectDirectory在index.html:126、preview.js演示选择；当前sources代码还带applyDemo | sourceDialog也是M4盘点对象；演示不打开真实picker，真实bridge走原对话框；预览/桌面模式不混用。 |
| C10 | sources.css、agent-setup.css、agent-install.css、config-health.css、custom-sources.css、integrated-insights.css及style/polish/containers/motion的混合规则；index/legacy/serve/资源检查 | 仅确认无其它消费者后逐选择器退役；M9外框、M8预算与未迁移页规则保留；build生成物只由build:ui产生。 |

外部ID检索中的普通 `sources` 数据属性/注释不等于DOM依赖，例如pricing-view的sources结果字段、preview导出参数，不据此扩大范围。详细ID与反向命中放附录；另查公开全局、data-source-*、data-custom-*、data-config-*、data-attention-*、source-catalog/installer-change/connections-change。

## 4. kit 映射

| 功能 | 既有组件，含M3k | 缺口/约束 |
|---|---|---|
| 标题/工具条/来源行 | PageHeader、SectionHeader、ListRow、AgentMark、Badge、Button、Switch | 36px行/控件及语义色；原多行行内容密度与整体布局按裁决，不自选compact。 |
| 路径、能力、检查文件、说明 | Disclosure、ListRow、Value、CodeBlock、ScrollArea | CodeBlock可用于只读命令；完整路径title/复制需保留可键盘入口，不能变只读装饰文字。 |
| 需要处理/错误/状态 | SubTabs/Segmented、CheckboxGroup、Banner、EmptyState、Button | 保留live/ack/omitted/重试语义；具体分组布局与Badge警示适用范围待Q3。 |
| 管理/安装/配置/自定义五步弹窗 | Sheet、SectionHeader、SettingRow、Disclosure、Form、TextField、Select、Button | busy拒绝onOpenChange可用受控Sheet，不再请求新Close API；尺寸/双层关系与固定footer见Q3。 |
| 安装进度 | Value / Figure；Meter仅适用已裁决覆盖场景 | 安装百分比不是“已计价”，不能借用Meter.done色；进度视觉见Q4，不能自行加success色。 |
| 自定义字段建议 | Combobox / TextField（现有API） | 原datalist可自由填写未列路径，Combobox仅列项选择；需Q1，不得丢自由输入。 |
| JSON记录过滤 | **无可编辑多行kit控件** | CodeBlock只读、TextField单行，见Q1；不可擅自用原生textarea。 |
| config字段保密输入 | TextField、Select | maxLength已有；autocomplete=off尚不在公共API，见Q1；不回显旧值。 |

M3k已有的Sheet/Form/Select disabled、Input有效性、Combobox/IME、ScrollArea、DataTable rowKey等直接沿用，不重新请求已裁决能力。提示用旧usageData.toast，M9前不新增Toast宿主。纯计算先UMD及单测，不写入组件。

## 5. 规范带来的外观差异

1. 原按钮/select→36px kit、控件8/弹出层12/卡片16；页标题/说明/行文字归六角色，数值tabular-nums；区块gap-8、头部gap-6、标题内容gap-3。
2. 原native dialog→Sheet，开slow/退出slow.exit；details→Disclosure moderate；分类与开关用既有kit；不保留旧CSS固定时长。
3. 路径/能力/规则统一分隔行，禁止卡片套卡片；具体多行/网格/宽度/Sheet size未定，见Q3。
4. 可未知计量用Value；原path错误/缺失文案仍保留，不把“无法读取”无理由改成数值。身份色只标Agent；安装/静态健康不可自定好坏色。
5. 原title/复制/键盘/诊断悬停内容保留；不写页面hover、不添悬停卡。深色沿fluid，浅色沿批准灰阶；不修改tokens/theme。

## 6. 测试映射

类别：(i)新 `sources-smoke-ui-test.js` 的页面/错误/主题/窄屏/焦点基础；(ii)原样提取计算与现有纯模块单测；(iii)新的页面回归或保留的跨页集成；(iv)经裁决的实现形态退役。**本次没有批准或执行退役**，DOM选择器可替换，行为目的不可丢。跨页断言在原套件仍保留至其所属页迁移，不把共享流程误删；同一断言重用一份场景，不重复增加套件。

最少套件按计划逐条列在附录A，行号后的`#n`区分同一行多个assert；保留完整表达式以免概括掉隐私/精确值/副作用检查。pageerror/console、URL/标题和窄屏基础归(i)，其它归(iii)。来自fixture/backend的约束仍在联合回归检查，后端单元测试原样保留；纯计算提取补(ii)，不能仅测试React重写的结果。

状态等待也要迁移：install queued→downloading→complete/awaiting-installer与取消/失败；setup saved-fact→失败→重试；config choose后无结果→check busy→summary，preview前原字节→apply/undo→刷新失败，restart无grant；custom五步、字段结构、preview ready/stale、保存后catalog/history更新；source saved/discovery失败、retry检查、live错误恢复。当前套件的waitFor/until及failure注入与其后断言是一组场景，不只复制assert。

| 跨页旧套件 / 段落 | 必须迁移的检查与分类 |
|---|---|
| agent-ui:49–64、72–83 | (iii)来源行数/title、开关持久、同回合disclosure不丢、排除/恢复、拒绝越界路径、bulk、选择Cursor取消/拒绝/成功与采集暂停/总量/脱敏；其余用量/设置部分保留。 |
| interaction-reliability 的source段 | (iii)失败保存回滚可见switch、busy不允许批量/refresh重入、并发保存选中新状态、保留历史；(i)窄屏/无console错误；其余页不删。 |
| workbench:33、49–55 | (iii)能力目录含动态来源、诊断按页面归属、ack/指纹变化再提醒、来源展开与跨页草稿不丢；费用/预算/导出断言仍归M8，session归M5。 |
| unpriced-guidance:22–26 | (iii)从React价格帮助定向来源、关原sheet、读取位置展开、busy原因重绘仍在；价格语义和帮助排版归已迁M3。 |
| style-alignment来源截图与narrow循环、polish:19/48–49 | (i)深浅/narrow/路由、前进后退与标题；(iii)路径和能力disclosure可打开；不迁费用布局断言。 |
| M3 settings-smoke / settings-host focusSource | (iii)关于来源点击仍跳转并展开正确Agent；定价帮助定位同样可用，不改M3示范行为。 |

纯数据(ii)范围：sourceLine/path状态与公开错误文案、selection合并/stale、安装stage/版本/进度文案、config选择/摘要/错误/编辑patch、custom config/预览行与unknown计数、insights attention/能力投影；调用现有模块的价格/账号投影不重算。已有源策略/配置管理/installer/custom/parser/connectionState单元与安全合同继续保留。

<!-- ASSERTIONS:M4 -->

### 6.1 最少套件：逐断言位置与目标

同一行多个调用分别编号；同一调用位于循环时保留全部fixture/参数，不把多个case缩成一次。表达式是静态源码抄录，不代表本轮执行成功。

#### scripts/m1/agent-install-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 39 #1 | (iii) | `` assert.match(await row('mimo').innerText(), /未安装/) `` |
| 41 #1 | (iii) | `` assert.equal(await row('mimo').locator('[data-install-action="install"]').isDisabled(), true) `` |
| 45 #1 | (iii) | `` assert.match(await row('mimo').innerText(), /2\.0\.0/) `` |
| 49 #1 | (iii) | `` assert.equal(await row('claude').locator('[data-install-action="rollback"]').count(),0) `` |
| 52 #1 | (iii) | `` assert.equal(await row('claude').locator('[data-install-action="install"]').isDisabled(),true) `` |
| 52 #2 | (iii) | `` assert.match(await row('claude').innerText(),/本机工具/) `` |
| 54 #1 | (iii) | `` assert.match(await row('cursor').innerText(), /尚未确认安装完成/) `` |
| 57 #1 | (i) | `` assert(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)) `` |
| 58 #1 | (iii) | `` assert.match(await sheet.innerText(), /2.1.0/) `` |
| 59 #1 | (iii) | `` assert(!effects.calls.some(call=>Object.hasOwn(call,'allowGoverned')\|\|call.action==='rollback')) `` |
| 59 #2 | (iii) | `` assert.equal(effects.opened.length, 1) `` |
| 59 #3 | (iii) | `` assert.deepEqual(effects.official, ['https://cursor.com/download']) `` |
| 59 #4 | (iii) | `` assert.equal(effects.copied.length, 1) `` |
| 59 #5 | (iii) | `` assert(!effects.calls.some(call => Object.keys(call).some(key => /url\|command\|path/i.test(key)))) `` |
| 60 #1 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), ledger) `` |
| 60 #2 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(quota, 'quota-cache.json')), quotaBytes) `` |
| 60 #3 | (iii) | `` assert(!fs.existsSync(path.join(quota, 'codex-homes'))) `` |
| 60 #4 | (i) | `` assert.deepEqual(errors, []) `` |

#### scripts/m1/agent-setup-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 27 #1 | (iii) | `` assert.match(await dialog.textContent(), /安装与故障恢复/) `` |
| 27 #2 | (iii) | `` assert.match(await dialog.textContent(), /读取已停用/) `` |
| 30 #1 | (iii) | `` assert.match(await dialog.textContent(), /积分/) `` |
| 31 #1 | (iii) | `` assert.match(await dialog.textContent(), /普通聊天/) `` |
| 36 #1 | (iii) | `` assert.match(await dialog.textContent(), /仍需核验/) `` |
| 36 #2 | (iii) | `` assert.deepEqual(fs.readFileSync(file), bytes) `` |
| 40 #1 | (iii) | `` assert.deepEqual(effects.opened, Object.values(definitions).map(item => item.install)) `` |
| 40 #2 | (iii) | `` assert.deepEqual(effects.copied, ['irm https://antigravity.google/cli/install.ps1 \| iex']) `` |
| 44 #1 | (i) | `` assert.equal(await page.evaluate(() => document.getElementById('agentSetupDialog').scrollWidth <= document.getElementById('agentSetupDialog').clientWidth + 1), true) `` |
| 45 #1 | (i) | `` assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true) `` |
| 47 #1 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), ledger) `` |
| 47 #2 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(quota, 'quota-cache.json')), quotaBytes) `` |
| 47 #3 | (iii) | `` assert(!fs.existsSync(path.join(quota, 'codex-homes'))) `` |
| 47 #4 | (i) | `` assert.deepEqual(errors, []) `` |

#### scripts/m1/config-health-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 23 #1 | (i) | `` assert.match(page.url(), /^file:/) `` |
| 23 #2 | (i) | `` assert.match(await page.title(), /Agent Usage/) `` |
| 24 #1 | (iii) | `` assert.match(await page.locator('#agentConfigCenter').innerText(), /尚未选择/) `` |
| 24 #2 | (iii) | `` assert(await page.locator('#configCheck').isDisabled()) `` |
| 27 #1 | (iii) | `` assert.match(await page.locator('#configSelection').innerText(), /已选择/) `` |
| 27 #2 | (iii) | `` assert.match(await page.locator('#configSummary').innerText(), /尚无/) `` |
| 29 #1 | (iii) | `` assert.match(await page.locator('#configSummary').innerText(), /发现问题/) `` |
| 30 #1 | (iii) | `` assert.match(await page.locator('#configResults').innerText(), /配置项 1/) `` |
| 30 #2 | (iii) | `` assert(!((await page.locator('#agentConfigCenter').innerText()).includes('PRIVATE'))) `` |
| 31 #1 | (iii) | `` assert.match(await page.locator('#configResults').innerText(), /codex/) `` |
| 32 #1 | (iii) | `` assert.match(await page.locator('#configSelection').innerText(), /尚未选择/) `` |
| 35 #1 | (iii) | `` assert.match(await page.locator('#configSummary').innerText(), /发现问题/) `` |
| 36 #1 | (iii) | `` assert.match(await page.locator('#configSelection').innerText(), /尚未适配/) `` |
| 36 #2 | (iii) | `` assert(await page.locator('#configCheck').isDisabled()) `` |
| 37 #1 | (iii) | `` assert.match(await page.locator('#configSelection').innerText(), /尚未选择/) `` |
| 39 #1 | (iii) | `` assert(!((await page.locator('#configSummary').innerText()).includes('尚无'))) `` |
| 40 #1 | (iii) | `` assert.match(await page.locator('#configSelection').innerText(), /已选择/) `` |
| 42 #1 | (i) | `` assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false) `` |
| 47 #1 | (iii) | `` assert.equal(fs.readFileSync(config,'utf8'), contents, 'preview cannot write') `` |
| 49 #1 | (iii) | `` assert.equal(require('../../src/m1/config-health-syntax').toml(fs.readFileSync(config,'utf8')).features.hooks,true) `` |
| 50 #1 | (iii) | `` assert.equal(fs.readFileSync(config,'utf8'),contents) `` |
| 64 #1 | (iii) | `` assert.match(await page.locator('#configManagerMessage').innerText(),/^已应用/) `` |
| 64 #2 | (iii) | `` assert(!(await page.locator('#configUndo').isDisabled())) `` |
| 64 #3 | (iii) | `` assert(await page.locator('#configImport').isDisabled()) `` |
| 64 #4 | (iii) | `` assert(await page.locator('#configWritePreview').isHidden()) `` |
| 65 #1 | (iii) | `` assert.match(await page.locator('#configManagedRows').innerText(),/列表尚未读取/) `` |
| 65 #2 | (iii) | `` assert(!((await page.locator('#configManagedRows').innerText()).includes('无法管理'))) `` |
| 66 #1 | (iii) | `` assert.equal(require('../../src/m1/config-health-syntax').toml(fs.readFileSync(config,'utf8')).features.hooks,true) `` |
| 69 #1 | (iii) | `` assert.match(await page.locator('#configManagerMessage').innerText(),/配置列表未能重新读取/) `` |
| 69 #2 | (iii) | `` assert(await page.locator('#configUndo').isDisabled()) `` |
| 69 #3 | (iii) | `` assert.equal(fs.readFileSync(config,'utf8'),contents) `` |
| 70 #1 | (iii) | `` assert.equal(await app.evaluate(() => globalThis.configWorkflowFixture.stateReads),0) `` |
| 74 #1 | (iii) | `` assert.match(await page.locator('#configSummary').innerText(),/尚无/) `` |
| 78 #1 | (iii) | `` assert(!fs.existsSync(path.join(home,'.agents/skills/fixture-skill'))) `` |
| 80 #1 | (iii) | `` assert(fs.existsSync(path.join(home,'.agents/skills/fixture-skill/fixture.js'))) `` |
| 82 #1 | (iii) | `` assert(!fs.existsSync(path.join(home,'.agents/skills/fixture-skill'))) `` |
| 85 #1 | (iii) | `` assert.match(await page.locator('#configEditHelp').innerText(),/正文/) `` |
| 85 #2 | (iii) | `` assert(!((await page.locator('#configEditHelp').innerText()).includes('MCP'))) `` |
| 90 #1 | (iii) | `` assert(visibleActions,'apply remains visible outside the scrolling body in a short desktop viewport') `` |
| 94 #1 | (iii) | `` assert.match(fs.readFileSync(path.join(home,'.agents/skills/fixture-skill/SKILL.md'),'utf8'), /BODY_MUST_STAY\n$/) `` |
| 99 #1 | (iii) | `` assert.equal(JSON.parse(fs.readFileSync(path.join(home,'.mcp.json'))).mcpServers['fixture-import'].env.TOKEN,'SECRET_VALUE') `` |
| 99 #2 | (iii) | `` assert(!(await page.locator('#configManager').innerText()).includes('SECRET_VALUE')) `` |
| 100 #1 | (iii) | `` assert.match(await page.locator('#configManagerMessage').innerText(),/JSON 字符串列表/) `` |
| 101 #1 | (iii) | `` assert.match(await page.locator('#configEditHelp').innerText(),/切换连接方式/) `` |
| 103 #1 | (iii) | `` assert.equal(JSON.parse(fs.readFileSync(path.join(home,'.mcp.json'))).mcpServers['fixture-import'].command,'fixture-new') `` |
| 106 #1 | (iii) | `` assert.match(await page.locator('#configSummary').innerText(), /尚无/) `` |
| 107 #1 | (iii) | `` assert.equal(fs.readFileSync(config, 'utf8'), contents) `` |
| 107 #2 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), ledger) `` |
| 107 #3 | (i) | `` assert.deepEqual(errors, []) `` |
| 110 #1 | (iii) | `` assert.match(await restarted.locator('#configSelection').innerText(),/尚未选择/) `` |
| 110 #2 | (iii) | `` assert(await restarted.locator('#configCheck').isDisabled()) `` |

#### scripts/m1/collection-diagnostic-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 42 #1 | (iii) | `` assert.equal(await page.locator('[data-attention-collection]').count(),0,'no item while collection has no error') `` |
| 43 #1 | (iii) | `` assert.equal(await page.locator('#dataBadge').isVisible(),false) `` |
| 48 #1 | (iii) | `` assert.equal(await item.count(),1) `` |
| 48 #2 | (iii) | `` assert.equal(await item.getAttribute('data-attention-item'),'sources') `` |
| 49 #1 | (iii) | `` assert.match(await strong.textContent(),/^最近一次采集没有完成：/) `` |
| 50 #1 | (iii) | `` assert(effect.includes(text),c.name+' effect lacks '+text+': '+effect) `` |
| 51 #1 | (iii) | `` assert(title.includes(text),c.name+' title lacks '+text+': '+title) `` |
| 52 #1 | (iii) | `` assert(!title.includes(c.notTitle),c.name+' title must not show '+c.notTitle) `` |
| 53 #1 | (iii) | `` assert(!effect.includes(c.notEffect),c.name+' effect must not claim '+c.notEffect) `` |
| 54 #1 | (iii) | `` assert.equal(await item.locator('[data-ack]').count(),0,'a live collection failure cannot be acknowledged') `` |
| 55 #1 | (iii) | `` assert.equal(await item.locator('[data-attention-retry]').count(),1) `` |
| 56 #1 | (iii) | `` assert.equal(await page.locator('#sourcesAttention > .attention-item').first().getAttribute('data-key'),'collection','the live failure leads the list') `` |
| 57 #1 | (iii) | `` assert.equal(await page.locator('#dataBadge').isVisible(),true) `` |
| 57 #2 | (iii) | `` assert.equal(await page.locator('#dataBadge [data-attention-open="sources"]').textContent(),'查看原因') `` |
| 72 #1 | (iii) | `` assert.equal(await page.evaluate(()=>document.activeElement?.matches('#dataBadge [data-attention-open]')),true,'focused 查看原因 survives an unchanged update') `` |
| 75 #1 | (iii) | `` assert.equal(await page.locator('[data-attention-collection]').isVisible(),true) `` |
| 78 #1 | (iii) | `` assert.equal(await page.evaluate(()=>window.__retry),1) `` |
| 83 #1 | (iii) | `` assert.equal(await page.locator('#dataBadge').isVisible(),false) `` |
| 84 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/agent-conflict-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 13 #1 | (iii) | `` assert.equal(native.status,'passed') `` |
| 13 #2 | (iii) | `` assert.equal(native.tokens,120) `` |
| 21 #1 | (iii) | `` assert.equal(row.totalTokens,120) `` |
| 21 #2 | (iii) | `` assert.equal(row.estimatedCostUsd,null) `` |
| 21 #3 | (iii) | `` assert.equal(row.inputUncached,null) `` |
| 21 #4 | (iii) | `` assert.deepEqual(row.knownUsage,{}) `` |
| 21 #5 | (iii) | `` assert.equal(await page.locator('#totalCost .cost-value').getAttribute('data-cost-lower'),'') `` |
| 21 #6 | (iii) | `` assert((await page.locator('#totalCost .cost-value').getAttribute('aria-label')).includes('未定价')) `` |
| 22 #1 | (iii) | `` assert(bounds && bounds.y>=0 && bounds.y<await page.evaluate(()=>window.innerHeight)) `` |
| 22 #2 | (i) | `` assert.deepEqual(errors,[]) `` |
| 22 #3 | (iii) | `` assert.deepEqual(hashes(),before) `` |

#### scripts/m1/source-quota-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 32 #1 | (iii) | `` assert.equal(initial.rows.length,11) `` |
| 33 #1 | (iii) | `` assert.equal(setupInitial.state.reason,'scan-required') `` |
| 36 #1 | (iii) | `` assert.equal(foundRuntime.ok,true) `` |
| 36 #2 | (iii) | `` assert.equal(foundRuntime.discovery.selection.executable,runtimeFile) `` |
| 36 #3 | (iii) | `` assert.equal(foundRuntime.discovery.selection.verificationRequired,true) `` |
| 36 #4 | (iii) | `` assert.equal(foundRuntime.discovery.effects.executedCli,false) `` |
| 36 #5 | (iii) | `` assert.deepEqual(fs.readFileSync(runtimeFile),runtimeBytes) `` |
| 36 #6 | (iii) | `` assert(!fs.existsSync(path.join(f.quota,'codex-homes'))) `` |
| 37 #1 | (iii) | `` assert.equal(missingRuntime.discovery.status,'not-found') `` |
| 37 #2 | (iii) | `` assert.equal(missingRuntime.discovery.selection.executable,null) `` |
| 37 #3 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(f.quota,'quota-cache.json')),quotaBefore) `` |
| 39 #1 | (iii) | `` assert.equal((await page.evaluate(()=>window.quotaBridge.antigravitySetup())).state.reason,'cli-missing') `` |
| 40 #1 | (iii) | `` assert.equal(invalidSetup.errorCode,'AGY_SETUP_ARGUMENTS_REJECTED') `` |
| 41 #1 | (iii) | `` assert.equal((await setupAction('copy-install-command')).errorCode,'AGY_SETUP_COPY_FAILED') `` |
| 42 #1 | (iii) | `` assert.equal((await setupAction('copy-install-command')).outcome,'command-copied') `` |
| 43 #1 | (iii) | `` assert.equal((await setupAction('installation-guide')).errorCode,'AGY_SETUP_GUIDE_FAILED') `` |
| 44 #1 | (iii) | `` assert.equal((await setupAction('installation-guide')).outcome,'guide-opened') `` |
| 45 #1 | (iii) | `` assert.equal(staleInstall.errorCode,'AGY_SETUP_ACTION_UNAVAILABLE') `` |
| 45 #2 | (iii) | `` assert.equal(staleInstall.state.reason,'verification-required') `` |
| 45 #3 | (iii) | `` assert.equal(staleInstall.state.quota.ready,false) `` |
| 46 #1 | (iii) | `` assert.deepEqual(setupEffects.copied,['irm https://antigravity.google/cli/install.ps1 \| iex']) `` |
| 46 #2 | (iii) | `` assert.deepEqual(setupEffects.opened,['https://antigravity.google/docs/getting-started']) `` |
| 46 #3 | (iii) | `` assert.deepEqual(fs.readFileSync(runtimeFile),runtimeBytes) `` |
| 47 #1 | (iii) | `` assert.equal((await setupAction('rescan')).state.reason,'cli-missing') `` |
| 47 #2 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(f.quota,'quota-cache.json')),quotaBefore) `` |
| 48 #1 | (iii) | `` assert.match(await codex().textContent(),/2 个连接.*1 个缓存已过期.*1 个缓存待验证/) `` |
| 50 #1 | (iii) | `` assert.match(await personal.textContent(),/仅接入用量/) `` |
| 50 #2 | (iii) | `` assert.equal(await personal.locator('[data-source-quota]').count(),0) `` |
| 50 #3 | (iii) | `` assert.match(await page.locator('#sourceRows [data-source-connection="claude"]').textContent(),/支持账号额度.*尚未连接账号/) `` |
| 51 #1 | (iii) | `` assert(!JSON.stringify(initial).includes(secret)) `` |
| 52 #1 | (iii) | `` assert(!fs.existsSync(path.join(f.quota,'codex-homes'))) `` |
| 52 #2 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(f.quota,'quota-cache.json')),quotaBefore) `` |
| 54 #1 | (iii) | `` assert.match(await source.locator('[data-source-connection]').textContent(),/2 个连接/) `` |
| 56 #1 | (iii) | `` assert.equal((await page.evaluate(()=>window.quotaBridge.get())).state.accounts.length,2) `` |
| 56 #2 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(f.quota,'quota-cache.json')),quotaBefore) `` |
| 56 #3 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(f.usage,'statistics.json')),ledger) `` |
| 57 #1 | (iii) | `` assert.equal(await page.locator('#quotaLoginDialog').evaluate(el=>el.open),false,'navigation does not start authentication') `` |
| 65 #1 | (iii) | `` assert.match(await described('codex'),/1 个缓存待验证/) `` |
| 65 #2 | (iii) | `` assert(!JSON.stringify(await page.evaluate(()=>window.usageBridge.connections())).includes('PRIVATE_')) `` |
| 67 #1 | (iii) | `` assert.deepEqual(fs.readFileSync(path.join(f.usage,'statistics.json')),ledger) `` |
| 67 #2 | (iii) | `` assert.equal((await page.evaluate(()=>window.usageBridge.get())).snapshot.daily.reduce((n,r)=>n+r.records,0),1) `` |
| 68 #1 | (iii) | `` assert.match(await codex().textContent(),/1 个连接/) `` |
| 68 #2 | (iii) | `` assert(!await codex().textContent().then(t=>t.includes('PRIVATE_'))) `` |
| 72 #1 | (i) | `` assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)) `` |
| 72 #2 | (i) | `` assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)) `` |
| 73 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/custom-sources-ui-test.js

| 原行号 # 次序 | 类别 | 必须保留的检查（原表达式） |
|---|---|---|
| 39 #1 | (iii) | `` assert(await page.locator('#customSourceEditor').evaluate(e=>e.open)) `` |
| 43 #1 | (iii) | `` assert((await page.locator('#customPreviewSummary').innerText()).includes('120')) `` |
| 48 #1 | (iii) | `` assert(state.snapshot.sourceCatalog[id]) `` |
| 48 #2 | (iii) | `` assert(!JSON.stringify(state.snapshot).includes(sentinel)) `` |
| 48 #3 | (iii) | `` assert(!JSON.stringify(state.snapshot).includes(input)) `` |
| 48 #4 | (iii) | `` assert(!JSON.stringify(state.snapshot).includes('private-id')) `` |
| 50 #1 | (iii) | `` assert.equal(await page.locator('#agentFilter').inputValue(),id) `` |
| 51 #1 | (iii) | `` assert.equal(Number((await page.locator('#totalTokens').innerText()).replaceAll(',','')),120) `` |
| 53 #1 | (iii) | `` assert(sessions.sessions.some(s=>s.agent===id)) `` |
| 53 #2 | (iii) | `` assert(!JSON.stringify(sessions).includes('private-session')) `` |
| 58 #1 | (iii) | `` assert.equal((await page.evaluate(()=>window.usageBridge.pricing())).billing.defaults[id].multiplier,1) `` |
| 61 #1 | (iii) | `` assert.equal((await page.evaluate(()=>window.usageBridge.get())).snapshot.daily.reduce((n,r)=>n+r.totalTokens,0),120) `` |
| 67 #1 | (iii) | `` assert.equal((await page.evaluate(()=>window.usageBridge.get())).snapshot.daily.reduce((n,r)=>n+r.totalTokens,0),120) `` |
| 74 #1 | (iii) | `` assert(!JSON.stringify(config).includes(input)) `` |
| 74 #2 | (iii) | `` assert(!JSON.stringify(config).includes(sentinel)) `` |
| 77 #1 | (iii) | `` assert((await page.locator('#customLocation').innerText()).includes('尚未选择')) `` |
| 81 #1 | (iii) | `` assert.equal((await page.evaluate(()=>window.usageBridge.get())).snapshot.daily.reduce((n,r)=>n+r.totalTokens,0),120) `` |
| 88 #1 | (iii) | `` assert(!(await page.locator('#customSourceEditor').innerText()).includes(sentinel)) `` |
| 91 #1 | (iii) | `` assert((await page.locator('#customPreviewSummary').innerText()).includes('100')) `` |
| 99 #1 | (iii) | `` assert((await page.locator('#customPreviewSummary').innerText()).includes('105')) `` |
| 105 #1 | (iii) | `` assert.equal((await page.evaluate(()=>window.usageBridge.get())).snapshot.daily.reduce((n,r)=>n+r.totalTokens,0),325) `` |
| 111 #1 | (iii) | `` assert(await page.locator('#customNext').isVisible()) `` |
| 111 #2 | (i) | `` assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false) `` |
| 113 #1 | (i) | `` assert.equal(errors.length,0,errors.join('\n')) `` |

### 6.2 多页套件补充定位

这里只映射本页相关段及其跨页结果；循环/流程的其它页分支仍归其它页，不能据此整套退役。

#### scripts/m1/usage-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 41 #1 | (iii) | `` assert.equal(await page.locator('#sourceRows .source-row').count(), SOURCES.length) `` |

#### scripts/m1/motion-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 71 #1 | (iii) | `` assert.equal(await page.locator('#sourceDialog').evaluate(d => d.open), false) `` |

#### scripts/m1/agent-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 49 #1 | (iii) | `` assert.equal(await page.locator('#sourceRows .source-row').count(),SOURCES.length) `` |
| 51 #1 | (iii) | `` assert(await page.locator('#sourceRows .source-line').evaluateAll(lines => lines.some(line => /runs\.ndjson\|index\.db/.test(line.title)))) `` |
| 56 #1 | (iii) | `` assert((await page.locator('#sourceTraces').innerText()).includes('Kiro')) `` |
| 57 #1 | (iii) | `` assert.deepEqual(saved().disabled,['gemini']) `` |
| 59 #1 | (iii) | `` assert.equal(await page.locator('details[data-agent="codex"]').evaluate(details => details.open), true, 'status repaint must preserve disclosure before the queued native toggle') `` |
| 61 #1 | (iii) | `` assert.equal(saved().excluded.codex.length,1) `` |
| 62 #1 | (iii) | `` assert.equal(saved().excluded.codex,undefined) `` |
| 63 #1 | (iii) | `` assert.rejects(page.evaluate(() => window.usageBridge.changeSource('remove','codex','C:\\Windows')),/SOURCE_REJECTED/) `` |
| 64 #1 | (iii) | `` assert.deepEqual(saved().disabled,[]) `` |
| 72 #1 | (iii) | `` assert.equal(state.enabled,true) `` |
| 74 #1 | (iii) | `` assert.rejects(page.evaluate(() => window.usageBridge.chooseSource('cursor')),/SOURCE_PRODUCT_OVERLAP/) `` |
| 76 #1 | (iii) | `` assert.equal(state.enabled,false) `` |
| 77 #1 | (iii) | `` assert.equal(state.enabled,true) `` |
| 79 #1 | (iii) | `` assert.equal(state.enabled,false) `` |
| 81 #1 | (iii) | `` assert.equal(state.snapshot.daily.reduce((s,r)=>s+r.totalTokens,0),fixture.total) `` |
| 81 #2 | (iii) | `` assert(!JSON.stringify(state.snapshot).includes(fixture.sentinel)) `` |
| 83 #1 | (i) | `` assert.equal(errors.length,0,errors.join('\n')) `` |

#### scripts/m1/interaction-reliability-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 184 #1 | (iii) | `` assert(JSON.parse(fs.readFileSync(path.join(usage, 'preferences.json'), 'utf8')).sources.disabled.includes('gemini')) `` |
| 185 #1 | (iii) | `` assert.equal(await page.locator('[data-source-enable="gemini"]').isChecked(), false) `` |
| 186 #1 | (iii) | `` assert(await page.evaluate(() => window.reliabilitySourceNode === document.querySelector('[data-source-enable="gemini"]')), 'morph preserves source switch node') `` |
| 187 #1 | (iii) | `` assert((await page.locator('#sourceRows').innerText()).includes('历史统计保留')) `` |
| 192 #1 | (iii) | `` assert.equal(await page.locator('[data-source-enable="gemini"]').isChecked(), false, 'failed save restores displayed switch') `` |
| 193 #1 | (iii) | `` assert(JSON.parse(fs.readFileSync(path.join(usage, 'preferences.json'), 'utf8')).sources.disabled.includes('gemini')) `` |
| 197 #1 | (iii) | `` assert.deepEqual(JSON.parse(fs.readFileSync(path.join(usage, 'preferences.json'), 'utf8')).sources.disabled, [], 'busy blocks rapid switch/bulk/refresh reentry') `` |
| 198 #1 | (iii) | `` assert.equal(await page.locator('[data-source-enable="claude"]').isChecked(), true) `` |
| 205 #1 | (iii) | `` assert.equal(concurrent.discovery.sources.find(source => source.agent === 'gemini').enabled, false) `` |
| 213 #1 | (iii) | `` assert(JSON.parse(fs.readFileSync(path.join(usage, 'preferences.json'), 'utf8')).sources.added.codex.includes(added)) `` |
| 224 #1 | (iii) | `` assert(await page.locator('.source-row[data-agent="codex"] .source-paths > summary').evaluate(e => e === document.activeElement)) `` |

#### scripts/m1/workbench-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 34 #1 | (iii) | `` assert.equal(await page.locator('[data-cap-agent]').count(),11) `` |
| 34 #2 | (iii) | `` assert((await page.locator('#sourcesAttentionSection').innerText()).includes('来源暂不可读')) `` |
| 34 #3 | (iii) | `` assert(!(await page.locator('[data-attention-notice="cost"]').textContent()).includes('来源暂不可读')) `` |
| 51 #1 | (iii) | `` assert.match(await page.locator('[data-attention-notice="cost"]').innerText(),/费用核对事项/) `` |
| 51 #2 | (iii) | `` assert.deepEqual(fs.readFileSync(statistics),before) `` |
| 52 #1 | (iii) | `` assert.equal(await page.locator('#wbLimit').inputValue(),'123') `` |
| 61 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/style-alignment-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 29 #1 | (i) | `` assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),view+' has no horizontal overflow') `` |
| 31 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

#### scripts/m1/polish-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 19 #1 | (iii) | `` assert.equal(await page.locator('#windowPage').textContent(),name) `` |
| 48 #1 | (iii) | `` assert.equal(await page.locator('#main').getAttribute('data-current-view'),'usage') `` |
| 49 #1 | (iii) | `` assert.equal(await page.locator('#main').getAttribute('data-current-view'),'sources') `` |

#### scripts/m1/unpriced-guidance-ui-test.js

| 原行号 # 次序 | 类别 | 原检查 |
|---|---|---|
| 22 #2 | (iii) | `` assert.equal(await sheet.count(),0,'leaving for the source closes the sheet') `` |
| 31 #1 | (i) | `` assert.deepEqual(errors,[]) `` |

<!-- /ASSERTIONS:M4 -->

## 7. 待决问题（统一交Claude裁决）

| 编号 | 需要裁决的内容 | 源码证据/影响 |
|---|---|---|
| Q1 kit缺口 | 可编辑多行JSON过滤、自由输入+字段建议、autocomplete=off；给出批准API与视觉，不用只读CodeBlock或纯选项Combobox悄悄替代。 | custom-sources-ui:12/38–40/63–64；config-manager-ui:63。仅这些能力，M3k已提供的属性不再问。 |
| Q2 跨页边界 | insights-ui中来源attention/capability与费用budget/general state的Host/Ui拆分、兼容sourceCostInsights/跨页openAttention和省略提示；window-shell直接refresh按钮的定向修改范围。 | C1/C7/C8，影响M4后M5/M8；阶段二以统一裁决为准，不擅自拆掉共享状态。 |
| Q3 视觉与布局 | 来源多行+位置/能力双disclosure，四类sheet尺寸/固定footer、注意事项分组、静态健康badge、配置check定位行、自定义五步导航的规范映射。 | 现M3示范未覆盖这些组合；不新选宽度/色/compact档/Sheet层级。 |
| Q4 图形/进度 | 安装进度百分比和阶段是否仅Value，或需要何种图表kit；不自行把覆盖Meter.done用于安装。 | agent-install-ui:23–26；M3k的Meter.done只有已计价比例获准。 |
| Q5 旧语义/文案疑点 | sourceLine对files/observedRecords的缺省、summary对file数量相加，确认已观察计数与未知的边界；capability中的“账户额度另由Codex连接提供”现旧文案是否保留。 | sources-ui:127–128/214、insights-ui:32；仅记录，未判定损坏或改文案。既有跨来源文件数量是现有汇总，不新增。 |
| Q6 退役范围 | 上述旧侧Host承载位置、保留公开接口直到其它页迁移的清单，以及sourceDialog演示入口是否与当前picker一起迁；不得保留React之外第二份产品页。 | C1–C10；M3只示范旧preview提供Host，不足以授权整文件删除共享逻辑。 |

## 8. 本轮验证与停止点

仅静态源码/桥接签名/AST断言/ID与公开全局检索、文档来源/格式和Git差异核对。本页无实现、无新截图，无本页build/verify/audit/UI运行结果；M3前置十组样式对比是另行已执行证据，不能替代M4门槛。

后续按裁决实现时：每项F逐条对照，synthetic独立home/usage/quota；截图1280×900 light/dark、before同态、所有sheet/菜单/悬停、未知/partial/失败/加载、off/reduced；逐页build:ui/verify fail0/runtime/foundation/page smoke和测试映射落实，未完成不能报通过。正式包装留M9。

本文件是五份盘点之一，一页一提交；本页问题不导致跳过其它四页盘点。五份交付后停止。M3示范和main上的`UI-MIG-M4-M8-RULINGS-*.md`缺任何一项都不开始阶段二。

<!-- IDS:M4 -->

## 附录：ID 与反向引用静态检索

以下索引固定到main 4f77437。完整静态ID及脚本赋值ID如下；循环生成的data-*行/控制也必须按正文覆盖，不把这个索引误当全部功能。

```text
sources sourceSummary sourceAllOn sourceAllOff sourceRefresh sourceNotice sourcesAttentionSection
attentionHeading attentionCount attentionFilter sourcesAttention sourceRows sourceTraces sourceRetry
agentSetupCommand agentSetupTitle agentSetupFeedback agentSetupDialog manageInstallFeedback agentInstallTitle agentInstallFeedback
agentInstallDialog agentInstallManager configAgent configScope configChoose configCheck configManage
configForget configCancel configSelection configMessage configCategories configSummary configResults
agentConfigCenter configManagerTitle configManagerScope configManagerClose configManagerTarget configImport configUndo
configManagerReload configManagerGlobal configHooksSwitch configManagedRows configEdit configEditTitle configEditHelp
configEditFields configEditPreview configWritePreview configWriteSummary configNormalization configManagerMessage configWriteActions
configActionNotice configApply configDiscard configManager customSourceEditor customSourceTitle customStep
customClose customImportLine customSourceImport customName customTemplate customChoose customLocation
customFixedMapping customMapping customSample customSampleInfo customFieldOptions customFilters customMode
customFixedSemantics customSemantics customInput customReason customTime customPreviewSummary customFinal
customStatus customBack customNext customSourceAdd sourceDialog sourceTitle sourceDialogText
demoDirectory selectDirectory
```

| 文件与行号 | 命中ID（候选，需按正文耦合表区分DOM访问/普通字段/注释） |
|---|---|
| cost-page.js:601 | sources |
| insights-ui.js:11 | sources |
| insights-ui.js:16 | sources |
| insights-ui.js:31 | sources |
| insights-ui.js:37 | sources |
| insights-ui.js:61 | sources |
| insights-ui.js:96 | sourcesAttention |
| insights-ui.js:102 | attentionCount |
| insights-ui.js:103 | sources |
| insights-ui.js:105 | attentionFilter |
| insights-ui.js:106 | attentionFilter |
| insights-ui.js:121 | sources |
| insights-ui.js:122 | sourcesAttentionSection |
| insights-ui.js:196 | sourceRefresh |
| insights-ui.js:212 | sourceRows |
| preview.js:383 | sources |
| preview.js:385 | sources |
| preview.js:825 | sources |
| preview.js:897 | sources |
| preview.js:935 | sources |
| preview.js:985 | sources |
| preview.js:986 | sourceDialog、sourceDialogText |
| preview.js:1041 | demoDirectory、selectDirectory |
| preview.js:1042 | sourceDialog、demoDirectory |
| preview.js:1043 | demoDirectory |
| preview.js:1044 | sources |
| preview.js:1047 | sources |
| preview.js:1052 | sources |
| preview.js:1115 | sources |
| pricing-view.js:66 | sources |
| pricing-view.js:71 | sources |
| quota-cards.js:819 | sources |
| window-shell.js:4 | sources |
| window-shell.js:34 | sources |
| window-shell.js:43 | sources、sourceRefresh |

原始索引与assert全文保存在未跟踪的 `artifacts/ui-mig/inventory-20261025/index.json`，不属于运行验收。

<!-- /IDS:M4 -->

署名：Codex
