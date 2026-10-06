# 内置定价快照与构建期同步

本文件记录 `src/m1/prices.json` 这份内置价格表从哪里来、如何更新、如何校验。它是
[docs/m1/USAGE-PRICING-20261003.md](USAGE-PRICING-20261003.md) 定价合同在“价格从哪来”这一侧的补充。

## 链路

```
fetch (人工 / CI，唯一需要网络的步骤)
  -> research/agent-usage/pricing/openai-pricing-20261004.md       官方定价页的 Markdown 快照，随源码一起审阅
  -> node scripts/m1/pricing-sync.js
  -> src/m1/prices.json             随包发布的运行时目录
```

取数放在此构建期脚本之外；脚本不需要网络，重新生成从已审阅的字节复现。桌面运行期公共价格同步见 [桌面功能合同](../m2/DESKTOP-FUNCTIONAL-20261004.md)。
`scripts/m1/pricing-sync.js` 只 require `node:fs`、`node:path`、`node:crypto`，不发任何请求。
`scripts/m1/` 不进交付包，`src/m1/prices.json` 进包，因此用户侧只拿到结果。

## 命令

```powershell
npm.cmd run pricing:check          # 只读校验：快照与出货目录是否一致，漂移时退出码 1，永不写盘
npm.cmd run pricing:sync           # 用 research/agent-usage/pricing/openai-pricing-20261004.md 重新生成 src/m1/prices.json
node scripts/m1/pricing-sync.js --dry-run   # 只打印本次会新增/移除哪些模型与被忽略的表
```

其它参数：`--source <file>`、`--out <file>`、`--date YYYY-MM-DD`、`--obtained-at <iso>`、`--quiet`。

## 只认已知表头

脚本按**表头行精确匹配**决定要不要读一张表，读不懂的表一律忽略并记进 `notes`，不猜列含义。

- 旗舰 9 列：`| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |`，且只在该表位于 `Standard pricing data` 或 `Grouped Pricing Table data` 之下时采纳。Batch / Flex / Fast / Ultrafast 永不作为默认价（Fast 档只作说明，例如 gpt-5.3-codex 的 3.50/0.35/28 不写进默认）。
- 专用 5 列：`| Category | Model | Input | Cached input | Output |`，且只在该表处于 `Standard` 档时采纳；类别必须属于 `Codex`、`ChatGPT`、`Search`、`Life Sciences`，Embedding / Moderation / Fine-tuning 等非本工具计费口径的行跳过。这类表的 `cacheWrite` 一律为 `null`（官方不单列）。
- 长上下文：短上下文列为空即视为不完整并中止；短/长上下文按 272,000 input token 分界，与 `src/m1/pricing.js:45` 的判定一致。
- 金额：`-` 与空串 → `null`，`Free` → `0`，其余必须是 `$1,234.56` 形式；出现读不懂的单元格会中止，**不会**把未知当 0。

## 绝不静默

- 同一 key 在同一份快照里出现两次且内容不同 → `PRICING_SOURCE_CONFLICT` 直接失败，不择一。
- 非 openai 条目字节不变地沿用（含其自身 `source` 与 `provenance`）；若它们与本脚本写入的块发生漂移 → `PRICING_CARRYOVER_DRIFT`。
- 别名（`gpt-5.1-codex` → `gpt-5.1` 等 4 项）基准模型缺失 → `PRICING_ALIAS_UNKNOWN`。
- 快照为空或表头缺失 → 失败，不会写出一个空目录。

## 输出字段

| 字段 | 含义 |
| --- | --- |
| `version` | `official-review-<date>`，日期取 `--date`，默认运行当天 |
| `obtainedAt` | 快照的取得时间，默认取源文件 mtime（描述这份价格是什么时候取的，不是本次运行时间） |
| `source` | 官方定价页 URL |
| `sourceSha256` | 快照 Markdown 的 SHA-256，用于溯源 |
| `basis` | `Current Standard API equivalent; no invoice, historical tier, tool fees or subscription cost` |
| `tiers` | `{basis:'standard', available:['standard','batch','flex','fast','ultrafast'], longContextThreshold:272000, currency:'USD', unit:'per-million-tokens'}` |
| `sha256` | `sha256(JSON.stringify(models))`，与界面显示的“目录”前缀同源 |
| `models` | 键必须是 `provider/model`，费率按 **USD/token** 存储，界面按 USD/百万展示 |

费率的 `provenance` 只允许三档：`official-current-standard`（官方当前 Standard）、
`official-thirdparty-unverified`（第三方公布的官方价，待核实）、`reference-unverified`（参考价，待核实）。
后两档只作参考，不计入费用，也不会被自动升级。

## 更新步骤

1. 人工或 CI 取一次官方定价页，覆盖 `research/agent-usage/pricing/openai-pricing-20261004.md`，先审阅这份字节。
2. `node scripts/m1/pricing-sync.js --dry-run`，确认新增/移除与被忽略的表都符合预期。
3. `npm.cmd run pricing:sync` 重写 `src/m1/prices.json`。
4. `npm.cmd run verify`：`tests/m1/pricing-sync.test.js` 会用当前快照重跑一次并断言零漂移，同时在改价副本上断言 `--check` 返回 1。
5. `npm.cmd run pricing:check` 应在干净树上返回 0。

没有价格变动时整条链路是幂等的：同一份快照重跑必须得到逐字节相同的 `models` 与 `sha256`。
