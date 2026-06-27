# 统一输入框组件 MessageComposer 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把首页（ComposeHome）和聊天会话页（AgentInput）两套输入框，重写为一个共享组件 `MessageComposer`（`mode: 'home' | 'session'`），上下结构，去齿轮、去语音；权限/模型仅首页保留。

**Architecture:** 以 `AgentInput` 现有「上下结构」渲染外壳为基底，转植成新组件 `MessageComposer` 并做减法（删齿轮设置浮层、麦克风/发送语音切换、权限/模型/难度选择器与相关 props）。`SessionView` 与 `ComposeHome` 改用它；删除 `AgentInput.tsx`。两端的业务状态保持原样（会话用 `storage.updateSession*` / `sync.sendMessage`，首页用 `useNewSessionDraft` / `useSpawnSession`），`MessageComposer` 只做展示与回调转发。

**Tech Stack:** React Native + Expo SDK 54、TypeScript strict、Unistyles、expo-router。设计文档见 `docs/plans/2026-06-27-unified-message-composer-design.md`。

**测试约定（重要）：** 本仓库**无单测基建**（Vitest 已配但零测试，见 `packages/happy-app/CLAUDE.md`）。本计划的自动化门禁是 **`pnpm typecheck`**（在 `packages/happy-app/` 下跑），辅以每个任务末尾的**人工验收点**。不写 RN 组件单测（与现状不符、收益低）。每个任务结束**提交一次**。

**全局约束（每个任务都遵守）：**
- 4 空格缩进；路径别名 `@/*` → `./sources/*`；所有用户可见字符串走 `t(...)`。
- 样式放文件末尾、用 `react-native-unistyles` 的 `StyleSheet.create`。
- expo-image 不用 unistyles。
- 不做任何向后兼容（删就删干净）。
- 工作目录：`/Users/jacky/jacky-github/happy--unified-composer`，分支 `unified-composer`。
- typecheck 命令：`cd packages/happy-app && pnpm typecheck`。

---

## 关键源文件定位（实现前先读）

| 文件 | 关键区段 |
|---|---|
| `packages/happy-app/sources/components/AgentInput.tsx` | props 接口 `30-94`；子件 `AgentInputStatusRow 333-462`、`AgentInputContextChips 464-544`、`GitStatusButton 1428-1468`；组件体 `546-1426`；齿轮设置浮层（待删）约 `922-1169`；功能区工具栏 `1196-1422`（齿轮 `1230-1251`、agent `1254-1287`、abort `1290-1321`、git `1324`、图片 `1327-1350`、发送/语音 `1353-1417`）；样式 `98-330` |
| `packages/happy-app/sources/-session/SessionView.tsx` | `ChatComposer 374-415`；`SessionViewLoaded` 内权限/模型/难度计算 `436-474`、`updatePermissionMode/ModelMode/EffortLevel 507-518`、`handleMicrophonePress 576-616`、`micButtonState 619-622`、`composer = <ChatComposer .../> 664-697`；`VoiceAssistantStatusBar` 渲染处（任务 6 定位） |
| `packages/happy-app/sources/components/ComposeHome.tsx` | 输入 pill `208-241`、发送 `handleSend 112-155`、header chip + 下拉 `159-186 / 246-259` |

---

## Task 1: 脚手架 MessageComposer（转植外壳 + 加 mode）

**Files:**
- Create: `packages/happy-app/sources/components/MessageComposer.tsx`

**做法（转植再做减法，而非从零手写）：**

1. 复制 `AgentInput.tsx` 全文为 `MessageComposer.tsx` 的起点。

2. 重命名导出与类型：
   - `AgentInput` → `MessageComposer`；`AgentInputProps` → `MessageComposerProps`。
   - 保留内部子件 `AgentInputStatusRow` / `AgentInputContextChips` / `GitStatusButton`（留在本文件，名字可不改）。

3. **改 props 接口**（`MessageComposerProps`）：
   - **新增**：`mode: 'home' | 'session';`
   - **删除**（连同其在组件体内所有引用）：
     `onMicPress`、`isMicActive`、
     `permissionMode`、`availableModes`、`onPermissionModeChange`、
     `modelMode`、`availableModels`、`onModelModeChange`、
     `effortLevel`、`availableEffortLevels`、`onEffortLevelChange`、
     `metadata`（仅服务于上面这些选择器时删；若 StatusRow 的 permission badge 用到则一并删 badge，见第 5 步）。
   - 保留：`initialValue`、`placeholder`、`onChangeText`、`sessionId`、`onSend`、`isSending`、`blockSend`、`isSendDisabled`、`minHeight`、`zenMode`、`connectionStatus`、`usageData`、`alwaysShowContextSize`、`onAbort`、`showAbortButton`、`onFileViewerPress`、`agentType`、`onAgentClick`、`machineName`、`onMachineClick`、`currentPath`、`onPathClick`、`autocompletePrefixes`、`autocompleteSuggestions`、图片四件套（`selectedImages`/`onPickImages`/`onRemoveImage`/`onAddImages`）。

4. **删齿轮设置浮层**：删除组件体内整段 settings overlay（约 `922-1169` 对应区域）+ 触发它的 `handleSettingsPress`/相关 state（`settingsVisible` 之类）+ 工具栏里的齿轮按钮（`1230-1251` 对应区域）+ 样式里只服务于该浮层的项（`overlaySection*`/`selectionItem*`/`radioButton*` 等，删到 typecheck 不报未使用即可）。

5. **删权限 badge**：`AgentInputStatusRow`（`333-462` 对应区域）里 `showPermissionBadge` 整块（`335-338`、`435-459`）删掉，`StatusRowProps` 去掉 `displayPermissionMode`/`permissionModeKey`/`isSandboxedYoloMode`/`permissionLabel`/`zenMode`(若只此处用)。StatusRow 只保留 connection status + contextWarning。

6. **删语音**：发送按钮区（`1353-1417` 对应区域）去掉 `props.onMicPress && !props.isMicActive ? <Image 语音图标/> : ...` 分支，发送按钮恒为「发送箭头 / loading / lock」三态；`canPressSendButton`（`557-559`）去掉 `|| !!props.onMicPress`。删除 `icon-voice-white.png` 的 `require` 引用。

7. **加 mode 分支**（工具栏左侧 `actionButtonsLeft`，`1227-1351` 对应区域）：
   - `mode === 'home'`：左侧只渲染图片按钮（`onPickImages` 存在时）。**不渲染** agent 按钮、abort、git、StatusRow、ContextChips（这些 home 不需要）。
   - `mode === 'session'`：左侧渲染图片 + `GitStatusButton` + abort（`showAbortButton` 时）；顶部渲染 StatusRow + ContextChips（保持现状）。agent 按钮：会话页本就不传 `onAgentClick`，自然不显示——保留现有 `props.agentType && props.onAgentClick` 守卫即可。
   - 用一个 `const isSession = props.mode === 'session';` 控制上述条件。

8. forwardRef 仍转发 `MultiTextInputHandle`（沿用现有 `inputRef`/ref 逻辑，不动）。

**Step 1 — typecheck（首次会因 SessionView/ComposeHome 仍引用旧 AgentInput 而无关报错；只看 MessageComposer.tsx 自身是否干净）:**

Run: `cd packages/happy-app && pnpm typecheck 2>&1 | grep -i messagecomposer`
Expected: 无 `MessageComposer.tsx` 相关报错（其它文件的旧引用报错在 Task 2-4 修）。

**Step 2 — 提交:**
```bash
git add packages/happy-app/sources/components/MessageComposer.tsx
git commit -m "feat(composer): scaffold MessageComposer from AgentInput shell (no gear/voice/permission)"
```

**人工验收点（本任务）：** 仅代码层；UI 验证在 Task 5 统一做。

---

## Task 2: 会话页接入 MessageComposer（含去语音/权限接线）

**Files:**
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`

**Step 1 — 改 ChatComposer 渲染目标（`406-414`）:**
`<AgentInput ... />` → `<MessageComposer mode="session" ... />`，并把 import 从 `AgentInput` 换成 `MessageComposer`（`{ MessageComposer }` from `@/components/MessageComposer`）。`ChatComposerProps` 若是 `Omit<AgentInputProps,...>` 之类，改为基于 `MessageComposerProps`。

**Step 2 — 精简 `composer = <ChatComposer .../>`（`664-697`）的 props：**
- **删除传参**：`permissionMode`、`onPermissionModeChange`、`availableModes`、`modelMode`、`availableModels`、`onModelModeChange`、`effortLevel`、`availableEffortLevels`、`onEffortLevelChange`、`metadata`、`onMicPress`、`isMicActive`。
- **新增**：`mode="session"`。
- 保留其余（`onSend`/`onAbort`/`showAbortButton`/`onFileViewerPress`/图片四件套/`autocomplete*`/`usageData`/`alwaysShowContextSize`/`connectionStatus`/`blockSend`/`zenMode`/`sessionId`/`placeholder`）。

**Step 3 — 删除现在变成死代码的会话端逻辑：**
- `availableModels 437-439`、`availableModes 440-442`、`permissionMode 448-454`、`modelMode 456-462`、`modelKey/availableEffortLevels 465-468`、`effortLevel 469-474`。
- `updatePermissionMode 507-510`、`updateModelMode 512-514`、`updateEffortLevel 516-518`。
- `handleMicrophonePress 576-616`、`micButtonState 619-622`。
- 顺带删除因此不再使用的 import（`getAvailableModels`/`getAvailablePermissionModes`/`getEffortLevelsForModel`/`resolveCurrentOption`/`resolveAgentDefaultConfig`/`PermissionMode`/`ModelMode`/`EffortLevel`/`startRealtimeSession`/`stopRealtimeSession`/`voiceHooks`/`getCurrentVoiceConversationId` 等——以 typecheck 报的 unused/未定义为准逐个清）。
- `agentDefaultOverrides 443`、`effectiveAgentDefaults 444-446`：若仅被上面删除项引用则一并删；若他处仍用则保留。
- `realtimeStatus`（`424` `useRealtimeStatus()`）：若删 mic 后仅 `useLayoutEffect` 依赖数组（`643`）还在用，把该依赖去掉并删除 `realtimeStatus` 变量；若他处仍用则保留。`isDisconnected`（`482`）仍被 `onAbort`/`inactiveHint` 用，保留。

**Step 4 — typecheck:**
Run: `cd packages/happy-app && pnpm typecheck`
Expected: 不再有 SessionView 相关报错（ComposeHome 旧引用的报错留待 Task 3；AgentInput 文件此时仍在，不报错）。

**Step 5 — 提交:**
```bash
git add packages/happy-app/sources/-session/SessionView.tsx
git commit -m "feat(session): use MessageComposer; drop gear/permission/model + mic wiring"
```

---

## Task 3: 隐藏会话页语音状态栏 VoiceAssistantStatusBar

**Files:**
- Modify: 渲染 `VoiceAssistantStatusBar` 的文件（先定位）

**Step 1 — 定位渲染处:**
Run: `cd packages/happy-app && grep -rn "VoiceAssistantStatusBar" sources/`
Expected: 找到 import + JSX 渲染位置（多半在 `SessionView.tsx` 或其布局父组件）。

**Step 2 — 删除渲染:**
删除该组件的 JSX 渲染与 import。**不删** `VoiceAssistantStatusBar.tsx`/`VoiceBars.tsx`/realtime/LiveKit 文件本身（按需求保留底层）。

**Step 3 — typecheck:**
Run: `cd packages/happy-app && pnpm typecheck`
Expected: 无新报错。

**Step 4 — 提交:**
```bash
git add -A
git commit -m "feat(session): stop rendering VoiceAssistantStatusBar (voice UI removed)"
```

---

## Task 4: 首页接入 MessageComposer（保留 Header chip）

**Files:**
- Modify: `packages/happy-app/sources/components/ComposeHome.tsx`

**Step 1 — 用 MessageComposer 替换底部 inputPill（`208-241`）:**
把 `<View style={styles.inputPill}>...</View>` 整块替换为：
```tsx
<MessageComposer
    mode="home"
    placeholder={t('composeHome.placeholder')}
    initialValue={text}
    onChangeText={setText}
    onSend={handleSend}
    isSending={sending}
    blockSend={!canSend}
    selectedImages={hasImages ? selectedImages : undefined}
    onPickImages={canAttach ? pickImages : undefined}
    onRemoveImage={canAttach ? removeImage : undefined}
/>
```
> 注意：现有 home 用受控 `TextInput`（`value/onChangeText`），而 MessageComposer 是非受控 + `initialValue`。改为：`text` 仅作初值与 `handleSend` 读取来源；实时文本通过 `onChangeText={setText}` 回传到 `text` 即可（home 不需要 imperative ref，沿用 state 足够）。`handleSend`（`112-155`）逻辑不变，仍读 `text`。
> 附件条已在 MessageComposer 内部渲染，删除 ComposeHome 里重复的 `AgentInputAttachmentStrip`（`202-207`）。

**Step 2 — 处理「+」跳 /new 按钮:**
原 pill 左侧的 `+`（`openComposer`，跳 `/new`）：在 MessageComposer 的 home 模式左侧按钮槽**增加一个可选的 `+` 按钮**——给 MessageComposer 加一个可选 prop `onExpand?: () => void`，home 模式下若传入则在图片按钮左侧渲染一个 `add` 图标按钮，点了调用 `onExpand`。ComposeHome 传 `onExpand={openComposer}`。
> 若评估后觉得多余，可与用户确认是否直接去掉「+」；默认保留以不丢功能。

**Step 3 — 保留不动:** Header（菜单/设置/`modelChip`）、`togglePanel`/`panelOpen`/向下弹的 `SessionConfigPanel`（`246-259`）、`useSpawnSession`、问候语、粒子。删除 ComposeHome 中现在不再使用的 import（`TextInput`/`ActivityIndicator`/`Ionicons`(若仅 pill 用) 等，以 typecheck 为准）。

**Step 4 — typecheck:**
Run: `cd packages/happy-app && pnpm typecheck`
Expected: 无 ComposeHome 报错。

**Step 5 — 提交:**
```bash
git add packages/happy-app/sources/components/ComposeHome.tsx
git commit -m "feat(home): use MessageComposer mode=home; keep header chip + dropdown"
```

---

## Task 5: 删除 AgentInput.tsx 并收尾

**Files:**
- Delete: `packages/happy-app/sources/components/AgentInput.tsx`

**Step 1 — 确认无残留引用:**
Run: `cd packages/happy-app && grep -rn "AgentInput'" sources/ ; grep -rn "from '@/components/AgentInput'" sources/ ; grep -rn "\\bAgentInput\\b" sources/ | grep -v MessageComposer`
Expected: 仅剩 `AgentInputAttachmentStrip`/`AgentInputAutocomplete`/`AgentInputSuggestionView` 这类**独立文件**的引用（这些不删）；无对 `AgentInput` 组件本身的引用。

**Step 2 — 删除文件:**
```bash
git rm packages/happy-app/sources/components/AgentInput.tsx
```
> 若 `AgentInputStatusRow`/`AgentInputContextChips`/`GitStatusButton` 有被 AgentInput 之外的文件 import，先把它们迁到 MessageComposer 或独立文件再删（Step 1 的 grep 会暴露）。

**Step 3 — 全量 typecheck:**
Run: `cd packages/happy-app && pnpm typecheck`
Expected: **0 error**。有 unused import/变量则逐个清理干净。

**Step 4 — 提交:**
```bash
git add -A
git commit -m "refactor(composer): remove AgentInput, fully superseded by MessageComposer"
```

---

## Task 6: 人工验收（真机/模拟器）

> 自动化只能保证类型正确，UI/交互必须手验。按需用 `run`/`verify` skill 或本机直接跑。

**Step 1 — 起 dev（择一）:**
- `cd packages/happy-app && pnpm web`（最快，Web 是次要平台但够验布局/交互）
- 或 `pnpm android` / `pnpm ios`。

**Step 2 — 首页验收清单:**
- [ ] 输入框为上下结构，无齿轮、无语音麦克风。
- [ ] 图片选择/预览/移除正常（需 `expImageUpload` 开 + claude）。
- [ ] 「+」跳 `/new` 正常（若保留）。
- [ ] 发送：在线机器 inline spawn 成功；离线/新 worktree handoff 到 `/new`。
- [ ] Header chip 点击下拉，切 agent/机器/路径/权限/模型仍生效。

**Step 3 — 会话页验收清单:**
- [ ] 上下结构，无齿轮、无语音。
- [ ] 顶部展示 agent·机器·连接状态（StatusRow/ContextChips）。
- [ ] 图片 / git / 停止按钮正常；thinking/waiting 时显示停止。
- [ ] slash 自动补全正常。
- [ ] 发送消息正常；语音状态栏不再出现。
- [ ] 断开会话时 Resume 提示正常。

**Step 4 — 回归：** 切到 codex/gemini/openclaw 会话看是否布局异常；旋转横屏/平板看 StatusRow 不崩。

**Step 5 — 全部通过后，准备 PR（推送走代理，见仓库 CLAUDE.md 第七节）:**
```bash
git config --global http.proxy http://127.0.0.1:10802
git config --global https.proxy http://127.0.0.1:10802
git -C /Users/jacky/jacky-github/happy--unified-composer push -u origin unified-composer
gh pr create --repo wangjs-jacky/happy --base jacky-main --head unified-composer \
  --title "统一输入框组件 MessageComposer（去齿轮/语音，权限模型仅首页）" \
  --body "见 docs/plans/2026-06-27-unified-message-composer-design.md"
git config --global --unset http.proxy && git config --global --unset https.proxy
```

---

## 风险与回滚

- **风险点**：StatusRow/ContextChips 删 permission badge 后样式留白；发送按钮三态条件改动后误判可发；ComposeHome 受控→非受控切换导致草稿/清空异常。每个都在 Task 5/6 手验覆盖。
- **回滚**：分支独立，任一任务 commit 粒度小，`git revert` 或 `git reset` 到上一个 commit 即可；最坏整分支废弃，`jacky-main` 不受影响。
