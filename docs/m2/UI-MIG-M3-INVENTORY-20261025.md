# M3 设置页迁移盘点 · 2026-10-25

## 状态、依据和交付边界

**仅完成计划的 M3 子步骤 a（静态盘点），未实现 M3；等待 Claude 审核。** 所有者本轮明确选择：“只盘点 M3，保留实施前审核”。这只允许在 M1/M2 尚待统一审核时继续做本盘点，不表示 M1/M2 或本盘点已经通过，也不允许开始 M3 实现或 M4。

- 分支：`ui/mig-m3-settings`。从本地 main `346c8e0068d3a26107879d11f5b4a1fcc061a9b1` 新建独立 worktree，再在本分支 fast-forward 到 M2 `d09357f62aff5b3f6902700bb1730b4a627037ca`，保留 M1/M2 的完整提交。共享 main、M1、M2 分支均未修改。
- 源码定位均以本分支上述基线为准。下文未带目录的 renderer 文件均在 `design/desktop-reference/`；测试文件均在 `scripts/m1/`，另有明确写出路径的单元测试。
- 已按执行计划要求的顺序阅读 AGENTS、CONTRIBUTING、迁移方向、React foundation、UI 规范及迁移计划；本记录执行计划 §0.3、§0.4、§2.1 和 M3 的盘点要求。
- CodeGraph 工具不可用，改用当前源码、定向 `rg` 和静态引用索引核对。没有启动子代理。
- 本提交只增加本文件。不改页面、kit、主题、vendor、token、设计检查、测试、后端、preload、依赖或生成产物；不合入 main，不做远程 Git 操作，不恢复 stash。
- 本轮没有启动应用，没有读真实来源、认证文件或账号，没有执行桥接方法。下面的行为是**源码确认的现状**，不是本轮运行验收。

## 1. 功能清单

这里的“保留”是实现后的验收要求，不表示已实现。没有以迁移为由删掉的操作。

| 编号 | 区块、控件及现有行为 / 状态 | 旧代码出处 |
|---|---|---|
| F1 | 设置 section 保留 `hidden`、`data-motion-surface="page"`，受外框路由控制；标题“设置”和说明“外观、采集、定价和本机数据。” | `index.html:117`；`preview.js:890`–902 |
| F2 | 五个分类：常规、采集、定价、数据与安全、关于；点击滚动至对应区块，更新 active、aria-selected、roving tabindex；滚动观察更新分类，到底部选“关于”。 | `index.html:131`–153；`settings-ui.js:10`–81 |
| F3 | 分类键盘方向键 / Home / End，使用 `uiKeyboard.guard` 和 `rove(..., true)`；不把 IME 候选操作当导航。 | `settings-ui.js:39`–43；`interactions.js:18`–37 |
| F4 | 设置搜索，maxlength 60，trim + 小写匹配标题、卡片及行；隐藏未匹配项、标出匹配行、分类显示匹配状态。 | `index.html:123`–127；`settings-ui.js:83`–158 |
| F5 | 搜索非空才显示清空按钮；点击或普通 Escape 清空并回焦；IME Escape 保留文本；无结果显示“未找到匹配的设置项。按 ESC 清空搜索。” | `settings-ui.js:83`–174 |
| F6 | 常规 / 个人资料：头像、名字、简介、“只保存在本机”、编辑资料；读取侧栏资料并同步；头像图片或字母、三种已存在 tone。 | `index.html:156`–181；`settings-ui.js:176`–190、269；`preview.js:946`–957 |
| F7 | 编辑资料可从设置、侧栏“编辑资料”、侧栏头像打开；打开复制草稿，取消不保存。姓名必填 maxlength 48，简介 maxlength 80；空姓名调用原生有效性提示；输入实时更新头像字母。 | `index.html:361`；`preview.js:954`–961、977–978 |
| F8 | 头像选择 indigo / teal / coral 清除照片；“使用字母头像”清除照片；PNG/JPEG/WebP 文件最大 512 KB，FileReader 后还需 Image 解码；读取时禁用保存并设置 aria-busy。 | `index.html:361`；`preview.js:962`–975、1014 |
| F9 | 图片类型、大小、读取 / 解码失败保留原头像并报错；关闭、再次选择或换草稿使旧异步结果失效；存储空间不足保留弹窗与草稿。保存成功更新侧栏并 toast；本机 localStorage 兼容原 key 和数据格式。 | `preview.js:946`–952、965–978 |
| F10 | 外观三项：system / light / dark；本机保存，跟随系统变化；标题栏按钮、原生菜单和设置保持一致，更新热力图配色及旧页面渲染。 | `index.html:183`–202；`preview.js:904`–912、1073；`window-shell.js:41` |
| F11 | 动效三项：system / reduced / off；动态插入常规区；本机保存，跟随系统减少动效，取消活动动画并发 `ui-motion-change`；原生菜单可操作同一偏好。 | `motion.js:107`–118、132–151；`window-shell.js:41` |
| F12 | 采集状态 badge、暂停 / 恢复 switch、帮助文案：桌面 bridge、只读快照和合成演示三种来源；暂停保留历史，只读快照禁用；错误 toast，显示回到实际状态。 | `index.html:205`–243；`preview.js:825`–828、943、1060；`settings-ui.js:192`–200、272 |
| F13 | 用量刷新频率 0 / 5秒 / 15秒 / 30秒 / 1分钟 / 5分钟；默认 15秒；无 bridge 禁用；失败恢复旧值；暂停中保存频率仍保持暂停，成功提示区分暂停状态。 | `index.html:226`–240；`preview.js:825`、1050 |
| F14 | 定价区桌面模式 / 无 bridge 回退：“定价设置在桌面应用中可用”；覆盖概览、同步、已用模型表、Agent 规则、历史重估、目录来源。 | `index.html:246`–254；`pricing-controller.js:12`–32；`pricing-view.js:21`–42 |
| F15 | 已定价覆盖值、三段 meter（已计价 / 可补价格 / 用量缺失）、覆盖说明；未知比例现为“—”；缺口数量 / Token / 用量不完整的分类说明。 | `pricing-controller.js:117`–126；`pricing-data.js:60`–80；`pricing-view.js:93`–98 |
| F16 | 自动价格同步 switch、立即同步；同步中禁用立即同步；展示更新中 / 失败沿用缓存 / 最近成功 / 离线内置状态；同步失败保留缓存、手动规则及映射。 | `pricing-controller.js:154`–158、208–209 |
| F17 | 已用模型表按缺口优先；展示模型、Agent 名、计费依据、目标映射、四项每百万 Token USD 费率、用量、缺口占比；默认折叠 8 行；搜索服务商 / 模型 / Agent / 依据；无结果“没有匹配的已用模型”。 | `pricing-controller.js:104`–116、127–138；`pricing-view.js:44`–64 |
| F18 | “展开其余 N 个模型 / 收起，只看前 8 个”；收起时把模型标题滚入视口；“为其他模型添加价格”；整行点击和行内模型按钮都能打开，键盘能到按钮。 | `pricing-controller.js:93`、104–116、233–238；`pricing-view.js:33` |
| F19 | 既有 title 悬停：费率四字段（缺失写“未知”）、路由目标完整 ID、未计入 Token、目录版本 / 哈希截断及时间信息。无新增 hover 卡片；保持原读数和触发对象。 | `pricing-view.js:32`、44–59、100–108；`pricing-controller.js:142`–147 |
| F20 | 共用价格 sheet：设置行、费用页“设置计费 / 处理方法”都打开同一模型；等价格读取后再开，过时请求不打开；无法读取用 toast；关闭取消 debounce / probe 结果。 | `pricing-controller.js:44`–101；`cost-page.js:332`、385、598–599 |
| F21 | 缺口帮助说明原因、可修 / 不可修用量及后续操作；检查特定来源先关 sheet 再聚焦来源；“核对手动费率”切手动并聚焦缓存写入；普通重新加载保留候选、sheet 打开态和当前模型。 | `pricing-controller.js:44`–90；`pricing-view.js:77`–91 |
| F22 | 映射页：目录匹配建议、多个候选提示；选择只填草稿，不隐式保存；候选数量上限提示、不按价格排序；目录搜索输入和预览；明确提交才 saveBilling；恢复自动匹配同样显式写入。 | `pricing-view.js:39`、68–75；`pricing-controller.js:52`–59、194–207 |
| F23 | 手动页：新增模型显示必填 provider / model（maxlength 99 / 179），编辑已有模型不改身份；从目录复制可选模板；输入 / 输出必填，缓存读写可空；非负、最高 100000、任意小数步进；空缓存与明确 0 区分。 | `pricing-view.js:22`–25、40；`pricing-controller.js:38`–43、64–82、239–243 |
| F24 | 250ms debounce 只读试算：历史影响记录数 / Token，费用单值或上下界、精确到六位小数；无历史 / 字段不完整 / 后端校验 / 传输失败分别文案；旧 probe 不覆盖新输入，保存前不改变估算。 | `pricing-controller.js:210`–231 |
| F25 | 保存手动规则防重复；成功关 sheet、重算历史并重新载入；失败保留输入和旧规则。移除规则成功恢复目录或未定价；被默认模型 / 映射引用时拒绝移除；失败保留输入及原规则。 | `pricing-controller.js:244`–268 |
| F26 | Agent 计费规则 disclosure：内置与自定义动态行；实际模型 / 指定默认模型；倍率 0–1000 可小数，空白不等于 0；默认模型需目录中可计价完整 ID；行错误及聚焦第一个错误；恢复默认只改草稿，点击保存生效。 | `pricing-view.js:34`；`pricing-controller.js:160`–192 |
| F27 | 保存 Agent 规则 / 映射时禁用相关按钮；失败保留草稿；保存成功而后续显示刷新失败，必须同时报告“已保存”和“暂未刷新”。活动的 dirty 规则不被后台重载覆盖。 | `pricing-controller.js:140`–175、177–192 |
| F28 | 历史费用估算：显示全部已保存历史的价格依据、已计价 / 未计价记录数；显式“重新估算”，忙碌 / 无 bridge 禁用，成功提示账本与来源文件保持原样，失败由共享 act/message 告知。 | `pricing-view.js:35`；`insights-ui.js:17`–24、151、192 |
| F29 | Codex 用量维护外层 disclosure 和“重建说明”；只读预览、备份并应用；预览中禁用、成功获得候选 id 才能应用；显示文件 / 记录 / 重建+保留 / 差额；取消不改统计，应用成功保留日志和账号连接；预览 / 应用失败清空候选并保留历史。 | `maintenance-ui.js:9`–15；`codex-maintenance.js:9`–47 |
| F30 | 数据与安全：JSON 导出入口、白名单说明、隐私三条；不增加清空统计入口。此处隐私文案与后续已授权账号 / 配置能力存在范围表述疑问，见 Q8。 | `index.html:255`–314；`preview.js:944`、1015 |
| F31 | 演示状态 normal / partial / empty / error；只影响演示；有真实快照整行隐藏；切换刷新用量和会话示例，不触发真实来源读取。 | `index.html:277`–288；`preview.js:116`–125、387、941、1046；`settings-ui.js:232`–240；`sessions-ui.js:41`、570 |
| F32 | 共用统计导出 sheet：从设置、用量和原生菜单打开；每次清状态并折叠 JSON 预览。范围 all / current、包含来源状态 checkbox；范围 current 沿用用量页当前筛选语义。费用页的“导出费用 CSV”是独立 exportCost 流程，留 M8。 | `index.html:53`、271、359（费用 CSV 为82）；`preview.js:1015`、1077–1097；`window-shell.js:42`；`cost-page.js:608`–612 |
| F33 | 桌面导出：busy / disabled 防重复，桥接调用后成功含聚合条数 / 取消 / 失败可重试，finally 解锁；不导出正文、身份、原始会话 ID、工作目录或凭据。预览模式生成 JSON、readonly textarea、Blob 下载；source checkbox 控制来源状态。 | `index.html:359`；`preview.js:1077`–1097；`usage-ui-test.js:66`–73 |
| F34 | 关于 / 支持来源：从 `agentCatalog.agents` 动态名称、图标、数量、包含自定义；支持只读 badge，点击 / Enter / Space 跳来源并滚至 Agent；source-catalog 后重绘。catalog 对象为空时数量为 0（目录数量，并非未知用量）；catalog 缺失则原函数直接返回，不把缺失改成空目录。 | `index.html:316`–329；`settings-ui.js:202`–240、253–267 |
| F35 | 系统信息为静态文案：0.1.0、tokscale 4.17.0 / SHA-256、Codex 本地 CLI；迁移不擅自改成动态版本或补充能力。 | `index.html:330`–348 |
| F36 | 所有 sheet 保留 Escape、关闭按钮、焦点进入 / 限制 / 返回、快速关开和 IME 提交 / 取消保护；价格 sheet 内目录层先收起，再 Escape 关外层；状态行播报和减少 / 关闭动效可用。 | `interactions.js:18`–61；`motion.js:131`–150；`motion-ui-test.js:34`–82；`interaction-reliability-ui-test.js:89`–119 |
| F37 | 定价列表滚动的上下边缘淡化、键盘聚焦取消 mask、内容 / 尺寸变化更新，列表到边界滚轮交给页面；无溢出不显示淡化。 | `scroll-fade.js:27`；`interaction-reliability-ui-test.js:226`–248 |
| F38 | 窄窗口、多设备缩放、深浅色；定价表、sheet、表单、资料、导出仍可操作且无横向溢出；页面离开取消过时滚动 / 打开任务，不丢已保存数据。 | `settings.css:113`–122；`preview.js:890`–902；各测试映射 |

## 2. 数据清单及语义

不新增读取、不改桥接，不在 TypeScript 重写定价 / 格式化。preload 行号仅为静态签名核对，不是改动范围。

| 数据 / 写操作 | 现有来源与签名出处 | 现有显示与边界 / 迁移要求 |
|---|---|---|
| 主题偏好 / 系统深色 | `preview.js:906`–912；localStorage `agentusage.theme.v1`、matchMedia | 无有效保存值用 system；保存失败仅当次会话；调用原逻辑，不引入 IPC。 |
| 动效偏好 / 系统减少动效 | `motion.js:107`–118、132；`uiMotion.preference/setPreference` | system/reduced/off 原格式保留；无有效值 system。 |
| 资料与草稿、照片 | `preview.js:946`–978；localStorage `agentusage-preview.profile.v1` | 原姓名 / 简介 / tone / photo 校验不变；invalid 回默认；取消与读取失败不提交；不读取外部配置。字母计算 `initials` 需依 §2.4 原样提取为 UMD 后再复用。 |
| 采集 enabled、refreshIntervalMs、状态 | `usageBridge.get/onUpdate` → `preview.js` 中 applyUsageState / updateCollection；`setEnabled(value)`、`setRefreshInterval(value)`，`preload.js:26`、32 | 保留真实快照 / 桌面 / 演示区别；未知状态不假装运行；interval 缺省现用 15000；暂停不删历史；频率为 0 是显式手动刷新。 |
| 目录价格、observed models、billing、sync、suggestions | `usageBridge.pricing()`，`preload.js:20`；`pricing-controller.js:139`–158；更新事件 `usage-models`、`source-catalog`、bridge onUpdate | 延后到 settings / cost 可见或显式打开 editor；重载串行合并，错误保留规则，已保存但读取失败分开报告。无新自动 provider 请求。 |
| 模型表及缺口 | `window.usageModels`，`uiPricing.usedModels/pricingGaps/unpricedUsage/unpricedTotals`；`pricingLabels`；`pricing-data.js:39`–80 | 保留 observed identity、缺口理由、partial / 冲突、未定价；缺字段不能通过补价格伪造完整；现有 `tokens \|\| 0`、跨 Agent 用量覆盖汇总见 Q7。 |
| 覆盖比例、费率及目录来源 | `uiPricing.coverage/formatCount/formatStamp`；`uiPricingView.rates/short/percent/coverageNote/catalogLine/catalogTitle/countsText`，`pricing-view.js:19`、44–48、66–67、93–113 | null 比例 / 缺失费率当前显示“—”，明确缺少主费率为“未定价”，title 写“未知”。与规范 §6 冲突见 Q7；不能在 React 改写 formatter。 |
| 手动输入 / 输出 / 缓存读写 | `uiPricing.entry(provider,model,values)`，`pricing-data.js:83`–87；`savePrice(entry)` / `resetPrice(entry)`，`preload.js:20` | 缓存留空 → null；明确 0 → 数字 0；保留精度、引用保护、失败草稿；不把未知转成免费。 |
| 只读试算 | `probePrice(entry)`，`preload.js:29`；controller:211–229 | sample null / sample.lower 非有限 / 上下界不同分别现有文案；次数 / Token、六位小数原样提取复用，不重做计算。 |
| 映射、倍率和默认模型 | `saveBilling(value)`，`preload.js:21` | 显式选候选后仍需保存；倍率空白拒绝、0合法；每 Agent 独立行，不把倍率或账号额度相加；失败保留旧文件与草稿。 |
| 同步开关 / 同步目录 | `autoPrices(enabled)`、`syncPrices()`，`preload.js:21` | 仅原有显式操作与已存在同步策略；迁移不触发新网络验收，合成测试注入结果。 |
| 历史价格依据 / 重新估算 | `insights-ui.js:151` 共享 state.general（workbench / attention）；`reprice()`，`preload.js:31` | 原全历史范围和计价 / 未计价计数不变；账本与来源字节不变；不顺带迁移费用预算 / 项目 / 来源诊断。 |
| 维护候选 / 应用结果 | `previewCodex()` / `applyCodex(id)`，`preload.js:22` | next=rebuiltTokens+retainedTokens 是原预览重建与保留部分合并，不是账号额度相加；计算与 toLocaleString 按 §2.4 提取；失败或取消不假装已应用。 |
| 导出白名单 | `exportStatistics(snapshot)`，`preload.js:29`；`preview.js:1077`–1097；`data/rangeRows` 仍归用量页 | 保留原 daily 与 source inclusion 语义、saved/canceled、隐私过滤；未知价格不得填 0；预览 JSON 的生成与 bridge 导出分支不合并。 |
| Agent 名称、图标和数量 | `agentCatalog.agents`、`source-catalog` | 自定义名称按旧 escape 语义安全显示；未知图标沿 AgentMark 既有回退；数量确实为 0 时可为 0，不能用数量推断安装 / 账号状态。 |

`ui/src/data/bridges.ts` 的现有类型已包含上述 IPC；`globals.ts` 已声明现有 pricing / catalog / display 模块。未来窄 UI 接口需要单独声明，不能用 any 或临时 DOM 查询绕过类型。新的纯计算 UMD 的测试对照对象必须是原函数输出，包含 null、0、小数、缺失字段和异步竞态相关输入。

## 3. 耦合清单与拟处理边界

这些是**待审核的迁移处理方案**，本次未实施。跨页模块只解除其对设置 DOM 的直接访问，业务与其它页面仍留原阶段。范围疑问见 Q1。

| 编号 | 当前双向依赖（确切引用） | 审核后拟处理 |
|---|---|---|
| C1 | 外框 `preview.js:890`–902、935；`window-shell.js:4`、40、43 认识 settings 路由与 section | 保留外层 section 和路由语义；M2 `useViewActive('settings')`；只换 section 内 host。settings/refresh 命令行为保持，设置页点原生刷新会转用量。 |
| C2 | `preview.js:909` 写 themeSelect、1073 监听它；标题栏用 setTheme；`window-shell.js:41` 通过 select 派发 change | 审核一个不查 React DOM 的主题偏好 getter / setter / 通知接口，继续调用既有 setTheme/applyTheme；菜单改调该窄接口。不能留隐藏旧 select 作第二份状态。 |
| C3 | `motion.js:109` 同步 select、133–136 在设置中插行，147–148 观察设置状态 DOM | 删除本页插行 / DOM 同步，React 调现有 uiMotion.setPreference、读 preference，订阅既有 ui-motion-change；状态行使用 kit 层，保留其他页观察与生命周期。 |
| C4 | `preview.js:825`–828、943、1050、1060 读写 interval/pause/help；settings-ui:192–200、272 反读按钮内容 / 属性 | 单一采集状态继续由 usageData / bridge 结果提供，窄接口取得相同 enabled/status/interval 和原帮助文案；React 发原动作。移除旧 DOM 监听与 MutationObserver；不改服务调度。 |
| C5 | profile 侧栏与 dialog 共用 preview.js:946–979、1014；settings-ui:176–190、269 复制侧栏 innerHTML | 资料值 / 草稿改以明确的数据与事件接口共享；侧栏仍旧代码渲染，打开资料改调接口；React 不复制 innerHTML；旧外框不访问新表单 DOM。原计算先提取，照片 / tone kit 问题先裁决。 |
| C6 | preview.js:941、1046 操作 demoState；sessions-ui.js:41、570 读 / 监听；settings-ui:232–240 隐藏行 | 保留同一 demo 状态的窄 getter/setter/change；会话读取接口或通知，不查 React select；真实快照模式整行隐藏。不能另建不连通的演示状态。 |
| C7 | preview.js:944、1015、1077–1097 负责所有 data-export；window-shell.js:42 先导航用量再点用量按钮；index.html:53、271 两个统计导出入口 | 共用 export UI 仍在路由外可打开；旧按钮和原生菜单走窄 open 接口，取既有用量筛选后的数据；迁移 profileDialog/exportDialog 属 M3 明确范围，但 index 的 section 外删除和共享绑定要授权确认。费用 CSV 独立流程不迁。 |
| C8 | pricing-controller.js:95–101 的 `uiPricingEditor.open/explain/model`；cost-page.js:332、385、598–599 | 保持同步 model 返回 basis / priced / rates / mapped / target，open/explain 可从 cost 触发加载及共享 sheet；不能只在设置可见时挂载 editor，亦不能在 M3 重写费用页。 |
| C9 | `uiPricingCtl.load/render/entry`（controller:277）；billing-query:23、42、functional:77 直接调用 | 此接口实际消费者是旧测试；迁移测试用新的可观察操作或审核后的兼容窄接口。保留 entry 用 uiPricing.entry 及刷新保持打开、保存后读失败的行为断言。不能删断言。 |
| C10 | `uiPricing` / `uiPricingView` 全局，controller:14、28；pricing-data 的 pricingLabels；M2 globals 声明 | 保留 pricing-data 计算与格式化。pricing-view 返回 HTML，React 不 innerHTML。需审核如何将其文案 / formatter / view model 以原结果导出供 kit 组合，保留模块契约单元测试；不在 TS 重写。 |
| C11 | pricing-controller:159、273–276 监听 source-catalog、ui-view-change、usage-models、bridge onUpdate；读取 window.usageModels | 保持加载时机、串行去重、dirty 草稿、editor 请求 / probe 版本守卫和卸载清理；M2 hook 不改变原事件 envelope，不能因 mount 提前同步目录。 |
| C12 | insights-ui.js:20、23、151、182、192 查 settings status / wbReprice / wbPriceBasis / 分类按钮；来源、费用与会话也用该脚本 | 只移交设置 reprice 的状态、动作、busy 和价格依据，其他业务不动；其它页“去定价”走窄 openSection('pricing')。不删除整个 insights-ui。共享 act/message 成功失败语义要保留。 |
| C13 | settings-ui.js:202–240、253–267 用来源导航和 source-row；pricing-controller:56–58 用 sourcesUi.focus | 继续保留两种现有行为：关于目录仅导航并滚动到行；价格帮助调用 sourcesUi.focus 定位来源。参数只传原 Agent ID；关闭 sheet 再导航，保持原位置与过滤语义，不能把普通滚动擅自改成来源过滤。M4 来源 DOM 不重做。 |
| C14 | scroll-fade.js:27 将 #priceRows 加入共享滚动检测；focus/interactions/select-ui/segmented/morph 使用通用选择器而非本页 id | 本页滚动 fade / 可搜索目录 / 嵌套层 / 焦点与 IME 必须由审核过的 kit 能力承接；通用脚本不能误接管 React DOM；保留其它页共享能力到 M9。见 Q3/Q5/Q6。 |
| C15 | stylesheet 包含 settings.css 以及 polish/style/pages/nowdex/motion 中的定价、资料、dialog、表单、select 等规则；legacy.css:19 导入 settings.css；serve.js:37 白名单；index.html:362 classic scripts | 只退役本页专有规则 / 脚本；混合文件逐选择器确认，无授权不整文件删。build 生成物由命令生成。serve 白名单、资源图 / ui-bundle 检查随真实删除更新。 |
| C16 | audit-runtime.js:10 自动枚举 renderer *.js，约 28 行起检查 index 与 CSS 资源图；并非固定本页脚本列表 | 真正实现时按现有资源图核对，不为了满足“更新列表”虚构静态清单；若新增 UMD 需加入 HTML/serve 入口及现有构建一致性检查。后端零改动。 |

### 3.1 ID / 全局引用检索覆盖

检索方法：从 settings section、profile/export dialog、pricing-view / maintenance / codex-maintenance / motion 动态模板提取 `id`，补上动态 price 字段与 priceTemplate；对 renderer 根目录 JS 和所有 `scripts/m1/*ui-test.js` 做逐 token 边界搜索，再人工排除同名普通词。另查 `uiPricingEditor`、`uiPricingCtl`、`uiPricing`、`uiPricingView`；没有既有 settingsUi/settingsUI 全局。

本页 ID 覆盖（仅列真实完整 ID；模板拼接的 `price-` 不是 ID）：

```text
settings settingsMain section-general section-collection section-pricing section-privacy section-about
settingsSearch settingsSearchClear settingsAvatarPreview settingsDisplayName settingsDisplayBio settingsProfile
themeSelect motionSelect collectionStatusBadge collectionHelp settingsPause usageInterval usageMaintenance
demoState settingsAgentCount settingsAgentGrid
profileDialog profileTitle nameInput bioInput avatarPreview avatarFile avatarFileName avatarFileStatus
resetAvatar profileError saveProfile
exportDialog exportTitle exportRange exportSources exportHelp download exportResult jsonPreview exportJson
pricingPanel pricingTitle priceCounts priceCoverageValue priceCoverageBar priceFixableBar priceIncompleteBar
priceCoverageNote priceSyncState priceAuto priceSyncNow priceModelsTitle priceModelCount priceAttentionMeta
priceSearch priceRows priceExpand newPrice billingSection billingRows saveBilling
priceRepriceTitle wbPriceBasis wbReprice priceResult priceCatalogLine priceTargets
priceEditor priceEditorEyebrow priceEditorTitle priceEditorMeta closePriceEditor priceEditorStatus
priceEditorModesTitle priceSuggestions mappingForm mappingTo mappingPreview unmapPrice priceForm
priceProvider priceModel priceTemplateMount priceTemplate price-inputUncached price-output price-cacheRead
price-cacheWrite priceProbe resetPrice savePrice
codexMaintenance codexMount codexPreview codexApply codexPreviewResult
```

本页拥有的 settings/pricing/maintenance 脚本内部引用已逐功能记录。其它脚本的有效命中：

| 文件 | 行号 / 命中 | 对应处理 |
|---|---|---|
| preview.js | 116、124–125、387 demoState；825–828 采集；897、935 section；909 主题；941–944 演示与帮助；957–978 资料；1014–1015 资料/导出；1046、1050、1060、1073、1077–1097 | C1/C2/C4/C5/C6/C7 |
| motion.js | 109、134–136 motionSelect / setting-list；147 状态观察 | C3/C14 |
| insights-ui.js | 16、20、23、151、182、192 | C12 |
| window-shell.js | 4、40–43 | C1/C2/C7 |
| sessions-ui.js | 41、570 demoState | C6 |
| scroll-fade.js | 27 priceRows | C14 |
| cost-page.js | 332、385、598–599 uiPricingEditor（按全局名追加检索） | C8 |
| serve.js | 37 脚本/CSS 白名单 | C15 |

排除项也核对过：config-health-ui.js:14–15 的 `claude-settings`/提示词、quota-cards.js:439、452–460 的卡片 settings 局部变量、cost-page.js:515 和 sessions-ui.js:317 的注释、pricing-data.js:3 的说明，都不访问设置页 DOM。不能因为普通单词 settings 命中就扩大 M3。源索引另保存在未跟踪的 `artifacts/ui-mig/M3/static-reference-index.json`，这是静态辅助材料，不是 UI 验收证据；交审以本文件中的清单为准。

## 4. kit 映射及待补能力

| 功能 | 对应既有 kit | 限制 / 决策引用 |
|---|---|---|
| F1 标题，分区标题 | PageHeader、SectionHeader | 原居中页头到既有组件结构的差异按规范，不自行选其它布局；最大宽度等未覆盖项见 Q4。 |
| F2/F3 分类与滚动同步 | SubTabs（候选）；受控 value 与原 scroll-spy | 需确认保留 scroll-to-section 的导航语义、aria/tab 键盘行为；不得误变成只显示一个 pane。Q4/Q5。 |
| F4/F5/F17 搜索 | SearchField、EmptyState | 现 API 缺 maxlength、键盘 / focus 接口；“清除搜索”与旧“清空搜索”文案不同。Q2。 |
| F6–F9 资料 | Sheet、TextField、Button、RadioGroup（tone 候选） | 无个人 Avatar / 文件选择，tone 原图标选项不能擅自改样式；TextField 缺 required/maxLength；Q2/Q3。 |
| F10/F11/F13/F31 选择 | Select；F12/F16 switch 用 Switch | Select 无 disabled；旧 0 刷新和只读禁用保留；可搜索目录不等同普通 Select。Q2/Q5。 |
| F14–F19 定价概览和表 | Value、Figure、DataTable、Badge、Button、EmptyState | 三段 coverage meter 无 kit；DataTable 无整行 onClick、列头 title、受控可聚焦滚动区；Badge tone 仅 neutral/warn，不能自行映射额外色。Q3/Q4/Q7。 |
| F20–F25 共用价格编辑 | Sheet、Segmented、TextField、Select、Button、Banner | Sheet 尺寸、可搜索选择、表单原生校验、提交类型 / nested IME / focus 能力待审。Q2/Q4/Q5/Q6。 |
| F26/F27 Agent 规则 | Disclosure、ListRow、Select、TextField、Button、Banner | 倍率 min/max/step、默认模型搜索 / datalist 缺口；未保存提示和 dirty 不能丢。Q2/Q5。 |
| F28/F29 重估和维护 | Disclosure、ListRow、Button、Value、Banner | 纯计算先原样 UMD；忙碌 / 成功 / 取消 / 失败分别保留；维护确认仍由既有 bridge 完成。 |
| F30/F35 说明 / 系统事实 | SectionHeader、ListRow、Badge、Value | 原文案先不修；隐私三栏原嵌套背景与禁止卡片套卡片冲突部分见 Q4/Q8。 |
| F32/F33 导出 | Sheet、Select、CheckboxGroup、Disclosure、Button、Banner | 缺只读 multiline JSON 控件；Button API 没有 type=submit，TextField 没有 readOnly/type=file；Q2/Q3。 |
| F34 Agent 目录链接 | AgentMark、ListRow（候选）、Badge | 原三列 badge 网格与规范列表 36px 的映射须确认；AgentMark 不承担个人头像。Q4。 |
| F36 反馈、焦点、动效 | Sheet、Toast、Banner、各控件内部语义 | 旧 280/180ms 时长断言不能照搬；新弹簧、off/reduced、IME 不能遗漏。Q6。 |
| F37 滚动边缘淡化 | **无对应 kit API** | 不得页面自写 mask / inline style / hover；Q3。 |

核对来源：`ui/src/kit/controls.tsx:19`–115、`ui/src/kit/surfaces.tsx:9`–91、`ui/src/kit/data-display.tsx:22`–61。这里只映射已存在组件；没有新建组件、扩展属性或采用设计例外。

## 5. 外观差异：仅列规范已经规定的变化

| 编号 | 现状 → 规范要求 | 对应规范 / 保留项 |
|---|---|---|
| V1 | 原 32px select 等不齐尺寸 → kit 默认 36px 控件，compact 28px 只在规范场景使用 | §3；不改变选项、值、禁用或保存动作。 |
| V2 | 原多种脚本 / CSS 圆角 → 控件 8、弹出层 12、卡片 16（仅规范允许类名） | §3；头像等未明确映射不自行决定，Q3。 |
| V3 | 旧字号 / 字重 → fluid 六角色；确需数字 figure 时仅规范四档、tabular-nums | §2；覆盖主数字具体档位待 Q4；不能改精度与单位。 |
| V4 | 原各处 spacing → 页头 gap-6、区块 gap-8、标题内容 gap-3、行内 gap-2 / 控件 gap-3，卡片用现有 kit | §3；不得附带改变信息层级或区块顺序。 |
| V5 | 原生 select / legacy select popover → kit Select；旧对话框 → Sheet；details → Disclosure；共享列表 / 表格用对应 kit | §4；目录搜索和嵌套层缺口先审，Q5；不能丢 searchable/disabled/validity。 |
| V6 | 旧 CSS 280/180ms 等 → fast / moderate / slow 及 data 档；Sheet slow，Disclosure/菜单 moderate，减少/关闭动效可终止 | §5；旧 CSS 时点断言拟退役见 T-MO，必须有新状态和键盘断言接替。 |
| V7 | light 保留已批准灰色在 fluid 控件上的映射，dark 用 fluid 自有主题；页面不写自选色 | §1；不碰 token/theme/design；三段 meter、tone 色未定义见 Q3/Q4。 |
| V8 | null / 缺失值旧“—” → 规范 Value 的“未知”或“未定价”以及 data-value=unknown | §6；**因旧行为冲突，列为 Q7，未经裁决不实施**。不改 null 数据与明确 0。 |
| V9 | title 费率 / 目标 / 缺口 / 目录读数、原可操作元素反馈维持现状 | §7；不新增 hover 卡、不统一或删除旧读数，React 页面不得写 hover 类。 |

其它布局变化（居中/最大宽度、搜索高亮、可修/缺失三色、Avatar tone、网格、弹窗尺寸）没有在本记录做设计选择，全部进入问题表。

## 6. 旧测试断言迁移映射（提案，尚未修改测试）

类别：(i) `settings-smoke-ui-test.js` 的基础冒烟；(ii) 既有或原样提取的纯 UMD 单元测试；(iii) 新设置页回归测试（可与 smoke 同文件分组，必须覆盖）；(iv) 拟退役的旧**实现形态**断言及理由。多页套件的其它断言全部保留原套件。表中一行若含多个检查，逐项用分号列出，均归该行类别；显式 `waitFor/until` 状态约束也计入，避免只迁 assert 调用而丢流程。

以下行号均是 M2 基线源码行号，不是未来新测试行号。本次没有真正退役任何断言；(iv) 项须经审核，替代检查也须完成。

### 6.1 计划点名的六个套件

| 编号 / 旧出处 | 逐条检查 | 类别 / 去向 |
|---|---|---|
| T-B01 billing-query:21–22 | 定价缺口加载；sheet/建议可见；多个候选文案；候选恰为 2；未创建 billing 文件；查询费用仍 null | (iii) 价格候选与无隐式写入 |
| T-B02 :23 | load 后 sheet 仍开；候选仍为 2 | (iii) 刷新不丢 sheet/候选 |
| T-B03 :25 | 选择候选只填 mappingTo；仍无 billing 文件 | (iii) 草稿 / 显式提交 |
| T-B04 :27 | 文件系统失败出现“未保存”；sheet 可见；目标草稿保持 | (iii) 保存失败可重试 |
| T-B05 :28 | 重试关闭 sheet；billing 映射等于 target；查询估算由 null 变正数 | (iii) UI → 已保存查询的一致性，不把 null 断言退役 |
| T-B06 :30–32 | 新增手动价失败保留输出 2；重试关闭；重开输入 0；缓存读取空；保存 cacheRead=null | (iii) 新增 / 重开、0/null、失败恢复 |
| T-B07 :34 | 引用中的费率不能移除，显示解除规则提示；输出草稿 2；原价文件字节未变；查询费用仍正数 | (iii) 引用保护与保留输入 |
| T-B08 :37 | 负价给非负提示；移除失败出现撤销未完成；负数草稿保留；修复后删除手动价并关闭 | (iii) 原生有效性 + 失败路径 |
| T-B09 :38 | 倍率空白出现“空白不等于 0”；未写 defaults.codex | (iii) 空白不当 0 |
| T-B10 :39 | 自定义 Agent 恰有一行编辑 | (iii) 动态目录 |
| T-B11 :40 | 保存失败保留 '0'；重试保存 multiplier=0；查询估算确为 0 | (iii) 明确免费 / 倍率与 null 有别 |
| T-B12 :41 | 恢复默认不立刻改保存的 0；草稿变 1；显式保存后文件为 1 | (iii) reset 不是隐式保存 |
| T-B13 :42 | save 已成功而 pricing 读取失败仍显示“已保存…暂未刷新” | (iii) 保存与展示结果分别报告 |
| T-B14 :43 | 800×650 不横向溢出；原 statistics 逐字节不变；page errors 空 | (i) 基础错误/布局；(iii) 账本保护（将三项分别落实） |
| T-U01 unpriced-guidance:20 | 缺口/帮助可见；“补价格无法补齐”；原始历史字段无法恢复 | (iii) 缺失字段语义 |
| T-U02 :21 | help h4 ≤14px | (iii) 保留帮助小标题的尺寸约束，定位可改为相同语义角色；若Claude指定的规范角色与此冲突，先裁决再更新，不直接退役 |
| T-U03 :21–25 | 检查指定 DeepSeek 来源后 route=sources、sheet 关闭；对应 disclosure 打开；忙写原因可读且 render 后不丢 | (iii) 跨页来源定位；来源自身持久显示断言留原多页套件 |
| T-U04 :26 | 费用页可打开同一模型帮助 sheet | (iii) 跨页共用 editor |
| T-U05 :27 | 缓存写入帮助只在确认免费时填 0；切手动、保存 0 后该 gap 消失 | (iii) 未知价格与免费区别 |
| T-U06 :28 | statistics 原字节不变；原 cacheWrite 用量仍 null；另一读取缺口仍可见 | (iii) 补价格不能补用量 |
| T-U07 :29–30 | dark/narrow 不溢出；page errors 空 | (i) 深浅窄屏与基础错误 |
| T-S01 style-alignment:17、26 | 主题通过设置入口切换；深浅价格帮助打开、截图、关闭 | (i) 两主题共享 sheet；改操作入口，不删状态检查 |
| T-S02 :30 | 多页巡检后 errors 空 | (i) M3 同样无错误；原多页套件保留其余覆盖 |
| T-I01 interaction-reliability:72–87 settings 分支 | composition 内 Escape 保留文本；keyCode229 guarded；compositionend 后229仍 guarded；文本仍在；普通 Escape 清空 | (iii) 五项逐一保留；其它搜索页和 native command 防 IME 断言留原套件 |
| T-I02 :98–100 | composing 时模板值不变；active descendant 不变；Escape 不关内层；外 sheet 仍开 | (iii) 嵌套层 IME，不能以换 Radix 为由退役 |
| T-I03 :101–109 | cancel 与 submit 被阻止且外层开；compositionend 同事件回合确认键仍被 guard | (iii) 提交/取消保护 |
| T-I04 :111–116 | Home 保持文本编辑；普通 ArrowDown 移动选项；Enter 提交模板；不提交外 form；Escape 仅关列表，外层仍开 | (iii) 六项键盘/分层行为，DOM popover 查询换可观察语义 |
| T-I05 :118–119 | Tab/Shift+Tab/连续 Tab 均留 sheet 内；普通 Escape 关闭 | (i) 焦点 / Escape；长循环仍纳入 (iii) |
| T-I06 :139–140 | 分类 End 将焦点移到最后分类 | (iii) roving，不退役 |
| T-I07 :230–233 | 列表初始仅 bottom fade；中间 top+bottom；末尾仅 top；聚焦后 mask=none | (iii) 滚动与焦点可读性；Q3 组件未定，不降为截图 |
| T-I08 :234–248 | 无溢出无 fade；尺寸扩大清旧 fade；滚轮可滚列表；底部继续滚带动页面；顶部反向继续滚带动页面；reduced/off 仍保留必要边缘提示 | (iii) 六项逐一保留，不以去 CSS 为由放宽 |
| T-I09 :253–257 settings 分支、275 | 800 内容宽度下 scrollWidth≤viewport+2；截图；console/page errors 空 | (i) narrow 与错误；其它页面循环保留原套件 |
| T-C01 custom-sources:55–57 | pricing/billing 可打开；新 Agent 保存 multiplier=1 | (iii) 自定义来源集成，保留原来源导入流程于原套件 |
| T-C02 :112 | 全流程 errors 空 | (i) M3 部分无错误；原多页检查保留 |
| T-W01 workbench:49–50 | reprice 后成功文案含“账本与来源文件保持原样”；返回费用后 ledger 与之前字节一致 | (iii) 重估跨页一致性；费用核对事项断言留原套件 |
| T-W02 :58、60 | 原多页 errors 空（含设置重估动作） | (i) M3 错误为空；重启预算与项目金额继续留原套件 |

### 6.2 搜全部 ID 后追加发现的受影响套件

| 编号 / 旧出处 | 逐条检查 | 类别 / 去向 |
|---|---|---|
| T-F01 functional:48 | interval=5000；interval=0；enabled 仍 false | (iii) 频率不恢复已暂停采集 |
| T-F02 :64–68 | 模型加载≥7；无“清空统计并暂停”；未映射 alias 是缺口；已映射时目标正确；保存后 attention 隐藏且全部已定价；sheet 关闭；每条 pricedTokens=totalTokens | (iii) 七项逐一保留，数据语义不退役 |
| T-F03 :70–72 | 默认模型可搜索/滚动；菜单不透明度≥.8且 backdrop blur | 搜索、滚动归 (iii)；旧 blur 形态拟 (iv)，fluid 自有表面取代 legacy 模糊，需审核后以规范颜色/对比和遮挡检查接替，不擅自加 blur。Q5/Q6 |
| T-F04 :73–74 | 改实际模式隐藏默认模型；保存倍率1.5得到相同 bridge 值 | (iii) 规则动作 |
| T-F05 :75 | 默认模型表7行；搜索后1行 | (iii) 筛选，具体 fixture 数量保持 |
| T-F06 :77–78 | probe 与已存估算差值<1e-12；probe 文案六位小数；sheet 完全可见 | (iii) 精确试算与打开态；固定 opacity=1 查询替换为可见/稳定，不丢可见性约束 |
| T-F07 :79–81 | 手动保存 origin=manual、sheet关闭；移除后 origin=mapped；同步失败文案；缓存目录仍>7000模型 | (iii) 保存/回退/同步失败保持缓存 |
| T-F08 :85–86 | pricing dark/narrow无溢出；errors空 | (i) dark/narrow/错误 |
| T-A01 agent:66、68 | 内置 Agent 每个一行；保存 defaults 数量等于 SOURCES；每 config.mode='actual' | (iii) 所有 Agent 计费行；其余 source 流程保留 |
| T-UR01 usage:44–45 | 点击恢复后 enabled 且不 collecting；再暂停后 disabled 且不 collecting | (iii) 采集 switch 结果 |
| T-UR02 :48–54 | 手动保存成功；input rate=5；Codex费用=.000765（误差<1e-12）；移除后显示撤销成功 | (iii) 端到端定价；数值语义不退役 |
| T-UR03 :55–63 | 维护 disclosure可开；预览后apply启用；180→180 token；取消提示且无backups；再预览并确认后成功；恰一份backup；总量等于fixture | (iii) 维护预览/取消/确认/备份及历史保护 |
| T-UR04 :68–73 | 导出按钮 busy true→false；成功状态；无私人 sentinel/authUrl/accountId；无 fixture绝对路径；schemaVersion=LocalUsagePreviewV1 | (iii) 各隐私断言与busy均保留；开关/Escape另在(i) |
| T-UR05 :74–83 | 恢复后合成日志追加最终总量704；可见延迟<60000ms；暂停后历史仍704 | (iii) 只读合成来源与暂停保留；采集延迟检查留原套件，不在每个smoke重复长采集 |
| T-P01 polish:19 settings分支 | 页面标题栏=设置 | (i) 路由集成 |
| T-P02 :22–27 | 初始themeSelect=system；系统深色切dark；手动light后body不dark且localStorage=light；原生system后跟系统light且保存system | (iii) 设置/标题栏/菜单/系统四入口一致；不能只测试body.class |
| T-P03 :48 | 原生菜单导出打开；Escape关闭 | (i) 共用导出与焦点回归，原生菜单集成保留 |
| T-MO01 motion:25–33 | full初始；off；system随媒体reduce；system保持reduced；手动reduced | (iii) 动效偏好 / 系统覆盖 |
| T-MO02 :35–36 | reduced弹窗transform=none；存在动画且每个duration≤150 | transform/不受大位移动画影响归 (iii)；“必须存在CSS动画且≤150”拟(iv)，以规范reduced实际静止/完成检查接替，Q6 |
| T-MO03 :40–43 | 快速切页回usage；只有一个可见section；总量2,000,000 | (iii) 路由取消与数据稳定，原多页套件保留 |
| T-MO04 :47–55 | profile动画count>0；duration含280；focusInside；0/70/140/280帧opacity递增且末帧1 | focusInside归 (i)；动画存在/最终稳定归(iii)；固定280及旧CSS帧采样拟(iv)，改规范spring.slow的可中断/完成验收，Q6 |
| T-MO05 :58–62 | Escape关profile；焦点返回editProfile；同task关开最终仍开 | (i) 前两项；(iii) 关开竞态 |
| T-MO06 :64–65 | 导出关闭按钮确实关闭 | (i) Sheet关闭动作 |
| T-MO07 :81–82 | profile关后open=false；pointerEvents=none；退出duration含180 | 关闭且不拦点击归(iii)；固定180拟(iv)，换slow.exit完成/不截获输入检查，Q6 |
| T-MO08 :103–105 | 设置资料打开且focus在内部 | (i) 原设置入口焦点 |
| T-MO09 :110、113–114 | errors空；无codex-homes；重启仍off；uiMotion.preference='off' | (i) 错误；(iii) 偏好持久与不启动账号流程；quota相关其余不动 |
| T-D01 detail:71–74 | 设置reduced后用量数字立即到aria目标；activeCount=0；system+媒体reduce仍reduced | (iii) 跨页动效偏好保留原套件，改设置操作入口 |
| T-CO01 cost:83–87 | cost打开priceEditor恰一个；标题synthetic-unpriced；关闭动作 | (iii) 共享editor，不在M3修已知费用环形悬停失败 |
| T-TH01 cost:188、198；cost-layout:47、54；cost-composition:77；cost-rebuild:25、38 | 旧套件主题setup直接写themeSelect；其后的图表/布局/暗色断言不属于M3 | (iii) 原套件改用审核后的主题接口或真实控件操作，其后断言原样保留；禁止因为setup断裂删整套 |

### 6.3 纯模块与检索排除

涉及退役资源的单元测试也需显式映射，不能等删完脚本再放宽测试：

| 旧出处（`tests/m1/pricing-ui.test.js`） | 检查及去向 |
|---|---|
| :12–70 | (ii) origins / scope / 可定价判断、已用模型权重、只把可修价格列为动作、缺失用量仍信息性、原因与缺失字段、空输入转null等原纯模块断言全部保留。 |
| :73–77 | (iv，待审) 旧HTML字符串必须含每个固定id、排除已删目录表id的实现形态断言；(i)/(iii) 接替检查每个实际功能入口与“没有全目录表”的行为，不以保留死DOM满足旧id。 |
| :78–79 | (ii) escape转义保持；(iii) 新React页面另验证不把模型/Agent名称或资料文本当HTML执行。安全目的不得退役。 |
| :85–90 | (iii) 每个模型可编辑；移除仅在sheet；缺口百分比75%、未知比例显示60 Token而非0%；已计价模型无gap；(ii) 原view-model同值。data-* / class字串本身按审核后的markup迁移。 |
| :91–96 | (ii)/(iii) 缓存未知不为$0、明确免费为$0、缺主费率为未定价、空列表文案、目标映射文案；“—”具体字符与规范冲突单独列Q7，语义断言绝不退役。 |
| :103–119 | (ii)/(iii) 可修价格缺口不跳来源、75%占比、需确认免费、无法补齐历史、两种不完整原因及1.5M/500.0K、来源all动作、null状态为空、覆盖5.0M/3.0M/2.0M、无用量的覆盖说明、目录来源/更新/100模型、正文无摘要hash、title有摘要hash、null目录为空、两个模型/缺口计数与全部已定价文案；逐项保留语义。 |
| :124–125 | (ii) Agent ID/name排序配对；(iii) 检查Claude Code定向来源、补价无法补齐、没有无效改价动作；不能把ID/name配错当格式调整。 |
| :135–139 | (ii) 模板包含可用官方/手动模型，排除reference-unverified，保留有效选择，已消失选择清空；(iii) searchable picker同一候选集。 |
| :153–164 | dynamic bootstrap、引用资源在serve白名单、文件存在及脚本先后顺序：资源可达/无悬空引用继续(ii)；仅已确认退役脚本的固定文件名/旧顺序断言拟(iv)，用新的岛/UMD依赖与资源图检查接替。未退役共享脚本仍检查原顺序。 |
| :167–175 | (ii) renderer无usageClear/settingsNotice死绑定，preload无clearStatistics/usage:clear；(iii) 页面没有清空统计入口；全部保留。 |

- **(ii) 保持 `tests/m1/pricing-ui.test.js`**：uiPricing 数据选择 / 缺口 / 覆盖 / entry，以及 uiPricingView 的文案 / 边界输出；UI返回HTML的断言必须先有原输出与新结构数据的等价证明，再审查真正退役的markup项。不能移除 unknown、0、缓存缺失、冲突、未定价断言。
- **(ii) 原样提取后新增测试**：profile initials / profile保存值校验、维护next/diff与显示、probe影响/示例金额文案、controller独有筛选/排序/折叠计算。提取要先使旧页面调用同模块，再由React调用，不能跳过中间一致性证明。具体文件名由审核确认；这里不创建。
- **既有后端测试继续保留原归属**：`pricing-maintenance.test.js`、`pricing-sync.test.js`、`runtime-pricing.test.js` 等不因React迁移退役；不在此轮重写或执行。
- 对所有受影响套件的无 console/page error、isolated synthetic home/usage/quota、ledger bytes/privacy 校验均保留；表中重复的“错误为空”不能理解成可删除原套件覆盖。
- 额外检索命中但不涉及设置DOM的项：agent-install:59 的 calls 参数；config-health:15 的合成 `.claude/settings.json`；budget-overview:66 / render-performance:81 的 bridge.savePrice；cost-layout:21 / cost-composition:28 的 store.settings；workbench:42 的本地 workbench.json。它们没有设置页断言要搬，保持原套件，不误纳入M3后端/配置维护。
- style-alignment 的费用/用量字体边缘、来源、会话、预算断言继续原套件；custom-sources 的解析/导入/归档和workbench的项目/预算/导出/重启断言继续原套件；interaction-reliability 的来源、费用、会话循环继续原套件。

### 6.4 未来实施所需截图 / 新覆盖（本次未执行）

按计划 §2.6 放在 `artifacts/ui-mig/M3/`，旧版同状态放 `before/`：1280×900、light/dark；默认五区、搜索匹配/无匹配、目录无数据/读取中/读取失败/保存成功后读失败、partial/未定价/缓存未知/明确0、模型展开与收起、计费规则展开、三个dialog、目录菜单、资料上传读取中/失败、导出busy/取消/失败/预览、维护预览/取消/失败；title读数保留。追加800内容宽与既有100/125/150缩放覆盖，off/reduced状态稳定、焦点及IME。不可把本次静态引用索引当截图或运行结果。

## 7. 待决问题（所有项均未擅自处理）

| 编号 | 需要的审核 / 所有者裁决 | 不能直接实施的原因 |
|---|---|---|
| Q1 范围 | 确认M3可对preview.js中主题/资料/采集/导出、motion.js设置插行、window-shell菜单主题、sessions-ui演示监听、insights-ui设置重估、scroll-fade列表、index section外两dialog以及混合CSS做**仅解除设置DOM耦合**的定向改动；明确各处可改范围。 | §0.3.4 / §2.2与M3表列旧代码之间存在跨阶段文件边界，不能把M9外框/M4–M8文件整个拿过来。C1–C16列出了具体位置与拟处理。 |
| Q2 控件契约 | 由Claude审核kit属性扩展：TextField required/maxLength/min/max/step/disabled/readOnly/inputMode及受控focus/键盘；Select disabled；SearchField maxlength=60、旧clear文案与IME；表单submit机制。确认哪些可透传及原生validity如何保留。 | M1明确只允许既列属性。现TextField仅value/onChange/label/placeholder/type/error，Button仅onClick而无type，不能页面拼原生input/form控件或间接绕检查。 |
| Q3 新组件能力 | 审核个人Avatar/三tone/本地FilePicker、readonly JSON多行展示、三段coverage meter、带焦点可读边缘的滚动列表；明确相应API和视觉参考。 | 现kit无对应组件；AgentMark只给Agent。不得自己选图标、色、尺寸、mask/hover或降级丢功能。 |
| Q4 视觉映射 | 确认设置页最大宽/居中头部如何接PageHeader；分类SubTabs保留滚动spy；隐私三栏/目录网格如何映射36px行与不套卡片；覆盖数字figure档位；profile/export/price三个Sheet尺寸；搜索高亮、三段meter及tone的规范映射。 | 规范规定基础角色但未逐项指定这些已有组合，不自行作布局/颜色/尺寸决定。 |
| Q5 搜索选择与表格 | 审核可搜索目录combobox / 模板选择 / datalist的kit实现，完整ID、过滤、长列表滚动和键盘；DataTable整行click、标题title与稳定行身份；SubTabs End/scrollspy保持方式。 | 当前Select没有search API，DataTable无onRowClick/rowKey等；不能换普通下拉后删搜索、行点击或键盘断言。 |
| Q6 新旧弹窗与断言 | 审核Sheet/Select嵌套的IME、Tab范围、close-reopen、外部opener焦点返回方案；批准T-F03、T-MO02/04/07中具体实现形态断言的退役与新规范断言替代。 | 原测试依赖native dialog / CSS 280/180ms / popover-open / backdrop blur，而kit用不同实现；数据、安全、隐私、键盘可达不在退役项。必须先有可观察替代，不能只删除失败测试。 |
| Q7 数据语义冲突 | 裁决coverage null与缓存未知费率的“—”按规范改Value；确认现有uiPricing中`stats.tokens \|\| 0`等缺省、全体Agent tokens覆盖/占比汇总在迁移中如何遵守“不跨Agent相加”的字面边界。 | 已确认“—”与规范§6冲突；缺省0与既有用量汇总是待核对语义，不能直接认定损坏或重写。仅记录，不修、不改格式化。相关源码pricing-data:39–80、pricing-view:19/44–48、controller:117–126。 |
| Q8 现有文案疑点 | 隐私说明“不读取认证文件/不修改配置”与当前另行授权的登录和配置管理能力范围是否需要限定；系统信息静态版本与Codex-only说明是否保持原文。 | 源码确有旧说明，但本阶段§0.3.2及§8禁止自行改文案；不是本轮授权新的认证/配置读取，先按原文盘点。 |
| Q9 纯展示模块过渡 | 审核pricing-view文案/formatter/view-model的兼容导出，以及profile/maintenance/probe/controller纯计算原样提取的文件与测试；保留原全局依赖直到消费者与测试迁移完成。 | 旧模块返回HTML，不能直接塞React，也不能在TS重写计算/格式化；§2.4要求旧页面先复用证明相等。这是实现前的契约决策，不是允许删除模块。 |

问题表列出的都是审核输入，并非授权请求已经通过。M3实施前应先完成M1/M2统一审核、本盘点审核，以及适用问题的明确裁决；不可因Claude暂未上线推定批准。

## 8. 检查、提交与停止点

- 已做：只读Git基线检查；定向源码阅读；本页静态ID/全局双向引用检索；旧套件逐断言及状态等待映射；文档格式/来源定位核对。辅助检查确认99个完整ID与索引一致、103处显式文件行号存在且不越界、表格列数一致、UTF-8无BOM且仅LF；行号存在检查不等于运行或自动证明行为。提交前检查staged diff的空白与文件范围。
- **未跑**：build:ui、verify、audit:runtime、ui-foundation、settings-smoke及旧UI套件。原因：本次是计划明确的“盘点只出文档”子步骤，没有运行或改动实现；上述门槛属于审核后实现阶段，不能将M1/M2历史通过记为本轮通过。
- **未产出**：页面实现、生成bundle、before/after截图、打包和发布候选。静态源码足以交付盘点；运行截图留实现的同状态对照阶段。
- 只提交本文件，提交正文写清做了什么、未跑什么，末尾署名Codex。提交号由交付消息提供，避免在本文件中自引用未来hash。
- 交付后停止，等待Claude审核；不开始M3子步骤b、不执行M4、不合入main或远程写入。

署名：Codex
