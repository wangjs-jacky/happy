# 全局震动反馈（Global Haptic Feedback）设计文档

> 日期：2026-06-29
> 分支：`haptics`（worktree `../happy--haptics`）
> 目标：为 Happy app 的关键交互补全统一的震动反馈，并提供可关闭的全局开关。

## 一、背景与目标

当前 Happy app 已集成 `expo-haptics`，但震动反馈仅零散覆盖了消息输入框（`MessageComposer`）、模式选择器、吉祥物切换三处。侧边栏滑出、长按、开关切换、列表项操作等高频交互**没有震动反馈**，触感体验缺失。

本次目标：

1. 扩展统一封装，提供语义化的震动 API。
2. 给用户提供一个**全局开关**（设置页），可一键关闭所有震动。
3. 覆盖四类交互：**侧边栏开/关、长按类、Switch/主按钮切换、列表项关键操作**。

非目标（YAGNI）：

- 不给每一个普通导航点按都加震动（太吵、太重）。
- 不引入第三方震动库，沿用 `expo-haptics`。
- 不做 web 端震动（web 保持空实现）。

## 二、现状摘要

| 项 | 现状 |
|----|------|
| 技术栈 | React Native + Expo SDK 55，`react-native-gesture-handler` + `reanimated` |
| 震动库 | `expo-haptics~55.0.0` |
| 现有封装 | `sources/components/haptics.ts`（仅 `hapticsLight()` / `hapticsError()`），`haptics.web.ts` 为空实现 |
| 侧边栏 | `SidebarNavigator.tsx`，基于 expo-router/drawer（react-navigation drawer），`swipeEnabled` + 全屏边缘手势 |
| 长按 | `Item.tsx`（500ms 长按复制）、`MarkdownView` 长按手势、`SessionsList` / `MessageView` 的 `onLongPress` |
| 设置存储 | MMKV；本地设置 `localSettings.ts`（不同步），同步设置 `settings.ts`（账户云同步） |
| 设置 hook | `useLocalSettingMutable` / `useLocalSetting`（本地），`useSettingMutable`（同步） |

## 三、设计方案

### 1. 封装层：扩展 `haptics.ts` / `haptics.web.ts`

补全语义化 API，并在每个函数入口统一接入全局开关闸门。

| 函数 | 用途 | expo-haptics 调用 |
|------|------|------|
| `hapticsLight()` | 已有，轻交互 / 侧边栏开关 | `impactAsync(Light)` |
| `hapticsSelection()` | 新增，Switch / 选择切换 | `selectionAsync()` |
| `hapticsSuccess()` | 新增，操作成功（如 fork / 删除完成） | `notificationAsync(Success)` |
| `hapticsError()` | 已有，错误 | `notificationAsync(Error)` |

**全局开关闸门**：由于 `haptics.ts` 是普通模块（非 React 组件），无法用 hook 读设置。改为**同步读取 zustand store 的当前值**：

```ts
import { storage } from '@/sync/storage'; // 具体导出名以实现时为准

function hapticsEnabled(): boolean {
    return storage.getState().localSettings.hapticFeedbackEnabled ?? true;
}

export function hapticsLight() {
    if (!hapticsEnabled()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}
```

> 实现时需确认 store 的同步读取入口（`getState`）与 localSettings 字段路径；若不便直接读 store，则在 `localSettings` 持久层暴露一个同步 getter。

`haptics.web.ts` 同步新增 `hapticsSelection` / `hapticsSuccess` 的空实现，保持跨平台签名一致。

### 2. 全局开关（本地设置）

- **定义**：`sources/sync/localSettings.ts` 的 `LocalSettingsSchema` 增加 `hapticFeedbackEnabled: z.boolean()`，默认值 `true`。归类为**本地设置**（震动是设备能力，不应跨设备同步）。
- **UI**：在 `sources/app/(app)/settings/appearance.tsx` 增加一行带 `<Switch>` 的设置项：
  ```tsx
  const [hapticEnabled, setHapticEnabled] = useLocalSettingMutable('hapticFeedbackEnabled');
  <Item
      title={t('settingsAppearance.hapticFeedback')}
      subtitle={t('settingsAppearance.hapticFeedbackDescription')}
      icon={<Ionicons name="phone-portrait-outline" size={29} color="#5856D6" />}
      rightElement={<Switch value={hapticEnabled} onValueChange={setHapticEnabled} />}
  />
  ```
- **i18n**：在语言文件中补 `settingsAppearance.hapticFeedback` / `...Description` 文案（至少英文 + 中文）。

### 3. 四类交互接入

#### 3.1 侧边栏开/关
在 `SidebarNavigator` 中用 `@react-navigation/drawer` 的 `useDrawerStatus()` 监听状态翻转，`open` / `closed` 状态变化时各触发一次 `hapticsLight()`。用 `useRef` 记录上一次状态做去抖，避免重复触发。

> 说明：因侧边栏走的是 drawer 而非手势回调，无法在"滑动中"触发，只能在**状态确定为开/关时**触发——体验上等价于"滑出/滑回侧边栏时震一下"。

#### 3.2 长按类
统一在长按**触发的瞬间**加 `hapticsLight()`：
- `Item.tsx`：500ms 长按复制 setTimeout 回调里。
- `MarkdownView` 的 `Gesture.LongPress()` 的 onStart。
- `SessionsList` / `MessageView` 等 `onLongPress` 站点。

#### 3.3 Switch / 主按钮切换
范围**限定在共享组件**，避免逐个散落：
- 共享 `Switch` 封装（若有统一封装组件则在其 `onValueChange` 内加 `hapticsSelection()`；若无，则在设置页等关键 Switch 处加）。
- 主操作按钮（共享 Button 组件）按下时 `hapticsSelection()`。
- **普通导航点按不加**。

#### 3.4 列表项关键操作
`SessionsList` 长按菜单、`MessageView` 的 fork 等**有后果的操作**：触发时 `hapticsSelection()`，操作成功后可选 `hapticsSuccess()`。

## 四、平台与降级

- web 端：`haptics.web.ts` 全部空实现，自动降级，无需运行时判断。
- 设备不支持震动：`expo-haptics` 自身静默处理。
- 全局开关关闭：所有 `hapticsXxx()` 入口直接 return。

## 五、测试与验证

- 类型检查 / lint 通过。
- 手动验证（iOS 真机优先）：
  1. 设置页开关默认开启，可正常关闭/开启。
  2. 关闭后所有交互无震动；开启后恢复。
  3. 侧边栏滑出 / 滑回各震一次，不重复。
  4. 长按复制、长按消息、Switch 切换、fork/长按列表项均有对应触感。
  5. web 端无报错、无震动调用异常。

## 六、工作约定

- 不在 `jacky-main` 主分支改动；在 worktree `../happy--haptics`、分支 `haptics` 开发。
- 本设计文档提交到 `haptics` 分支。
- 完成后走 PR 流程，合并后同步 `jacky-main` 并清理 worktree。
