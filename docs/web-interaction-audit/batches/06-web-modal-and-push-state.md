# Batch 06：Web 弹窗、命令面板兼容性与账户页不支持状态

> 修复 Web 确认弹窗首次出现时的三类控制台警告、账户页仍可触发不支持操作的问题，
> 继续覆盖自定义弹窗和命令面板的懒加载警告，并让弹窗默认按钮跟随当前语言。

## 一、前置条件

- 基线 commit：`dbfdc993a4e33d366ab07c721514cd15b01eb1db`
- worktree：`../happy--web-audit-round-06`
- branch：`audit/web-round-06`
- 浏览器：复用已有登录态，不读取 Cookie、本地存储、密钥或账户凭据
- 复现页面：设置总览、个人资料和账户设置
- 本机 Watchman 无响应：只在验证期间让 Metro 使用 Node 文件系统；提交前必须恢复

## 二、交互与异常

本批先走查设置总览和个人资料页：

1. 从外观页返回设置总览，验证页面状态、增量 Console 和失败请求。
2. 进入个人资料页，截图检查桌面头部、头像和表单列对齐。
3. 打开并关闭头像预览；触发更换头像的文件选择器，但不选择或上传文件。
4. 修改姓名输入框为临时值后立即恢复原值，不点击“保存”。
5. 上述动作新增 Console 0、失败请求 0，未发现布局异常。

进入账户页后，页面已经显示 Web 不支持推送通知，但“重新注册此设备”仍可点击。点击
不会产生失败请求，却会弹出“此设备的推送通知尚未启用”的错误；弹窗首次渲染同时新增：

```text
"shadow*" style props are deprecated. Use "boxShadow".
TouchableWithoutFeedback is deprecated. Please use Pressable.
Animated: `useNativeDriver` is not supported...
```

关闭错误弹窗后，再打开登出确认弹窗，还发现中文界面的默认取消按钮仍显示 `Cancel`。

交叉审查要求补测 `BaseModal` 的背景点击层。扩展 E2E 到开发工具的自定义弹窗后，先后
暴露两处被全局 `warnOnce` 掩盖的 `shadow*` 警告：

1. 自定义弹窗页面首次加载设置分组时，`ItemGroup` 的原生阴影仍由 Web 样式预处理器
   转换。
2. 修复第一处后，点击自定义弹窗会让管理器为组件类型判断而懒加载命令面板模块，
   `CommandPalette` 的旧阴影成为下一条警告。

第二处调用栈同时提示命令面板实际打开时仍会经过独立的
`CommandPaletteModal`；它继续使用弃用背景组件和 Web 不支持的原生动画驱动。

## 三、视觉走查与截图策略

- 设置总览、个人资料和头像预览均用 Browser Control 截图检查。
- 个人资料页头部右侧保存按钮与 800px 表单内容列右边界对齐；没有发现最初截图观感所
  怀疑的头部错位，随后用 DOM 边界数值交叉确认。
- 账户页截图包含账户标识、推送令牌指纹或真实头像，因此不写入仓库。
- 隔离认证 E2E 的失败截图确认浅色桌面账户布局正常；GREEN 重跑会清理失败产物。
- 本批实际视觉异常是中文弹窗的 `Cancel`；修复后原登录态重新截图检查为“取消”。

## 四、根因

### 4.1 弹窗控制台警告

`BaseModal` 在所有平台使用 `TouchableWithoutFeedback`，并把两段 `Animated.timing`
都设置为 `useNativeDriver: true`。前者已经弃用，后者在 Web 没有原生动画模块。

`WebAlertModal` 与 `WebPromptModal` 又直接使用 React Native 的四个阴影属性和
`elevation`，因此 Web 首次渲染弹窗时产生 `shadow*` 警告。

`ItemGroup` 使用 Unistyles 创建包含原生阴影字段的样式。即使字段放在
`Platform.select` 的原生分支，Web 样式创建阶段仍会预处理它们。命令面板则在普通
React Native `StyleSheet` 中直接声明同一组字段；自定义弹窗的组件类型判断会触发该
模块懒加载，所以没有真正打开命令面板也能看到警告。

### 4.2 不支持状态仍可操作

账户页的“重新请求权限”已经在 `unsupported` 时禁用，但“重新注册此设备”的禁用条件
只检查加载中和登录凭据。Web 平台的注册函数会安全返回 `unsupported`，调用方却仍把
它转换成错误弹窗，形成一个必然失败的可点击入口。

### 4.3 默认按钮未国际化

Web Alert 与 Prompt 在调用方没有显式传入按钮文案时，分别回退到硬编码的
`Cancel` / `OK`。弹窗标题和正文使用翻译函数后，按钮仍保持英文。

## 五、修复方法

1. `BaseModal` 使用绝对定位的 `Pressable` 作为背景点击层，移除弃用组件。
2. Web 的 `Animated.timing` 使用 JS 驱动；iOS 与 Android 保持原生驱动。
3. 提取弹窗阴影辅助函数：Web 生成等价 `boxShadow`，原生继续使用原阴影与
   `elevation`。
4. 颜色透明度按“原颜色 alpha × 0.25”计算，避免主题颜色本身含 alpha 时被覆盖。
5. `ItemGroup` 把阴影移出 Unistyles 样式表：Web 运行时只传入 `boxShadow`，原生
   运行时继续传入原阴影字段。
6. 命令面板 Web 使用 `boxShadow`；独立弹窗背景层改用 `Pressable`，动画驱动按平台
   选择。
7. Web `unsupported` 状态使用 `Platform.OS` 同步兜底，禁用两个推送入口并把权限
   状态和副标题替换为明确的平台说明。
8. Web Alert 与 Prompt 的默认按钮使用 `t('common.cancel')` 和 `t('common.ok')`。

## 六、TDD 结果

新增两条隔离认证 Web E2E，并扩展第一条：

1. 先登录，再打开账户页，通过登出确认弹窗收集三类目标警告；随后打开自定义弹窗，
   验证内容点击不关闭、背景点击关闭，并覆盖懒加载模块的 `shadow*` 警告。
2. 等待权限状态稳定为 `Unavailable`，断言重新注册入口具备禁用语义，再强制点击并
   确认不会出现必然失败的错误。

RED：

```text
弹窗警告：3
Web 不支持操作错误弹窗：1
其他用例：13 passed
```

扩大背景点击覆盖后的追加 RED：

```text
自定义弹窗页面的 ItemGroup shadow 警告：1
修复后暴露的 CommandPalette shadow 警告：1
```

GREEN：

```text
15 passed
弹窗三类目标警告：0
Web 不支持操作错误弹窗：0
自定义弹窗内容点击：保持打开
自定义弹窗背景点击：正常关闭
```

## 七、使用的工具、步骤与方法

| 目的 | 工具或方法 | 本批使用方式 |
|---|---|---|
| 交互走查 | Browser Control | 每个路由、点击、弹窗与回退动作分别建立时间基线 |
| Console 证据 | `tab.dev.logs` | 只保留动作时间之后的 warning / error |
| Network 证据 | CDP 增量事件 cursor | 只统计新增 `loadingFailed` 和 HTTP 4xx/5xx，不记录 URL、请求头或正文 |
| 样式检查 | Browser screenshot + DOM 边界 | 截图先发现可疑点，再用数值边界排除误判 |
| 敏感数据保护 | 截图分级 | 真实账户截图只在本地查看；隔离认证截图才可作为自动化失败证据 |
| 安全交互 | 可逆动作与确认层 | 输入后恢复；文件选择器不选文件；登出只打开并取消确认 |
| 根因定位 | 调用栈 + `rg` | 从警告栈直接定位 `BaseModal`，再扫描同一弹窗组件的阴影 |
| 级联警告定位 | 全新运行时 + 最小诊断栈 | 每修一处后清缓存重放；临时只给 Web 阴影预处理器增加调用栈，定位命令面板懒加载后立即还原 |
| 回归保护 | TDD | 先得到精确 RED，再要求同一 15 条套件全部 GREEN |
| 隔离开发 | sibling worktree | 每批独立分支、依赖、验证、PR 和合并 |
| 交叉审查 | 独立审查 Agent | 重点检查跨端分支、背景点击层、颜色 alpha 和测试可靠性 |

## 八、验证、审查与合并

- Browser Control 原登录态：
  - 设置、资料、账户路由加载新增 Console 0、失败请求 0；
  - 修复后点击禁用的重新注册入口不再出现错误；
  - 修复后确认弹窗新增 Console 0、失败请求 0，中文按钮为“取消”。
- 隔离 Web E2E：15 passed。
- TypeScript：passed。
- 完整 Vitest：126 files / 1010 tests passed。
- Web export：passed；首屏加载占位注入成功，临时 Metro 配置已经恢复。
- 独立代码审查：首轮 2 个 Important、2 个 Minor 均已关闭；命令面板追加修复复审后
  Critical、Important、Minor 均为 0，可以合并。
- PR：[#210](https://github.com/wangjs-jacky/happy/pull/210)。
- CI：等待执行。
- merge commit：等待合并。
