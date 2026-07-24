# Batch 13：Agent 设置与 Skill 详情

> 走查智能体默认设置、我的 Agent、新建 Agent 与 Skill 详情安全错误态在桌面端的交互、Console、失败请求、响应式视觉状态与可访问语义。

## 一、前置条件

- 基线 commit：`de3ff2befb8a3564d5d6a5691c53cde049a596df`
- worktree：`../happy--web-audit-round-13`
- branch：`audit/web-round-13`
- 浏览器：复用已有登录态，不读取 Cookie、本地存储、输入值、机器路径、请求 URL、请求头或正文
- 复现页面：设置 → 智能体默认设置；设置 → 我的 Agent；新建 Agent；Skill 详情
- 已有登录态截图只在本地工具中查看，不写入仓库或运行账本

## 二、交互覆盖与安全边界

### 2.1 智能体默认设置

1. 直接进入默认设置页，检查全部字段行的按钮角色和展开状态。
2. 展开并收起代表性的权限选项，检查选项组、选中状态和键盘可达性。
3. 不点击具体默认值，不清除覆盖项，避免改变账户设置。
4. 在 1681px 与 800px 视口检查卡片、长值、分组标题和水平溢出。

### 2.2 我的 Agent 与新建 Agent

1. 检查列表页的内置入口、新建入口与空态，不启动 Agent，不打开已有自定义配置。
2. 进入新建表单，只聚焦名称、文件夹和未保存预设输入，不读取或填写任何值。
3. 在未保存状态下切换 Agent 类型、编码 Agent、模型、推理强度、图片风格和生成张数。
4. 新增并立即移除一个空预设行；不点击保存，不浏览机器目录，不提交或删除持久数据。
5. 逐项检查 radio、checkbox、button、textbox 名称与选中或禁用状态。

### 2.3 Skill 详情

1. 不打开或读取真实 Skill 文件内容。
2. 直接进入缺少参数的安全错误态，检查错误反馈与重试按钮。
3. 点击重试只重复本地参数校验，不触发文件读取。

每次导航、展开、切换、聚焦和截图都建立独立 Console 时间基线与 CDP Network cursor。
只记录新增 warning / error 和失败 XHR/Fetch 的数量、状态与资源类型。

## 三、发现的问题

- `WEB-038`：智能体默认设置的字段按钮没有 `aria-expanded`；展开后的互斥选项没有
  `radiogroup`、`radio` 与 `aria-checked`。
- `WEB-039`：新建 Agent 的名称、文件夹、预设标签和预设内容输入框没有稳定可访问名称；禁用的
  保存控件没有 button 角色。
- `WEB-040`：Agent 类型、机器、编码 Agent、模型、推理强度与生成张数只靠视觉勾号表达单选；
  图片风格多选项是可聚焦元素，但没有 checkbox 角色和选中状态。
- `WEB-041`：中文 Agent 表单仍显示文件夹控件的英文占位、路径状态、最近使用标题和空态文案。

Skill 详情缺少参数时能够显示明确错误和重试入口，未发现需要修改的 Console、网络或视觉问题。

## 四、截图走查

- 智能体默认设置在 1681px 下分组、卡片、图标、详情值和箭头对齐正常。
- 800px 桌面断点下主内容保持 550px 可用宽度，长模型名没有挤压字段标题；页面
  `scrollWidth` 与视口同为 800px。
- 我的 Agent 列表空态与新建入口没有重叠；新建表单的两列图片风格网格使用省略号控制长标题。
- 修复后新建表单的文件夹提示全部本地化，卡片宽度、输入框和分组间距无变化。
- Skill 安全错误态的标题、错误卡片、重试入口和页脚在 800px 下没有遮挡或溢出。
- 截图只裁剪主内容用于视觉判断；含已有登录态侧边栏或本地配置的图片不提交。

## 五、根因与修复

React Native Web 不会根据视觉勾号自动推断选择控件语义，也不会把独立分组标题自动关联到
`TextInput`。字段展开状态同样需要显式传递到 Web ARIA。

本批修复：

1. 默认设置字段显式传递 `aria-expanded`，展开选项使用具名 radiogroup 和 radio。
2. Agent 表单的互斥组选用 radiogroup/radio，图片风格使用具名 checkbox。
3. 名称、文件夹与预设输入框复用现有可见标题作为名称。
4. 通用圆角按钮显式提供 button 角色。
5. 文件夹控件接收调用方本地化文案；新增文案同步到全部语言结构。

修改只增加语义与文案，不改变保存、删除、机器目录读取或 Agent 启动逻辑。

## 六、TDD 与验证

### 6.1 RED

- Browser Control 显示默认设置字段缺少展开状态，展开选项缺少 radio 语义。
- Browser Control 显示 Agent 表单输入名称为空，选择项没有 checked 状态，中文页存在英文提示。
- 隔离认证 Web E2E：原有 27 tests passed；新增 2 tests 按预期失败。

### 6.2 GREEN

- happy-app TypeScript：passed。
- Browser Control：展开状态、具名 radio/checkbox、输入名称、禁用保存按钮和中文提示均符合预期。
- Browser Control：修复后各动作新增 Console warning/error 和失败 XHR/Fetch 均为 0。
- 隔离认证 Web E2E：29 tests passed。
- happy-app 完整 Vitest：134 files、1059 tests passed。
- Web export：passed，并确认导出首页包含 `app-loading` 首屏占位。
- 临时 Metro Watchman 配置：导出完成后已完整恢复，配置文件相对基线无差异。

## 七、使用的工具、步骤与方法

| 目的 | 工具或方法 | 本批使用方式 |
|---|---|---|
| 隔离开发 | `using-git-worktrees` | 按项目约定创建同级 worktree；符号链接无法解析 workspace 包后按锁文件安装 |
| 交互走查 | `browser-control` + Chrome | 复用已有登录态，只执行导航、展开、未保存表单切换和安全错误态重试 |
| Console 证据 | 动作时间基线 | 每个动作前单独记录时间，只统计其后的 warning / error |
| Network 证据 | CDP 增量 cursor | 每个动作使用独立 cursor，只统计失败数量、状态和资源类型 |
| 视觉检查 | 主内容裁剪截图 + DOM 测量 | 避开已有登录态侧边栏，比较 1681px 与 800px 内容边界 |
| 敏感配置 | 不读值、不保存、不浏览目录 | 不访问输入值、机器路径、浏览器存储或请求内容 |
| 根因定位 | `systematic-debugging` | 对照视觉状态、真实 DOM 和项目既有 radio 实现定位语义缺失 |
| 回归保护 | TDD + 隔离认证 E2E | 先让两条语义路径稳定失败，再做最小属性和文案修复 |
| 启动恢复 | 临时禁用 Watchman | Metro 初始化无响应时只在本地关闭 Watchman，提交前恢复 |
| 交叉审查 | 独立审查 Agent | 复核跨端属性、选择状态、翻译结构、敏感数据边界和测试副作用 |

## 八、PR、CI 与合并

- 独立代码审查：最终复审 Critical 0、Important 0、Minor 0。
- PR：[#217](https://github.com/wangjs-jacky/happy/pull/217)。
- CI：待执行。
- merge commit：待合并。
