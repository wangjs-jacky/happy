# 健康 Agent 首次交互优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让健康打卡 Agent 会话冷启动即正确识别（右面板即刻切健康面板）、进空会话有欢迎卡 + 后台问候、Agent 回复只留一行，面板空态是雅致休眠视觉。

**Architecture:** happy-app（React Native + zustand + MMKV + vitest）。新增本地会话字段 `spawnPath`（仿 `draft`），补齐"冷启动 path 迟到"；新增静态欢迎卡 + 隐藏消息机制驱动后台问候；升级健康面板空态。Agent 行为收敛靠重写 Obsidian 仓库里的 `健康打卡/CLAUDE.md`（纯配置）。

**Tech Stack:** TypeScript、React Native、zustand（`sync/storage.ts`）、react-native-mmkv（`sync/persistence.ts`）、vitest、react-native-unistyles、i18n（`sources/text/`）。

## Global Constraints

- 语言：所有新增文案先写英文（`text/_default.ts`），再补全 **11 个语言文件**（`_default.ts` + `translations/{zh-Hans,zh-Hant,en,ja,ru,pl,es,it,pt,ca}.ts`）；`_default.ts` 的 `en` 是类型 source of truth，缺 key 会 TS 报错。
- 数据契约：`健康打卡/日报` 的 YAML frontmatter 字段名/格式**一字不动**（`utils/healthLog.ts` 靠正则抽取，漂移即面板显示「—」）。
- 平台/发布：本计划 Phase 2.x 只改 happy-app 的 JS/TSX，**不新增原生依赖、不改 runtimeVersion** → 走 OTA。
- 会话本地字段（`draft/permissionMode/modelMode/effortLevel/spawnPath`）**仅本地**，不上行服务端。
- 测试：vitest，`describe/it/expect`。跑单文件：`cd packages/happy-app && pnpm test <相对路径>`。
- 提交：每个 Task 末尾提交一次，遵循 Conventional Commits（`feat(health)/fix/docs`）。
- worktree：在 `happy--health-onboarding`（分支 `health-onboarding`）里工作。

---

## Task 1: 重写 `健康打卡/CLAUDE.md`（Phase 1，配置）

**Files:**
- Modify: `/Users/jiashengwang/jacky-github/jacky-obsidian/人生辅助系统/健康打卡/CLAUDE.md`（不在 happy repo；改完触发 Obsidian 同步）

**说明：** 无自动化测试，验收靠真机丢图。此 Task 独立，可最先做，立刻见效。

- [ ] **Step 1: 在「一、我是谁」小节末尾（职责列表之后）插入一条硬铁律块**

```markdown
---

> [!important] 回复铁律（最高优先级）
> 收到图片或数据后：**静默看图 → 提取 → 落盘**，默认**只回一行**：
> `已存入 · <一句关键数字>`
> 例：`已存入 · 昨晚 7h20m / 评分 82，跑步 5km / 320kcal`
>
> **禁止**（除非用户明确追问）：逐张讲解看到了什么、复述提取过程、把 frontmatter 贴出来、写多段小结。
> 一行确认即完成；用户想看细节会自己问。
```

- [ ] **Step 2: 把「二、核心工作流」的第 4 步「简短反馈」替换为带 ✅/❌ 样例的版本**

将现有：
```markdown
### 4. 简短反馈
写完给用户一句话小结：今天记了什么、关键数字、（如有）和昨天/目标的对比。不长篇大论。
```
替换为：
```markdown
### 4. 一行反馈（严格）
只回一行 `已存入 · <关键数字>`，不展开。

- ❌ `我看到第一张是睡眠截图，识别到总时长 7h20m、深睡…；第二张是跑步…已写入今天的日报，包含以下字段：…`
- ✅ `已存入 · 昨晚 7h20m / 评分 82，跑步 5km / 320kcal`

看不清/算不出的字段，如实说「X 我不确定，你补一句？」，不要瞎编。
```

- [ ] **Step 3: 把操作细节下沉到文末附录**

把「二」小节里第 2 步「存原图」下方那段 `> 原图从哪来（关键机制）…` 引用块（含 UTC 时区、配对方法、cd 中文路径踩坑），整段剪切到文件最末尾，标题改为：
```markdown
---

## 附录：落盘操作细则（需要时查，日常无需读）

### 原图归档机制
（此处粘贴原本那段"原图从哪来"的完整内容）
```
「六、睡眠段写完自检清单」同样移动到附录之下（主干不再穿插自检细节）。

- [ ] **Step 4: 确认 YAML Schema 一字未改**

检查「三、日报 YAML Schema」小节与「睡眠字段权威表」**完全未动**（字段名、`XhYm` 格式、`评分` 纯数字等）。

- [ ] **Step 5: 触发 Obsidian 同步 + 真机验收**

```bash
curl -sk -X POST -H "Authorization: Bearer $OBSIDIAN_REST_API_KEY" \
  "https://127.0.0.1:27124/commands/remotely-save:start-sync/"
```
验收：手机丢一张睡眠截图 → Agent 回一行 `已存入 · …`；`日报/<今天>.md` 出现合规 frontmatter；面板下拉刷新后睡眠 Hero 正确显示时长/评分。

- [ ] **Step 6: Commit**

该文件在 Obsidian 仓库：
```bash
cd /Users/jiashengwang/jacky-github/jacky-obsidian
git add "人生辅助系统/健康打卡/CLAUDE.md"
git commit -m "feat(health): CLAUDE.md 收敛为静默消化+一行反馈，操作细则下沉附录"
```

---

## Task 2: `spawnPath` 持久化读写（Phase 2.0a）

**Files:**
- Modify: `packages/happy-app/sources/sync/persistence.ts`
- Test: `packages/happy-app/sources/sync/persistence.spawnPath.test.ts`（新建）

**Interfaces:**
- Produces: `loadSessionSpawnPaths(): Record<string, string>`、`saveSessionSpawnPaths(paths: Record<string, string>): void`

- [ ] **Step 1: 写失败测试**

`packages/happy-app/sources/sync/persistence.spawnPath.test.ts`：
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { loadSessionSpawnPaths, saveSessionSpawnPaths } from './persistence';

describe('session spawn paths persistence', () => {
    beforeEach(() => {
        saveSessionSpawnPaths({});
    });

    it('returns empty object when nothing saved', () => {
        expect(loadSessionSpawnPaths()).toEqual({});
    });

    it('round-trips saved paths', () => {
        saveSessionSpawnPaths({ s1: '/a/健康打卡', s2: '/b/repo' });
        expect(loadSessionSpawnPaths()).toEqual({ s1: '/a/健康打卡', s2: '/b/repo' });
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/happy-app && pnpm test sources/sync/persistence.spawnPath.test.ts`
Expected: FAIL —— `loadSessionSpawnPaths is not a function`（未导出）。

- [ ] **Step 3: 在 `persistence.ts` 仿 `loadSessionDrafts/saveSessionDrafts` 增实现**

紧邻 `saveSessionDrafts` 之后加入：
```typescript
export function loadSessionSpawnPaths(): Record<string, string> {
    const raw = mmkv.getString('session-spawn-paths');
    if (raw) {
        try {
            return JSON.parse(raw);
        } catch (e) {
            console.error('Failed to parse session spawn paths', e);
            return {};
        }
    }
    return {};
}

export function saveSessionSpawnPaths(paths: Record<string, string>) {
    mmkv.set('session-spawn-paths', JSON.stringify(paths));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/happy-app && pnpm test sources/sync/persistence.spawnPath.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/happy-app/sources/sync/persistence.ts packages/happy-app/sources/sync/persistence.spawnPath.test.ts
git commit -m "feat(health): 会话 spawnPath 的 MMKV 持久化读写"
```

---

## Task 3: `Session.spawnPath` 字段 + store setter + applySessions 合并（Phase 2.0b）

**Files:**
- Modify: `packages/happy-app/sources/sync/storageTypes.ts`（Session 接口）
- Modify: `packages/happy-app/sources/sync/storage.ts`（import、applySessions 合并、`updateSessionSpawnPath` setter）
- Test: `packages/happy-app/sources/sync/storage.spawnPath.test.ts`（新建）

**Interfaces:**
- Consumes: `loadSessionSpawnPaths` / `saveSessionSpawnPaths`（Task 2）
- Produces: `Session.spawnPath?: string | null`；store action `updateSessionSpawnPath(sessionId: string, path: string | null): void`

- [ ] **Step 1: Session 接口加字段**

`storageTypes.ts` 的 `Session` 接口，在 `effortLevel` 一行下方加：
```typescript
    spawnPath?: string | null; // Local known working dir (seeded at spawn), fallback when metadata.path is absent
```

- [ ] **Step 2: 写失败测试**

`packages/happy-app/sources/sync/storage.spawnPath.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { storage } from './storage';
import { saveSessionSpawnPaths, loadSessionSpawnPaths } from './persistence';

function baseSession(id: string, overrides: Partial<any> = {}) {
    return {
        id, seq: 1, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
        metadata: null, metadataVersion: 1, agentState: null, agentStateVersion: 1,
        thinking: false, thinkingAt: 0, ...overrides,
    };
}

describe('session spawnPath', () => {
    it('updateSessionSpawnPath sets field and persists', () => {
        storage.getState().applySessions([baseSession('s1')]);
        storage.getState().updateSessionSpawnPath('s1', '/vault/健康打卡');
        expect(storage.getState().sessions['s1'].spawnPath).toBe('/vault/健康打卡');
        expect(loadSessionSpawnPaths()['s1']).toBe('/vault/健康打卡');
    });

    it('applySessions restores spawnPath from persistence when metadata absent', () => {
        saveSessionSpawnPaths({ s2: '/vault/健康打卡' });
        // 触发一次"初始加载"（sessions 为空时才读 saved）
        storage.setState({ sessions: {} } as any);
        storage.getState().applySessions([baseSession('s2')]);
        expect(storage.getState().sessions['s2'].spawnPath).toBe('/vault/健康打卡');
    });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/happy-app && pnpm test sources/sync/storage.spawnPath.test.ts`
Expected: FAIL —— `updateSessionSpawnPath is not a function`。

- [ ] **Step 4: 实现 —— import + 初始加载读取**

`storage.ts` 顶部把 spawnPath 持久化函数并入既有 import：
```typescript
import { /* ...existing... */ loadSessionSpawnPaths, saveSessionSpawnPaths } from './persistence';
```
在文件里既有 `const sessionDrafts = loadSessionDrafts();` 等模块级常量旁，加：
```typescript
const sessionSpawnPaths = loadSessionSpawnPaths();
```

- [ ] **Step 5: 实现 —— applySessions 合并**

在 `applySessions` 里，仿 `savedDrafts` 增初始加载读取：
```typescript
const savedSpawnPaths = isInitialLoad ? sessionSpawnPaths : {};
```
在逐会话合并处（写 `mergedSessions[session.id] = { ...session, ... }` 的对象里），仿 draft 增：
```typescript
const existingSpawnPath = state.sessions[session.id]?.spawnPath ?? null;
const savedSpawnPath = savedSpawnPaths[session.id] ?? null;
// metadata.path 到手即以其为准；否则回退内存/本地缓存
const resolvedSpawnPath = session.metadata?.path ?? existingSpawnPath ?? savedSpawnPath ?? null;
```
并在合并对象里加一行 `spawnPath: resolvedSpawnPath,`。

- [ ] **Step 6: 实现 —— updateSessionSpawnPath setter（仿 updateSessionDraft）**

紧邻 `updateSessionDraft` 之后加入：
```typescript
updateSessionSpawnPath: (sessionId: string, path: string | null) => set((state) => {
    const session = state.sessions[sessionId];
    if (!session) return state;
    const normalized = path?.trim() ? path : null;
    const allPaths: Record<string, string> = {};
    Object.entries(state.sessions).forEach(([id, sess]) => {
        if (id === sessionId) {
            if (normalized) allPaths[id] = normalized;
        } else if (sess.spawnPath) {
            allPaths[id] = sess.spawnPath;
        }
    });
    saveSessionSpawnPaths(allPaths);
    return {
        ...state,
        sessions: { ...state.sessions, [sessionId]: { ...session, spawnPath: normalized } },
    };
}),
```
并在 store 的**类型接口**（`updateSessionDraft` 声明处，通常在 storage.ts 上部的 state 接口）加：
```typescript
    updateSessionSpawnPath: (sessionId: string, path: string | null) => void;
```

- [ ] **Step 7: 跑测试确认通过**

Run: `cd packages/happy-app && pnpm test sources/sync/storage.spawnPath.test.ts`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add packages/happy-app/sources/sync/storageTypes.ts packages/happy-app/sources/sync/storage.ts packages/happy-app/sources/sync/storage.spawnPath.test.ts
git commit -m "feat(health): Session.spawnPath 字段 + setter + applySessions 回退合并"
```

---

## Task 4: `sessionWorkingPath` helper + 接入 SessionView 面板判断（Phase 2.0c）

**Files:**
- Create: `packages/happy-app/sources/sync/sessionWorkingPath.ts`
- Test: `packages/happy-app/sources/sync/sessionWorkingPath.test.ts`
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`（面板判断 + 后续欢迎卡都用它）

**Interfaces:**
- Consumes: `Session`（含 `metadata.path` 与 `spawnPath`）
- Produces: `sessionWorkingPath(session?: Session | null): string | null`

- [ ] **Step 1: 写失败测试**

`packages/happy-app/sources/sync/sessionWorkingPath.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { sessionWorkingPath } from './sessionWorkingPath';

describe('sessionWorkingPath', () => {
    it('prefers metadata.path', () => {
        expect(sessionWorkingPath({ metadata: { path: '/a' }, spawnPath: '/b' } as any)).toBe('/a');
    });
    it('falls back to spawnPath when metadata missing', () => {
        expect(sessionWorkingPath({ metadata: null, spawnPath: '/b/健康打卡' } as any)).toBe('/b/健康打卡');
    });
    it('returns null when neither present', () => {
        expect(sessionWorkingPath({ metadata: null } as any)).toBeNull();
        expect(sessionWorkingPath(null)).toBeNull();
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/happy-app && pnpm test sources/sync/sessionWorkingPath.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 helper**

`packages/happy-app/sources/sync/sessionWorkingPath.ts`：
```typescript
import type { Session } from './storageTypes';

/** 会话真实工作目录：优先服务端 metadata.path，其次本地 spawnPath 缓存。 */
export function sessionWorkingPath(session?: Session | null): string | null {
    return session?.metadata?.path ?? session?.spawnPath ?? null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/happy-app && pnpm test sources/sync/sessionWorkingPath.test.ts`
Expected: PASS。

- [ ] **Step 5: 接入 SessionView 面板判断**

`-session/SessionView.tsx`：加 import
```typescript
import { sessionWorkingPath } from '@/sync/sessionWorkingPath';
```
把面板判断（约 335 行）改为：
```typescript
const workingPath = sessionWorkingPath(session);
const rightPanel = isHealthCheckinSession(workingPath)
    ? <HealthCheckinPanel onInsertQuickPrompt={handleInsertQuickPrompt} sessionId={sessionId} />
    : <SessionCapabilityHub onInsertQuickPrompt={handleInsertQuickPrompt} sessionId={sessionId} />;
```

- [ ] **Step 6: 跑一遍相关既有测试确保没破**

Run: `cd packages/happy-app && pnpm test sources/sync/sessionWorkingPath.test.ts sources/sync/storage.spawnPath.test.ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/happy-app/sources/sync/sessionWorkingPath.ts packages/happy-app/sources/sync/sessionWorkingPath.test.ts packages/happy-app/sources/-session/SessionView.tsx
git commit -m "feat(health): sessionWorkingPath 回退取路径并接入右面板判断"
```

---

## Task 5: spawn 时播种 spawnPath（Phase 2.0d）

**Files:**
- Modify: `packages/happy-app/sources/app/(app)/machine/[id].tsx`
- Modify: `packages/happy-app/sources/components/ComposeHome.tsx`
- Modify: `packages/happy-app/sources/hooks/useSpawnSession.ts`

**说明：** 这三处是 UI 调用点（难做纯单测），验收靠"新建健康会话冷启动即显示健康面板"。核心 store 行为已在 Task 3 覆盖。

**Interfaces:**
- Consumes: `storage.getState().updateSessionSpawnPath`（Task 3）；各调用点已有的 `absolutePath`/`directory` 与返回的 `sessionId`。

- [ ] **Step 1: `machine/[id].tsx` 播种**

在 `handleStartSession` 里 `case 'success':` 分支，`navigateToSession(result.sessionId)` **之前**加：
```typescript
storage.getState().updateSessionSpawnPath(result.sessionId, absolutePath);
```
确认 `storage` 已 import（`import { storage } from '@/sync/storage'`，无则加）。

- [ ] **Step 2: `useSpawnSession.ts` 播种**

该 hook 里同样在 `machineSpawnNewSession` 返回 `type === 'success'` 后，用调用时传入的目录参数播种：
```typescript
storage.getState().updateSessionSpawnPath(result.sessionId, /* 该处的 directory 变量 */ directory);
```
（若 hook 内目录变量名不同，用其实际的绝对路径变量。）

- [ ] **Step 3: `ComposeHome.tsx` 播种**

`ComposeHome.tsx` 里 `machineSpawnNewSession(...)` 成功后，同法播种其目录变量。

- [ ] **Step 4: 类型检查**

Run: `cd packages/happy-app && pnpm exec tsc --noEmit`
Expected: 无新增类型错误（若项目 tsc 较慢，可只 `pnpm test` 相关文件 + 人工确认三处编辑）。

- [ ] **Step 5: Commit**

```bash
git add "packages/happy-app/sources/app/(app)/machine/[id].tsx" packages/happy-app/sources/components/ComposeHome.tsx packages/happy-app/sources/hooks/useSpawnSession.ts
git commit -m "feat(health): spawn 成功即播种 spawnPath，冷启动识别健康会话"
```

---

## Task 6: 新增 i18n 文案（欢迎卡 + 休眠空态）

**Files:**
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/{zh-Hans,zh-Hant,en,ja,ru,pl,es,it,pt,ca}.ts`

**说明：** 集中加一次，供 Task 7/8 使用。所有 key 加到既有 `healthPanel` 段内。

**Interfaces:**
- Produces（key，均在 `healthPanel.` 下）：`welcomeRole`、`welcomeSubtitle`、`welcomeSleep`、`welcomeExercise`、`welcomeDiet`、`welcomeHint`、`dormantTitle`、`dormantHint`

- [ ] **Step 1: `_default.ts`（英文，source of truth）在 `healthPanel` 段加**

```typescript
        welcomeRole: 'Health Check-in',
        welcomeSubtitle: "Drop a screenshot — I'll log it for you.",
        welcomeSleep: 'Sleep',
        welcomeExercise: 'Exercise',
        welcomeDiet: 'Diet',
        welcomeHint: 'Sleep report, workout stats, meal photos — I read them and file the numbers.',
        dormantTitle: 'Resting',
        dormantHint: 'Drop a screenshot to start logging.',
```

- [ ] **Step 2: `zh-Hans.ts` 加对应中文**

```typescript
        welcomeRole: '健康打卡',
        welcomeSubtitle: '丢一张截图，我来帮你记。',
        welcomeSleep: '睡眠',
        welcomeExercise: '运动',
        welcomeDiet: '饮食',
        welcomeHint: '睡眠报告、运动数据、餐食照片 —— 我看懂并把数字记进日报。',
        dormantTitle: '休眠中',
        dormantHint: '丢一张截图，开始记录。',
```

- [ ] **Step 3: 其余 9 个语言文件加同名 key**

对 `zh-Hant,en,ja,ru,pl,es,it,pt,ca` 每个文件的 `healthPanel` 段加上 8 个 key。翻译对照（各语言 `welcomeRole / welcomeSubtitle / welcomeSleep / welcomeExercise / welcomeDiet / welcomeHint / dormantTitle / dormantHint`）：

- zh-Hant：`健康打卡` / `丟一張截圖，我來幫你記。` / `睡眠` / `運動` / `飲食` / `睡眠報告、運動數據、餐食照片 —— 我看懂並把數字記進日報。` / `休眠中` / `丟一張截圖，開始記錄。`
- en（若 `en.ts` 独立存在）：同 `_default.ts`
- ja：`健康チェックイン` / `スクショを送って、記録します。` / `睡眠` / `運動` / `食事` / `睡眠レポート・運動データ・食事写真 — 読み取って数値を記録します。` / `休止中` / `スクショを送って記録を開始。`
- ru：`Дневник здоровья` / `Пришлите скриншот — я всё запишу.` / `Сон` / `Спорт` / `Питание` / `Отчёт о сне, тренировки, фото еды — распознаю и сохраню цифры.` / `Ожидание` / `Пришлите скриншот, чтобы начать.`
- pl：`Dziennik zdrowia` / `Wyślij zrzut ekranu — zapiszę to.` / `Sen` / `Ćwiczenia` / `Dieta` / `Raport snu, statystyki treningu, zdjęcia posiłków — odczytam i zapiszę liczby.` / `Uśpiony` / `Wyślij zrzut, aby zacząć.`
- es：`Registro de salud` / `Envía una captura y la registro por ti.` / `Sueño` / `Ejercicio` / `Dieta` / `Informe de sueño, datos de ejercicio, fotos de comidas: los leo y guardo las cifras.` / `En reposo` / `Envía una captura para empezar.`
- it：`Diario salute` / `Manda uno screenshot, lo registro io.` / `Sonno` / `Esercizio` / `Dieta` / `Report del sonno, dati di allenamento, foto dei pasti: leggo e salvo i numeri.` / `In pausa` / `Manda uno screenshot per iniziare.`
- pt：`Registro de saúde` / `Envie um print e eu registro pra você.` / `Sono` / `Exercício` / `Dieta` / `Relatório de sono, dados de treino, fotos das refeições — eu leio e salvo os números.` / `Em repouso` / `Envie um print para começar.`
- ca：`Registre de salut` / `Envia una captura i ho registro jo.` / `Son` / `Exercici` / `Dieta` / `Informe de son, dades d'exercici, fotos dels àpats: els llegeixo i deso les xifres.` / `En repòs` / `Envia una captura per començar.`

- [ ] **Step 4: 类型检查（缺 key 会报错）**

Run: `cd packages/happy-app && pnpm exec tsc --noEmit`
Expected: 无 i18n 相关缺字段报错。

- [ ] **Step 5: Commit**

```bash
git add packages/happy-app/sources/text/
git commit -m "i18n(health): 欢迎卡 + 休眠空态文案补全 11 语言"
```

---

## Task 7: `HealthWelcomeCard` 组件 + 空态判定 + SessionView 接入（Phase 2a）

> **测试策略（重要，覆盖原计划）**：本仓库 vitest 为 `environment: 'node'`，**未装 `@testing-library/react-native`，现存 104 个测试全是纯逻辑 `.ts`、零组件渲染测试**（连 `import 'react-native'` 都要 mock）。因此**不对 RN 组件做渲染测试**（与仓库既有约定一致，也避免引入新测试依赖违背零新依赖约束）。改为：把"是否显示欢迎卡"的判定抽成**纯函数** TDD；静态展示组件 `HealthWelcomeCard` 不写渲染测试。

**Files:**
- Create: `packages/happy-app/sources/-session/healthSessionView.ts`（纯判定函数）
- Test: `packages/happy-app/sources/-session/healthSessionView.test.ts`
- Create: `packages/happy-app/sources/components/rightPanel/HealthWelcomeCard.tsx`（静态展示组件，无测试）
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`（空健康会话渲染欢迎卡）

**Interfaces:**
- Consumes: `sessionWorkingPath`（Task 4）、`isHealthCheckinSession`、i18n key（Task 6）
- Produces: `shouldShowHealthWelcome(args: { isHealth: boolean; visibleCount: number }): boolean`（= `isHealth && visibleCount === 0`）；`HealthWelcomeCard` named export 组件。

- [ ] **Step 1: 写纯函数失败测试**

`packages/happy-app/sources/-session/healthSessionView.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { shouldShowHealthWelcome } from './healthSessionView';

describe('shouldShowHealthWelcome', () => {
    it('true for empty health session', () => {
        expect(shouldShowHealthWelcome({ isHealth: true, visibleCount: 0 })).toBe(true);
    });
    it('false when there are visible messages', () => {
        expect(shouldShowHealthWelcome({ isHealth: true, visibleCount: 2 })).toBe(false);
    });
    it('false for non-health session', () => {
        expect(shouldShowHealthWelcome({ isHealth: false, visibleCount: 0 })).toBe(false);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/happy-app && pnpm exec vitest run sources/-session/healthSessionView.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现纯函数**

`packages/happy-app/sources/-session/healthSessionView.ts`：
```typescript
/** 是否在空的健康会话显示欢迎卡：健康会话且当前无可见消息。 */
export function shouldShowHealthWelcome(a: { isHealth: boolean; visibleCount: number }): boolean {
    return a.isHealth && a.visibleCount === 0;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/happy-app && pnpm exec vitest run sources/-session/healthSessionView.test.ts`
Expected: PASS（3/3）。

- [ ] **Step 5: 实现静态展示组件（无测试，沿用 SleepHeroCard 的样式语言）**

实现前先打开 `SleepHeroCard.tsx` 确认 unistyles 用法（`StyleSheet.create((theme)=>…)` 还是 `useUnistyles()`）与 theme token 名，**与之一致**。`HealthWelcomeCard.tsx`：
```typescript
import * as React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
    role: { fontSize: 20, fontWeight: '700', color: theme.colors.text },
    subtitle: { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center' },
    domains: { flexDirection: 'row', gap: 20, marginTop: 8 },
    domain: { alignItems: 'center', gap: 6 },
    domainLabel: { fontSize: 13, color: theme.colors.textSecondary },
    hint: { fontSize: 13, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 20 },
}));

export function HealthWelcomeCard() {
    const styles = stylesheet;
    return (
        <View style={styles.container}>
            <Ionicons name="heart-circle-outline" size={64} color={styles.role.color as string} />
            <Text style={styles.role}>{t('healthPanel.welcomeRole')}</Text>
            <Text style={styles.subtitle}>{t('healthPanel.welcomeSubtitle')}</Text>
            <View style={styles.domains}>
                <View style={styles.domain}>
                    <Ionicons name="moon-outline" size={24} color={styles.domainLabel.color as string} />
                    <Text style={styles.domainLabel}>{t('healthPanel.welcomeSleep')}</Text>
                </View>
                <View style={styles.domain}>
                    <Ionicons name="barbell-outline" size={24} color={styles.domainLabel.color as string} />
                    <Text style={styles.domainLabel}>{t('healthPanel.welcomeExercise')}</Text>
                </View>
                <View style={styles.domain}>
                    <Ionicons name="restaurant-outline" size={24} color={styles.domainLabel.color as string} />
                    <Text style={styles.domainLabel}>{t('healthPanel.welcomeDiet')}</Text>
                </View>
            </View>
            <Text style={styles.hint}>{t('healthPanel.welcomeHint')}</Text>
        </View>
    );
}
```

- [ ] **Step 6: SessionView 空健康会话渲染欢迎卡**

在 `SessionView.tsx` 里渲染消息列表 / 空态的位置（`SessionViewLoaded` 内取 `useSessionMessages(sessionId)` 后），加：
```typescript
import { HealthWelcomeCard } from '@/components/rightPanel/HealthWelcomeCard';
import { shouldShowHealthWelcome } from './healthSessionView';
// ...
const visibleCount = messages.filter(m => !m.meta?.hidden).length;  // Task 9 定义 meta.hidden；未落地时恒等于 messages.length
if (shouldShowHealthWelcome({ isHealth: isHealthCheckinSession(sessionWorkingPath(session)), visibleCount })) {
    return <HealthWelcomeCard />;
}
```
> 若 `SessionViewLoaded` 不在 `SessionView.tsx` 而在独立文件，改对应文件；插在"消息为空时的既有空态"之前（健康会话优先走欢迎卡）。

- [ ] **Step 7: 验证 + Commit**

Run: `cd packages/happy-app && pnpm exec vitest run sources/-session/healthSessionView.test.ts`（3/3）；并 `pnpm exec tsc --noEmit 2>&1 | grep -E 'healthSessionView|HealthWelcomeCard|-session/SessionView'` 无命中（改动文件无类型错误）。
```bash
git add packages/happy-app/sources/-session/healthSessionView.ts packages/happy-app/sources/-session/healthSessionView.test.ts packages/happy-app/sources/components/rightPanel/HealthWelcomeCard.tsx packages/happy-app/sources/-session/SessionView.tsx
git commit -m "feat(health): 空健康会话静态欢迎卡 + 空态判定纯函数"
```

---

## Task 8: 健康面板休眠空态（Phase 2c）

> **测试策略（同 Task 7，覆盖原计划）**：静态组件不做渲染测试。本任务是**纯 JSX 替换、无新增逻辑**，故**不新增单测**；验证靠 `tsc` + 既有 `rightPanel/` 测试不破。

**Files:**
- Create: `packages/happy-app/sources/components/rightPanel/HealthDormantState.tsx`（静态组件，无测试）
- Modify: `packages/happy-app/sources/components/rightPanel/HealthCheckinPanel.tsx`（替换现有 `notLoggedToday` 纯文字空态）

**Interfaces:**
- Consumes: i18n `healthPanel.dormantTitle` / `dormantHint`（Task 6）
- Produces: `HealthDormantState` named export 组件

- [ ] **Step 1: 实现静态组件（月亮休眠视觉，复用欢迎卡的样式语言）**

实现前对齐 `SleepHeroCard.tsx` / `HealthWelcomeCard.tsx` 的 unistyles 用法与 theme token。`HealthDormantState.tsx`：
```typescript
import * as React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    container: { alignItems: 'center', justifyContent: 'center', paddingVertical: 28, gap: 8 },
    title: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
    hint: { fontSize: 13, color: theme.colors.textSecondary, textAlign: 'center' },
}));

export function HealthDormantState() {
    const styles = stylesheet;
    return (
        <View style={styles.container}>
            <Ionicons name="moon-outline" size={40} color={styles.hint.color as string} />
            <Text style={styles.title}>{t('healthPanel.dormantTitle')}</Text>
            <Text style={styles.hint}>{t('healthPanel.dormantHint')}</Text>
        </View>
    );
}
```

- [ ] **Step 2: 在 HealthCheckinPanel 替换纯文字空态**

先读 `HealthCheckinPanel.tsx` 找到睡眠域"今天无记录"的裸文字空态（含 `t('healthPanel.notLoggedToday')` 那段 `<View>`），替换为：
```typescript
return <HealthDormantState />;
```
并加 import：`import { HealthDormantState } from './HealthDormantState';`。运动/饮食域若也有 `noExerciseToday`/`noDietToday` 的裸文字空态，同样替换为 `<HealthDormantState />`（保持三域一致）。**只改空态分支，有数据分支不动。**

- [ ] **Step 3: 验证既有测试不破 + 类型**

Run: `cd packages/happy-app && pnpm exec vitest run sources/components/rightPanel/`（含既有 HealthCheckinPanel/healthLog 测试，全绿）。
并 `pnpm exec tsc --noEmit 2>&1 | grep -E 'HealthDormantState|HealthCheckinPanel'` 无命中。

- [ ] **Step 4: Commit**

```bash
git add packages/happy-app/sources/components/rightPanel/HealthDormantState.tsx packages/happy-app/sources/components/rightPanel/HealthCheckinPanel.tsx
git commit -m "feat(health): 面板无数据时的休眠空态"
```

---

## Task 9: 隐藏消息机制（Phase 2b - 1/2）

**Files:**
- Modify: `packages/happy-app/sources/sync/typesMessageMeta.ts`（`hidden` 字段）
- Create: `packages/happy-app/sources/sync/messageVisibility.ts`（纯过滤函数，无 RN import）
- Test: `packages/happy-app/sources/sync/messageVisibility.test.ts`
- Modify: `packages/happy-app/sources/sync/sync.ts`（`SendMessageOptions.hidden` → `meta.hidden`）
- Modify: `packages/happy-app/sources/components/ChatList.tsx`（渲染前过滤 `meta.hidden`）

**Interfaces:**
- Produces: `MessageMeta.hidden?: boolean`；`filterVisibleMessages(messages): Message[]`（纯函数，drop `meta.hidden`）；`sendMessage(sessionId, text, { hidden: true })` 使该消息不在列表渲染。

> **为何单独建 `messageVisibility.ts`**：过滤纯函数必须放在**不 import react-native 的模块**里，否则其单测在 `environment: node` 的 vitest 下会因 `ChatList.tsx` 的 RN import 链崩溃。`ChatList.tsx` 从该模块 import 使用。

- [ ] **Step 1: schema 加 `hidden`**

`typesMessageMeta.ts` 的 `MessageMetaSchema` 加：
```typescript
    hidden: z.boolean().optional(), // 客户端注入的隐藏 prompt，不在聊天流渲染
```

- [ ] **Step 2: 写纯过滤函数测试（先失败）**

`packages/happy-app/sources/sync/messageVisibility.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { filterVisibleMessages } from './messageVisibility';

describe('filterVisibleMessages', () => {
    it('drops messages with meta.hidden', () => {
        const msgs = [
            { id: 'a', meta: { hidden: true } },
            { id: 'b', meta: {} },
            { id: 'c' },
        ] as any;
        expect(filterVisibleMessages(msgs).map((m: any) => m.id)).toEqual(['b', 'c']);
    });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/happy-app && pnpm exec vitest run sources/sync/messageVisibility.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 4: 实现纯模块 + 在 ChatList 使用**

`packages/happy-app/sources/sync/messageVisibility.ts`：
```typescript
import type { Message } from '@/sync/typesRaw';

/** 过滤掉客户端注入的隐藏消息（不在聊天流渲染）。 */
export function filterVisibleMessages(messages: Message[]): Message[] {
    return messages.filter((m) => !m.meta?.hidden);
}
```
跑测试确认 GREEN。然后 `ChatList.tsx` 顶部 `import { filterVisibleMessages } from '@/sync/messageVisibility';`，把 `ChatListInternal` 里 `useGroupedMessages(props.messages, ...)` 改为：
```typescript
const displayItems = useGroupedMessages(filterVisibleMessages(props.messages), groupToolCalls, groupingOptions);
```

- [ ] **Step 5: `sendMessage` 透传 hidden 到 meta**

`sync.ts`：`SendMessageOptions` 加 `hidden?: boolean;`。在 `sendMessage` 内解构处：
```typescript
const { displayText, source = 'chat', attachments, hidden } = options ?? {};
```
在构造消息 `meta`（`resolveMessageModeMeta` 结果合并处）附加：
```typescript
const meta = { ...modeMeta, ...(hidden ? { hidden: true } : {}) };
```
并确保该 `meta` 用于后续入站/上行消息对象（沿用原本 `modeMeta` 被使用的位置，替换为 `meta`）。

- [ ] **Step 6: 回归 + 类型**

Run: `cd packages/happy-app && pnpm exec vitest run sources/sync/messageVisibility.test.ts`（PASS）。
并 `pnpm exec tsc --noEmit 2>&1 | grep -E 'messageVisibility|typesMessageMeta|sync/sync|ChatList'` 无命中（改动文件无类型错误）。

- [ ] **Step 7: Commit**

```bash
git add packages/happy-app/sources/sync/typesMessageMeta.ts packages/happy-app/sources/sync/messageVisibility.ts packages/happy-app/sources/sync/messageVisibility.test.ts packages/happy-app/sources/sync/sync.ts packages/happy-app/sources/components/ChatList.tsx
git commit -m "feat(health): 隐藏消息机制（meta.hidden + sendMessage 选项 + 渲染过滤）"
```

---

## Task 10: 后台自动问候（Phase 2b - 2/2）

**Files:**
- Modify: `packages/happy-app/sources/-session/healthSessionView.ts`（加纯函数 `shouldGreet`，Task 7 已建此文件）
- Test: `packages/happy-app/sources/-session/healthGreeting.test.ts`（纯函数，import 自 `./healthSessionView`）
- Create: `packages/happy-app/sources/-session/useHealthGreeting.ts`（幂等触发 hook，不单测）
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`（挂载 hook）
- Modify: `packages/happy-app/sources/text/*`（`greetingPrompt` 11 语言）

**Interfaces:**
- Consumes: `sessionWorkingPath`、`isHealthCheckinSession`、`sync.sendMessage(sessionId, text, { hidden: true })`（Task 9）、`filterVisibleMessages`（`@/sync/messageVisibility`，Task 9）
- Produces: `shouldGreet(args)` 纯判断（放 `healthSessionView.ts`）+ `useHealthGreeting(sessionId)` hook（每会话仅发一次）

> **同 Task 7/9 的测试策略**：被测的 `shouldGreet` 放进**无 RN import 的纯模块** `healthSessionView.ts`；hook `useHealthGreeting.ts`（import react/sync/storage 等 RN 链）**不单测**，只 import `shouldGreet` 复用判定。

- [ ] **Step 1: 写纯判断函数测试（先失败）**

`packages/happy-app/sources/-session/healthGreeting.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { shouldGreet } from './healthSessionView';

describe('shouldGreet', () => {
    const base = { isHealth: true, visibleCount: 0, alreadyGreeted: false, online: true };
    it('greets a fresh online health session once', () => {
        expect(shouldGreet(base)).toBe(true);
    });
    it('does not greet when already greeted', () => {
        expect(shouldGreet({ ...base, alreadyGreeted: true })).toBe(false);
    });
    it('does not greet when there are visible messages', () => {
        expect(shouldGreet({ ...base, visibleCount: 1 })).toBe(false);
    });
    it('does not greet non-health sessions', () => {
        expect(shouldGreet({ ...base, isHealth: false })).toBe(false);
    });
    it('does not greet when offline', () => {
        expect(shouldGreet({ ...base, online: false })).toBe(false);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/happy-app && pnpm exec vitest run sources/-session/healthGreeting.test.ts`
Expected: FAIL —— `shouldGreet` 尚未在 `healthSessionView.ts` 导出。

- [ ] **Step 3a: 在纯模块加 `shouldGreet`（可测）**

`healthSessionView.ts`（Task 7 已建）追加：
```typescript
/** 是否给空的健康会话后台补一句问候：健康会话、在线、无可见消息、尚未问候过。 */
export function shouldGreet(a: { isHealth: boolean; visibleCount: number; alreadyGreeted: boolean; online: boolean }): boolean {
    return a.isHealth && a.online && a.visibleCount === 0 && !a.alreadyGreeted;
}
```
跑 `pnpm exec vitest run sources/-session/healthGreeting.test.ts` 确认 GREEN（5/5）。

- [ ] **Step 3b: 实现 hook（不单测，复用纯函数）**

`packages/happy-app/sources/-session/useHealthGreeting.ts`：
```typescript
import * as React from 'react';
import { sync } from '@/sync/sync';
import { storage, useSessionMessages } from '@/sync/storage';
import { sessionWorkingPath } from '@/sync/sessionWorkingPath';
import { isHealthCheckinSession } from '@/components/rightPanel/HealthCheckinPanel';
import { filterVisibleMessages } from '@/sync/messageVisibility';
import { shouldGreet } from './healthSessionView';
import { t } from '@/text';

const greeted = new Set<string>();  // 每会话仅一次（进程内）

export function useHealthGreeting(sessionId: string) {
    const { messages } = useSessionMessages(sessionId);
    React.useEffect(() => {
        const s = storage.getState().sessions[sessionId];
        const isHealth = isHealthCheckinSession(sessionWorkingPath(s));
        const visibleCount = filterVisibleMessages(messages).length;
        const online = s?.presence === 'online';
        if (!shouldGreet({ isHealth, visibleCount, alreadyGreeted: greeted.has(sessionId), online })) return;
        greeted.add(sessionId);
        sync.sendMessage(sessionId, t('healthPanel.greetingPrompt'), { hidden: true });
    }, [sessionId, messages]);
}
```
> `useSessionMessages` / `storage` 的 import 路径与 `ChatList.tsx` 顶部一致（`@/sync/storage`）。落地前确认 `sync`、`useSessionMessages`、`session.presence === 'online'` 判活的写法与仓库现状一致；不一致以现状为准并在报告说明。

- [ ] **Step 4: 加 `greetingPrompt` 文案（11 语言）**

在 `_default.ts` 的 `healthPanel` 加（其余 10 语言同法补，可直接复用英文，因为这是发给 Agent 的指令而非展示文案，用中文更贴合本 Agent）：
```typescript
        greetingPrompt: '（系统）用一句不超过 25 字的温暖问候开场：如果最近有日报数据，可点一句昨天/最近的关键数字；没有就问今天想记点什么。只回一句，不要展开。',
```
> 因这是给 Agent 的隐藏指令、不展示给用户，11 个语言文件填同一句中文即可（保持 key 存在、通过类型检查）。

- [ ] **Step 5: 跑测试确认通过 + 类型**

Run: `cd packages/happy-app && pnpm exec vitest run sources/-session/healthGreeting.test.ts`（5/5）。
并 `pnpm exec tsc --noEmit 2>&1 | grep -E 'healthSessionView|healthGreeting|useHealthGreeting|-session/SessionView|text/'` 无命中。

- [ ] **Step 6: SessionView 挂载 hook**

`SessionView.tsx` 的 `SessionViewLoaded`（或渲染会话主体处）加：
```typescript
import { useHealthGreeting } from './useHealthGreeting';
// 组件体内：
useHealthGreeting(sessionId);
```

- [ ] **Step 7: 真机验收**

新建/进入空的健康会话：秒显欢迎卡；稍后 Agent 冒出一句问候（隐藏 prompt 不显示成用户气泡）；欢迎卡随问候到达而让位。断网/离线时只显示欢迎卡、不报错、不重复发。

- [ ] **Step 8: Commit**

```bash
git add packages/happy-app/sources/-session/healthSessionView.ts packages/happy-app/sources/-session/healthGreeting.test.ts packages/happy-app/sources/-session/useHealthGreeting.ts packages/happy-app/sources/-session/SessionView.tsx packages/happy-app/sources/text/
git commit -m "feat(health): 空健康会话后台自动问候（幂等 + 隐藏 prompt）"
```

---

## Task 11: 全量回归 + OTA 准备

**Files:** 无新增

- [ ] **Step 1: 跑 happy-app 全量单测**

Run: `cd packages/happy-app && pnpm exec vitest run`
Expected: 全绿（尤其 `healthLog`、`storage`、`reducer` 未被破坏）。

- [ ] **Step 2: 类型检查**

Run: `cd packages/happy-app && pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 回归清单人工确认**

- 非健康会话仍显示「能力中心」（`sessionWorkingPath` 不含健康打卡）。
- 健康会话冷启动即显示健康面板（Task 3-5）。
- 睡眠 Hero/趋势数据正常（契约未破，Task 1 未动 schema）。
- 隐藏问候 prompt 不出现在聊天气泡；Agent 回复正常显示。

- [ ] **Step 4: 交接发布**

本分支纯 JS/TSX → OTA。合并后按现有 OTA 流程发 preview，并给用户附 `<happy-ota-preview>` 卡片（发版环节，不在本计划内执行）。

---

## Self-Review 覆盖对照

| Spec 项 | 对应 Task |
|--------|-----------|
| Phase 1 CLAUDE.md 收敛 | Task 1 |
| Phase 2.0 本地缓存路径（持久化/字段/合并/helper/播种） | Task 2,3,4,5 |
| Phase 2a 静态欢迎卡 | Task 6(文案),7 |
| Phase 2b 隐藏消息机制 | Task 9 |
| Phase 2b 后台问候（幂等） | Task 10 |
| Phase 2c 休眠空态 | Task 6(文案),8 |
| i18n 11 语言 | Task 6,10 |
| 回归 + OTA | Task 11 |

**待实现者注意的既有代码核对点**（计划基于探查，落地前于当前文件二次确认）：
1. `useGroupedMessages` 的确切签名与 `ChatListInternal` 里 `props.messages` 的用法（Task 9 Step 4）。
2. `SessionViewLoaded` 是否在 `SessionView.tsx` 内、`useSessionMessages` 的 import 路径（Task 7,10）。
3. `resolveMessageModeMeta` 的返回值在 `sendMessage` 里被使用的确切位置（Task 9 Step 5，把 `modeMeta` 换成合并 `hidden` 后的 `meta`）。
4. unistyles 用法（`StyleSheet.create` vs `useUnistyles`）与 theme token 名，照 `SleepHeroCard.tsx` 对齐（Task 7,8）。
