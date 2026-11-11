# 阅读性能与原生 150% 内存复测 · 2026-11-04

**RAM_TARGET_NOT_MET。最终三栏连续采样峰值 704.03 MiB，目标仍为 300–500 MiB。** 这轮是局部改进和新诊断证据，不是发布验收通过。离开阅读页的长任务仍存在，采集 2× 也没有在这轮达成或重新测量。

## 基线、范围和字节

以共享 main `1f36b10`（已包含 Claude 性能分支和新阅读左右栏）为基线，在独立分支 `codex/perf-memory-20261104`、工作树 `<workspace-parent>/token-worktrees/gpu-memory-20261104` 实现。共享 main 保持 `1f36b10`，他人的未跟踪 `docs/agents/` 保留；没有合入、推送或发布。

原生显示环境是 240 Hz / 150%，viewport 1480×962、DPR 1.5，产品默认窗口不缩小。没有 GPU / vsync 降级、GC、工作集裁剪、内存配额、减少栏数或记录缓存。全部使用新的合成 home、usage 和 quota 目录。

- 基线编译 renderer SHA-256：`c50d506938a57518323eeafab228bbf328af6960de14b5812593b73a54bea063`。
- 最终编译 renderer SHA-256：`1faedd3a850c8a4f797329abfd54dbd10f901ad0c6288928f968b050c88dcc83`。
- CSS 与基线逐字节相同。没有保留试验中的外框、阴影、背景或 containment 修改。
- 测的是源码模式。旧包没有包含这轮修改，不能沿用旧包的通过记录。

## 保留的两处改动

1. 初次会话预览在解析期间就不再保留不会返回的长正文和图片数据；完整读取、查找、导出仍可取得原文。范围和微基准见 `RESULTS-TRANSCRIPT-PREVIEW-20261104.md`。
2. 阅读开场的同一淡入 / 位移动画改为包住可见滚动视口，不再包住长达数万像素的全部滚动内容。保持滚动节点身份、原有弹簧、方向和 reduced-motion 分支；按内容 key 重播。没有改页面布局、色彩、按钮或字号。

在现有 reader-window 套件中补一项正向断言：必须观察到真实 opacity 变化，并确认动画目标高度不超过滚动视口，而内容确实超过三屏。最终观察到 15 个动画样本、opacity 0.287–0.996，目标高度 702 px、内容高度 18,064 px。原有远跳、窗口化、滚动恢复、焦点保持等断言均通过。

## 同负载内存

命令：`PERF_PROFILE=three`、`PERF_OUTPUT=<独立证据目录>`，运行 `node scripts/m1/multi-reading-memory-check.js`。先完成初始数据加载再开始连续采样，**不覆盖全量首次导入的峰值**。

负载：64,000 条统计 / 100 个模型、20,009 个已保存会话，三个各 300 轮 / 24,718,814 字节的长记录；每栏滚到结尾，确认各有 300 个轮次框、当时各只绘制两个正文，再做两次三栏跟随更新。批量会话的缺失源文件是夹具原设计，不能当作两万个实际长文件。读取前后 statistics.json 字节不变。

Windows 计数器汇总应用拥有的所有后代进程私有工作集；private commit 单列。连续采样不是瞬时上界，最终最大间隔 776 ms、无缺失采样、无 renderer 错误。

| 私有工作集 | 基线一轮 | 最终一轮 |
| --- | ---: | ---: |
| 默认窗口空闲 | 456.82 MiB | 384.03 MiB |
| 全部会话列表加载 | 561.41 MiB | 465.62 MiB |
| 三栏初次打开 | 774.72 MiB | 658.87 MiB |
| 三栏滚到结尾 | 722.10 MiB | 685.75 MiB |
| 第一次跟随更新 | 613.07 MiB | 569.99 MiB |
| 第二次跟随更新 | 589.94 MiB | 555.19 MiB |
| 关闭阅读回用量页 | 711.99 MiB | 672.48 MiB |
| 最后一次空闲样本 | 569.57 MiB | 551.65 MiB |
| **连续采样峰值** | **810.66 MiB** | **704.03 MiB** |
| 连续采样 private commit 峰值 | 911.96 MiB | 890.90 MiB |

空闲基线本身也波动，不将两轮相差 106.64 MiB 宣称为稳定的因果收益比例。微基准支持解析阶段少留文本的收益；本表支持的应用结论是“仍超标”。本轮未重跑 two / compare / list / scan 四种完整负载，不能用三栏表补成全覆盖。

## GPU 调查与撤回的试验

本机 AMD Radeon(TM) Graphics，ANGLE D3D11，硬件合成和光栅化启用；没有证据把问题归咎于软件回退或驱动泄漏。CDP LayerTree 和 memory-infra 诊断确认 GPU 进程占用显著，长滚动层、外框及合成资源参与其中。GPU 诊断调用自身可能增加初始化开销，诊断数字不混入上述普通验收。

参考 Chromium 的 [GPU memory-infra](https://github.com/chromium/chromium/blob/main/docs/memory-infra/probe-gpu.md)、[合成说明](https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/) 和 [LayerTree 协议](https://chromedevtools.github.io/devtools-protocol/tot/LayerTree/)。资源树可能有共享归属，不能把所有子分类再相加当作额外内存。

外框裁剪 / 滚动 containment、缩小 100vmax 阴影铺展、滚动层同色不透明背景等试验的连续峰值分别约 757 / 804 / 805 MiB，没有稳定收益，全部撤回；只保留解析预览的中间轮约 765 MiB。移动视口动画的中间实现约 752 MiB，最终实现结果见上表。故意去掉外框的短诊断以及在初次三栏后主动停止的诊断均不是通过记录。

## 验证、初始失败和未解决项

- 最终 `npm run verify` 通过，fail 0；`audit:runtime` 通过；编译和 UI 类型检查通过。
- 受影响界面只跑 reader-window、session-reader 和阅读长任务探针，没有重启 58 套全量 UI。reader-window 26 项通过；session-reader 的布局、左右栏、查找导航、复制、范围导出和键盘检查通过。没有重拍像素基线或前后对照。
- 第一轮 verify 在继续修改 renderer 时遇到 bundle 字节不一致；停止修改、重建后最终全量 verify 通过。第一版新增动画断言采不到真实动画而失败；修正动画启动时机与实际 opacity 观察后再次运行通过，没有放宽为“没有动画也通过”。
- 长任务探针功能过程完成、无 renderer 错误，但其 `ok:true` **不表示无长任务**：打开阅读 71 ms、关闭阅读 56 ms、离开会话转到用量页 173 ms。跳转、显示模式切换、滚动、跟随更新在这一轮没有观测到 ≥50 ms 的任务。单轮没有观测到不等于高刷新率下始终流畅；离页的旧 104 ms 未解决，本轮反而测到更高值，不能关闭该项。
- 采集 2× 仍沿用未达成状态（1.17× / 1.26×），本轮没有改入账或原生校验语义，也没有重测吞吐。
- 未重新打包、未验收真实记录、未签名（NOT_CONFIGURED）、未推送；300–500 MiB 和“完全不卡顿”的目标均不宣称完成。

原始最终报告与日志已另存于 `<workspace-parent>/token-evidence/perf-memory-20261104/`：`baseline-three.json`、`final-three.json`、`preview-ab.json`、`reader-window.json`、`reader-window-initial-failure.json`、`longtask.json`、`verify.log`、`session-reader.log`、`runtime.log`、`gpu.json`；`sha256.json` 记录文件校验。它们在源码树外，不生成发布代次或源码 ZIP。
