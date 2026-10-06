# 桌面额度动效、趋势连续性与 Agent 选择 — 2026-10-05

本轮依据用户四张截图完善桌面端。唯一产品入口仍为 `src/quota/main.js`，沿用 Nowdex、Apple design、Electron / Chart.js。历史交付、已有数据与连接、当前未提交改动均保留。无 subagent；CodeGraph 与 Browser 技能未提供可用运行时，采用定向源码核查、隔离 Electron / Playwright 验证。

## 已实现的合同

- 额度卡片和详情保留 50 段轨道，增加独立的连续填充层，820ms `cubic-bezier(.42,0,.2,1)`，先加速后减速，无超出确认额度的回弹。首次可见进入、数据更新、反向更新均有反馈；中断读取当前呈现的 clip-path，不从零重放。状态/时间文案更新不重复播放。未知值不填充，0 与未知不同；aria 永远暴露真实确认值。减少动态/关闭动态、后台隐藏时立即落到最终状态。
- 额度自动刷新由 5 分钟改为 1 分钟，固定 IPC 值为 `off | 1min`。关闭、重启不自动启用的原有边界保留，开启后下一次调度为 60 秒。睡眠恢复至多补一个到期批次，不补发错过的所有批次；慢批次超过间隔时完成后等待新的一分钟，避免立即补发；中途关闭不重启计时。原账号队列、单账号不重叠、普通失败 60 秒/服务限流 15 分钟冷却继续有效。该选项独立于本地用量采集频率。
- 趋势实际记录段保留原曲线；未记录日之间通过低对比的短虚线连续连接，缺口不再呈现散落的孤立段。连接线只表达前后记录的位置关系，未生成日用量、插值费用或零值。悬停/键盘停在缺日时显示日期与“未记录”，有记录但字段/价格未知时保持透明硬缺口，并提示未知。滚动平均覆盖不足、覆盖起点以前的缺失也不连接。正常费用虚线、Token 右/左轴单位、筛选/累计/粒度、聚合账本与导出均不改。
- Agent 下拉改为紧凑图标按钮组：全部、Codex、OpenCode、WorkBuddy、Claude、MiMo。保留原 select 的唯一值/保存接口，只替换呈现；单选状态、名称提示、可见焦点、左右/Home/End 键切换，继续级联来源和模型。窄窗口图标组独占一行，其他四项保持两列。未把模型供应商冒充 Agent，也未显示尚未接入的 Agent。

## 图形来源

Codex/OpenAI 和 Claude 沿用项目现有图形。新增图形均在开发时获取并本地打包，运行时没有远程图片请求：

- OpenCode：官方 [品牌页](https://opencode.ai/brand)，[浅色方形 SVG](https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/asset/brand/opencode-logo-light-square.svg)。
- WorkBuddy：[官方产品站](https://www.workbuddy.ai/) HTML 引用的 [SVG](https://download.codebuddy.ai/web/workbuddy/f5bce0c03cdc17fa28d25634fb48d2791c297da3/assets/logo.svg)。
- MiMo：[官方站 SVG](https://mimo.xiaomi.com/mimo-v2-pro/assets/logo.svg)，只裁切 viewBox 到 MiMo 字标部分，以保持小按钮可读；不修改路径。深色主题用明度处理保证对比。
- “全部”的网格图形为本项目简单 SVG。新增 SVG 检查无 script / foreignObject / 外部 href / on* 事件，不授予品牌商标所有权或暗示官方背书。

## 下一轮接入准备

“其他 Agent”的目标与接入类型待用户选择。用量统计与账号额度是两条不同合同，不能因已支持某 Agent 的日志采集就声称支持其在线额度。

1. 本地用量新增来源：确认官方日志格式、只读目录和增量/去重标识；实施点为 `src/m1/policy.js` 的来源/路径/文件白名单、`sources.js` 的字段投影、`normalize.js` 的缓存/推理语义，随后检查 `store.js` 持久化及 `service.js` 调度。补入对应真实格式的匿名合成 fixture，覆盖累计重置、迁移重叠、未知、免费和定价映射。真实来源样本遵守已有隐私门槛。
2. 新账号额度：先核实官方授权/只读额度接口和可验证的凭据存储方式，再确定适配器。`src/quota/service.js`、`rpc.js` 和 `contract.js` 当前只支持 Codex 官方 CLI，不能向其他服务复用 Codex 凭据或读取其他客户端 auth 文件。账号身份/额度窗口/未知值、错误冷却、取消、退出、重启缓存与关键凭据恢复必须各自明确。
3. 入口和验收：继续只有 `src/quota/main.js`，扩展 UI 名称与图标不能替代真实适配器。必要凭据、敏感上传、付费服务和生产部署仍需具体授权。当前不提前启用新来源、后台账号请求、云或手机版功能。

## 验证记录

源码 verify、native、stress、合成 crypto、runtime audit、usage / quota / functional / motion UI 已运行通过；新增连续性与慢批次单元测试，verify 共 84 项。当前 40 个可达产品模块。新增 `scripts/m1/continuity-ui-test.js` 在 100% /150% 下验证真实 IPC 的额度变化、多个原生 clip-path 时间采样、当前呈现值重定向、每分钟调度、Chart.js 实际段样式、未记录提示、五 Agent 的按钮及键盘选择、logo 加载、深色/800×600 和减少动态。

失败证据保留：合成样本 output 使用小数被整数白名单拒绝，改为真实字段允许的整数；测试选择 OpenCode 时与页面另一按钮同名，改为作用域内定位；原先在 820ms 结束后倒放原生动画无法重定向，改在尚未结束的 800ms 内采样。Chart.js 对跳过点仍逐相邻索引解析 segment 样式，真实样式检查发现未出现连接线后，改为同时检查相邻点的 null 和缺口前缀，而非仅索引距离。最终截图等待曲线揭示完成，避免把进入动效的中途帧误当最终图形。

最终交付为 `dist/continuity-20261005/win-unpacked/Agent Usage Quota.exe`，未签名，版本号仍为 0.1.0。95 个源码/资源输入与最终 ASAR 逐字节一致，Windows 目录为 84 个文件。最终打包版通过 continuity、functional、usage、quota 验收；独立 ZIP 解压目录通过 continuity、usage、quota 验收，均覆盖 100% /150%。各份 UI 验收均使用独立 usage/quota 目录和合成 home。

性能曾在并行 UI 验收期间出现一次 273.9ms，超过原 200ms 门槛，失败日志保留。最终版串行复测使用 20,000 条记录、100 个模型、200 天，100% /150% 最高同步处理为 119.3ms /129.7ms、最高 RAF 间隔 123.4ms /136.7ms，门槛、图表复用、仅状态更新、同序列重定价和累计账本检查全部通过。不把单次通过当作稳定 60FPS 或所有运行负载保证。

实际 Chromium screencast：额度更新 85 帧 /0.837 秒，趋势进入 87 帧 /1.022 秒，分别编码为 22/23 帧 GIF，时长按 GIF 10ms 精度量化。播放预览及原始帧在 `artifacts/m2-motion/delivery/`，未重绘或生成图形；未把截图、录屏、测试运行数据加入源码 ZIP。最终复查还修复了缺日时邻近记录的高亮圆点以及点击日期错位，缺日浮层只说明未记录，不显示邻近记录金额。

源码 ZIP 通过 CRC、白名单和当前文件逐字节比对；解压源码 verify 和 pricing:check 复用工作区依赖验证。当前及历史源码 ZIP / Windows 树哈希由 `artifacts/m2-motion/delivery-integrity.json` 记录，历史五代均与各自 manifest 一致。交付哈希见本代 `AgentUsage-CodexQuota-delivery.json` 与 `SHA256SUMS.txt`。运行时共享仅处理逐路径同字节文件，不覆盖各代独立 ASAR。

真实数据、实际账号一分钟请求节律、长时间运行/休眠、物理显示器动画手感与新机器/SmartScreen 未人工验收。本轮账号交互全部使用隔离合成适配器，未发起真实登录或额度请求。
