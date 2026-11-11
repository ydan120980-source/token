# M12 内存续进验收 · 2026-11-01

本记录对应 `36ee2f0` 的产品代码和 `dist/20261101-M12-memory-v3`。`5441202` 提供流式保存、草稿/聚合/传输复用；`85b5e5d` 修补兼容运行依赖；`36ee2f0` 调整渲染器正常回收增长策略并补齐排队 tooltip 清理。本轮产品代码保持不变，最终测试脚本及文档另行提交。下面记录当前 v3 的实际验收与适用范围。

所有者最后选择继续削减峰值、暂不推送。只用新建的合成 home/usage/quota，没有新真实来源或账号验收；不合入、不推送、不创建 PR、标签、GitHub Release 或上传附件。旧 M11/M12 功能结果和失败记录保持原样。

## 全应用进程内存

每轮创建新合成目录；初始保存账本为 100 模型、500 会话、200 天，之后采集固定的小样本。三轮六页往返、四次实际合成采集，第三次追加 120 Token，最后可见静置约一分钟。10 万条的采集合计从 10000694 到 10000814，6.4 万条从 6400694 到 6400814。没有删除历史、改变未知/未计价或使用 GC、内存压力通知、工作集裁剪、旧生代容量上限、关闭 GPU/vsync。

下面单位为 MiB，均为整个应用进程树的和。**内存目标按 Windows 私有工作集（常驻 RAM）判断；私有提交量另列，没有宣称它也低于 500。** 独立 Windows 采样器在动作进行中查询应用及当时的子孙 PID；离散采样在页面/动作完成后执行。采样最高值不是任何瞬间的严格数学上界。

| 新包场景 | 私有工作集采样最高值（离散/连续两者较高） | 静置后私有工作集 | 私有提交量采样最高值 |
| --- | ---: | ---: | ---: |
| 64k，默认新策略 | 409.3 | 297.7 | 584.4 |
| 100k，第一次 | 444.5 | 304.9 | 627.9 |
| 100k，再次新目录复测 | 444.7 | 307.5 | 628.0 |
| 相同二进制，100k，CLI 改回 V8 默认增长策略 | 658.3 | 343.8 | 836.3 |

前三项在本轮导航及小批量刷新场景的常驻内存采样符合 500 MiB 上限。对照只改变 `--heap-growing-percent=0`，没有更换二进制或数据算法，不能把这个对照差值当作整个 M11→M12 的单因素收益。新策略/对照的实际 js-flags、Electron/Chromium/V8、显示器、数据总量、进程分类、原始计数及阶段耗时均存入 JSON。

第一次 100k 和 64k 的连续计数各缺 1 项，对照缺 2 项，均保留未完整计数而未补零；所有动作后的离散样本完整。第二次 100k 连续计数全部完整（191 项），最大实际间隔 706ms；其余新策略最大间隔 709–742ms。普通 WorkingSet 包含共享页，另存但不当作私有 RAM 相加。

原始报告：`artifacts/m12/memory-next/v3-packaged-64k/`、`v3-packaged-100k-first/`、`v3-packaged-100k-repeat/`、`v3-default-growth-control-100k/`。参数依据、失败试验、旧包 567.3 MiB 和源码结果见 `M12-MEMORY-20261101.md`。这不是初次导入任意大小来源、所有账号组合或所有硬件的内存保证。

## 当前验收状态

| 项目 | 当前证据 |
| --- | --- |
| verify / runtime audit | 通过；最终 verify 修正重复 Event 全局声明后复跑 fail 0，首个 lint 失败日志保留 |
| native / stress / crypto | 当前源码通过，日志 `headless/*-v3-20261101.log` |
| 受影响源码 UI | statistics-worker、Today、render-performance、app-shell、高刷新 100%/150% 通过 |
| 运行依赖 | body-parser 2.4.0 / fast-uri 3.1.9；运行依赖公告审计 0，SDK 保存查询集成通过。构建工具其余公告未清理，不等于完整安全审计 |
| Windows 构建及 ASAR 审计 | 通过；234 个产品源码/资源/文档逐字节匹配，固定 tokscale 校验通过 |
| 打包版全部 UI / 额外性能 | 全部唯一 UI 套件最终通过；首轮有 1 项 polish 失败，指针隔离后连续两次通过，保留原单 tooltip/几何/交互断言。额外 desktop 100%/150% 通过，旧 tab/tr 定位及无变化状态 DOM 假设的两次失败保留 |
| 中文空格路径解压、实际采集、Noto | 88 个文件、435780535 字节与 ZIP/构建目录逐字节一致；解压副本 agent-recovery 实际采集四种首归属/缩放组合通过，合成来源哈希不变；两份 Noto 文件响应、loaded face、CDP 实际中文字形通过 |
| 六页两主题完整截图、像素复核及新审阅包 | 新图 48 PNG 和两份 manifest 已齐；像素最终 34 组通过；完整审阅包与原生图见下文 |
| 源码/运行 ZIP、清单和逐字节核对 | 运行 ZIP/解压通过；源码 ZIP 全条目与当前文件核对、tracked UI 全覆盖，交付清单见下文 |

## 视觉、流畅度与证据边界

今日卡片在打包版两次真实五秒合成采集间保持同一 DOM，mutations/projects/位移/高度变化/活动动画均为 0；筛选后金额与 Token 仍即时改变。五项原视觉待决本次由 Codex 实施，Token 活动断言通过且 visual-review-required 列表为空；两主题标题栏元素与实际文字中心偏差均为 0px，widget/Agent 阴影与按压回弹轨迹通过。主观手感仍需所有者判断。

单块实际 300 Hz 屏幕：打包 100%/150% 的稳定原生 rAF 中位均 3.3ms、p95 均 3.4ms，最大分别 3.6/3.4ms；1000 次同帧 pointer 事件均只提交一次 tooltip 更新。源码 150% 中位 3.3ms/p95 3.4ms/最大 3.5ms。没有固定 60Hz 定时器、强制取消帧率限制或关闭 vsync。未实测其他刷新率/跨屏。

额外 20k/100 模型/200 天桌面复核：100%/150% 范围提交同步耗时最高 1.6/3.1ms，费用范围 0.1/0.2ms，所有日期范围与曲线、金额重算、同序列重定价正确；原图表在范围/主题/筛选切换中复用。状态不变的实际 hydrate 后无图表 SVG 几何更新。**范围切换采样仍出现最高 120/110.1ms 的帧间隔，这一版本不宣称交互全程满 300fps。** 同步提交耗时不能代替端到端呈现延迟。

旧 polish 首跑出现 calendar 与 price 两个提示；隔离 OS 指针后两次新窗口通过，属于现有证据支持的测试干扰处理，不据此声称证明了所有输入组合。保留重复提示时的焦点/hover/提示诊断。额外 desktop 旧脚本先找 button/li，再要求已暂停且不变的状态文字发生 mutation；按现有 tab/tr 语义和真实 `usage:hydrate` 完成信号修复，原金额、图表复用与 <200ms 门槛不降低。日志：`headless/desktop-v3-20261101.log`、`desktop-v3-current-kit.log`、`desktop-v3-current-kit-final.log`。最终 lint/单元 `verify-v3-closeout.log` fail 0。

Browser 插件未提供，使用仓库 Playwright/Electron 工具。完整截图为 1440×1000 及实际扩展的长视口，六页两主题各 24 张：`artifacts/m12/screenshots-v3/before` 是 Git `1dd6ada` 的 **M11 历史源码复现**，`after` 是本次 **M12 v3 打包版**。两侧合成 fixture、Date、文件 mtime 均固定为 2026-11-01T03:00Z；performance/rAF、统计 Worker 的业务时钟和采集完成时间保持原生。它不是旧 M11 二进制对照。双方 manifest 包含 bundle/ASAR SHA-256、文件、实际尺寸和错误列表；未改历史截图。打开 `artifacts/m12/review-v3/index.html` 切换查看。

新完整截图交由所有者自行转发给 Claude；未代发消息或上传。自动像素通过不代表 Claude 审阅意见。


## 像素复核与交付

首轮把当前截图与旧 PNG 混合基线比较，34 组中有 14 组超出阈值：10 张整页截图高度相差 64px；来源页 4 张另有跨月预算文案变化（旧图十月，当前 Worker 业务时钟十一月）。该次失败在 `pixels/v3-compare`、`headless/v3-pixel-compare.log` 原样保留。不能裁剪图片、掩盖预算文字或加豁免来通过。

改用已验收 M12 源码 `af35e95` 的只读 Git 归档，和当前包由同一截图脚本在同一天重拍；相同固定 renderer Date/fixture mtime、sRGB、1280×900、动效关闭、相同交互场景及长图留白。两侧 Worker 业务日期同为当天。参考侧是历史源码运行，非旧包；归档没有改变生产工作树。完整 provenance 与归档 marker 单独保留，不能只用归档目录向上查到的父仓库 HEAD 判断参考版本。`pixels/v3-reference-recaptured` → `pixels/v3-after` 最终 **34 组全部通过 0.002 阈值，无豁免、无缺图**，报告 `pixels/v3-recompare/report.json`。

- 完整可切换前后图：`artifacts/m12/review-v3/index.html`；新 48 PNG 见 `screenshots-v3/{before,after}`。
- 实际原生窗口：`artifacts/m12/v3-native-window/dark-usage-native.png`，Computer Use 仅捕获明确标题的本次合成窗口，没有捕获真实账号窗口或执行系统输入。
- UI 最终结果及首轮失败/复跑索引：`artifacts/m12/v3-final-ui-results.json`。
- Windows x64 验收包：`dist/20261101-M12-memory-v3/AgentUsage-CodexQuota-Windows-x64.zip`，SHA-256 `1e7bca185897ffe9aa97b2be8382acaa23dc86043f8fbbd410a25ade013f631d`。
- 当前源码：同目录 `AgentUsage-CodexQuota-source.zip`；清单 `AgentUsage-CodexQuota-delivery.json`，校验 `SHA256SUMS.txt`。源码 ZIP 不写入自身哈希，外部清单避免自引用。
- Claude 手动审阅附件：`artifacts/m12/M12-v3-review-and-evidence.zip`，外部 `v3-review-package.json` / `V3-SHA256SUMS.txt`；包含完整前后图、原生图、原始内存、UI 首轮和复跑、字体/解压/像素及本次相关失败日志。不含运行目录、真实使用记录或认证文件。

运行包未签名，应用版本仍为 0.1.0。运行依赖公告审计为 0，但构建工具仍有公告，未进行整库安全审计。Git 待同步历史启发式检查没有命中所列高置信凭据模式或 >=100MiB blob；这不是无秘密或安全性的证明。

本轮本地合成验收完成；仅以已列工作负载认定常驻内存采样目标达成。没有新真实来源/账号验收、任意全量初次导入 RAM 测试、跨屏/其他物理刷新率测试或 Claude 主观审定。所有者最新“暂不推送”持续有效：未合入共享 main、未推送、PR、标签、Release 或附件上传。
