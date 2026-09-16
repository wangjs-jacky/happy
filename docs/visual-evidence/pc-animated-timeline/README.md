# PC 时间线 Animated List

本地完整应用 + 独立测试账户，120 条合成会话；未连接生产账户、未启动 daemon。
浏览器仅使用 Ego，任务空间 94，run `animated-timeline-20260917-0339`。

## 视觉范围

PC-AL-01：PC 时间线会话行。`before.png` 与 `after.png` 使用 1440×1000 CSS 视口、DPR 1、gingham Light、相同测试会话及选中状态；原实现来自 `f88029a05e3d050f4b117ed8120c724550dd3b3d`。
主会话区为测试空会话，本次未改。
`dark.png` 为同一功能在 gingham Dark 的额外核验。

## 已验证

- 标题两行截断，浏览器实测高度 42px、内容高度 63px；悬停完整提示保留全部标题。
- 原目录图标、路径、机器字段、状态、置顶、删除、归档入口保留；悬停出现按钮时标题宽度不变，悬停不导航。
- 点击导航到指定会话；置顶后出现原“置顶”分组。
- 键盘从会话行 Tab 可进入原置顶按钮。
- 120 条列表在滚动位置仅挂载 41 条；时间线滚到 1300px，切项目再切回，实测恢复 1300px。
- 系统 reduced motion 开启时立即显示、opacity=1、行上无在播动画。
- 1000 条外层虚拟化、非 PC/非时间线范围、已见条目不重复入场、滚动键接管及旧回调隔离由定向单测覆盖。
- 独立代码评审与 PC 静态评审通过；已处理两行标题与旧 CSS 冲突、行距过大、初始虚拟批次滚动误判等发现。

## 视频

`interaction.mp4`：真实 Ego 操作捕获，H.264，1440×1000，11.93 秒，完整解码无报错。包括悬停、切换会话、键盘焦点、滚动与视图切换。已通过 Happy 发送；未声称用户手机实际播放已确认。
视频为约 5fps 的浏览器帧采样后封装 30fps，能核验操作结果，不用于衡量动画帧率。

## 复验

`pnpm --filter happy-app exec vitest run sources/components/AnimatedTimeline.web.test.tsx sources/components/ActiveSessionsGroupCompact.test.tsx sources/components/SidebarScrollState.test.tsx sources/utils/sessionRowPresentation.test.ts`

`pnpm --filter happy-app typecheck`

本地启动 Expo 后曾生成空的 `.expo/types/router.d.ts`：上游生成器把 `sources/app` 中的测试文件作为路由入口。使用原生成器、排除 `.test/.spec` 文件重新生成本地类型后复验；未更改路由或关闭类型检查，生成文件不提交。

浏览器：在本地隔离账户创建多个含长标题的会话，进入 PC 时间线，重复上述交互。截图和视频均不含登录凭据。

## 边界

未实测删除/归档确认提交、权限请求跳转、全部主题或生产数据；这些原处理函数未替换。未做移动端 UI 改造、未发布 Web/OTA。自动测试中的 react-test-renderer 废弃提示为仓库既有工具链提示。
