# 用量核算、成本定价及会话维护

本轮按用户截图修复 API 等价计价与未定价解释，并参考 CC Switch 增加自动扫描、成本定价、Codex 用量维护。唯一入口仍是 `src/quota/main.js`；五类原始来源只读，账号连接不参与此轮维护测试。

## 核查结论

- 应用总量是五来源合计，不等于单一 Codex 个人页。个人页与现存日志覆盖范围的差额未充分解释，不能凭显示总数补数；本机用量计数不进入源码或 Windows 交付包。
- 真实核查只读默认 sessions / archived_sessions；另对用户目录、常见备份、项目工作目录及 Codex AppData 候选位置检索 rollout 文件名，并检查候选备份 ZIP 的条目名。未扫描整个系统盘/回收站或读取无关文件。未找到可补全用户个人页历史的额外日志。
- 新解析器与独立按 `last_token_usage.input_tokens + output_tokens`、通知去重及副本归并的账本相等。固定时间的真实数字、差额、目录覆盖及源只读证据只保存在被忽略的本机审计记录中。没有把真实统计替换为候选。
- 检测到累计回退与重复通知；解析优先使用逐请求 last usage，缺失时才做累计差分。复制历史/归档去重，子代理自身会话保持独立。reasoning 已包含在 Codex output，不能再次加到总量或费用。
- CC Switch 截图使用 2 月起更长的时间范围，且 provider 表与首页的 token 口径不同；不能拿显示总数当作独立账单。

只读证据在被忽略的 `artifacts/pricing/initial-audit.json`、`final-audit.json`。它们只含匿名聚合计数，未包含正文、凭据、文件名或原始会话 ID；真实统计在核查前后 hash 相同。当前核算脚本为会话临时审计工具，不进入交付。

## 计价合同

价格编辑单位是 **USD / 百万 token**，内部按 token 换算。输出包含推理，输入桶互不重叠。缓存写入以写入费率替代对应普通输入费率，不能作为额外一项再次收费。

- OpenAI 当前 Standard 官方价格重建。GPT-4.1 等旧模型没有单列写入费率，Codex 未报告写入不再使整条记录无法计价。
- GPT-5.6+ 写入有独立价格；未报告写入时，用未缓存输入在普通/写入费率间的范围，不伪造写入数。已知逐请求 input >272K 时应用官方长上下文桶；旧保存记录没有逐请求上下文时，短/长上下文按范围展示。
- MiMo V2.5 / Pro 使用官方当前海外 USD 价格，写入为官方公布的限时免费；这不是 Token Plan 账单或人民币价格换汇。
- DeepSeek Flash/V4/Pro 官方当前高峰与空闲价按范围展示。历史生效价、地域节假日、实际购买币种/套餐没有从日志确认，不能按请求日期宣称准确账单。
- provider/model 精确匹配。自定义路由、unknown、free 后缀不自动猜价。可在编辑器选择官方价格模板并保存为该精确标识的手动规则；只有明示 0 才代表采用零费率。
- 原参考表未经本轮官方核实的条目标为 `reference-unverified`，不计入费用；内置没有规则、费率未核实、缺必要费率、字段缺失或冲突分别解释。手动保存/撤销只改本应用 `pricing.json`，不改用量记录；全部历史重新计算。
- API 等价估算采用当前费率，不是历史发票、Codex/其他订阅实际花费。Fast/Batch/Flex、地区溢价、工具费用等未由日志确定。覆盖率代表可匹配费率的 token，其中范围估算明确标注。

公共投影新增上界、范围 token、计价原因计数、各桶已知小计/记录数、内置及手动费率 hash。统计字段整体缺失仍为 null；已知部分显示 ≥，分类不完整不显示全量占比。趋势费用曲线展示估算下界，小计/卡片展示上下界。

## 三个功能

1. 设置里的自动扫描开关沿用 15 秒 worker 调度，关闭后仍能手动刷新，暂停/重启保留；应用退出不扫描。
2. 成本定价支持查找、编辑/添加、选择模板、保存重算、撤销手动规则；非负有限费率校验，空缓存费率保持未知，规则存储在应用独立目录。
3. Codex 维护先预览文件/记录数、旧值、重建值、保留历史及差额。应用前原生确认，备份完整本应用 statistics，再原子替换可重读会话，保留其他来源和不可重读历史。来源不完整/空扫描不应用；已保存有效记录不会被同 ID 的冲突记录降级。预览期间新采集改变序号则要求重新预览；可以先关闭自动扫描。取消不写统计。首次新解析器常规采集也先备份原有统计。

备份位于本应用统计目录 `backups/`，不打入交付包。维护不会删除原始日志、导入认证文件、清除额度连接或切换其他客户端。

## 参考证据

- [OpenAI 官方 API 价格](https://developers.openai.com/api/docs/pricing)、[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)。
- [MiMo 官方 USD 定价与免费缓存写入说明](https://mimo.mi.com/docs/en-US/price/pay-as-you-go)。
- [DeepSeek 官方美元价格](https://api-docs.deepseek.com/quick_start/pricing/)。
- [CC Switch 会话核算](https://github.com/farion1231/cc-switch/blob/793e67d9b3210eb527e7d36f2c866a56fae9dec7/src-tauri/src/services/session_usage_codex.rs)、[价格管理](https://github.com/farion1231/cc-switch/blob/793e67d9b3210eb527e7d36f2c866a56fae9dec7/src-tauri/src/services/model_pricing.rs)。本实现按当前 Electron 架构编写，没有引入 CC Switch 代理/切换/账号数据库。

## 验证与交付

CodeGraph 不可用，采用当前源码、官方价格、独立真实匿名账本及回归检查。46 项行为测试覆盖价格换算、桶计算、长上下文、写入区间、无规则/无字段、手动规则重启/撤销、不修改用量、累计回退/额度通道/大于32位总量，以及维护取消、备份、保留、过期与来源不完整。

规定的 verify、test:native、test:ui、test:quota:ui、test:stress、experiment:crypto 执行；另执行 20,000 行/100 模型/200 天的界面压力。桌面流程验证价格编辑/撤销、维护预览/取消/备份/应用、自动扫描与暂停/重启，使用合成独立 usage/quota/home；100%/150% 为强制缩放，不是物理 DPI 人工验收。原生总量 694 与 Tokscale 一致。没有新的真实登录、额度刷新或 logout 验收；旧真实连接保留。

Windows 新目录包及源码/Windows ZIP 放在 `dist/pricing-20261003/`，保持旧目录包可回退。包内源码比对、目录包及中文空格目录解压后的合成 UI 流程记录见交付证据。两个 ZIP 不含真实统计、备份、认证、输入日志或临时审计数据；Windows 包未签名。

> 交付形态更新（2026-10-04 后续）：每代 Windows ZIP 已删除（可重建），跨代相同的运行时改为硬链接共用；本目录现为 `win-unpacked/` + 源码 ZIP + manifest + `SHA256SUMS.txt`，manifest 以目录形态记录。详见 `docs/m1/MAINTENANCE-20261003.md` 的「交付形态调整」一节。
