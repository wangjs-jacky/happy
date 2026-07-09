# 健康打卡睡眠数据契约打磨 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 固住健康打卡「睡眠」类的数据契约（字段名统一 + `XhYm` 格式 + 写完自检），并把 Happy 右面板升级为「睡眠 Hero 大卡」（评分环 + 结构双视图可切换 + 时长/评分趋势 tab）。

**Architecture:** 解析集中在 `healthLog.ts` 单一模块（带单位字符串→数值只此一处）；面板组件只消费 `HealthLog` 视图模型。偏好用 `useLocalSettingMutable` 持久化。契约真相写在 Obsidian 侧 `健康打卡/CLAUDE.md`，代码按它实现。

**Tech Stack:** React Native + Expo、TypeScript strict、react-native-unistyles、react-native-svg（评分环/甜甜圈）、expo-linear-gradient（Hero 渐变）、Vitest（纯函数单测）、i18n `t()`。

**关键约定（对齐 spec）：** 只做睡眠；结构条/环表达占比（非逐段时序）；`总时长`=夜间主睡不含小睡；缺失整行省略禁 `null`。设计文档：`docs/superpowers/specs/2026-07-09-health-sleep-contract-design.md`。

---

## File Structure

**happy-app 侧（`packages/happy-app/`）：**
- Modify `sources/utils/healthLog.ts` — 扩 `HealthLog` 类型；新增 `parseDuration`；`parseHealthLog` 抽睡眠新字段；新增 `buildSleepView` 视图模型
- Create `sources/utils/healthLog.test.ts` — `parseDuration` / `parseHealthLog` / `buildSleepView` 单测
- Modify `sources/sync/localSettings.ts` — 注册 2 个偏好 key（schema + 类型 + 默认值）
- Modify `sources/text/translations/{ca,en,es,it,ja,pl,pt,ru,zh-Hans,zh-Hant}.ts` — `healthPanel.*` 新增字符串
- Create `sources/components/rightPanel/SleepScoreRing.tsx` — SVG 评分环
- Create `sources/components/rightPanel/SleepStructureBar.tsx` — 结构堆叠条
- Create `sources/components/rightPanel/SleepStructureDonut.tsx` — 结构甜甜圈（SVG）
- Create `sources/components/rightPanel/SleepHeroCard.tsx` — Hero 卡（组合环+结构+底部数字+渐变+结构切换）
- Create `sources/components/rightPanel/SleepTrendCard.tsx` — 本周趋势（时长/评分 tab）
- Modify `sources/components/rightPanel/HealthCheckinPanel.tsx` — 重排：Hero 卡 + 趋势卡 + 今日打卡（下移）+ 记录按钮

**Obsidian 侧（`jacky-obsidian/人生辅助系统/健康打卡/`，非代码仓库、不进本 worktree git）：**
- Modify `CLAUDE.md` — 第三节睡眠 schema → 字段表 v2 + 格式规范 + 自检清单
- Modify `日报/2026-06-25.md`、`日报/2026-07-06.md` — 迁移到 v2

---

## Chunk 1: 解析层（healthLog.ts 纯函数，TDD）

> `parseDuration` 与 `parseHealthLog` 是整套的地基。用**内联字符串 fixture**（不读 vault），使本 Chunk 与 Obsidian 迁移解耦。测试就近放 `sources/utils/healthLog.test.ts`（沿用仓库 `*.test.ts` colocated 约定，如 `otaServerProtocol.test.ts`）。运行：`cd packages/happy-app && pnpm test -- healthLog`。

### Task 1: `parseDuration` — 带单位时长 → 分钟

**Files:**
- Test: `packages/happy-app/sources/utils/healthLog.test.ts`（新建）
- Modify: `packages/happy-app/sources/utils/healthLog.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/happy-app/sources/utils/healthLog.test.ts
import { describe, it, expect } from 'vitest';
import { parseDuration } from './healthLog';

describe('parseDuration', () => {
    it('主格式 XhYm', () => {
        expect(parseDuration('7h20m')).toBe(440);
        expect(parseDuration('0h55m')).toBe(55);
        expect(parseDuration('8h0m')).toBe(480);
        expect(parseDuration('1h8m')).toBe(68);
    });
    it('容错退化写法', () => {
        expect(parseDuration('55min')).toBe(55);
        expect(parseDuration('55m')).toBe(55);
        expect(parseDuration('8h')).toBe(480);
    });
    it('非法/空 → null', () => {
        expect(parseDuration('abc')).toBeNull();
        expect(parseDuration('')).toBeNull();
        expect(parseDuration(null)).toBeNull();
        expect(parseDuration(undefined)).toBeNull();
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/happy-app && pnpm test -- healthLog --run`
Expected: FAIL —「parseDuration is not exported / not a function」

- [ ] **Step 3: 实现 `parseDuration`（加到 healthLog.ts 顶部工具区）**

```typescript
/**
 * 带单位时长字符串 → 分钟。主格式 `XhYm`（7h20m/0h55m/1h8m/8h），
 * 并容错退化写法 55min/55m（防 agent 自检漏网时静默丢字段）。非法/空返回 null。
 * 这是「带单位字符串 → 数值」的唯一入口，面板结构/趋势都经它。
 */
export function parseDuration(raw: string | null | undefined): number | null {
    if (raw == null) return null;
    const s = String(raw).trim();
    const hm = s.match(/^(\d+)h(?:(\d+)m?)?$/);       // 7h20m / 7h20 / 8h
    if (hm) return parseInt(hm[1], 10) * 60 + (hm[2] ? parseInt(hm[2], 10) : 0);
    const mm = s.match(/^(\d+)m(?:in)?$/);            // 55m / 55min
    if (mm) return parseInt(mm[1], 10);
    return null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/happy-app && pnpm test -- healthLog --run`
Expected: PASS（parseDuration 全绿）

- [ ] **Step 5: 提交**

```bash
git add packages/happy-app/sources/utils/healthLog.ts packages/happy-app/sources/utils/healthLog.test.ts
git commit -m "feat(health): parseDuration 带单位时长解析 + 单测

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

### Task 2: 扩 `HealthLog` 类型 + `parseHealthLog` 抽睡眠新字段

**Files:**
- Test: `packages/happy-app/sources/utils/healthLog.test.ts`
- Modify: `packages/happy-app/sources/utils/healthLog.ts:9`（`HealthLog` 接口）、`parseHealthLog`

- [ ] **Step 1: 追加失败测试**（用迁移后的 v2 frontmatter 作 fixture）

```typescript
// 追加到 healthLog.test.ts
import { parseHealthLog } from './healthLog';

const FM_0706 = `---
date: 2026-07-06
睡眠:
  总时长: 4h1m
  深睡: 0h55m
  浅睡: 1h58m
  快速眼动: 1h8m
  评分: 61
  质量: 一般
  入睡: "05:09"
  起床: "09:10"
  来源: 华为运动健康
---
正文`;

describe('parseHealthLog 睡眠字段', () => {
    const log = parseHealthLog('2026-07-06.md', FM_0706);
    it('时长字段解析为分钟且非 null', () => {
        expect(log.sleepTotalMin).toBe(241);
        expect(log.deepMin).toBe(55);
        expect(log.lightMin).toBe(118);
        expect(log.remMin).toBe(68);
    });
    it('评分/质量/时间点', () => {
        expect(log.sleepScore).toBe(61);
        expect(log.sleepQuality).toBe('一般');
        expect(log.bedtime).toBe('05:09');   // 去引号
        expect(log.wakeTime).toBe('09:10');
    });
    it('hasSleep 为真', () => {
        expect(log.hasSleep).toBe(true);
    });
    it('日间小睡不与深睡混淆（napMin 独立抽取）', () => {
        const fm = `---\n睡眠:\n  总时长: 7h59m\n  深睡: 2h6m\n  日间小睡: 1h36m\n  评分: 89\n---`;
        const l = parseHealthLog('2026-06-25.md', fm);
        expect(l.napMin).toBe(96);      // 1h36m
        expect(l.deepMin).toBe(126);    // 2h6m，未被 日间小睡 串味
        expect(l.sleepTotalMin).toBe(479);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/happy-app && pnpm test -- healthLog --run`
Expected: FAIL —「sleepTotalMin 等属性不存在 / undefined」

- [ ] **Step 3: 扩 `HealthLog` 接口**（在 `healthLog.ts` 现有接口内追加，保留 date/hasExercise/hasSleep/hasDiet/sleepScore）

```typescript
export interface HealthLog {
    date: string;
    hasExercise: boolean;
    hasSleep: boolean;
    hasDiet: boolean;
    sleepScore: number | null;
    // —— 睡眠时长/结构（分钟；无则 null）——
    sleepTotalMin: number | null;   // 总时长（夜间主睡，不含小睡）
    deepMin: number | null;         // 深睡
    lightMin: number | null;        // 浅睡
    remMin: number | null;          // 快速眼动 REM
    napMin: number | null;          // 日间小睡
    // —— 睡眠文本字段 ——
    sleepQuality: string | null;    // 质量：差/一般/良好/优秀
    bedtime: string | null;         // 入睡 HH:MM
    wakeTime: string | null;        // 起床 HH:MM
}
```

- [ ] **Step 4: 加抽取工具 + 扩 `parseHealthLog`**

```typescript
/** 从 frontmatter 抽某个睡眠子键的原始值（键在缩进层，故用多行匹配、取到行尾）。 */
function extractField(fm: string, key: string): string | null {
    const m = fm.match(new RegExp(`(?:^|\\n)\\s*${key}:\\s*(.+?)\\s*(?:\\n|$)`));
    if (!m) return null;
    return m[1].replace(/^["']|["']$/g, '');   // 去掉可能的引号
}

// parseHealthLog 内，return 对象追加：
sleepTotalMin: parseDuration(extractField(fm, '总时长')),
deepMin: parseDuration(extractField(fm, '深睡')),
lightMin: parseDuration(extractField(fm, '浅睡')),
remMin: parseDuration(extractField(fm, '快速眼动')),
napMin: parseDuration(extractField(fm, '日间小睡')),
sleepQuality: extractField(fm, '质量'),
bedtime: extractField(fm, '入睡'),
wakeTime: extractField(fm, '起床'),
```

> ⚠️ `深睡:` 的正则不会误命中 `日间小睡:`（key 前有 `\s*` 边界 + `深睡` 完整匹配）。`总时长/快速眼动/日间小睡/入睡/起床/质量` 各自唯一。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/happy-app && pnpm test -- healthLog --run`
Expected: PASS

- [ ] **Step 6: `pnpm typecheck` 确认无类型破坏**

Run: `cd packages/happy-app && pnpm typecheck`
Expected: 通过（`HealthCheckinPanel` 现只用 date/hasExercise/hasSleep/hasDiet/sleepScore，新增字段不影响）

- [ ] **Step 7: 提交**

```bash
git add packages/happy-app/sources/utils/healthLog.ts packages/happy-app/sources/utils/healthLog.test.ts
git commit -m "feat(health): HealthLog 扩睡眠时长/结构字段 + parseHealthLog 抽取 + 单测

<尾部同上>"
```

---

## Chunk 2: 睡眠视图模型（buildSleepView，TDD）

> 把 `HealthLog` → 面板要用的派生数据（占比、可读时长串）算在一个纯函数里，组件不做计算。

### Task 3: `buildSleepView`

**Files:**
- Test: `packages/happy-app/sources/utils/healthLog.test.ts`
- Modify: `packages/happy-app/sources/utils/healthLog.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { buildSleepView } from './healthLog';

describe('buildSleepView', () => {
    const log = parseHealthLog('2026-07-06.md', FM_0706);
    const v = buildSleepView(log)!;
    it('占比按各阶段之和为分母', () => {
        // 55 + 118 + 68 = 241；深睡 55/241 ≈ 0.228
        expect(v.stages.map(s => s.key)).toEqual(['deep', 'light', 'rem']);
        expect(v.stages[0].ratio).toBeCloseTo(55 / 241, 3);
        expect(v.stages[2].ratio).toBeCloseTo(68 / 241, 3);
    });
    it('总时长格式化为 XhYm', () => {
        expect(v.totalLabel).toBe('4h1m');
    });
    it('无睡眠数据返回 null', () => {
        const empty = parseHealthLog('x.md', '---\ndate: 2026-06-17\n---');
        expect(buildSleepView(empty)).toBeNull();
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/happy-app && pnpm test -- healthLog --run`
Expected: FAIL —「buildSleepView 未导出」

- [ ] **Step 3: 实现 `buildSleepView` + `formatMinutes`**

```typescript
export interface SleepStage { key: 'deep' | 'light' | 'rem'; min: number; ratio: number }
export interface SleepView {
    totalMin: number | null;
    totalLabel: string | null;     // XhYm 可读串
    score: number | null;
    quality: string | null;
    bedtime: string | null;
    wakeTime: string | null;
    stages: SleepStage[];          // 占比之和为分母；无结构数据则空数组
}

/** 分钟 → 'XhYm'（如 241 → '4h1m'）。null 返回 null。 */
export function formatMinutes(min: number | null): string | null {
    if (min == null) return null;
    return `${Math.floor(min / 60)}h${min % 60}m`;
}

/** HealthLog → 面板睡眠视图。无任何睡眠信号（无总时长/评分/结构）时返回 null。 */
export function buildSleepView(log: HealthLog): SleepView | null {
    const rawStages = [
        { key: 'deep' as const, min: log.deepMin },
        { key: 'light' as const, min: log.lightMin },
        { key: 'rem' as const, min: log.remMin },
    ].filter((s): s is { key: 'deep' | 'light' | 'rem'; min: number } => s.min != null && s.min > 0);
    const sum = rawStages.reduce((a, s) => a + s.min, 0);
    const stages: SleepStage[] = sum > 0 ? rawStages.map(s => ({ ...s, ratio: s.min / sum })) : [];

    const hasAny = log.sleepTotalMin != null || log.sleepScore != null || stages.length > 0;
    if (!hasAny) return null;
    return {
        totalMin: log.sleepTotalMin,
        totalLabel: formatMinutes(log.sleepTotalMin),
        score: log.sleepScore,
        quality: log.sleepQuality,
        bedtime: log.bedtime,
        wakeTime: log.wakeTime,
        stages,
    };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/happy-app && pnpm test -- healthLog --run`
Expected: PASS（全 Chunk 1+2 绿）

- [ ] **Step 5: 提交**

```bash
git add packages/happy-app/sources/utils/healthLog.ts packages/happy-app/sources/utils/healthLog.test.ts
git commit -m "feat(health): buildSleepView 睡眠视图模型（占比/可读时长）+ 单测

<尾部同上>"
```

---

## Chunk 3: 偏好持久化 + i18n 管线

### Task 4: 注册 2 个 localSettings 偏好 key

**Files:**
- Modify: `packages/happy-app/sources/sync/localSettings.ts:8`（schema）、`:48`（defaults）

- [ ] **Step 1: schema 加 key**（`LocalSettingsSchema` 内，`agents` 之后）

```typescript
    healthSleepStructureView: z.enum(['bar', 'donut']).describe('健康打卡睡眠结构可视化：堆叠条/甜甜圈'),
    healthSleepTrendMetric: z.enum(['duration', 'score']).describe('健康打卡本周趋势指标：时长/评分'),
```

- [ ] **Step 2: defaults 加对应默认值**（`localSettingsDefaults` 内，`agents: []` 之后）

```typescript
    healthSleepStructureView: 'bar',
    healthSleepTrendMetric: 'duration',
```

> `type LocalSettings = z.infer<typeof LocalSettingsSchema>`（第 42 行）自动带上新 key，无需手改类型。

- [ ] **Step 3: typecheck 验证**

Run: `cd packages/happy-app && pnpm typecheck`
Expected: 通过（若漏加 defaults，`localSettingsDefaults: LocalSettings` 会报缺字段——这正是校验点）

- [ ] **Step 4: 提交**

```bash
git add packages/happy-app/sources/sync/localSettings.ts
git commit -m "feat(health): localSettings 注册睡眠结构视图/趋势指标偏好

<尾部同上>"
```

### Task 5: i18n — `healthPanel.*` 新字符串补全 10 语言

**Files:**
- Modify: `packages/happy-app/sources/text/translations/{ca,en,es,it,ja,pl,pt,ru,zh-Hans,zh-Hant}.ts`（各文件 `healthPanel` 对象）

新增 key（英文基准，放进现有 `healthPanel` 对象；其余 9 语言等价翻译）：

```typescript
// 追加到 healthPanel: { ... }
tonightSleep: 'Tonight',          // Hero 卡「今晚总睡眠」标签
deep: 'Deep',                     // 深睡
light: 'Light',                   // 浅睡
rem: 'REM',                       // 快速眼动（术语保留）
bedtime: 'Asleep',                // 入睡
wakeTime: 'Awake',                // 起床
structureTitle: 'Sleep Stages',  // 结构卡标题
viewBar: 'Bar',                   // 切换：堆叠条
viewDonut: 'Ring',               // 切换：甜甜圈
trendTitle: 'This Week',         // 趋势卡标题
trendDuration: 'Duration',       // 趋势 tab：时长
trendScore: 'Score',             // 趋势 tab：评分
```

- [ ] **Step 1: 先读现有 `healthPanel` 块**，确认结构与缩进（各文件都有该对象）

Run: `grep -n "healthPanel" packages/happy-app/sources/text/translations/en.ts`

- [ ] **Step 2: 用 i18n-translator agent 批量补全**

调用 `i18n-translator` agent，任务：把上述 12 个 key 加进全部 10 个翻译文件的 `healthPanel` 对象，按各语言习惯翻译（`REM`/`CLI` 类术语保留原文；`zh-Hant` 用繁体），保持缩进与风格一致。

- [ ] **Step 3: 校验 10 语言齐全**

Run: `for f in ca en es it ja pl pt ru zh-Hans zh-Hant; do echo "$f: $(grep -c 'trendDuration' packages/happy-app/sources/text/translations/$f.ts)"; done`
Expected: 每个文件都输出 `1`（缺任一 = 未完成）

- [ ] **Step 4: typecheck（翻译对象结构一致性）**

Run: `cd packages/happy-app && pnpm typecheck`
Expected: 通过

- [ ] **Step 5: 提交**

```bash
git add packages/happy-app/sources/text/translations/
git commit -m "i18n(health): 睡眠面板新字符串补全 10 语言

<尾部同上>"
```

---

## Chunk 4: 可视化组件（typecheck + 真机验证）

> 视觉组件不做单测；正确性靠 `pnpm typecheck` + 真机观察。每个组件是独立单元、纯 props 驱动。全部用 unistyles `StyleSheet.create`，样式放文件末尾（happy-app 约定）。配色用 `theme.colors`，明暗主题各自适配，**不硬编码深色**。

### Task 6: `SleepScoreRing`（SVG 评分环）

**Files:**
- Create: `packages/happy-app/sources/components/rightPanel/SleepScoreRing.tsx`

- [ ] **Step 1: 实现**（参考 `sources/components/FinanceChartCard.tsx` 的 react-native-svg 用法）

```tsx
import * as React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

/** 评分环：环占比 = score/100，颜色随档（好/中/差）。size 默认 56。 */
export const SleepScoreRing = React.memo(function SleepScoreRing(props: { score: number; size?: number }) {
    const { theme } = useUnistyles();
    const size = props.size ?? 56;
    const stroke = 5;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(100, props.score)) / 100;
    const color = props.score >= 80 ? theme.colors.status.connected
        : props.score >= 60 ? theme.colors.text        // 中性档
        : theme.colors.textSecondary;
    return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
                <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.colors.surfacePressed} strokeWidth={stroke} fill="none" />
                <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
                    strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round" />
            </Svg>
            <Text style={styles.value}>{props.score}</Text>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    value: { fontSize: 15, fontWeight: '800', color: theme.colors.text },
}));
```

- [ ] **Step 2: typecheck**

Run: `cd packages/happy-app && pnpm typecheck`
Expected: 通过

- [ ] **Step 3: 提交** `feat(health): SleepScoreRing 评分环`

### Task 7: `SleepStructureBar`（堆叠条）

**Files:**
- Create: `packages/happy-app/sources/components/rightPanel/SleepStructureBar.tsx`

- [ ] **Step 1: 实现**（props: `stages: SleepStage[]`；三色来自 theme 或本地常量；图例文字走 `t()`）

```tsx
import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { SleepStage } from '@/utils/healthLog';
import { t } from '@/text';

export const STAGE_COLORS: Record<SleepStage['key'], string> = { deep: '#4263eb', light: '#4dabf7', rem: '#9775fa' };
const LABEL: Record<SleepStage['key'], () => string> = { deep: () => t('healthPanel.deep'), light: () => t('healthPanel.light'), rem: () => t('healthPanel.rem') };

export const SleepStructureBar = React.memo(function SleepStructureBar(props: { stages: SleepStage[] }) {
    return (
        <View>
            <View style={styles.track}>
                {props.stages.map((s) => (
                    <View key={s.key} style={{ width: `${s.ratio * 100}%`, backgroundColor: STAGE_COLORS[s.key] }} />
                ))}
            </View>
            <View style={styles.legend}>
                {props.stages.map((s) => (
                    <View key={s.key} style={styles.item}>
                        <View style={[styles.sw, { backgroundColor: STAGE_COLORS[s.key] }]} />
                        <Text style={styles.txt}>{LABEL[s.key]()} {Math.round(s.ratio * 100)}%</Text>
                    </View>
                ))}
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    track: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: theme.colors.surfacePressed },
    legend: { flexDirection: 'row', gap: 12, marginTop: 8, flexWrap: 'wrap' },
    item: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    sw: { width: 8, height: 8, borderRadius: 2 },
    txt: { fontSize: 11, color: theme.colors.textSecondary },
}));
```

- [ ] **Step 2: typecheck** → **Step 3: 提交** `feat(health): SleepStructureBar 堆叠条`

### Task 8: `SleepStructureDonut`（SVG 甜甜圈）

**Files:**
- Create: `packages/happy-app/sources/components/rightPanel/SleepStructureDonut.tsx`

- [ ] **Step 1: 实现**（用 `react-native-svg` 的 `Circle` + `strokeDasharray` 拼三段环；复用 `STAGE_COLORS`；中心显 `centerLabel`）

```tsx
import * as React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { SleepStage } from '@/utils/healthLog';
import { STAGE_COLORS } from './SleepStructureBar';

/** 甜甜圈：各阶段占比拼环。size 默认 96，中心显 centerLabel（如总时长）。 */
export const SleepStructureDonut = React.memo(function SleepStructureDonut(props: { stages: SleepStage[]; centerLabel?: string | null }) {
    const { theme } = useUnistyles();
    const size = 96, stroke = 12, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    let offset = 0;
    return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
                <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.colors.surfacePressed} strokeWidth={stroke} fill="none" />
                {props.stages.map((s) => {
                    const seg = c * s.ratio;
                    const dash = `${seg} ${c - seg}`;
                    const el = <Circle key={s.key} cx={size / 2} cy={size / 2} r={r} stroke={STAGE_COLORS[s.key]} strokeWidth={stroke} fill="none" strokeDasharray={dash} strokeDashoffset={-offset} />;
                    offset += seg;
                    return el;
                })}
            </Svg>
            {props.centerLabel ? <Text style={styles.center}>{props.centerLabel}</Text> : null}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    center: { position: 'absolute', fontSize: 14, fontWeight: '800', color: theme.colors.text },
}));
```

- [ ] **Step 2: typecheck** → **Step 3: 提交** `feat(health): SleepStructureDonut 甜甜圈`

### Task 9: `SleepHeroCard`（Hero 卡：组合 + 结构切换）

**Files:**
- Create: `packages/happy-app/sources/components/rightPanel/SleepHeroCard.tsx`

- [ ] **Step 1: 静态骨架**——`expo-linear-gradient` 渐变底（明暗各一套色，用 `theme` 判断或半透明叠加）；左总时长大字（`view.totalLabel`）+ 右 `SleepScoreRing`（`view.score` 非 null 才渲染）；底部一行 `入睡→起床`（`t('healthPanel.bedtime')`/`wakeTime`）。props: `view: SleepView`。所有文字走 `t('healthPanel.*')`。参考现有 `HealthCheckinPanel` 卡片样式与 `hapticsLight`。
- [ ] **Step 2: 结构切换 + 持久化**——用 `useLocalSettingMutable('healthSleepStructureView')` 取 `[mode, setMode]`；`mode==='bar'` 渲染 `<SleepStructureBar stages={view.stages} />`，否则 `<SleepStructureDonut stages={view.stages} centerLabel={view.totalLabel} />`；结构卡标题右侧放一个图标按钮，点击 `hapticsLight()` 后 `setMode(mode==='bar'?'donut':'bar')`。`view.stages` 为空时结构区不渲染。
- [ ] **Step 3: typecheck** → **Step 4: 提交** `feat(health): SleepHeroCard Hero 卡 + 结构切换`

### Task 10: `SleepTrendCard`（本周趋势 + 时长/评分 tab）

**Files:**
- Create: `packages/happy-app/sources/components/rightPanel/SleepTrendCard.tsx`

- [ ] **Step 1: 实现**——props: `trend: HealthLog[]`；用 `useLocalSettingMutable('healthSleepTrendMetric')` 在 `时长(sleepTotalMin)`/`评分(sleepScore)` 间切 tab；柱状复用现有 `barTrack/barFill` 视觉；某指标某天无数据则该柱显灰/占位；沿用现有「本周睡眠趋势」的空态文案 `noTrendData`。

- [ ] **Step 2: typecheck** → **Step 3: 提交** `feat(health): SleepTrendCard 趋势卡 + 时长/评分 tab`

---

## Chunk 5: 面板组装（HealthCheckinPanel 重排）

### Task 11: 用新卡片重排面板

**Files:**
- Modify: `packages/happy-app/sources/components/rightPanel/HealthCheckinPanel.tsx`

- [ ] **Step 1: 重排 render**（数据流不变：仍 `sessionListDirectory + sessionReadFile` 读日报、`isOpen` 触发、`reloadKey` 手动刷新）：
  1. `const view = data.today ? buildSleepView(data.today) : null`
  2. `view` 存在 → 渲染 `<SleepHeroCard view={view} />`；否则渲染现有「今日打卡·未记录」空态卡
  3. `<SleepTrendCard trend={data.trend} />`（替换原「本周睡眠评分趋势」卡）
  4. 今日打卡三对勾（运动/睡眠/饮食）**下移**到趋势卡之后，作为一张小卡
  5. 记录按钮不变
  保留标题栏 + 刷新按钮 + loading spinner 逻辑不动。

- [ ] **Step 2: typecheck**

Run: `cd packages/happy-app && pnpm typecheck`
Expected: 通过

- [ ] **Step 3: 全量单测跑一遍**（确保 healthLog 改动无回归）

Run: `cd packages/happy-app && pnpm test -- healthLog --run`
Expected: PASS

- [ ] **Step 4: 提交** `feat(health): HealthCheckinPanel 重排为睡眠 Hero + 趋势 + 今日打卡`

---

## Chunk 6: Obsidian 契约 + 历史迁移（vault，非本仓库 git）

> `jacky-obsidian` 不在本 worktree，编辑用绝对路径。改完按全局约定触发 Remotely Save 同步。这些改动**不进 happy 仓库 commit**。

### Task 12: 重写 `健康打卡/CLAUDE.md` 第三节睡眠 schema

**Files:**
- Modify: `/Users/jiashengwang/jacky-github/jacky-obsidian/人生辅助系统/健康打卡/CLAUDE.md`（第三节睡眠部分）

- [ ] **Step 1** 把第三节睡眠 schema 替换为字段表 v2（总时长/深睡/浅睡/快速眼动/日间小睡/评分/质量/超过用户/入睡/起床/来源/原图），补格式规范（`XhYm`、评分纯数字、`"HH:MM"`、缺失整行省略禁 null），并明确 `总时长=夜间主睡不含小睡`、`快速眼动` 转正。
- [ ] **Step 2** 第五节铁律后追加「睡眠段写完自检清单」6 条（见 spec §3.4）。
- [ ] **Step 3** 顺手改第三节里旧的 `评分: 82` 注释与 `质量` 示例，使其与 v2 一致，删掉旧字段名示范。
- [ ] **Step 4** 触发 Obsidian 同步：
```bash
curl -sk -X POST -H "Authorization: Bearer 145acc8855497a92582cebf0966a8c902a86a67afe85c0bfa195235e58a3298b" "https://127.0.0.1:27124/commands/remotely-save:start-sync/"
```

### Task 13: 迁移 2 篇睡眠日报到 v2

**Files:**
- Modify: `.../健康打卡/日报/2026-06-25.md`、`.../健康打卡/日报/2026-07-06.md`

> ⚠️ **先扫全部日报再迁**（教训）：初版误信「只 2 篇有睡眠」没逐篇核对，漏了 06-23/06-24（真机验收时暴露：评分能显示、时长「—」）。正确做法是先 `grep -nE "夜间睡眠|总睡眠|零星小睡|总时长" 日报/*.md` 找出所有含睡眠块且字段名漂移的文件。实际有睡眠的是 4 篇历史（06-23/24/25 + 07-06）。

- [ ] **Step 1: 迁移 `2026-06-23.md` / `2026-06-24.md`**：`夜间睡眠`→`总时长`；`零星小睡 16min/56min`→`日间小睡: 0h16m/0h56m`；删冗余 `总睡眠`；`深睡/浅睡/质量/评分/超过用户/入睡/起床/来源` 保留。
- [ ] **Step 2: 迁移 `2026-06-25.md`**：`夜间睡眠 7h59m`→`总时长: 7h59m`；`零星小睡 1h36m`→`日间小睡: 1h36m`；删 `总睡眠`；`超过用户 99%` 保留；`评分 89` 不动。
- [ ] **Step 3: 迁移 `2026-07-06.md`**：`深睡: 55min`→`深睡: 0h55m`；其余已合规保留。
- [ ] **Step 4: 全量复扫验证**——`grep` 确认所有 frontmatter 无残留旧字段名，每篇 `总时长` 为 `XhYm`（`parseDuration` 已单测覆盖该格式）。
- [ ] **Step 4** 再次触发 Obsidian 同步（同上 curl）。

---

## Chunk 7: 验收与交付

### Task 14: 全量类型/测试 + preview OTA + 真机验证

- [ ] **Step 1: 全量 typecheck**

Run: `cd packages/happy-app && pnpm typecheck`
Expected: 通过

- [ ] **Step 2: 全量单测**（不加 healthLog 过滤，捕获 localSettings/i18n 改动对其它模块的意外回归）

Run: `cd packages/happy-app && pnpm test --run`
Expected: PASS（healthLog 全绿，其余既有测试不回归）

- [ ] **Step 3: 推分支 + 提 PR**（走代理见根 CLAUDE.md 第七节）

```bash
git push -u origin health-sleep-contract
gh pr create --repo wangjs-jacky/happy --base main --head health-sleep-contract \
  --title "feat(health): 睡眠数据契约打磨 + 睡眠 Hero 面板" \
  --body "见 docs/superpowers/specs/2026-07-09-health-sleep-contract-design.md"
```

- [ ] **Step 4: 发 preview OTA**（纯 JS 改动，走 OTA；见根 CLAUDE.md 第九节）

Run: `cd packages/happy-app && pnpm ota:selfhost:preview`
Expected: 打印「频道 preview / 新版本 UUID / manifest 地址」

- [ ] **Step 5: 真机验证**——preview 包冷启拉更新 → 右滑进健康打卡会话 → 看到睡眠 Hero 卡（评分环 + 总时长）、结构可在堆叠条/甜甜圈间切换且刷新后保持、趋势可切时长/评分；迁移后的历史日报评分趋势不变。

- [ ] **Step 6: 给用户的交付回复附 `<happy-ota-preview>` 卡片**（字段遵循 Happy 规范：channel preview / platform android / runtimeVersion 21 / updateId 等）。

---

## 备注

- **`质量: NN分` 兜底分支**（`extractSleepScore`）**有意保留**作历史容错，是对项目「No backward compatibility」的自觉例外，勿当死代码删。
- **明暗主题渐变**：`SleepHeroCard` 渐变必须在 light/dark 都好看——用半透明叠加或按 `theme` 取色，别硬编码深色值。
- **SVG 环退化预案**：若 `SleepScoreRing`/`Donut` 实现受阻，评分环可退化为纯文字胶囊徽章，不阻塞其余任务。
