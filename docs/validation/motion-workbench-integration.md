# Motion Workbench 集成验证

日期：2026-11-26。基线：`774649da5db89f08dbda9115eee70bc414809169`。分支：`motionharness-workbench`。

结论：完成 **M0 共同接口底座的本地实现与验证**，完整集成未完成。没有新增可操作编辑页面、发送 AI 任务或发布到用户当前 Web。完整编辑器与自有编辑器的维护路径仍等待用户选择。

设计与剩余工作唯一入口：[集成设计](../design/motion-workbench-integration.md)。采用现有 `dev`、`happy-app-experience`、`happy-visual-workflow` 和 `architecture-deploy-ops` 的适用约束；实际代码和本表是本轮证据。

## 已实现

- Paws 自有、带大小限制的工程/标注快照和回改请求协议。
- 会话级 `motionWorkbenchInspect`、`motionWorkbenchPrepareReview` 注册，供各 Agent 的同一 session RPC 使用。
- 仅当前工作区内的 MotionHarness Pro 工程可被调用；执行机原生 CLI 的选择由宿主控制，不由远端输入控制。
- 完整标注快照和文档/构建/请求版本共同参与指纹；用户修改评论后，旧选择不能准备回改。
- PC Web 的加密 RPC 客户端校验请求、响应及账号运行时；不访问浏览器 localhost，没有自动重试或轮询。
- “准备回改”只产生数据和 Agent 请求。派发消息、修改影片、验帧、版本归档及完成原生标注仍是后续独立步骤。

## 自动检查

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| happy-wire build（含 typecheck） | pass | 共享协议导出与类型 |
| `vitest run src/motionWorkbench.test.ts` | 10 pass | 版本选择、重复/超限、完整空快照、上下文、分隔符保护 |
| CLI 专用 Motion Workbench suite | 11 unit + 1 native integration pass | 真实文件系统边界、原生 JSON 归属、完整性、指纹、超限、缺工具及并发释放 |
| 现有 `apiSession.test.ts` | 82 pass | 会话生命周期/RPC 注册周边回归；不能替代本次新 RPC 的真实跨设备验收 |
| happy-cli typecheck | pass | 首次因新 worktree 的 paws-agent dist 缺失失败；本地构建该 workspace 依赖后通过，无源码修补 |
| happy-app typecheck | pass | PC Web 客户端类型与现有工程兼容 |
| `git diff --check` | pass | 已跟踪差异；提交前对完整暂存差异再检查 |

合计 104 个测试通过（10 + 11 + 1 + 82）。没有用测试数量代替用户路径验收。

复跑共同协议：在 `packages/happy-wire` 执行 `pnpm run build` 和 `pnpm exec vitest run src/motionWorkbench.test.ts`。CLI 的测试配置是 `src/modules/motionWorkbench/vitest.config.ts`，没有全局生产构建或 daemon 重启。

原生测试需在 CLI 包目录提供 `PAWS_MOTIONHARNESS_BIN`（已安装原生工具绝对路径）与 `PAWS_MOTIONHARNESS_TEST_ARCHIVE`（自己的 Pro `.vmg` 包），然后执行：

```sh
pnpm exec vitest run --config src/modules/motionWorkbench/vitest.config.ts
```

未提供两项环境时，原生集成测试明确 skip，不宣称实际执行。测试在新建临时目录解包，依赖按锁文件准备；创建一条用户来源的区域标注，确认原生响应 `displayed=false`，然后通过实际适配器准备回改、再次检查快照未变、修改原生评论并确认旧回改被拒绝。测试核对输入包哈希不变，关闭它自己启动的工程后清理临时目录。没有操作用户已有的 Studio/浏览器任务空间。

本轮原生环境：Mac mini、MotionHarness 0.1.8、既有 Paws 飞越片的便携 Pro 包。另一次本地验证确认已认可原工程 `document.json` 的 SHA-256 在测试前后均为 `32557d26ab123d155c95dde13ce1c32c406e42436133fc04b8542859488a0021`。没有对已认可原工程发出标注编辑或完成命令。

## 未完成的门禁和产品路径

| 项目 | 状态 | 缺项 |
| --- | --- | --- |
| 编辑器维护/代码引入路径 | pending user choice | 完整 MotionHarness 或 Paws 自有编辑器 |
| 独立评审 | not performed | 当前没有配置可自动委派的角色；没有把作者自查写成独立验收 |
| 完整资源与事件桥 | not implemented | JS、画布模块、音频、素材、上传下载、原生变更事件 |
| Paws 可见 UI 与任务派发 | not implemented | 工程入口、轨道、标注选择、消息队列接线、进度与冲突反馈 |
| 真正加密 RPC 的跨设备请求 | not verified | 本轮实际验证的是本地 handler，不是 Air → 正式 Paws → Mini 的新接口 |
| 新版本/回滚/原生导出 | not implemented | 不复用文本 Artifact 版本作为影片文档版本 |
| 当前设备 E2E 与交互评审 | not run | Air 上尚无此功能入口；不以既有 localhost 转发代替 Paws 集成 |
| UI 截图和视频 | not required for M0 | M0 无可见页面；M1 按仓库约定先明确截图范围 |
| PR、合并、Web 发布 | not performed | 本轮不发布未选定的完整功能，不改生产 daemon 或全局 CLI |

本次仅在隔离 worktree 安装并构建依赖，没有修改主工作区的源码、链接或运行产物。没有进行浏览器操作或 Cloudflare 部署，不产生对应成功日期。拓扑尚无部署新证据，`architecture-deploy-ops` 不刷新部署验证日期；可复用的标注版本与分层验收教训回写 Codex Harness，工程状态只保留在本报告。
