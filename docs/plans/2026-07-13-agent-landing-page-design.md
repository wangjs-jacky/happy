# 通用 Agent 落地页 — 设计方案

> 目标：把"点 Agent 磁贴"从**要等 spawn、进去光秃秃、找不回旧会话**，改造成**秒开的落地页**：顶部按 Agent 派生的引导、中间该 Agent 的最近会话（点一下秒回）、底部保留组合框（新建打卡）。一屏覆盖"引导 / 找回 / 新建"。

- 状态：设计稿（待评审）
- 分支：`health-onboarding`（sibling worktree），本特性是 PR #181「健康 Agent 首次交互优化」的续作，依赖其已引入的 `HealthWelcomeCard` / `isHealthCheckinSession` / `sessionWorkingPath` / `spawnPath`
- 影响仓库：`happy`（仅 happy-app 的 JS/TSX + i18n）→ 走 OTA，无原生改动
- 关联：Agent 启动器 PR（`docs/plans/2026-06-30-agent-launcher-design.md`）、健康 onboarding（`docs/plans/2026-07-11-health-agent-onboarding-design.md`）

---

## 一、背景

"我的 Agent" = 用户保存的一组会话启动器（`AgentLauncher`：`id / name / glyph / color / machineId / path / presets / agentType / permissionMode …`），存在本地 `useLocalSetting('agents')`，另有一个内建 App-builder Agent。

当前入口链路（已核实）：

```
点 Agent 磁贴 (AgentSheet)
  → launchAgent(agent, draft, navigate)   // 预填 draft：先 machineId 后 path，再 agentType…
  → router.navigate('/new?agentId=<id>')   // ComposeHome（组合页）
```

`ComposeHome`（`/new`）是**先写后发**：读 `agentId` 查出 `activeAgent`，展示问候 + 预设提示词，`useSpawnSession` **仅在用户真正发送时** `machineSpawnNewSession` 起远端进程（= 慢的那一下）。进入组合页本身不 spawn、是秒开的；预设是"填充不自动发"。

会话数据（`storageTypes.ts`）：每个 `Session` 带 `metadata.machineId`、`metadata.path`、`spawnPath`（本地兜底）、`createdAt/updatedAt`。取工作目录统一走 `sessionWorkingPath(session) = metadata.path ?? spawnPath`。仓库已有多处按 `metadata.machineId`(+path) 过滤会话的先例（`machine/[id].tsx:165`、`my-agent-edit.tsx:92`、`SessionConfigPanel.tsx:787`）。

## 二、三个痛点与根因

| # | 痛点 | 根因（已在代码中核实） |
|---|------|------------------------|
| ① | 进去没引导，不知道要发截图 | `ComposeHome` 有问候+预设，但无"我是你的健康管家、丢张截图我来记"这种强引导。已建好的 `HealthWelcomeCard` 目前**只在已 spawn 的空会话内**出现（`SessionView.tsx:727-739`），进入前看不到 |
| ② | 每次进入"要等很久" | 真正慢的不是"进入"，是"发第一条时 spawn 新进程"（远端起进程，天然几秒）。用户当前正式版是"点了直接 spawn 空会话"的旧行为，所以把等待感前置到了"进入" |
| ③ | 想找回之前的会话很慢 | Agent 磁贴每次只走"新建"路径，`ComposeHome` 没有"这个 Agent 最近几次会话"的入口。数据是有的（按 machineId+path 可过滤），只是没露出 |

关键洞察：**②③ 同源** —— 都因为"点 Agent = 只有新建这一条路"。给落地页补上"最近会话"入口，既让找回秒开，也让"新建"回归为一个显式选择而非唯一出口。

## 三、目标 / 非目标

**目标**
- 点 Agent 磁贴 → 落地在一个**秒开**的落地页（不 spawn）。
- 落地页三段式：**引导区**（按 Agent 派生）+ **最近会话**（本 Agent，点=秒回带历史）+ **组合框**（新建打卡，底部可直接拍照/发截图）。
- 通用：所有 Agent 都得到该结构；健康 Agent 得到富引导（复用欢迎卡内容），其它 Agent 得到极简派生引导。

**非目标（本轮明确不做）**
- 不优化 spawn 速度（预热 / 乐观 UI）—— 全新打卡发第一条仍等几秒，用户已确认可接受。
- 不做 Agent 可编辑的"自定义简介"字段 —— 引导内容全部**自动派生**，不新增存储字段。
- 不碰跨设备 `metadata` 派生 `spawnPath` 的遗留（onboarding 设计的开放问题 M3）。

## 四、方案总览

**结构选型**

- **方案 A（采用）**：升级现有 `/new?agentId=` 的 `ComposeHome`。当 `activeAgent` 存在时，在组合框上方（可滚动区）插入「引导区 + 最近会话」两个区块。复用现有 compose 全部基建，**一屏、底部即相机**，对"丢截图"最快。新区块抽成独立小组件，避免 `ComposeHome` 臃肿。
- 方案 B（否决）：新开 `/agent/:id` 独立落地页，"新建"再跳 compose。分层更干净，但**多一次点击才够到相机**，且要重复一套引导/问候逻辑。

**布局**

```
┌───────────────────────────┐
│ ← 啊                    ⚙︎ │   现有 header
│                           │
│   ❤️  健康打卡              │   引导区（AgentLandingIntro）
│   丢一张截图，我来帮你记      │
│   🌙睡眠  🏋️运动  🍽️饮食     │
│                           │
│   最近                     │   最近会话（AgentRecentList）
│   · 今天 21:05 · 睡眠 7h20m │
│   · 昨天    · 3 条          │
│   · 07-11  · 午餐 620kcal   │
├───────────────────────────┤
│ 📎 📷  输入消息…       ↑   │   现有组合框（唯一 spawn 路径）
└───────────────────────────┘
```

## 五、引导区（AgentLandingIntro）

按 Agent **自动派生**，无配置：

- **健康 Agent**：`isHealthCheckinSession(agent.path)` 命中 → 渲染富引导，**直接复用 `HealthWelcomeCard` 的内容**（健康管家角色 + "丢一张截图，我来帮你记" + 睡眠/运动/饮食三域 + hint）。落地页与会话内空态共用同一份视觉与文案，单一来源。
- **其它 Agent**：极简派生 —— 头像（`agent.glyph` + `agent.color`）+ `agent.name` + 一行 `machineName · agent.path`。零配置即用。

派生逻辑抽为纯函数 `resolveAgentIntroKind(agent): 'health' | 'generic'`（便于单测），组件按 kind 选择渲染分支。

> 会话内的 `HealthWelcomeCard`（空会话安全兜底）**保留不动**；落地页只是把同样的引导提前到"进入前"。

## 六、最近会话（AgentRecentList）

**纯函数**（新增，单测覆盖）：

```
recentSessionsForAgent({ agent, sessions, machines, limit = 5 }): Session[]
```

- 过滤：`session.metadata?.machineId === agent.machineId`
  且 `resolveAbsolutePath(sessionWorkingPath(session), homeDir) === resolveAbsolutePath(agent.path, homeDir)`
  （`homeDir` 取自该 machine 的 `metadata.homeDir`，解决 `~/…` 与绝对路径的比对；解析先例见 `useSpawnSession`）。
- 排序：`updatedAt` 倒序。
- 截断：取前 `limit`（默认 5，落地页展示 3~5）。

**行渲染**：相对时间（今天/昨天/`MM-DD`）+ 一句摘要（复用现有会话标题/末条消息预览逻辑）。点击 → `navigateToSession(session.id)`（秒回、带历史）。

"查看全部 →"：仅当匹配会话数 > `limit` 时出现，跳到按该 Agent 过滤的会话列表。**本轮无现成的"按 path 过滤会话列表"视图，故 v1 省略此入口**（前 5 条足够覆盖高频找回）；后续需要再补。

**边界**
- 无匹配会话 → 隐藏该区（不占位），或一句"还没有记录，丢张截图开始吧"（二选一，实现时定，倾向隐藏 + 让引导区 hint 承担引导）。
- machine 离线/缺失 → 会话仍在本地 storage，照常列出、点击照常查看历史。
- 路径大小写/结尾斜杠 → 解析后统一比对（在纯函数内归一）。

## 七、数据与可行性

- 依赖字段均已存在：`Session.metadata.{machineId,path}`、`Session.spawnPath`、`createdAt/updatedAt`。
- 取路径统一 `sessionWorkingPath()`；路径归一 `resolveAbsolutePath()`（`utils/pathUtils`）。
- 会话集合、machines 均有现成 hook（`useAllMachines`、storage sessions）。
- 无需服务端改动，无需新增上行字段。

## 八、落地的活儿（文件级）

- **新增**
  - `sync/recentSessionsForAgent.ts`（纯函数）+ `recentSessionsForAgent.spec.ts`
  - `components/agents/AgentLandingIntro.tsx`（按 kind 渲染健康富引导 / 极简派生）
  - `components/agents/AgentRecentList.tsx`（最近会话列表 + 空态）
  - `resolveAgentIntroKind` 纯函数 + spec（可并入 intro 组件同目录）
- **修改**
  - `components/ComposeHome.tsx`：`activeAgent` 存在时在可滚动区渲染 `AgentLandingIntro` + `AgentRecentList`（组合框保持不动）
  - 复用 `components/rightPanel/HealthWelcomeCard.tsx`（健康引导内容源）
- **i18n**：`text/_default.ts` 先写英文（类型 source of truth），再补全 `translations/{zh-Hans,zh-Hant,en,ja,ru,pl,es,it,pt,ca}.ts`（"最近"、"查看全部"、空态提示等）。用 i18n-translator agent 校验。

## 九、测试

沿用仓库约定：**node vitest、纯逻辑、不写 RN 渲染测试**（`describe/it/expect`）。

- `recentSessionsForAgent`：过滤（machineId/path 命中与不命中）、`~` 与绝对路径归一、排序、截断、空集合。
- `resolveAgentIntroKind`：健康路径 → `'health'`；其它 → `'generic'`；空/异常路径兜底。
- 相对时间格式化若新增，补边界（今天/昨天/跨年）。
- 跑单文件：`cd packages/happy-app && pnpm test <相对路径>`；合入前全量 `pnpm test` + `pnpm typecheck` 绿。

## 十、发布与回归

- 纯 JS/TSX + i18n，**无原生改动、不改 runtimeVersion** → 走 OTA。
- 完成后按仓库默认闭环发 **preview OTA**（`pnpm ota:selfhost:preview`）给真机验收，回复附 `<happy-ota-preview>` 卡片。
- 真机验收点：点健康 Agent → 秒开落地页 → 见富引导 + 最近会话；点最近一条 → 秒回带历史；底部拍照发送 → 正常 spawn 新会话；点其它 Agent → 见极简派生引导。

## 十一、风险与开放问题

- **R1 路径比对**：Agent 的 `path`（可能 `~/…`/相对）与会话 `metadata.path`（绝对）需归一，否则最近会话漏配。→ 纯函数内 `resolveAbsolutePath` + 归一，单测覆盖 `~` 场景。
- **R2 ComposeHome 体积**：该组件已较大。→ 新逻辑全部抽独立小组件/纯函数，`ComposeHome` 只做组合与门控。
- **R3 空态取舍**：无最近会话时"隐藏"还是"提示" —— 倾向隐藏，引导区 hint 已承担引导；实现时最终定。
- **O1**（开放）：其它非健康 Agent 后续若想要富引导，再引入可编辑"简介"字段（本轮 YAGNI 不做）。

## 十二、交付物清单

- [ ] `recentSessionsForAgent.ts` + spec（纯函数，绿）
- [ ] `resolveAgentIntroKind` + spec
- [ ] `AgentLandingIntro.tsx`（健康富引导复用 `HealthWelcomeCard` / 极简派生）
- [ ] `AgentRecentList.tsx`（列表 + 空态 + 点击秒回）
- [ ] `ComposeHome.tsx` 接入（`activeAgent` 门控）
- [ ] i18n 全 11 文件补齐（`_default.ts` + 10 语言）
- [ ] `pnpm test` + `pnpm typecheck` 全绿
- [ ] preview OTA 发布 + 真机验收记录 + `<happy-ota-preview>` 卡片
