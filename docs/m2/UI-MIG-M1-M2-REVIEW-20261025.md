# M1 / M2 统一审核入口 · 2026-10-25

所有者明确要求 M2 完成后与 M1 统一交给 Claude 审核；尚未获 Claude 通过，未合入 main，不进入 M3。

## 对象

- 审核分支：`ui/mig-m2-data`，含完整 M1 历史及 M2 增量。
- 共同基线：本地 main `346c8e0068d3a26107879d11f5b4a1fcc061a9b1`。
- M1 实现：`f5f27cae8b1702b39a8db8884835a47185e01070`；原分支 `ui/mig-m1-kit` 保留。
- M2 提交以本记录所属提交为准，最终交付消息给出 hash。
- M1 记录：[UI-MIG-M1-20261025.md](UI-MIG-M1-20261025.md)。
- M2 记录：[UI-MIG-M2-20261025.md](UI-MIG-M2-20261025.md)。
- 约束：[执行计划](UI-MIGRATION-PLAN-20261025.md)、[规范](UI-SPEC-20261025.md)。执行计划只增加了所有者已经批准的 Q1/Q3 范围及本次统一审核顺序，没有放宽设计或数据门槛。

在本分支 worktree 内查看完整差异：

```powershell
git diff 346c8e0..ui/mig-m2-data
git diff f5f27ca..ui/mig-m2-data
```

## 可复核的证据

- `artifacts/ui-mig/M1/`：M1 的浅/深整页、组件状态、全部下拉/菜单/弹窗/提示打开态、数字动效及来源基线。M2 复用了原 M1 证据，说明在 `M2-REVIEW-REUSE.txt`；未冒充本轮重新运行 gallery。
- `artifacts/ui-mig/M2/`：本轮桥接/全局模块清单、hook 生命周期结果、模板的深浅页图/弹窗图/关闭动效图、build/verify/runtime/foundation 日志。基础测试本轮已重新通过。
- M1 的最终验证均通过；M2 的 build:ui、verify（fail 0）、audit:runtime、foundation、模板与 hook 自测均通过。初始失败及修复详见两份记录。
- M2 对 M1 的 kit/gallery/registry/vendor/三个产品产物没有字节改动，因此不重复旧页面或 M1 gallery 全套测试。

如需复跑，先完成构建再运行 UI，不能一边清空重写产物、一边启动页面：

```powershell
npm.cmd run build:ui
npm.cmd run verify
npm.cmd run audit:runtime
node scripts/m1/ui-foundation-ui-test.js
node scripts/m1/ui-kit-gallery-ui-test.js
node scripts/m1/ui-page-smoke-template.js
```

所有这些 UI 入口使用独立目录和合成 fixture。当前依赖通过 node_modules 联接复用，只适用于源码验收；未进行打包，不应把这里的结果当作发布候选验收。

## 审核重点

1. M1：组件公开属性、fluid 映射、固定尺寸/字级/圆角/动效；Figure 的终态与未知值；弹出层键盘和焦点；没有自行扩大视觉范围。
2. Q1/Q3：基础测试仅扩充完整注册预期；vendor 只改已授权的三个角色开合档位和对应兜底，保留其余交互；VENDOR 记录完整。
3. M2：全部既有方法与真实签名/回执来源一致，未增加 IPC；V1/V2、取消/错误/缓存、不变快照、精确 decimal 与 null 保持区分。
4. useBridge：只读 loader、串行与合并订阅、同作用域错误保留数据、新作用域清空旧数据、迟到结果和卸载处理；没有隐式查询或写入。
5. globals：只声明和调用已有函数；动态元数据要求缩窄，未伪称新增运行时验证；usageInsights 的旧 DOM 耦合留给相应页面盘点。
6. 模板：截图是测试 probe 演示，不是 M3 页面验收；以后需按已审页面盘点填写所有弹窗与语义断言。

没有真实来源/凭据读取、账号请求、配置写入或执行、打包发布、远程操作或 main 合并。等待 Claude 审核意见后再按项目流程处理，不继续后续 MVP 步骤。
