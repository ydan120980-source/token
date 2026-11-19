# 概览页拖拽动效终审阻断项修复 · 2026-11-16

源码分支 `antigravity/fix-drag-motion-20261116`，从本地 `main` 的 `5733ffe` 开始。被审对象是 `antigravity/dev-20261114` 已快进合入 `main` 的那批概览页交互物理重构（复审核对区间 `9054952..5733ffe`，10 个文件、+908/−80、7 个提交）。终审结论为【存在阻断 · BLOCKED】，本批即为阻断项的修复，不含新功能。

## 阻断项与修法

### P0-1 两条已提交的 UI 套件契约被改坏

重构改了 DOM 契约，却把断言留在原地，套件必然失败：

| 套件 | 原断言 | 实际渲染 |
| --- | --- | --- |
| `scripts/m1/quota-cards-ui-test.js:75` | `.quota-card-head[data-mark-only]` 计数 1 | 头部只剩 `<header class="quota-card-head">`，属性随 `MARK_ONLY` 一起被删 |
| `scripts/m1/quota-v4-ui-test.js:149` | `#quotaCards .quota-card.is-dragging` 计数 1 | 飞卡类名是 `is-flying`；`is-dragging` 全仓库无任何发出方 |

第二条不只是断言过期：`is-dragging` 从来没有被任何代码添加过，等于这条断言一直在等一个不存在的东西。

修法是把断言同步到新契约，而不是把旧契约找回来（`data-mark-only` 的唯一用途是让 `scripts/m1/text-fit.js` 跳过一张卡自己的名字，而该标题现在本来就存在、本来就该参与排版检查）：

- `quota-cards-ui-test.js:75` → `.quota-card-head h3` 计数 1，消息「the card keeps its own name in the head」。
- `quota-v4-ui-test.js:149` → `#quotaCards .quota-card.is-flying` 计数 1，消息「the card in hand is the lifted one」。
- 连带清掉死代码：`ui/src/theme/app-layout.css` 的 `.quota-card-head[data-mark-only] h3` 规则、`scripts/m1/text-fit.js:12` 的 `[data-mark-only] h3` 跳过项、以及 CSS 里所有 `.is-dragging` 选择器。

### P0-2 减少动态效果下仍在动

`design/desktop-reference/quota-card-grid.js` 在四处用了不一致的判据：`slide()` 只在 `'reduced'` 时提前返回（`'off'` 照样滑）、FLIP 让位用 `mode !== 'off'` 守卫（`'reduced'` 照样滑）、落位弹簧只在 `'off'` 时跳出（`'reduced'` 照样跑满整段弹簧）。`ui/src/kit/sortable.tsx:391/411` 同病：`layout={mode !== "off"}` 让 `'reduced'` 下小组件仍然位移。

修法是把整个拖拽收敛成一个判据：

```js
const still = () => { const mode = window.uiMotion?.mode; return mode === 'off' || mode === 'reduced'; };
```

`slide()`、FLIP 让位、`settleFrame`、拾起时的 `scale(1.025)`、以及跟手时的侧倾与缩放，全部改成 `still()`。语义是：只在 `full` 下做装饰性位移；`reduced`（应用设置或系统偏好）与 `off` 一样，不滑、不倾、不弹，但卡片仍然跟着手走——那是使用者自己的手，不是装饰。

React 侧对应 `layout={full}` / `layout={full && !settling}`，`full` 来自 `useKitMotion()`，已经同时吸收了应用设置与系统 `prefers-reduced-motion`。

### P1-1 裸色值与越界的圆角

`ui/src/theme/app-layout.css` 的 `rgba?()` 从基线 4 处涨到 42 处，`border-radius: 1rem` 出现 3 次（规格里是 `--radius-sheet: 20px`）。`ui-design-guard.test.js` 对 `theme/` 整个目录豁免、且 `.css` 一律跳过，所以守卫没拦住。

修法：新增 8 个 `--drag-*` 语义令牌（`--drag-ease`、`--drag-feedback`、`--drag-lift-time`、`--drag-lift`、`--drag-land`、`--drag-hover`、`--drag-slot-edge`、`--drag-slot-fill`、`--drag-slot-stripe`），深色主题在 `body.dark` 里只覆盖取值。样式表改为纯令牌引用，深浅两套阴影不再各写一份。

结果：`rgba?()` 回到 4 处，且字节级等于基线那 4 处；`border-radius: 1rem` 归零。

### P1-2 小组件在非编辑态也能被拖动

重构把 `ui/src/pages/widgets/index.tsx` 改成了永远挂 `<Sortable immediate>`，删掉了非编辑态的普通分支。后果是概览页日常浏览时，小组件被随手拖走。

修法：恢复编辑态门控，非编辑态回到普通 `div` 渲染。

### P1-3 4px 阈值把点击吃成拖拽

额度卡片与小组件本身都是点击目标（卡片点开详情、小组件点开内容）。`dist >= 4` 的起拖阈值太浅，手抖两个像素就从点击变成拖拽。两侧统一提到 `DRAG_SLOP = 8`。

### P1-4 键盘路径不可达

`quota-v4-ui-test.js` 用 `Alt+ArrowLeft` 移动卡片，但卡片 `<article>` 没有任何 `tabindex`，键盘根本聚焦不到。修法：卡片渲染时带 `tabindex="0"`，并补焦点环。焦点环用 `--accent-text` 而不是 `--focus-ring`——后者在 `ui/src/theme/index.css:49` 被限定在 `:where([data-ui-root], [data-ui-portal])` 内，而 `#quotaCards` 在宿主层，拿不到这个变量。

### P2 两处一致性

- 侧倾平滑不一致：原生网格用指数平滑，React 侧直接 `rotate.set(targetTilt)`。统一为指数平滑（`tiltSmooth.current += (target - tiltSmooth.current) * 0.25`）。
- 落位弹簧无取消：`useLayoutEffect` 的清理只 `stop()` 动画，紧接着的 `Promise.all` 仍会结算状态，可能在上一次落位的回调里改掉新一次的状态。加 `cancelled` 标志。
- `design/desktop-reference/index.html` 的 `data-motion` 静态写成 `"full"`，与基线的 `"off"` 不符；改回 `"off"` 作为水合前的默认值（`app-presentation.ts` 的 `apply()` 在模块加载时就会覆盖它）。

## 验证

全部在仓库根目录、`main` 的 `5733ffe` 之上执行。

| 检查 | 结果 |
| --- | --- |
| `npm run build:ui` | 通过；`agent-ui.css` 193.94 kB、`agent-ui.js` 1,365.93 kB |
| `npm run lint` | 通过 |
| `npm run typecheck:ui` | 通过 |
| `node --test tests/m1/ui-bundle.test.js tests/m1/ui-design-guard.test.js` | 7/7，产物与 `ui/` 源码重新构建逐字节一致 |
| `npm run governance` | PASS：统一入口、冻结运行时、最小依赖、离线采集与独立 keyring 额度边界 |
| `npm run audit:runtime` | PASS：171 个可连产品模块 |
| `npm test` | 813/813，`fail 0` |
| `node scripts/m1/audit-package.js "E:\TOKEN\Agent Usage Quota"` | **失败**，见下 |

`npm test` 完整跑过三轮；其中一轮出现 `actual: 1, expected: 2` 一次，单跑 `tests/m1/windows-memory-sampler.test.js` 通过。该文件的 `assert.equal(cim.length, 2)`（第 18 行）与 5 MiB 一致性判断（第 19 行）对并发负载敏感，属于环境抖动，与本次改动无关。

`audit-package` 失败是预期内的：实机 `app.asar` 里仍是修复前的字节。按该脚本自己的比较口径（只走 `src/quota`、`src/m1`、`design/desktop-reference` 三个目录加 `LICENSE`、`docs/m1/UPSTREAM.md`、`docs/m1/CODEX-QUOTA.md`，并排除脚本内置的 3 个例外）重新逐字节比对，结果是 **271 项一致 + 6 项不一致 = 277**，这 6 项恰好就是本批改动的打包文件：`design/desktop-reference/index.html`、`quota-card-grid.js`、`sources-model.js`、`tokens.css`、`ui/agent-ui.css`、`ui/agent-ui.js`。没有其他打包文件漂移。修复前该脚本在 `5733ffe` 上是 277 项全一致，因此这次差异完全归属本批，需要重新出包后再复核。

`!important` 数量从 18 降到 16，剩下的拖拽相关四处（`position: fixed`、`z-index`、`pointer-events`、`margin`）是结构必需。

## 实机 UI 套件（桌面环境可用后补跑）

跑前 `Remove-Item Env:ELECTRON_RUN_AS_NODE`，全部在 `antigravity/fix-drag-motion-20261116` 上执行。

| 套件 | 结果 |
| --- | --- |
| `quota-cards-ui-test.js` | PASS（`quota cards passed`） |
| `quota-v4-ui-test.js` | PASS（1× dark、1.5× light 两档全过） |
| `widgets-ui-test.js` | PASS（编辑、库、设置、读数、已存布局） |
| `ui-motion-mode-ui-test.js` | PASS（真实动效偏好与系统切换、双主题、中断、焦点与指针释放） |
| `motion-ui-test.js` | PASS（两档缩放，`noPageErrors: true`） |
| `text-clip-ui-test.js` | PASS |
| `interaction-reliability-ui-test.js` | PASS（合成 IME、滚动中断、来源失败恢复、原生对话框焦点） |
| `overview-ui-test.js` | PASS（概览范围、当天详情、tooltip 穿透、100%/150% 额度冷却） |
| `ui-kit-gallery-ui-test.js` | PASS（双主题、语义、控件、弹层、键盘焦点、动效、截图） |
| `ui-mkb-gallery-ui-test.js` | PASS（双主题，含排序长按、Escape 取消、日历焦点） |
| `widget-fit-ui-test.js` | PASS |

### 落位竞态：`quota-v4` 第一轮失败暴露的真实缺陷

第一轮 `quota-v4-ui-test.js` 在第 151 行失败（`moved[2]` 实际 `codex`，期望 `opencode`）。诊断后分成两件事：

1. **测试的时序假设过期**，不是产品错。`drop()` 的落位是 380ms 的 `requestAnimationFrame` 解析解弹簧，不是 Web Animations；`scripts/m1/ui-settle.js:6` 的 `settle()` 只等 `document.getAnimations()`，等不到 rAF 弹簧。基线 `9054952` 的 `drop()` 是同步 `host.reorder(shownKeys())`，所以旧测试从不需要等。诊断脚本确认落位结束后顺序与 `localStorage` 都是对的（`movedToThird = true`）。测试改为在 `mouse.up()` 后等 `#quotaCards [data-sort-placeholder]` 消失再断言。
2. **顺带发现的真实竞态**：`drop()` 一开始就把 `drag = null`，而 `render()` 只在 `drag` 非空时早退。落位 380ms 内如果有 `publish()` 触发重绘（`inputKey()` 含 `Math.floor(Date.now()/30000)` 时间桶，到点必然重绘），DOM 会被重建，飞卡与占位槽一起被孤立，`finishDrop()` 里 `placeholder.parentNode` 为 `null`，卡片就回不来了。按每次拖放约 380/30000 ≈ 1.3% 的概率发生。修法是加 `landing` 标志：`render()` 早退条件改成 `if (drag || landing) return;`，`drop()` 里 `drag = null` 之后立即 `landing = true`，`finishDrop()` 与 `!placeholder` 早退分支各自清掉它。

### 三处既有失败与两处新暴露缺陷

首轮失败五条。用 `git worktree add $env:TEMP\token-base-5733ffe 5733ffe` + `mklink /J node_modules` 建基线树实跑对照，把「本批引入」和「既有」分开：

| 套件 | 失败点 | 基线 `5733ffe` 同样失败 | 归因与修法 |
| --- | --- | --- | --- |
| `interaction-reliability-ui-test.js` | `:69` `assert((await page.title()).includes('Agent Usage'))` | 是 | `1dafc92 release: brand the 0.1.6 preview as QuotaDock`（2026-11-15）把标题改成 `QuotaDock · 本地用量与账号额度`，断言未跟随。8 个套件的过期标题断言统一改为匹配 `QuotaDock` |
| `ui-mkb-gallery-ui-test.js` | `:207` 日历应用后焦点断言 `false !== true` | 是 | 点「应用」后焦点确实回到触发按钮、`draft` 已更新，但发生在 `AnimatePresence` 的约 300ms 退场动画内（该动画由 `0765f92` 于 2026-11-04 引入）。断言前补 `await popover.waitFor({ state: 'detached' })` |
| `motion-ui-test.js` | `:71` `sources-ui-helpers.demoDirectoryChecks` 等 `[data-sources-page][data-ready=true]` 超时 | 是 | 见下「demo 预览崩溃」——这是一处真实缺陷，只是早于本批 |
| `ui-mkb-gallery-motion.js` | `:41` `'bcad' !== 'bacd'`，Escape 取消后顺序未恢复 | 否（基线在该文件 `:40` 超时，失败点不同） | 见下「Sortable Escape 失效」——真实缺陷 |
| `quota-v4-ui-test.js` | `:151` 落位后未换位 | 否 | 见上「落位竞态」 |

#### Sortable Escape 失效：飞卡夺走了焦点

`ui/src/kit/sortable.tsx` 把 Escape 取消绑在根 `role="list"` 的 React `onKeyDown` 上。卡片被拿起时，真实卡片节点被 `data-sort-placeholder` 替换，占位节点没有 `tabIndex`，焦点掉到 `<body>`——keydown 目标不在根节点子树内，React 处理器永不触发，`finish(true)` 没被调用；随后的 `mouse.up()` 走 `finish(false)`，把交换提交了。

原生额度卡网格没有这个问题，因为它在 `window` 上捕获 keydown（`quota-card-grid.js:545`）。

修法三处：`window` 级 Escape 监听（`hold.current` 非空时 `finish(true)`）；`startDrag` 里记下 `focusBack`；`picked` 归零后把焦点还给原卡（必须放在提交后的 `useEffect`，不能放在落位 `useLayoutEffect` 里——那时占位节点还挂着、原卡还没回树）。

#### demo 预览崩溃：Agent 目录扩到 17 个而 demo 数据只覆盖 10 个

`design/desktop-reference/sources-model.js` 的 `demoDiscovery()` 里 `homes`/`files` 两张表只有最早 10 个 Agent，而 `src/m1/agent-catalog.js` 现在注册 17 个。`homes[agent].map` 对新增的 7 个抛 `TypeError`，`state.discovery` 永远赋不上值，`data-ready` 永远是 `false`，于是 `[data-sources-page]` 的等待超时。

修法是给 7 个新 Agent 补齐 demo 条目，并在映射里加兜底（`homes[agent] || ['.' + agent]`、`files[agent] || [null]`），保证以后再加 Agent 不会把无桥预览打崩。

## 对照参考视频的手感核实

用户提供的参考片段（Kanban 看板拖拽，19.508 秒、1344×1204）用 Playwright + 本机 Chrome 逐帧抽出 16 张 PNG 判读，再在实机上抓同一套动作的截图对比：

| 观察项 | 参考片段 | 本实现 |
| --- | --- | --- |
| 拾起 | 飞卡轻微放大、明显侧倾、大景深浮起阴影 | `scale(1.025)` + `--drag-lift` 三层阴影，实测 transform 为 `translate3d(…) rotate(2.16deg) scale(1.025)` |
| 侧倾 | 随指针速度侧倾，快则角大 | 实测扫过 60/120/180/240px 得 2.16° / 3.40° / 4.10° / 4.50°，限幅 `[-5°, +5°]`，由 `trackerX.velocity()` 的 100ms 窗口驱动并指数平滑 |
| 占位槽 | 45° 细斜纹、浅色填充、微实体边框 | `repeating-linear-gradient(45deg, … 1.5px, transparent 1.5px, transparent 10px)` + 1.5px `--drag-slot-edge` 边框，实测 `background-image` 与 `border-radius: 20px` 均生效 |
| 让位 | 被掠过的卡片连续滑开，不是瞬跳 | `before` 快照 → `cancel()` 前序动画 → 批量重排 → `newR` 读取 → `el.animate()`，`cubic-bezier(0.16, 1, 0.3, 1)` |
| 落位 | 飞卡回正、占位槽消失、目标卡片下移 | 欠阻尼解析解弹簧（`omega0 = 19.4`、`zeta = 0.727`、`omegad = 13.3`、380ms），末速度注入；`landing` 标志挡住落位期间的重绘 |

## 70 个 UI 套件的全矩阵结果

`scripts/m1/*-ui-test.js` 全部 70 个套件串行跑过（`artifacts/run-ui-matrix.ps1`，每个套件单独启一个 Electron，日志落 `artifacts/ui-matrix/`）。首轮 **65 通过 / 5 失败**。

这 5 个失败都用两棵基线树做过对照——`.claude/worktrees/base-5733ffe`（重构后）与 `.claude/worktrees/base-9054952`（重构前）——**两边同样失败，同一行同一断言**（其中 polish 在 9054952 上更早，停在 `:37`）。所以它们不是拖拽重构引入的，而是长期存在的既有失败。按用户要求一并修掉。

### 一处是产品缺陷，不是测试问题

`usage-functional-checks.js:103`「range change: reveal starts at the left edge」失败时 `end=0`：采样 1100ms 里 clip 宽度从 747 掉到 0 就再没回来。

临时插桩采样拿到决定性数据：`entries`（`data-enter-count`）全程不变，`docH`、`vis`、`opacity`、`paths` 都不变，但图的 `geo.top` 从 325 变 946（视口高 850），`scrollY` 从 1556 变 935——图在文档中的绝对位置恒为 1881（`1556+325 = 935+946`），**布局没动，是页面被程序性滚动了**。

根因在 `ui/src/pages/usage/index.tsx`。`held` 锚点记的是视口内的 `top`（点击时由 `remember()` 记下），随后的提交里用 `delta = 当前 top - 记录的 top` 去 `scrollBy` 补偿。但锚点**没记当时的 `scrollY`**，所以人（或测试）自己滚了页面之后，那个差值全是滚动造成的，补偿把页面拽回原处——用户的滚动被静默取消。图被推到视口外后，该 `dataKey` 的 IntersectionObserver 永远等不到「进入」回调，`plot.entered` 恒 false，`line-chart.tsx:37` 走 `reveal.jump(0)`，图就永久空白。

修法是锚点同时记 `scrollY`，提交前发现滚动过就丢弃锚点、不动页面：

```
const scrolled = Math.abs(window.scrollY - anchor.scrollY) > .5;
held.current = null;
if (scrolled) return;
const delta = anchor.element.getBoundingClientRect().top - anchor.top;
if (Math.abs(delta) > .5) window.scrollBy({ top: delta, behavior: "instant" });
```

这不是只影响测试的边角：「点一下卡片或标签、然后滚页面、内容一重绘就被弹回去」在真实使用中同样会发生。

### 另外四处是过期的断言

| 套件 | 过期原因 | 修法 |
| --- | --- | --- |
| `polish-ui-test.js:45` | 标题栏菜单在 `3fd146b`（2026-11-04）加了「显示 / 隐藏概要」（`src/quota/window-shell.js:16`），期望数组没跟 | 补进期望数组 |
| `unpriced-guidance-ui-test.js:23` | sources 卡新增「读取位置」`PillToggle` 也带 `aria-expanded`，与 issue 行的「收起」同时命中，触发 strict mode violation | 选择器收敛到 `[data-source-paths] button[aria-expanded="true"]` |
| `visual-ui-test.js:55` | 3 个窗口时 `quota-model.js:367` 按 `durationMins` 降序把最长的升为 meter、其余降到 subrow，卡面文案也从「待刷新」变成 `缓存已过期 · 请刷新` | 断言改为按 `aria-label` 取窗口读值，文案改用实际的 `缓存已过期 · 请刷新` |
| `activity-ui-test.js:48` | 第 45 行在日历渲染出 `[data-heat-key]` 之前就抓 `gridDates`，拿到 `[]` | 抓取前先 `calendarCells(page).first().waitFor()` |

修完五处后复跑，五个套件全部 exit=0。随后重跑了整个矩阵：**PASS=70 FAIL=0 TOTAL=70**。这一节的读数是当时的回执；`artifacts/` 不随仓库保留，`_summary.txt` 之后被后续轮次覆盖过，最新一次的回执见本文末「全矩阵回执（2026-11-17，第六轮）」。

## 复跑校验（全部通过）

| 门控 | 结果 |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run typecheck:ui` | exit 0 |
| `node --test tests/m1/ui-bundle.test.js tests/m1/ui-design-guard.test.js` | 7 项全过，`fail 0` |
| `npm run governance` | PASS：unified entry, frozen runtime, minimal dependencies, offline collector and independent keyring quota boundary |
| `npm run audit:runtime` | PASS：171 reachable product modules |
| `npm test` | 813 项全过，`fail 0`，exit 0 |
| UI 套件全矩阵 | PASS=70 FAIL=0 TOTAL=70 |

`node scripts/m1/audit-package.js "E:\TOKEN\Agent Usage Quota"` 仍然失败在 `Mismatch: design/desktop-reference/index.html`——实机包还是修复前的字节，这是预期的。按该脚本自身的口径（只走 `src/quota`、`src/m1`、`design/desktop-reference` 三个目录，加 `LICENSE`、`docs/m1/UPSTREAM.md`、`docs/m1/CODEX-QUOTA.md`，排除 `src/m1/crypto.js`、`serve.js`、`README.md` 三项）重算：**271 一致 + 6 不一致 = 277**，那 6 项正是本批动过的打包文件（`index.html`、`quota-card-grid.js`、`sources-model.js`、`tokens.css`、`agent-ui.css`、`agent-ui.js`），没有其他文件漂移。

## 重新出包与实机同步（2026-11-17）

`npm run build:ui` + `npm run dist:win:dir` 重新出包到 `dist/win-unpacked`（electron-builder 26.16.1，electron 43.4.0，`check-build-deps.js` 先确认 `node_modules` 是真目录、tokscale 4.17.0 哈希匹配）。

对**新包**跑 `node scripts/m1/audit-package.js`（默认目标就是 `dist/win-unpacked`）：

```
PASS: 277 source/assets/docs match ASAR byte-for-byte; runtime package metadata matches;
      unpacked tokscale 4.17.0 matches its pinned SHA-256.
```

把新包的 `app.asar`、`app.asar.unpacked`、`Agent Usage Quota.exe` 同步到实机目录 `E:\TOKEN\Agent Usage Quota`（覆盖前先备份旧 asar 与 exe 到 `E:\TOKEN\_backup-20261117-pre-quotadock-sync`，备份哈希已核对）。对**实机目录**再跑一次同样的审计，也是 `PASS: 277`。

两包差异经逐文件核对：3207 个文件里只有本批动过的 6 个大小不同，其余 3201 个字节相同，没有多出或缺失任何条目。asar 体积差异（48.7 MB vs 73.6 MB）来自旧包把 14 个 `asarUnpack` 原生文件同时打进了归档内，新包只留解包副本；`app.asar.unpacked` 两侧 14 个文件逐字节相同。实机目录里原有的 `app-update.yml`、`elevate.exe`、`app.asar.bak` 保持原样未动。

### 用打包后的应用实测这一处产品缺陷

`scripts/m1/*-ui-test.js` 支持 `QUOTA_PACKAGED_EXE`，把目标指向实机可执行文件即对发布产物验证：

| 套件 | 打包模式结果 |
| --- | --- |
| `functional-ui-test.js`（当初抓到空白的那个） | PASS，两档缩放，`trendAnimationFrames` 242 / 249（修复前是 0 帧），`chartReused: true` |
| `quota-v4-ui-test.js` | PASS |
| `quota-cards-ui-test.js` | PASS |
| `overview-ui-test.js` | PASS |
| `widgets-ui-test.js` | PASS |
| `interaction-reliability-ui-test.js` | PASS，含 scroll interruption |

`trendAnimationFrames` 从 0 变成 242/249 是这一处缺陷被修掉的直接证据：reveal 动画重新逐帧运行，趋势图不再空白。应用本身也正常启动，窗口标题 `QuotaDock · 额度台`。

## 未执行

- 已按项目负责人的明确许可合入本地 `main`（`f937681`，`--no-ff`，保留为独立合并提交）；合并后 `main` 上复跑 `lint`、`typecheck:ui`、813 项单测、`audit:runtime` 171、`audit-package` 277（`dist` 与实机目录两侧）全部通过。**未推送到远程**，`origin/main` 仍停在 `4d011eb`。
- 未做减少动态效果下的肉眼观感确认（套件已覆盖 `reduced`/`off` 的状态断言，但没有人工看片）。
- 未重新生成 NSIS 安装包（`dist:win:setup`），本次只出 dir 包；也未经由安装器升级实机，是把产物直接同步到现有安装目录。

## 小组件：非编辑态就能拖动，编辑态工具行对齐（2026-11-17）

两处都是用户看实机后提的，改动都在 `ui/src`，产物同步重出并热载入实机。

### 编辑态工具行没对齐

原因不是间距，是按钮宽度被内容撑开。`ui/src/kit/widgets.tsx` 的 `WidgetTool` 原来写 `h-6 min-w-6 … px-2`，于是字母 `S`/`M`/`L` 的字形宽度和 12px 图标各自决定按钮宽度。实测量到的宽度是 24 / 26.16 / 24 / 28 / 28 px，高度都是 24 —— 六个按钮中线与高度本来就齐，只有宽度不齐。

改成 `h-6 w-6 shrink-0 … p-0`（去掉 `min-w-6 px-2`），让工具按钮一律 24×24。重建后实测六个按钮全部 24×24。

### 非编辑态不能拖动

起因是 `WidgetBoard` 在非编辑态渲染的是普通 `div`，`Sortable` 只在编辑态挂载。现在始终渲染 `Sortable`，并给它两个新开关（`ui/src/kit/sortable.tsx`）：

- `eager`：非编辑态下，按住到 `delay` 或移动超过 `DRAG_SLOP` 都能拾起，不必先按满长按时长。
- `focusable`：只有编辑态把列表项放进 tab 序，非编辑态不额外增加 tab 停留点。

`ui/src/pages/widgets/index.tsx` 对应改为 `eager={!editing} immediate={editing} focusable={editing}`，两种状态的拖动走同一套手势与同一套落位动画。

点击行为没变：`Sortable` 只在真正拖动后抑制这一次点击，`WidgetCard` 仍然在 `closest(INTERACTIVE)` 命中时不抢点击，所以轻点小组件依旧打开它对应的页面。

### 实测证据

`artifacts/verify-widget-drag.js`（源码模式与实机包两种口径）：

| 检查 | 结果 |
| --- | --- |
| 非编辑态（`data-editing` 为 null）按住 420ms 后拾起 | `pickedAfterHold = w1` |
| 拖到第三位后顺序 | `w1 w2 w3 w4` → `w2 w3 w1 w4` |
| 不按住、只快速移动就拾起 | `pickedOnMove = w2`，顺序随之改变 |
| 轻点小组件 | 仍跳到 `usage` 页，顺序不变 |
| 编辑态六个工具按钮宽度 | 全部 24×24 |

`node scripts/m1/widgets-ui-test.js` 仍然 PASS（编辑态、库、设置、读值、保存布局）。headless 门控同批复跑：lint、`typecheck:ui`、bundle 与 design-guard 7 项、`npm test` 813 项、governance、`audit:runtime` 171 模块全部通过。

出包与热载入：`npm run dist:win:dir` 后 `audit-package` 对 `dist` 与实机目录两侧都是 `PASS: 277 source/assets/docs match ASAR byte-for-byte`；覆盖前把旧 `app.asar` 与旧 exe 备份到 `E:\TOKEN\_backup-20261117-102841-widget-drag`，新 asar 哈希 `5B8F1102…`、新 exe 哈希 `37ED51BE…` 两侧一致。

## 拖完的卡片粘在屏幕上（2026-11-17）

用户报的现象：松手后卡片会「固定死在当时位置几秒，直到自刷新」，期间滚轮移动界面时卡片粘在屏幕上不动；后续复查又指出**下方额度卡有同样的问题**，并且小组件「还是有轻微的粘手」。

### 复现

先按无条件路径复现（`artifacts/probe-stuck.js`：4 个小组件、不滚动、拖完采样再滚 300px）是干净的：飞卡只存在 11 帧，落位后 `flying=false`，卡片随文档滚走（`top` 214 → −86）。所以缺陷是条件触发的，条件就是**落位期间滚动页面**。

`artifacts/probe-glue.js` 用页面内 rAF 逐帧采样，量到修复前的真实窗口：

| 场景 | 飞卡存在时长 | 滚动期间卡片在视口中的位置 |
| --- | --- | --- |
| 普通松手落位 | 773 ms | — |
| 落位中途滚 300px | 737 ms | `flyingTop` 恒为 213/214（`scrollY` 已到 300） |
| 整个落位期间滚轮到 660px | 772 ms | `flyingTop` 恒为 214（`scrollY` 已到 660） |

也就是说，卡片确实钉在屏幕上，而占位槽随文档走了几百像素。

### 原因

两条叠在一起：

1. 飞卡层是 `position: fixed`，`left`/`top` 取的是**拾起时**的视口坐标，而 `x`/`y` 只是拖拽位移。占位槽在文档坐标里，落位期间滚动时两者朝相反方向分开，弹簧又只把卡片收敛到「占位槽当时的视口差值」，于是卡片停在一个占位槽早就离开的位置。
2. 落位窗口过长。Motion 的欠阻尼弹簧会一直积分到尾段完全静止才 resolve，实测 773 ms；原生卡片网格（`design/desktop-reference/quota-card-grid.js` 的 `settleFrame`）是解析解并在 380 ms 截断。

顺带排除掉两个不成立的猜测：`settling` 会在 cleanup 后永久卡死（`artifacts/probe-repick.js` 证明二次拾起正常，`picked` 能拿到、`blockedBy` 为 null），以及指针捕获泄漏。

### 第一版修法（不够）

`ui/src/kit/sortable.tsx` 加 `scrollX`/`scrollY` 两个 motion value，飞卡改用 `x: flyingX, y: flyingY`（`useTransform(() => x.get() + scrollX.get())`），落位期间监听 `scroll`（`{ passive: true, capture: true }`，因为 `scroll` 不冒泡）写入取反的滚动位移；`ui/src/design/motion.ts` 的 `dragSpring`/`dragSettle` 各加 `restDelta: 0.5, restSpeed: 2` 收尾。落位窗口 773 ms → 486–521 ms，卡片跟着文档走了。

但用户复测仍然「轻微粘手」：**监听 scroll 再每帧改 transform，注定落后合成器一帧**。`artifacts/probe-landing-lag.js` 在 7px/帧的慢速滚动下量到最大 −1.1px 的逐帧滞后，而真实滚轮一档约 60px/帧（是探针的 8.5 倍），一帧的滞后就成肉眼可见的粘手。补偿这个方向本身有上限，只能逼近、不能归零。

### 最终修法：把飞卡交给文档搬运

改结构而不是改补偿：**拖拽时 `fixed`，一松手切成随文档定位**。指针活在视口空间，所以握在手里时保持 `fixed` 可以让卡片零算术跟手；松手之后卡片的归宿是文档里的一个槽位，就该让浏览器搬运它——页面滚动时飞卡与占位槽被同一次合成一起移走，弹簧只需要收敛两者之间那点差值，不需要任何滚动补偿。

- `ui/src/kit/sortable.tsx`：新增 `landing` 状态（`{ left, top } | null`），记录**文档坐标**的起点。`finish()` 里在同一个 commit 内 `setLanding({ left: originSlot.left + window.scrollX, top: originSlot.top + window.scrollY })`，与 `setSettling(true)` 同批，所以换参照系的瞬间视觉位置不变（文档位置 = 视口位置 + 滚动量）。飞卡 `className` 随 `landing` 在 `pointer-events-none fixed` 与 `pointer-events-none absolute` 之间切换，`left`/`top` 用 `landing ?? heldSlot`，`x`/`y` 恢复为纯拖拽位移（`flyingX`/`flyingY` 与 scroll 监听全部删除）。落位目标改为在图层自己的空间里只读一次：`placeholderRect.left + window.scrollX - landing.left`——松手到测量之间发生的滚动已经同时进入这两个数，不需要另算。`!full` 分支与动画完成回调都清 `landing`。
- `ui/src/theme/app-layout.css`：删掉 `#quotaCards .quota-card.is-flying` 上的 `position: fixed !important`。位置由脚本按阶段给（`fixed` 跟手 / `absolute` 落位），`!important` 会静默压掉第二阶段，正是额度卡粘屏的原因。
- `design/desktop-reference/quota-card-grid.js`（原生网格，用户指出的「下方额度读取」）：`drop()` 里同样在算完 `targetDx/targetDy` 之后把 `moving.style.position` 从 `fixed` 换成 `absolute`，`left`/`top` 换算成网格坐标（`originLeft - gridRect.left`，`originTop - gridRect.top`）。这里不能直接用文档坐标：`#quotaCards` 是 `position: relative`（`app-layout.css:1231`），飞卡的包含块就是它；`artifacts/probe-card-chain.js` 确认整条祖先链里只有网格自己是定位元素，其余 `static`、无 `transform`/`filter`/`contain`、`overflow: visible`，滚动容器是文档本身（没有内部滚动容器）。

### 修后实测

`artifacts/probe-sticky-hand.js` 用页面内 rAF 逐帧采样，判据看**飞卡与它自己占位槽之间的间隙**：两者同在文档里，文档锚定的飞卡会让间隙连续收敛，而钉在视口上的飞卡会让间隙在一帧内跳掉整个滚动量。滚动放在 380/500 ms 落位的尾段施加，此时弹簧几乎静止，间隙的跳变只可能来自粘手而不是物理。

| 实现 | 滚动帧数 | 间隙最大跳变 | 滚动时的定位 | 落位后残留飞卡 |
| --- | --- | --- | --- | --- |
| 额度卡（原生网格） | 6（60px/帧） | **0 px** | `absolute` | 0 |
| 小组件（React） | 6（60px/帧） | **0 px** | `absolute` | 0 |

同一脚本用 `QUOTA_PACKAGED_EXE` 指向实机安装目录的 exe 复测：两处同样 **0 px**、残留飞卡 0、`repickWorks: true`（落位没卡死，二次拾起正常）、`errors: []`。

### 门控与出包

- headless 全过：`npm run lint`、`npm run typecheck:ui`、bundle 与 design-guard 7 项、`npm test` 813 项、`governance`、`audit:runtime` 171 模块。
- 相关 UI 套件全 exit=0：`quota-v4-ui-test`、`quota-cards-ui-test`、`widgets-ui-test`、`overview-ui-test`、`interaction-reliability-ui-test`、`ui-motion-mode-ui-test`。
- `npm run dist:win:dir` 后 `node scripts/m1/audit-package.js` 对 `dist` 与实机目录 `E:\TOKEN\Agent Usage Quota` 都是 **PASS: 277**。实机 asar SHA-256 `3024EE5166A88FDCF09C917232E448BD268DBAA7ACEBC6D49565A8DB2324B489`，exe `29091324E8242739C350E2EDEC177A9C419A92ED43E5D406F111D065D7ABF706`；覆盖前备份在 `E:\TOKEN\_backup-20261117-114003-sticky-hand`（旧 asar `C392C94F…`）。启动正常，窗口 `QuotaDock · 额度台`。
- 提交 `cbabbaa`。

## 独立验收报告（2026-11-17）：CONDITIONAL 的六项修复

`artifacts/verify-report-20261117.md`（257 行，独立会话产出）对 `8d04231` 给出 **【有条件通过 · CONDITIONAL】**，无 P0。用户四件事全部实测通过（飞卡 `scale 1.025` + 1.25° 侧倾、45° 斜纹占位槽两套主题、FLIP 让位 14 个动画帧、落位过冲后收敛、非编辑态按住与快速移动都能拾起且轻点仍开页面、工具行 `firstKidDeltaFromContentLeft: 0` / `lastKidDeltaFromContentRight: 0`），粘手与滚动锚点也各有基线对照（`packaged-hand.js` 本分支 0 帧 fixed / 基线 `5733ffe` 6 帧全粘；`drift` 本分支 0 / 基线 +1078 与 +1174）。

报告点出的六项按条修：

| 编号 | 问题 | 修法 |
| --- | --- | --- |
| P1-1 | 「减少动态」与「关闭动效」下小组件仍缩放 1.025、仍侧倾（原生卡片同条件已归零） | `sortable.tsx` 的 `scale.set(full ? 1.025 : 1)`、`rotate.set(full ? tiltSmooth.current : 0)`、`targetTilt` 三处都加 `full` 门控 |
| P1-2 | 落位期间父组件重渲染会重启落位弹簧（实测 539 → 666 → 740 ms，并有 2.7px 回退） | 落位 effect 的 deps 去掉 `onReorder`、改走 `reorder` ref；`landing` 也移出 deps（每次 release 只设一次、只读），于是只有 `release` 与动效模式才是真重启 |
| P1-3 | 文档写「矩阵 PASS=70」而 `_summary.txt` 仍是 65/5，回执自相矛盾 | 重跑整矩阵并确实落盘，见下方「全矩阵回执」 |
| P1-4 | 粘手没有自动化回归测试，证据只在 gitignore 的 `artifacts/` | 新增 `scripts/m1/drag-landing.js`，接进 `widgets-ui-test.js` 与 `quota-v4-ui-test.js`（`fixedScrollFrames === 0`、`worstGapJumpPx <= 1`、无残留飞卡） |
| P1-5 | 滚动锚点同样没有自动化回归测试 | `usage-functional-checks.js` 末尾新增 drift 断言（`\|drift\| <= 1`），并实测变异：把修复改回 `const scrolled = false` 后既有断言 `reveal starts at the left edge` 立刻失败 |
| P2-1…7 | 死类型 `targetCoords`；三处 INTERACTIVE 早退选择器不一致；`dist > 6` 与 `DRAG_SLOP = 8` 不一致；深色未复述 `--drag-*` 时长 token | 删死类型；`INTERACTIVE` 改为 `sortable.tsx` 单一导出、`widgets.tsx` 改为 import、原生网格补齐同样选择器；深色块复述三个时长 token（值不变） |

P2-3（`thrown.current` 在 effect 重跑时未清零，松手初速度被再施加一次）与 P1-2 同源：落位 effect 里取出 `{ x: vx, y: vy }` 后立刻 `thrown.current = { x: 0, y: 0 }`，速度只注入一次。

新增回归测试的实际读数：

| 套件 | 证据 | 读数 |
| --- | --- | --- |
| `widgets-ui-test` | `artifacts/ui-widgets/landing-scroll.json` | `frames 147`、`scrollFrames 6`、`worstGapJumpPx 0`、`fixedScrollFrames 0` |
| `quota-v4-ui-test`（100% 与 150%） | 各自 `landing-scroll.json` | `worstGapJumpPx 0`、`fixedScrollFrames 0` |
| `functional-ui-test`（100% 与 150%） | `scroll-anchor-<scale>.json` | `anchored.drift 0`、`kept.drift 0` |

### 一处由本次改动暴露的测试选择器冲突

`ui/src/pages/widgets/index.tsx` 改成「非编辑态也渲染 `Sortable`」之后，应用自己的小组件看板也开始输出 `[data-sortable]`（`artifacts/probe-sortable-count.js` 实测：挂载前文档里就有 1 个，`case` 为 `(app)`）。`scripts/m1/ui-mkb-gallery-motion.js` 的三处守卫用的是文档级 `document.querySelector('[data-sortable]')`，于是拿到的是应用看板而不是 gallery 自己的列表，等待 `data-picked === 'a'` 必然超时。

修法是把这三处收窄到 gallery 自己的示例容器：`document.querySelector('[data-mkb-case="sortable"] [data-sortable]')`。改后 `ui-mkb-gallery-ui-test` 两种主题都 PASS。这属于测试隔离问题，不是产品缺陷；产品侧「非编辑态也能拖动」本身是用户要求的。

### 全矩阵回执（2026-11-17，第六轮）

`& .\artifacts\run-ui-matrix.ps1`（必须直接调用；用 `powershell -File` 会因 PowerShell 5.1 的差异得到 `PASS=0 FAIL=0 TOTAL=0`）的结果：**PASS=68 FAIL=2 TOTAL=70**。

| 失败套件 | 位置 | 定性 |
| --- | --- | --- |
| `reader-window-ui-test.js` | `:167` `opening a folded process grows the turn that was opened` | 单独重跑 `checks: 28, failed: 0`，exit 0 |
| `session-reader-ui-test.js` | `:314` `the turn is at the top of the page` | 单独重跑 PASS，exit 0 |

两者都不是本次改动引入：`git diff --numstat 5733ffe..HEAD` 里既没有 `ui/src/pages/reader`、`ui/src/pages/sessions`，也没有这两个测试文件本身（输出为空）。它们是连续跑 70 个窗口时对加载敏感、单独跑就过的偶发失败——本文件前面记录过 `interaction-reliability` 与 `ui-mkb-gallery` 有同类历史，`docs/m2/HANDOFF-READER-NEXT-20261104.md:67` 也记过 `functional-ui-test` 在连续跑批里 9 次过 6 次。矩阵这一轮没有做到 70/0，此处如实记录，不用单独复跑的结果替代整矩阵的回执。

### 出包与实机同步（按报告的修复之后）

- `npm run build:ui`：`agent-ui.css` 193.84 kB、`agent-ui.js` 1,366.69 kB（只有 js 变了，css 字节未变——这次修的全是行为，没有视觉改动）。
- headless 全过：`lint`、`typecheck:ui`、bundle 与 design-guard 7 项、`governance`、`audit:runtime` 171、`npm test` 813 项。
- `npm run dist:win:dir` 后 `node scripts/m1/audit-package.js` 对 `dist` 与实机目录 `E:\TOKEN\Agent Usage Quota` 都是 **PASS: 277**。
- 实机同步：备份到 `E:\TOKEN\_backup-20261117-181500-verify-fixes`（旧 asar `3024EE51…`、旧 exe `29091324…`）；新 asar SHA-256 `8C9FC483C699A3EB67E9B7B7CD59DA501ED78AC860D3AB52E5AB3A90022C8CBA`，install 与 `dist` 两侧完全一致，exe 同样一致。启动正常，窗口 `QuotaDock · 额度台`。
- 对**实机安装目录的** exe 复测：`artifacts/probe-sticky-hand.js` 判 `CLEAN`（cards `worstGapJumpPx 0.1`、widgets `0`、`leftoverFlying` 均 0、`repickWorks: true`、`errors: []`）；`widgets-ui-test` PASS（文案含 `released widget travels with the page`）、`quota-v4-ui-test` 两档都 PASS。


