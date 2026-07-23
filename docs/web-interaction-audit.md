# Web 交互审计

> 记录桌面 Web 端可交互行为、控制台异常、根因和回归状态。本文件只记录可复现证据，不把级联日志重复计算为多个问题。

## 审计环境

- 审计日期：2026-07-24
- 浏览器入口：`http://localhost:8081`
- 原始基线：`0bc03309f2e3fa9ce981def668ccd1b11a6f8b68`
- 修复基线：`8e269353de5cc828e28acc967536cea5a1ad5e5a`
- 登录状态：复用浏览器现有登录态，不读取或复制浏览器存储

## POC：WEB-001

| 字段 | 内容 |
|---|---|
| 页面 | 设置外观页、收件箱 |
| 前置状态 | 已登录；桌面宽度；左侧为 permanent drawer |
| 操作一 | 在 `/settings/appearance` 点击侧栏“收件箱” |
| 操作二 | 在 `/inbox` 点击侧栏“新建会话” |
| 错误 | `The action 'CLOSE_DRAWER' was not handled by any navigator.` |
| 稳定性 | 两条安全导航路径均可稳定复现 |
| 严重级别 | P1：每次侧栏导航都会新增开发期控制台错误 |
| 根因 | `SidebarNavigator` 知道桌面使用 permanent drawer，但 `SidebarView` 未接收该布局信息，导航前仍无条件派发 `DrawerActions.closeDrawer()` |
| 修复 | 由 `SidebarNavigator` 显式传入 `closeDrawerOnNavigate`；手机抽屉保持原行为，桌面 permanent drawer 只执行路由导航 |
| 自动化回归 | `SidebarView.test.tsx` 覆盖关闭行为；`SidebarNavigator.test.tsx` 覆盖 desktop/tablet → `false`、phone → `true` 的调用方映射 |
| 浏览器回归 | 修复后重复操作一、操作二，均正常导航，点击时间窗口内错误和警告为 0 |
| 交叉审查 | 独立审查发现调用方集成测试缺口；已用“临时恢复回归 → 测试失败 → 恢复修复 → 测试通过”证明回归保护有效 |
| PR / CI | [#204](https://github.com/wangjs-jacky/happy/pull/204)；typecheck 与 OTA preview 均通过 |
| 状态 | 已由用户验收并合入 `main`（merge commit `d451341c`） |

## POC 使用的工具与方法

| 目的 | 工具或方法 | 使用方式 |
|---|---|---|
| 动态复现 | Browser Control | 复用登录态，从点击前时间戳截取新增控制台日志 |
| 根因定位 | systematic debugging | 从 `CLOSE_DRAWER` 日志反查派发点，再比较 phone drawer 与 desktop permanent drawer |
| 隔离修改 | sibling Git worktree | 从最新 `main` 创建独立分支；按项目规范在 pnpm worktree 内重新安装依赖 |
| 回归保护 | TDD / regression proof | 组件测试覆盖行为，导航器集成测试覆盖布局到 prop 的映射 |
| 交叉检查 | 独立代码审查 | 检查实现边界、移动端兼容、测试有效性和文档准确性 |
| 完成验证 | verification before completion | 定向测试、完整测试、类型检查、Web 导出、浏览器原路径回放 |

## POC 期间发现的其他问题

以下问题不与 WEB-001 混合修复，留待 POC 验收后的全量审计处理。

| ID | 触发位置 | 现象 | 当前判断 |
|---|---|---|---|
| WEB-002 | 旧基线点击“新建会话” | `CanvasKit is not defined`，随后大量 `PictureRecorder` 异常 | 最新 `origin/main` 已通过 `ComposeHomeParticles.web.tsx` 处理；修复基线上未再复现 |
| WEB-003 | 旧基线启动 | 路由文件缺少默认导出、布局声明了不存在的开发路由 | 最新 `origin/main` 已调整路由文件位置和声明；修复基线上未再复现 |
| WEB-004 | 页面加载 | Web 端 push token change listener 不受支持 | 待全量审计确认是否应在 Web 跳过注册 |
| WEB-005 | 页面加载 | `props.pointerEvents` 已弃用 | 待按组件堆栈定位调用点 |
| WEB-006 | 打开外观页 | `"shadow*" style props are deprecated. Use "boxShadow".` | 待按外观页实际渲染组件定位 |
| WEB-007 | PC 首页点击 hamburger | permanent sidebar 已经可见，但按钮仍显示且点击无任何行为 | Batch 01 已修复，由 PR #205 合入 `main` |
| WEB-008 | PC 首页与 `/new` 欢迎标题 | 问候语仍沿用移动端左侧定位，没有进入桌面居中的 800px 输入内容列；360px 行宽还会让原中文标题的末字孤立换行 | Batch 02 已保存[修复前](web-interaction-audit/screenshots/batch-02-new-greeting-before.jpg)与[修复后](web-interaction-audit/screenshots/batch-02-new-greeting-after.jpg)截图；自动化同时保护左边界和代表性中文标题单行排版 |
| WEB-009 | PC `/new` 返回与头部控件 | 局部返回与全局导航重叠；全局 Web 返回错误依赖导航器栈；800px 附近机器 chip 命中区也有碰撞风险 | Batch 01 已修复，由 PR #205 合入 `main` |

## POC 验收检查点

1. 运行侧栏组件测试，确认手机和桌面两种行为都通过。
2. 运行 `happy-app` 类型检查。
3. 运行 `happy-app` 完整测试集。
4. 导出 Web 静态构建。
5. 用 Browser Control 回放两条原始操作，确认没有新增 `CLOSE_DRAWER`。
