# 项目级 Goal First 工作区

项目入口从机器上的已安装 Goal First Skills 读取真实档案：全部项目 → 子项目（如果存在）→ 独立 Task。无子项目的空项目直接显示任务空态。新增界面沿用 Happy 的主题、皮肤和原生文件工作区。

## 功能边界

- Task 卡片展示目标、交付约定和认可标签，执行中用指示器与流光边框表达。
- Task 最右列包含详情和文件两个 tab。过程材料保留在归档目录；最终交付只读取明确的最终交付段落。兄弟子项目的导航链接不会导入其任务。
- 归档文件和最终交付共用中间 FileWorkspace。左侧复用 SessionView，同 Task 的新建、历史切换及草稿相互独立，文件 owner 绑定 Task。
- 新建对话不提交指令；首次执行只向一份新会话提交一次 Task 指令。机器侧原子 claim、磁盘回执及稳定 relay localId 处理并发和重试。未知结果保留锁，刷新不恢复播放；明确未 dispatch 的认证错误可以重试。
- 历史执行事实首次发现后也持久保存。历史会话通过 v2 分页枚举，再按机器、规范化 Task 目录或明确绑定过滤；界面按当前 Task 分页读取，避免撑大看板响应。
- 用户明确确认本地交付时，核对实际阅读的内容 hash 与文件 revision。后续变更需要重新认可。外部 URL/commit 使用“认可此链接”，明确不自动追踪远端网页内容变化。
- AI 整理入口打开带上下文的未发送草稿，不提供手填任务表单，不自动执行依赖任务。

## 数据与保护

目录与文件访问每次受已安装 Goal catalog、规范化目录和 symlink 边界约束。文件按 64 KiB 分块传输；后续块使用绑定 Task、路径、revision 的有限 transfer token，不重复解析全部任务。关闭文件 owner 会中止后续块。

归档保存使用机器上相同的 ArtifactStore，遵守活动 writer、版本和账号归属约束。目录监听按 dev/ino 重绑，支持原子替换；目录与任务变化通过 fs.watch 和加密机器状态事件通知，没有新增业务轮询。

工作区不改变任务 index 的执行状态。用户认可不是 AI 写入 `done` 的替代。部署需要匹配的 CLI/daemon；本次未替换生产执行器、安装全局 CLI 或部署正式 Web。

## 验收映射

| Case | 通过标准 | 证据范围 |
| --- | --- | --- |
| P1 | 项目层级、无子项目直达 Task、不混入兄弟任务、隐藏宽会话侧栏 | 实际完整 App + catalog/parser 单测 |
| P2 | 详情/文件同列，最终与归档文件进入共用中栏，1600px 无横向溢出 | 实际页面、真实目录/分块 RPC |
| P3 | 空白对话不提交，历史切换保留文件、交互 iframe 与会话草稿 | 实际页面；不同 completed 历史和延后 hydration 有专门回归 |
| P4 | 接受提交后故意丢响应，仍只有一次提交和一次接收，整页刷新无播放 | 真实加密 HTTP adapter、relay、磁盘回执；worker 启动为 fixture stub |
| P5 | 确认 V1 后真实文件变成 V2，自动变为待重新认可 | 实际 Modal 确认、filesystem 事件及版本读回 |
| P6 | AI 整理只打开未发送草稿，新项目文件事件刷新清单 | 实际完整 App 与合成目录；不声称调用了外部模型整理项目 |
| P7 | Gingham 深色的普通、hover 和 selected 表面来自语义 token | 实际 computed style 与独立 PC 交互回归 |

1600px 验收中三栏宽度为 chat 310px、file 850px、right 320px，document.scrollWidth 等于视口。新建和历史切换后同一个运行中 HTML iframe 保留计数 1；旧会话草稿恢复。一次丢响应检查的真实提交数和接收数均为 1。

Gingham 深色：普通表面 `rgb(26,35,48)`、hover `rgb(31,42,56)`、selected `rgb(40,53,68)`，与现有主题语义映射一致。Hover 必须等待 React 提交后读回，不能把即时旧样式判为失败。

## 复跑

从仓库根目录运行：

```sh
pnpm --filter @slopus/happy-wire build
pnpm --filter @wangjs-jacky/paws-agent build
pnpm --filter @wangjs-jacky/paws build
pnpm --filter happy-app typecheck
pnpm --filter happy-app export:web
```

前端定向测试：

```sh
cd packages/happy-app
pnpm exec vitest run sources/sync/projectGoals.test.ts sources/sync/goalBoard.test.ts sources/components/fileWorkspace/HtmlFilePreview.test.tsx sources/components/fileWorkspace/SessionFileWorkspaceProvider.test.tsx sources/components/fileWorkspace/controller.test.ts sources/hooks/useDesktopWorkspaceLayout.test.tsx sources/utils/desktopNavigationLayout.test.ts sources/components/SidebarNavigator.test.tsx sources/components/SidebarView.test.tsx
```

后端定向套件避免全局生产 CLI setup：

```sh
cd packages/happy-cli
pnpm exec vitest run --config src/modules/goalBoard/vitest.config.ts --maxWorkers=1 --no-file-parallelism --testTimeout=30000 --hookTimeout=30000
```

实际页面入口：[隔离验收 fixture](../../packages/happy-app/e2e/fixtures/project-goals/README.md)。使用 Ego，按 P1–P7 操作；认证 URL 只保存在被忽略的本机文件中。fixture 的 App、server、目录、加密 RPC、提交适配器与持久状态是真实实现，启动器明确为 stub，不调用模型或生产 daemon。关停使用其 loopback `/shutdown`。

## 验证结果与限制

已无冲突同步主线 `6b065ad2`。同步后前端定向 171 tests 通过，App typecheck、Web export 通过；CLI build 在同步前通过，CLI 源码未受这次主线提交影响。独立代码验收与独立 PC 交互回归均通过；后者限定于实际页面的 DOM、几何、键盘和主题状态，包括两个不同 completed 历史往返、目录失败重试，以及 1600px / 1280px 三栏与底部动作。同步后又冷加载实际 App，确认新的 Codex 设置浮层能打开并关闭，切换 completed 历史后同一个文件区和 HTML iframe 保留计数 1，原草稿恢复。

最后 CLI 完整串行套件为 101 通过、1 失败、1 跳过：新增 service 13 项、runtime 4 项、原 API 55 项均通过；旧 filesystem 套件的“删除后重建兄弟任务”监听用例未收到删除事件。前一轮则是旧“创建嵌套文件”用例漏事件，后一轮该项通过。独立 reviewer 在完全不导入项目代码的 macOS/Node 原生 fs.watch 实验中也复现首事件丢失，setImmediate 与单次 50/100ms 等待均不能保证就绪；已撤回临时屏障改动，未修改旧 handler 或延长超时，不将偶发重跑通过当作已修复。目录显式刷新可用，首次订阅附近的原生事件窗口仍是已知限制。

初次并行构建时文件系统套件还出现过超时；一次临时目录 cleanup 超时的认可 case 单独重跑通过。大文件预算测试实际传输了超过 1 MiB 的文件，跨多 Task 档案仅解析一次。夹具 HMR 曾把忽略的 Expo 路由声明重置为空，使用既有 repair-router-types 工具从真实 sources/app 重新生成后 typecheck 通过，未用类型断言绕过。

PR 前后截图选项已询问、尚未收到回复；未采集截图或视频，不声明 Skills 关键帧已上报或完成像素视觉验收。未测试 Android、Tauri 或生产模型执行，未上线。
