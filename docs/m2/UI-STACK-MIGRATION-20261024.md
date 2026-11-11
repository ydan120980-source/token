# 前端迁移到 React + Tailwind + Motion · 2026-10-24

## 所有者决定

- **迁移方向**：渲染层从原生 HTML/CSS/JS 逐步迁移到 React + Tailwind CSS v4 + Motion，用 [fluid-functionalism](https://github.com/mickadesign/fluid-functionalism) 的组件统一全站控件和过渡动画。
  - fluid-functionalism 是 MIT 许可的 shadcn 组件库：组件源码复制进项目，之后由本项目维护。
  - 所有者的理由：各页面里作用相同的组件，样式和过渡动画各不相同。另外，原生写法让后续界面调整和功能开发的维护成本过高。
- **测试门槛精简**：按本记录“测试门槛”一节执行。所有者认为最初为界面套件定的计划过度防御。
- **视觉基准**：方案 A（fluid 原样）还是方案 B（fluid 组件 + 现有 `tokens.css`），等所有者看完对比稿再定，届时补记在本文件。对比稿在 `.cache/mockups/stack-ab`，不入库。

## 现状（迁移前，2026-10-24 测量）

- **规模**：渲染层 `design/desktop-reference` 有 45 个 JS、20 个 CSS，约 1.2 MB。
- **动效不统一**：
  - 缓动曲线有 12 种写法；
  - 动画时长有 28 种不同的数值；
  - 叠了 5 个覆盖样式文件（`nowdex`、`polish`、`refinement`、`rhythm`、`integrated-insights`）；
  - 6 个对话框各自实现。
- **测试绑定**：38 个界面套件里，约 1,572 处选择器绑定了现有的 DOM 结构。
- **fluid 的覆盖范围**：它提供按钮、标签页、选择框、对话框、开关、滑块、提示框、表格等控件，不包含图表。图表和自定义交互（圆环、时间针、拖动翻页、热力图）需要自己用 React 和 Motion 重写。

## 分阶段

每个阶段单独合入本地 `main`。

0. **基础**：
   - 加入 Vite + React + Tailwind v4 + Motion 的构建，接通 Electron 现有的安全配置（sandbox、contextIsolation、CSP `script-src 'self'`）；
   - 同步更新 `audit:runtime`、`audit:package`、`build.files`、`serve.js` 和 `CONTRIBUTING.md` 的“代码约定”；
   - 把 `tokens.css` 映射进 Tailwind 主题；
   - 动效只用 fluid 的三档弹簧（`spring.fast` / `moderate` / `slow`），每档配一个退出时长，不再手写时长。
1. **外框和共用组件**：从 fluid 引入控件，替换各页面自己写的版本。
2. **逐页迁移**：顺序为设置、来源、会话、额度、费用，图表放在最后。

## 测试门槛

本节取代 AGENTS.md 和 `CONTRIBUTING.md` 中“渲染层改动要跑受影响的界面套件”这一要求。

- **每次合入**：`npm run verify` 报 `fail 0`，且 `npm run audit:runtime` 通过。后端单元测试不受迁移影响，照常保留。
- **已迁移的页面**：
  - 合入前跑这一页的冒烟测试（源码模式、合成数据、独立目录）；
  - 冒烟测试只查三件事：页面能打开；控制台没有报错；关键数据规则成立（未知不显示 0、不跨 Agent 相加、精确小数不被改写）。
  - 这一页原有的 `*-ui-test.js` 断言随迁移删除，不再维护。
- **还没迁移的页面**：改动它时，跑与改动直接相关的那一个原有套件即可，不跑全量。
- **发布候选**：照旧由发布负责人在打包版上验收，界面部分改为跑全部冒烟测试。
- **数据规则**：不放宽任何一条，见 `CONTRIBUTING.md`“数据语义铁律”。

## 不变

- 本地开发流程：只在本地 git 操作，用主题分支，合入用 `--no-ff`，并写带日期的 `docs/m2/UI-*` 记录。
- 合成数据、不读真实来源和凭据。
- `--agent-*` / `--series-*` 颜色只用来区分 Agent。
- 分工：GPT 负责后端；它补的界面入口也按 React 写法。
