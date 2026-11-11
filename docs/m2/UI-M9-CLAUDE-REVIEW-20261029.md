# M9 像素与交互对照 · 交 Claude 审阅

工作树：`<codex-worktrees>/m9-shell-closeout/token`。
授权范围及设计基准：`UI-SHELL-M9-20261029.md` 第 2、3 节。

## 当前对照

- 原始外框：`artifacts/m9/pixels/before/`，manifest 指向 `d876f61`。
- 全量测试修复后的重拍基线：`artifacts/m9/pixels/repaired/`。
- 每对图片的差异比例、尺寸和差异图：`artifacts/m9/pixels/step1-diff/report.md`、`report.json` 及 `*-diff.png`。
- React 单根外框：`artifacts/m9/pixels/react-root/`；与重拍基线的比较在 `artifacts/m9/pixels/step2-diff/`。24 对均通过，最大差异 0.037%，无豁免。
- 删除 legacy 后的候选：`artifacts/m9/pixels/no-legacy-restored/`；与 React 单根版本的 24 对比较在 `artifacts/m9/pixels/step3-restored-diff/`，全部在原门槛内，无豁免。
- 相同文件名可以直接前后打开：`light|dark` × `quota|usage|cost|sessions|sources|settings` × `top|page`；24 对。
- 所有捕获使用同一固定时钟、合成数据、1280×900、sRGB 和关闭动效。没有通过改比较阈值或填豁免压过差异。

## 最终审阅入口

所有者将手动转交本材料给 Claude。最终截图是 artifacts/m9/pixels/final-presentation；原始 d876f61 对照是 artifacts/m9/pixels/before；24 对差异报告是 artifacts/m9/pixels/final-presentation-diff/report.md（最大 0.09%，原 0.2% 门槛，无豁免）。测试修复后的 repaired 基线对最终候选的报告为 final-presentation-structural-diff/report.md。

交互式并排浏览页在 artifacts/m9/claude-review/index.html，可选六页、深浅色、首屏/整页，查看原图/候选/差异图。图中洋红色块为原有时钟掩码，不是产品界面。

可直接转给 Claude：

> 请在 <codex-worktrees>/m9-shell-closeout/token 审阅 M9 收尾。设计依据 docs/m2/UI-SHELL-M9-20261029.md 第 2 节；本次只做结构迁移、退休层删除和测试暴露的修复。请先读 docs/m2/UI-M9-CLOSEOUT-20261029.md 与本报告，再比较 artifacts/m9/pixels/before 和 final-presentation 的同名图，差异报告在 final-presentation-diff。请特别核对外框、导航胶囊首次显示/切换、侧栏收起、小窗条带和额度筛选胶囊；来源管理弹窗拆分只改组织。请给出通过/阻塞项/非阻塞差异，先反馈审阅结论，不直接改其他分支或合并。机器通过不代替你的视觉审定。

## 请特别核对的修复

1. `≤800px` 外框恢复既有横向导航，页面按钮不再被侧栏遮挡。截图在 `artifacts/custom-jsonl/source/` 及 `artifacts/interaction-reliability/`。
2. 费用长名称、图例与单行表头的边界修复，见 `artifacts/cost-compact-preview/`、`artifacts/cost-layout-preview/`、`artifacts/cost-rebuild-20261018/`。
3. 费用详情指标标签由已有次要文字色改为已有正文色，修复约 4.16:1 的对比度失败。布局、圆角和底色未改。对应费用综合套件的详情截图在 `artifacts/ui-mig/M8/cost/1/`。
4. 月份快捷范围键盘入口、来源路径重置后的焦点恢复，见交互可靠性套件；这两项没有新增视觉设计。

## 审阅状态

当前为待审阅材料，尚未收到 Claude 的审阅结论。最终发布对照已补齐；不得把本文件的存在当作 Claude 已批准。
