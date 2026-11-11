# 阅读性能与本地交付研究 · 2026-11-03

本轮执行 `HANDOFF-20261102.md` 第 8 节和所有者追加的卡顿、内存、本地构建问题。只用合成记录，不启动真实样本核对、远程发布或证书配置。所有者已选择没有证书时先完成本地流程与可审核的签名更新配置。CodeGraph 与 Browser 插件在本会话不可用，采用定向源码核对、现有 Electron Playwright、Windows 进程树计数器。

## 依据与取舍

研究 CC Switch 固定提交 `a3eafa408ae679db2e3401fca767ed2b89d9a2b2`，区分可复用的思路和与本产品边界不同的行为：

| 依据 | 观察 | 本轮处理 |
|---|---|---|
| [SessionReader.tsx](https://github.com/farion1231/cc-switch/blob/a3eafa408ae679db2e3401fca767ed2b89d9a2b2/src/components/sessions/reader/SessionReader.tsx) | `useVirtualizer`、动态行高、overscan 8 | 长阅读仅挂载附近的轮次正文，保留数字高度占位、焦点、选择、定位目标；短阅读保持完整挂载。采用项目现有观察器和 kit，不新增依赖。 |
| [SessionManagerPage.tsx](https://github.com/farion1231/cc-switch/blob/a3eafa408ae679db2e3401fca767ed2b89d9a2b2/src/components/sessions/SessionManagerPage.tsx)、[sessions.ts](https://github.com/farion1231/cc-switch/blob/a3eafa408ae679db2e3401fca767ed2b89d9a2b2/src/lib/query/sessions.ts) | 列表窗口化、分块读取 | 保留已有列表界面；削减会话列表聚合、复制和 IPC 传输的中间对象，公开接口仍为 SessionListV1。 |
| [cache.rs](https://github.com/farion1231/cc-switch/blob/a3eafa408ae679db2e3401fca767ed2b89d9a2b2/src-tauri/src/session_manager/cache.rs) | 8 项、96 MiB 的解析缓存 | 不引入；所有者未允许增加正文缓存。请求结束后终止临时解析 Worker，不留正文或持久全文索引。 |
| [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance) | 根据 profile 定位阻塞、减少主进程工作 | 解析与统计所有者解耦；一次一个临时解析任务，完成并终止后再回复。统计和原生进程安全边界保留。 |
| [TanStack Virtual API](https://tanstack.com/virtual/latest/docs/api/virtualizer)、[动态聊天讨论](https://github.com/TanStack/virtual/discussions/1204) | 动态高度和锚点需要实测 | 保留远处定位、查找、跟随、真实滚轮中断的测试；不能只看节点数下降。讨论作为线索，不当成本项目根因证据。 |

也检索了社区聊天列表卡顿经验（例如 [React 社区讨论](https://www.reddit.com/r/reactjs/comments/1nh05xb)）。社区建议只用于找排查方向，具体修改由当前源码、等价性测试和本机测量支撑。

## 实现与数据契约

- Codex、Claude JSONL 改为请求内按行迭代，保留大小、普通文件、链接和读取前后文件身份检查；Claude 子 Agent 沿用原插入语义。其他来源解析没有改写。
- 对比只需要元数据；文件历史只需要成功工具的文件增删数。专用投影不保留文本、输出和 diff 正文；保留条目边界、合并上限、用量归属、错误和文件计数。阅读、全文查找、复制和导出继续使用完整解析。
- 会话列表直接累计界面实际使用的字段，避免为每个会话/日先创建全部定价解释 Map 再丢弃。通过既有 aggregate 的所有排列对照检验缺值、冲突、部分数据、区间和零价格。最近列表只为最终选中的会话分配模型、入口和日 Map。
- SessionListBytesV1 是私有传输格式，使用请求内字典和可转移 ArrayBuffer；渲染器还原原白名单 V1。null 与 0、稀疏 knownUsage、已有本地元数据边界保持。没有新增跨请求正文、解析或压缩列表缓存。
- 详情只计算所属分组，页面汇总按实际输入 memoize；`holdAll` 可引用已经新鲜的完整列表。并排上限、来源读取上限没有降低。

## 图片中四项建议

1. **原生 Job Object**：现有 PowerShell/C# 宿主承担隔离和子进程归属；本轮阅读卡顿的证据指向列表分配、正文挂载和解析寿命。当前不改宿主，不引入 N-API 或框架迁移。
2. **签名与自动更新**：按 [electron-builder 26 更新文档](https://www.electron.build/v26/docs/features/auto-update/) 和 [Windows 签名文档](https://www.electron.build/docs/features/code-signing/code-signing-win/) 准备 NSIS、差分包、发布者和更新签名验证配置，并用本机 26.16.1 schema 实际验证。没有证书、实际 updater 客户端或获批渠道，不能声称已支持自动更新。签名和差分更新也不能替代实际产品验收。
3. **类型化 IPC**：本轮维护原有 sender guard、白名单和类型契约，只优化内部传输。跨技术栈的整体生成器迁移没有显示出当前收益，留待独立接口工作。
4. **静态前端产物**：继续维护现有可独立编译的 React bundle，并对实际产物做字节识别。无需因此重写程序。

## 验收解释

全进程 private working set（MiB）作为本轮驻留口径，另外列 private commit；二者不能互换。连续采样包含初始加载、阅读、跟随、对比/扫描、返回用量页和静置。采样间隙内的瞬时峰值不可见，低于 500 也不构成硬上限保证。各失败实验和测试脚手架失败保留，最终结果另见本轮 RESULTS。合成的两万项保存列表不等于两万份真实会话格式验证。

## 交付时新增的图形证据

最终包在 240 Hz / 150% 环境的五场景为约 618/671/666/494/690 MiB，四项超过500；同环境源码三栏约686MiB。早先300Hz/125%源码整轮通过不能替代它。按 [Electron app GPU/metrics API](https://github.com/electron/electron/blob/main/docs/api/app.md) 读取当前元数据，硬件加速与GPU合成/栅格化报告启用。GPU普通working set明显增加，属于排查线索，尚未归因到特定存活表面或缓存。basic枚举未填充的GL/active字段不构成软件回退证据。没有凭跨平台社区issue或未来Electron版本文档改GPU override、缩放或内存口径；当前包的失败和长帧完整保留，详见最终RESULTS。
