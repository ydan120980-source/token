# 初次阅读预览的内存保留 · 2026-11-04

状态：已实现并完成合成数据验证；这是解析器的局部优化，不代表应用达到 500 MiB。应用级复测见 `RESULTS-PERF-MEMORY-20261104.md`。

基线为共享 main `1f36b10`，工作分支为 `codex/perf-memory-20261104`，独立工作树 `token-worktrees/gpu-memory-20261104`。不改 Claude 的页面设计，不新增记录缓存，不读取真实数据，不推送。

## 改动与语义

原来 JSONL 已逐行读取，但 Builder 仍为初次预览保留每条消息的完整文本，直到读完整个会话后才裁成窗口需要的预览。现在 Codex 和 Claude Code 的初次预览只保留原有 inline 边界加一个字符的前缀，另记完整长度；长字符串的前缀通过 UTF-16 Buffer 脱离原行，避免切片字符串间接保留整行。图片保留类型和字节数，不保留初次预览不会返回的 base64。

流式合并、条目顺序、完整长度、原有截断边界和窗口返回结构保持一致。展开正文、分页、全文查找、Markdown 导出、事实读取仍走原来的完整读取路径。这次只优化 Codex / Claude Code，不宣称其他 Agent 同样获益。没有跨请求缓存或持久索引。

回归测试比较完整预览对象，覆盖连续消息合并、跨 inline 边界、中英文和 emoji、边界孤立代理码元、工具输出及图片元数据；也确认完整读取仍有输出末尾。

## 可复现的微基准

```powershell
node scripts/m1/transcript-preview-benchmark.js '<workspace-parent>/token/src/m1/transcript.js' '<temp>/codex-final-preview-ab-20261104.json'
```

基线模块所在 checkout 必须仍是 `1f36b10`。脚本只生成自己的临时合成目录，结束删除自己的夹具；每次读取启动新 Node 子进程，五组交错 A/B，不强制 GC。操作系统文件缓存不受控。空夹具、缺失条目、子进程失败或两边返回对象哈希不一致都会失败。

夹具 24,620,568 字节，300 轮，返回 600 项，十次完整输出 SHA-256 均为 `aa06b0dbb95d231169ca2930f760cd2c4e88dda738a16ae30e0863b9b678d94d`。

| 五次中位数 | 基线 | 当前 |
| --- | ---: | ---: |
| 初次读取 | 112.48 ms | 100.81 ms |
| 子进程峰值 RSS | 104.31 MiB | 78.03 MiB |
| 返回时 JS heapUsed | 22.94 MiB | 15.70 MiB |

这是解析器新进程的 RSS，不是整款应用的私有工作集；不能据此推算应用整体下降 25%。另一轮同夹具预跑也得到约 104 / 78 MiB，但耗时不同，保留最终可复现脚本的数字作为本表口径。

## 验证与证据

- 受影响的 transcript / transcript-tasks / preview 回归测试通过。
- 最终组合工作树的 `npm run verify` 通过，fail 0；其中还包含本轮视口动画改动，不冒充独立的后端提交验收。
- 新增微基准脚本 ESLint 通过，实跑有效且输出一致；`git diff --check` 通过。
- 原始结果和日志在 `<workspace-parent>/token-evidence/perf-memory-20261104/`，文件 `preview-ab.json`、`verify.log`，目录内 `sha256.json` 记录校验值。

没有新增打包、真实样本验证、远端写入或发布结论。
