# 我的 Agent — 侧栏快捷 Agent 入口 设计文档

> 2026-06-30 · 分支 `agent-launcher`
> 恢复的原始参考图：`docs/plans/assets/2026-06-30-agent-launcher-reference.jpg`

## 一、要解决的问题

侧栏需要一张可配置的卡片：每个 **Agent 入口** = 一台机器 + 一个固定文件夹（里面已备好对应 skills）+ 一组预设指令。点进去直接在该目录起会话，预设指令一键填入，省掉每次手选机器、找目录、敲重复开场白。

典型场景：「工作日程」Agent → `mac-mini : ~/work/schedule`（滴答清单 skills），预设「看今天工作事项 / 记录工作事项 / 本周复盘」。

灵感来源：Kimi app 的「Kimi Claw」卡片（仅作交互参考，不进代码/文档）。

## 二、交互流程（流程 A · 预填 Compose）

```
侧栏「我的 Agent」卡片
  └─(点)→ 底部抽屉 AgentSheet，列出各 Agent
            └─(点在线 Agent)→ 写 draft(机器+目录) + 跳转 /new?agentId=xxx
                                └─ ComposeHome 预填：问候 + 目标 chip + 预设指令卡片
                                     └─(点预设)→ setInput(prompt) 填入输入框并聚焦（不自动发）
                                     └─(发送)→ 现有 useSpawnSession 起会话+建目录+跳转
```

关键决策（已与用户确认）：
- **存储**：同步设置 `SettingsSchema`（跨设备同步），不放本地设置。
- **预设点击**：填入输入框待编辑，**不自动发送**。
- **命名**：「我的 Agent」。

## 三、复用现状（不重复造轮子）

| 能力 | 现成实现 | 复用方式 |
|------|----------|----------|
| 预填新建会话 | `useNewSessionDraft`（`setMachineId/setPath/setInput`）+ `ActiveSessionsGroupCompact.handleAdd` 范例（设 draft → `router.navigate('/new')`） | launcher 照搬，额外带 `?agentId=` 路由参 |
| 起会话/建目录/跳转 | `useSpawnSession` | 不改，ComposeHome 发送时自然走它 |
| 同步设置数组字段 | `SettingsSchema.recentMachinePaths: {machineId,path}[]` 先例 | 新增 `agents` 字段同款 |
| 机器在线判断 / 列表 | `isMachineOnline` / `useAllMachines` | 直接用 |
| 机器/路径选择组件 | `SessionConfigPanel` 内的选择器 | 配置页复用 |

## 四、组件设计

### 1. 数据模型（`sync/settings.ts`）
`SettingsSchema` 新增：
```ts
agents: z.array(z.object({
  id: z.string(),
  name: z.string(),
  glyph: z.string(),          // 头像单字
  color: z.string(),          // 头像底色
  machineId: z.string(),
  path: z.string(),
  presets: z.array(z.object({ label: z.string(), prompt: z.string() })),
})).default([]).describe('用户配置的「我的 Agent」快捷入口')
```
默认 `[]`，旧客户端数据合并时自动补默认（沿用现有 settings merge 机制）→ 向后兼容。

### 2. 侧栏卡片（`components/SidebarView.tsx`）
插在「新建会话」按钮与「历史会话」之间。标题「我的 Agent」+ `+ 添加`，下方一排 Agent 迷你头像（在线/离线点）。点卡片主体 → 打开 AgentSheet；点 `+ 添加` → 跳 `/settings/agents`（新建态）。`agents` 为空时显示引导态（「+ 添加你的第一个 Agent」）。

### 3. AgentSheet（新组件 `components/AgentSheet.tsx`）
底部抽屉。每行：头像 / 名称 / `机器 · 路径`（mono）/ 在线点 / chevron。
- 在线 → `setMachineId(a.machineId); setPath(a.path); setSessionType('simple'); setInput(''); router.navigate('/new?agentId='+a.id)`（注意顺序：先 machine 后 path，因 `setMachineId` 会清空 path）。
- 离线 → 置灰 + 轻提示「机器离线」。
- 机器在 `useAllMachines` 中不存在 → 标「机器不存在」，不可起。

### 4. ComposeHome 改造（`components/ComposeHome.tsx`）
读 `agentId`（`useLocalSearchParams`）。若命中某 Agent：
- 顶部问候个性化（「进入 {name}」）。
- 渲染「预设指令」卡片区（来自 `agent.presets`）。
- 点预设 → `draft.setInput(preset.prompt)` 并聚焦输入框，不自动发。
- 无 `agentId` 或未命中 → 行为与现状完全一致（零回归）。

### 5. 配置页（`app/(app)/settings/agents.tsx` + 编辑表单）
- 列表：现有 Agent，支持进入编辑 / 删除 / 排序（排序可后置）。
- 新增/编辑表单：名称、机器选择器、文件夹路径选择器、预设指令编辑（增删 label+prompt）、头像字+底色（可给默认）。
- 保存 → `applySettings({ agents: [...] })`。
- 入口：侧栏卡片「+ 添加」、AgentSheet「管理」、设置页列表项。

## 五、边界与异常

| 场景 | 处理 |
|------|------|
| 机器离线 | AgentSheet 置灰 + 提示，不起会话 |
| 机器被删/不存在 | 标「机器不存在」，不可起；配置页可改机器 |
| 预设为空 | 只预填目标，ComposeHome 不显示预设区 |
| 目录不存在 | 复用现有 `useSpawnSession` 的「创建目录」确认流 |
| 旧版本无 `agents` 字段 | settings merge 默认 `[]` |

## 六、范围与测试

- **范围**：手机 + 平板（共用 `SidebarView`）；i18n 文案补齐。
- **测试**：
  1. settings schema 迁移：旧数据解析后 `agents === []`。
  2. launcher helper：设 draft 顺序正确（machine→path，path 不被清空），路由参带上 agentId。
  3. AgentSheet：离线 Agent 置灰不可点；点在线触发导航。
  4. ComposeHome：有 agentId 渲染预设、点预设填入 input 不发送；无 agentId 无回归。

## 七、工程纪律

- 在 `jacky-main` 拉 sibling worktree `happy--agent-launcher`（分支 `agent-launcher`）开发。
- worktree 内 `pnpm install`（pnpm monorepo，禁 symlink node_modules）。
- 合并后同步 `jacky-main` 并清理 worktree。
