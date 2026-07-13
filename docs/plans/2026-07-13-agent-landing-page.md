# 通用 Agent 落地页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「点 Agent 磁贴」进入的 `/new?agentId=` 组合页升级为落地页——顶部按 Agent 派生的引导（健康 Agent 富引导 / 其它极简）、中间该 Agent 的最近会话（点一下秒回）、底部保留组合框（新建打卡）。一屏覆盖「引导 / 找回 / 新建」。

**Architecture:** happy-app（React Native + Expo Router + zustand + unistyles + vitest）。核心是两个纯函数（`recentSessionsForAgent` 过滤排序 / `resolveAgentIntroKind` 派生引导类型）+ 两个展示组件（`AgentLandingIntro` / `AgentRecentList`），在 `ComposeHome` 里当 `displayAgent` 存在时挂进"问候区"。健康引导内容从现有 `HealthWelcomeCard` 抽出的 `HealthWelcomeContent` 复用，单一文案来源。

**Tech Stack:** TypeScript、React Native、react-native-unistyles、expo-router、zustand（`sync/storage.ts`）、vitest、i18n（`sources/text/`）。

## Global Constraints

- 分支/worktree：在 `happy--health-onboarding`（分支 `health-onboarding`）工作；本特性并入 PR #181，依赖其已引入的 `HealthWelcomeCard` / `isHealthCheckinSession` / `sessionWorkingPath` / `spawnPath`。
- 缩进 **4 空格**；路径别名 `@/*` → `./sources/*`；TS strict。
- 组件：函数组件用 `React.memo` 包裹；样式用 `react-native-unistyles` 的 `StyleSheet.create`，**放在文件末尾**。
- 头像：Agent 用其 `glyph`+`color` 的圆角方块（沿用 `AgentSheet` 视觉），**不用** `Avatar` 组件（那是给 user/session id 的）。
- i18n：所有用户可见文案走 `t(...)`；新 key 先加 `text/_default.ts`（`en`，类型 source of truth，缺 key 会 TS 报错），再补全 10 个语言文件 `text/translations/{zh-Hans,zh-Hant,ja,ru,pl,es,it,pt,ca,en}.ts`。
- 测试：vitest 纯逻辑，`import { describe, it, expect } from 'vitest'`；**不写 RN 组件渲染测试**（仓库无渲染测试库）。跑单文件：`cd packages/happy-app && pnpm exec vitest run <相对路径>`。
- 平台/发布：仅改 happy-app 的 JS/TSX + i18n，**不加原生依赖、不改 runtimeVersion** → 走 OTA。
- 提交：每个 Task 末尾提交一次，Conventional Commits（`feat(agents)/refactor/docs`）+ 仓库 footer（见根 `CLAUDE.md` 第七节）。
- 非目标：不优化 spawn 速度；不加 Agent 可编辑"简介"字段；不碰跨设备 metadata 派生 spawnPath 遗留（M3）。

## File Structure

- `components/agents/recentSessionsForAgent.ts` — 纯函数：按 Agent（machineId + 解析后 path）过滤会话、按 `updatedAt` 倒序、截断。
- `components/agents/recentSessionsForAgent.test.ts` — 上者单测。
- `components/agents/agentIntro.ts` — 纯函数：`resolveAgentIntroKind(agent)` → `'health' | 'generic'`。
- `components/agents/agentIntro.test.ts` — 上者单测。
- `components/rightPanel/HealthWelcomeCard.tsx` — **改**：抽出 `HealthWelcomeContent`（无 flex:1 外壳的内容体），`HealthWelcomeCard` 变薄壳。
- `components/agents/AgentLandingIntro.tsx` — 新：按 kind 渲染健康富引导（复用 `HealthWelcomeContent`）/ 极简派生引导（头像+名+副标题）。
- `components/agents/AgentRecentList.tsx` — 新：读会话+机器，调 `recentSessionsForAgent`，渲染最近会话行（点=秒回）；空则 `return null`。
- `components/ComposeHome.tsx` — **改**：`displayAgent` 存在时在问候区渲染 `AgentLandingIntro` + `AgentRecentList`，并抑制默认问候行。
- `text/_default.ts` + `text/translations/*.ts` — 新增 `agents.recentTitle`。

---

## Task 1: `recentSessionsForAgent` 纯函数

**Files:**
- Create: `packages/happy-app/sources/components/agents/recentSessionsForAgent.ts`
- Test: `packages/happy-app/sources/components/agents/recentSessionsForAgent.test.ts`

**Interfaces:**
- Consumes: `sessionWorkingPath` from `@/sync/sessionWorkingPath`；`resolveAbsolutePath` from `@/utils/pathUtils`；类型 `Session`/`Machine` from `@/sync/storageTypes`；`AgentLauncher` from `./launchAgent`。
- Produces:
  ```ts
  function recentSessionsForAgent(params: {
      agent: Pick<AgentLauncher, 'machineId' | 'path'>;
      sessions: Session[];
      machines: Machine[];
      limit?: number; // 默认 5
  }): Session[]
  ```

- [ ] **Step 1: 写失败测试**

创建 `recentSessionsForAgent.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { recentSessionsForAgent } from './recentSessionsForAgent';
import type { Session, Machine } from '@/sync/storageTypes';

// 只造出被测函数用到的字段，其余用 as any 收口，保持测试聚焦。
function session(id: string, machineId: string, path: string, updatedAt: number): Session {
    return { id, updatedAt, metadata: { machineId, path } } as any as Session;
}
const machine = (id: string, homeDir?: string): Machine => ({ id, metadata: { homeDir } } as any as Machine);
const agent = (machineId: string, path: string) => ({ machineId, path });

describe('recentSessionsForAgent', () => {
    const m = [machine('mac', '/Users/jacky')];

    it('只留 machineId 与解析后 path 都匹配的会话', () => {
        const sessions = [
            session('a', 'mac', '/Users/jacky/health', 100),
            session('b', 'other', '/Users/jacky/health', 200), // 机器不符
            session('c', 'mac', '/Users/jacky/other', 300),     // 路径不符
        ];
        const out = recentSessionsForAgent({ agent: agent('mac', '/Users/jacky/health'), sessions, machines: m });
        expect(out.map(s => s.id)).toEqual(['a']);
    });

    it('把 agent 的 ~ 路径按机器 homeDir 解析后再比对', () => {
        const sessions = [session('a', 'mac', '/Users/jacky/health', 100)];
        const out = recentSessionsForAgent({ agent: agent('mac', '~/health'), sessions, machines: m });
        expect(out.map(s => s.id)).toEqual(['a']);
    });

    it('忽略结尾斜杠差异', () => {
        const sessions = [session('a', 'mac', '/Users/jacky/health/', 100)];
        const out = recentSessionsForAgent({ agent: agent('mac', '/Users/jacky/health'), sessions, machines: m });
        expect(out.map(s => s.id)).toEqual(['a']);
    });

    it('按 updatedAt 倒序并截断到 limit', () => {
        const sessions = [
            session('old', 'mac', '/Users/jacky/health', 100),
            session('new', 'mac', '/Users/jacky/health', 300),
            session('mid', 'mac', '/Users/jacky/health', 200),
        ];
        const out = recentSessionsForAgent({ agent: agent('mac', '/Users/jacky/health'), sessions, machines: m, limit: 2 });
        expect(out.map(s => s.id)).toEqual(['new', 'mid']);
    });

    it('无匹配返回空数组', () => {
        expect(recentSessionsForAgent({ agent: agent('mac', '/Users/jacky/none'), sessions: [], machines: m })).toEqual([]);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/happy-app && pnpm exec vitest run sources/components/agents/recentSessionsForAgent.test.ts`
Expected: FAIL —「Failed to resolve import "./recentSessionsForAgent"」或「recentSessionsForAgent is not a function」。

- [ ] **Step 3: 写最小实现**

创建 `recentSessionsForAgent.ts`：

```ts
import type { Session, Machine } from '@/sync/storageTypes';
import { sessionWorkingPath } from '@/sync/sessionWorkingPath';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import type { AgentLauncher } from './launchAgent';

/** 去掉结尾斜杠，统一路径比对（根 '/' 保留）。 */
function stripTrailingSlash(p: string): string {
    return p.length > 1 ? p.replace(/[/\\]+$/, '') : p;
}

/**
 * 某个 Agent 的最近会话：机器一致 + 解析后工作目录一致，按 updatedAt 倒序取前 limit。
 * 路径两边都用机器 homeDir 解析 '~' 后再归一化结尾斜杠比对，避免 '~/x' 与绝对路径漏配。
 */
export function recentSessionsForAgent(params: {
    agent: Pick<AgentLauncher, 'machineId' | 'path'>;
    sessions: Session[];
    machines: Machine[];
    limit?: number;
}): Session[] {
    const { agent, sessions, machines, limit = 5 } = params;
    const homeDir = machines.find((m) => m.id === agent.machineId)?.metadata?.homeDir;
    const target = stripTrailingSlash(resolveAbsolutePath(agent.path, homeDir));

    return sessions
        .filter((s) => s.metadata?.machineId === agent.machineId)
        .filter((s) => {
            const p = sessionWorkingPath(s);
            return !!p && stripTrailingSlash(resolveAbsolutePath(p, homeDir)) === target;
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/happy-app && pnpm exec vitest run sources/components/agents/recentSessionsForAgent.test.ts`
Expected: PASS（5 passed）。

- [ ] **Step 5: 提交**

```bash
git add packages/happy-app/sources/components/agents/recentSessionsForAgent.ts packages/happy-app/sources/components/agents/recentSessionsForAgent.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): recentSessionsForAgent 纯函数（按 machineId+path 过滤最近会话）

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
EOF
)"
```

---

## Task 2: `resolveAgentIntroKind` 纯函数

**Files:**
- Create: `packages/happy-app/sources/components/agents/agentIntro.ts`
- Test: `packages/happy-app/sources/components/agents/agentIntro.test.ts`

**Interfaces:**
- Consumes: `isHealthCheckinSession` from `@/components/rightPanel/HealthCheckinPanel`；`AgentLauncher` from `./launchAgent`。
- Produces: `function resolveAgentIntroKind(agent: Pick<AgentLauncher, 'path'>): 'health' | 'generic'`

- [ ] **Step 1: 写失败测试**

创建 `agentIntro.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { resolveAgentIntroKind } from './agentIntro';

describe('resolveAgentIntroKind', () => {
    it('健康打卡路径 → health', () => {
        expect(resolveAgentIntroKind({ path: '/Users/jacky/jacky-obsidian/人生辅助系统/健康打卡' })).toBe('health');
    });
    it('普通路径 → generic', () => {
        expect(resolveAgentIntroKind({ path: '/Users/jacky/jacky-github/foo' })).toBe('generic');
    });
    it('空路径 → generic', () => {
        expect(resolveAgentIntroKind({ path: '' })).toBe('generic');
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/happy-app && pnpm exec vitest run sources/components/agents/agentIntro.test.ts`
Expected: FAIL —「Failed to resolve import "./agentIntro"」。

- [ ] **Step 3: 写最小实现**

创建 `agentIntro.ts`：

```ts
import { isHealthCheckinSession } from '@/components/rightPanel/HealthCheckinPanel';
import type { AgentLauncher } from './launchAgent';

/** 落地页引导类型：健康打卡目录 → 富引导；其它 → 极简派生引导。 */
export function resolveAgentIntroKind(agent: Pick<AgentLauncher, 'path'>): 'health' | 'generic' {
    return isHealthCheckinSession(agent.path) ? 'health' : 'generic';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/happy-app && pnpm exec vitest run sources/components/agents/agentIntro.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: 提交**

```bash
git add packages/happy-app/sources/components/agents/agentIntro.ts packages/happy-app/sources/components/agents/agentIntro.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): resolveAgentIntroKind 纯函数（派生落地页引导类型）

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
EOF
)"
```

---

## Task 3: 抽出 `HealthWelcomeContent` + 建 `AgentLandingIntro`

从 `HealthWelcomeCard` 抽出无 flex 外壳的内容体，供会话内欢迎卡与落地页共用（单一文案/图标来源）；再建落地页引导组件。无渲染测试，靠 `pnpm typecheck` 把关。

**Files:**
- Modify: `packages/happy-app/sources/components/rightPanel/HealthWelcomeCard.tsx`
- Create: `packages/happy-app/sources/components/agents/AgentLandingIntro.tsx`

**Interfaces:**
- Consumes: `resolveAgentIntroKind` from `./agentIntro`；`HealthWelcomeContent` from `@/components/rightPanel/HealthWelcomeCard`；`AgentLauncher` from `./launchAgent`；`t` from `@/text`。
- Produces:
  - `export const HealthWelcomeContent: React.MemoExoticComponent<() => JSX.Element>`（无 flex 外壳）
  - `export const AgentLandingIntro: React.MemoExoticComponent<(props: { agent: AgentLauncher }) => JSX.Element>`

- [ ] **Step 1: 重构 `HealthWelcomeCard.tsx`——抽出 `HealthWelcomeContent`**

把现有卡片的内部 JSX（心形图标 + role + subtitle + 三域 + hint）搬进新导出的 `HealthWelcomeContent`，`HealthWelcomeCard` 保留 flex:1 居中外壳并渲染它。整文件替换为：

```tsx
import * as React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

/**
 * 健康欢迎内容体（无外层 flex）：图标 + 角色 + 引导 + 睡眠/运动/饮食三域 + hint。
 * 供两处复用：会话内空态卡（HealthWelcomeCard，居中全屏）与落地页引导（AgentLandingIntro，顶部对齐）。
 */
export const HealthWelcomeContent = React.memo(function HealthWelcomeContent() {
    const { theme } = useUnistyles();
    return (
        <View style={styles.content}>
            <Ionicons name="heart-circle-outline" size={64} color={theme.colors.text} />
            <Text style={styles.role}>{t('healthPanel.welcomeRole')}</Text>
            <Text style={styles.subtitle}>{t('healthPanel.welcomeSubtitle')}</Text>
            <View style={styles.domains}>
                <View style={styles.domain}>
                    <Ionicons name="moon-outline" size={24} color={theme.colors.textSecondary} />
                    <Text style={styles.domainLabel}>{t('healthPanel.welcomeSleep')}</Text>
                </View>
                <View style={styles.domain}>
                    <Ionicons name="barbell-outline" size={24} color={theme.colors.textSecondary} />
                    <Text style={styles.domainLabel}>{t('healthPanel.welcomeExercise')}</Text>
                </View>
                <View style={styles.domain}>
                    <Ionicons name="restaurant-outline" size={24} color={theme.colors.textSecondary} />
                    <Text style={styles.domainLabel}>{t('healthPanel.welcomeDiet')}</Text>
                </View>
            </View>
            <Text style={styles.hint}>{t('healthPanel.welcomeHint')}</Text>
        </View>
    );
});

/**
 * 空健康会话欢迎卡：内容居中撑满。纯静态展示，无交互无副作用。
 */
export const HealthWelcomeCard = React.memo(function HealthWelcomeCard() {
    return (
        <View style={styles.container}>
            <HealthWelcomeContent />
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    content: {
        alignItems: 'center',
        paddingHorizontal: 24,
        gap: 12,
    },
    role: {
        fontSize: 20,
        fontWeight: '700',
        color: theme.colors.text,
    },
    subtitle: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
    domains: {
        flexDirection: 'row',
        gap: 20,
        marginTop: 8,
    },
    domain: {
        alignItems: 'center',
        gap: 6,
    },
    domainLabel: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    hint: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginTop: 8,
        lineHeight: 20,
    },
}));
```

- [ ] **Step 2: 建 `AgentLandingIntro.tsx`**

```tsx
import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { HealthWelcomeContent } from '@/components/rightPanel/HealthWelcomeCard';
import { resolveAgentIntroKind } from './agentIntro';
import type { AgentLauncher } from './launchAgent';

/**
 * 落地页引导区：健康 Agent 复用 HealthWelcomeContent 富引导；其它 Agent 极简派生
 * （glyph+color 方块头像 + 名字 + 一行路径）。纯静态展示。
 */
export const AgentLandingIntro = React.memo(function AgentLandingIntro({ agent }: { agent: AgentLauncher }) {
    if (resolveAgentIntroKind(agent) === 'health') {
        return (
            <View style={styles.healthWrap}>
                <HealthWelcomeContent />
            </View>
        );
    }
    return (
        <View style={styles.genericWrap}>
            <View style={[styles.avatar, { backgroundColor: agent.color }]}>
                <Text style={styles.avatarGlyph}>{agent.glyph}</Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>{agent.name}</Text>
            <Text style={styles.path} numberOfLines={1}>{agent.path}</Text>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    healthWrap: {
        alignItems: 'center',
        paddingTop: 24,
    },
    genericWrap: {
        alignItems: 'center',
        paddingTop: 24,
        gap: 8,
    },
    avatar: {
        width: 56,
        height: 56,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarGlyph: {
        color: '#FFFFFF',
        fontSize: 24,
        ...Typography.default('semiBold'),
    },
    name: {
        fontSize: 18,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    path: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.mono(),
    },
}));
```

- [ ] **Step 3: 类型检查**

Run: `cd packages/happy-app && pnpm typecheck`
Expected: 无报错（`HealthWelcomeContent` 导出、`AgentLandingIntro` 类型均通过）。

- [ ] **Step 4: 提交**

```bash
git add packages/happy-app/sources/components/rightPanel/HealthWelcomeCard.tsx packages/happy-app/sources/components/agents/AgentLandingIntro.tsx
git commit -m "$(cat <<'EOF'
refactor(health): 抽出 HealthWelcomeContent；新增 AgentLandingIntro 落地页引导

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
EOF
)"
```

---

## Task 4: i18n `agents.recentTitle` + `AgentRecentList` 组件

先加"最近"标题文案到全部 11 个语言文件（组件要用），再建最近会话列表组件。

**Files:**
- Modify: `packages/happy-app/sources/text/_default.ts` + `packages/happy-app/sources/text/translations/{zh-Hans,zh-Hant,ja,ru,pl,es,it,pt,ca,en}.ts`（共 11 个文件）
- Create: `packages/happy-app/sources/components/agents/AgentRecentList.tsx`

**Interfaces:**
- Consumes: `recentSessionsForAgent` from `./recentSessionsForAgent`；`useAllSessions`/`useAllMachines` from `@/sync/storage`；`useNavigateToSession` from `@/hooks/useNavigateToSession`；`getSessionName` from `@/utils/sessionUtils`；`formatLastSeen` from `@/utils/sessionUtils`；`AgentLauncher` from `./launchAgent`；`t` from `@/text`。
- Produces: `export const AgentRecentList: React.MemoExoticComponent<(props: { agent: AgentLauncher }) => JSX.Element | null>`

- [ ] **Step 1: 加 i18n key `agents.recentTitle`**

在 `text/_default.ts` 的 `agents: {` 段落内加一行（紧跟其它 agents key 后）：

```ts
        recentTitle: 'Recent',
```

在每个 `text/translations/*.ts` 的 `agents: {` 段落内加对应译文：

- `zh-Hans.ts`：`recentTitle: '最近',`
- `zh-Hant.ts`：`recentTitle: '最近',`
- `ja.ts`：`recentTitle: '最近',`
- `ru.ts`：`recentTitle: 'Недавние',`
- `pl.ts`：`recentTitle: 'Ostatnie',`
- `es.ts`：`recentTitle: 'Recientes',`
- `it.ts`：`recentTitle: 'Recenti',`
- `pt.ts`：`recentTitle: 'Recentes',`
- `ca.ts`：`recentTitle: 'Recents',`
- `en.ts`：`recentTitle: 'Recent',`

> 若某语言文件没有独立 `agents:` 段（继承 `_default`），则只改有该段的文件；`pnpm typecheck` 会指出缺 key 的文件，补齐即可。

- [ ] **Step 2: 类型检查确认 key 已就位**

Run: `cd packages/happy-app && pnpm typecheck`
Expected: 无 "Property 'recentTitle' is missing" 报错。

- [ ] **Step 3: 建 `AgentRecentList.tsx`**

```tsx
import * as React from 'react';
import { View, Text, Pressable } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { useAllSessions, useAllMachines } from '@/sync/storage';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { getSessionName, formatLastSeen } from '@/utils/sessionUtils';
import { recentSessionsForAgent } from './recentSessionsForAgent';
import type { AgentLauncher } from './launchAgent';

/**
 * 落地页「最近」区：列出该 Agent（machineId+path 匹配）最近 5 次会话，点击秒回带历史。
 * 无匹配会话时整块不渲染（return null），让引导区的 hint 承担引导。
 */
export const AgentRecentList = React.memo(function AgentRecentList({ agent }: { agent: AgentLauncher }) {
    const sessions = useAllSessions();
    const machines = useAllMachines({ includeOffline: true });
    const navigateToSession = useNavigateToSession();
    const recent = React.useMemo(
        () => recentSessionsForAgent({ agent, sessions, machines }),
        [agent, sessions, machines],
    );

    if (recent.length === 0) return null;

    return (
        <View style={styles.container}>
            <Text style={styles.title}>{t('agents.recentTitle')}</Text>
            {recent.map((session) => (
                <Pressable
                    key={session.id}
                    onPress={() => navigateToSession(session.id)}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                    <View style={styles.rowText}>
                        <Text style={styles.rowName} numberOfLines={1}>{getSessionName(session)}</Text>
                        <Text style={styles.rowTime} numberOfLines={1}>{formatLastSeen(session.updatedAt)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={styles.chevron.color} />
                </Pressable>
            ))}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        marginTop: 24,
        paddingHorizontal: 16,
        gap: 6,
    },
    title: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginBottom: 2,
        ...Typography.default('semiBold'),
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        gap: 8,
    },
    rowPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    rowText: {
        flex: 1,
    },
    rowName: {
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default(),
    },
    rowTime: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
        ...Typography.default(),
    },
    chevron: {
        color: theme.colors.textSecondary,
    },
}));
```

- [ ] **Step 4: 类型检查**

Run: `cd packages/happy-app && pnpm typecheck`
Expected: 无报错。

- [ ] **Step 5: 提交**

```bash
git add packages/happy-app/sources/text packages/happy-app/sources/components/agents/AgentRecentList.tsx
git commit -m "$(cat <<'EOF'
feat(agents): AgentRecentList 落地页最近会话列表 + agents.recentTitle i18n

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
EOF
)"
```

---

## Task 5: 把落地页两区块接入 `ComposeHome`

`displayAgent` 存在时，在问候区（`greetWrap`）渲染 `AgentLandingIntro` + `AgentRecentList`，并抑制默认问候行——组合框保持不动，仍是唯一 spawn 路径。

**Files:**
- Modify: `packages/happy-app/sources/components/ComposeHome.tsx`

**Interfaces:**
- Consumes: `AgentLandingIntro` from `@/components/agents/AgentLandingIntro`；`AgentRecentList` from `@/components/agents/AgentRecentList`；已有 `displayAgent`（`ComposeHome.tsx:282`）。

- [ ] **Step 1: 加 import**

在 `ComposeHome.tsx` 顶部 import 区加：

```tsx
import { AgentLandingIntro } from '@/components/agents/AgentLandingIntro';
import { AgentRecentList } from '@/components/agents/AgentRecentList';
```

- [ ] **Step 2: 改问候区（`greetWrap`）**

将现有块（约 `ComposeHome.tsx:731-742`）：

```tsx
                <View style={styles.greetWrap}>
                    <ComposeHomeParticles mode={theme.dark ? 'dark' : 'light'} />
                    <Text style={styles.greeting}>
                        {displayAgent
                            ? t('composeHome.greetingAgent', { name: displayAgent.name })
                            : activeImageAgent
                                ? t('composeHome.greetingAgent', { name: t('agents.imageStyleAgent') })
                                : name
                                    ? t('composeHome.greeting', { name })
                                    : t('composeHome.greetingNoName')}
                    </Text>
                </View>
```

替换为（`displayAgent` 且非图片 Agent 时走落地页；其余保持原问候）：

```tsx
                <View style={styles.greetWrap}>
                    <ComposeHomeParticles mode={theme.dark ? 'dark' : 'light'} />
                    {displayAgent && !activeImageAgent ? (
                        <ScrollView
                            style={styles.landingScroll}
                            contentContainerStyle={styles.landingContent}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                        >
                            <AgentLandingIntro agent={displayAgent} />
                            <AgentRecentList agent={displayAgent} />
                        </ScrollView>
                    ) : (
                        <Text style={styles.greeting}>
                            {activeImageAgent
                                ? t('composeHome.greetingAgent', { name: t('agents.imageStyleAgent') })
                                : name
                                    ? t('composeHome.greeting', { name })
                                    : t('composeHome.greetingNoName')}
                        </Text>
                    )}
                </View>
```

> 注：`ScrollView` 已在 `ComposeHome.tsx:2` import。图片 Agent（`activeImageAgent`）仍走原图片工作流，不进落地页。

- [ ] **Step 3: 加落地页样式**

在 `ComposeHome.tsx` 文件末尾的 `StyleSheet.create((theme) => ({ ... }))` 内、`greeting` 样式旁加：

```tsx
    landingScroll: {
        flex: 1,
        width: '100%',
    },
    landingContent: {
        paddingBottom: 16,
    },
```

- [ ] **Step 4: 类型检查**

Run: `cd packages/happy-app && pnpm typecheck`
Expected: 无报错。

- [ ] **Step 5: 提交**

```bash
git add packages/happy-app/sources/components/ComposeHome.tsx
git commit -m "$(cat <<'EOF'
feat(agents): ComposeHome 接入落地页（引导+最近会话），保留组合框为唯一 spawn 路径

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
EOF
)"
```

---

## Task 6: 全量验证 + preview OTA + 真机验收

**Files:** 无新增改动（仅运行与发布）。

- [ ] **Step 1: 全量单测**

Run: `cd packages/happy-app && pnpm exec vitest run`
Expected: 全绿（含新增 `recentSessionsForAgent` 5 例、`agentIntro` 3 例，总数在原基础上 +8）。

- [ ] **Step 2: 全量类型检查**

Run: `cd packages/happy-app && pnpm typecheck`
Expected: 无报错。

- [ ] **Step 3: 发 preview OTA**

Run: `cd packages/happy-app && pnpm ota:selfhost:preview`
Expected: 打印「频道 preview / 新版本 id（UUID）/ manifest 地址」。记录 updateId + stamp。

- [ ] **Step 4: 真机验收（人工）**

- 点健康 Agent → **秒开落地页**：顶部见"健康打卡 / 丢一张截图，我来帮你记 / 睡眠·运动·饮食"，下方见「最近」会话列表。
- 点最近一条 → **秒回**该会话、带历史。
- 底部拍照/输入并发送 → 正常 spawn 新会话（此步等待属预期）。
- 点其它 Agent（如 App 生成）→ 见极简派生引导（头像+名+路径）+ 最近会话。
- 回复里附 `<happy-ota-preview>` 卡片（channel preview / android / runtime 22 / updateId / stamp）。

- [ ] **Step 5: 更新 PR #181**

```bash
git push origin health-onboarding
```

Expected: PR #181 自动带上本次 6 个提交；PR 页触发 `ota-preview` 自动评论。

---

## Self-Review

**Spec coverage（对照设计文档各节）**
- 引导区（健康富/其它极简派生）→ Task 2（kind）+ Task 3（组件）✅
- 最近会话（纯函数过滤排序 + 组件 + 点击秒回 + 空态隐藏）→ Task 1 + Task 4 ✅
- 组合框保留为唯一 spawn 路径 → Task 5 只改问候区、不碰 composer ✅
- 数据可行性（machineId+path 解析）→ Task 1 用 `resolveAbsolutePath`+`sessionWorkingPath` ✅
- i18n 全语言 → Task 4 Step 1 覆盖 11 文件 ✅
- 测试纯函数 TDD、不写渲染测试 → Task 1/2 有测试，组件 Task 靠 typecheck ✅
- 发布走 OTA + `<happy-ota-preview>` 卡片 → Task 6 ✅
- 非目标（spawn 速度 / 自定义简介字段 / M3）→ 计划未涉及 ✅

**Placeholder scan:** 无 TBD/TODO；每个代码步给了完整代码与预期输出。✅

**Type consistency:**
- `recentSessionsForAgent({ agent, sessions, machines, limit? })` 在 Task 1 定义、Task 4 调用签名一致 ✅
- `resolveAgentIntroKind(agent: Pick<AgentLauncher,'path'>)` Task 2 定义、Task 3 使用一致 ✅
- `HealthWelcomeContent` Task 3 导出、Task 3 内 `AgentLandingIntro` 使用一致 ✅
- `AgentLandingIntro({ agent })` / `AgentRecentList({ agent })` Task 3/4 定义、Task 5 使用一致 ✅
- `formatLastSeen(activeAt: number)` / `getSessionName(session)` 为既有导出（`utils/sessionUtils.ts`），签名匹配 ✅

**开放注记（非阻塞）：** 若某 Agent 的 `path` 存成 `~/…` 且其机器离线（拿不到 homeDir），最近会话可能漏配（`~` 无法解析成绝对路径）。实践中 Agent 多存绝对路径，健康 Agent 亦为绝对路径，故 v1 不特殊处理；记为已知边界。
