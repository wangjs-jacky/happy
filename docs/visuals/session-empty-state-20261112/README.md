# 全局会话空状态：前后视觉证据

用户于 2026-11-12 明确要求前后截图。由 Ego 浏览器在同一隔离页面采集，已通过 Happy 的 session/run 绑定截图回执核验。

| 场景 | 改版前 | 改版后 | 固定条件 |
| --- | --- | --- | --- |
| 深色照片皮肤 | desktop-before.png | desktop-after.png | 1440×960、DPR 1，DreamSkin 原背景、当前主题 token、同一示例长路径 |
| 窄屏 | narrow-before.png | narrow-after.png | 390×844、DPR 1，ginghamDark、同一示例长路径 |

## 实际验证范围

- 改版前直接渲染 `66b9cf2d` 的 EmptyMessages 源码；改版后渲染 `fcfa1060` 的实际组件。
- 共享实际 AgentContentView 与 React Native Web 布局；使用项目实际 Typography、themePacks、翻译及 Ionicons 字形和字体。
- 登录、同步、会话状态、keyboard/safe-area/responsive hooks 为隔离边界；导航和输入框外壳为示例环境，不发送消息。
- 示例主机与路径已脱敏；不包含真实会话或凭据。
- 两组图视口、缩放、输入框与背景条件分别固定；宽屏实际内容宽 440px，窄屏内容宽 334px。检查确认图标字体已加载、长路径单行省略、页面无横向溢出，空状态与输入区域不重叠。
- 证据仅说明实际组件的受控浏览器渲染，不代表正式站完整 App E2E、手机真机、软键盘或生产发布验收。

产品源码没有在本次截图补充中改变；已有 preview OTA 仍对应原功能提交。
