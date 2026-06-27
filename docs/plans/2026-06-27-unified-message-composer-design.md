# 统一输入框组件 MessageComposer 设计文档

> 一句话目标：把首页（ComposeHome）和聊天会话页（AgentInput）两套割裂的输入框，重写成一个共享的「上下结构」组件 `MessageComposer`，去掉齿轮设置与语音输入，结构与样式两端统一。

- 日期：2026-06-27
- 分支 / worktree：`unified-composer` @ `../happy--unified-composer`（基于 `jacky-main`）
- 方案：**方案 C —— 全新 `MessageComposer` 重写**（单组件 + `mode`）

---

## 一、背景与现状

仓库里目前有**两套完全不同**的输入框实现：

| | 文件 | 结构 | 配置机制 |
|---|---|---|---|
| 聊天会话页 | `sources/components/AgentInput.tsx`（1469 行） | 已是「上下结构」：文本区在上，功能区工具栏在下（齿轮 / agent / 停止 / git / 图片 / 发送·语音） | 权限/模型/难度走 `storage.updateSession*` 直接改 session metadata；齿轮浮层（`FloatingOverlay`）是其 UI |
| 首页 | `sources/components/ComposeHome.tsx`（387 行） | 单行药丸：`+` / 图片 / 文本 / 发送 | agent/机器/路径走 `useNewSessionDraft` store；顶部 Header chip 点击下拉 `SessionConfigPanel` |

渲染位置：
- `AgentInput` ← `sources/-session/SessionView.tsx`（`ChatComposer`，约 407 行）
- `ComposeHome` ← `sources/app/(app)/index.tsx` → `MainView(variant="phone")`
- 两者**不会同屏**。

关键事实（决定设计走向）：
1. **活动会话里 agent 不能中途切**（`SessionView` 没给 `AgentInput` 传 `onAgentClick`）。
2. **活动会话的权限/模型/难度没有面板 UI**，只有齿轮浮层在改。
3. `SessionConfigPanel` 只服务新会话（读写 `useNewSessionDraft`），活动会话用不了它。
4. 删麦克风按钮**安全**：voice 逻辑都被 `onMicPress` guard 包住，删 UI 不破坏编译，只会留下暂时无人调用的 realtime/LiveKit 导出。

---

## 二、需求（已与用户逐项确认）

1. **统一范围**：抽**共享组件**，首页 + 聊天页都用同一个（方案 C，单组件 + `mode`）。
2. **结构**：以聊天页输入框为模板的**上下结构**——文本区 + 功能区。
3. **去掉齿轮设置**：输入框里不再有齿轮。
4. **权限/模型/难度**：**仅首页保留**（并入首页 Header chip 的下拉），**会话页彻底删除**。
5. **去掉语音**：删麦克风按钮，并**不再渲染语音状态栏** `VoiceAssistantStatusBar`；realtime/LiveKit 底层代码保留。
6. **首页 chip 位置**：**保留在 Header 原位**、向下弹下拉，不挪进 composer。

### 已确认的代价
- 活动会话**无法再从输入框切** plan / acceptEdits / bypass 等权限模式（彻底移除）。
- `RealtimeSession` / `voiceHooks` / 部分 voice 导出变成暂时无人调用的代码（不报错，保留）。

---

## 三、组件设计

### 3.1 新组件
`sources/components/MessageComposer.tsx`，单组件，`mode: 'home' | 'session'`，共享「上下结构」外壳，**无齿轮、无语音**。

### 3.2 共享外壳（自上而下）
```
[① 状态/chip 展示行]   仅 session：agent · 机器 · 连接状态（= 现有 StatusRow / ContextChips）
[② 附件缩略图条]       有图才显示（AgentInputAttachmentStrip）
[③ 文本区]             MultiTextInput（非受控 + imperative ref，沿用现有打字性能方案）
[④ 功能区]             左按钮槽 ……………………………… [↑ 发送]
```

### 3.3 两个 mode 的差异
| 维度 | `mode='home'` | `mode='session'` |
|---|---|---|
| ① 状态/chip 行 | **不渲染**（chip 留在 ComposeHome 的 Header 原位） | 渲染：agent·机器·连接状态展示行（不可点切 agent） |
| ② 附件条 | 有（claude + `expImageUpload`） | 有（`expImageUpload`） |
| ③ 文本区 | MultiTextInput | MultiTextInput + slash 自动补全 |
| ④ 左按钮 | 🖼️ 图片 | 🖼️ 图片 · 📁 git · ⏹ 停止（thinking/waiting 时） |
| ④ 发送 | spawn 新会话（父层 `onSend`） | sendMessage（父层 `onSend`） |
| 权限/模型/难度 | 不在 composer（在 Header chip 下拉里） | **无** |
| 语音麦克风 | 无 | 无 |

### 3.4 Props 草案
```ts
interface MessageComposerHandle {
  getText: () => string;
  setText: (t: string) => void;
  focus: () => void;
  clear: () => void;
}

interface MessageComposerProps {
  mode: 'home' | 'session';

  // 文本（非受控）
  initialValue?: string;
  placeholder: string;
  onChangeText?: (text: string) => void;

  // 发送
  onSend: () => void;
  isSending?: boolean;
  blockSend?: boolean;

  // 图片（两端共享）
  selectedImages?: AttachmentPreview[];
  onPickImages?: () => void;
  onRemoveImage?: (id: string) => void;
  onAddImages?: (images: AttachmentPreview[]) => void;

  // ↓↓↓ 仅 session ↓↓↓
  sessionId?: string;
  agentType?: 'claude' | 'codex' | 'gemini' | 'openclaw';
  machineName?: string | null;
  currentPath?: string | null;
  connectionStatus?: { text: string; color: string; dotColor: string; isPulsing?: boolean; cliStatus?: {...} };
  usageData?: {...};            // 保留 context 用量/告警展示
  onAbort?: () => void;
  showAbortButton?: boolean;
  onFileViewerPress?: () => void;
  autocompletePrefixes?: string[];
  autocompleteSuggestions?: (query: string) => Promise<...>;
}
```
> imperative 句柄通过 `ref` 暴露（替代现有 `composerHandleRef.current?.getMessage()`）。

---

## 四、连带改动清单

1. **`MessageComposer.tsx`（新建）**
   - 实现上述外壳 + 两 mode 分支。
   - 内部复用：`MultiTextInput`、`AgentInputAttachmentStrip`、autocomplete 套件、`Shaker`、`StatusDot`。
   - 从 `AgentInput` 抽出并复用：`AgentInputStatusRow`、`AgentInputContextChips`、`GitStatusButton`（移入本文件或拆为独立文件）。
   - **不实现**：齿轮设置浮层、权限/模型/难度选择器、麦克风/发送语音切换。

2. **`SessionView.tsx`**
   - `<AgentInput>` → `<MessageComposer mode="session">`。
   - 删除接线：`onMicPress` / `isMicActive` / `micButtonState` / `handleMicrophonePress`；`onPermissionModeChange` / `onModelModeChange` / `onEffortLevelChange` 及其 `availableModes` / `availableModels` / `availableEffortLevels` / `resolveCurrentOption` 相关计算。
   - **删除 `VoiceAssistantStatusBar` 的渲染**。
   - 保留：`handleSend` / `sync.sendMessage`、`handleAbort` / `sessionAbort`、图片 picker、git/文件查看器、连接状态、context 用量。

3. **`ComposeHome.tsx`**
   - 底部 `inputPill`（含 `+` / 图片 / TextInput / 发送）→ `<MessageComposer mode="home">`。
   - **保留**：Header（菜单 + 设置 + chip）、`togglePanel` / `panelOpen` / 向下弹的 `SessionConfigPanel` 下拉、`useSpawnSession` / `handleSend` / 问候语 / 粒子背景。
   - `+`（跳 `/new` 全编辑器）按钮：评估是否并入 MessageComposer 的功能区或保留在 home 包装层（实现计划阶段定）。

4. **`AgentInput.tsx`**
   - 迁移完成后**删除**；其可复用子件按 1. 抽出。

5. **保留不动**：`MultiTextInput(.web)`、`SessionConfigPanel`、`useNewSessionDraft`、`useImagePicker`、`RealtimeSession` / `voiceHooks` / LiveKit（变孤儿但保留）。

---

## 五、测试与验收

- 项目目前**无单测**；以 `pnpm typecheck` + 真机/模拟器手验为准。
- 验收点：
  1. 首页：输入框为上下结构，无齿轮无语音；图片选择正常；发送能 inline spawn / 离线时 handoff 到 `/new`；Header chip 下拉切 agent/机器/权限/模型仍生效。
  2. 会话页：上下结构，无齿轮无语音；顶部展示 agent·机器·连接状态；图片 / git / 停止按钮正常；slash 自动补全正常；发送消息正常；语音状态栏不再出现。
  3. `pnpm typecheck` 通过，无新增类型错误，无引用已删 `AgentInput` 的死引用。

---

## 六、落地流程

1. ✅ 建 worktree `../happy--unified-composer`（基于 `jacky-main`）。
2. ✅ 写本设计文档并提交。
3. ⏭ 进入 `writing-plans` 出分步实现计划。
4. ⏭ 按计划实现 → `pnpm typecheck` → 真机手验。
5. ⏭ 提 PR 到 `jacky-main`（`gh pr create --base jacky-main --head unified-composer`）。
