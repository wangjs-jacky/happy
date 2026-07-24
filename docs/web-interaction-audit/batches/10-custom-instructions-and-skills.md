# Batch 10：自定义指令与 Skills

> 走查自定义指令和 Skills 页面在桌面端的安全交互、Console、失败请求、响应式视觉状态与可访问语义。

## 一、前置条件

- 基线 commit：`065919712053ab1c39cbe4e1f0427770d6f118d0`
- worktree：`../happy--web-audit-round-10`
- branch：`audit/web-round-10`
- 浏览器：复用已有登录态，不读取 Cookie、本地存储、密钥、已有指令正文、请求 URL、请求头或正文
- 复现页面：设置 → 自定义指令；设置 → Skills
- 已有登录态截图包含真实会话侧边栏，只在本地查看，不写入仓库

## 二、交互覆盖与安全边界

### 2.1 自定义指令

1. 从设置页进入自定义指令。
2. 只聚焦和移出指令输入框，不读取、输入或保存已有内容。
3. 在 1470px 默认视口和 800px 桌面断点检查输入区宽度、边界与水平溢出。

### 2.2 Skills

1. 从设置页进入 Skills，等待当前机器完成扫描。
2. 在两台已有机器之间切换，检查加载、失败重试与恢复状态，最后恢复原选择。
3. 输入不会命中结果的临时搜索词，检查空结果，再完整清空搜索。
4. 检查机器选择、搜索、Personal Skills 与 Plugin Skills 的角色、名称和选中状态。
5. 在 1470px 和 800px 检查列表描述、开发错误遮罩、内容宽度与水平溢出。
6. 不打开 Skill 正文，不执行 Skill，不改变机器或账户持久化状态。

每次导航、聚焦、切换机器、搜索和清空都分别建立 Console 时间基线与 CDP Network cursor。
只记录新增 warning / error 和失败 XHR/Fetch 的数量、状态与资源类型。

## 三、发现的问题

- `WEB-026`：当机器守护进程的工作目录等于用户目录时，`$HOME/.agents/skills` 与
  `$PWD/.agents/skills` 扫描根完全相同；同一路径会被输出两次并作为重复 React key。
- `WEB-027`：`Item` 的 `subtitle`、`detail` 和 `ItemGroup` 的 `footer` 使用短路表达式；
  值为空字符串时，React Native Web 会把它作为 View 的裸文本节点并持续输出错误。
- `WEB-028`：扫描脚本只读取 `description:` 首行。使用 YAML `>` 或 `|` 块标量的 Skill
  会把标记符本身显示成描述，截图中出现孤立的 `>`。
- `WEB-029`：所有可点击 `Item` 都是可聚焦的通用元素，没有默认 button 角色。
- `WEB-030`：机器切换列表没有 radiogroup/radio 语义，也没有可靠的直接
  `aria-checked` 选中状态。
- `WEB-031`：Skills 搜索框的名称依赖 placeholder，缺少与界面文案一致的稳定标签。
- `WEB-032`：自定义指令输入框同样仅依赖 placeholder，名称没有使用可见的“指令内容”标签。

首次扫描其中一台机器时还出现一次命令超时；页面已有失败提示和重试入口，重试成功，未发现
需要修改的产品死路。浏览器扩展自身的遥测超时不计入产品 Console 或网络问题。

## 四、截图走查

- 修复前：切换到可扫描机器后出现 70 条重复 key 错误和 30 条裸文本节点错误，800px
  截图被红色开发错误遮罩覆盖。
- 修复前：使用 YAML 块标量的描述显示为孤立的 `>`，无法理解 Skill 用途。
- 修复后：两组 Skills 描述正常折叠显示；切换机器、搜索无结果和清空搜索均没有开发错误
  遮罩。
- 800px 下搜索框和列表保持在内容列内，无水平溢出、遮挡或重叠；自定义指令输入区宽
  518px，页面 `scrollWidth` 与视口同为 800px。
- 截图只用于视觉判断；含已有登录态和真实侧边栏的原图不提交。

## 五、根因与修复

### 5.1 扫描根与结果没有去重

扫描脚本现在先解析两个 `.agents/skills` 根的规范物理路径；两者相同时跳过项目根的重复
扫描。解析层再按完整路径去重，形成第二道保护，避免符号链接或其他重叠根再次产生重复 key。

### 5.2 YAML 描述解析只支持单行

描述提取改为可测试的 AWK 程序，同时支持单行值以及 `>`、`|` 块标量。块内容在下一个顶层
字段前停止并折叠成单行预览；解析层也会过滤孤立的块标记符，避免异常扫描输出泄漏到界面。

### 5.3 空字符串参与 React Native Web 子节点渲染

可选文本从 `value && element` 改为显式三元表达式，空值统一返回 `null`。修复同时覆盖
`Item.subtitle`、`Item.detail` 和 `ItemGroup.footer`，防止相同组件在其他页面复现。

### 5.4 点击能力与可访问语义没有同步

交互式 `Item` 现在默认暴露 button 角色，并允许调用方覆盖角色、名称、状态和直接
`aria-checked`。Skills 机器列表使用具名 radiogroup 和 radio；当前 Web 版本对
`accessibilityState.checked` 的 DOM 映射不稳定，因此选中状态使用直接属性验证。

Skills 搜索框与自定义指令输入框分别使用现有可见文案作为可访问名称。

## 六、TDD 与验证

### 6.1 RED

- 同一路径的两条扫描记录会生成两个列表项。
- YAML 块描述只得到 `>` 标记符。
- 交互 `Item` 没有 button/radio 角色，直接 `aria-checked` 没有转发。
- 空 `subtitle` 和 `detail` 会作为裸字符串进入 View 子节点。
- Browser Control 切换机器后复现大量重复 key 与裸文本节点错误，并出现红色错误遮罩。

### 6.2 GREEN

- 定向 Vitest：3 files、18 tests passed。
- happy-app TypeScript：passed。
- Browser Control：机器列表为具名 radiogroup，选项为 radio 且当前机器为 checked；搜索框
  和指令输入框均可按可见文案定位。
- Browser Control：切换机器、搜索、清空与恢复机器后，新增 Console warning/error 和失败
  XHR/Fetch 均为 0；页面不再显示块标记符。
- 隔离认证 Web E2E：23 passed。隔离环境没有在线机器，因此 Skills 用例验证安全空态；
  真实机器扫描、搜索与恢复分支由 Browser Control 和组件测试共同覆盖。
- happy-app 完整 Vitest：131 files、1055 tests passed。
- Web export：passed，`dist/index.html` 包含首屏 `app-loading` 注入。
- 临时 Metro Watchman 配置已恢复，提交差异为 0。

## 七、使用的工具、步骤与方法

| 目的 | 工具或方法 | 本批使用方式 |
|---|---|---|
| 交互走查 | Browser Control | 复用登录标签页，覆盖安全聚焦、机器切换、重试、搜索和恢复 |
| Console 证据 | 动作时间基线 | 只统计当前动作开始后的 warning / error |
| Network 证据 | CDP 增量 cursor | 只统计失败数量、状态和资源类型，不记录 URL、请求头或正文 |
| 视觉检查 | 裁剪截图 + DOM 测量 | 避开真实侧边栏，比较错误遮罩、描述和 800px 内容边界 |
| 安全交互 | 不读取、不保存、可逆恢复 | 指令只聚焦；搜索清空；机器选择恢复到初始值 |
| 隔离开发 | sibling worktree | 符号链接依赖解析失败后按锁文件在 worktree 本地安装 |
| 启动恢复 | 临时禁用 Watchman | Metro 初始化无响应时本地关闭 Watchman，提交前恢复 |
| 浏览器恢复 | 会话重新声明并认领标签页 | 浏览器控制内核超时后按控制 skill 恢复，不重复读取登录状态 |
| 输入清空 | 全选后退格 | 浏览器运行时的空字符串 fill 未生效，改用平台快捷键清空 |
| 回归保护 | TDD + 组件测试 + 隔离认证 E2E | 先证明解析、空文本和语义缺陷，再验证最终 DOM |
| 交叉审查 | 独立审查 Agent | 复核扫描边界、RN/RNW 属性转发、全局组件影响和测试稳定性 |

## 八、PR、CI 与合并

- 独立代码审查：恢复临时 Metro 配置后，最终复审 Critical 0、Important 0、Minor 0。
- PR：待创建。
- CI：待执行。
- merge commit：待合并。
