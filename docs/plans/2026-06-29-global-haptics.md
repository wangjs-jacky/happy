# 全局震动反馈 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Happy app 的侧边栏开关、长按、Switch 切换、列表项操作四类交互补全统一的震动反馈，并提供一个可在设置页关闭的全局开关。

**Architecture:** 扩展现有 `haptics.ts` 薄封装为语义化 API（light/selection/success/error），每个函数入口同步读取 zustand store 里的 `hapticFeedbackEnabled` 本地设置做闸门控制。交互接入优先选择**共享组件单点改造**（`Switch`、`Item`）以覆盖面最大、改动最小，侧边栏用 `useDrawerStatus()` 监听 drawer 状态翻转触发。web 端保持空实现。

**Tech Stack:** React Native + Expo SDK 55、`expo-haptics`、zustand（`sources/sync/storage.ts`）、MMKV、`@react-navigation/drawer`、vitest、zod。

**工作目录：** worktree `/Users/jacky/jacky-github/happy--haptics`（分支 `haptics`），所有命令在 `packages/happy-app` 下执行。**不碰主仓库 `jacky-main`。**

---

## Task 1: 本地设置增加 `hapticFeedbackEnabled` 字段

**Files:**
- Modify: `sources/sync/localSettings.ts`
- Test: `sources/sync/localSettings.test.ts`（新建）

**Step 1: 写失败测试**

Create `sources/sync/localSettings.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { localSettingsDefaults, localSettingsParse } from './localSettings';

describe('localSettings hapticFeedbackEnabled', () => {
    it('defaults to true', () => {
        expect(localSettingsDefaults.hapticFeedbackEnabled).toBe(true);
    });

    it('falls back to default when absent in stored data', () => {
        const parsed = localSettingsParse({ themePreference: 'dark' });
        expect(parsed.hapticFeedbackEnabled).toBe(true);
    });

    it('respects a stored false value', () => {
        const parsed = localSettingsParse({ hapticFeedbackEnabled: false });
        expect(parsed.hapticFeedbackEnabled).toBe(false);
    });
});
```

**Step 2: 运行测试确认失败**

Run: `pnpm vitest run sources/sync/localSettings.test.ts`
Expected: FAIL（`hapticFeedbackEnabled` 为 undefined）

**Step 3: 实现 — 加 schema 字段与默认值**

在 `LocalSettingsSchema` 的 `zenMode` 行后加：

```typescript
    hapticFeedbackEnabled: z.boolean().describe('Enable haptic (vibration) feedback for interactions'),
```

在 `localSettingsDefaults` 的 `zenMode: false,` 行后加：

```typescript
    hapticFeedbackEnabled: true,
```

**Step 4: 运行测试确认通过**

Run: `pnpm vitest run sources/sync/localSettings.test.ts`
Expected: PASS（3 passed）

**Step 5: 提交**

```bash
git add sources/sync/localSettings.ts sources/sync/localSettings.test.ts
git commit -m "feat(haptics): add hapticFeedbackEnabled local setting"
```

---

## Task 2: 扩展 `haptics.ts` 语义化 API + 全局闸门

**Files:**
- Modify: `sources/components/haptics.ts`
- Modify: `sources/components/haptics.web.ts`

**Step 1: 实现 native 封装**

把 `sources/components/haptics.ts` 整体替换为：

```typescript
import * as Haptics from 'expo-haptics';
import { storage } from '@/sync/storage';

function hapticsEnabled(): boolean {
    // haptics.ts is a plain module (not a hook), so read the current local
    // setting synchronously from the zustand store instead of useLocalSetting.
    return storage.getState().localSettings.hapticFeedbackEnabled ?? true;
}

export function hapticsLight() {
    if (!hapticsEnabled()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function hapticsSelection() {
    if (!hapticsEnabled()) return;
    Haptics.selectionAsync();
}

export function hapticsSuccess() {
    if (!hapticsEnabled()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export function hapticsError() {
    if (!hapticsEnabled()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}
```

**Step 2: 实现 web 空封装**

把 `sources/components/haptics.web.ts` 整体替换为：

```typescript
export function hapticsLight() {
    // No implementation on web
}

export function hapticsSelection() {
    // No implementation on web
}

export function hapticsSuccess() {
    // No implementation on web
}

export function hapticsError() {
    // No implementation on web
}
```

**Step 3: 类型检查**

Run: `pnpm typecheck`
Expected: PASS（无与 haptics 相关的报错）

> 若 `@/sync/storage` 在此处造成循环依赖导致 typecheck 异常，则改为从 `./localSettings` 配套的持久层读取，或在 storage 暴露一个独立的 `getLocalSettings()` 同步 getter。优先验证直接 import 是否可行。

**Step 4: 提交**

```bash
git add sources/components/haptics.ts sources/components/haptics.web.ts
git commit -m "feat(haptics): semantic API (selection/success) gated by global setting"
```

---

## Task 3: 设置页加「震动反馈」开关 + i18n

**Files:**
- Modify: `sources/app/(app)/settings/appearance.tsx`
- Modify: `sources/text/translations/en.ts`
- Modify: `sources/text/translations/zh-Hans.ts`

**Step 1: 加 i18n 文案（en）**

在 `sources/text/translations/en.ts` 的 `settingsAppearance` 块内（`expandTodoListsDescription` 行附近）加：

```typescript
        hapticFeedback: 'Haptic Feedback',
        hapticFeedbackDescription: 'Vibrate on swipes, long-press and toggles',
```

**Step 2: 加 i18n 文案（zh-Hans）**

在 `sources/text/translations/zh-Hans.ts` 的 `settingsAppearance` 块内对应位置加：

```typescript
        hapticFeedback: '震动反馈',
        hapticFeedbackDescription: '滑动、长按和开关切换时震动',
```

> 其余语言文件若 typecheck 报缺键，按英文回退补齐相同两个 key。

**Step 3: 设置页接开关**

在 `appearance.tsx` 顶部 hook 区（`useLocalSettingMutable('mascot')` 行附近）加：

```typescript
    const [hapticFeedbackEnabled, setHapticFeedbackEnabled] = useLocalSettingMutable('hapticFeedbackEnabled');
```

在 Display 分组内、`expandTodoLists` 的 `<Item>` 旁加一个新 `<Item>`：

```tsx
                <Item
                    title={t('settingsAppearance.hapticFeedback')}
                    subtitle={t('settingsAppearance.hapticFeedbackDescription')}
                    icon={<Ionicons name="phone-portrait-outline" size={29} color="#5856D6" />}
                    rightElement={
                        <Switch
                            value={hapticFeedbackEnabled}
                            onValueChange={setHapticFeedbackEnabled}
                        />
                    }
                />
```

**Step 4: 类型检查**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: 提交**

```bash
git add "sources/app/(app)/settings/appearance.tsx" sources/text/translations/en.ts sources/text/translations/zh-Hans.ts
git commit -m "feat(haptics): add haptic feedback toggle in appearance settings"
```

---

## Task 4: 共享 `Switch` 组件单点接入（覆盖所有 Toggle）

**Files:**
- Modify: `sources/components/Switch.tsx`

**说明：** 全 app 的 Toggle 都走这个共享 `Switch`。在它的 `onValueChange` 外包一层 `hapticsSelection()`，一次性覆盖「按钮点按/开关切换」中的开关类。

**Step 1: 实现包装**

把 `Switch.tsx` 的组件体改为在调用方 `onValueChange` 前触发震动：

```tsx
import { Platform, Switch as RNSwitch, SwitchProps } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Deferred } from './Deferred';
import { hapticsSelection } from './haptics';

export const Switch = (props: SwitchProps) => {
    const { theme } = useUnistyles();
    const { onValueChange, ...rest } = props;
    const handleValueChange = (value: boolean) => {
        hapticsSelection();
        onValueChange?.(value);
    };
    return (
        <Deferred enabled={Platform.OS === 'android'}>
            <RNSwitch
                {...rest}
                onValueChange={handleValueChange}
                trackColor={{ false: theme.colors.switch.track.inactive, true: theme.colors.switch.track.active }}
                ios_backgroundColor={theme.colors.switch.track.inactive}
                thumbColor={theme.colors.switch.thumb.active}
                {...{
                    activeThumbColor: theme.colors.switch.thumb.active,
                }}
            />
        </Deferred>
    );
}
```

**Step 2: 类型检查**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: 提交**

```bash
git add sources/components/Switch.tsx
git commit -m "feat(haptics): vibrate on shared Switch toggle"
```

---

## Task 5: 侧边栏开/关震动（`useDrawerStatus`）

**Files:**
- Modify: `sources/components/SidebarView.tsx`（drawer 内容，始终挂载）
- 备选/确认: `sources/components/SidebarNavigator.tsx`

**说明：** drawer 内容组件 `SidebarView` 位于 drawer 导航上下文内且 `lazy:false` 始终挂载，是调用 `useDrawerStatus()` 的合法位置。新增一个轻量 hook，在状态从 `closed→open` 或 `open→closed` 翻转时各触发一次 `hapticsLight()`，用 `useRef` 去抖避免重复。仅在 phone（非 permanent drawer）场景有意义。

**Step 1: 实现 drawer haptics hook**

Create `sources/components/useDrawerHaptics.ts`:

```typescript
import * as React from 'react';
import { Platform } from 'react-native';
import { useDrawerStatus } from '@react-navigation/drawer';
import { hapticsLight } from './haptics';

/**
 * Fires a light haptic each time the drawer settles open or closed.
 * Must be called from a component rendered inside the drawer navigator.
 */
export function useDrawerHaptics() {
    const status = useDrawerStatus(); // 'open' | 'closed'
    const prev = React.useRef(status);
    React.useEffect(() => {
        if (status !== prev.current) {
            prev.current = status;
            if (Platform.OS !== 'web') {
                hapticsLight();
            }
        }
    }, [status]);
}
```

**Step 2: 在 SidebarView 调用**

在 `sources/components/SidebarView.tsx` 的组件函数顶部加一行调用：

```typescript
import { useDrawerHaptics } from './useDrawerHaptics';
// ...组件体内第一行：
    useDrawerHaptics();
```

> 若 `useDrawerStatus` 在 permanent drawer（tablet）下抛错或无意义，hook 内部对 `status` 的 effect 仍是安全的（permanent 模式状态不变，不会触发）。验证 tablet 布局无异常震动。

**Step 3: 类型检查**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: 提交**

```bash
git add sources/components/useDrawerHaptics.ts sources/components/SidebarView.tsx
git commit -m "feat(haptics): vibrate when sidebar drawer opens or closes"
```

---

## Task 6: 长按类震动（共享 `Item` + Markdown 长按）

**Files:**
- Modify: `sources/components/Item.tsx`
- Modify: `sources/components/MarkdownView.tsx`（长按手势 onStart）

**Step 1: Item 长按复制触发瞬间震动**

在 `Item.tsx` 顶部 import 加 `import { hapticsLight } from './haptics';`（若未引入）。

在 `handlePressIn` 的 `setTimeout` 回调里、`handleCopy()` 之前加震动，使长按**到时触发**那一刻有触感：

```typescript
    const handlePressIn = React.useCallback(() => {
        if (copy && !isWeb && !onPress) {
            longPressTimer.current = setTimeout(() => {
                hapticsLight();
                handleCopy();
            }, 500); // 500ms delay for long press
        }
    }, [copy, isWeb, onPress, handleCopy]);
```

同时，对外部传入的 `onLongPress` 也包一层（找到 Pressable 上绑定 `onLongPress` 的位置，改为包装函数）：

```typescript
    const handleLongPress = React.useCallback(() => {
        if (!onLongPress) return;
        if (!isWeb) hapticsLight();
        onLongPress();
    }, [onLongPress, isWeb]);
```

并把 Pressable 的 `onLongPress={onLongPress}` 改为 `onLongPress={onLongPress ? handleLongPress : undefined}`。

**Step 2: Markdown 长按手势震动**

在 `MarkdownView.tsx` 找到 `Gesture.LongPress()` 链，在其 `.onStart(...)` 回调首行加 `hapticsLight();`（import 同上）。若已有 onStart 逻辑则插入第一行；若用的是 `.onBegin`/`onActivate`，加在激活回调里。

**Step 3: 类型检查**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: 提交**

```bash
git add sources/components/Item.tsx sources/components/MarkdownView.tsx
git commit -m "feat(haptics): vibrate on long-press (Item copy/onLongPress, markdown)"
```

---

## Task 7: 列表项关键操作震动（fork / 长按菜单）

**Files:**
- Modify: `sources/components/MessageView.tsx`（fork 操作）
- Modify: `sources/components/SessionsList.tsx`（`onLongPress` / `handleLongPress`）

**说明：** 这两处若已经通过共享 `Item` 的 `onLongPress` 触发，则 Task 6 已覆盖，**无需重复加**；执行时先确认其长按是否经由 `Item`。仅当它们用的是裸 `Pressable`/`TouchableOpacity` 的 `onLongPress`、或 fork 是独立按钮回调时，才在回调首行补：

- 长按打开菜单：`hapticsLight();`
- fork 等有后果的确认操作成功后：`hapticsSuccess();`

**Step 1: 排查 + 按需接入**

Run（先确认实现方式，避免重复震动）：
`grep -n "onLongPress\|fork\|Fork" sources/components/SessionsList.tsx sources/components/MessageView.tsx`

按上面说明决定是否补 `hapticsLight()` / `hapticsSuccess()`。

**Step 2: 类型检查**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: 提交**

```bash
git add sources/components/MessageView.tsx sources/components/SessionsList.tsx
git commit -m "feat(haptics): vibrate on list item fork/long-press actions"
```

> 若确认已被 Task 6 覆盖、本任务无改动，则跳过提交并在执行记录中注明。

---

## Task 8: 全量校验与手动验证

**Step 1: 全量类型检查 + 单测**

Run: `pnpm typecheck && pnpm vitest run sources/sync/localSettings.test.ts`
Expected: 均 PASS

**Step 2: 手动验证清单（iOS 真机优先）**

Run: `pnpm ios`（或 `pnpm start` 连真机）

逐项确认：
1. 设置 → 外观：出现「震动反馈」开关，默认开启。
2. 关闭开关后：侧边栏滑动、长按、Switch 切换均**无**震动；重新打开后恢复。
3. 侧边栏右滑滑出 / 滑回各震一次，**不重复、不连震**。
4. 长按复制 Item、长按 Markdown 段落有轻震。
5. 任意 Switch 切换有选择震动。
6. fork / 列表项长按操作有触感（且不与 Item 长按重复触发两次）。
7. web 端（`pnpm web`）所有上述交互无报错、无异常。
8. tablet/permanent drawer 布局下不会无故震动。

**Step 3: 收尾**

- 确认全部提交干净：`git status` 应 clean。
- 推送分支并按需开 PR（推送走代理，见全局《Git 操作配置》）。
- PR 合并后：同步主仓库 `jacky-main` 并清理 worktree（见全局《Happy 仓库开发铁律》）。

---

## 备注 / 风险

- **循环依赖**：`haptics.ts` import `@/sync/storage` 若引发循环依赖，退化为在 storage 暴露 `getLocalSettings()` 同步 getter（Task 2 Step 3 已注明）。
- **侧边栏触发时机**：drawer 走 react-navigation，无法在「滑动过程中」连续触发，只在状态 settle 为 open/closed 时各震一次——这是预期行为，不是 bug。
- **重复震动**：Task 7 与 Task 6 可能重叠，执行时务必先 grep 确认实现路径，避免一次长按震两下。
- **DRY**：所有交互一律调用 `haptics.ts` 的语义化函数，禁止在业务代码里直接 `import * as Haptics`。
