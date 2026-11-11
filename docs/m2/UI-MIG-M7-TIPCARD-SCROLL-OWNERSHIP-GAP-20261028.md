# M7 提示卡滚动归属缺口 · 2026-10-28

**状态：已随UI-MIG-M7-TREND-CORRECTION-20261028.md第7节获得明确批准，开始实施。** 此项不撤销已批准的TipCard接入，也不申请新的外观或动效。

## 1. 已批准范围的进度

已按`UI-MIG-M7-TIPCARD-INTEGRATION-GAP-20261028.md`第3、5节接入所有者a7cb1e3的TipCard与两条导出，默认共享卡片外壳、内部plot定位、默认LineChart trend通道及对应gallery回归均有未提交实现。费用参考路径未改。隔离probe通过，真实gallery的多行、刷新不换节点/焦点/位置、不重播、key移除、图边/窗口边避让与三模式检查已走到最终跨图归属步骤。

尚未通过完整gallery；foundation/verify/runtime尚未随本补充执行，M7页面和最终门槛未完成，不能交付为通过。

测试本身的一个已有问题也被定位：gallery的观察器计数包装漏传constructor的options，导致`.25`阈值变为默认0。已在同一获准脚本中保留原options，未降低断言或改变产品图表阈值。历次失败保留在`artifacts/ui-mig/M7/tipcard-gates*`，完整几何记录在`tipcard-full-debug.log`。

## 2. 当前源码与实际用量页证据

`design/desktop-reference/motion.js:134`的旧cleanup会遍历整个document的`[data-chart-tooltip]`，调用hideTooltip直接设置hidden。它在窗口scroll、resize、页面隐藏时执行。React共用提示层同样有此标记，位于`[data-ui-portal]`中；其所有权、焦点和内容仍由React保存。键盘聚焦点仍保留时滚动，默认共享层会正确重新定位，但随后旧cleanup把同一个节点藏起来；React状态没有对应变化，卡片一直隐藏。

没有通过新增参考模式、强制反复移除hidden或屏蔽滚动事件来规避此冲突。

实际页面合成复现：`node .cache/m7-tipcard-scroll-owner.cjs`，exit1，3.365秒，日志非空且输出实测结果；无页面/控制台错误。

| 字段 | 滚动前 | 向上滚动20px后 |
|---|---|---|
| 提示节点 | 可见 | 同一节点 |
| hidden | false | true |
| 焦点 | 中间趋势点 | 同一趋势点 |
| 文本 | 2026-09-27 | 2026-09-27 |
| 可见几何 | 92.422×32 | 0×0 |

原图：`artifacts/ui-mig/M7/tipcard-scroll-owner/before-scroll.png`与`after-scroll.png`，同一次真实用量页、同合成数据、1180×850、浅色、motion off。它们仅用于说明滚动故障；完整旧版TipCard内容仍待页面接入，不是最终视觉交付。`results.json`保留节点、焦点和几何结果；`artifacts/ui-mig/M7/tipcard-scroll-owner.log`保留原失败。

## 3. 申请的最小补充

1. 把`design/desktop-reference/motion.js`加入本次文件范围：**仅在cleanup的提示遍历中跳过位于`[data-ui-portal]`内的节点**，由React共享层自行处理滚动/焦点/关闭。旧DOM提示及当前费用参考路径继续执行原逻辑，不改全局scroll/resize/visibility监听，不改spring、时长、样式或业务状态。
2. 在已批准的`scripts/m1/ui-mkb-gallery-ui-test.js`补直接调用旧cleanup以及真实滚动的归属断言，覆盖焦点提示可见、同节点/同焦点、指针提示正常关闭、跨图一次一张、三模式与浅深色。保留当前失败断言，并复跑实际用量页同一合成复现。
3. 更新相关记录后继续完整M7，执行原定组件与页面套件、五页两尺寸像素门槛、用量前后图和差异清单。费用与其它五页的产品源码不改。

不新增kit公共接口、token、色值、字号、尺寸或motion参数，不改vendor、guard、后端、preload、IPC或真实来源。`motion.js`补丁尚未应用，其余未提交工作完整保留；旧M6和Claude工作区未改。

## 4. 停止依据

计划§0.3.4明确：“必须动范围外的文件时，停下来说明原因。”§0.4列出“需要改范围外的文件”；§9.4要求停止全部工作并提问。此前批准的TipCard第3节清单没有`motion.js`，而计划将全局motion列在M9，因此不能把上一次批准解释为本文件授权。

署名：Codex
