# Batch 03：Web 启动时的无效通知监听警告

> 消除每次 Web 页面启动都会出现的 `expo-notifications` push token listener 警告，同时保持 iOS 和 Android 的自动 token 注册行为不变。

## 一、前置条件

- 基线 commit：`71f59185be11b3bd63224ca3c73ad20ca6e29bb7`
- worktree：`../happy--web-audit-round-03`
- branch：`audit/web-round-03`
- 浏览器：复用已有登录态，不读取 Cookie 或本地存储
- 复现页面：`http://localhost:8081/new`

## 二、异常与复现

目标警告：

```text
[expo-notifications] Listening to push token changes is not yet fully supported on web.
Adding a listener will have no effect.
```

复现步骤：

1. 在 Browser Control 中记录页面加载前时间戳。
2. 打开 `/new` 并等待输入框可见。
3. 只筛选时间戳之后新增的 `warn` 日志。
4. 在隔离认证 E2E 中，先注册 `page.on('console')`，再打开页面。
5. 只收集包含 `Listening to push token changes` 的 `warning`。

Browser Control 的长会话历史中累计存在 7 条同类警告，因此不能只按文本统计全部历史。
隔离 E2E 提供了更精确的单次启动证据：

```text
目标警告：1
其他 Web E2E：10 passed
新增控制台断言：failed
```

## 三、根因

应用有多个模块从 `expo-notifications` 入口导入通知 API。依赖入口会加载
`DevicePushTokenAutoRegistration.fx.js`，这个模块在顶层自动调用
`addPushTokenListener()`。

Web 的 `PushTokenManager` 明确说明该 listener 不生效，但自动注册模块仍执行订阅；
懒加载 bundle 还可能让同一副作用在开发会话中重复出现。业务代码并没有主动在 Web
注册这个 listener，根因位于依赖的入口副作用。

## 四、修复方法

1. 在自动注册副作用中读取 `Platform.OS`。
2. 只有非 Web 平台才订阅 token 变化并读取自动注册状态。
3. iOS 和 Android 继续执行原有代码，没有修改通知权限、token 获取、通知响应或本地通知逻辑。
4. 使用仓库已有的根目录补丁体系，在 `scripts/postinstall.cjs` 中注册幂等补丁脚本。
5. 补丁同时检查根目录和应用目录的 `node_modules`，并在上游代码锚点变化时直接报错，避免依赖升级后静默失效。

本仓库虽然在应用包中保留 `patch-package`，但 pnpm 当前把
`expo-notifications` 提升到根 `node_modules`，应用目录下没有同名包；
直接生成 patch-package 补丁会找不到依赖。根目录已经使用多个 `.cjs` 补丁处理同类
hoisted dependency，因此本批沿用该项目规范，而不是新增第二套不可执行路径。

## 五、使用的工具与方法

| 目的 | 工具或方法 | 本批使用方式 |
|---|---|---|
| 动态复现 | Browser Control | 按加载前时间戳截取新增控制台日志，避免把长会话历史重复计数 |
| 干净证据 | Playwright E2E | 在导航前监听 console，精确证明每次独立启动新增 1 条目标警告 |
| 根因定位 | systematic debugging | 从警告原文定位依赖实现，再沿 `PushTokenManager` 反查顶层自动注册副作用 |
| 依赖修补 | 根 postinstall 幂等补丁 | 复用项目已有补丁结构；同时保护上游锚点变化 |
| 回归保护 | TDD | RED 为 1 条警告；平台守卫后同一用例要求警告数组为空 |
| 跨端保护 | 平台最小分支 | 只排除 Web，原生自动注册分支不变 |

## 六、GREEN 与回归

Browser Control 使用修复后的新时间窗回放：

```text
新增日志：9
目标警告：0
error：0
```

隔离认证 Web E2E：

```text
11 passed
```

## 七、验证、审查与合并

- 补丁首次运行：修改 1 个文件。
- 补丁第二次运行：0 个文件变化，幂等。
- Browser Control 原路径回放：通过。
- 隔离 Web E2E：11 passed。
- 完整 Vitest：125 files / 1007 tests passed。
- TypeScript：passed。
- Web export：passed。
- 独立代码审查：第一轮无 Critical，发现 1 个 Important——依赖存在但目标文件改名时补丁会 fail-open；改为依赖存在、目标缺失立即报错后，复审确认该项已关闭，无剩余 Critical/Important。
- PR：[#207](https://github.com/wangjs-jacky/happy/pull/207)。
- CI：`typecheck` 通过；`publish-preview` 通过，并生成独立 preview OTA 历史版本。
- merge commit：`fd1971aded07e63ffe16d041cc41c20603ca1b0a`。
