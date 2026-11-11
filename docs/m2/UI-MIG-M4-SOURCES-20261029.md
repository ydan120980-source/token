# M4 来源管理页迁移（Claude 重做）· 2026-10-29

**状态**：所有者 2026-10-29 要求把之前不合格的 M4、M5 做完，只跑重要测试，通过后直接合入 main。本记录是 M4 部分；M5 见 `UI-MIG-M5-SESSIONS-20261029.md`。

## 1. 外观基准

基准是 main 上的旧来源页。`UI-MIG-M4-M5-REVIEW-20261028.md` 第 3 节指出的问题都已修正：

- **顶部**：一行汇总，四个操作按钮：安装与更新、全部读取/全部停用、添加我的 Agent、重新检查。
- **提示条**：只在有内容时出现，不再放常驻的说明。
- **需要处理**：
  - 标题带事项数，旁边是“显示已知悉”开关，有两类以上事项时显示分类；
  - 所有事项放在一张卡片里，每条一行：分类标签、粗体标题、灰色影响说明、操作按钮和“已知悉”。
- **Agent 配置**：去掉了说明文字和底部免责声明，与 main 上 2026-10-27 的删改一致。
- **来源**：一张卡片，每个 Agent 只占一行：
  - 图标、名称、状态标签；
  - 一行事实，最后一项是账号额度；
  - “读取位置 N”和“解析能力与字段覆盖 · 格式”两个药丸，各自折叠，展开内容在行下方；
  - 右侧是“管理”按钮和开关，开关不显示文字。
- **已发现 · 暂不支持**：一张卡片，去掉了说明文字。
- 页面没有分隔线，控件都用组件库的。

## 2. 数据层

- **沿用 Codex**（`ui/mig-m4-m8`，`247ffc1`）：
  - `sources-host.js`：读取、开关、路径、安装、设置引导、连接、配置检查和管理、自定义来源；
  - `sources-model.js`；
  - `ui/src/data/sources-host.ts`；
  - `sources-models.test.js`。
- **补进 main 之后的改动**：模型里的提示条只说发生了什么；配置检查的选择说明和空状态去掉说明小字。
- **退役的旧文件**：
  - 7 个脚本：`sources-ui`、`config-health-ui`、`config-manager-ui`、`custom-sources-ui`、`source-connections-ui`、`agent-setup-ui`、`agent-install-ui`；
  - 4 个样式表；
  - 演示目录对话框，改由 React 页面里的演示表单代替。
- **改接的调用**：
  - `preview.js` 改调 `sourcesHost`，页面没挂载时也能更新；
  - 标题栏的“刷新”在来源页时改调 `sourcesHost.load(true)`。
- **`insights-ui.js`**：
  - 新增 `items()`，把“需要处理”的句子作为数据给页面；
  - 新增 `act()`，执行事项上的按钮；
  - 新增 `capabilityView()`，给出结构化的解析能力；
  - 侧栏“来源管理”的角标在每次读取后更新，来源页不显示时也照样更新；
  - 旧页面元素不存在时不再报错；
  - `openAttention` 会等页面挂载后再定位。

## 3. 组件库新增

- `Switch labelHidden`：标签只给读屏器。
- `PillToggle`：药丸样式的折叠按钮。
- `Collapse`：展开时长高、收起时缩回（`spring.moderate`），减少动效时交叉淡入。

## 4. 已知不足

`ui/src/pages/sources/sheets.tsx`（各种弹窗和 Agent 配置区）来自 Codex。我用 TypeScript 打印器重排过，只删了说明小字，行为没动。但它的 JSX 里还有 36 行超过 200 字符，可读性没有达到会话页的水平，留作后续整理。

## 5. 测试

- 把 Codex 对 10 个界面测试的改动合到 main 上，冲突部分按页面取舍：费用、用量、会话页用 main 的选择器，来源页用 Codex 的。
- 再按新页面的结构改了 `openSource` 等几处选择器。
- `source-quota-ui-test` 原本在额度页那一步找已经删除的 `#quotaIdleSection`，main 上原样跑也会失败，已改成找 `#quota`。

都在源码模式下用合成 fixture 跑：
- `npm run verify` 0 失败，`audit:runtime` 通过，样式守卫通过；
- 通过的界面测试：
  - 来源相关：`agent`、`custom-sources`、`config-health`、`agent-setup`、`agent-install`、`source-quota`、`collection-diagnostic`、`unpriced-guidance`、`usage`、`workbench`、`ui-foundation`；
  - 回归：`sessions`、`widgets`、`overview`、`cost-smoke`、`usage-smoke`、`statistics-worker`；
- 没有跑：`style-alignment`、`interaction-reliability`、`budget-overview`、`billing-query`、`source-reliability-stress`，以及其余全量套件。
