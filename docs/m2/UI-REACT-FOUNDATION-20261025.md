# React 层第 0 阶段：迁移前提 · 2026-10-25

## 所有者决定（2026-10-25）

- **视觉基准**：浅色用方案 B，即 fluid-functionalism 组件配现有的灰阶（`tokens.css`）；深色直接用 fluid-functionalism 的深色主题。
- **先打通前提**：先把迁移的前提条件全部打通（本记录），再一起确定统一的界面风格和过渡动画。
- **不用悬停**：不用悬停交互，也不用悬停卡片。具体边界在风格规范里定。
- **分工**：
  - 风格和动效定下来后，由 Claude 写一份给 Codex 执行的详细计划（PRD 和逐步的 MVP），严格限定 Codex 不自行设计、不按自己的审美改动；
  - Claude 负责检查和优化 Codex 完成的效果。
- **不变的规则**：
  - 本记录不改变数据语义规则、仅在本地 git 操作的约定和合成数据验收；
  - 测试门槛沿用 `UI-STACK-MIGRATION-20261024.md`。

## 做了什么

### 构建

- **源码位置**：React 层的源码在 `ui/`（TypeScript）。
- **构建命令**：`npm run build:ui` 用 Vite 7 把它构建到 `design/desktop-reference/ui/`，产出三个文件：
  - `agent-ui.js`：一个普通脚本（IIFE），不用 ES module，运行时不加载或生成代码；
  - `agent-ui.css`；
  - `agent-ui.LICENSES.txt`：第三方许可证声明。
- **产物入库**：构建产物提交进仓库。所以运行、界面测试和打包都不需要先构建，打包流程也没有变。
  - `tests/m1/ui-bundle.test.js` 会在临时目录重新构建，并逐字节比对提交的产物；忘了重新构建，`npm run verify` 就会失败。
- **类型检查**：`npm run typecheck:ui` 跑 `tsc`，已经加进 `npm run verify`。ESLint 不检查 `ui/` 和构建产物。
- **依赖**：React、Radix、Motion、Tailwind、Vite 等都是精确版本的 devDependencies，不是运行时依赖。
  - 打包后的 ASAR 里没有这些 node_modules，也没有 `ui/` 源码，只有三个产物文件（已用 `@electron/asar` 列表确认）。
  - 运行时依赖仍然只有原来那三个，`audit:runtime` 对此有断言。

### 安全配置

- 窗口的 sandbox、contextIsolation 和 CSP（`script-src 'self'`）都没有放宽。
- 产物以 `<script src="ui/agent-ui.js">` 方式在所有旧脚本之后加载。
- `audit:runtime` 新增两项检查：
  - 产物中不能出现 `eval(`、`new Function(`、`import(` 和 `require(`；
  - 沿 `@import` 逐层检查样式表引用的资源是否存在。

### 新旧共存

迁移期间旧页面和 React 组件同时存在，这一节说明两者为什么互不干扰。

1. **级联层顺序**：旧的 20 个样式表改由 `legacy.css` 统一导入，并放进第一个级联层。顺序是 `@layer legacy, ui-reset, theme, base, components, utilities`。
   - 这样，旧样式里的元素规则（`button`、`select`、`h1` 等）无论选择器优先级多高，都压不过 React 层的样式。
   - 旧页面彼此之间的层叠关系不变。用浅色主题对 7 个画面逐像素比对 main 和本分支：5 个完全一致；会话页和来源页的差异，与 main 自己重拍两次的差异逐像素相同（都是相对时间文字）。
2. **`ui-reset` 层**：在 React 根节点内，表单、标题、表格等元素先退回浏览器默认样式，再应用 Tailwind 的基础样式。
   - 原因：旧样式会设置一些 Tailwind 基础样式不管的属性，例如按钮的最小高度。没有这一层时，开关会被撑成圆形。
3. **基础样式限定范围**：Tailwind 的基础样式（preflight）由 `ui/scripts/scope-preflight.mjs` 生成为只作用于 `[data-ui-root]` 和 `[data-ui-portal]` 的版本。
4. **工具类限定范围**：构建时，每条 Tailwind 工具类规则都加上 `:where([data-ui-root],[data-ui-portal]) ` 前缀（`ui/scripts/scope-utilities.mjs`）。
   - 这样，`.block`、`.visible` 这类和旧页面同名的类不会作用到旧元素上。
   - `ui-bundle.test.js` 会检查每条工具类规则都带了这个前缀。
5. **弹出层**：所有弹出层（对话框、选择框、下拉菜单）都渲染进 body 下唯一的 `[data-ui-portal]` 元素。
6. **变量名冲突**：fluid 组件读取的 `--muted`、`--accent`、`--input`、`--ring`、`--card` 和旧页面里的同名变量含义不同。
   - 这些变量只在 React 根节点内重新定义为 fluid 的含义，取值来自 `tokens.css` 新增的 `--ff-*`。
7. **同名类改名**：fluid 源码里与旧样式同名的类已改名（`is-active`、`scroll-fade`、`block`），清单在 `ui/src/vendor/fluid/VENDOR.md`。

### 主题

- **`tokens.css` 仍是唯一来源**：新增 `--ff-*` 语义变量和 fluid 的六级字号（`--fs-*` / `--lh-*`）；`ui/src/theme/index.css` 只负责把它们映射成 Tailwind 主题。
- **浅色**：`--ff-*` 取现有灰阶。
- **深色**：`--ff-*` 取 fluid 原值。
  - 旧页面的深色基础色也同步换成 fluid 深色（底色 `#171717`、卡片 `#252525`、文字 `#f5f5f5`、次要文字 `#a3a3a3` 等），所以迁移期间深色不会出现两套底色。
  - 窗口标题栏和窗口底色也一起改了（`src/quota/main.js`、`src/quota/window-shell.js`）。
- **不变的颜色**：Agent 色（`--agent-*` / `--series-*`）和警示色没有改。

### 动效

- 动效只用 fluid 的三档弹簧，进入和退出各有固定时长：

  | 档位 | 进入 | 退出 |
  |---|---|---|
  | `spring.fast` | 0.08s | 0.06s |
  | `spring.moderate` | 0.16s | 0.12s |
  | `spring.slow` | 0.24s，带少量回弹 | 0.16s |

- 应用的动效设置（`body[data-motion]`）会传给 Motion：
  - 完整：正常播放；
  - 减少：只保留淡入淡出；
  - 关闭：所有 Motion 动画直接跳到终点。
- 旧页面的 CSS 动效还没有统一，等风格规范定下来，随页面迁移一起处理。

### 挂载接口

- 旧页面通过 `window.agentUi.mount(name, element, props)` 挂载已注册的 React 组件，返回 `{ update, unmount }`。被挂载的元素会成为 React 根节点（`data-ui-root`）。
- 已注册的组件在 `ui/src/islands/index.ts`。本阶段只有一个 `probe`，供冒烟测试使用，产品页面不挂载它。

### 迁移后的页面怎么测

- **共用检查**：`scripts/m1/ui-smoke.js` 提供每个已迁移页面冒烟测试都要用的检查：
  - 启动合成环境；
  - React 元素上不能带旧样式的类名；
  - 带 `data-value="unknown"` 的值不能显示成 0；
  - 不能出现 `data-agent-total`（跨 Agent 相加）；
  - 空白页比对。
- **空白页比对**：把同一个组件放进只有 `tokens.css` 和 React 层样式的空白窗口，逐元素比对约 40 项计算样式。出现任何差异，就说明有旧样式漏进来了。
- **第 0 阶段的冒烟测试**：`scripts/m1/ui-foundation-ui-test.js`（`npm run test:ui:foundation`），覆盖：
  - 接口；
  - 挂载前后旧元素不变；
  - 深浅两色的变量值；
  - 选择框和对话框挂在共用弹出层下，焦点正确进出；
  - 空白页比对；
  - 动效关闭；
  - 没有控制台错误（包括 CSP 违规）。

## 验收

- `npm run verify` 失败数为 0（含 typecheck 和 `ui-bundle.test.js`），`npm run audit:runtime` 通过。
- `ui-foundation-ui-test.js` 在源码模式和打包版（`dist:win:dir`）上都通过，`audit:package` 通过。
- **旧页面检查**：浅色逐像素比对如前所述。深色改动影响所有页面，补跑了带深色对比度检查的 `quota-v4`、`visual`、`style-alignment`，均通过。
- **已知的既有失败**：`cost-ui-test.js` 在 main（4f0510a）上同样失败，断言在圆环中心数字的悬停读数。与本次改动无关，未处理。
- 只用合成数据。没有做真实账号验收。

## 下一步

- 和所有者一起定统一的风格和动效规范：
  - 组件清单；
  - 悬停的边界；
  - 字号和圆角；
  - 每类变化用哪一档动效。
- 然后写给 Codex 执行的计划。
