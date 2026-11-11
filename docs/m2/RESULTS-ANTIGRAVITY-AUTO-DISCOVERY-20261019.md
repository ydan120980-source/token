# Antigravity 自动发现与本机核对验收（2026-10-19）

在本地main b9fd626162ef142dc7b1ed6b3725f35d7939e118上实现所有者明确要求的自动扫描，并记录已授权单次读取的实际前置条件。范围决定/Claude接口见[自动发现合同](ANTIGRAVITY-AUTO-DISCOVERY-20261019.md)。本轮不再要求用户手填路径或重新批准同一单次读取。

## 实际检查

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 新发现逻辑与IPC单测 | 合成测试通过，含PATH/默认目录、链接去重、桌面/shim区别、权限/超时/限额、未知目标拒绝、sender guard、并发合并和实际preload | artifacts/antigravity-auto-discovery-20261019/discovery-tests-fixed.log |
| npm run verify | 通过，ESLint clean、node --test报告fail 0 | verify.log |
| npm run audit:runtime | 通过，单一入口，无退役路径或开发脚本导入 | audit-runtime.log |
| node scripts/m1/source-quota-ui-test.js | 源码Electron隔离合成回归通过，100%/125%/150%缩放 | source-quota-ui.log及ui/*/results.json |
| git diff --check | 通过 | 提交前实际执行 |
| 本机实际元数据发现 | desktop-only，有限范围扫描完成；候选CLI/launcher为空 | local-discovery.json |
| 真实CLI版本/额度 | **版本执行0次、/usage执行0次、账号读取0次**；没有可识别的独立CLI，未进行查询 | local-discovery.json |

首次虚拟文件系统测试把字符串的String.prototype.link误认成夹具链接属性，修正为仅对象记录可表示链接，复跑通过。没有为通过测试修改正常发现逻辑或放开内容读取。

## 本机发现事实

实际扫描当前PATH、官方LOCALAPPDATA/agy/bin与约定位置，发现已知安装目录中的Antigravity桌面程序。单独读取该程序的文件版本元数据为2.24.0，没有执行它。官方默认agy目录不存在，Get-Command未找到agy独立CLI。额外对该已知桌面安装目录用rg --files检查agy.exe/agy.cmd/agy.ps1等CLI文件名也无匹配，只枚举文件名、未读文件内容；这项额外人工核对不冒充产品发现器的递归能力。

因此本次单次/usage授权尚未使用。原因是CLI不可用，不是账号额度为零、会员失效或要求用户再提供路径。未启动桌面程序来试探参数，没有自动安装独立CLI、登录或扫描认证/配置。

## 现有界面与真实IPC回归

Browser插件及browser技能未提供，沿用项目现有Electron Playwright套件。流程为：合成安装元数据→真实preload/IPC自动发现→删除合成程序后重扫→来源/额度跨页导航→刷新/登录失败→保留缓存与重试→移除账号但保留账本。每次启动均指定独立usage/quota目录和fixture home；新发现入口在fixture模式不使用真实PATH/Program Files。

页面内容、路由/控制、无页面错误通过；800×650暗色窄窗无横向溢出。已检查ui/1/quota-dark-narrow.png。合成agy.exe只是不可执行文本，内容保持不变，发现不创建codex-homes、不写额度缓存或用量账本。没有修改renderer，尚无Antigravity新界面验收。

## 复核与边界

CodeGraph工具未提供，定向检查发现器→受控IPC→preload调用链及主窗口sender边界。扫描只有精确候选lstat/realpath，客户端不能提供任意根目录；不把发现结果塞入纯内存V2 getter。部分读取和多候选不能自动选择；唯一路径也仍标trust=unverified/verificationRequired。

已实现并合成测试通过的是自动发现后端与接口；已真实核对的是安装元数据。真实额度、登录/会员/共享账号、打包版及Claude新UI均未验收。支持状态仍Codex-only。未打包、生成源码ZIP、替换安装版或开始后台轮询。

实现、测试、合同和本记录的提交为`6f7f1dbbcfc075fb5477eec05e1bfb658ff06b9e`（feat: discover Antigravity CLI paths without requiring manual input），主题分支为codex/antigravity-auto-discovery-20261019。

按既有授权提交、复核后本地合入；没有push/PR，origin/main保持4d011eb81a4cca62f39084909ac3e6bfe096f594。最终合入由Git记录，合入后核对共享工作树干净并与已验证分支文件树一致。
