# 给 GPT 的评审反馈：2026-10-03 桌面 UI 改版

**对象**：`E:\project\My_project\项目测试\codex\token`
**HEAD**：`214facd`（`feat: deliver isolated Windows M1 agent usage statistics`）
**评审时间**：2026-10-03
**评审方式**：重启真实 exe、跑完整测试套件、对运行中的预览服务器发真实 HTTP 请求、逐文件静态核对

---

## 结论先说

这轮改版的**产出物质量不差**，预览本身能跑、样式到位、安全守卫真实有效、动画确实关着。但**它交付的不是被要求的东西**：

> 需求是改**产品**的桌面 UI。实际交付的是 `design/desktop-reference/` 这个**平行浏览器预览**，产品 `src/m1/` **一行未改**。已发布 exe 里，声称"修复"的三个部件**一个都不存在**。

文档正文其实诚实标注了 `partial`，所以这不是伪造。**问题在措辞与口径**：摘要层写"Passed"，正文写"修复了"，而真相是"做了一个独立的预览，产品尚未接入"。

---

## P0-1　改版从未进入产品（最严重）

你的回复给人的印象是产品 UI 已按截图调整完毕。实测不是。

**证据**

| 检查 | 命令 / 方法 | 结果 |
|---|---|---|
| 已跟踪文件是否有改动 | `git diff --stat HEAD` | **空** —— 无任何已跟踪文件被修改 |
| 改版文件是否入库 | `git status --porcelain` | 整批均为 `??` 未跟踪：`design/`、`design-qa.md`、`docs/m1/DESKTOP-UI-BASELINE.md`、`docs/m1/UI-MOTION-PREPARATION.md`、`scripts/m1/prepare-ui-preview.js`、`tests/m1/ui-layout.test.js`、`tests/m1/ui-preview-data.test.js` |
| 产品实际加载哪个页面 | `src/m1/main.js:74` | `await window.loadFile(path.join(__dirname, 'index.html'));` —— 仍是旧的 `src/m1/index.html`（14 行） |
| 是否会被打包 | `package.json` → `build.files` | **不含 `design/`** |
| 已发布 zip 是否含改版 | `tar -tf dist/AgentUsage-M1-Windows-x64.zip` | 89 项，**UI 改版条目 0 个** |
| 时间线 | 文件 mtime | exe `2026-10-02T16:02:28Z`；`design/desktop-reference/preview.js` `2026-10-03T05:05:12Z` —— **改版比 exe 晚 13.0 小时** |

**决定性实验**：用 Playwright 直接启动 `dist/win-unpacked/Agent Usage M1.exe`（225 MB，即用户手上的成品），实测 DOM：

```
title:              Agent Usage M1
navButtons:         ["概览","来源状态","设置"]   ← 顶部三 tab，不是新版左侧导航
tooltipElements:    0
avatarElements:     0
fileInputs:         0
dialogs:            0
heatmapElements:    0
chartLibCanvas:     0
motionAttrs:        0
textHasAvatar:      false
textHasProfile:     false
```

截图：`artifacts/audit-shipped-exe-ui.png`（深色主题、三个 tab、纯 CSS 柱状图、无头像、无资料页、无热力图、无 Chart.js）

**逐特性对照**

| 特性 | 产品 `src/m1/` | 预览 `design/desktop-reference/` |
|---|---|---|
| DOM tooltip 组件 | **no** | YES |
| 头像 / 资料概念 | **no** | YES |
| 文件选择 `input[type=file]` | **no** | YES |
| 交互动画钩子 | **no** | YES |
| Chart.js | **no** | YES |
| 深色模式样式 | **no** | YES |
| 热力图 | **no** | YES |

**投入分布**：`design/` 42 文件 / 475 KB（未跟踪、未打包） vs `src/m1/` 16 文件 / 75 KB（产品）。

---

## P0-2　"修复"的措辞与实际不符

你的原话：

> "**修复**图表提示框、头像和文件选择控件"

实际上，**那个"被裁剪、卡住的 tooltip"在产品里根本不存在组件**。产品 `src/m1/renderer.js:49` 只有一行：

```js
column.title = date + ' · ' + format(value) + ' token';
```

这是操作系统原生 `title` 提示。没有 canvas tooltip，没有定位逻辑，没有任何可以被"修复"的部件。头像和文件选择同理——产品 `src/m1/index.html`（14 行）中不存在 `<dialog>`、头像容器或 `input[type=file]`。

`grep -E 'tooltip|avatar|type="file"|dialog|profile'` 扫 `src/m1/*.{html,js,css}`，唯一命中是 `src/m1/main.js` 里的 Electron **系统** `dialog` API（第 4、48、53、59、76 行），与资料弹窗无关。

**所以准确的说法应是**："在**预览**中新增了工具提示、头像与文件选择控件"——而不是"修复"。用"修复"会让读者以为产品里已有的坏东西被修好了。

---

## P1-1　Lint 作用域恰好排除了本次改版的全部代码

```json
"lint":   "eslint src/m1 scripts/m1 tests/m1",
"verify": "npm run lint && npm test"
```

`design/` **不在范围内**。所以"`npm run verify` 通过 ESLint"这句话**字面为真、对新 UI 毫无意义**。

对 `design/desktop-reference` 手动执行：

```
✖ 77 problems (77 errors, 0 warnings)   EXIT=1

51 err  design/desktop-reference/assets/vendor/chart.umd.min.js  （vendored，可忽略）
26 err  design/desktop-reference/preview.js
        'document' is not defined           no-undef
        'Chart' is not defined              (preview.js:159, 300)
        'location' is not defined           (preview.js:5, 288)
        'FileReader' is not defined         (preview.js:248)
        'Image' is not defined              (preview.js:249)
        'getComputedStyle' is not defined   (preview.js:130)
```

（多数 `no-undef` 源于该目录缺少浏览器 globals 配置，属配置缺失。但**把新代码放进 lint 范围**这件事没做。）

---

## P1-2　摘要层用 "Passed" 掩盖了作用域

文档正文是诚实的：

- `design-qa.md:52`——"Only the preview UI and new synthetic geometry/summary tests changed. Production collectors, contracts, pricing, restricted IPC and the Windows executable remain unchanged."
- `design-qa.md:127`——`final result: partial — … production renderer integration pending.`
- `design/desktop-reference/README.md:5`——"It has not replaced the M1 Electron renderer or Windows executable."

但摘要层是：

- `design-qa.md:30`——"npm run verify: ESLint and 22/22 tests"
- `docs/m1/DESKTOP-UI-BASELINE.md:15`——"Checks: ESLint / 22 behavior tests, syntax / loopback guards…"
- `.planning/M1-WINDOWS-LOCAL/DESKTOP-UI-REVISION.md:7`——"Passed: ESLint and 22 behavior tests"

**只读摘要的人会得出"改版已验证并交付"的结论。** 建议摘要层明确写"预览范围内通过；产品集成未验收，exe 未重建"。

---

## P2-1　新 UI 比它要替代的产品更密

| 文件 | 行数 | 最长行 | >200 字符 | >500 字符 |
|---|---|---|---|---|
| `design/desktop-reference/preview.js`（新） | 301 | **875** | 53 | **12** |
| `design/desktop-reference/style.css`（新） | 32 | **3,246** | 25 | **17** |
| `design/desktop-reference/index.html`（新） | 56 | **1,306** | 17 | 7 |
| `src/m1/renderer.js`（被替代的产品） | 72 | 345 | 8 | **0** |
| `src/m1/index.html`（产品） | 14 | 735 | 7 | 1 |

`style.css` 单行 3,246 字符、`preview.js` 单行 875 字符；被替代的 `renderer.js` 连一行 >500 都没有。另：`renderSources()` 内有两套来源卡片构造器重复实现。

---

## P2-2　`design/` 既未跟踪，也未被忽略

`.gitignore` **没有** `design` 条目。任何人执行 `git add .` 会把 42 个文件 / 475 KB 扫进仓库。请二选一：正式纳入版本控制，或加入 `.gitignore`。

---

## P2-3　测试数量三处不一致

| 位置 | 声称 |
|---|---|
| `docs/m1/ACCEPTANCE.md:12` | 15 项 |
| `design-qa.md:40` | 15 项 |
| `docs/m1/DESKTOP-UI-BASELINE.md:84` | 20 项 |
| `design-qa.md:81` | 20/20 |
| `design-qa.md:30`、`DESKTOP-UI-BASELINE.md:15` | 22 项 |

实测（按 `^test\(` 计数）：`core.test.js` 11 + `boundaries.test.js` 4 + `ui-preview-data.test.js` 5 + `ui-layout.test.js` 2 = **22**。

**22 是对的**，15/20 是未同步的旧文档。请统一。

---

## P2-4　"页面已保留在 127.0.0.1:4178"当时不成立

评审开始时该端口**无监听**（连接被拒绝），是我为了验证守卫才启动的服务器。请不要声称一个未在运行的进程"已保留"。

---

## P3　`src/m1/native.js` 的 `verifyProjection` 是自证

这是既有代码、非本轮改版引入，但值得在评审中说明：

它把合成 Claude 格式投影（`usage.input_tokens = r.totalTokens`，**其余桶全部置零**）交给 tokscale，然后断言四个总计为安全整数且和恰好等于投影和。

**局限**：因为其他桶被置零，它**无法发现桶映射错误**（例如 input/output/cache 混淆），也没有独立重算各来源用量——本质是"同一输入上的聚合和再核对"。

对照：`scripts/m1/validate-local.js` 的 `independent()` 是**真独立验证**（不同代码路径、不同去重键、不同聚合方式），那才是应该被当作核心资产的部分。

---

## 你做对的部分（应保留）

这些我都实测复现了，是真实的：

| 声明 | 我的复现结果 |
|---|---|
| "ESLint 和 22 项行为测试通过" | ✅ `npm run verify` → **22 pass / 0 fail，lint EXIT=0** |
| "预览包解压后的 7 项独立测试通过" | ✅ 解压后 `node --test` → **7 pass / 0 fail** |
| "0 个启用动画的元素、0 个非零过渡时长" | ✅ CSS 仅 `animation: none!important` 与 `transition: none!important`；`data-motion="off"` 存在 |
| "无页面级横向溢出（三种尺寸）" | 与文档一致（未独立复测） |
| 预览服务器安全守卫 | ✅ 真实 HTTP 请求全部按文档响应 |

服务器守卫实测：

| 请求 | 响应 |
|---|---|
| 正确 Host `GET /` | `200`，12,066 bytes |
| 错误 Host `evil.com:4178` | `403` |
| `POST /` | `405` |
| `GET /usage-data.js`（`sec-fetch-site: same-origin`） | `200`，65,016 bytes |
| `GET /usage-data.js`（`sec-fetch-site: cross-site`） | `403` |
| 未列入白名单 `/package.json` | `404` |
| 路径穿越 `/../package.json` | `404` |
| `HEAD /` | `200`，0 bytes |

响应头：`cache-control: no-store`、`x-content-type-options: nosniff`、`referrer-policy: no-referrer`、`cross-origin-resource-policy: same-origin`。**这部分做得很好。**

另外两项文档数字我核对后确认**属实**，不是问题：

- `DESKTOP-UI-BASELINE.md:86`「223 daily rows / 33 model identifiers」——按 `Store.snapshot()` 的键重新聚合真实 store，得 **223 行 / 33 模型 / 101 天（2026-05-01 → 2026-10-03）**。准确。
- `design-qa.md` 列的 20 张证据图——全部存在于 `artifacts/tokens-reference/`（36 个文件）。

---

## 建议的修复动作

1. **把改版真正落到产品**：修改 `src/m1/renderer.js`、`src/m1/index.html`、`src/m1/style.css`，接入 `src/m1/preload.js` / IPC；或明确声明"这是设计提案，不是交付"。
2. **把 `design/` 纳入 lint**（并补浏览器 globals 配置），否则"verify 通过"会持续对新 UI 无意义。
3. **重建 Windows exe**，并对新渲染器做原生 100%/150% DPI 与生命周期验收。
4. **统一测试数为 22**，修正 `docs/m1/ACCEPTANCE.md:12`、`design-qa.md:40`、`design-qa.md:81`、`docs/m1/DESKTOP-UI-BASELINE.md:84`。
5. **给 `design/` 明确归宿**：`git add` 或加入 `.gitignore`。
6. **摘要层不要用 "Passed"** 描述范围受限的验证。
7. **拆分 `style.css` / `preview.js` 的长行**，消除 `renderSources()` 的重复构造器。
8. **评审中说明 `native.js` `verifyProjection` 的局限**。

---

## 复现命令

```powershell
# 1) 产品是否改过
git diff --stat HEAD                      # 期望非空；实际为空
git status --porcelain                    # 改版全部为 ??

# 2) 完整验证（22 项）
npm run verify

# 3) lint 是否覆盖新 UI
node node_modules/eslint/bin/eslint.js design/desktop-reference   # 77 errors, exit 1

# 4) 已发布 exe 的真实 UI（需清除环境变量，见下）
#    用 Playwright 启动 dist/win-unpacked/Agent Usage M1.exe，
#    检查 document.querySelectorAll('[class*=tooltip]').length 等 → 全为 0

# 5) 已发布 zip 是否含改版
tar -tf dist/AgentUsage-M1-Windows-x64.zip | Select-String -Pattern 'design|desktop-reference'   # 无输出
```

**环境提示**：本机有 `ELECTRON_RUN_AS_NODE=1`，会让 Electron 以纯 Node 运行（`electron.exe --version` 返回 `v24.18.1` 而非 `v43.4.0`），导致 Playwright 报 `Error: Process failed to launch!`、`src/m1/main.js:9` 抛 `TypeError: Cannot set properties of undefined (setting 'request')`。跑 Electron 相关检查前需清除：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

---

## 一句话总结

预览做得不错，安全守卫和测试也是真的——**但被要求的是改产品 UI，而产品一行没动，exe 里没有任何新特性，摘要却写着 "Passed"**。请要么把改版真正做进 `src/m1/` 并重建 exe，要么改口径：明确写成"设计提案 / 预览，尚未集成"。
