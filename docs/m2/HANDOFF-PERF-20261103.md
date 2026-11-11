# 端到端性能优化的移交 · 2026-11-03

状态：**采集吞吐没有达标——按真实有效负载重测是冷启动 1.17×、增量 1.26×，不是 2×，详见第三节与第八节。** 五项工作负载的内存峰值在源码与打包（125%）两种口径下都低于 500 MiB，打包候选 `c` 的余量是 32.9 / 26.2 / 21.1 / 102.4 / 106.0 MiB——同一夹具在不同轮次之间会摆十几到二十几 MiB，所以这是达标但不是宽裕；交互与帧基本达标，例外已单列。本轮只有合成数据，没有真实记录、账号或认证文件验证，没有推送、PR、标签、Release 或上传。

**2026-11-03 夜间的这次修订针对独立审查的四条意见。** 上一版本文件里「采集 2.37×／20.3× 达标」的依据无效：当时的夹具没有时间戳，`normalize()` 把每一行都丢掉，量到的是遍历与过滤，不是采集。本版本把这一节换成真实有效负载的数字，并补上分阶段归因；其余三条（Worker 超时恢复、交互探针、焦点断言）也已修复并单列。

审查人请按第七节的复现命令重跑；本文件所有数字都来自这台机器上的同一份夹具，没有一条来自真实记录。

## 一、工作树、分支与提交

- 工作树：`<worktrees>\perf-20261103`
- 分支：`claude/perf-20261103`，起点 `25574d5`（= 本地 main，已含 Codex 的 `05615a7`）
- 工作区干净；`node_modules` 已由目录联接换成真实目录（728 MB / 47327 文件，`candidate:build` 的前置检查不允许联接）
- 十四个提交，按顺序：

| 提交 | 内容 |
|---|---|
| `4f8438a` | `perf(collect)`: 一轮采集只走一次目录遍历，每目录解析一次 realpath |
| `47a805f` | `test(perf)`: 15 个采集与阅读成本归因探针 |
| `45569c3` | `perf(reader)`: 复用一个解析 Worker，不再每请求新建 |
| `fedd501` | `perf(reader)`: Worker 复用按「一个会话 + 96 MiB 堆」设界（后改为 32 MiB，见 `fa5fec5`） |
| `a51cad6` | `fix(reader)`: 上方正文还在落位时，跳转不再被拉走 |
| `0192e38` | `perf(reader)`: 轮次 props 稳定化，窗口框逐个接入 |
| `13e50e6` | `perf(cost)`: 溢出测量每帧一次，不再每次变更一次 |
| `fa5fec5` | `perf(reader)`: 32 MiB 堆预算 + 扫描前后都不复用 |
| `9a963ae` | `test(perf)`: 在页面内部测量切页与费用页进入 |
| `7b379df` | `perf(cost)`: 首屏以下的块延后一帧挂载 |
| `345f8ab` | `fix(reader)`: 跳转要等上方正文停止改变高度才算到位（见第九节第 5 条） |
| `e0a2a02` | `fix(reader)`: 超时后先把 parser 退役，再推进队列 |
| `f7963b8` | `test(perf)`: 用真实有效记录做端到端采集基准，并把它拆到阶段 |
| `7752d96` | `test(perf)`: 真实输入必须得到真实回答；焦点必须真的到达 |

**审查请注意 `345f8ab` 晚于候选 `perf-20261103b`。** 本文件的第四节「打包模式」原表已按新候选 `perf-20261103c`（含该修复）重测，`perf-20261103b` 的数字只作为对照保留。

**`e0a2a02`、`f7963b8`、`7752d96` 三个提交都晚于候选 `perf-20261103c`。** 其中 `e0a2a02` 动了产品代码（`src/m1/transcript-tasks.js` 的超时退役），所以候选 `c` 的 ASAR 里**不含**这个修复；另外两个只改脚本与测试。**候选 `c` 的内存、帧、长任务、切页数字仍然有效**（这些路径没有变），但若要验收打包后的超时恢复行为，需要重新出一个候选——本轮按所有者决定没有再打包。

**没有整合 `2420996`（我 11-02 的分支）。** 它的四项改动（十个组件 memo、`ctx` 稳定化、`scrollTo` 落地后停、observer/strip 拆解）已经在 `0192e38` 里以适配 Codex 窗口化的形式重做了一遍：`TurnView` 等十个组件现在都是 `memo`、`ctx` 是 `useMemo` 且八个回调走 `useCallback`（用 `latest` ref 读实时值避免旧闭包），`scrollTo` 是 `useCallback([], ...)` 且落地后锚定偏移只做像素级修正。所以 `2420996` 不需要再合并，按所有者先前的指示保持挂着。

## 二、改了什么，以及每一项的因果依据

### 采集（`src/m1/policy.js`、`sources.js`、`worker.js`）

| 改动 | 依据 |
|---|---|
| `filesUnder` 由每文件一次 `fs.realpathSync` 改成每目录一次 | 1000 文件实测：每文件 realpath 79.4 ms，每目录 0.1 ms；纯 `readdirSync` 递归只要 3.9 ms |
| 新增导出 `survey(roots, audit)`，`sourceStamp`/`refreshCache`/`scanSources` 接受 `prepared` | 原来一轮 refresh 里这三步各调一次 `listFiles`，同一目录被遍历三遍 |

目录级判定与原文件级判定等价：walk 已用 `entry.isSymbolicLink()` 跳过链接，普通文件不可能解析到别处；目录被映射时整目录拒绝，比逐文件判定更严。`tests/m1/source-scope.test.js` 的六项（含「a moved Agent home is read through a linked parent; links at or below the root are not」「a link inside a root is skipped」）全过。

### 会话解析（`src/m1/transcript-tasks.js`、`transcript-task-worker.js`）

| 改动 | 依据 |
|---|---|
| Worker 从「一次一请求即关」改为消息循环常驻 | 每请求新建 + `terminate()` 固定加约 45–50 ms（direct 55 → worker 106.2 ms） |
| 复用按三处设界：换会话、扫描前后、堆预算 | 无界复用让三栏常驻从 434 涨到 534 MiB（全在 Browser 主进程） |
| 堆预算最终取 32 MiB，扫描的请求前后都不复用 | 五档对照见第四节 |

### 阅读页（`ui/src/pages/sessions/reader.tsx`）

| 改动 | 依据 |
|---|---|
| 十个呈现组件 `memo`，`ctx` 与八个回调 `useCallback`，`onOpenTurn`/`onPickMark` 稳定 | 原来 `ctx` 每渲染新建 8 个函数，任何一次滚动 setState 都会重渲染全部已挂载轮 |
| `marks`/`outlineItems` 改 `useMemo` | 原来每渲染 `shownTurns.map` 生成 300 项新数组 |
| 哨兵 observer 只依赖 `[transcript]`，用 `total.current` 取上限 | 原来依赖 `[transcript, shown, shownTurns]`，每 +30 轮就 disconnect 重建 |
| 目录 observer 拆成「建 observer + 增量 observe」，用 `data-watched` 标记 | 原来每次 shown 变化都 `querySelectorAll` 全量重新 observe |
| strip effect 缓存 `question`/`edge`/`measured` | 原来每帧 `querySelector` + 两次 `getBoundingClientRect` |
| `scrollTo` 落地后锚定偏移、只做像素修正，`quiet > 24` 帧结束 | 见下面的「跳转为什么这么写」 |
| 到位判据从「视口内偏移稳定」改成「内容的绝对位置稳定 + 已到标线」，并加 `blocked` | `345f8ab`：旧判据会在被推走之后才满足，锚定在错误位置；见下面 |

**跳转为什么这么写**（`a51cad6` 打底、`345f8ab` 定稿，别再退回旧写法）：点目录第 45 轮时，第一帧目标已对齐，随后上方未绘制轮次的估算高度 560px 被真实 268px 替换，`scrollHeight` 从 43688 塌缩到 41060，把目标向上拖走 560px。三条失败路线：①「`offset` 与 `scrollHeight` 都稳定 6 帧」——`scrollTop` 在填充期每帧抖 1px，组合键永不重复；②「锚定 offset 后只按 drift 修正」——`scrollIntoView` 每帧重跑，把目标重新贴到无 `SCROLL_MARGIN` 的边缘，与修正打架（-852）；③「只按 offset 收敛但不加 anchor」——到达后仍每帧 `scrollIntoView`（-560）。

**光靠 `a51cad6` 还不够。** 它的判据是「视口内偏移 `offset` 连续 5 帧不动」，而目标被推走之后**恰好就在新位置静止**，于是 `still >= 5` 在错误位置满足、`anchor` 记成 -562，此后再也不修正。`reader-window-ui-test.js` 连跑 6 次能复现 2 次（`top -566` / `top -852`）。`345f8ab` 改成：

```js
const contentTop = root.scrollTop + (box.top - frame.top);
if (Math.abs(contentTop - goal.seen) <= 1) goal.still++; else { goal.still = 0; goal.seen = contentTop; }
// 锚定：已到标线（|offset| <= SCROLL_MARGIN + 24）且内容绝对位置稳了，或纸不够滚不动
else if (real && (goal.blocked || (goal.still >= 5 && Math.abs(offset) <= SCROLL_MARGIN + 24))) { goal.anchor = offset; ... }
```

`blocked` 是新增的：调 `scrollIntoView` 前后比较 `root.scrollTop`，`|after - before| <= 1` 说明「纸不够，滚不动」（最后一轮），直接视为到位，否则空转满 4 s。**可行解仍是：`anchor === null` 时才允许 `scrollIntoView`/单次 glide；锚定后只做 `root.scrollTop += drift`。** 修复后源码连跑 6 次、打包连跑 3 次，24 项全过且 `mid top` 落在 0–1。

### 费用页（`ui/src/pages/cost/index.tsx`、`ui/src/kit/surfaces.tsx`）

| 改动 | 依据 |
|---|---|
| `ScrollArea` 的溢出检查用 rAF 合并 | 原来每个子节点变动都同步读 `scrollHeight`/`clientHeight`，profile 里 `check` 占 122–136 ms，改后 63–64 ms |
| 首屏以下的块（Trend、duo、表格、Checks、提示、边缘触发、日期 Sheet）延后一帧挂载 | 整页一次性挂载的原生布局占入口成本的大头；`costHost.get()` 的重算是亚毫秒级，不是 JS 计算的问题 |

延后一帧的写法（`7b379df`）：`active` 为真时 `requestAnimationFrame(() => setBelow(true))`；`locate(target)` 若查不到目标且 `below` 还没置真，就 `setWaiting(target)`，等 `below` 落地那帧再滚一次。**这里没有任何一块被丢弃、缩水或永久跳过——同样的区块，晚一帧。**

## 三、采集：全量与增量

### 这一节在 11-03 夜间被推翻过一次

上一版本写的「冷启动 2.37×、增量 20.3×」来自 `scripts/m1/collection-benchmark.js`，它的夹具没有写 `timestamp`，Claude 行也没有 `message.id`。`src/m1/normalize.js:39` 的 `if (!time || total === null || !Number.isSafeInteger(total)) return null;` 把每一行都丢掉，所以那五次 `full` 全部是 `records: 0`，五次「增量」全部是 `changed: false`。**那些数字描述的是遍历、读取与过滤，不包含入账、聚合与持久化。** 独立审查（`artifacts/codex-review-20261103/review.json`）先发现了这一点并用自己的临时夹具量到 1.36×；本节的数字是我修正夹具后自测的。

### 修正后的夹具与口径

- `scripts/m1/collection-benchmark-fixture.js` 现在每行都带 `timestamp`（`START = Date.UTC(2026,10,2,3,0,0)` + `file*60000 + turn*1000`），Claude 行带 `sessionId`、`cwd`、`message.id = 'msg-<file>-<turn>'` 与 `message.usage`，Codex 行带 `session_meta.cwd` 与 `event_msg.token_count`（`info.model='gpt-5-codex'`）。2000 文件的 home 现在解析出 **40000 条记录 / 4800000 Token**（此前是 0）。
- `scripts/m1/refresh-benchmark.js` 测产品路径本身：`Service.refresh()` 一轮，含解析、去重合并、写 `statistics.json`、`tokscale` 原生校验与返回快照。三类负载各五次：`full`（全新目录）、`incremental`（同目录先热身一次，再给一个文件追加一条 `token_count`）、`unchanged`（热身后不动文件再刷一次）。每个样本记 `records` / `totalTokens` / `lastCollection` / 记录散列 / ledger 散列；**`records === 0` 会被判 `valid: false` 并 exit 1**，直接堵住上一版本那种「测了却什么都没采到」的假通过。
- 基线来自 detached 工作树 `perf-baseline-25574d5`（`git worktree add ... 25574d5 --detach`），同一份脚本。

### 真实数字（2000 文件 / 40000 条记录 / 各五次）

| 负载 | 基线中位 | 当前中位 | 倍率 |
|---|---:|---:|---:|
| **冷启动全量 `full`** | **2820.5 ms** | **2402.0 ms** | **1.17×** |
| **典型增量 `incremental`** | **1916.6 ms** | **1524.7 ms** | **1.26×** |
| 无变化刷新 `unchanged` | 1.1 ms | 1.0 ms | — |

- 两棵树都 `records 40000 / totalTokens 4800000 / valid true`。
- **两类负载都没有达到 2×。** 独立审查用自己的临时夹具量到 1.36×（`beforeMedianMs 3099.5755` / `afterMedianMs 2287.207` / `speedup 1.3552`），与我这组是同一量级。
- `unchanged` 的 1 ms 来自 `src/m1/worker.js` 的 `quiet` 快路径（`!dirty && synced && Date.now()-checkedAt < FULL_CHECK_MS` 时直接 `unchanged(previousStamp,'quiet')`），不是「刷新变快了」——上一版本 22.7 ms 是直接调 `refreshCache` 的另一口径，两者不可比。

### 分阶段归因（同夹具，中位数）

冷启动一轮（`scripts/m1/refresh-full-stages.js`，每轮新 `ParseCache`）：

| 阶段 | 中位 |
|---|---:|
| `survey`（一次遍历） | 35.9 ms |
| `sourceStamp` | 1.6 |
| **`refreshCache`（解析全部文件）** | **827.4** |
| `scanSources`（合并 + clone） | 118.9 |
| **`verifyProjection`（tokscale 子进程）** | **473.3**（写 jsonl 42.1 / 子进程 427.5） |
| worker 侧合计 | 1475.2 |
| 主线程 `clone` / `digest` / `persist` / `projection` | 20.2 / 81.0 / 70.9 / 268.4 |
| 跨线程传输（`structuredClone(scan)`，21.4 MiB） | 93–118 |

增量一轮（`refresh-incremental-stages.js` + `refresh-incremental-attribution.js`）：

| 阶段 | 中位 |
|---|---:|
| `survey` | 29.3 |
| `refreshCache`（热缓存，只 1 个文件变） | **2.8** |
| `scanSources`（全库重新合并 + clone） | 101.9 |
| **`verifyProjection`** | **456.0** |
| 主线程 `clone` / `digest` / `persist` / `projection` | 20.2 / 81.0 / 70.9 / 268.4 |
| 整轮 | 1393.8（`ingest 603.8 / worker 791.7`） |

**为什么增量还是这么贵。** 一次只改一个文件的刷新，仍然：重扫全部 2000 个文件（每个命中缓存的都要 `structuredClone(hit.outcome.records)`，全库 40000 条）、把 21.4 MiB 结果跨线程传回、对全库重写 ledger 做摘要、对 40000 条重算投影、再让 `tokscale` 读 40000 行做一次完整校验。每一环都按全库规模做，而不是按变化量做。

其它已量到的事实：

- `native-cost-probe.js`：`tokscale.exe` 1 条记录 89.6 ms、1000 条 86.6、10000 条 189.6、40000 条 501.4——**固定约 87–90 ms 启动，之后每万条约 100 ms**。
- `refresh-cold-profile.js`（`node:inspector` 冷采集 CPU profile）：自耗时最高的是 `parseFile @ sources.js:200` 9.5%、`digest`(HMAC) 3.4%、`timestamp @ normalize.js:4` 2.9%、**`weight @ parse-cache.js:3` 2.8%**、`structuredClone` 2.6%；`parseObjects` 只有 1.5%。
- `refresh-projection-probe.js`：2000 文件下走了**增量**投影（`incrementalCalls 3 / accepted 3 / fullCalls 0`），但单次仍要 281–308 ms——它按对象引用判断变化（`state.records[record.id] !== record`），然后**仍然遍历全部 40000 条**重算 key 与累加。
- `hmac-probe.js`：手工复用 HMAC inner state（`inner.copy()` + `update` + `digest` + 外 hash）反而更慢（8 万条 209.9 ms vs `createHmac` 142.2 ms，`sameDigest true`）——**这条路被证伪，不要试**。
- `write-statistics.js` 只对 root 的 `records` 走递归，其余键一次 `JSON.stringify`；40000 条各一次 `JSON.stringify(item)`，这是 `digest()` 81–123 ms 与 `persist` 62–71 ms 的实体。

### 能到 2× 但本轮没有做的路

按证据排序，每条都会改变语义或数据流，需要先得到决定：

1. **只把变化的部分送入入账层与校验层**（增量入账 + 增量原生校验）。`worker.js` 已知哪些文件变了、哪些 session 受影响；理论上只需重新校验受影响的记录集，其余沿用上次结论。这是唯一能把增量从 1525 ms 真正压到低位的方向，也是唯一会把「每轮都对全库做一次原生校验」这条保证改掉的方向。
2. **并发 16 路读**（实测 2000 文件从 99.7 ms 降到 51.6 ms，约 1.9×），要把 `policy.readBytes` 的「读前后 `fstat` 校验」改成异步批处理。
3. **去掉 `scanSources` 的全库 `structuredClone`**：`sources.js:230` 的注释说「merging below mutates records, so a cached outcome is cloned for every scan」——只有 `sharedKey` 分支才就地 `Object.assign(owner, snapshot)`，其余路径可以返回不可变记录。这是本轮最安全的一项，尚未做。
4. **`digest()` 换成增量维护的记录签名集合**，避免每轮把整份 ledger 序列化一次。

本轮按所有者的决定**停在这里**：不做这些改动，把真实数字与成本分解写清楚交付复核。

## 四、内存：五个工作负载

口径：全归属进程树（Browser/GPU/Utility/Tab/原生子进程）的 Windows `WorkingSetPrivate` 之和，250 ms 连续采样，另列 `PrivateBytes` 之和（commit）。窗口 1482×962，五项共用 64k 保存用量记录、20k 保存会话、三份各约 24.7 MB / 300 轮长正文；跟随是夹具主动追加。

### 源码模式（编译渲染层，300 Hz / dpr 1.25）

| 场景 | 驻留峰值 | 连续采样峰值 | 最后静置 | 私有提交峰值 |
|---|---:|---:|---:|---:|
| 双栏 + 两次跟随 | **456.3** | 460.4 | — | 746.9 |
| 三栏 + 两次跟随 | **466.3** | 470.2 | — | 785.2 |
| 三会话对比 | **481.9** | 482.1 | — | 830.4 |
| 两万项全部列表 | **392.6** | 393.0 | — | 639.7 |
| 文件历史第一批扫描 | **497.2** | 497.5 | — | 930.9 |

### 打包模式（候选 `perf-20261103c`，Electron 43.4.0 / Chrome 150 / Node 24.18.1）

| 场景 | 驻留峰值 | 连续采样峰值 | 最后静置 | 私有提交峰值 | 达标 |
|---|---:|---:|---:|---:|---|
| 双栏 + 两次跟随 | **467.1** | 467.5 | 342.1 | 743.6 | 是 |
| 三栏 + 两次跟随 | **473.8** | 474.8 | 369.8 | 765.6 | 是（余 26.2） |
| 三会话对比 | **478.9** | 481.2 | 339.3 | 827.2 | 是（余 21.1） |
| 两万项全部列表 | **397.6** | 397.7 | 280.3 | 643.8 | 是 |
| 文件历史第一批扫描 | **394.0** | 394.2 | 281.5 | 887.4 | 是 |

- **候选 `c` 含 `345f8ab`（跳转修复）。** 上一版 `perf-20261103b`（不含该修复）同一夹具测得 446.3 / 492.0 / 499.4 / 379.4 / 435.9，其中三栏余 8.0、对比余 0.6 属边缘通过；`c` 五项的余量分别是 32.9 / 26.2 / 21.1 / 102.4 / 106.0，**边缘问题在 `c` 上不再出现**。两版之间没有为内存再改代码，差异属轮次抖动与 GPU private 分配波动。
- 全部 `continuousIncomplete: 0`；`continuousMaxGapMs` 874–1058（250 ms 采样器下的采样间隔，无漏采）、`errors: 0`。
- **私有提交峰值 643.8–887.4 MiB 远高于 500**，这是另一个口径，本目标只约束驻留；审查时不要把它说成「内存全部达标」。
- 打包版 scan 在 `b` 上第一次跑出过 `continuousMaximumPrivateWorkingMiB 503.0`（`packaged-scan`），重跑 465.7（`packaged-scan2`）；`c` 上稳定在 394.0/394.2。**GPU 的 private 分配有抖动，报「scan 达标」时必须带上这句话。**
- 与 Codex 那轮（150%、240 Hz，参考峰值 618/671/666/494/690）不可直接比较：**本机现在是 2048×1152 / 300 Hz / DPR 1.25，按所有者当时的决定用 125% 测完并如实标注。**

### 内存做了什么（三档对照，scan 场景）

| 变体 | 驻留峰值 | 达标 |
|---|---:|---|
| 每请求新建 Worker（`25574d5`） | — | 基线三栏 434 |
| 无界复用 | 534 | 否 |
| 96 MiB 预算 | 588.3 | 否 |
| 32 MiB + 扫描前 release | 508.2 | 否 |
| **32 MiB + 扫描前后都 release** | **497.2** | **是** |
| 永不复用（预算 1） | 483.2 | 是（但放弃复用收益） |

Worker 自报堆（24.7 MB / 300 轮）：transcript 82.3、part 62、find 31.2、第二个 transcript 69.2、find 28.1、第三个 66.1、find 53.4、再读第一个 51.8 MiB——**每次解析 30–85 MiB，随访问过的记录累积**，这是无界复用让宿主涨 100 MiB 的机制。宿主 RSS 353.7 → 516.4，`terminate()` 只回收约 64 MiB。

## 五、交互与帧

### 帧（打包版，300 Hz，真实 `page.mouse.wheel` 16 ms 节奏，窗口化生效后只挂 3 轮）

| scope | 中位 | p95 | p99 | 最大 | >16.7 | >33 | scriptMs |
|---|---:|---:|---:|---:|---:|---:|---:|
| warmup | 3.3 | 3.4 | 3.5 | 3.5 | 0 | 0 | 3 |
| scroll-steady | 3.3 | 3.4 | 3.5 | 3.6 | 0 | 0 | 19 |
| scroll-fast | 3.3 | 3.4 | 3.5 | 3.5 | 0 | 0 | 9 |
| **jump-far** | 3.3 | 6.7 | 9.9 | 13.5 | 0 | 0 | 129 |
| scroll-back-up | 3.3 | 3.5 | 3.7 | 6.8 | 0 | 0 | 14 |

目标 P95 ≤ 8.4 ms、P99 ≤ 16.7 ms：**五项都达标**（最差的 jump-far 是 p95 6.7 / p99 9.9）。**候选 `c` 的 jump-far 连 >16.7 ms 的帧都没有了**（候选 `b` 是 2 帧、最大 20.1），这是 `345f8ab` 让跳转在上方正文停稳后再收尾的直接结果。`domNodes 3688 → 3738`（基线是 18236，窗口化前后差一个数量级）。

### 长任务（打包版，`READER_REPLY_REPEAT=3000`）

| 步骤 | 墙钟 | 长任务 | scriptMs | layoutMs |
|---|---:|---|---:|---:|
| open-reader | 411 | **0** | 85 | 50 |
| jump-150 / 299 / 回 150 / 回 0 | 98 / 127 / 958 / 967 | **全 0** | 26 / 36 / 37 / 31 | 7 / 8 / 6 / 4 |
| view-talk / view-all | 233 / 231 | 0 | 22 / 23 | 41 / 35 |
| scroll-up / scroll-down | 1805 / 1704 | 0 | 402 / 170 | 81 / 42 |
| follow-update | 4192 | 0 | 93 | 4 |
| close-reader | 405 | 0 | 55 | 37 |
| **leave-page**（切到用量页） | 627 | **1×104** | 99 | 72 |

- 目标「稳态交互中消除可重复的 >50 ms 长任务 / 长帧，任何 >100 ms 冻结单列未达标」：**阅读页自身现在一个长任务都没有**（候选 `b` 上 open-reader 还有 1×51）；**切页 `leave-page` 仍有 1×104 ms，按规则单列未达标**——它比 `b` 的 147 ms 降了 43 ms，但仍是唯一超线项，且它发生在「关掉阅读页、切到用量页」这一条路径上，不在阅读页内部。
- `scroll-up` 的 scriptMs 402 是 1805 ms 观测窗口的累计脚本时间，不是单帧；单帧最大帧间隔见上一张表（全部 ≤ 3.7 ms p99）。
- scroll-up 的 scriptMs 397 是全程累计（1880 ms 窗口、约 570 帧），不是单帧成本。

### 切页（页面内派发点击 + 页面内计时，20 次切换）

这一节在 11-03 夜间换过口径。原来的探针把三个数字叫 `toView` / `root` / `settle`，但它们分别只是「属性翻转」「节点存在」「第十帧」——没有一项能证明人看到的东西能用。现在的 `scripts/m1/nav-switch-probe.js`（`schemaVersion: NavSwitchProbeV2`）改成：

| 指标 | 它到底测了什么 |
|---|---|
| `viewAttributeMs` | `#main.dataset.currentView` 翻转 |
| `pageRootMs` | 新页面自己的根元素出现在文档里 |
| `contentVisibleMs` | 根元素已布局（`width>0 && height>0`）且内部没有 `[data-windowed-drawn="false"]` 占位——第一个「能读」的帧 |
| `tenthFrameMs` | 第十帧（保留作底层对照，不再自称「稳定」） |
| **`controlResponseMs`** | **页面可见后，真实输入必须得到回答**：页面比窗口高就发真实滚轮并等它真的移动；页面正好装进窗口（没什么可滚）就把真实指针移到它最近的控件上，等它真的 hover。**没有回答的页面会让整轮 `controlUnanswered` 非空、`report.ok=false` 并 exit 1。** |

启动计时也改成从 `electron.launch()` 之前开始，分成 `launchedMs / windowMs / loadMs / readyMs / settledMs`（原来在 `usageData.ready()` 之后才开始计，等于把启动最贵的部分排除在外）。

源码模式实测（`artifacts/perf-20261103/nav-switch/`，exit 0）：

| 指标 | 计数 | 中位 | p95 | 最大 |
|---|---:|---:|---:|---:|
| `controlResponseMs` | 20 | **42 ms** | **86 ms** | 86 ms |
| `tenthFrameMs` | 20 | 113 ms | 390 ms | 390 ms |
| 长任务最大 / 总计 / >50 ms 帧数 | — | — | — | 163 ms / 1735 ms / 20 |

- **20/20 次切换都有真实回答**（`controlAnswered 20`、`controlSkipped 0`、`controlUnanswered: []`）。
- 全部 5 次进入会话页原先都是 `moved:false` 并 5 秒超时——查明是**会话页本身装得进窗口、没有可滚的纸**（页面高度 624 < 视口），探针选错了验收方式，不是产品缺陷；现在用 hover 回答。
- 目标「常用切页与远处定位到可交互内容 P95 ≤ 200 ms」：`controlResponseMs` p95 86 ms 达标。

打包候选 `c` 上的旧口径（19 次切换，页面内派发点击）：`toView` 中位 41 / p95 108 / 最大 108，`settle` p95 332。**这两个数字仍列在这里，但只作为底层对照**：`toView` 不证明可交互，`settle` 是固定的第十帧、不检测布局或动画是否真的停下来。打包版的 V2 口径本轮没有重跑（见第六节「未跑或延后的」）。

**关于候选 `b` 上曾记下的「median 27 / p95 73 / settle 252」：那是单次低方差采样，不能当基线。** 用同一脚本、同一夹具把 `b` 重测两次得到 median 34 / 38、p95 94 / 111、settle p95 327 / 342、长任务最大 94 / 111、>50 ms 帧 16 / 16——**与 `c` 在统计上没有差别**。所以 `c` 相对 `b` 在这一项既没有改善也没有回归，两者的差别只落在帧表的 jump-far 与长任务表的阅读页部分。

逐项（`c` 第一次，19 次切换，页面内派发点击）：start→cost 62 / last 332（3 个长任务，最 85）；二次 start→cost 41 / 275（2×98）；sessions→cost 35 / 263（2×75）；usage→cost 35 / 268（2×78）；start→usage 108 / 236（1×108）；start→settings 63 / 165（2×63）；cost→sessions 45 / 112（0）；cost→usage 67 / 125（1×67）；quota→sessions 27 / 78（0）。**费用页 `toView` 35–62 ms，远低于 200 ms。**

启动到窗口可交互：496 ms（候选 `b` 501 / 505，改动前 491）。

### 费用页为什么还是最重的

- `costHost.get()` 的 `model.view()` 重算是**亚毫秒级**（cold 0–0.5 ms、warm 0 ms），开销不在 JS 计算。
- 页面内 profile（`open-cost` 281 ms）：`(program)` 187 ms / 47.4%、`AgentFilter` 的 ResizeObserver 测量 34 ms / 8.5%、GC 17 ms、`ScrollArea.check` 6 ms。**剩下的是原生 layout/paint。**
- 试过但不采用：给首屏以下加 `content-visibility:auto`（首次省 29 ms、其余持平或更差）；`prefers-reduced-motion`（只省 30–40 ms，且不能靠关动画冒充流畅）。
- 采用的做法是首屏以下延后一帧：到可交互 74–102 → **33–57 ms**（源码模式），打包版 70–135 → **25–43 ms**。到画面稳定基本持平——**这不是把活省掉了，是把活挪后一帧**，如实记录。

## 六、正确性与测试

### 本轮跑的
- `npm run verify` → **642 pass / 0 fail**（lint clean、`typecheck:ui` clean）。642 比上一版本的 640 多两个，是新加的「超时后下一个请求由新 parser 回答」与「关闭时等待正在退役的 parser」。
- `npm run audit:runtime` → **PASS: 152 reachable product modules**。
- `npm run audit:package`（候选 `c`）→ **PASS: 245 source/assets/docs match ASAR byte-for-byte; runtime package metadata matches; unpacked tokscale 4.17.0 matches its pinned SHA-256**。
- `tests/m1/transcript-tasks.test.js` **八个测试全过**（含新增三条：换会话先结束旧 Worker；超预算的 Worker 立刻结束；扫描不复用也不留下；**超时后下一个请求由新 parser 回答**；**关闭时等待正在退役的 parser**）。
- `scripts/m1/transcript-timeout-recovery.js`（新写）：对 `4cc3a60` 的源码重放同一故障，复现「请求 1 超时、请求 2 也 `TRANSCRIPT_UNREADABLE`、`workers 1 / reused 1 / released 0`」；对当前源码 `recovered: true`、`workers 2 / reused 0 / released 1`。
- `scripts/m1/refresh-benchmark.js`（新写，真实采集基准）→ 三类负载各五次、两棵树对照；`records 40000 / totalTokens 4800000 / valid true`。
- 十二个采集归因脚本（`refresh-attribution`、`refresh-parse-attribution`、`refresh-service-attribution`、`refresh-full-stages`、`refresh-incremental-attribution`、`refresh-incremental-stages`、`refresh-transfer-probe`、`refresh-projection-probe`、`refresh-cold-profile`、`native-cost-probe`、`hmac-probe`）→ 见第三节。
- `scripts/m1/nav-switch-probe.js`（重写为 V2）→ **20/20 次切换都有真实回答**，`controlResponseMs` 中位 42 / p95 86 ms，`controlUnanswered: []`，exit 0。
- `scripts/m1/reader-window-ui-test.js`（窗口化专项）→ **checks 25 / failed 0**（焦点那条断言拆成「控件真的拿到焦点」与「滚走之后仍绘制且仍在焦点」两条；并改为从当前屏幕重取轮次，因为旧写法取的是已被后续跳转换掉的视口）。源码模式连跑 6 次全过、打包候选 `c` 连跑 3 次全过（那 3 次是 24 项版本，焦点断言加固后重跑的是源码模式）。
- `scripts/m1/reader-jump-probe.js`（新写，跳转归因）→ 记录 `scrollIntoView` 每次调用与逐帧 `top/scrollTop/scrollHeight/drawn`，用于定位 `345f8ab` 的根因。
- `scripts/m1/reader-find-check.js`（Ctrl+F 链路，16 项）→ **checks 16 / failed 0**。
- 费用相关十个套件全 PASS：`cost-ui-test`、`cost-layout-ui-test`、`cost-rebuild-ui-test`、`cost-smoke-ui-test`、`cost-composition-ui-test`、`cost-compact-ui-test`、`workbench-ui-test`、`interaction-reliability-ui-test`、`style-alignment-ui-test`、`render-performance-ui-test`（改完首屏以下延后一帧之后跑的）。
- `desktop-performance-test.js`（scale 1 与 1.5）：`noErrors: true`、`chartReused: true`、`routeRemountHasOneChart: true`、`statusOnlySkipsChart: true`、`sameSequenceReprices: true`、`correctRangesAndCurves: true`、`realAccountRequests: 0`。
- `session-reader-ui-test.js`、`sessions-reader-extras-ui-test.js`：PASS。

### Ctrl+F 的实际结论（推翻我 11-02 的判断）
11-02 我据「全仓库没有 `findInPage`」判断窗口化会让 Ctrl+F 找不到未挂载轮次。**这个判断是错的**：阅读页把 Ctrl/Cmd+F 接到了自己的 `openFind()`。实测（300 轮、每轮 82KB、命中短语放在 1200 字预览之外）：查找栏 5 ms 出现，输入到 `1 / 1` 846–1394 ms，Enter 到高亮 152–155 ms，**整条链路没有 50 ms 以上长任务**；命中后第 285 轮被真绘制且落在视口内（`markedTop 318` / 视口 651.2），跳转只绘制 3 轮。双栏时只有 1 个查找栏、焦点在第 2 栏。Escape 语义是设计行为：焦点在输入框时第一次只清空查询，第二次才关闭。

### 未跑或延后的
- **打包候选 `c` 没有重跑 V2 口径的切页探针**（`nav-switch-probe.js` 是本轮夜间改写的，只在源码模式跑过 20/20）。第五节切页表里的打包数字是旧口径的底层对照，不是 V2 的 `controlResponseMs`。
- 源码界面套件按约 20 分钟预算只跑受影响的费用/阅读/交互几组，**没有重启 58 套**；`agent-ui`、`quota-ui`、`polish-ui`、`functional-ui` 等未跑。
- 没有跑 `test:native`、`test:stress`、`experiment:crypto`（改动没有触及原生校验、压力夹具或加密路径，但这条是判断不是证据）。
- 没有像素基线（所有者 11-03 决定「像素对照不用拍，后面我自己看」）。
- **没有真实记录、账号或认证文件验证。**
- **没有重新打包**：`e0a2a02` / `f7963b8` / `7752d96` 三个提交都不改产品代码（前两个只改 `transcript-tasks.js` 与测试/脚本，第三个只改探针），但 `e0a2a02` 确实动了 `src/m1/transcript-tasks.js`——**候选 `c` 的 ASAR 早于这个修复**，若要验证超时恢复的打包行为，需要重新出一个候选。

### 初始失败（保留）
- `reader-window-ui-test.js` 第一轮 23 项 2 失败：我断言写错（打开时 `frames` 是 30 不是 90；最后一轮物理上不可能停在顶边），已改成正确断言并另设中段跳转检查。
- 第二轮发现三个真问题：中段跳转偏 260px、跟随没挂上第 90 轮、远跳目标未绘制。前三者都修了（见第二、四节）；**跟随那一项是真缺陷**：`useLayoutEffect` 里 `if (!pinned.current) return;` 先于 `setShown` 返回，导致「不在末尾读的人」永远看不到新到的轮。
- `candidate:build` 第一次失败：`node_modules is a junction or symbolic link`。删联接、robocopy 复制成真实目录后通过。
- 三栏内存有一轮 `follow` 等待 301 轮头文字超时（90 s）；同脚本随后两轮都通过，判为夹具/时序，不是回归。

## 七、原样数据、复现与环境

### 产物目录（都在工作树 `artifacts/perf-20261103/`，未提交）

| 目录 | 内容 |
|---|---|
| `collection/benchmark.json` | 采集四类负载各五次（**旧口径，夹具无效，只作历史**） |
| `refresh/{benchmark,attribution,incremental,incremental-stages,full-stages,service,parse,transfer,projection}.json` | **真实有效负载的采集基准与分阶段归因（当前口径）** |
| `refresh/cold.cpuprofile` | 冷采集的 CPU profile（313 nodes / 1015 samples） |
| `timeout-recovery/results.json` | Worker 超时恢复的前后对照（`4cc3a60` vs 当前） |
| `nav-switch/` | **V2 切页探针（20 次切换，全部有真实回答）** |
| `reader-cost/{read,worker,worker-after,worker-bounded,worker-heap,scale}.json` | 解析与 Worker 成本、堆序列 |
| `find-chain/`、`find-probe/`、`typing/` | Ctrl+F 链路、查找端到端、单键成本 |
| `frames-after/`、`longtask-after/` | 源码模式帧与长任务 |
| `packaged-c-frames/`、`packaged-c-longtask/` | 打包候选 `c` 的帧与长任务（当前口径） |
| `packaged-c-{two,three,compare,list,scan}/` | 打包候选 `c` 的五场景内存（当前口径） |
| `packaged-b-{frames,longtask,two,three,compare,list,scan}/` | 打包候选 `b` 的同一组（对照，不含跳转修复） |
| `packaged-{scan2,two,three,compare,list,nav,nav-switch}/` | 更早一轮打包数字（历史） |
| `memory-{two,three,compare,list,scan}-b32sweep/` | 源码模式五场景内存（最终档） |
| `memory-scan{,-sweep,-cold,-budget32,-b32sweep}/` | scan 的五档对照 |
| `packaged-c-nav-switch{,-2,-3}/`、`packaged-b-nav-switch-recheck-{1,2}/` | 切页口径，含候选 `b`/`c` 各三次的重复性复核 |
| `packaged-cost-switch-defer/`、`nav-switch-defer/` | 费用页切页口径 |
| `cost-locate/`、`cost-{split,motion,defer,entry}-probe/`、`cost-profile-after/` | 费用页定位与反证 |
| `window-list/` | 窗口化专项（25 项，焦点断言加固后） |
| `packaged-c-window/` | 窗口化专项在打包候选 `c` 上连跑三次（24 项，焦点断言加固前） |
| `jump/` | 跳转归因（`scrollIntoView` 调用与逐帧轨迹） |
| `reader-process/`、`reader-channel-probe` 相关 | 主进程增长归因 |

### 复现命令（都在工作树根）

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue   # 否则 electron.exe 退化成纯 Node，Playwright 全部超时

# 采集（当前口径：真实有效记录，走 Service.refresh 全链路）
$env:REFRESH_ROWS="2000"; $env:REFRESH_RUNS="5"; node scripts/m1/refresh-benchmark.js
# 分阶段归因
node scripts/m1/refresh-full-stages.js
node scripts/m1/refresh-incremental-attribution.js
node scripts/m1/refresh-projection-probe.js
node scripts/m1/refresh-cold-profile.js
node scripts/m1/native-cost-probe.js
# 采集（旧口径，夹具记录为 0，只作历史对照）
$env:COLLECT_ROWS="2000"; node scripts/m1/collection-benchmark.js

# Worker 超时恢复的前后对照
node scripts/m1/transcript-timeout-recovery.js

# 内存（源码模式）
$env:PERF_PROFILE="three"; $env:PERF_OUTPUT="artifacts/perf-20261103/memory-three-recheck"; node scripts/m1/multi-reading-memory-check.js

# 内存（打包模式，125%）
$env:QUOTA_PACKAGED_EXE="<worktrees>\perf-20261103\dist\perf-20261103c\win-unpacked\Agent Usage Quota.exe"
$env:PERF_PROFILE="scan"; $env:PERF_OUTPUT="artifacts/perf-20261103/packaged-scan-recheck"; node scripts/m1/multi-reading-memory-check.js

# 帧与长任务
$env:READER_FRAME_OUTPUT="artifacts/perf-20261103/frames-recheck"; node scripts/m1/reader-frame-check.js
$env:READER_REPLY_REPEAT="3000"; $env:READER_LONGTASK_OUTPUT="artifacts/perf-20261103/longtask-recheck"; node scripts/m1/reader-longtask-check.js

# 切页（V2：真实输入必须得到真实回答；没有回答会 exit 1）
$env:NAV_OUTPUT="artifacts/perf-20261103/nav-switch-recheck"; node scripts/m1/nav-switch-probe.js

# 窗口化、跳转归因与查找
$env:WINDOW_OUTPUT="artifacts/perf-20261103/window-recheck"; node scripts/m1/reader-window-ui-test.js
node scripts/m1/reader-jump-probe.js
node scripts/m1/reader-find-check.js
```

### 环境
- Windows，显示器 2048×1152 @300 Hz，DPR 1.25（`AppliedDPI = 144` 的系统也被 Playwright 报为 `scale: 1.25`），GPU：AMD Radeon 2560×1600@240 + NVIDIA RTX 5070 Laptop 2560×1440@300。
- 默认窗口 `1482×962`（名目 1480×960，`workArea 2048×1104`，断言容差 4px）。
- **打包候选 `c`（当前口径）**：`dist\perf-20261103c\win-unpacked\Agent Usage Quota.exe`，ASAR **a666a8a842119f760577cee184a205021bc42ec1de9071ba854ebef518c89dfe**，`app.asar` 46,913,984 字节；`inputKey 53759caf1afcd0a8fc40ddc06725e59528ded5e85af5b9ee276ff5d33636bc25`、`uiSourceHash d580ffb8ca344704cd832d7f56ae5e2883f3a4792e07e7348cfdda0199089b44`；所有打包报告里的 `productByteProof.sha256` 都是这个 ASAR 散列。
- 上一版候选 `b`（不含 `345f8ab`）：ASAR `49b287fc89d7dcc139b28af2761328b6e8a2dca7ebf5fef70a4d199f8069df1f`，46,913,857 字节，exe 225,533,440 字节。更早的 `perf-20261103`：ASAR `848695aa0dde6e8654049ab8b25a414d5800d270c895232a36378c716cc34786`。
- `signing:plan` = `NOT_CONFIGURED`；`signAndEditExecutable: false`。

## 八、没达成的、有风险的、怎么退

### 明确没达成
1. **采集吞吐没达标：冷启动 1.17×、增量 1.26×，目标是两类都 >2×。** 上一版本这两个数字是 2.37× / 20.3×，依据无效（夹具没有时间戳、`records: 0`），已在第三节重写。真正能到 2× 的四条路都在第三节末尾，本轮按所有者决定没有做。
2. **切页 `leave-page` 有一个 104 ms 长任务**（超过 100 ms 冻结线；候选 `b` 上是 147 ms）。它在「离开阅读页切到用量页」这一步，两个动作叠在一起；拆开测过，各自都在 50 ms 以下。没有找到不改变交互语义的拆法。
3. **`settle`（第十帧，不是「稳定」）p95 332 ms**；V2 口径下真正代表「可交互」的 `controlResponseMs` p95 是 86 ms（源码模式 20/20），但**打包版没有重跑 V2**。
4. **私有提交峰值 643.8–887.4 MiB**，远高于 500。这是 commit 口径，不是目标口径，但不能读成「内存全部达标」。
5. **候选 `c` 的五项内存余量是 32.9 / 26.2 / 21.1 / 102.4 / 106.0 MiB，都不算宽裕。** 候选 `b` 上三栏与对比曾分别只余 8.0 与 0.6，而 `b` 与 `c` 之间没有为内存改过代码——**同一夹具在不同轮次之间会摆十几到二十几 MiB，重复测量仍可能跨线**；打包 scan 在 `b` 上还出现过一次连续峰值 503.0，独立审查在三栏上也复测到 497.9。
6. **内存只在 125% 环境有证据**，没有覆盖原生 150%。所有者 11-03 决定「就用现在的 125% 测完五场景，如实标注环境不同」。
7. **语义等价只做了落盘逐字节比对**这一层，没有 40000 条记录的逐字段新旧比对。

### 兼容与回退
- 每个提交都能单独 `git revert`：采集（`4f8438a`）、Worker 复用（`45569c3`/`fedd501`/`fa5fec5`）、Worker 超时（`e0a2a02`）、跳转（`a51cad6`/`345f8ab`）、渲染（`0192e38`）、费用页（`13e50e6`/`7b379df`）。回退 `0192e38` 会让滚动脚本时间回到约 3 倍，回退 `fa5fec5` 会让 scan 回到 588 MiB，**回退 `345f8ab` 会让中段跳转重新变成间歇性塌缩（约三次里失败一次）**，**回退 `e0a2a02` 会让一次超时连带下一个请求一起失败**。
- `e0a2a02` 的行为边界：Worker 自己回传的业务错误（`TRANSCRIPT_CHANGED`、记录不可读）**仍然保留**这个 Worker，因为那是有效答案而不是坏进程；只有超时、`error` 事件、提前退出、`postMessage` 抛错、取消才退役。改动前后 `released` 语义变了，`metrics()` 多了 `ending`。
- **窗口化的已知代价**：未绘制轮次的正文不在 DOM，浏览器原生查找找不到它——但应用自己接了 Ctrl/Cmd+F，实测能跨未绘制轮次查找并精确落地（第六节）。如果将来有人把阅读页的查找改回依赖原生查找，这条会变成真缺陷。
- `WindowedList` 在 `enabled` 为假时（`shownTurns.length <= PAGE_TURNS`，即 30 轮以内）完全退化成普通挂载，短会话没有任何行为变化。
- 费用页延后一帧期间，`locate()` 会先记下目标、等挂载后那一帧再滚（`cost-locate-probe.js` 四类情形全过）。若有人删掉 `waiting` 那段，`locate` 在延迟窗口内会静默不滚。

### 明确没有做的
- 没有真实数据验证（合成夹具、合成正文、合成保存会话）。
- 没有远程推送、PR、标签、Release 或任何上传。
- 没有合入共享 main。**`claude/perf-20261103` 仍是独立分支，等审查。**

## 九、请审查时重点看的五处

1. **采集：这两类负载只有 1.17× / 1.26×。** 上一版本说达标是量错了；第三节写清了旧夹具为什么量不到记录、新夹具与产品路径基准怎么建、成本落在哪几个阶段，以及能到 2× 的四条路各自会改动什么语义。**这是本轮最重要的未达成项，请先看它。**
2. **`src/m1/transcript-tasks.js` 的退役语义**（`e0a2a02`）：什么时候把 Worker 拿掉、什么时候保留、`ending` 怎么等。四处设界（换会话 / 扫描前后 / 32 MiB 堆 / 超时）是内存与延迟的取舍点，阈值的合理性值得复核。
3. `ui/src/pages/sessions/reader.tsx` 的 `scrollTo` 落地算法——它经过四次失败才定稿，注释写明了为什么不能退回「稳定 N 帧就停」。
4. `ui/src/pages/cost/index.tsx` 的 `below`/`waiting` 两段——它把首屏以下的块挪后一帧，`locate()` 的排队逻辑在 `waiting` 那段。
5. **`345f8ab` 修的是一个间歇性缺陷，值得单独复核。** 现象：点目录跳到中段（第 45 轮）后，目标会先对齐再被推到视口上方约 560 px。机制：上方未绘制轮次的估算高度（560）在被真实绘制时换成真实高度（268），`scrollHeight` 从 43688 塌缩到 41060，把目标整体上移；旧判据「视口内偏移连续 5 帧不动」在**被推走之后**才满足，于是锚定在错误位置、此后再也不修正。`reader-window-ui-test.js` 连跑 6 次能复现 2 次（`top -566`、`top -852`），修复后源码连跑 6 次、打包连跑 3 次全过。**这个缺陷在候选 `b` 与更早的 `a51cad6` 上都在，只是当时单次运行全过没暴露。**

## 十、这一版对独立审查四条意见的处置

| 审查意见 | 处置 | 证据 |
|---|---|---|
| [P1] 采集 benchmark 没有有效记录，2.37×/20.3× 不能作为达标依据 | 夹具已重写（时间戳 / `message.id` / `token_count`），新增产品路径基准 `refresh-benchmark.js`（`records === 0` 直接判无效并 exit 1），**如实报告 1.17× / 1.26×，并声明未达 2×** | 第三节；`artifacts/perf-20261103/refresh/*`；`npm run verify` 642 pass |
| [P1] 解析超时后下一请求被发给正在退出的 Worker | `retire()` 先撤销可复用状态、`await` 终止、`this.ending` 跟踪；`close()` 等全部终止；新增两个测试与一个复现脚本 | `e0a2a02`；`transcript-timeout-recovery.js` before 两项同失败 / after `recovered: true` |
| [P2] 切页探针不能证明「可交互」与「画面稳定」 | 探针重写为 V2，指标改名并新增 `contentVisibleMs` 与 `controlResponseMs`（真实滚轮或真实指针必须得到回答，否则 exit 1）；启动从 `electron.launch()` 前计时 | `7752d96`；源码模式 20/20 有回答、`controlResponseMs` p95 86 ms |
| [P2] 窗口化焦点断言在未获焦时通过 | 拆成两条独立断言（先要求控件真的拿到焦点），并从当前屏幕重取轮次（旧写法取的是已被后续跳转换掉的视口） | `7752d96`；`checks 25 / failed 0`，`focusHold.pick = {index:45,controls:6}` |
| （保留项）`345f8ab` 应保留；内存只是当前环境一次有界通过 | 已保留，并在第八节按「125% 环境、未覆盖 150%」如实标注 | 第五节、第八节 |
