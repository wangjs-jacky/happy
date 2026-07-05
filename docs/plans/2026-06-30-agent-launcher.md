# 我的 Agent — 侧栏快捷入口 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 Happy 侧栏新增「我的 Agent」卡片 + 底部抽屉 + 配置页，点一个 Agent 即可预填好「机器+目录」进入新建会话页，预设指令一键填入输入框。

**Architecture:** 复用现有 `useNewSessionDraft`（设 draft → `router.navigate('/new')`，范例见 `ActiveSessionsGroupCompact.handleAdd`）+ `useSpawnSession`（起会话/建目录/跳转）。配置存同步设置 `SettingsSchema.agents`（数组字段，仿 `recentMachinePaths`）。ComposeHome 读 `?agentId=` 路由参渲染预设并预填，无参数时零回归。

**Tech Stack:** React Native + Expo Router + Zustand（draft store）+ Zod（settings schema）+ Unistyles + vitest（单测）。

**工作目录:** worktree `/Users/jacky/jacky-github/happy--agent-launcher`，分支 `agent-launcher`，依赖已 `pnpm install`。所有 `cd` 到 `packages/happy-app`。

**测试命令:** `pnpm --filter happy-app test run <file>`（vitest 单次）。

---

## Task 1: Settings schema 新增 `agents` 字段

**Files:**
- Modify: `packages/happy-app/sources/sync/settings.ts`（`SettingsSchema` ~L63 后、`settingsDefaults` ~L117）
- Test: `packages/happy-app/sources/sync/settings.spec.ts`

**Step 1: 写失败测试**

在 `settings.spec.ts` 的 `describe('settings', ...)` 内新增：
```ts
describe('agents field', () => {
    it('defaults to empty array', () => {
        expect(settingsParse({}).agents).toEqual([]);
    });
    it('parses a valid agent entry', () => {
        const a = { id: 'x1', name: '工作日程', glyph: '日', color: '#5e5791', machineId: 'm1', path: '~/work', presets: [{ label: '看今天', prompt: '列出今天事项' }] };
        expect(settingsParse({ agents: [a] }).agents).toEqual([a]);
    });
    it('drops malformed agents back to default', () => {
        // 整个字段类型不符时回落默认（沿用 schema 行为）
        expect(settingsParse({ agents: 'nope' }).agents).toEqual([]);
    });
});
```

**Step 2: 运行验证失败**

Run: `pnpm --filter happy-app test run sources/sync/settings.spec.ts`
Expected: FAIL（`agents` 未定义）

**Step 3: 最小实现**

`SettingsSchema` 内（`dismissedCLIWarnings` 字段后、`})` 前）新增：
```ts
    agents: z.array(z.object({
        id: z.string(),
        name: z.string(),
        glyph: z.string(),
        color: z.string(),
        machineId: z.string(),
        path: z.string(),
        presets: z.array(z.object({
            label: z.string(),
            prompt: z.string(),
        })).default([]),
    })).default([]).describe('用户配置的「我的 Agent」快捷入口（机器+目录+预设指令）'),
```
`settingsDefaults` 内（`dismissedCLIWarnings` 行后）新增：
```ts
    agents: [],
```

**Step 4: 运行验证通过**

Run: `pnpm --filter happy-app test run sources/sync/settings.spec.ts`
Expected: PASS（含原有用例）

**Step 5: 提交**

```bash
git add packages/happy-app/sources/sync/settings.ts packages/happy-app/sources/sync/settings.spec.ts
git commit -m "feat(settings): add agents launcher field to synced settings"
```

---

## Task 2: Agent 类型 + launcher 纯函数

把「点 Agent → 设 draft → 导航」抽成可单测的纯函数，避免逻辑藏在组件里。

**Files:**
- Create: `packages/happy-app/sources/components/agents/launchAgent.ts`
- Test: `packages/happy-app/sources/components/agents/launchAgent.spec.ts`

**Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest';
import { launchAgent, type AgentLauncher } from './launchAgent';

const agent: AgentLauncher = {
    id: 'a1', name: '工作日程', glyph: '日', color: '#5e5791',
    machineId: 'm1', path: '~/work/schedule', presets: [],
};

describe('launchAgent', () => {
    it('sets machine before path and navigates with agentId', () => {
        const calls: string[] = [];
        const draft = {
            setMachineId: vi.fn(() => calls.push('machine')),
            setPath: vi.fn(() => calls.push('path')),
            setSessionType: vi.fn(() => calls.push('type')),
            setInput: vi.fn(() => calls.push('input')),
        };
        const navigate = vi.fn();
        launchAgent(agent, draft as any, navigate);
        // 顺序关键：setMachineId 会清空 path，必须先 machine 后 path
        expect(calls.indexOf('machine')).toBeLessThan(calls.indexOf('path'));
        expect(draft.setMachineId).toHaveBeenCalledWith('m1');
        expect(draft.setPath).toHaveBeenCalledWith('~/work/schedule');
        expect(draft.setInput).toHaveBeenCalledWith('');
        expect(navigate).toHaveBeenCalledWith('/new?agentId=a1');
    });
});
```

**Step 2: 运行验证失败**

Run: `pnpm --filter happy-app test run sources/components/agents/launchAgent.spec.ts`
Expected: FAIL（模块不存在）

**Step 3: 最小实现**

```ts
export interface AgentPreset { label: string; prompt: string; }
export interface AgentLauncher {
    id: string; name: string; glyph: string; color: string;
    machineId: string; path: string; presets: AgentPreset[];
}

interface DraftSetters {
    setMachineId: (id: string | null) => void;
    setPath: (path: string | null) => void;
    setSessionType: (t: 'simple' | 'worktree') => void;
    setInput: (s: string) => void;
}

/** 设 draft（顺序：先 machine 后 path）后导航到预填的新建会话页。 */
export function launchAgent(
    agent: AgentLauncher,
    draft: DraftSetters,
    navigate: (path: string) => void,
): void {
    draft.setMachineId(agent.machineId);
    draft.setPath(agent.path);
    draft.setSessionType('simple');
    draft.setInput('');
    navigate(`/new?agentId=${agent.id}`);
}
```

**Step 4: 运行验证通过**

Run: `pnpm --filter happy-app test run sources/components/agents/launchAgent.spec.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add packages/happy-app/sources/components/agents/
git commit -m "feat(agents): add AgentLauncher type and launchAgent helper"
```

---

## Task 3: AgentSheet 底部抽屉组件

**Files:**
- Create: `packages/happy-app/sources/components/agents/AgentSheet.tsx`

参考既有组件取数与样式：`useAllMachines`、`isMachineOnline`（`@/utils/machineUtils`）、`useSetting('agents')`（`@/sync/storage`）、`useNewSessionDraft`、`useRouter`。Modal/抽屉可参考仓库现有底部弹层组件（grep `Modal` / `BottomSheet` 找最接近的范式后对齐）。

**Step 1: 实现组件骨架**

```tsx
import * as React from 'react';
import { View, Text, Pressable, ScrollView, Modal } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useRouter } from 'expo-router';
import { useSetting } from '@/sync/storage';
import { useAllMachines } from '@/sync/storage';        // 确认实际导出位置
import { isMachineOnline } from '@/utils/machineUtils';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { launchAgent, type AgentLauncher } from './launchAgent';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

export const AgentSheet = React.memo(({ visible, onClose }: { visible: boolean; onClose: () => void }) => {
    const agents = useSetting('agents') as AgentLauncher[];
    const machines = useAllMachines();
    const router = useRouter();
    const draft = useNewSessionDraft();

    const onPick = React.useCallback((a: AgentLauncher) => {
        const machine = machines.find(m => m.id === a.machineId);
        if (!machine || !isMachineOnline(machine)) return; // 离线/不存在不可起
        onClose();
        launchAgent(a, draft, (p) => router.navigate(p as any));
    }, [machines, draft, router, onClose]);

    // 渲染：grab + 标题「我的 Agent」+「管理」→ /settings/agents
    // 每行：头像(glyph,color)+在线点 / name / `machineId · path`(mono) / chevron
    // 机器不存在 → 标 t('agents.machineMissing')，禁用
    // ...（样式对齐 SidebarView 卡片：surface 白底、hairline 边框、radius 14）
});
```

**Step 2: 手动验证（无单测，UI 组件）**

下游 Task 4 接入侧栏后统一在 app 内验证。本步只确保 TypeScript 通过：
Run: `pnpm --filter happy-app exec tsc --noEmit`
Expected: 无新增类型错误。

**Step 3: 提交**

```bash
git add packages/happy-app/sources/components/agents/AgentSheet.tsx
git commit -m "feat(agents): add AgentSheet bottom drawer"
```

---

## Task 4: 侧栏「我的 Agent」卡片

**Files:**
- Modify: `packages/happy-app/sources/components/SidebarView.tsx`（在「新建会话」`newSessionButton` 之后、`MainView variant="sidebar"` 之前插入）

**Step 1: 接入卡片 + 抽屉状态**

在 `SidebarView` 组件内：
```tsx
const agents = useSetting('agents') as AgentLauncher[];
const [sheetOpen, setSheetOpen] = React.useState(false);
```
在 JSX 「新建会话」按钮后插入卡片（样式对齐截图设计稿：标题「我的 Agent」+ `+ 添加`(→`go('/settings/agents')`) + 一排迷你头像；`agents.length===0` 显示引导态「+ 添加你的第一个 Agent」直接进配置页）。点卡片主体 `setSheetOpen(true)`。
组件末尾渲染 `<AgentSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />`。

**Step 2: 手动验证**

启动 web 预览：`pnpm --filter happy-app web`（或 `pnpm --filter happy-app start` 走 Expo）。
检查清单：
- [ ] 侧栏出现「我的 Agent」卡片，位置在新建会话与历史会话之间
- [ ] 无 Agent 时显示引导态，点击进入 `/settings/agents`
- [ ] 点卡片弹出 AgentSheet（先手动在设置里造 1 条数据，或等 Task 6）

**Step 3: 提交**

```bash
git add packages/happy-app/sources/components/SidebarView.tsx
git commit -m "feat(sidebar): add 我的 Agent card opening AgentSheet"
```

---

## Task 5: ComposeHome 读 agentId → 预设 + 预填

**Files:**
- Modify: `packages/happy-app/sources/components/ComposeHome.tsx`

**⚠️ 风险点（先验证再写）：** `MessageComposer` 用的是 `initialValue={text}` 还是受控 `value`？点预设要让输入框可见地变化。先读 `MessageComposer` 实现：
Run: `grep -n "initialValue\|value\|defaultValue\|useImperativeHandle\|ref" packages/happy-app/sources/components/MessageComposer.tsx | head`
- 若受控（`value={text}`）→ `setText(prompt)` 即生效。
- 若非受控（仅 `initialValue`）→ 需给 `<MessageComposer key={composerKey}>` 加 key，在 setText 时 bump key 强制重挂；或用其暴露的 ref。把结论写进实现。

**Step 1: 读取 agentId 并查 Agent**

```tsx
import { useLocalSearchParams } from 'expo-router';
// ...
const { agentId } = useLocalSearchParams<{ agentId?: string }>();
const agents = useSetting('agents') as AgentLauncher[];
const activeAgent = React.useMemo(
    () => agentId ? agents.find(a => a.id === agentId) ?? null : null,
    [agentId, agents],
);
```

**Step 2: 个性问候 + 预设区**

- 问候：`activeAgent ? t('composeHome.greetingAgent', { name: activeAgent.name }) : (name ? ... : ...)`
- 在 `<MessageComposer>` 上方插入预设区（仅 `activeAgent && activeAgent.presets.length > 0` 时）：横向/纵向 chip，每个 `onPress={() => setText(preset.prompt) /* + 按风险点结论确保可见更新 */}`。

**Step 3: 手动验证**

- [ ] 从 AgentSheet 点 Agent → 进入 `/new`，头部 chip 已是该机器+目录（draft 生效）
- [ ] 问候显示「进入 {name}」
- [ ] 预设 chip 出现；点击后输入框**可见地**填入 prompt，且**未自动发送**
- [ ] 直接走 `/new`（无 agentId）→ 无预设区、问候如常（零回归）
- [ ] `pnpm --filter happy-app exec tsc --noEmit` 无新错误

**Step 4: 提交**

```bash
git add packages/happy-app/sources/components/ComposeHome.tsx
git commit -m "feat(compose): render agent presets and prefill input from agentId param"
```

---

## Task 6: 配置页 `/settings/agents`（列表 + 新增/编辑）

**Files:**
- Create: `packages/happy-app/sources/app/(app)/settings/agents.tsx`（列表 + 进入编辑）
- Create: `packages/happy-app/sources/app/(app)/settings/agent-edit.tsx`（新增/编辑表单，或用同页 modal，按仓库设置页范式选其一——先看 `app/(app)/settings/` 现有页结构对齐）

**取数/写入：** `const [agents, setAgents] = useSettingMutable('agents')`（`@/sync/storage`）。
**机器/路径选择器：** 复用 `SessionConfigPanel` 内的机器列表与路径选择逻辑（grep 其实现，抽出或直接复用其子组件）。

**Step 1: 列表页**

- 列出 `agents`：头像 + name + `机器 · 路径`；点项 → 编辑；右滑/按钮删除（`setAgents(agents.filter(...))`）。
- 顶部「+ 新建」→ 编辑页（空态）。

**Step 2: 编辑表单**

字段：名称 / 机器（选择器）/ 文件夹路径（选择器）/ 预设指令列表（增删 label+prompt）/ 头像字+底色（给默认：名称首字 + 主题色）。
保存：生成/保留 `id`（新建用 `getRandomBytesAsync` 或现有 id 工具），`setAgents([...其他, 当前])`，返回列表。

**Step 3: 手动验证**

- [ ] 新建一个「工作日程」Agent（mac-mini + `~/work/schedule` + 3 条预设），保存
- [ ] 侧栏卡片迷你头像出现该 Agent；AgentSheet 列出它
- [ ] 编辑改名/改预设后，侧栏与 Compose 同步更新
- [ ] 删除后从侧栏与 sheet 消失
- [ ] 配置在另一设备（或重载）后仍在（同步设置生效）

**Step 4: 提交**

```bash
git add packages/happy-app/sources/app/\(app\)/settings/
git commit -m "feat(settings): add agents config list and edit screen"
```

---

## Task 7: i18n 文案

**Files:**
- Modify: `packages/happy-app/sources/text/` 下的语言文件（先 grep `composeHome.greeting` 定位结构，按现有 key 命名风格补齐）

需要的 key（中/英/及仓库其余语言至少给中英，其余可回落英文）：
- `agents.cardTitle` = 我的 Agent
- `agents.add` = 添加
- `agents.manage` = 管理
- `agents.empty` = 添加你的第一个 Agent
- `agents.machineOffline` = 机器离线
- `agents.machineMissing` = 机器不存在
- `agents.title` = 我的 Agent（设置页标题）
- `agents.newTitle` / `agents.editTitle` / `agents.name` / `agents.machine` / `agents.folder` / `agents.presets` / `agents.addPreset` / `agents.save` / `agents.delete`
- `composeHome.greetingAgent` = 进入 {{name}}，今天想做点什么？

**验证：** `pnpm --filter happy-app exec tsc --noEmit`（若 i18n 有类型）+ 切换中英文核对无缺字。

**提交：**

```bash
git add packages/happy-app/sources/text/
git commit -m "i18n: add 我的 Agent strings"
```

---

## Task 8: 端到端验证 + 全量测试

**Step 1: 全量单测**

Run: `pnpm --filter happy-app test run sources/sync/settings.spec.ts sources/components/agents/launchAgent.spec.ts`
Expected: 全 PASS

**Step 2: 类型检查**

Run: `pnpm --filter happy-app exec tsc --noEmit`
Expected: 无新增错误

**Step 3: 真机/网页走查（@superpowers:verification-before-completion）**

完整链路：配置页建 Agent → 侧栏卡片点开 → AgentSheet 点 Agent → Compose 预填 + 预设 → 点预设填入(不自动发) → 发送 → 在对应机器目录起会话。
- [ ] 离线机器 Agent 置灰不可起
- [ ] 预设为空的 Agent 只预填不显示预设区
- [ ] 无 agentId 的 `/new` 零回归
- [ ] 手机布局 + 平板布局都正常（共用 SidebarView）

**Step 4: 收尾**

按 @superpowers:finishing-a-development-branch 决定合并/PR。合并后按 Happy 铁律同步 `jacky-main` 并清理 worktree。

---

## 备注
- DRY：spawn/建目录/跳转全程不复制，复用 `useSpawnSession`。
- YAGNI：排序、拖拽、图标库选择等先不做；头像用单字+底色占位即可。
- 风险集中在 Task 5 的输入框可见更新（受控 vs 非受控），已前置验证步。
