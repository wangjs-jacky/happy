# Batch 05：外观设置页的 Web 样式弃用警告

> 消除打开外观设置页时出现的 `shadow*` 与 route-specific `pointerEvents` 弃用警告，同时保持渐变图标和页面头部在 Web 与原生端的原有行为。

## 一、前置条件

- 基线 commit：`b45db4da140e6a23d20e065146ba7a9f58fab2e9`
- worktree：`../happy--web-audit-round-05`
- branch：`audit/web-round-05`
- 浏览器：复用已有登录态，不读取 Cookie 或本地存储
- 复现页面：`http://localhost:8081/settings/appearance`

## 二、异常与复现

首个目标警告：

```text
"shadow*" style props are deprecated. Use "boxShadow".
```

修复首个警告后的最终回放还发现了第二个调用点：

```text
props.pointerEvents is deprecated. Use style.pointerEvents
```

复现步骤：

1. 在 Browser Control 中从设置首页点击“主题设置”。
2. 点击前记录时间戳，页面完成渲染后只读取时间戳之后的新日志。
3. 截图检查主题色板、吉祥物选择器、设置分组和滚动区域。
4. 在隔离认证 E2E 中先注册 `page.on('console')`，再直达
   `/settings/appearance`。
5. 等待页面中的开关完成渲染，断言两类目标警告数组都为空。

隔离 E2E 的 RED 结果：

```text
shadow 目标警告：1
新增控制台断言：failed
其他 Web E2E：12 passed
```

第二个 `pointerEvents` 调用点由 Browser Control 在全新构建的外观页稳定得到 1 条；
随后把同一路由加入 E2E 的 `pointerEvents` 断言，防止只验证无头部的 `/new`。

## 三、视觉走查

本批分别检查了现有登录态的桌面深色主题和隔离空数据环境的浅色主题。主题色板、
吉祥物卡片、文字标签、设置分组均未发现溢出、遮挡、错位或异常换行；目标问题属于
控制台兼容性警告，没有对应的可见样式故障。

现有登录态截图包含真实会话标题，不写入仓库；RED 阶段的 Playwright 失败截图来自
隔离空数据环境，当时作为本地测试证据生成，随后被 GREEN 重跑清理。

## 四、交叉定位

1. 静态扫描外观路由及其直接依赖中的 `shadowColor`、`shadowOffset`、
   `shadowOpacity`、`shadowRadius`、`elevation` 和 `boxShadow`。
2. 对照用户点击路径：设置首页已经渲染通用 `ItemGroup`，目标警告在外观路由首次
   加载后才出现，因此优先检查该路由新增的组件。
3. 唯一新增且直接使用 React Native 原始阴影属性的组件是 `GradientIcon`；它用于
   “内联工具调用”的渐变图标。
4. 先只迁移该组件的 Web 阴影，再用全新 Metro 构建、Browser Control 和隔离 E2E
   复验。shadow 目标警告降为 0，确认通用设置容器不是本问题根因。
5. 最终回放中继续出现 `box-none` 的 `pointerEvents` prop。临时诊断只输出元素类型、
   属性值、属性键和调用栈，不输出业务内容；结果是一个带头部路由的 `div`。
6. 将 `@react-navigation/elements/Screen` 的 Web 头部迁移到
   `style.pointerEvents` 后，诊断日志和原始警告同时降为 0；这也解释了为什么只访问
   `/new` 的 Batch 04 E2E 没有覆盖到它。

## 五、根因

`GradientIcon` 把动态颜色和以下 React Native 阴影属性直接传给所有平台：

```tsx
shadowColor
shadowOpacity
shadowRadius
shadowOffset
elevation
```

当前 `react-native-web` 会把这些属性兼容转换成 CSS 阴影，但同时发出弃用警告，要求
Web 调用方直接提供 `boxShadow`。外观路由是该组件当前唯一的使用位置，所以警告只在
首次打开该页面时出现。

此外，React Navigation 的 `Screen` 只在页面显示头部时渲染一个
`pointerEvents="box-none"` 的头部容器。Batch 04 修复的是所有路由都会经过的
`ResourceSavingView`；无头部的 `/new` 不会经过本次新增调用点，因此旧回归用例仍可
通过，而外观设置页会继续产生一次警告。

## 六、修复方法

1. 使用 `Platform.select` 明确区分 Web 和原生样式。
2. Web 根据渐变尾色生成带 `0.45` 透明度的 RGBA，并使用等价的
   `0 2px 5px` `boxShadow`。
3. iOS 与 Android 继续使用原有四个阴影属性和 `elevation: 4`，不改变移动端视觉。
4. 扩展已有 React Navigation postinstall 补丁：`Screen` 的 Web 分支把
   `box-none` 放到样式数组最后，原生分支继续使用原 prop。
5. 补丁同时检查根目录和应用目录的依赖；文件缺失、导入或代码锚点变化时直接失败。
6. 新增页面级控制台 E2E，防止该路由再次引入任一弃用属性。

## 七、使用的工具、步骤与方法

| 目的 | 工具或方法 | 本批使用方式 |
|---|---|---|
| 交互走查 | Browser Control | 从设置首页点击进入外观页，并用点击前时间戳过滤新增日志 |
| 样式检查 | Browser Control screenshot | 检查深色桌面布局；含真实会话内容的截图不入库 |
| 安全截图 | Playwright E2E | 在隔离认证、空会话环境保存失败截图，避免泄露现有登录数据 |
| 静态定位 | `rg` + 直接依赖检查 | 扫描阴影属性，并比较设置首页与外观页的新增组件 |
| 根因验证 | 最小变量法 | 只迁移 `GradientIcon` 的 Web 阴影，再全新构建复验 |
| 第二调用点定位 | 最小运行时诊断 | 只输出元素类型、`box-none` 值、属性键和调用栈，不读取业务文本 |
| 跨端保护 | `Platform.select` | Web 使用 `boxShadow`，原生完整保留旧阴影参数 |
| 依赖修补 | 根 postinstall 幂等补丁 | 扩展同一 React Navigation 补丁处理有头部路由，并保护上游锚点 |
| 构建排障 | 进程检查 + 临时禁用 Watchman | 发现 `watchman list-capabilities` 无 CPU 挂起；仅验证期间改用 Node 文件系统，最终不提交配置变化 |
| 回归保护 | TDD | RED 精确得到目标警告，GREEN 要求两类警告数组都为空 |

## 八、验证、审查与合并

- Browser Control 原路径回放：fresh logs 0；shadow 警告 0；pointerEvents 警告 0；
  error 0；最终截图未发现布局或视觉回归。
- 隔离 Web E2E：13 passed；外观路由的 shadow 与 pointerEvents 目标警告均为 0。
- 完整 Vitest：125 files / 1007 tests passed。首次与 E2E 并行时 1MB 加密性能用例
  超过 15 秒；停止并行负载后单文件 9/9 和完整套件均通过。
- TypeScript：passed。
- Web export：passed；本机 Watchman 无响应后使用 Metro 的 Node 文件系统完成验证，
  临时配置已恢复且未进入提交。
- 独立代码审查：首轮发现 2 个 Important（临时 Metro 配置不应提交、依赖包缺失时补丁未
  fail-closed）及颜色透明度语义问题；全部修复后复审无 Critical / Important。
- PR：[#209](https://github.com/wangjs-jacky/happy/pull/209)。
- CI：等待执行。
- merge commit：等待合并。
