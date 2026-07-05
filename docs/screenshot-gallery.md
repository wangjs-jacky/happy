# 截图带外图库（Screenshot Gallery）

让你在会话里随手对桌面/浏览器截图，或让 AI 主动截图来「看见」屏幕，截图统一进一个会话内的图库，按需挂到输入栏发给 Claude。

## 两种用法

1. **手动按钮**：会话输入栏的截图按钮，可选「整桌面」或「最前浏览器窗口」。截完立即全屏预览并存入本会话图库。
2. **AI 主动截图**：Claude 通过 MCP 工具 `take_screenshot`（及配套工具）请求截图。截图同样进图库，AI 据此判断屏幕内容。

图库面板是输入栏旁的底部抽屉，展示本会话所有截图（手动 + AI），点缩略图全屏看，点右下角「+」把图挂到输入栏。

## 带外图库原理

为了不把大图塞进对话上下文（省 token、避免污染历史），采用「带外（out-of-band）」设计：

- 截图二进制**不进对话上下文**，只在 CLI 侧落地缓存。
- CLI 通过 **metadata 信号**告诉 App「有新截图，这是 id」。
- App 收到信号后**懒拉取（lazy fetch）**：仅在需要展示时凭 id 向 CLI 拉取图片数据，再存进本地图库（MMKV，按 sessionId 隔离）。

这样上下文里只有轻量信号，真正的图片走旁路按需传输。

## 平台限制

- **截图仅支持 macOS**（底层用系统 `screencapture`）。非 macOS 平台请求截图会返回不支持提示。
- **「最前浏览器窗口」需要辅助功能权限**：用 `osascript` 取最前窗口 id，未授权会取不到 id。
- **失败兜底整屏**：取窗口 id 失败、或指定窗口在截图前已关闭/失效时，自动回退为整屏截图，绝不让截图整体失败。

## 已知限制

- **离线/冷启动期间 AI 截的图会延迟补拉**：懒拉取只挂在实时 metadata `update` 路径上。App 离线或冷启动期间 AI 截的图，要等下次连线、且 metadata 的 `screenshotVersion` 再次增长时才会被拉回；该版本号在 CLI 侧基于上次值单调 +1（跨进程不回退），但单纯「上线」本身不触发补拉。
- **screenshotRefs 随截图数线性增长**：metadata 里的 `screenshotRefs` 是本会话的全量引用，随截图数量线性变大。当前会话级数量下无压力；若出现超大量截图，可考虑给 refs 封顶（仅保留最近 N 条），目前未实现。

## 安全与可感知性

AI 主动截图（`take_screenshot`）目前是**自动放行、不弹确认**的（该工具在 `allowedTools` 内）。设计上靠「事后可感知」而非「事前拦截」来保证用户知情：

- AI 每次截图都会在对话流留下一条工具结果（`已截图 #N [target] …`），用户可见。
- 图库入口出现**红点**提示有新图；抽屉里该截图标注来源为「AI」。

截图始终只落在你本机（CLI 侧）与 App 本地图库，不外发。若日后需要更强管控，可把 `take_screenshot` 移出 `allowedTools`，让它走 Happy 既有的工具权限确认流程。

## 关键文件

CLI（`packages/happy-cli`）：

- `src/utils/screenshot.ts` —— 调 `screencapture` 实际截图（含取最前窗口 id + 整屏兜底）
- `src/utils/screenshotStore.ts` —— 会话内截图临时缓存
- `src/claude/utils/startHappyServer.ts` —— 注册 MCP 截图工具
- `src/modules/common/registerScreenshotHandler.ts` —— 手动截图 RPC handler
- `src/modules/common/registerGetScreenshotByIdHandler.ts` —— 凭 id 懒拉取图片 RPC handler

App（`packages/happy-app`）：

- `sources/sync/screenshotGallery.ts` —— 图库 MMKV 持久化 + 响应式订阅
- `sources/sync/screenshotSync.ts` —— 监听 metadata 信号、懒拉取图片
- `sources/components/ScreenshotGalleryDrawer.tsx` —— 底部抽屉图库 UI
