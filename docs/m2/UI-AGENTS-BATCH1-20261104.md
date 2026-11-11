# 七个新 Agent 接入界面 · 2026-11-04

所有者要求把 Codex 做好的新 Agent 后端接到界面上。后端合同见 `AGENT-BATCH1-CONTRACT-20261102.md`、`AGENT-BATCH1-EXTRA-20261102.md`。本次把 `codex/agents-batch1-20261102` 合入，并只改表达层。只用合成数据，源码模式。

## 合并

`AGENTS.md` 两边都是新增，都保留。`src/m1/sources.js` 保留 main 的循环变量名和 Codex 的 Copilot 区间处理。后端逻辑没有改。

## 界面

| 位置 | 做法 |
|---|---|
| 配色 | 七个新 `--agent-*`（`--series-*` 是别名），沿用色板 C 的等明度（浅色 L≈0.645，深色 L≈0.78）。十七种颜色放不进一圈高饱和色相，所以五个用较低的彩度（C≈0.09）拉开距离，两个用 C≈0.155。颜色只表示是哪个 Agent |
| 图标 | **还不是官方 logo。** 目录里是通用网格，七个一样，筛选栏分不出。所以暂时显示该 Agent 颜色的圆点，没有自己画标志。下载官方 logo 要所有者同意 |
| 来源卡 | 没有“管理”按钮，也不显示额度和程序状态，因为这些来源没有登录、安装和额度路线。开关和读取位置保留 |
| Continue | 后端把它标成客户端估算。卡片原本会说“记录本身不完整，无法修复”，这是错的，改成“用量是客户端估算，不是实际计量”，并说明没算进费用 |
| 诊断文案 | 补上 `SOURCE_USAGE_ESTIMATED`、`SOURCE_FORMAT_UNSUPPORTED`、`COPILOT_SOURCE_MODE_CONFLICT` |
| 用量、费用、会话、小组件 | 走现有数据和筛选，加上颜色后不用改。没有开放阅读和恢复 |

Copilot 的记录是模型关闭区间，不是请求数。界面只说“条记录”，没有说成调用次数，所以没有改。

## 验证

新增 `scripts/m1/agents-batch1-ui-test.js`：在合成主目录写七个来源的文件，由真实采集线程读取，再检查来源卡、两种主题的颜色、概览没有额度卡、安装计划、用量筛选。

| 项 | 状态 |
|---|---|
| `npm run verify`（fail 0）、`npm run audit:runtime` | 通过；第一轮有 1 个 lint 错误（新脚本重复声明全局变量），修好后通过 |
| `agents-batch1`（新增） | 通过；开发时失败过几轮，一部分是测试等错了条件，也由此发现了 Continue 的错误文案和“额度尚未接入”两处产品问题 |
| `sources-cards`、`usage-smoke`、`cost-smoke`、`overview`、`widgets`、`sessions`、`agent-install`、`app-shell`、`provider-quota` | 通过 |
| `source-quota`、`agent-setup`、`workbench` | 第一轮失败，都是测试把来源数写死成旧值（10 或 11）。改成 17 或 18 后通过 |
| `sessions-reader-extras`、其他 UI 套件 | 未运行；这次没有改阅读页。上一轮不稳定的原因仍未查明 |
| 打包验收、真实记录、内存 | 未执行 |

## 还不知道

- **真实格式：** 没有用真实记录核对。公开源码核对过的格式，不等于用户机器上的版本都能读。
- **打包、内存：** 未执行。来源从十个变成十七个，采集和内存的影响没有测量。
- **GitHub Copilot 的范围：** 只有 CLI 的本地记录，不包括 IDE 和云端，也不是账号用量。
