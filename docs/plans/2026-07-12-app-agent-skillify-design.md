# App Agent 重设计：用 Skills 替换巨型内置提示词

> 日期：2026-07-12 ｜ 分支：`app-agent-skillify` ｜ 状态：已实现（待验证/合并）

## 一、问题

内置 "App 生成" agent（`builtin:app-builder`）此前把整套开发工作流硬编码成两段巨型
提示词（Build ≈ 2050 字 / Fix ≈ 650 字），点按钮直接灌进 `codex` + `yolo` 会话。

它设计得不好，根因不是措辞而是**形态**：

- 把 7 个固定阶段（research→spec→design→build→release）、Expo 技术栈、aliyun OSS/FC
  路径、GPT Image 2 管线、Tide Focus 先例、Obsidian 沉淀全焊死在一段 prompt 里；改一处要
  改整段，每次都全量塞进上下文。
- 高度绑定「本机 + Happy 自托管」单一场景，无法复用、无法分享、无法按需加载。

## 二、目标

用 **Skills 分层**替代巨型提示词：通用方法论沉淀进 skill、按需加载；内置 prompt 只保留
「意图 + 指针 + 硬确认门」。以 **Claude Code 为主**，生图委托 Codex。

## 三、架构（三层 skill + 瘦身 agent）

| 层 | 载体 | 放哪 | 职责 |
|---|---|---|---|
| 通用引擎 | `app-flow` 四件套（app-flow / -build / -delivery / -reviewer） | **全局** `~/.claude/skills/`（建项目后再拷进项目自包含） | 替代「7 阶段流水线」，薄驾驭 + 按需加载 |
| 本机经验 | `happy-app-experience`（更新） | **全局** `~/.claude/skills/` | 自托管 OTA、OSS/FC、runtimeVersion 约定、APK/Release 边界。可分享→`references/`；机器私有→`local/` |
| 生图 | `gpt-image-2` → `codex exec` | 全局（已在） | 图标/splash/插画等，委托 Codex 出图 |
| Agent 本体 | `builtinAgents.ts` | Happy fork | `agentType: codex→claude`；prompt 瘦身；`permissionMode: yolo→bypassPermissions` |

**分层理由**：`app-flow` 是可分享的公共引擎，跟着生成的 App repo 走（自包含、可移植）；
`happy-app-experience` 是本机私有知识（`local/` 含敏感配置），留在全局、绝不复制进每个 App
repo。两者靠 Claude 的 Skill 发现机制自然拼起来。

### app-flow 的缺点与本设计的对症

`app-flow` 是高质量的「薄驾驭层」（不固定技术栈/阶段/交付、证据驱动、授权分级），但直接
当「一键建 App 引擎」有几个缺点，本设计逐一对症：

1. 它故意去具体化 → 丢掉了老 prompt 最值钱的具体做法。**对症**：具体知识搬进
   `happy-app-experience`，由 app-flow 的「metadata 发现能力」按需拉。
2. 它假设宿主有丰富 metadata + 已有 local 记忆，新脚手架项目里都没有。**对症**：
   `happy-app-experience` 全局安装，从会话起就在 metadata 列表里可发现。
3. Codex 与 Claude 的 skill 加载机制不同。**对症**：主运行时定为 Claude Code。

## 四、内置 prompt 落地机制（全局安装 + 建项目后自包含）

> 本节是**修正后**的方案。初版曾用「Option A：prompt 自带 bootstrap，会话启动从 labs 复制到
> `./.claude/skills/`」，被对抗审查证伪（见 §八），改为下面这套。

- **app-flow 四件套全局安装**（`j-skills link` labs 四个目录 + `install -g`，symlink 进
  `~/.claude/skills/`）。这样会话一启动它们就在 Skill metadata 列表里、**可被发现**，
  app-flow「按需拉子能力」正常工作。
- **内置 prompt 只说「加载 app-flow skill」**，不再写死 `labs/` 路径、不再靠 cwd 复制。
- **「放进项目」= 建好项目后自包含**：prompt 指示——独立项目建好后，把四个 skill 从
  `~/.claude/skills/` 复制进「新项目/.claude/skills/」（源是 symlink，用 `cp -RL` 解引用）。
  此时项目已存在、路径已知，时机正确；且这只是「让 repo 自带工作流」，不再是「引擎能否跑」的前提。
- **Fix prompt** 补一句「先确认当前工作目录就是目标 App 项目」。

**取舍**：app-flow 会出现在所有 claude 会话的 skill 列表（但其 description 限定「长任务/移动端
App」，不会乱触发）；app-flow **永久留在 `labs/`**、只 symlink 到全局，**不提升到 `skills/`
正式化**（除非用户明确要求）——因为该套件尚未完全测过，先在 labs 观察。

## 五、实施三条线

1. **jacky-skills / happy-app-experience**：把老 prompt 的具体知识蒸馏进 `references/`
   （可分享方法论）+ `local/experience.local.md`（机器私有事实：OSS 桶 `happy-app-ota-jacky`、
   runtime 22、preview/production 频道、FC 服务、GitHub Pages 版本站、arm64 debug-signed APK、
   `android-v<ver>` tag、GitHub Secrets 名等）。更新 `references/INDEX.md`。确保全局安装。
2. **jacky-skills / app-flow**：四件套 `j-skills link` + `install -g` 全局安装（源仍在
   `labs/app-flow/`，symlink 到 `~/.claude/skills/`，Claude Code + Codex 均装）。
3. **happy fork / builtinAgents.ts**（本 worktree）：两段 prompt 瘦身；`agentType='claude'`；
   `permissionMode='bypassPermissions'`（claude 规范 YOLO key，`modelMode='default'` 对 claude
   合法）。同步 `builtinAgents.spec.ts` 断言。

## 六、验证

- `builtinAgents.spec.ts`：3/3 通过（已更新 agentType/permissionMode 断言）。
- `pnpm typecheck`：worktree `pnpm install` 后执行。
- Skill 全局安装：`app-flow` / `-build` / `-delivery` / `-reviewer` + `happy-app-experience`
  均出现在 Claude Skill 列表（已验证）。
- 端到端（合并后）：App 点「App 生成」→ 起 Claude 会话 → 确认 app-flow 被加载并驱动、
  `happy-app-experience` 可发现、`gpt-image-2` 能出图、建好项目后四件套被拷进项目 `.claude/skills/`。

## 八、对抗审查与修正（2026-07-12）

两个 subagent 独立验证：代码改动本身正确可合并；但初版落地机制（Option A bootstrap）有 3 个
逻辑漏洞，已据此改为 §四 的全局安装方案：

1. **bootstrap 时机/位置错（致命）**：会话默认 cwd = `~`，且从 0 到 1 时项目还不存在，
   `./.claude/skills/` 实际指向 `~/.claude/skills/`，app-flow 被复制进全局、新项目里反而没有。
2. **中途复制的 skill 发现不了**：Skill 工具在会话启动时扫描，中途 `cp` 进来的不在 metadata 里，
   app-flow「按需拉子能力」退化为硬编码 Read。
3. **硬编码 labs 路径脆弱**：labs 是实验区、换机/改名即废。

修正：全局安装 app-flow → 从会话起可发现、prompt 只按名加载、去掉 cwd 复制；「放进项目」降级为
建项目后的自包含拷贝。`bypassPermissions` 与 prompt「先确认」不冲突（确认门是 prompt 层逻辑），保留。

## 七、影响面

- 仅改内置 agent 的预设与运行时类型；用户自定义 agent、注入机制（点 preset 填输入框）不变。
- 行为变化：内置 App agent 从 Codex 切到 Claude Code；权限模式语义等价（bypass）。
