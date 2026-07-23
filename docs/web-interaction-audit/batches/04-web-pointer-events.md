# Batch 04：Web 启动时的 pointerEvents 弃用警告

> 消除每次 Web 页面启动都会出现的 `props.pointerEvents` 弃用警告，同时保持原生场景容器的交互与裁剪行为不变。

## 一、前置条件

- 基线 commit：`fd1971aded07e63ffe16d041cc41c20603ca1b0a`
- worktree：`../happy--web-audit-round-04`
- branch：`audit/web-round-04`
- 浏览器：复用已有登录态，不读取 Cookie 或本地存储
- 复现页面：`http://localhost:8081/new`

## 二、异常与复现

目标警告：

```text
props.pointerEvents is deprecated. Use style.pointerEvents
```

复现步骤：

1. 在 Browser Control 中记录页面加载前时间戳。
2. 打开 `/new`，等待首页输入区完成渲染。
3. 只筛选时间戳之后新增、且包含 `props.pointerEvents is deprecated` 的 `warn` 日志。
4. 在隔离认证 E2E 中先注册 `page.on('console')`，再打开 `/new`。
5. 等待输入框可见后，断言目标警告数组为空。

隔离 E2E 的 RED 结果：

```text
目标警告：1
新增控制台断言：failed
其他 Web E2E：11 passed
```

## 三、交叉定位

业务源码中没有把 `pointerEvents` 作为 JSX prop 传递；现有调用都已经放在
`style` 中。为找出被 `warnOnce` 隐藏的真实调用点，本批进行了两路交叉定位：

1. 静态扫描 `react-native-web` 的警告实现和所有已加载导航依赖。
2. 临时在本地依赖中输出不含业务数据的元素类型、属性值与调用栈，再逐个移动候选调用点。

运行时证据显示触发元素是 `div`，属性值是 `auto`，每次开发模式启动渲染两次。
将 `@react-navigation/elements` 的 `ResourceSavingView` Web 分支临时改成
`style.pointerEvents` 后，诊断日志和原始弃用警告同时降为 0；恢复依赖原状后，
新增 E2E 又稳定得到 1 条警告，因此排除了业务首页组件和其他导航组件。

## 四、根因

`ResourceSavingView` 为 Web 的可见场景设置：

```tsx
pointerEvents={visible ? 'auto' : 'none'}
```

当前 `react-native-web` 仍兼容该属性，但已经要求将它放入 `style`。应用启动时活动
场景必然经过这个组件，因此每次干净启动都会触发一次警告；开发模式的重复渲染会调用
两次，但 `warnOnce` 只展示第一条。

## 五、修复方法

1. 仅修改 `Platform.OS === 'web'` 分支，把 `pointerEvents` 作为样式数组最后一项。
   这与旧 prop 经 `react-native-web` 转换后追加样式的优先级一致，保证可见/隐藏状态
   仍能覆盖调用方样式。
2. 原生分支继续使用原有 prop，不改变 `removeClippedSubviews`、附着状态或交互行为。
3. 使用仓库已有的根目录 postinstall 补丁体系处理被提升到根目录的依赖。
4. 同时检查根目录与应用目录的 `node_modules`。
5. 依赖存在但目标文件缺失，或上游代码锚点发生变化时直接失败，避免升级后静默失效。

## 六、使用的工具、步骤与方法

| 目的 | 工具或方法 | 本批使用方式 |
|---|---|---|
| 动态复现 | Browser Control | 时间窗过滤长会话日志，并回放 `/new` 原始路径 |
| 页面状态 | Browser Control screenshot / locator | 确认修复前后首页可见结构一致；不提交含真实会话数据的截图 |
| 静态交叉检查 | `rg` | 先确认业务源码没有 JSX prop，再扫描已加载的导航依赖 |
| 精确定位 | 最小运行时诊断 | 只输出元素类型和 pointerEvents 值，不读取或记录业务内容 |
| 干净证据 | Playwright E2E | 导航前监听 console，RED 精确得到 1 条目标警告 |
| 依赖修补 | 根 postinstall 幂等补丁 | 只迁移 ResourceSavingView 的 Web 分支，并保护上游锚点 |
| 回归保护 | TDD | RED 为 1 条警告，GREEN 要求警告数组为空 |

> [!note]
> 本批是纯控制台兼容性问题，没有与警告对应的视觉异常。用于定位的现有登录态页面
> 含真实会话内容，因此不入库截图。发现样式异常的批次统一使用隔离空数据环境截图。

## 七、GREEN 与回归

隔离认证 Web E2E：

```text
12 passed
目标 pointerEvents 警告：0
```

补丁幂等性：

```text
首次执行：修改 1 个文件
第二次执行：0 个文件变化
```

## 八、验证、审查与合并

- Browser Control 原路径回放：新增日志 8 条，目标警告 0，error 0。
- 隔离 Web E2E：12 passed。
- 完整 Vitest：125 files / 1007 tests passed。
- TypeScript：passed。
- Web export：passed。
- 根 postinstall：passed。
- 独立代码审查：第一轮无 Critical，发现 1 个 Important——新样式位于数组开头会改变
  原 prop 的覆盖优先级；将 `pointerEvents` 移到数组最后并重跑 E2E 后，复审确认该项已
  关闭，无剩余 Critical/Important。
- PR：[#208](https://github.com/wangjs-jacky/happy/pull/208)。
- CI：`typecheck` 通过；`publish-preview` 通过，并生成独立 preview OTA 历史版本。
- merge commit：`b45db4da140e6a23d20e065146ba7a9f58fab2e9`。
