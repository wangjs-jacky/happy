# Agent 空间独立上下文与陪伴面板设计

日期：2026-07-13  
状态：已完成产品与视觉确认，等待书面评审  
范围：`packages/happy-app`，移动端 Agent 空间入口、会话头部与右滑面板

## 1. 背景与问题

当前 Agent 空间模式把 `agentSpaceId` 写入本地设置并打开空间工作台，但进入空间时不会切换当前会话路由。因此用户从一个普通会话进入“健康打卡”后，主区域仍显示旧会话；右滑面板也继续渲染通用能力中心，出现会话操作、Skills、生成图片、Artifacts、文件等代码环境内容。

这与“空间是一套独立上下文”的产品语义冲突。空间不能只是会话列表筛选器或侧栏皮肤；进入空间必须真正开始一条属于该 Agent 的新会话，并把右侧内容替换成该空间当前有用的陪伴能力。

## 2. 目标

1. 用户从空间外点击一个持久化 standard Agent 时，立即创建并打开一条空白空间会话。
2. 原会话保留在全局会话列表，但不继续显示，也不把消息带入新空间。
3. Agent 空间会话不显示通用代码能力中心。
4. 健康打卡空间的右滑面板显示固定健康 Tips 轮播和健康快捷指令。
5. 快捷指令只填入当前输入框，允许用户补充文字或图片后再发送。
6. 面板的数据边界支持后续替换为数据规则或 Agent 动态生成，而不重做 UI。
7. 普通会话和现有通用能力中心行为不变。

## 3. 非目标

- 本期不读取近 7 天健康数据生成个性化 Tips。
- 本期不调用 Agent 动态生成 Tips。
- 本期不重做空间工作台或健康报告页的布局；只把工作台的“新建会话”入口接到统一空间入口协调器。
- 本期不改变普通会话的 `SessionCapabilityHub`。
- 本期不把“进入空间”实现成删除、归档或覆盖原会话。
- 本期不自动发送快捷指令。
- 本期不新增服务端持久化模型；空间身份继续使用现有 Agent 配置与会话 metadata 推导。
- 本期不把 `image-styles` 专用生成器强行改成标准空白会话；它继续使用已有图片 compose 流程。

## 4. 已确认的产品语义

### 4.1 从空间外进入

从 Agent 列表点击持久化 standard Agent，执行一个原子入口流程：

1. 校验 Agent 绑定机器在线，并解析唯一的 launch config。
2. 使用解析后的机器、规范化绝对路径、agent type、权限、模型与 effort 创建空白会话。
3. 会话创建成功后关闭 Agent 选择器并写入 `agentSpaceId`。
4. 使用现有 `navigateToSession` 规整导航栈并打开新会话。

空白会话允许 `prompt === ''`，不发送隐藏的初始化消息，不污染 transcript。

### 4.1.1 `image-styles` 专用例外

`image-styles` Agent 依赖 `/new?agentId=...` 的图片风格、参考图与生成数量 compose UI。它不是本期 standard Agent 空白会话入口的适用对象：

- 从 AgentSheet 点击时，保持现有行为：进入该 Agent 空间，但不立即 spawn 通用空白会话。
- 从空间工作台点击“新建”时，继续使用 `launchAgent(..., /new?agentId=...)` 打开专用 compose。
- 其 agent type 解析仍固定为 Codex，防止未来误用 draft 中的其他 runner。

该例外只保护现有专用图片流程，不影响健康打卡等 standard Agent 的“进入即新建空白会话”语义。

### 4.2 创建失败

机器离线、目录创建未获批准或 spawn 失败时：

- 保留用户进入前的原会话与路由。
- 不写入 `agentSpaceId`。
- 使用既有 Modal 错误/确认机制提示或重试。
- 不进入只有空间皮肤、却没有有效会话的半成品状态。

spawn 成功后，`navigateToSession` 是同步导航调用。调用前保存旧 `agentSpaceId`；若调用同步抛错，则回滚旧空间状态并释放 `entering`。已经成功创建的空白会话保留在会话列表，避免在失败恢复路径中加入隐式删除。导航调用正常返回即视为入口成功，选择器保持关闭。

### 4.3 空间内导航

- 从空间工作台点击已有空间会话：直接打开，不新建。
- 用户显式点击“在此空间新建会话”：复用同一个空间入口协调器，新建空白空间会话并共享并发保护。
- 工作台原有 preset 芯片继续表示“以这个 preset 开始一条新会话”；它同样复用协调器。协调器在 spawn 成功、导航之前调用 `storage.getState().updateSessionDraft(sessionId, preset.prompt)`，目标会话的 `useDraft` 因而能在首次挂载时恢复文本，不依赖已卸载的工作台拿 composer ref，也不自动发送。右侧陪伴面板动作则写入当前已挂载会话的 composer。
- 在一个已属于该空间的会话中打开空间工作台：只打开工作台，不新建。

### 4.4 退出空间

退出空间清除 `agentSpaceId` 并返回全局首页。它不自动返回进入前的会话，也不删除任何会话。旧会话仍可从全局会话列表重新打开。

## 5. 用户体验

### 5.1 新空间会话

新会话主区域保持标准聊天输入体验，顶栏继续使用 Agent accent、头像、会话名与“退出空间”。空白态文案引导用户发送健康截图，或直接描述睡眠、运动和饮食。

### 5.2 右侧空间陪伴面板

健康打卡会话右滑后显示：

1. 空间身份头：Agent 头像、名称和一句轻量说明。
2. Tips Hero：三条固定 Tips 自动轮播。
3. 快速开始：四个健康快捷指令。

不显示通用能力中心中的会话操作、Skills、生成图片、Artifacts、文件等模块。

### 5.3 固定 Tips

首版固定三条：

1. **23:30 前上床**：提前 30 分钟关闭高刺激内容，给大脑一个清晰的入睡信号。
2. **晒 10 分钟自然光**：起床后尽早接触晨光，帮助身体稳定昼夜节律。
3. **留出 7 小时睡眠窗口**：先保证时间窗口，不追求一次就把所有习惯都改好。

交互规则：

- 每 8 秒自动切换。
- 支持点分页圆点手动切换；首版不在面板内增加横向 swipe，避免与 `RightSwipePanelHost` 的右滑关闭手势竞争。
- 用户触摸/手动切换后，当前面板生命周期内暂停自动轮播，避免与用户争抢控制。
- 尊重系统“减少动态效果”偏好；命中时不自动轮播，只允许手动切换。

### 5.4 快捷指令

首版四项：

| 标题 | 填入输入框的提示词 |
|---|---|
| 记录昨晚睡眠 | 帮我记录昨晚的睡眠情况。我会补充睡眠截图或具体时间。 |
| 记录一次运动 | 帮我记录今天的一次运动。我会补充运动类型、时长或截图。 |
| 记录今天饮食 | 帮我记录今天的饮食。我会补充食物、份量或照片。 |
| 总结本周健康 | 请根据本周已有健康记录，帮我总结睡眠、运动和饮食情况，并给出下一步建议。 |

点击快捷指令后：

1. 关闭右滑面板。
2. 把完整提示词写入当前会话 composer。
3. 聚焦输入框并把光标放到末尾。
4. 不自动发送。

## 6. 组件与数据边界

### 6.1 空间入口协调器

新增一个专门 hook（实现时命名可按现场调整），负责：

- 接收 `AgentLauncher`。
- 从现有机器状态解析目标机器，并调用纯函数 `resolveAgentLaunchConfig`。
- 复用 `useSpawnSession` 的空 prompt spawn 能力。
- 保证“spawn 成功 → 关闭选择器 → 写空间状态 → 导航”的顺序，并在同步导航抛错时回滚空间状态。
- 暴露 `entering` 状态，防止重复点击和重复创建。

现有 `useSpawnSession` 当前在内部完成导航并只返回布尔值。实现时把“spawn + 刷新会话 + 应用会话模式”的共用部分抽成返回判别结果 `{ type: 'success'; sessionId: string } | { type: 'cancelled' | 'error' }` 的内部能力；现有 compose-first 入口仍用原 wrapper 自动导航，空间协调器使用不自动导航的 core。目录创建确认的递归重试仍在 core 内部完成，不能复制一份 spawn 流程。

`resolveAgentLaunchConfig` 的字段优先级必须明确并可测试：

1. `AgentLauncher` 上存在的显式 override（当前只会来自 builtin/运行时 Agent）。
2. 设备本地 `useNewSessionDraft` 当前值。
3. 对应 agent type 的 `resolveAgentDefaultConfig(agentDefaultOverrides, agentType)`。

持久化 Agent schema 当前不保存 agent type、permission、model 或 effort，因此普通“我的 Agent”会稳定落到第 2/3 级；本期不扩展这些字段的编辑器。`SpawnSessionArgs.agent` 最终必须是非空值，无法解析时入口返回可见错误而不是猜测。

### 6.2 空间识别

右面板是否属于 Agent 空间，以当前会话 `metadata.machineId + canonicalPath` 匹配用户持久化 Agent 配置。不能直接比较原始 path，也不能只读取 `agentSpaceId`。

抽取共享纯函数 `canonicalizeAgentPath(path, homeDir)`：

- 用机器 `metadata.homeDir` 展开开头的 `~`。
- 把 `\\` 转为 `/`，折叠重复分隔符并移除非根路径的尾部 `/`。
- Windows drive/UNC 路径做大小写不敏感比较；POSIX 路径保持大小写敏感。
- 无法取得 homeDir 且 Agent path 包含 `~` 时返回不可匹配，不做字符串猜测。

`matchAgentForSession` 同时接收机器列表、Agent 列表和当前 `agentSpaceId`：

1. 先筛出 machineId 与 canonical path 都匹配的候选。
2. 若当前 `agentSpaceId` 指向候选，优先返回该 Agent。
3. 若只有一个候选，返回它。
4. 若存在多个候选且没有空间 id 消歧，返回 `null` 并回退通用能力中心，不能任意选择。

Agent 编辑保存时也用同一 canonical key 阻止新增重复的 `machineId + path` 组合；历史重复项不自动删除。

- 用户可能从历史会话或深链直接进入空间会话。
- `agentSpaceId` 是抽屉/工作台状态，不应成为会话内容分类的唯一事实来源。
- 删除或修改 Agent 配置后，匹配失败即回退普通会话能力中心。

顶栏、右面板和 `useAgentSpaceSessions` 必须复用同一 canonical matcher，避免刚创建的绝对 cwd 会话从空间列表/皮肤/陪伴面板中消失。

### 6.3 稳定的空间 provider 标识

持久化 Agent 的共享 `AgentLauncherListSchema` 增加 `spaceType: z.enum(['default', 'health']).default('default')`。解析后的 `AgentLauncher` 类型中该字段必有值。`health` 是决定健康报告与健康陪伴 provider 的唯一稳定标识；展示组件不再调用 `path.includes('健康打卡')`。

为了保留当前已经存在的健康打卡 Agent，在 `LocalSettingsSchema` 解析之前对原始 `settings.agents` 做一次确定性预处理：旧记录没有 `spaceType` 且现有 `isHealthCheckinSession(path)` 命中时补为 `health`，其余补为 `default`，再交给共享 Zod schema。补全后的值在下次 agents 设置写入时持久化；之后即使路径改名，provider 仍由 `spaceType` 决定。

`AgentLauncherListSchema` 也被旧的同步 `SettingsSchema.agents` 复用，因此共享字段必须保留 `.default('default')`，确保旧同步 settings 不因缺字段整体解析失败。旧同步字段只是兼容数据，不参与运行时空间 provider；健康迁移只对运行时真源 `localSettings.agents` 的 raw 数据执行。

Agent 编辑器保存时：编辑现有 Agent 必须保留 `existing.spaceType`；新建 Agent 才按当前 `isHealthCheckinSession(path)` 进行一次初始推断。该启发式只负责给没有显式类型的新/旧数据赋初值，不参与运行时 provider 路由。本期不新增用户可见的类型选择器，避免把内部 provider 配置扩成设置功能。

### 6.4 面板路由

移动端 `SessionView` 继续使用现有 `RightSwipePanelHost`，只替换 `panelContent` 的选择：

```text
spaceAgent == null
    → SessionCapabilityHub

spaceAgent?.spaceType == 'health'
    → AgentSpaceCompanionPanel(health model)

spaceAgent != null && no dedicated provider
    → AgentSpaceCompanionPanel(agent presets only)
```

普通会话的通用能力中心不改。

### 6.5 陪伴面板模型

面板消费一个纯视图模型：

```ts
type AgentSpaceCompanionModel = {
    title: string;
    subtitle?: string;
    tips: Array<{
        id: string;
        eyebrow: string;
        title: string;
        body: string;
    }>;
    actions: Array<{
        id: string;
        icon: string;
        title: string;
        prompt: string;
    }>;
};
```

首版 provider：

- `health`: 返回固定三条 Tips 和四个健康动作。
- `default`: `tips` 为空，只把 `agent.presets` 映射成 actions。

组件只负责布局、轮播、手势和点击回调，不读取健康文件、不调用 Agent，也不决定 prompt 内容。未来的数据规则 provider 或 Agent provider 只需返回同一模型。

## 7. 状态与并发

- 进入按钮在 spawn 期间禁用并显示“正在进入…”。
- 同一入口流程只允许一个进行中的 spawn。
- `agentSpaceId` 只在 spawn 成功后更新。
- 若同步导航调用抛错，回滚进入前的 `agentSpaceId`；已创建会话仍保留在会话列表，入口状态必须释放，用户可重新打开。
- Agent 选择器在 spawn 开始时保持可见但禁用目标项，只有 spawn 成功后关闭；spawn 失败时用户仍留在原上下文并可重试。若关闭后发生同步导航异常，空间状态会回滚，用户仍停留原路由，但选择器不自动重开。
- 快捷指令填充使用当前会话已有的 composer imperative handle，避免只改父状态却不更新原生非受控输入框。
- Tips 当前索引是面板实例的瞬时 UI 状态，不写入同步设置。

## 8. 无障碍与动效

- Tips 分页点、快捷指令和退出按钮提供可读的 accessibility label/role。
- 快捷指令卡和分页点的点击区域至少为 44×44 dp；分页点可用视觉元素小于 44 dp，但外层 Pressable 必须满足命中区域。
- Tips 当前页除视觉形态外提供 `accessibilityState={{ selected: true }}`，不只依赖颜色。
- 通过 `AccessibilityInfo.isReduceMotionEnabled()`（并监听运行时变化）控制轮播；开启减少动态效果时不启动 8 秒 timer，也禁用非必要过渡动画。
- 面板关闭并完成动画后调用 composer handle 的 `setTextAndSelection` 与 `focus`，光标位于提示词末尾；读屏焦点顺序回到输入区。
- 首版不注册 Tips 横向 Pan gesture，只用分页点手动切换，确保不与 `RightSwipePanelHost` 的关闭手势竞争。

为提供稳定的动画完成边界，`RightSwipePanelContextValue.closePanel` 做向后兼容的最小扩展：`closePanel(onClosed?: () => void): void`。`RightSwipePanelHost` 只在 `withSpring(0)` 的 completion 收到 `finished === true`、且完成 `setOpen(false)` 后调用一次 `onClosed`；现有无参数调用保持不变。健康快捷指令把 composer 填充与 focus 放进该回调，测试不使用任意 timeout 猜动画结束。

## 9. 国际化

所有用户可见文案通过 `t(...)` 获取。英文运行时与 key 类型的真源是 `sources/text/_default.ts`，必须先更新它；再同步 `sources/text/translations/` 下的全部语言文件（包括当前未被 `text/index.ts` 直接导入的 `en.ts`，以及 `ru`、`pl`、`es`、`ca`、`it`、`pt`、`ja`、`zh-Hans`、`zh-Hant`）。健康 Tips 与动作标题/提示词也属于用户可见文案，不在组件中硬编码。

## 10. 测试与验证

### 10.1 单元测试

- 健康 provider 返回三条固定 Tips 和四个快捷动作。
- default provider 只映射 Agent presets，不混入健康 Tips。
- `canonicalizeAgentPath` 表驱动覆盖 `~` 展开、POSIX 尾斜杠、Windows `\\`、盘符大小写、UNC 和缺失 homeDir。
- `matchAgentForSession` 覆盖唯一候选、`agentSpaceId` 消歧、重复 Agent 无法消歧时回退、普通会话未匹配。
- `spaceType` 解析覆盖显式 health/default、旧健康路径一次性补全和普通旧 Agent 默认值。
- 旧同步 `SettingsSchema.agents` 缺少 `spaceType` 时仍能解析，且不会导致整个 settings 回退。
- Agent 编辑器覆盖“编辑保留 spaceType”“新建只推断一次 spaceType”“canonical machine/path 重复时禁止保存”。
- `resolveAgentLaunchConfig` 覆盖运行时 override、draft fallback、agent defaults fallback 和 agent type 无法解析。
- 面板分流在空间/普通会话之间选择正确组件模型。
- 入口协调器只在 spawn 成功后写入空间状态。
- 离线、取消目录创建、spawn 错误不写空间状态且不导航。
- 同步导航抛错会回滚进入前的 `agentSpaceId`，但不删除已经创建的会话。
- 重复点击在 `entering` 期间不会创建多个会话。
- AgentSheet 进入、工作台“新建会话”和工作台 preset 三个创建入口均调用同一协调器；preset 只填入新会话 composer。
- 快捷指令回调传递正确 prompt，不触发发送。
- 使用 fake timers 验证 8 秒切换、手动点分页后暂停、组件卸载清 timer、reduce-motion 时不启动 timer。
- 分页点有 selected accessibility state；动作与分页命中区域满足 44×44 dp。
- 快捷指令在面板关闭后调用 composer `setTextAndSelection` 和 `focus`，并把光标放到末尾。
- `closePanel(onClosed)` 只在 spring 真正完成后调用一次回调；动画中断时不调用。
- 工作台 preset 在导航前通过 `updateSessionDraft(sessionId, prompt)` 交接，目标会话首次挂载恢复 draft，且不发送消息。
- Tips 没有注册横向 Pan，右面板关闭手势保持原行为。

### 10.2 静态验证

- 运行相关 happy-app Vitest 文件，使用：

  ```bash
  pnpm --filter happy-app exec vitest run <target files>
  ```

- 运行：

  ```bash
  cd packages/happy-app && pnpm typecheck
  ```

- 检查 `_default.ts` 与 `translations/` 全部语言文件包含新增 keys。

### 10.3 真机验收

通过功能分支 PR 触发 Android preview OTA。至少验证：

1. 在普通会话中打开 Agent 列表并点击“健康打卡”。
2. App 创建并打开一条没有旧消息的空白健康空间会话。
3. 原普通会话仍可从全局会话列表找回。
4. 右滑只显示健康空间陪伴面板。
5. Tips 每 8 秒自动切换；点分页后停止自动切换；开启系统减少动态效果后不自动切换。
6. 点击四个快捷指令分别关闭面板并填入输入框，且没有自动发送。
7. 填入后输入框获得焦点，光标位于文本末尾；TalkBack 能读出动作与当前分页状态。
8. 右滑关闭陪伴面板仍流畅，不被 Tips 内部手势抢占。
9. 退出空间回全局首页。
10. 普通会话右滑仍显示原通用能力中心。
11. 机器离线或 spawn 失败时停留在原会话，不进入空间状态。

## 11. 验收标准

- [ ] 从空间外进入持久化 standard Agent 会立即新建空白空间会话；`image-styles` 保留专用 compose 例外。
- [ ] 新空间会话不包含原会话消息，也不包含隐藏初始化消息。
- [ ] 原会话未被删除或归档。
- [ ] 健康空间右滑面板没有通用代码能力卡片。
- [ ] 面板展示三条固定 Tips 和四个健康快捷指令。
- [ ] 快捷指令只填入 composer，不自动发送。
- [ ] 非健康空间只展示 Agent presets，不显示健康 Tips。
- [ ] 普通会话通用能力中心无回归。
- [ ] 离线、目录取消和 spawn error 等 pre-spawn 失败不会写入错误 `agentSpaceId`，也不会创建空会话；post-spawn 同步导航异常允许保留一条可从会话列表找回的空白会话，重试可能再创建一条，不承诺自动去重或删除。
- [ ] `~`、绝对路径、尾斜杠和 Windows 分隔符均能稳定匹配同一空间；重复 Agent 不会被随机选择。
- [ ] 8 秒轮播、手动暂停、reduce-motion、分页无障碍状态和 44×44 dp 命中区域均有自动化或真机证据。
- [ ] 快捷指令关闭面板后获得 composer 焦点，光标位于提示词末尾。
- [ ] Tips 不注册横向 Pan，右滑关闭面板无手势回归。
- [ ] 相关测试与 typecheck 通过。
- [ ] PR preview OTA 已发布并提供 Update ID/manifest 给真机验收。

## 12. 后续 Feature

本期静态 provider 交付后，可按独立 Feature 逐步增加：

1. 读取近 7 天结构化健康日志，用确定性规则生成个性化 Tips。
2. 在规则结果不足时调用健康 Agent 生成补充建议。
3. 给每条 Tip 显示数据依据、时间范围与可执行目标。
4. 支持用户关闭、收藏或反馈 Tip，反哺下一轮排序。

这些扩展必须沿用 `AgentSpaceCompanionModel` 边界，避免把健康解析或 Agent 调用塞进展示组件。
