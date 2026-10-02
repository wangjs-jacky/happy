# Agents 对话式流程验收夹具

从仓库根目录运行：

```sh
MY_AGENTS_FIXTURE_PORT=18785 node packages/happy-app/e2e/fixtures/my-agents/serve.mjs
```

通过 Ego 打开打印的 localhost 地址。夹具使用真实 MyAgentsScreen、ComposeHome、MessageComposer（含命令补全）、SessionConfigPanel 及其机器/项目/引擎/模型/权限/思考强度 picker、SessionComposer 的三个 selector、MyAgentCard、useFirstSubmission、FirstSubmissionOwner、useMyAgentCompose、launch、命令 parser、内置 Skill loader、CLI 工具、canonical scanner 和 ProfileService，组件采用 ginghamDark。

认证、配置数据存储与外围布局 hooks、机器/目录/worktree RPC、加密会话存储、hydration、消息 staging、模型与会话壳是模拟边界。配置面板和 picker 不再整体模拟。useFirstSubmission 不再是空实现：真实 hook 与 owner 通过 localStorage 持久化，并实际执行合成 spawn → configure → send → projection → navigation；已有会话由真实 MessageComposer 驱动合成 sync 边界，保留逐轮历史。浏览器只修改临时档案和 synthetic sessions。

两台在线机器各有独立临时 home、`projects/project-a`、`projects/project-b` 和 `project-a/.dev/worktree/existing-feature`。机器 A 的真实文件包含 `.agents/skills`、`.claude/skills/claude-local/SKILL.md` 和 `.claude/plugins/cache/fixture-market/fixture-methods/1.0.0/skills/claude-review/SKILL.md`；机器 B 没有这些 Skills。共享 `listCodexSkillEntries` 保持真实，仅在打包时将其 `os.homedir()` 定向到当前合成机器的 home（AsyncLocalStorage 隔离）。`agent_skills`、`agent_save` 校验、`machineListAgentSkills` 都走这个共享 scanner，不读取操作者真实 home。

`/fixture/state` 提供 `machines`（含目录和 worktree 路径）、`scans`（机器/目录/真实扫描结果）、`launches`、合成 `sessions` 和保存档案。每条 launch 的 `request` 保留真实 spawn RPC 参数；`machineId/directory/engine` 来自这些参数。`model` 在首条消息到达后记录配置阶段的选项，因为生产 spawn RPC 本身不接收模型；原始 `configuration`、实际消息 `mode` 同时保留在 session 内。会话 metadata 始终从对应 spawn 构造，不能回退成 fixture 全局机器或目录。

模型边界是刻意有限的脚本：创建默认名“狗头军师”，也可用“叫方案助手”指定合成名字；请求含 `Claude` 时绑定真实扫描出的两项 Claude 来源 Skills，否则匹配 grilling/show-me；修改按已存在名称定位，只更新简短回答偏好。它不证明真实模型会正确理解任意自然语言、选 Skill 或执行多轮追问。真实账号隔离、命令 capability 检查、加密 metadata、staging 拒绝/恢复和 CLI 队列另由服务/CLI/App 测试覆盖。此夹具不能证明完整 Sidebar/Header/SessionView、真实 daemon/LLM、生产部署、Android 键盘/安全区或原生端行为。

## 配置与 Claude Skills 回归

启动时通过真实保存工具建立两个种子助手，避免用浏览器内部变量伪造选项：

- **配置验证助手**：保存默认机器 A / 项目 A，无绑定 Skills，方便独立检查配置选择。
- **Claude Skills 助手**：保存机器 A / 项目 A，绑定 `claude-local`、`fixture-methods:claude-review`；scanner 未发现这两个方法时夹具启动即失败。

| Case | 可点击步骤 | 通过条件 |
|---|---|---|
| AG-P1 | 打开配置验证助手，点机器、Project、Model 控件，更换机器 B、项目 B、gpt-6-astra 后发送 | `launches` 与界面机器/目录/模型一致，engine 为 codex；扫描记录也使用新机器和目录 |
| AG-P1-engine | 打开保存助手，再打开普通新对话比较 engine 控件 | 保存助手显示 Codex 且不可更换；普通聊天仍可打开引擎 picker |
| AG-P1-worktree | 在 Project picker 选择已存在 worktree 路径后发送 | 实际 launch.directory 为完整 worktree 路径，不能回到档案保存目录 |
| AG-P2 | 普通新对话在机器 A 发送 `/agent 创建一个Claude助手，叫Claude验收助手`，返回列表使用它 | 创建卡片成功，保存两项真实 Claude 来源 Skills，机器 A 启动前扫描通过 |
| AG-P2-missing | 打开该助手，真实 machine picker 切到机器 B 后发送 | 显示缺少 Skills；`scans` 记录机器 B，`launches` 数量不增长 |

需要单独验证 Worktree picker 时，可使用测试专用“完整配置面板”入口（`/fixture/config`），它渲染真实 `layout="inline"` 面板；这是夹具辅助路由，不是产品新增入口。`layout="composer"` 的原有界面没有独立 Worktree 按钮，主要验收通过 Project picker 选完整 worktree 目录。

1. **AG-C01 普通会话创建：** 从 `/new` 正常发送一句话建立会话，再发送 `/agent 创建一个狗头军师，擅长分析方案并指出风险`。会话 id 和数量不变，真实 packaged Skill 被加载，真实保存工具返回卡片。
2. **AG-C02 同会话修改：** 继续发送 `/agent 修改狗头军师，以后回答简短一点`。会话 id 和档案 id 不变，保存偏好变化，职责/Skills 不变。
3. **AG-C03 普通消息与裸命令：** 继续正常聊天，命令 loader 不触发且没有 agent_save。单独发送 `/agent` 时加载 Skill 并提示补充请求，但不保存 Agent。
4. **AG-C04 列表快捷入口：** 返回并刷新列表，读取已保存助手。创建与修改入口只进入 `/new?agentCommand=...` 预填可编辑命令，不自动发送或创建会话。可直接在普通新会话发送完整 `/agent` 命令创建另一个助手。没有专门 create/edit 模式或额外表单。
5. **AG-C05 使用与键盘：** 卡片仍进入 `/new?myAgentMode=use&myAgentId=...`，发送任务后 launch 绑定角色并读取最新偏好。1440×900 检查无横向溢出、列表主题焦点、普通新会话 `/ag` 用 ArrowDown/Enter 补全、Enter 发送、Shift+Enter 换行、空输入禁发。此处桌面回归不等于窄屏/原生 Mobile 验收。

稳定选择器：`[data-testid="my-agents-create"]`、`[data-testid="my-agent-<id>"]`、`[data-testid="my-agent-edit-<id>"]`、`[data-testid="new-session-message-input"]`、`[data-testid="message-composer-send-button"]`，以及 `session-config-{machine,path,agent,model,effort,permission}-trigger`、`session-config-picker-close`。Picker 保留真实可访问名称和 radio 选项；不通过脚本修改内部 store 来绕过交互。

记录自己的 Ego 数字 task-space ID 和精确 targetId，跨轮次只恢复该空间并验证预期 URL。按 Happy 全局要求上报已验证关键步骤到 Skills 面板；用户本轮不需要普通截图附件或视频，勿额外发送。SIGTERM 关闭自己的 server 后删除临时数据。
