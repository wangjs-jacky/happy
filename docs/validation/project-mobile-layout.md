# 项目列表移动端布局修复

基线：`26c17bfdc08fe5b94ad2cc8ccb3ebbe66fc1fb31`。

## 问题与修复

Android 项目封面按钮沿用桌面的 `flexGrow: 1`，真实 ScrollView 中每张卡片在说明文字下方多出大块空白。保留 Web 的伸展规则，原生卡片按内容定高。

顶栏返回、更多和关闭采用透明圆形图标按钮；项目与子项目封面动作采用主题表面圆形按钮，列表动作采用透明图标按钮。保留 44dp 触控区、主题按下/选中反馈和键盘焦点，移除相邻图标额外扩展的触控范围。

## 原生验收

在 Android API 36 模拟器、1080×2424 / 2.625 DPR 的完整 App 中，通过独立合成账号、隔离服务和真实项目解析/RPC 运行；未连接生产账号或发送模型任务。

| Case | 结果与证据 |
| --- | --- |
| PM1 项目卡片连续排列 | 同一 379.05dp 宽卡片，原生 onLayout 高度由 630.48dp 降至 305.14dp；下一张卡片 top 从约 650.48dp 降至 325.33dp。最终 UIAutomator 读回两张卡片高均为 305.14dp，间距 20.19dp。 |
| PM2 图标触控与菜单 | 返回、更多、收藏及卡片菜单命中区均为 44dp；卡片菜单打开/取消、顶部更多面板打开/关闭后仍显示原项目列表。 |
| PM3 层级导航 | 从项目卡片进入子项目卡片列表，返回后恢复项目列表；第二张项目卡片可见可点。 |

最初的简化 Yoga 探针没有复现；上述根因与修复结论来自真实 Android 页面修改前后的测量。

现有 Android 开发壳加载当前源码时，根布局的动态 import 反复触发开发重载。验收期间仅将该 bootstrap 临时改为静态 import，完成后恢复；此适配未进入提交。本次不证明正式 APK/OTA 的启动或安装。

## 检查与交付边界

- 24 项相关测试通过：GoalBoardButton、mobileProjectNavigation、projectWorkspaceLayout、projectLibrary。
- 完整 TypeScript 检查与 `git diff --check` 通过；独立代码复核通过。
- 新增测试覆盖两种图标按钮在普通/照片表面的触控、按下、焦点和点击。
- Android 最终路径录屏为 H.264、1080×2424、16.58 秒，完整解码通过，已通过 Happy 媒体卡发送；用户手机播放尚未确认。
- 前后截图已询问，尚未收到选择，未采集截图；未做独立截图视觉评审。
- 未验证 iOS、Web 浏览器或生产设备，未发布 Web、APK 或 OTA。

本机原始 UI 层级、onLayout 测量摘要、合成环境与录屏位于被忽略的 `packages/happy-app/test-results/project-mobile/`。可用现有 `e2e/fixtures/project-goals/serve.mjs` 启动隔离环境，并在 Android 开发壳通过 ADB 反向映射其服务和 Metro 端口后复验。
