# M6 连接表单 Checkbox 缺口 · 2026-10-26

**状态：诊断完成，最小补丁待所有者批准；未应用。按统一裁决 §1 和计划 §9.4 停止全部工作。**

分支 `ui/mig-m4-m8`，HEAD `247ffc1`。M6 尚未提交；本记录不是裁决，也不授权修改 vendor。

## 复现与证据

隔离的合成 Electron：进入额度页，打开 Cursor 连接 Sheet，选择网站连接方式，勾选同意项。没有读取真实客户端凭据或请求真实服务。

生产 bundle 报 React 错误 185。另构建非压缩开发 bundle 至被忽略的 `ui/.cache/m6-debug-ui/`，仅在测试启动的 Electron 内替换该 bundle 的文件请求；正式 bundle 未被调试构建覆盖。

对同意项记录捕获阶段 click，日志 `.cache/m6-form-events.log` 的顺序为：

```text
CONSENT_CLICK SPAN undefined null true
CONSENT_CLICK INPUT checkbox true false
CONSENT_CLICK INPUT checkbox true false
CONSENT_CLICK INPUT checkbox true false
...
Maximum update depth exceeded
```

四列分别是目标标签、type、aria-hidden、isTrusted。一次真实点击后，隐藏 input 连续发送合成 click。更长开发栈和状态日志在 `.cache/m6-form-debug5.log`；Select 的引用解绑报错属于循环中的后续更新。

源码链路：

1. `ui/src/vendor/fluid/components/checkbox-group.tsx` 的 `CheckboxItem` 外层行使用 `onClick={onToggle}`。
2. 行内的 Radix `CheckboxPrimitive.Root` 位于 kit `Form` 的原生 form 内，Radix 因而生成隐藏的 `CheckboxBubbleInput`。
3. `node_modules/@radix-ui/react-checkbox/dist/index.mjs` 的该 input 在 checked 变化后执行 `input.dispatchEvent(new Event("click", { bubbles }))`，供原生表单事件传播。
4. 该 input 是行内子元素，冒泡 click 再次命中外层 `onToggle`，checked 再次变化，形成循环。连续选中背景 run id 的增长与事件日志一致。

## 请求的最小补丁

仅修改 `ui/src/vendor/fluid/components/checkbox-group.tsx` 的行点击处理：忽略目标为 `type=checkbox` 且 `aria-hidden=true` 的原生 input 的 click。真实行/文字点击、内部复选框按钮的既有处理、键盘 Space/Enter、表单事件传播、视觉/动效、接口和 tokens 保持既有行为。

```diff
-        onClick={onToggle}
+        onClick={(event) => {
+          // Radix's hidden form input reports a state change; it is not another toggle.
+          if (
+            event.target instanceof HTMLInputElement &&
+            event.target.type === "checkbox" &&
+            event.target.getAttribute("aria-hidden") === "true"
+          ) return;
+          onToggle();
+        }}
```

不通过移出 Form、换原生控件或压制 React 错误绕过组件缺陷；不修改依赖包文件、版本、kit 接口、主题或设计检查。

## 批准后的验证与交付范围

- 在现有 `ui/src/dev/kit-gallery.tsx` 与 `scripts/m1/ui-kit-gallery-ui-test.js` 增加 Checkbox 位于 Form 内的回归：行、文字、内部按钮、键盘各切换一次且只切换一次；表单正常提交；深浅两色、off/reduced 无错误与循环。
- 执行受影响的 provider-quota、provider-login、provider-client 合成 UI 测试；保留 consent 必填、未同意不调用桥、秘密不持久化等原断言。继续复验“保持连接”可访问性，不能先认定该现象也已修复。
- 运行 build、verify、foundation 和相关 gallery；补丁、必要测试与批准后的裁决记录单独以 `M6:` 前缀提交。
- 然后继续完成 M6 剩余逐断言映射与全部页面门槛、M6 单独提交和报告，随即暂停，不开始 M7、M8。

统一裁决 §1 禁止自行修改 vendor，计划 §9.4 要求此类缺口“停止全部工作并提问”。此前获准的两行 accordion vendor 修复针对另一个对象，不覆盖本次 Checkbox 补丁。
