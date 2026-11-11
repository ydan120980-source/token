# 额度资源后端 V2 与界面交接（2026-10-19）

所有者在额度可行性研究后明确要求开始实现，由本任务负责逻辑算法与后端，UI 交给 Claude。本轮完成第一增量：精确数量、多资源池合同、时间/会员生命周期投影、Codex 适配、缓存迁移与新增只读接口。未修改 design/desktop-reference，未接入新的服务商、认证读取或网络请求。

## 模块和数据流

```
官方 Codex CLI 原有 account/read + account/rateLimits/read
  → codex-resources.fromCodex
  → resource-contract.projectResources → AccountQuotaV2
  → 同一临时文件 + rename 保存成功
  → 发布内存快照
      → quota:get / state()：V1兼容窗口
      → quota:getV2 / stateV2()：逐资源生命周期与新鲜度
      → usage:connectionsV2：仅来源维度计数，不返回余额或账号信息
```

- src/quota/amount.js：有界十进制字符串校验、比较和减法，BigInt只用于内部运算，不跨JSON/IPC。
- src/quota/resource-contract.js：通用白名单合同，provider ID来自现有来源目录；合同可表达某来源不等于已实现该来源的账号适配器。
- src/quota/codex-resources.js：当前唯一真实额度适配、旧缓存转换与V1投影。保留实际窗口，不根据套餐名补5小时或推算周额度。
- src/quota/resource-state.js：纯函数，计算逐窗口/积分包的新鲜度、有效期与单项容量状态；不读取文件、不采集、不调模型、不修改观测值。
- src/quota/resource-connections.js、resource-ipc.js：来源概览V2及受原有主窗口sender guard保护的只读IPC。

当前Codex仍使用独立CODEX_HOME和官方CLI管理的keyring，RPC白名单与自动刷新策略没有增加。其他来源仍显示额度未接入。Antigravity官方CLI和WorkBuddy正式授权方案属于下一增量。

## 前端可以使用的接口

| 接口 | 返回 | 行为 |
| --- | --- | --- |
| quotaBridge.getV2() | Promise<{ok:true,state:QuotaStateV2}>；失败为{ok:false,errorCode,error,state:null} | 只读现有内存；不触发RPC、保存、登录或刷新 |
| usageBridge.connectionsV2() | Promise<SourceConnectionsV2>；失败抛受控CONNECTIONS_UNAVAILABLE | 与现有来源行相同，但能统计credits-only账号；不返回账号ID、备注、套餐、池名、余额或认证信息 |
| quotaBridge.onUpdate(callback) | 解除订阅函数 | 沿用quota:update；收到后重新getV2，不把控制接口的V1返回值塞进V2模型 |
| 原有login/cancel/refresh/refreshAll/remove/setAutoRefresh/chooseExecutable | 原有V1包络 | 操作入口保留，界面需要V2时在操作后重新getV2 |
| 原有get()/connections() | 原有V1 | 保持现有界面行为；新资源展示应使用V2 |

连接备注、随机连接ID、busy/errorCode/duplicateKnown等沿用现有账户元数据。V2新增identityStatus（server-reported或unknown，不返回服务端ID）和planMatchesObservation（三态）；后者为false意味着外层新套餐标签与最后额度观测尚未对齐。重复判断只在本次运行有服务端ID时成立，unknown不能解释成不同账号。

只读投影不会定时发事件：额度时间、有效期可随时钟变化，UI应在页面重新进入、已有更新事件或自身轻量显示计时中重新getV2。反复getV2本身不发额度请求。控制并发重读时应防止旧Promise覆盖新状态。读失败保留原视图及原时间，不显示空账号或“刚更新”。

## AccountQuotaV2 合同

| 字段 | 说明 |
| --- | --- |
| schemaVersion/provider/fetchedAt | AccountQuotaV2、现有来源ID、最近成功额度响应时间；日期统一UTC ISO字符串或null |
| provenance | kind为official-cli/official-api/undocumented-api/passive/legacy-cache/synthetic/unknown，version可空；不含原始响应、URL、凭据或用户标识 |
| entitlement | plan、state(active/trial/grace/expired/unknown)、observedAt、validUntil、cancelAt、issues；未知到期日为null |
| pools[] | 服务商池ID、label、scope(account/workspace/project/unknown)、modelIds、windows、balances；不加总不同池 |
| windows[] | id、role(primary/secondary/other)、cadence(rolling/fixed/calendar/unknown)、durationMins、resetsAt，加上公共计量字段 |
| balances[] | id、kind(subscription/purchased/promotional/unknown)、validFrom、expiresAt，加上公共计量字段 |
| 公共计量字段 | unit、currency、total/used/remaining/reserved、remainingMode/remainingSource、usedPercent/remainingPercent、availability、requiresEntitlement、observedAt、issues |
| resetCredits | Codex可用重置次数或null；独立于购买credits，不兑换、不触发重置。本轮没有新增重置卡逐张到期明细 |

计量单位为percent/credits/currency/tokens/requests/unknown；currency使用三位大写码，仅用于currency单位。绝对数量为非负十进制字符串或null。最多36位整数和18位小数；可安全表达“9007199254740993.125”。只接受安全整数形式的JS number，拒绝小数number、指数文本、Infinity、负数、空串及超过边界的输入。百分比是有限非负number；服务商超过100%的观测保留，显示剩余下限为0。

默认remainingMode是reported-only。只有适配器明确指定total-minus-used或total-minus-used-minus-reserved、相关输入均已知且单位有效时才减算；负结果保留null并标AMOUNT_CONFLICT。显式null或非法的reported remaining不会被推算覆盖。reserved不会被默认当成已用或自动扣除。跨包、跨币种、跨单位、跨账号均不提供加总函数。

normalizer限制100个池、总计200个窗口/包，各池模型ID上限100；缺失列表、重复池/单类条目ID或超限结构拒绝。字段层异常保留null和受控issues；再次投影或JSON往返不丢失issues、推算来源等元数据。未知字段不进入输出。日期必须含时区，非法日历日期和无时区文本不按本地时区猜测。

availability为unknown/available/unavailable/disabled/unlimited。余额非零不能单独证明可用；缺少服务商可用性时保留unknown。无限只接受明确标记。Codex的hasCredits/unlimited映射可用性，planType仅是标签，不证明会员active，也不提供到期日。没有窗口、没有余额的合法响应保留空资源集合和partial，不当成100%或无限。

## 逐项生命周期投影

stateV2()的accounts[].quota在合同上增加以下派生字段，缓存只保存原始白名单观测，不保存这些时钟状态：

| 字段 | 规则 |
| --- | --- |
| item.state | available/exhausted/unknown/disabled/unlimited/unavailable/expired/not-yet-valid；available是该单项约束/包的状态，不是账号整体可调用证明 |
| item.freshness | state为fresh/stale/cached/missing，reason为受控枚举 |
| item.currentlyUsable | true仅表示这一项在当前新鲜观测下允许；false表示此项明确阻断；null表示不能确认。不能据某一项true启动任务或开启超额消费 |
| entitlement.verificationRequired | 已过validUntil且没有明确expired结果时为true，原报告的state仍保留 |
| entitlement.freshness | 资格本身的观测状态，与购买包的新鲜度分离 |
| coverage | 逐窗口/包的fresh/stale/cached/missing数量，不是剩余额度总数 |
| partial/hasMeasurements | 数据质量/是否有计量或明确可用性；与新鲜度独立 |

fresh需要观测时间合法、不超过10分钟、连接ready且无错误或busy；超过当前时钟60秒的未来观测为missing。重启保留的连接是cached，不自动发请求。过resetAt只把该窗口标stale，数值不回满；兄弟池仍按自己的状态展示。

requiresEntitlement只有true时才由会员终止影响该资源。validUntil已过标待核验；明确expired标该资源unavailable；取消自动续费cancelAt不等于会员失效。独立购买包继续按自身状态处理。已知包expiresAt经过标expired并保留历史remaining，不清零；validFrom未到标not-yet-valid。矛盾的有效区间不推断可用。无法解析的资格时间标issues，依赖它的资源保持待核验。

每个池的多个窗口是不同约束，可能需同时满足；购买余额是否能替代订阅窗口必须由后续适配器另行证明。本轮没有生成跨池“总体可用”或自动路由结果，也没有将本地token历史归入账号余额。

## 缓存、发布和兼容性

现有quota-cache.json升级为QuotaCacheV2。每个连接的resourceQuota保存规范化AccountQuotaV2，quota保留从它生成的V1窗口影子；两者在同一次临时文件写入和rename中提交，保证本版本的两个getter来自同一观测。旧界面和旧缓存读取器仍能理解V1字段。

启动可读取没有根schemaVersion的旧文件，也可读取QuotaCacheV2；旧V1转换仅在内存发生，不重写文件、不启动CLI。直到用户原有操作发生保存，才保存V2。未知根版本、结构非法的新资源或超过16MiB的缓存保留原字节并按既有quarantine流程隔离，不覆盖原文件。

本轮只保证V1显示/读取兼容；旧二进制保存时不知道resourceQuota，会丢弃V2新增字段，再回到新版本时只能从留下的V1重建，不能称为无损降级。没有修改真实用户缓存或替换正在运行的安装包。

刷新先完成规范化，再保存完整候选，保存成功后才发布内存V1/V2及身份。保存失败保留最后成功的资源值和时间，不能先宣布ready。新响应完整替换旧窗口、购买余额及重置次数，缺失字段不会从旧套餐补回。已有连接generation、顺序队列和账号变化保护继续生效，旧请求不能复活已取消的连接。

## Claude 的 UI 接入范围

1. 本任务没有修改design/desktop-reference。额度页通过getV2接入新资源，来源页通过connectionsV2接入覆盖计数；保留原有官方连接/刷新/移除入口。
2. 窗口显示实际durationMins或服务商命名，role不当作“5小时/每周”。修正现有“Pro · 示例”仍带300分钟的过时样例。未知/未报告、未到期、已过期、禁用、无限及耗尽分别表达。
3. 逐池展示，禁止相加百分比、金额和不同资源包；会员待核验与购买余额各自展示。旧余额到期后保留观测值，并明确其不可用状态。
4. decimal字符串用于原值展示，不能Number后再参与计费计算。百分比仅作对应窗口显示；reserved不自动算成已用。
5. 保留来源读取与额度连接独立的行为，其他来源仍是未接入。单项新鲜不能覆盖其他池的旧数据；连接freshness与resourceCoverage分别是账号计数和资源条目计数。
6. UI完成后执行相应源码模式quota/source-quota界面套件。真实会员过期、积分包余额和Windows官方账号核对仍未验收，不能用本轮合成数据代替。

可执行合成样例在tests/m1/fixtures/quota-resources.js，提供proWeekly、creditsOnly、packages、groupedModels及固定NOW。packages/groupedModels是合同样例，不是WorkBuddy/Antigravity适配器。测试夹具不进入产品运行时，不能从src导入。生成供UI评审的JSON：

```powershell
node -e "const f=require('./tests/m1/fixtures/quota-resources');const {resourceView}=require('./src/quota/resource-state');process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(f.cases).map(([name,make])=>[name,resourceView(make(),{status:'ready'},f.NOW)])),null,2))" > artifacts/quota-resource-backend-20261019/ui-fixtures.json
```

测试与实际执行结果见RESULTS-QUOTA-RESOURCE-BACKEND-20261019.md。本轮只读研究依据见QUOTA-FEASIBILITY-RESEARCH-20261019.md；上述代码是其第一增量，不自动启动后续适配器或GitHub功能。
