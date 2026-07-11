# 健康 Agent 首次交互优化 — 设计方案

> 目标：把"健康打卡 Agent"从**点进去冷冰冰、要先发『你好』、回复啰嗦**，改造成**进去即有引导、面板即刻正确、回复只留一句『已存入』**的顺滑体验。

- 状态：设计稿（待评审）
- 分支：`health-onboarding`（sibling worktree）
- 关联：健康面板 PR #174（睡眠/运动/饮食右面板，已并入 main）
- 影响仓库：`happy`（happy-app）+ Obsidian 仓库中的 `人生辅助系统/健康打卡/CLAUDE.md`（配置，不在 happy repo）

---

## 一、背景

"健康打卡 Agent" = 一个普通 Claude Code 会话，工作目录是 Obsidian 仓库里的
`人生辅助系统/健康打卡/`，靠该目录下一份 `CLAUDE.md` 定义人设与日报格式。用户把
运动/睡眠/饮食截图丢进对话，Agent 看图、提数、写进 `日报/YYYY-MM-DD.md` 的 YAML
frontmatter。Happy App 侧已有 `HealthCheckinPanel`（睡眠 Hero + 趋势 + 今日打卡 +
运动/饮食域切换），从这些日报文件读盘并渲染。

面板识别健康会话的方式（现状，`SessionView.tsx:335` 附近）：

```ts
const rightPanel = isHealthCheckinSession(session?.metadata?.path)
  ? <HealthCheckinPanel .../>
  : <SessionCapabilityHub .../>;   // 通用「能力中心」
```

`isHealthCheckinSession(path) = !!path && path.includes('健康打卡')`。

## 二、三个痛点与根因

| # | 痛点 | 根因（已在代码中核实） |
|---|------|------------------------|
| 1a | 首次响应**慢** | 会话在 Obsidian 深层目录，Claude Code 会加载一路 `CLAUDE.md`：全局（极大）+ `jacky-obsidian/` + `人生辅助系统/` + `健康打卡/`，叠加导致首响慢、且诱导啰嗦 |
| 1b | Agent **不会主动打招呼**，必须先发『你好』 | Claude Code 会话天生等人类先发话，Agent 无法在用户开口前先说话 |
| 2 | **首次进入右侧永远是「能力中心」**，发一句后才变健康面板 | 面板判断只认 `session.metadata.path`；**冷启动（空会话）时 metadata 尚未同步、path 为 null** → `isHealthCheckinSession(null)=false` → 落到能力中心。发一句让会话激活后，metadata 带 path 回来才切对。**用户目录一直是对的**，纯粹是"path 在冷启动那一刻还没到手" |
| 3 | 回复**啰嗦**：丢图后逐张讲解、输出大量无关内容 | 现版 `CLAUDE.md` 虽写了"一句话小结"，但约束不够硬；叠加全局巨型 CLAUDE.md 的"详尽/展示过程"倾向，Agent 倾向长篇 |

关键洞察：**问题 2 与问题 1b 同源** —— 都是"会话冷启动态"缺信息。补齐冷启动态即可
同时解锁"面板即刻正确"和"进去就有欢迎卡"。

## 三、目标 / 非目标

**目标**
- 进入空的健康会话：右侧**立刻**是健康面板（不再需要先发一句）。
- 进入空的健康会话：主聊天区**瞬间**出现一张静态欢迎卡（角色 + 能记什么 + 引导）。
- 同时后台让 Agent 补一句有温度的问候（不阻塞、失败不影响体验）。
- 丢图后 Agent 默认只回一行 `已存入 · <关键数字>`，不再啰嗦。
- 健康面板无数据时，空态是一个雅致的"休眠视觉"，而非一行灰字。

**非目标（本轮不做）**
- 不改全局 `~/.claude/CLAUDE.md`（那是用户全局配置，跨项目影响面大）。
- 不做通用的"任意 Agent 类型 → 专属面板/欢迎卡"框架（先健康一个场景，硬编码识别可接受）。
- 不改 CLI/daemon 让其"spawn 即推 metadata"（作为未来优化列入开放问题）。

## 四、方案总览

分 5 块，Phase 1 纯配置可独立先落地；Phase 2.x 全在 happy-app（JS/TSX，**可走 OTA**）。

| Phase | 内容 | 层 | 依赖 |
|------|------|----|------|
| 1 | 重写 `健康打卡/CLAUDE.md`（静默消化 + 只回一行 + 契约不动） | 配置（Obsidian 仓库） | 无 |
| 2.0 | 本地缓存会话工作路径，冷启动即可识别健康会话 → 修问题 2 | happy-app | 无 |
| 2a | 空健康会话的静态欢迎卡 | happy-app | 2.0 |
| 2b | 后台隐藏问候（隐藏消息机制 + Agent 补一句） | happy-app | 2.0 |
| 2c | 健康面板无数据时的休眠空态 | happy-app | 无（可与 2a 共用视觉） |

---

## 五、Phase 1 — 重写 `健康打卡/CLAUDE.md`（配置）

**文件**：`/Users/jiashengwang/jacky-github/jacky-obsidian/人生辅助系统/健康打卡/CLAUDE.md`
（当前 211 行；**不在 happy repo**，改完需触发 Obsidian 同步）。

### 5.1 核心改动

1. **顶部立铁律（新增，置于人设之后、工作流之前）**：
   > 收到图片/数据后：**静默看图 → 提数 → 落盘**，默认**只回一行**：
   > `已存入 · <一句关键数字>`（例：`已存入 · 昨晚 7h20m / 评分 82`）。
   > 除非用户明确追问，**不要**逐张讲解、不复述提取过程、不列 frontmatter、不写小作文。

2. **加 ✅/❌ 输出样例**（让"一行"可对照）：
   - ❌（现状）：整段"我看到第一张是睡眠截图，识别到总时长…第二张是运动…已写入日报，包含以下字段…"
   - ✅：`已存入 · 昨晚 7h20m/评分82，跑步 5km/320kcal`

3. **主干瘦身**：把"存原图机制 / UTC 时区换算 / cd 中文路径踩坑 / 自检清单"等**操作细节**下沉到文末「附录：落盘操作细则」。主干只保留：我是谁、收到图怎么做（4 步）、日报 YAML 契约。目的：降低主干噪音（顺带略降 token）。

4. **数据契约（YAML schema）一字不动**：面板 `parseHealthLog`（`utils/healthLog.ts`）
   靠定向正则抽取，字段名/格式漂移会导致面板显示「—」。权威字段保持：
   - 睡眠：`总时长`(XhYm) / `深睡` / `浅睡` / `快速眼动` / `日间小睡` / `评分`(纯数字) / `质量`(文字) / `入睡` / `起床`
   - 运动：`类型` / `消耗卡路里`(纯数字)
   - 饮食：`餐` / `卡路里`；汇总 `摄入卡路里`
   - 时长一律 `XhYm`；缺失整行省略、禁止 `null`/编造。

### 5.2 验收
- 丢一张睡眠截图 → Agent 回一行 + `日报/今天.md` 出现合规 frontmatter。
- 面板下拉刷新后，睡眠 Hero 正确显示时长/评分（证明契约未破）。

---

## 六、Phase 2.0 — 本地缓存会话工作路径（happy-app）

**问题**：`isHealthCheckinSession` 依赖 `session.metadata.path`，冷启动为 null。
**思路**：客户端在 spawn 时**就知道目录**（`machineSpawnNewSession({ directory })`），
拿到 `sessionId` 后把 `{sessionId → directory}` **本地缓存并持久化**；`metadata.path`
到手后再刷新。识别时优先用 `metadata.path`，为空则回退缓存。

仿现有本地字段模式（`draft` / `permissionMode` / `modelMode` / `effortLevel`：在
`storage.ts` 本地持久化、`applySessions` 合并时"本地优先/兜底"）。

### 6.1 数据模型
- `Session` 增本地字段：`spawnPath?: string | null`（`storageTypes.ts`）。仅本地，不参与 E2E/上行。
- 本地持久化：新增一份 `sessionId → spawnPath` 映射（同 drafts 的存法），app 重启后仍在。

### 6.2 统一取值 helper（新增）
```ts
// 会话真实工作目录：优先服务端 metadata，其次本地 spawn 缓存
export function sessionWorkingPath(session?: Session | null): string | null {
  return session?.metadata?.path ?? session?.spawnPath ?? null;
}
```
`SessionView` 改为 `isHealthCheckinSession(sessionWorkingPath(session))`。

### 6.3 写入时机
- **spawn 播种**：三处 spawn 调用点（`app/(app)/machine/[id].tsx`、
  `components/ComposeHome.tsx`、`hooks/useSpawnSession.ts`）在 `type:'success'` 后，
  以返回的 `sessionId` + 本地 `absolutePath` 调 `updateSessionSpawnPath(sessionId, path)`。
- **metadata 刷新**：`applySessions` 里当 `metadata.path` 有值时，顺带更新缓存
  （让"非本机 spawn、但曾激活过"的会话也留下路径，之后冷启动仍识别）。

### 6.4 边界与取舍
- **跨设备冷启动**：在一台**从未激活过该会话**的新设备上首次打开，缓存为空且 metadata 未到
  → 仍短暂落到能力中心，直到首条消息。属可接受退化，文档标注；根治需 CLI 侧 spawn 即推 metadata（开放问题）。
- 缓存仅用于"识别健康会话/展示"，**不作为权威**；`metadata.path` 一旦到手以其为准。

### 6.5 测试
- `sessionWorkingPath` 优先级：metadata > spawnPath > null。
- `isHealthCheckinSession` 在仅有 spawnPath（metadata=null）时返回 true。
- spawn 成功后缓存被写入；applySessions 带 path 时刷新缓存。

---

## 七、Phase 2a — 静态欢迎卡（happy-app）

**组件**：`components/rightPanel/HealthWelcomeCard.tsx`（或 `-session/` 下），纯静态、零 Agent 调用。

- **渲染位置**：`SessionView` 主聊天区的空态 —— 当
  `isHealthCheckinSession(sessionWorkingPath(session)) && 可见消息数 === 0` 时，
  在消息列表位置渲染欢迎卡（不是右面板）。
- **内容**（全部静态、走 i18n）：
  - 角色：健康打卡专家
  - 能记什么：睡眠 / 运动 / 饮食 三枚带图标的小条
  - 引导：一句"丢一张截图，我来记"
- **视觉**：沿用健康面板设计语言（`SleepHeroCard` 的卡片/圆角/配色 token，`useUnistyles` 主题），不另起风格。
- **"可见消息数"定义**：不含隐藏消息（见 2b）。Agent 的问候一旦到达（可见消息 ≥1），欢迎卡自然让位给真实对话。

### 7.1 测试
- 空健康会话渲染欢迎卡；有消息时不渲染；非健康会话不渲染。
- 快照测试卡片结构。

---

## 八、Phase 2b — 后台隐藏问候（happy-app）

进空健康会话时，除秒显欢迎卡外，**后台自动发一条"隐藏 prompt"**，让 Agent 回一句有温度、
可带最近数据的问候（如"已连记 4 天，昨晚 7h20m 👍 今天记点啥？"）。隐藏 prompt 本身不显示成
用户气泡，只显示 Agent 的回复。

### 8.1 隐藏消息机制（新增）
- 消息已带 `meta`（`typesRaw.ts`，含 `source: 'user' | 'generated'`）。为隐藏 prompt 打标记：
  在 `meta` 上加 `hidden: true`（或新增 `source: 'system'`，二选一，实现时定）。
- `sendMessage` 增可选项 `{ hidden?: true }`，透传到消息 `meta`。
- **ChatList/消息渲染**处过滤掉 `meta.hidden` 的用户消息（不渲染气泡）；Agent 回复不带该标记，正常显示。

### 8.2 触发与幂等
- 触发条件：与 2a 同（空健康会话首次进入）。
- **幂等**：以 `sessionId` 记一个本地"已问候"标记，避免 remount/重渲染重复发；每个会话生命周期只发一次。
- prompt 内容（const/i18n）：指示 Agent **只回一句**温暖问候，可参考最近日报，**不要展开**。

### 8.3 取舍与失败处理
- 代价：多一次（本就偏慢的）Agent 首轮；但欢迎卡已托底、不阻塞输入。
- Agent 离线/报错：欢迎卡保持，无破碎态；不重试轰炸。
- 若用户在问候返回前就丢了图：正常处理图；问候可被丢弃或作为普通回复出现，不冲突。

### 8.4 测试
- `hidden` prompt 不进可见消息流；Agent 回复正常显示。
- 幂等：同一会话不重复发问候。

---

## 九、Phase 2c — 健康面板休眠空态（happy-app）

`HealthCheckinPanel` 当前无数据时显示灰字 `今天还没记录`（i18n `healthPanel.notLoggedToday`）。
升级为与欢迎卡同风格的**休眠视觉**（如月亮/zzz 图形 + 一句引导），三域各自空态统一处理。

- 复用 2a 的视觉语言/子组件，保持一致。
- 有数据时行为不变。
- 测试：无数据渲染休眠态；有数据渲染卡片。

---

## 十、发布与回归

- **OTA**：Phase 2.x 全为 happy-app JS/TSX，无新增原生依赖、不改 runtimeVersion → **走 OTA**（符合"纯 JS 优先 OTA"约定）。发版时按现有 OTA 流程并给用户附 preview 卡片。
- **回归重点**：非健康会话仍显示能力中心；`parseHealthLog` 契约未破（睡眠 Hero/趋势正常）；spawn 缓存不串会话。
- **i18n**：所有新文案补齐仓库现有语言集（10 语言 + `_default`），与 health 既有字符串同款覆盖。

## 十一、风险与开放问题

1. **首响仍偏慢**（问题 1a 未根治）：全局巨型 CLAUDE.md 仍会拖慢"真正处理照片"那轮。本轮只靠精简健康 CLAUDE.md 缓解。是否需要单独治理全局 CLAUDE.md 的加载？（另开话题）
2. **跨设备冷启动退化**（见 6.4）：是否值得让 CLI/daemon 在 spawn 时即推 metadata，从根上消除"path 迟到"？
3. **问候是否读最近日报**：读 → 更有温度但更慢；不读 → 更快但泛泛。倾向"读、但设硬性一句上限"，实现时可配。
4. **欢迎卡 vs 休眠空态视觉**：完全一致，还是欢迎卡更"招呼"、空态更"休眠"？倾向共用底座、文案不同。

## 十二、交付物清单

- [ ] `健康打卡/CLAUDE.md` 重写（Obsidian 仓库）
- [ ] `Session.spawnPath` 本地字段 + 持久化 + `applySessions` 合并（storageTypes/storage）
- [ ] `sessionWorkingPath` helper + `SessionView` 接入
- [ ] 三处 spawn 调用点回填缓存
- [ ] `HealthWelcomeCard` 组件 + `SessionView` 空态接入
- [ ] 隐藏消息机制（`sendMessage` hidden 选项 + `meta.hidden` + ChatList 过滤）
- [ ] 后台问候触发 + 幂等 + prompt 文案
- [ ] `HealthCheckinPanel` 休眠空态
- [ ] i18n 文案（10 语言 + _default）
- [ ] 单测/快照：sessionWorkingPath、识别回退、隐藏消息、幂等、空态渲染
