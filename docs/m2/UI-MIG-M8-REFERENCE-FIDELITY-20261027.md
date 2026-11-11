# M8 原费用页一比一对标与补充申请 · 2026-10-27

**状态：所有者 2026-10-27 已明确批准本文件 §4 的限定接口，以及完整原版对标对冲突条款的处理，要求继续 M8。** 本轮从候选 b587858 开始修订；以下84对失败图保留。不继续原“列出差异后即可交审”的收尾，不称 M8 已完成。批准仅限本文列出的固定参考模式，不授权其它 kit 接口、新取值或范围扩张。

## 1. 最新所有者要求

所有者原话：**“截图对比差距过大,原费用页是标准对标设计,ui和motion必须一比一对齐”**。

本轮参考固定为迁移前本地 main `0ac94cf2f8599188d03e0405ce55a00824c57ae2` 的费用页，包含已合入的新外框。它高于与之冲突的“控件换 kit 后按 kit 默认外观”“费用页只出图、不作为通过条件”等旧要求。React / Tailwind / kit 的迁移架构、Host / Ui 分工、纯计算、数据语义、逐项授权、M8 后停止、M7 未开始以及其它页面原样通过的约束保留。

按完整原版一比一执行时，需要连同旧说明文字、700 字重、440px 详情、日期范围浮层等一起恢复。它们分别与旧裁决 §5 删除说明、§1 G 的 600 字重及 M8 Q5 的 540px Sheet 冲突，**所有者本次批准已确认按完整原版执行**。未知不变成 0、精确金额、CSV 范围、无真实来源/账号读写等数据与安全约束不撤销。旧版若显示“—”，仅恢复可见标记，底层仍为 null，并保留无障碍的未知含义。

## 2. 现有候选的硬比较结果

将现有 84 对完整费用图按同一文件名逐字节复制后比较，没有改图：

```text
node scripts/m1/ui-pixel-gate.js compare artifacts/ui-gate/M8/reference-fidelity-audit/before artifacts/ui-gate/M8/reference-fidelity-audit/after artifacts/ui-gate/M8/reference-fidelity-audit/report --budget 0.002
84 pairs, 84 over budget 0.002
```

预算仍为 0.002、通道阈值仍为24，无缺图、无 approved 例外、无新增遮挡。差异最小 3.900%、中位 6.375%、最大 74.243%。两尺寸、两色、18 个必拍场景及额外本月 C 页均保留。main 和候选使用已批准的同一合成时钟/mtime 准备。

原始证据：`artifacts/ui-gate/M8/reference-fidelity-audit/report/report.{json,md}`、`copy-index.json`、`.cache/m8-reference-current-compare.log`。原图浏览入口仍是 `artifacts/ui-gate/M8/review/index.html`，84 对图来自 main 0ac94cf 与候选 b587858。这一轮全部不满足新的费用页门槛。

此前费用功能、数据、键盘/焦点及共享套件通过，五个未改页面40对零差异，不能证明费用页符合一比一。此前性能检查也不能证明动效一致。**新的 motion 一比一帧检查尚未执行。**

## 3. 已按实际源码确认的主要偏差

| 项 | main 0ac94cf 的标准 | 当前候选 / kit |
|---|---|---|
| 页头 | 标题与费用分析/项目切换同行，导出在右 | SubTabs 全在 actions 右侧；新增常驻日期入口行 |
| 首屏 A | 原 1.6:1 两栏、原 header 和事实块；数字60px/700，上界22px | 600 主数字、28px上界、控件/说明改变导致高度和位置改变 |
| 三事实 | 22px读数；原间距、说明；spark 96×36按原直线点位 | 20px读数，说明删除，spark 使用不同的内边距和曲线 |
| 本月 C | 原 gauge 随220–280px列宽填满，原17px推算读数 | kit gauge固定240px，中心字号与位置不同 |
| 控件 | 原30px紧凑控件、原图标、选中面、指示条 | fluid 默认尺寸、外形、图标和弹簧 |
| 日期范围 | 原320px浮层，位置由费用面板边缘决定，原scrim和展开行为 | 400px全高左侧Sheet，入口固定到整个窗口左边 |
| 走势 | 原两行读数、22px/700总数、胶囊图例、原日期/字重/背景 | 同行小字读数与inline图例，Card表面和字形不同 |
| 两栏 | 原标题区、图标、408px正文、边框/圆角/留白、收起条 | 部分几何同为408，但表面、标题、控件及结构不同 |
| 构成和按月 | 原22px中心、金额图例字重、原月份读数和图例位置 | Figure md 28px、金额常规字重，按月图例被移到图上方 |
| 明细/订阅/覆盖/缓存/预算 | 原网格、行/表头、输入、步骤串、完整文案与读数位置 | DataTable、Disclosure、TextField、Card等采用默认外观；若干结构和说明改变 |
| 覆盖环 | 原 `--cost-cover-compact:96px` | 当前 coverage 档112px；原色已接回但尺寸仍不同 |
| 详情 | 原440px、12px inset、22px圆角、原滚动/动作布局和完整文案 | 540px、无inset、全高Sheet、3×2指标和footer布局 |

已恢复的部分（例如数据 null/0、cost/stack连续区间、partial/cursor原色）保留，不回退成错误实现；其余视觉参数逐项以原版为准。

### 原版 motion 的真实参数

这些参数来自实际 main 源码，不沿用旧文档对统一数据档的概述：

| 角色 | main 的参数/计算 | 依据 |
|---|---|---|
| 首屏构成条入场 | 700ms，delay=80+i×60ms | `cost-hero.js` enter |
| 本月每日柱入场 | 600ms，delay=120+i×16ms | `cost-hero.js` enter |
| 本月已用弧入场 | 1100ms，delay=120ms | `cost-hero.js` enter |
| 首屏滚动数字 | 720ms，逐位22ms；长度变化短淡入；快速路径160ms | `ui-carousel.js` roll/rollIn、tokens.css |
| 环图弧入场/变化 | 入场1000ms、delay=120+order×90ms；变化700ms；原 ease() | `cost-donut.js` update/draw |
| 环图底轨/中心 | 底轨700ms；数值count800ms；中心切换淡入上移4px为160ms | `cost-donut.js` |
| 月份柱 | 入场800ms、变化500ms；month×40+series×25ms，原各段delay | `cost-bars.js` shape/draw |
| 走势变化/揭示 | 变化550ms，原几何混合；揭示1100ms及原easing | `cost-stack.js` morph、cost.css、tokens.css |
| 微图揭示 | 1100ms，原 chart-ease | cost.css / tokens.css |
| 两栏、翻页 | 原 panel520ms和原sheet-ease；拖动、阻力、阈值、打断、只首次入场按旧代码 | `ui-carousel.js`、cost.css、tokens.css |
| Sheet/范围层 | sheet420ms及(.32,.72,0,1)，opacity/disclosure250ms；原reduced/off规则 | cost.css、tokens.css |
| 分段指示条 | pill380ms及(.34,1.26,.64,1) | cost.css、tokens.css |

当前通用 data.enter800 / update500 / stagger40封顶400 和三档 spring 不能直接覆盖这张表。原版 follow520/42/.6 已对应的部分不改。每项的实际终态、过程、打断和 full/reduced/off 都需要验证。

## 4. 申请的限定实现接口

**仅申请一个固定的费用对标模式。所有样式和动画取值只能从上述 main 源码/现有token移植，不开放任意颜色、尺寸、时长或CSS入口；其它页面和默认 kit 外观/行为保持原样。**

| 接口 | 最小补充与用途 |
|---|---|
| 新增 `CostReferenceProvider` | `{ children: ReactNode; part?: CostReferencePart; rootRef?: RefObject<HTMLElement|null> }`；part仅允许 `page / hero-range / hero-fact / hero-month / trend / composition / months / subscriptions / fees / detail / coverage / cache / projects / budget / range / tooltip`。只M8启用，rootRef提供原费用面板边缘定位；嵌套provider只传上下文，不增加布局盒。 |
| 现有 kit 的固定参考分支 | Button/IconButton、Segmented/SubTabs、Select/TextField/CheckboxGroup/Form、Card/Disclosure/Badge/Banner/EmptyState/ScrollArea、AgentFilter/EdgeTrigger/PaneGroup/Carousel、全部费用图表和提示层读取该上下文；固定恢复对应原部件的样式、布局和motion。不给这些组件逐个增加任意样式props。 |
| `PageHeader.inlineActions?: ReactNode` | 将原切换组放在标题同行，右侧actions只留原导出；默认布局不变。 |
| `Figure.size`追加 | `cost-title1`→现有22px、`cost-title2`→现有17px、`cost-detail`→现有34px；仅参考模式按原字重/行高/字距显示，原 `cost-hero` 在此模式恢复700。均命名映射到原值。 |
| `Figure.count?` | `{ value: number|null; format: (value:number)=>string }`，只承载原环图800ms数值插值，原format由UMD提供；未知不调用format、不变0。首屏仍沿原720/22ms逐位滚动，其他数字按原角色静态显示。 |
| `Value.unknown`追加原标记 | 仅允许原费用页已存在的 `— / 未报告 / 未计入 / 无法估算 / 没有记录`；默认“未知”不变，底层null和可访问语义保留。 |
| `Column.header?: ReactNode` | 恢复原费用表头内排序入口，避免额外占一行；默认label行为不变。参考模式按原费用行/字段/价目布局，不改行数据与CSV口径。 |
| 新增 `CostIcon` | `{name: ...}`仅允许原费用使用的现有 `calendar/download/maximize/minimize/layout-sidebar/layout-sidebar-right/chevron-left/chevron-right/x`，复用已有SVG资产，不画新图标、不接受外部路径。 |
| Sheet的参考实现 | `part=range`恢复原aside/浮层；`part=detail`恢复React控制的原生dialog几何、滚动、关闭/焦点和CSS时间线。保留现有open/onOpenChange/children接口；不重新挂旧UMD DOM renderer，默认Fluid Sheet不变，不改vendor。 |
| 参考motion集与样式迁移 | 新增 `ui/src/design/cost-reference-motion.ts` 与 `ui/src/theme/cost-reference.css`；只移植固定原角色参数、原计算/打断规则和原CSS声明。仍引用已有token；原CSS/JS里尚未token化的存量字面量允许原样搬入这两个固定参考文件，不由Codex重新取值，不能增加来源之外的新值。这是仅针对费用参考模式的明确迁移许可，不扩散到默认kit或页面代码。 |
| 限定的新增命名映射 | body作用域仅追加 `--cost-ref-card → --card`、`--cost-ref-muted → --muted`、`--cost-ref-input → --input`、`--cost-ref-accent → --accent`，避免React同名变量覆盖；theme仅追加三组figure字号/行高/字距到原17/22/34及原行高字距；两项字重别名 `--cost-ref-weight-strong:700`、`--cost-ref-weight-control:550` 来自原CSS。原token值不改；如需其它新增别名或新取值，仍停下提问。 |

涉及文件限定为：`ui/src/pages/cost/` 和相应cost/insights类型及纯投影；`ui/src/kit/{cost-reference.tsx,index.ts,controls.tsx,surfaces.tsx,composed-surfaces.tsx,extended-controls.tsx,carousel.tsx,data-display.tsx,motion-mode.ts}`；`ui/src/kit/charts/{common,geometry,bar-chart,line-chart,ring-chart,stack-bar,legend,tones}.tsx/.ts` 中对应现有文件；上述新design/theme文件、theme/index.css、tokens.css命名映射；必要合成测试、场景/断言映射、构建产物和本页记录。若发现名单外接口或不能在现有guard内实现，重新按§9.4停下提问。

不修改 vendor、设计检查或 allowlist，不降低/跳过断言，不再使用“改成kit默认形状”代替原版。页面仍只组合kit；所有视觉/动画实现留在kit及design/theme。代码一个JSX元素一行，便于逐项审核。

## 5. 完成标准与顺序

1. 先对齐1180浅/深的主界面，再对齐本月C、范围、两栏、明细/详情、订阅、核对及项目预算；随后两种尺寸全部84对费用图过原0.002/24门槛，不能只交差异清单。图对不减、遮挡不加，不自行豁免。
2. motion按原角色参数和原计算，在同一合成状态下比过程、终态、打断与full/reduced/off；记录实际运行的基线/候选轨迹和帧，不把参数表或性能测试当成已验证。不能达到就保留失败，不宣称一致。
3. 五个未改页面40对仍须原样通过；费用全部必过套件、同fixture三连跑、页面smoke、共享gallery/foundation、verify和runtime照旧。
4. Windows Job main基线失败单独保留，不借UI修订改后端，不以此放宽UI/像素或其它断言。M8完成后停止，等Claude审核，不开始M7、不合main、不推送、不打包、不读真实数据、不使用子代理。

## 6. 为什么此处申请而不直接扩展

计划 §9.4：**“影响 kit、规范、vendor、theme、tokens、设计检查，或影响后面多页：停止全部工作并提问。不得自己扩展 kit 接口、加设计例外或换写法。”**

新的完整对标跨越现有逐项接口和“三档弹簧+一个数据档”等规范边界，因此先申请具体承载接口及冲突条款。所有者随后明确批准，§4 的实现已经开始；以下追加项仍单独受 §9.4 约束。

## 7. 实施状态与 RangeCalendar 文件补充申请

**2026-10-27：§4 已开工；所有者已明确批准本节 `range-calendar.tsx` 单文件补充，恢复 M8。**

已在 `ui/mig-m7-m8`、HEAD `b587858` 上保留未提交 WIP：费用参考上下文、原样隔离的 CSS、原角色动效参数、首屏布局、数值、微图、翻页、页头、Agent 选择及分段控件的参考分支。未修改默认 vendor、guard、allowlist、后端或 IPC。没有操作 main 和受保护的 M6 工作区。

首轮 `build:ui` 通过，首轮 TypeScript 和 design guard 通过；这些结果对应首轮复拍前的代码，**不能充当随后源码修订的复验结果**。1180 浅深、本月 C 的四个捕获状态已完成，图在 `artifacts/ui-gate/M8/reference-hero-1/1180x850/`。首轮图仍存在偏差：大数字多一层 inline 盒子、viewport 高度漏算上下 padding；已作源码修正，尚未复拍确认。其余区域尚在实施，不能称页面一比一通过。已有 84 对硬比较失败证据保留。

### 唯一追加申请

将 **`ui/src/kit/range-calendar.tsx`** 加入 §4 的允许文件列表，仅增加读取既有 `CostReferenceProvider` 的固定费用参考分支。**不新增公共属性**；现有 `value/min/max/onChange/commit/marks/aria-label` API 不变；默认日历分支不变。

必要性与证据：

- 当前 `range-calendar.tsx:29–34` 的标题在左、两枚图标按钮在右，星期独占一层，并固定渲染 42 个相邻月份日期，没有原版 second-click 提示。
- main `0ac94cf:design/desktop-reference/cost-page.js:101–114` 的 `calendarHtml` 是“上一月文本箭头 / 居中年月 / 下一月文本箭头”；星期、起始空位和当月日期共用一个 grid；只画当月日期；尾部显示“选两天定一个范围；带点的日期有用量”或“再选一天作为终点 · Esc 取消”。选区含 `in/is-start/is-end/is-l/is-r` 的原几何和预览状态。
- 两者的节点、日期集合和状态标记不同，单靠主题 CSS 不能正确恢复；不在 Sheet 内复制一份日历、不重挂旧 UMD renderer，也不使用 HTML 注入或 DOM 替换绕过文件清单。

批准后的限定改动：原样迁移上述日历 DOM 角色、文案、当月格子/空位、选区/记录点及既有键盘/IME/焦点行为，视觉取值仍只来自已批准的 main 原 CSS/参数；仅 `part=range` 启用。保留第二次点击提交、未知不补零、既有数据/隐私边界，验证默认日历与其它页面无回归。

停工原因来自 §4 的**明确文件清单**和计划 §9.4 的“停止全部工作并提问”；不是新的设计选择。所有者随后答复“批准这一文件补充，继续 M8（推荐）”，因此本节限定范围现为有效裁决。M7 未开始，M8 未交付、未提交此轮 WIP、未合入 main。

## 8. 2026-10-28 实施与复验

所有者再次明确批准“完整对标及限定接口”，§4、§7 均已生效。参考模式仅用于费用页；原字号、700 字重、440px 详情、原说明文字和逐角色动效按 main `0ac94cf` 恢复，覆盖此前冲突的 UI 条款。费用摘要仍依最高裁决 §4 撤回。

本轮实施包含：原首屏及首次翻页入场、范围层及日历、原生控件、两栏切换、环图数值插值、月份几何、走势原始值混合与打断、原详情及行内微图键盘、共享胶囊实时读数。固定参考 CSS 保留原导入顺序和选择器权重，类名与动画名独立命名；原 body/caption 的 14px/12px 仅在该固定文件物化，避免 Tailwind 同名主题变量泄漏。`@starting-style` 内也显式保留 React 根作用域。默认 kit、vendor、设计检查、allowlist、后端和 IPC 不改。

新增计算测试把原 `motion.js` 的 follow/enter 放入独立 VM，以不规则帧、两次打断、隐藏与断开清理、reduced/off 和淡入重定向核对参考实现；原始值堆叠测试保留 null 端点与部分混合帧。真实 Electron 采样保留 rAF、原生动画和时间线，记录过程帧、终态、打断及三种模式。测试工具在本机发现跨盘 `fs.cpSync` 未产生目标目录，旧 motion-5 两侧账本哈希不同，故不能作为同一数据证据；最终采样改用逐文件复制并断言字节相等，旧证据不删除。

构建、TypeScript、lint、边界与新增计算测试已通过；完整像素复拍、最终同 fixture 三连跑、串行全量 verify 及最终交付记录仍在进行，不能据此宣称 M8 全部门槛已通过。最终结果只以 `UI-MIG-M8-20261028.md` 所列实际输出为准。M7 未开始，不合 main、不推送、不打包，M6 工作区保持原样。

最后的项目展开对标还定位出一项原样式的承载偏差：main 中 summary 箭头的 `::after` 计算样式为 `content-box / 5px / 1px border`，React preflight 将其改为 `border-box`，使金额右移1px。仅固定参考 CSS 恢复 main 的盒模型，未新增接口、尺寸或 token；来源行的连续文本也按原 HTML 合为单一字符串。`artifacts/ui-gate/M8/project-box-probe/` 保留两侧计算样式，`project-box-fixed/` 保留修正后证据：所有可见项目/预算字段的 bounding box 与原版一致，三张图过原门槛。完整图组仍重新拍摄，不用局部图替换失败图。

随后逐角色复核真实轨迹发现首次大数字入场的实际差异：原 `ui-carousel.js:rollIn` 在设置 `transition:none` 后清空 transition 简写，自然清掉各位的 delay；后续 `roll` 更新才使用22ms错开。参考分支在 `rollIn` 中额外重设了逐位 delay，造成首次可见数字也错开。只删除这两行额外 duration/delay 赋值，恢复原代码行为；后续更新、720ms时长、缓动、160ms快速路径和清理规则不变，无新增接口或参数。

实机记录器追加费用主数字及 inert 邻页的角色标记，并断言首次可见数字实际原生720ms transition 的 delay 都为0。修改前真实 Electron 记录在 `reference-number-entry-failed/`，该断言确实失败；修正后 `reference-number-entry-fixed/` 的 full 模式10个实机场景通过，构建、类型和该脚本 lint 通过。此前30组终态数值差为0的结果不能说明该首次过程已对齐，保留旧证据并重新执行两侧 full/reduced/off 的30个场景；最终结果只按最新交付记录。

进一步对比过程图和原生动画清单，发现此前遗漏了原 `cost-page.js:655–657` 的区块首次进入视口动画。仅在固定参考 Provider 中移植原 IntersectionObserver、原0.12阈值及 `data-cost-risen` 生命周期；700ms、位移和缓动仍取原CSS/token。已进入过的区块按同一页面ref记忆，离开再进入不重复播放，卸载断开observer。阈值存放在已批准的固定参考motion文件，无新增公共kit接口、token或视觉取值。

原版进入费用时会用相同trendKey再次渲染，移除预渲染留下的reveal类；候选却从首次挂载开始完整播放1100ms揭示。固定参考分支的首次reveal设为false，后续日期范围/Agent key改变仍按原1100ms播放。默认kit分支不使用这项参考状态，不变。

新增真实700ms章节动画断言在旧候选失败，保留 `reference-chapter-entry-failed/`；修正后full模式通过。又新增7天→30天→累计的连续范围打断，记录真实clip宽度并断言仍有1100ms揭示。首轮新增范围选择器误把可见文本当aria-label，保留其超时日志后按实际原生DOM改为固定按钮序号，未改产品或放宽断言；`reference-chapter-range-fixed-v2/` 的11个full场景通过。最终复验扩为每侧33场景、132张过程图，旧30场景记录保留，不能替代最后代码。

**最终复验已完成：** 候选7167d3f两侧三模式33场景均通过，相关终态数值差为0，真实过程共10197/9626帧、每侧132张图；没有声称独立运行同一毫秒逐像素相等。静态两尺寸124对通过原0.002/24；未改页38对为0，两张设置页只在顶栏focus文字有残余，未自行重拍或豁免。业务同数据三连跑、15个费用/共享UI套件、最后串行verify（fail0）和runtime均通过。最新完整命令、原报告、证据边界、旧失败和停止点见 [2026-10-28交付](UI-MIG-M8-20261028.md)。后续仅提交交付记录，不改产品，不开始M7，等待Claude审核。
