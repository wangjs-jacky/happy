# Skills 预览面板 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 Happy 设置里新增「Skills 预览」面板，实时扫描宿主机已安装的 Skills，展示提炼出的触发词，点击进入只读 Markdown 阅读完整 SKILL.md。

**Architecture:** 纯 happy-app 改动。复用 daemon 已在 machine 级注册的 `bash`/`readFile` RPC（`happy-cli` 的 `registerCommonHandlers`，machine 级见 `apiMachine.ts:136`）。App 端新增 `machineBash`/`machineReadFile` 封装；纯函数 `parseSkillList`/`parseTriggers` 解析 frontmatter；两个新屏幕（列表 + 详情）。

**Tech Stack:** React Native + Expo Router + Unistyles + Zustand(storage) + Vitest。复用 `MarkdownView`、`useAllMachines`、`apiSocket.machineRPC`、`decodeBase64ToBytes`/`decodeUtf8Bytes`。

**工作目录:** worktree `/Users/jacky/jacky-github/happy--skills-panel`（分支 `skills-panel`）。所有命令在 `packages/happy-app` 下跑。

---

## Task 1: machine 级 bash/readFile 封装

**Files:**
- Modify: `packages/happy-app/sources/sync/ops.ts`（紧挨 `machineBrowseDirectory` 之后，约 707 行）

**Step 1: 实现封装**

在 `ops.ts` 末尾 export 区域附近加入（复用文件内已有的 `SessionBashRequest`/`SessionBashResponse`/`SessionReadFileResponse` 类型）：

```typescript
/** machine 级执行 bash（无需活跃 session，复用 daemon machine-level handler） */
export async function machineBash(machineId: string, request: SessionBashRequest): Promise<SessionBashResponse> {
    try {
        return await apiSocket.machineRPC<SessionBashResponse, SessionBashRequest>(machineId, 'bash', request);
    } catch (error) {
        return { success: false, stdout: '', stderr: error instanceof Error ? error.message : 'Unknown error', exitCode: -1, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

/** machine 级读文件，返回 base64 content */
export async function machineReadFile(machineId: string, path: string): Promise<SessionReadFileResponse> {
    try {
        return await apiSocket.machineRPC<SessionReadFileResponse, SessionReadFileRequest>(machineId, 'readFile', { path });
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}
```

**Step 2: 类型检查**

Run: `cd packages/happy-app && npx tsc --noEmit -p tsconfig.json 2>&1 | grep ops.ts || echo "ops.ts clean"`
Expected: `ops.ts clean`

**Step 3: Commit**

```bash
git add packages/happy-app/sources/sync/ops.ts
git commit -m "feat(skills): add machine-level bash/readFile RPC wrappers"
```

---

## Task 2: 触发词提炼纯函数（TDD）

**Files:**
- Create: `packages/happy-app/sources/sync/skills.ts`
- Test: `packages/happy-app/sources/sync/skills.spec.ts`

**Step 1: 写失败测试**

`skills.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseTriggers } from './skills';

describe('parseTriggers', () => {
    it('抽取中文「触发词：」列表', () => {
        expect(parseTriggers('上下文快照工具。触发词：add、resolve、批次处理')).toEqual(['add', 'resolve', '批次处理']);
    });
    it('抽取「触发于」格式', () => {
        expect(parseTriggers('评分评估 Agent。触发于 /tw-scorer 或编排器触发。')).toEqual(['/tw-scorer']);
    });
    it('抽取英文 Triggers include', () => {
        const r = parseTriggers('Browser automation. Triggers include "open a website", "fill out a form".');
        expect(r).toContain('open a website');
        expect(r).toContain('fill out a form');
    });
    it('无触发词时兜底取第一句', () => {
        expect(parseTriggers('Deploy applications to Vercel. Use later.')).toEqual(['Deploy applications to Vercel']);
    });
    it('空 description 返回空数组', () => {
        expect(parseTriggers('')).toEqual([]);
    });
});
```

**Step 2: 跑测试确认失败**

Run: `cd packages/happy-app && npx vitest run sources/sync/skills.spec.ts`
Expected: FAIL（`parseTriggers` 未定义 / 模块不存在）

**Step 3: 最小实现**

`skills.ts`:

```typescript
export interface SkillEntry {
    path: string;       // SKILL.md 绝对路径
    name: string;       // frontmatter name
    description: string;
    triggers: string[];
    source: 'personal' | 'plugin';
}

/** 从 description 提炼可能的触发词，纯本地正则，零模型 */
export function parseTriggers(description: string): string[] {
    if (!description?.trim()) return [];

    // 1) 中文「触发词：a、b、c」/「触发：…」
    const zh = description.match(/触发词[:：]\s*([^。\n]+)/);
    if (zh) return splitList(zh[1]);

    // 2) 中文「触发于 X 或 …」
    const zhOn = description.match(/触发于\s*([^。\n，,]+)/);
    if (zhOn) return splitList(zhOn[1].replace(/\s*或.*$/, ''));

    // 3) 英文 Triggers include "a", "b"
    const en = [...description.matchAll(/"([^"]+)"/g)].map(m => m[1]);
    if (/Triggers include/i.test(description) && en.length) return en;

    // 4) 兜底：第一句
    const first = description.split(/[。.!?\n]/)[0].trim();
    return first ? [first] : [];
}

function splitList(s: string): string[] {
    return s.split(/[、,，·]/).map(x => x.trim()).filter(Boolean);
}
```

**Step 4: 跑测试确认通过**

Run: `cd packages/happy-app && npx vitest run sources/sync/skills.spec.ts`
Expected: PASS（5 passed）

**Step 5: Commit**

```bash
git add packages/happy-app/sources/sync/skills.ts packages/happy-app/sources/sync/skills.spec.ts
git commit -m "feat(skills): parseTriggers + SkillEntry types (TDD)"
```

---

## Task 3: 扫描 + 解析 SKILL.md 列表（TDD 解析层）

**Files:**
- Modify: `packages/happy-app/sources/sync/skills.ts`
- Modify: `packages/happy-app/sources/sync/skills.spec.ts`

**Step 1: 写失败测试（解析 bash 输出）**

约定扫描脚本对每个 SKILL.md 输出一行：`<path>\x1f<name>\x1f<description>`，记录之间用 `\x1e` 分隔。

追加到 `skills.spec.ts`:

```typescript
import { parseSkillList } from './skills';

describe('parseSkillList', () => {
    it('切分 bash 输出并标注来源', () => {
        const raw = [
            '/Users/x/.claude/skills/todo/SKILL.md\x1ftodo\x1f上下文快照。触发词：add、resolve',
            '/Users/x/.claude/plugins/cache/m/p/1/skills/foo/SKILL.md\x1ffoo\x1fBar baz.',
        ].join('\x1e');
        const list = parseSkillList(raw);
        expect(list).toHaveLength(2);
        expect(list[0]).toMatchObject({ name: 'todo', source: 'personal', triggers: ['add', 'resolve'] });
        expect(list[1].source).toBe('plugin');
    });
    it('空输出返回空数组', () => {
        expect(parseSkillList('')).toEqual([]);
    });
});
```

**Step 2: 跑测试确认失败**

Run: `cd packages/happy-app && npx vitest run sources/sync/skills.spec.ts`
Expected: FAIL（`parseSkillList` 未定义）

**Step 3: 实现 parseSkillList**

追加到 `skills.ts`:

```typescript
const UNIT = '\x1f';   // 字段分隔
const RECORD = '\x1e'; // 记录分隔

export function parseSkillList(raw: string): SkillEntry[] {
    if (!raw?.trim()) return [];
    return raw.split(RECORD).map(line => line.trim()).filter(Boolean).map(line => {
        const [path = '', name = '', description = ''] = line.split(UNIT);
        return {
            path,
            name: name || path.split('/').slice(-2, -1)[0] || path,
            description,
            triggers: parseTriggers(description),
            source: path.includes('/plugins/cache/') ? 'plugin' as const : 'personal' as const,
        };
    }).filter(e => e.path);
}
```

**Step 4: 跑测试确认通过**

Run: `cd packages/happy-app && npx vitest run sources/sync/skills.spec.ts`
Expected: PASS（全部通过）

**Step 5: 实现扫描编排（非纯函数，不单测）**

追加到 `skills.ts`（import 放文件顶部）：

```typescript
import { machineBash } from './ops';

/** 在宿主机扫描所有 SKILL.md 并解析为 SkillEntry[] */
export async function scanSkills(machineId: string): Promise<SkillEntry[]> {
    const cmd = String.raw`
for f in $(find "$HOME/.claude/skills" "$HOME"/.claude/plugins/cache/*/*/*/skills -maxdepth 2 -name SKILL.md 2>/dev/null); do
  name=$(awk -F': *' '/^name:/{print $2; exit}' "$f")
  desc=$(awk '/^description:/{sub(/^description: */,""); print; exit}' "$f")
  printf '%s\x1f%s\x1f%s\x1e' "$f" "$name" "$desc"
done
`;
    const res = await machineBash(machineId, { command: cmd, timeout: 20000 });
    if (!res.success) throw new Error(res.error || res.stderr || '扫描失败');
    return parseSkillList(res.stdout);
}
```

> 注：`description` 多行的 skill 这里只取首行——足够提炼触发词；详情页读全文不受影响。

**Step 6: 类型检查 + Commit**

Run: `cd packages/happy-app && npx tsc --noEmit -p tsconfig.json 2>&1 | grep skills.ts || echo "skills.ts clean"`
Expected: `skills.ts clean`

```bash
git add packages/happy-app/sources/sync/skills.ts packages/happy-app/sources/sync/skills.spec.ts
git commit -m "feat(skills): scanSkills + parseSkillList host scanning"
```

---

## Task 4: Settings 入口 + 路由注册

**Files:**
- Modify: `packages/happy-app/sources/components/SettingsView.tsx`（Custom Instructions 入口附近，约 416 行）
- Modify: `packages/happy-app/sources/app/(app)/_layout.tsx`（约 129 行 custom-instructions 注册附近）

**Step 1: 加入口**

在 `SettingsView.tsx` 「记忆空间 / Custom Instructions」同组，仿照现有 `Item` 写法新增一项（图标用现有图标库里贴近「方块/技能」的，如 `cube` / `sparkles`）：

```tsx
<Item
    title="Skills 预览"
    icon={<Ionicons name="cube-outline" size={29} color="#34C759" />}
    onPress={() => router.push('/settings/skills' as any)}
/>
```

> 实现时先 `grep -n "Custom Instructions" SettingsView.tsx` 定位，照抄相邻 `Item` 的 props 结构与图标用法，保持一致。

**Step 2: 注册两条路由**

`_layout.tsx` 在 `settings/custom-instructions` 的 `<Stack.Screen>` 后追加：

```tsx
<Stack.Screen name="settings/skills" options={{ headerShown: false }} />
<Stack.Screen name="settings/skill" options={{ headerShown: false }} />
```

**Step 3: 类型检查 + Commit**

Run: `cd packages/happy-app && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "SettingsView|_layout" || echo "clean"`
Expected: `clean`

```bash
git add packages/happy-app/sources/components/SettingsView.tsx "packages/happy-app/sources/app/(app)/_layout.tsx"
git commit -m "feat(skills): add Skills 预览 settings entry + routes"
```

---

## Task 5: Skills 列表屏

**Files:**
- Create: `packages/happy-app/sources/app/(app)/settings/skills.tsx`

**Step 1: 实现列表页**

参照 `app/(app)/settings/custom-instructions.tsx` 的样式与 `Stack.Screen` 用法。要点：
- `const machines = useAllMachines();` 仅在线机器。
- 机器选择：`machines.length === 0` → 提示「无在线机器，请先连接」；`=== 1` → 直接用 `machines[0].id`；`> 1` → 顶部一个简单选择器（可复用 `SearchableListSelector` 或简单横向 chips），选中存 `useState`。
- 进入/切换机器后 `useEffect` 调 `scanSkills(machineId)`，loading/error/数据三态。
- 搜索框：本地 `filter`，匹配 `name` 或 `triggers`。
- 分组：`source === 'personal'` 置顶「个人 Skills」；`'plugin'` 放「插件 Skills」（可折叠，默认折叠）。
- 卡片：标题 = `name`，下方 `triggers` 渲染成小 chip（最多展示前若干个）。
- `onPress` → `router.push({ pathname: '/settings/skill', params: { path: skill.path, machineId, name: skill.name } })`。

骨架：

```tsx
import React from 'react';
import { View, ScrollView, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { Text } from '@/components/StyledText';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAllMachines } from '@/sync/storage';
import { scanSkills, type SkillEntry } from '@/sync/skills';

export default React.memo(function SkillsScreen() {
    const router = useRouter();
    const machines = useAllMachines();
    const [machineId, setMachineId] = React.useState<string | null>(null);
    const [skills, setSkills] = React.useState<SkillEntry[] | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [query, setQuery] = React.useState('');

    React.useEffect(() => {
        if (!machineId && machines.length > 0) setMachineId(machines[0].id);
    }, [machines, machineId]);

    React.useEffect(() => {
        if (!machineId) return;
        let cancelled = false;
        setSkills(null); setError(null);
        scanSkills(machineId)
            .then(r => { if (!cancelled) setSkills(r); })
            .catch(e => { if (!cancelled) setError(e?.message ?? '扫描失败'); });
        return () => { cancelled = true; };
    }, [machineId]);

    const filtered = (skills ?? []).filter(s =>
        !query || s.name.toLowerCase().includes(query.toLowerCase())
        || s.triggers.some(t => t.toLowerCase().includes(query.toLowerCase())));
    const personal = filtered.filter(s => s.source === 'personal');
    const plugin = filtered.filter(s => s.source === 'plugin');

    // ...渲染：Stack.Screen headerTitle="Skills 预览"；机器选择器（machines.length>1 时）；
    //    搜索框；loading(ActivityIndicator)/error/列表；分组标题 + 卡片。
    //    卡片 onPress 见上文 router.push。
    return (/* 见要点实现 */ null);
});
```

> 实现细节（样式、chip、折叠）照 `custom-instructions.tsx` 与现有组件风格补全；保持深色主题一致。

**Step 2: 类型检查**

Run: `cd packages/happy-app && npx tsc --noEmit -p tsconfig.json 2>&1 | grep skills.tsx || echo "skills.tsx clean"`
Expected: `skills.tsx clean`

**Step 3: Commit**

```bash
git add "packages/happy-app/sources/app/(app)/settings/skills.tsx"
git commit -m "feat(skills): skills list screen with machine select + search"
```

---

## Task 6: Skill 详情屏（只读 Markdown）

**Files:**
- Create: `packages/happy-app/sources/app/(app)/settings/skill.tsx`

**Step 1: 实现详情页**

```tsx
import React from 'react';
import { View, ScrollView, ActivityIndicator } from 'react-native';
import { Text } from '@/components/StyledText';
import { Stack, useLocalSearchParams } from 'expo-router';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { machineReadFile } from '@/sync/ops';
import { decodeBase64ToBytes } from '@/utils/readFileBytes';  // 确认导出名，否则照 FileViewPanel.tsx:114 引用
import { decodeUtf8Bytes } from '@/utils/...';                 // 同上，定位实际路径

export default React.memo(function SkillDetailScreen() {
    const { path, machineId, name } = useLocalSearchParams<{ path: string; machineId: string; name: string }>();
    const [content, setContent] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!path || !machineId) return;
        let cancelled = false;
        machineReadFile(machineId, path)
            .then(res => {
                if (cancelled) return;
                if (!res.success || !res.content) { setError(res.error || '读取失败'); return; }
                setContent(decodeUtf8Bytes(decodeBase64ToBytes(res.content)));
            })
            .catch(e => { if (!cancelled) setError(e?.message ?? '读取失败'); });
        return () => { cancelled = true; };
    }, [path, machineId]);

    return (
        <>
            <Stack.Screen options={{ headerShown: true, headerTitle: name || 'Skill' }} />
            <ScrollView contentContainerStyle={{ padding: 16 }}>
                {error ? <Text>{error}</Text>
                    : content == null ? <ActivityIndicator />
                    : <MarkdownView markdown={content} />}
            </ScrollView>
        </>
    );
});
```

> **先确认 decode helper 的真实导出**：`grep -rn "decodeBase64ToBytes\|decodeUtf8Bytes" packages/happy-app/sources/utils packages/happy-app/sources/components/FileViewPanel.tsx` —— 照实际 import 路径写。

**Step 2: 类型检查**

Run: `cd packages/happy-app && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "skill.tsx" || echo "skill.tsx clean"`
Expected: `skill.tsx clean`

**Step 3: Commit**

```bash
git add "packages/happy-app/sources/app/(app)/settings/skill.tsx"
git commit -m "feat(skills): skill detail screen renders SKILL.md as markdown"
```

---

## Task 7: 全量验证 + 手动冒烟

**Step 1: 全量类型 + 测试**

Run: `cd packages/happy-app && npx vitest run sources/sync/skills.spec.ts && npx tsc --noEmit -p tsconfig.json 2>&1 | tail -5`
Expected: 测试全绿；tsc 无新增错误（与改动相关）。

**Step 2: 手动冒烟（真机/模拟器）**

按项目现有启动方式跑起 app（参照仓库 README/AGENTS.md），进入：Settings → Skills 预览 →
- 看到个人 Skills 列表 + 触发词 chips
- 搜索过滤生效
- 点一个 skill → 进入详情页看到完整 SKILL.md 渲染

**Step 3: 收尾**

参照 superpowers:finishing-a-development-branch：推分支、开 PR。
PR 合并后按 Happy 铁律同步 `jacky-main` 并清理 worktree。
```

---

## 验证清单（执行时核对）

- [ ] `machineBash`/`machineReadFile` 走通 machine RPC（不依赖活跃 session）
- [ ] `parseTriggers` 中英文用例全绿
- [ ] `parseSkillList` 来源标注正确（personal vs plugin）
- [ ] 列表页机器选择三态（0 / 1 / 多）
- [ ] 详情页 base64 解码正确、Markdown 渲染正常
- [ ] 全程在 worktree，未碰 `jacky-main`
