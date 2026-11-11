# 11 月 2 日交接：同日期像素与阅读页对照

对应交接第 4 步。前图为保留的 M13 实际 Windows 包，后图为本轮产品 `c5ef0f2` 的源码；只用合成数据。当前视觉结果待所有者手动转交 Claude，**没有收到人工审阅结论**。

## 对照版本和运行状态

- 基线包：`dist/20261102-M13-handoff/win-unpacked`，ASAR SHA-256 `7daaa870fb7ce64045479b5bd6d826050c34be63130b33dc4b687aae0cd4de61`；产品前端 `f0cf216`，源码收尾 `362c794`。从 ASAR 实际提取的 bundle 哈希 `87f923944a84cbbcc57f11311802e5dbc62a2498be5d1e4be3d478ab495f3f20` 与 Git 对应字节一致，未修改旧包。
- 当前 bundle SHA-256 `fc7a155069e1389a53fac3433159d6e75a8ebfb2fdb26df24bf108b954faf464`，与 `git show c5ef0f2:design/desktop-reference/ui/agent-ui.js` 一致。
- 两侧 renderer Date 和 fixture mtime 同为 `2026-11-02T03:00Z`，统计业务时钟都在 11 月 2 日；保留原生 Worker、performance 和 rAF。没有上一轮跨日导致旧样本落出“今天”的比较问题。
- 完整截图使用共同的 1480×960 视口及实际加高全页；专用像素使用交接指定的 1180×850、sRGB、动效关闭。前者是控制为同一尺寸的对照，不冒充旧包的默认窗口；真实默认窗口内存另测。

带 executable 的 capture manifest 中，checkout HEAD 是运行工具的工作树版本；**旧产品版本以实际 ASAR/bundle 字节证明为准**，不能用该 HEAD 误判旧包。详见 `artifacts/handoff-20261102/pixel-byte-proof.json`、`pixel-baseline-version.json` 和 `review-provenance.json`。

## 已交付画面

| 范围 | 证据 | 结论 |
|---|---|---|
| 六页，两主题，正常窗口/完整长图 | `screenshots/{before,after}` | 双方各 24 张，共 48 张；无页面异常、全页实际装入扩展视口 |
| 窗口会话组件、完整组件概览、实际点击后的阅读器、全文搜索 | `features-{before,after}` | 双方各 8 张；真实组件入口及 7 家合成搜索结果有断言 |
| 核心六页、摘要及居中悬停场景 | `pixels/{before,after,compare}` | 40 对无缺图；28 对在原 0.002 预算内，12 对超预算，原报告如实保留 |
| 设置、来源及来源摘要保护图 | 同上 | 10 对全部通过原阈值，无豁免 |
| 改动/用量、子 Agent、阅读右栏、保留问题 | `reader-existing-after-fix` | 复用刚通过的综合阅读测试原始图，保持实际系统 DPI/主题及当时 toast；没有同状态旧图，不伪造前后比较 |

超预算项集中在会话布局/摘要、费用全页、用量全页和星期小时悬停。它们对应本轮已改变的页面和布局，交人工前后审阅；低于阈值的已改页面同样不视为设计批准。没有裁图、涂改数据或放宽阈值。像素图的洋红块是已有动态时钟文本掩膜，完整截图无该掩膜。

打开 `artifacts/handoff-20261102/review/index.html` 可切换页面、主题、正常窗口/长图及单看当前。新增专项画面单独标明，版本与截图来源不混用。工具增加可选 `--clock`（原默认时间不变），以及 hover/focus/居中滚动场景；hover 状态在截取前保留。改动仅限捕获工具，没有修改产品外观。

工具 ESLint 通过；捕获命令和非零像素比较日志均在 `headless/{full,features,pixels}-*.log`。原有 1180×850 默认像素配置保持。所有者手动转交审阅包，不自动发送消息、上传、推送或宣称 Claude 批准；后续内存和打包结果另列。
