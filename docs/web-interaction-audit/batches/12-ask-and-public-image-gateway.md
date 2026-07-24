# Batch 12：Ask 与公开图片网关

> 走查 Ask 服务配置和公开图片网关页面在桌面端的安全交互、Console、失败请求、响应式视觉状态与可访问语义。

## 一、前置条件

- 基线 commit：`06eb34707ef5c93efb6cbbbfb5b94eea5cc8c02a`
- worktree：`../happy--web-audit-round-12`
- branch：`audit/web-round-12`
- 浏览器：复用已有登录态，不读取 Cookie、本地存储、API Key、接口地址、请求 URL、请求头或正文
- 复现页面：设置 → Ask API；设置 → 公开生图网关
- 已有登录态截图和网关端点只在本地工具中查看，不写入仓库或运行账本

## 二、交互覆盖与安全边界

### 2.1 Ask API

1. 直接进入 Ask API 设置页。
2. 只逐一聚焦三个输入框，不读取、输入、清空或保存任何值。
3. 检查输入类型、可访问名称、焦点状态和清除操作的禁用状态。
4. 在 1681px 和 800px 视口检查输入区、状态区、说明文字和水平溢出。
5. 清除 Ask API 会改变本地配置，因此不点击。

### 2.2 公开图片网关

1. 直接进入公开图片网关设置页。
2. 检查两个外部入口的 button 角色和唯一名称。
3. 检查 worker 状态项保持只读，不错误暴露为按钮。
4. 在 1681px 和 800px 视口检查长副标题、图标、箭头和水平溢出。
5. 外部入口可能离开本地应用，因此不点击；自动化只验证调用入口和语义。

每次导航、聚焦和视口切换都分别建立 Console 时间基线与 CDP Network cursor。
只记录新增 warning / error 和失败 XHR/Fetch 的数量、状态与资源类型。

## 三、发现的问题

- `WEB-037`：Ask API 的三个输入框虽然都有视觉标题，但标题没有关联到输入框；DOM 中三个
  `aria-label` 均为空，密码输入框也无法按可见标题稳定定位。

公开图片网关的两个外部入口已经具有 button 语义，worker 状态项保持只读，未发现需要修改的
交互或视觉问题。浏览器扩展自身的遥测超时不计入产品 Console 或网络问题。

## 四、截图走查

- Ask API 在 1681px 下输入框、说明文字和状态卡片对齐正常。
- Ask API 在 800px 下三个输入框宽度一致，说明文字正常换行；页面 `scrollWidth` 与视口同为
  800px，没有水平溢出、遮挡或重叠。
- 公开图片网关在 800px 下两个长副标题和 worker 说明都保持在卡片内，图标与箭头没有遮挡。
- 公开图片网关在 1681px 下页面 `scrollWidth` 与视口一致。
- 截图只裁剪主内容用于视觉判断；含已有登录态、真实侧边栏或端点的图片不提交。

## 五、根因与修复

Ask API 使用独立的 `Text` 绘制字段标题，但 `TextInput` 没有
`accessibilityLabel`，视觉邻接不会自动建立 Web 可访问名称。

三个输入框现在分别使用对应的现有标题作为 `accessibilityLabel`。修改不读取或改变配置值，
也不改变输入类型、保存时机和视觉布局。

## 六、TDD 与验证

### 6.1 RED

- Browser Control 显示三个 input 的 `aria-label` 都为空。
- 新增组件测试在修复前稳定得到 `[undefined, undefined, undefined]`，与三个标题键不符。

### 6.2 GREEN

- 定向 Vitest：1 file、1 test passed。
- happy-app TypeScript：passed。
- Browser Control：三个输入框分别具有 API Key、API URL 和 Tavily API Key 名称；逐项聚焦
  后新增 Console warning/error 和失败 XHR/Fetch 均为 0。
- Browser Control：网关两个外部入口为具名 button，worker 状态项不是 button；导航与双视口
  检查新增 Console warning/error 和失败 XHR/Fetch 均为 0。
- 隔离认证 Web E2E：27 tests passed。
- happy-app 完整 Vitest：134 files、1059 tests passed。
- Web export：passed，并确认导出首页包含 `app-loading` 首屏占位。
- 临时 Metro Watchman 配置：导出完成后已完整恢复，配置文件相对基线无差异。

## 七、使用的工具、步骤与方法

| 目的 | 工具或方法 | 本批使用方式 |
|---|---|---|
| 隔离开发 | `using-git-worktrees` | 按项目约定创建同级 worktree；符号链接解析失败后按锁文件本地安装 |
| 交互走查 | `browser-control` + Chrome | 复用已有登录态，只执行导航、聚焦、角色检查和截图 |
| Console 证据 | 动作时间基线 | 每个动作前单独记录时间，只统计其后的 warning / error |
| Network 证据 | CDP 增量 cursor | 每个动作使用独立 cursor，只统计失败数量、状态和资源类型 |
| 视觉检查 | 裁剪截图 + DOM 测量 | 避开真实侧边栏，比较 1681px 与 800px 内容边界 |
| 敏感配置 | 只聚焦、不读取、不输入 | 不访问 Key、接口地址、浏览器存储或请求内容 |
| 外部入口 | 不离开本地应用 | Browser Control 不点击；隔离 E2E 只验证入口语义 |
| 根因定位 | `systematic-debugging` | 对照视觉标题、input DOM 与同项目具名输入框，定位名称未传递 |
| 回归保护 | TDD + 组件测试 + 隔离认证 E2E | 先证明三个名称为空，再做最小标签修复并验证真实 DOM |
| 启动恢复 | 临时禁用 Watchman | Metro 初始化无响应时只在本地关闭 Watchman，提交前恢复 |
| 交叉审查 | 独立审查 Agent | 复核敏感数据边界、RN/RNW 属性映射和测试稳定性 |

## 八、PR、CI 与合并

- 独立代码审查：最终复审 Critical 0、Important 0、Minor 0。
- PR：待创建。
- CI：待执行。
- merge commit：待合并。
