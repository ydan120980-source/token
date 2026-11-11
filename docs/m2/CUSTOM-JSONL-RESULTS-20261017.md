# 自定义 JSONL 来源首版验收（2026-10-17）

## 结果与代码

- 契约：71ab896（CUSTOM-JSONL-SOURCES-20261017.md）。
- 实现：5519cdb（feat: configure personal JSONL agents with transactional usage history）。
- 基线：本地 main 的 5ff1392；在独立 worktree 和 codex/custom-jsonl-sources-20261017 分支实施，由当前主线程完成，没有委派其他执行线程。
- 结果：三种 JSONL 接入、五步来源向导、动态目录、统一费用/导出、历史文件替换与回退均已实现，合成与源码界面验证通过。
- 不包含运行候选、真实来源或真实账号验收；r15 运行包未修改。

## 交付清单

| 能力 | 实现与合成证据 |
| --- | --- |
| 标准事件、Claude 兼容、自定义映射 | 真实主进程 IPC 与 Electron 向导逐项走通；自定义单元用例覆盖时间、稳定 ID、输入缓存/输出推理语义及缺失值 |
| 来源独立身份 | 改名不改变调用 ID；不同来源命名空间隔离；目录迁移后历史范围仍保留，避免另一个来源重复接管 |
| 解析预览 | 按正式解析路径扫描，返回汇总、未知/无效/重复/冲突及增删替换，绑定规则摘要、文件戳记、账本序号和有效期 |
| 历史更新 | 成功完整文件替换，失败/缺失/未完成末行保留；多文件同调用折叠；混用规则明确显示 |
| 原子提交与回退 | 写入失败保持旧文件与内存；来源级回退和撤销移除；首次接入前保存完整旧账本备份 |
| 读取边界 | 显式选定目录、扩展名、认证/链接/产品目录/重叠保护；行长与采样预算；累计/汇总拒绝 |
| 动态界面 | 来源、用量筛选、会话筛选、费用与订阅设置随目录变化；自定义名称转义；通用图标复用 |
| 费用与导出 | 使用统一计价；不按模型名称猜第三方路由价格；导出的统计与配置不包含根目录、正文、逐文件索引或原始身份 |
| 容量与取消 | 2 万条合成调用；初始化后连续刷新保持账本字节不变；取消预览保留原账本；采集审计未发生认证读取、来源写入或网络请求 |

使用说明及完整事件、配置示例见 CUSTOM-JSONL-USAGE-20261017.md。新来源真实样本验证标记默认 false。

## 本轮已执行检查

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| npm run verify | ESLint clean；node --test fail 0 | verify-merge-gate.log |
| npm run test:native | passed；原生 4.17.0 哈希核对，合成来源只读 | native-reviewed.log |
| npm run audit:runtime | passed；单一产品入口、本地资产、无退役依赖 | runtime-merge-gate.log |
| npm run pricing:check | passed；价格目录一致 | pricing-reviewed.log |
| npm run test:custom:stress | passed；2 万条，稳定刷新及取消 | stress-reviewed.log / stress.json |
| npm run test:custom:ui | 100% / 150% 通过；三种向导、会话、回退、导出导入、批量开关、窄窗口和控制台 | custom-ui-rerun.log / ui-final/results.json |
| agent-ui | 现有十来源 100% / 150% 通过 | agent-ui.log / agent/results.json |
| usage-ui | 用量、刷新、暂停、目录保护、统计导出和重启通过 | usage-ui.log / usage/usage-ui-results.json |
| cost-ui | 费用相关源码界面通过 | cost-ui.log / cost/results.json |
| sessions-ui | 会话相关 100% / 150% 通过 | sessions-ui.log / sessions/results.json |
| interaction-reliability-ui | 上一轮六项交互 100% / 150% 通过 | interaction-ui.log / interaction/results.json |
| functional-ui | 价格编辑、模型映射、控件、图表与窄窗口通过 | functional-ui.log / functional/results.json |
| git diff --check | 通过 | 提交前已执行 |

本机结果集中保存在忽略的 artifacts/custom-jsonl-20261017/，命令日志放在其 logs/；这些证据不进入源码 ZIP。相关截图来自隔离 fixture home 和合成数据。Browser 插件未提供，沿用项目 Playwright 原生 Electron 测试，没有安装其他浏览器或依赖。

## 首轮失败、修正与复跑

1. 新向导一开始误用了现有 data-custom-control，segmented.js 会把选择框改成分段控件并隐藏原 select，导致选择超时。改用明确的来源控件标记，并在表现增强器中排除；随后完整流程通过。
2. 全量验证曾因 serve.js 白名单首项顺序触发已有字符串解析测试失败。新资产实际已在白名单中；保留原 index.html 首项顺序，相关测试及最终 verify 通过，没有放宽断言。
3. 压力探针最初把内置来源首次状态初始化算进“无变化刷新”，导致序号断言失败。先完成初始化，再检查稳定刷新；复跑证明字节不改，未修改产品逻辑来绕过该断言。
4. 最后一次终版 UI 验证在 150% 的费用设置步骤出现一次窗口意外关闭（Target page, context or browser has been closed）。日志未给出关闭原因。增加窗口退出/渲染进程诊断后，单独完整复跑 100% / 150% 通过，未复现；没有据此宣称根因已修复。首次失败日志 custom-ui-terminal.log 保留。

## 未执行与限制

- 没有读取真实 Agent 用量、认证文件、实际数据库，也没有登录或刷新真实账号、上传任何数据。
- 没有执行 validate:local、完整发布候选压力/加密套件、Windows 打包、ASAR/解压副本验收或签名。
- 中文输入法验证是合成 composition 事件，不等于人工确认真实 Windows 候选窗；未做屏幕阅读器与长时真实桌面验收。
- 窗口意外关闭仍是未解释的一次现象，发布候选桌面验收时应继续观察并保留诊断。
- 首版没有通用累计差分、可配置 SQLite/CSV/压缩、执行式插件、在线模板、WSL 或自定义账号额度。
- 旧版本不保证能读取含自定义来源的新账本。降级前保留当前统计目录，按使用说明使用首次接入前备份；来源级回退不能代替应用版本降级。
