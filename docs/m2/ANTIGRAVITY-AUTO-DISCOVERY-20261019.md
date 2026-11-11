# Antigravity 自动路径发现与单次读取范围（2026-10-19）

所有者明确回复：“允许对它当前登录的账号单次读取 /usage，另外应该做到自动扫描路径不是让用户我告诉你”。因此自动发现是默认后端能力，人工路径只可作为未来必要的可选兜底；不再要求用户先提供完整路径。本决定允许本次自动发现及有条件的单次真实读取，不允许自动安装、登录、轮询、修改配置或访问认证文件。

## 已实现接口

`quotaBridge.discoverAntigravity()`调用`quota:discoverAntigravity`，返回`{ok:true,discovery:AntigravityDiscoveryV1}`；受控失败为`{ok:false,errorCode,discovery:null}`。只接受无参数调用，renderer不能传目录/环境/执行参数。沿用主窗口sender guard，同一时刻请求合并，结束后可手动重试，不保存结果、不发quota:update、不改变账号状态。

这是明确的元数据扫描入口，与只读内存getV2分开；getV2和connectionsV2仍不扫描。没有增加真实额度收集/自动刷新接口，来源能力仍是Codex-only。main/preload只有新增接口与合成测试环境隔离，renderer文件交给Claude。

## 发现范围与边界

官方当前[入门页](https://antigravity.google/docs/getting-started)分别说明桌面应用、独立agy CLI和IDE；Windows CLI默认目录是LOCALAPPDATA/agy/bin。本轮读取该公开页面再次核对，没有下载或运行安装脚本。

扫描器src/quota/antigravity-discovery.js检查官方默认目录、几个约定bin位置、WinGet链接目录，以及当前进程PATH中的盘符绝对路径。支持引号、空格、其他盘符和少量已知环境变量展开；不枚举目录文件列表、不递归扫描磁盘、不访问WSL/UNC/当前工作目录/相对PATH，也不从环境展开任意潜在密钥字段。仅检查agy.exe、agy.cmd、agy.ps1及已知桌面安装位置的Antigravity.exe元数据。

只使用lstat/realpath。发现链接时解析元数据并验证最终仍为普通agy.exe，再按规范化路径去重；不会读取wrapper、程序内容、auth/settings、数据库、来源日志或目录内其他文件。元数据发现不等于信任程序；后续文件哈希/发布者/版本核验是单独步骤。

PATH文本最大64KiB、额外PATH目录最多128、总探测最多512，整次响应预算2秒。超限、超时或无法访问都会标partial，并禁止自动选择；不能把“没读到”说成“没安装”。底层文件系统请求无法被Node可靠取消，预算到达后不再发起后续探测，但不宣称已取消一个挂起的内核元数据请求。

## 结果合同

| 字段 | 含义 |
| --- | --- |
| schemaVersion/provider/checkedAt | AntigravityDiscoveryV1、antigravity、本次扫描结束时间；不是额度更新时间 |
| status | candidates-found、desktop-only、launcher-only、not-found、candidate-rejected或partial |
| candidates[] | executable、origins、linked、trust=unverified、status=verification-required；仅是候选 |
| launchers[] | 发现的cmd/ps1位置，unsupported-launcher；不执行或读取其内容 |
| desktops[] | 已知桌面程序位置，desktop-presence-only；不能据此运行/usage |
| selection | single-candidate/ambiguous/none/incomplete；只有完整扫描且唯一可核验候选时给executable，verificationRequired始终true |
| coverage | checkedPaths、complete、受控issues；complete仅指本合同定义的有限范围，绝非全盘安装审计 |
| effects | executedCli/readCredentials/readConfiguration/requestedQuota均false |

本地界面可显示候选路径，但不得将本结果混入来源摘要、项目导出、保存查询或日志上传。失败不返回底层路径错误/堆栈。多个不同CLI时显示候选供选择，不要求用户从磁盘找路径，也不把排在PATH最前的文件直接当官方程序。

## Claude 接入

额度页进入Antigravity连接流程时调用一次该接口，给出“正在查找→发现候选/只发现桌面程序/没有发现/扫描不完整”。发现一个候选仍需后续身份和版本校验，不能写成已连接或额度支持。多个候选用选择列表；目录未知时可提供可选文件选择器，默认不要求输入路径。

desktop-only明确显示“发现桌面版，未发现独立CLI”；launcher-only说明当前启动形式尚未支持。提供重新扫描入口，不自动安装、不自动登录、不轮询、不因选择候选立即调用模型或计费接口。发现失败保留上次结果及其时间，并明确本次失败，不能改成空账号。

测试模式`--m1-fixture-root`下，扫描环境只使用合成home/LocalAppData，PATH为空且不包含真实Program Files。界面套件通过新API发现临时agy.exe后删除并重新扫描，同时检查其字节、额度缓存与用量账本不变；不会扫描测试机的真实安装位置。

## 本机核对与单次请求结果

使用新扫描器检查实际PATH及上述已知位置，结果desktop-only、coverage.complete=true，独立CLI候选和launcher列表为空。另做桌面程序文件版本元数据核对，发现Antigravity桌面程序2.24.0；没有运行它。官方默认LOCALAPPDATA/agy目录不存在，PATH中未发现agy。这里的结论只覆盖已检查范围，不声称磁盘所有目录绝无CLI。

真实记录在忽略目录artifacts/antigravity-auto-discovery-20261019/local-discovery.json。**版本执行0次、/usage执行0次、账号数据读取0次**。原因是缺少可识别的独立CLI，不是需要用户再报路径或重新批准同一读取动作。没有把桌面2.24.0当成CLI版本，也没有绕过协议版本门禁去试错。

单次读取授权本轮尚未使用；它不扩展为自动安装、登录、多账号探测或后台监控。以后发现CLI时，仍需核对实际程序身份、协议版本及当时的启动条件。当前未替换安装版、未增加真实支持状态。测试/提交结果见[验收记录](RESULTS-ANTIGRAVITY-AUTO-DISCOVERY-20261019.md)。
