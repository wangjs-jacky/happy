# 项目资料库整理与紧凑布局

用户可见变化：列表上方提供全部、收藏、已归档和已删除筛选及数量；卡片星标独立于项目导航；菜单支持归档、删除确认和恢复。归档/删除仅整理当前设备的列表，保留机器上的档案和会话。状态按账号本地存储和机器/项目路径隔离，独立于七天过期的读取缓存，不承诺跨设备同步。

设计基线为 `c638ceeb`，最终代码已整合 `174ff3f3`。卡片从最多三列调整为最多五列、20px 间距、16:9 封面，并精简重复的底部导航行。空心星标在收藏后实心显示；动作使用主题语义颜色，并保留键盘焦点。

## 自动检查

```sh
pnpm --filter happy-app typecheck
pnpm --filter happy-app exec vitest run sources/sync/projectLibrary.test.ts sources/components/goalBoard/GoalBoardButton.test.tsx sources/sync/projectWorkspaceCache.test.ts sources/components/goalBoard/ProjectSurfaces.test.ts
```

首轮 17 项直接相关单测通过，覆盖状态过滤、恢复收藏、账号与机器隔离、迟到确认拒绝、存储失败不发布视图变更、损坏数据恢复，以及现有表面颜色/焦点和缓存行为。整合最新主线后，App typecheck 和 13 文件、86 项项目工作区相关测试全部通过（上述命令将组件测试路径改为整个 `sources/components/goalBoard` 可复跑该集合）。

## 真实页面验收

使用现有 `e2e/fixtures/project-goals/serve.mjs`，在隔离完整 App、独立 PGlite 账号、加密机器 RPC 和合成档案中验收；未修改真实项目、daemon 或生产账号，未发送模型指令。

| Case | 通过标准 |
| --- | --- |
| PL1 | 星标不触发导航；收藏筛选仅显示收藏项目；整页刷新后保留 |
| PL2 | 归档移出全部/收藏；恢复后收藏状态保留；Esc 关闭菜单且焦点返回触发按钮 |
| PL3 | 删除可取消；确认后移入已删除，刷新仍有效；恢复保留收藏 |
| PL4 | 搜索与当前筛选叠加；无结果和取消最后一个收藏有明确空态 |
| PL5 | 宽屏五列、笔记本四列、窄屏一列；无横向溢出，菜单完整位于视口 |

本轮结果：PL1–PL4 已通过真实页面操作。PL5 仅完成宽屏五列、无横向溢出和右侧菜单边界核对，笔记本与窄屏尚未完成；不把断点公式或单测当作实页证据。后续 Skills 关键帧采集挂起，已终止本次采集与排队的整合版本回归；新回归脚本尚未完整跑通，未宣称整合后的浏览器全量通过。整合版本的类型检查和 86 项自动测试通过。

复跑入口为 `e2e/fixtures/project-goals/verify-project-library.ego.mjs`。先通过 Ego 登录 fixture 的私有认证 URL、导航到带明确机器参数的 `/projects`，记录数字 task-space 和目标 tab。然后仅在 Ego 中设置 `globalThis.projectLibraryConfig = { runtimePath, taskSpaceId, targetId }`，导入该脚本。需要全新隔离账号，脚本仅修改合成账号的本地列表偏好。结果写入 ignored `test-results/project-goals/library-results.json`。默认英文 fixture 便于稳定选择确认按钮；各语言编译检查另行覆盖。

额外在 Gingham 深色下核对普通、hover 和 selected 表面分别来自当前主题。独立静态代码审查未发现阻断问题，并据建议为菜单长文字补充收缩和换行。

PR 前后对比截图已询问待回复；未把未回复视为同意。Skills 关键帧采集挂起后已停止，本轮未上报截图，未采用未验证画面替代。因浏览器任务在采集阶段中断，未刷新 ego-ops 的成功验证日期；原有经验继续保留。未执行原生移动设备、跨设备同步或正式发布验收。
