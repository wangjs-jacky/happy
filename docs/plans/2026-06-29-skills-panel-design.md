# Skills 预览面板 — 设计文档

> 日期：2026-06-29 · 分支：`skills-panel` · 仅 happy-app 改动

## 一、背景与目标

灵感来自 Kimi 设置里的「常用语」面板。Happy 可以触发各类 Skills，每个 Skill 都有触发词。
目标：在 Settings 里新增一个「Skills 预览」面板，**实时读取宿主机上已安装的 Skills**，
提炼每个 Skill 可能的触发词展示，点击进入只读 Markdown 阅读页查看完整 `SKILL.md`。

## 二、关键决策（已与用户确认）

| 决策点 | 选择 |
|--------|------|
| 数据来源 | 实时扫描宿主机（动态、永远最新） |
| 点击行为 | 只读查看 SKILL.md（纯参考，不插入输入框） |
| 触发词提炼 | 解析 frontmatter `description` 字段（纯本地正则，零模型） |
| 入口命名 | 「Skills 预览」 |

## 三、架构

**纯 App 改动，零后端。** 核心发现：`happy-cli/src/modules/common/registerCommonHandlers.ts`
把 `bash`/`readFile`/`listDirectory`/`ripgrep` 同时注册在 **session 级和 machine 级**
（`apiMachine.ts:136`）。App 端目前只为 machine-level 包了 `browseDirectory`，但 daemon
已经接受 `machineRPC(machineId, 'bash'|'readFile', …)`。

→ 因此本功能 **不需要活跃 session、不需要改 daemon**，只需 app 端新增对 machine RPC 的封装。

被否决的方案：
- B. 新增 daemon RPC `listSkills`：更正规但要动 daemon（dist 路径坑），改动面大。
- C. `sessionBash` 扫描：需要活跃 session，UX 限制大。

## 四、数据流

1. **机器选择**：进面板时用 `useAllMachines()`。仅 1 台在线 → 直接用；多台 → 顶部机器选择器。
2. **扫描（一次 machineRPC `bash`）**：
   ```bash
   find ~/.claude/skills ~/.claude/plugins/cache/*/*/*/skills \
        -maxdepth 2 -name SKILL.md 2>/dev/null
   ```
   用内联脚本对每个 SKILL.md 抽取 frontmatter 的 `name` + `description`，
   以分隔符拼成一坨返回，App 端切分 —— 一次 RPC 拿整张列表，不逐文件读。
3. **触发词提炼（纯本地正则）** 按优先级从 description 抓：
   1. `触发词：xxx`、`触发于…`、`触发：…`
   2. `Triggers include …` / `Use when …`
   3. 兜底：description 第一句
4. **点击 → 详情页**：`machineRPC(machineId, 'readFile', { path })` 拿全文 → 复用 app 的
   `markdown` 组件渲染。
5. **分组**：「个人 Skills」（`~/.claude/skills`）置顶；「插件 Skills」（plugins cache，量大）
   折叠/置后。

## 五、UI 结构

```
Settings
 └─ [个性化] 记忆空间
              Skills 预览   ←── 新增（对应 Kimi「常用语」位置）

Skills 预览 (列表页)
 ├─ [机器选择器，多机时显示]
 ├─ 🔍 搜索（按 name / 触发词过滤）
 ├─ 📌 个人 Skills — 卡片：name + 触发词 chips
 └─ 🧩 插件 Skills（默认折叠/置后）

Skill 详情页
 └─ 只读 Markdown 渲染整份 SKILL.md（标题 = skill name）
```

## 六、文件改动清单（全部 happy-app）

| 文件 | 改动 |
|------|------|
| `sync/ops.ts` | 新增 `machineBash` / `machineReadFile`（包 `apiSocket.machineRPC`，复用 'bash'/'readFile'） |
| `sync/skills.ts` *(新)* | `scanSkills(machineId)`、`parseTriggers(description)`、类型定义 |
| `app/(app)/settings/skills.tsx` *(新)* | 列表页（机器选择 + 搜索 + 分组卡片） |
| `app/(app)/settings/skill/[path].tsx` *(新)* | 详情页（readFile → markdown） |
| `components/SettingsView.tsx` | 加「Skills 预览」入口（记忆空间下方） |
| `app/(app)/_layout.tsx` | 注册两条新路由 |
| `sync/skills.spec.ts` *(新)* | `parseTriggers` 单测（中英文 frontmatter） |

## 七、开发约束

- `jacky-main` 只读；改动走 sibling worktree `../happy--skills-panel`（分支 `skills-panel`）。
- PR 合并后立即同步主仓库 `jacky-main`，再清理 worktree。
