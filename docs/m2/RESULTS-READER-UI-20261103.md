# 第 8 节步骤 2：限时源码界面验收 · 2026-11-03

状态：**枚举 58 项，42 项有通过证据，16 项未运行；不宣称全量通过。** 其中 28 项在修复后的第二轮实际通过，13 项保留未受复制修复影响的首轮通过，费用综合项另行针对性复验通过。首轮失败和复验分开保留。

产品基础为 `24bd298`；本步增加复制写后核对，所以下面的首轮保留项不是对整个新产品的同字节复跑。对应 React bundle、样式和被测行为未变；阅读/会话复制走新实现已实际复验。打包验收将对实际候选再跑第 8 节指定的五项，不以源码通过代替包版证据。

## 预算与覆盖

首轮约 5.14 分钟，在三项失败后由本代理暂停派发排查；第二轮约 12.69 分钟，保留费用失败复验余量后收尾。费用项新日志创建至最后写入约 0.31 分钟（未单独捕获进程精确起止，作为近似）；界面执行合计约 **18.15 分钟**。排查、代码修复、headless verify 与后续内存/打包单列，不冒称整个任务只花 20 分钟。原始 STOP 机制通用名称含 owner-stop，但本轮实际是代理为修复/预算收尾，并非所有者要求终止。

交接优先的 `quota-v4`、`visual`、`style-alignment`、`quota-identity`、`desktop-performance`、`motion` 全部首轮通过；`desktop-performance-test.js` 虽不匹配 `*-ui-test.js`，仍显式纳入枚举。高刷、Today 五秒稳定性、layout、概览、外框、挂件、费用相关、保存用量、采集恢复和 Worker 生命周期等结果见完整 JSON，不用抽样通过代替遗漏项。

- 原始首轮：`artifacts/reader-performance-20261102/source-final/results.json`。
- 修复后轮：`source-recheck/results.json`；七种解析的阅读专项在 100%/150% 通过，综合阅读与会话页也通过。
- 费用针对性复验：`source-cost-recheck/repeat-results.json` 与 `headless/source-cost-recheck.log`。
- 汇总：`source-ui-summary.json`，保留 initialFailures、secondRoundFailures 和 selected 的不同状态。`source-inputs-during-recheck.json` 为第二轮过程中收集的源码输入身份，不伪称第一轮已记录这份新实现。

## 失败、修复与实际证据

1. **复制**：首轮综合阅读等待原生剪贴板超时，会话页读到空恢复命令。最小 Electron 原生往返也曾失败，Windows 只读 OpenClipboard 检查通过；后来原生往返恢复，43.4.0、Chromium 150 均未变化。瞬时争用是推断，具体系统原因未确定，没有改系统、关闭其他进程或升级 Electron。
   本步为用户点击触发的三类复制加入有界写后核对：最多 3 次、间隔 50 ms；失败抛固定错误，界面不再返回假成功。不返回、记录或持久化剪贴板内容。单元测试覆盖静默失败后恢复、抛错、持续静默失败和重试边界。综合阅读与会话页的复验实际读原生剪贴板，通过代码、消息、回复、轮次和恢复命令断言。专项原有桌面动作 double 同步补了 readText，仍单独标为 double，不能冒充 OS 验收。
2. **异步阅读测试**：切换邻居后 host 的 agent 已变，但临时 Worker 的新正文尚未挂载，旧测试提前数过程按钮，未打开折叠正文。现在等待新轮次挂载后再操作，保留晚到内容不得串入另一个会话的断言。没有弱化内容检查或为测试取消 Worker。
3. **费用键盘测试**：新的 Breakdown 只在 `:focus-visible` 时响应焦点。旧脚本在鼠标打开 sheet 后直接 `.focus()`，无法满足当前交互契约。改为实际 Tab 到目标行，断言行可由键盘到达，保留缓存读取和部分未报告的提示内容要求；没有改费用设计。
4. 综合阅读脚本新增 `SESSION_READER_EVIDENCE_DIR`，避免源码/包版互相覆盖旧截图。原失败保留在各自独立目录。

`npm run verify` 为 fail 0，`npm run audit:runtime` 通过；不是用移除断言或模拟渲染结果换取预算。内存五场景记录属于前一步的 `24bd298`，本步复制 helper 是额外变更，最新候选的内存另行实测。

## 未运行

`agent-ui-test.js`、`quota-ui-test.js`、`polish-ui-test.js`、`agent-setup-ui-test.js`、`config-health-ui-test.js`、`cost-rebuild-ui-test.js`、`interaction-reliability-ui-test.js`、`provider-login-ui-test.js`、`custom-sources-ui-test.js`、`provider-client-ui-test.js`、`provider-quota-ui-test.js`、`usage-ui-test.js`、`activity-ui-test.js`、`ui-mkb-gallery-ui-test.js`、`ui-kit-gallery-ui-test.js`、`functional-ui-test.js`

未调用这些项的旧候选记录补齐本轮，也未开始真实样本、账户或登录验收。只用隔离合成 home/usage/quota，不推送，不发布。像素对照随后由所有者取消，另有步骤 3 记录；不能把取消写成通过。
