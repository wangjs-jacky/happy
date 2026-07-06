# Happy 截屏 + 带外图库 设计文档

> 日期：2026-06-28　分支：`screenshot-gallery`
> 目标：在 Happy App 加截屏能力——既能手动点按钮看桌面/浏览器截图，也能让 AI 干活中途自主截图存进「带外图库」（不进 Claude 上下文，按需调取）。

## 一、背景与动机

Happy 是「手机/网页 App ↔ 桌面 CLI（包裹 Claude Code 运行）」的架构。用户希望：

1. **手动**：点一个按钮立刻看到 CLI 所在桌面的整屏，或最前面浏览器窗口的截图。
2. **AI 主动 + 带外图库**：AI 操控浏览器/应用干活时，能中途自己调工具截图。这些图**不希望进入 Claude 的上下文**（省 token、不污染对话），而是落进会话界面里一个独立图库区域。AI 只持有轻量引用（知道「存在第 N 张截图、何时、截的什么」），需要时由用户点选或 AI 自主把某张拉进上下文分析。

## 二、整体架构

```
┌─────────────── App（手机/网页）───────────────┐
│  输入栏 [截屏▾] 按钮  ──┐         底部抽屉：图库面板  │
│  弹出查看器 / 挂附件     │         (上滑唤出，本地持久化) │
└────────────────────────┼──────────────────────┘
                         │ 加密 socket / RPC
┌────────────────────────┼──────────────────────┐
│  Happy CLI（桌面）                              │
│   • RPC 'screenshot'（手动，A 用）              │
│   • 内置 MCP server → 给 Claude 暴露：           │
│       take_screenshot(target, note?)           │
│       get_screenshot(id)                       │
│       list_screenshots()                       │
│   • 会话内临时缓存（temp 目录，供 get/list）     │
│   截图实现：macOS `screencapture`（整屏/最前窗口）│
└────────────────────────────────────────────────┘
```

## 三、能力 A — 手动截屏按钮

- `packages/happy-app/sources/components/MessageComposer.tsx` 的 `actionButtonsRight` 区加 `[截屏▾]` 按钮，下拉两项：
  - **桌面整屏** → `screencapture -x`
  - **最前浏览器窗口** → `screencapture` 截最前窗口（macOS 可截 frontmost window）
- 点击 → App→CLI `sessionRPC('screenshot', { target })` → CLI 截图，返回 base64（+ 元数据）。
- 返回后：
  - **全屏查看器弹出**（复用 `ImageViewer.tsx` / `ImageViewerHost.tsx`）。
  - **同时入图库**（本地持久化）。
  - 查看器里可一键「挂到输入栏」→ 进 `selectedImages`，可继续发给 Claude。

## 四、能力 B — AI 主动截图 + 带外图库

### 4.1 MCP 工具（CLI 内置 MCP server，注入 Claude Code）

- `take_screenshot({ target: 'desktop'|'browser', note? })`
  - 截图 → 存 CLI 会话临时缓存（temp 目录，按 id）+ 推给 App 图库。
  - **返回给 AI 的只有文本引用**，例如：
    `已截图 #5 [browser] 14:32 note:"登录页" —— 需要分析时调 get_screenshot("5")`
  - 图片字节**永不自动进上下文**。
- `get_screenshot({ id })`
  - 从临时缓存读原图，**这一刻才把图作为图像内容返回**给 AI 分析（用户或 AI 主动触发时才付出上下文成本）。
- `list_screenshots()`
  - 返回当前会话已有截图的引用列表（文本），方便 AI 回顾「有哪些图」。

### 4.2 带外原则

截图本身永不自动进上下文。AI 始终只持有轻量文本引用（id / 时间 / 来源 / note），因此「知道有这些图存在」且省 token。只有显式 `get_screenshot` 或用户点选挂附件时，图像才进入上下文。

### 4.3 图库 UI —— 底部抽屉

- 位置：会话界面，从输入栏上方上滑唤出的抽屉面板（随手可取又不占主屏）。
- 内容：缩略图网格，按时间排序，标来源标签（`手动` / `AI`、`desktop` / `browser`、note）。
- 交互：点缩略图 → 看大图 / 一键挂到输入栏发给 Claude。
- 手动截的与 AI 截的进**同一个库**。

### 4.4 持久化

- **App 本地持久化**（AsyncStorage / 文件），离线可翻看历史。
- CLI 侧只保留**会话内临时缓存**，用于 `get_screenshot` / `list_screenshots`，会话结束/重启可清理。

## 五、数据流与待核实风险 ⚠️

- **手动路径**：走现成 App→CLI `sessionRPC`，无风险。
- **AI 截图推到 App 图库**：需要「CLI→App 推送」或「App→CLI 拉取」通道。
  - 倾向 **App→CLI 拉取**（复用现有 RPC 方向，最稳）：CLI 暂存截图，App 在抽屉打开 / 收到轻量事件时 `list_screenshots` + `get_screenshot` 拉取并本地持久化。
  - **写计划阶段必须先核实**：阅读 `docs/realtime-sync-and-rpc.md`，确认 Happy 有无 CLI→App 的事件/推送通道来即时通知「有新图」。
    - 有 → 用事件即时通知，App 收到后拉取。
    - 无 → 退化为「打开抽屉时拉取 + 小红点提示」。

## 六、改动清单（预估）

| 包 | 改动 |
|----|------|
| `happy-cli` | 新增 `screenshot` RPC handler；新增内置 MCP server（`take_screenshot` / `get_screenshot` / `list_screenshots`）；会话内临时缓存模块；`screencapture` 封装（整屏 / 最前窗口） |
| `happy-app` | `MessageComposer` 加截屏按钮 + 下拉；图库底部抽屉组件 + 本地持久化；查看器接「挂附件」；抽屉拉取/小红点逻辑 |
| `happy-wire` | 可能新增截图引用 / 事件消息类型 |

## 七、其它决策

- **平台**：先做 macOS（`screencapture`），Linux（`import` / `grim`）、Windows 留 TODO。
- **安全**：AI 调 `take_screenshot` 是敏感操作。建议**首次弹确认 + 可配置**（默认是否需确认待定，倾向首次确认后记住）。
- **加密**：全程走 Happy 现有加密通道。

## 八、关键文件锚点（调研已确认）

- App→CLI RPC：`packages/happy-app/sources/sync/apiSocket.ts`（`sessionRPC` / `machineRPC`）
- CLI RPC 注册：`packages/happy-cli/src/api/rpc/RpcHandlerManager.ts`、`packages/happy-cli/src/modules/common/registerCommonHandlers.ts`（现有 `bash` handler 可参考）
- 图片查看：`packages/happy-app/sources/components/ImageViewer.tsx`、`ImageViewerHost.tsx`、`AttachmentGalleryView.tsx`
- 输入栏按钮：`packages/happy-app/sources/components/MessageComposer.tsx`（`actionButtonsRight`）
- 实时同步与 RPC 文档：`docs/realtime-sync-and-rpc.md`（核实推送通道）
