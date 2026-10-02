# Agents 对话式流程验收夹具

从仓库根目录运行：

```sh
MY_AGENTS_FIXTURE_PORT=18785 node packages/happy-app/e2e/fixtures/my-agents/serve.mjs
```

通过 Ego 打开打印的 localhost 地址。夹具使用真实 MyAgentsScreen、ComposeHome、MessageComposer（含命令补全）、MyAgentCard、useFirstSubmission、FirstSubmissionOwner、useMyAgentCompose、launch、命令 parser、内置 Skill loader、CLI 工具、canonical scanner 和 ProfileService，组件采用 ginghamDark。

认证、配置控件与外围布局 hooks、机器 RPC、加密会话存储、hydration、消息 staging、模型与会话壳是模拟边界。useFirstSubmission 不再是空实现：真实 hook 与 owner 通过 localStorage 持久化，并实际执行合成 spawn → send → projection → navigation；已有会话由真实 MessageComposer 驱动合成 sync 边界，保留逐轮历史。`/fixture/state` 暴露合成会话数量、每轮 command/Skill 加载及工具记录，供同会话、无误触发和保存后读取断言。浏览器只修改临时档案和 synthetic sessions。

模型边界是刻意有限的脚本：创建默认名“狗头军师”，也可用“叫方案助手”指定合成名字；修改按已存在名称定位，只更新简短回答偏好。它不证明真实模型会正确理解任意自然语言、选 Skill 或执行多轮追问。真实账号隔离、命令 capability 检查、加密 metadata、staging 拒绝/恢复和 CLI 队列另由服务/CLI/App 测试覆盖。此夹具不能证明完整 Sidebar/Header/SessionView、真实 daemon/LLM、生产部署、Android 键盘/安全区或原生端行为。

1. **AG-C01 普通会话创建：** 从 `/new` 正常发送一句话建立会话，再发送 `/agent 创建一个狗头军师，擅长分析方案并指出风险`。会话 id 和数量不变，真实 packaged Skill 被加载，真实保存工具返回卡片。
2. **AG-C02 同会话修改：** 继续发送 `/agent 修改狗头军师，以后回答简短一点`。会话 id 和档案 id 不变，保存偏好变化，职责/Skills 不变。
3. **AG-C03 普通消息与裸命令：** 继续正常聊天，命令 loader 不触发且没有 agent_save。单独发送 `/agent` 时加载 Skill 并提示补充请求，但不保存 Agent。
4. **AG-C04 列表快捷入口：** 返回并刷新列表，读取已保存助手。创建与修改入口只进入 `/new?agentCommand=...` 预填可编辑命令，不自动发送或创建会话。可直接在普通新会话发送完整 `/agent` 命令创建另一个助手。没有专门 create/edit 模式或额外表单。
5. **AG-C05 使用与键盘：** 卡片仍进入 `/new?myAgentMode=use&myAgentId=...`，发送任务后 launch 绑定角色并读取最新偏好。1440×900 检查无横向溢出、列表主题焦点、普通新会话 `/ag` 用 ArrowDown/Enter 补全、Enter 发送、Shift+Enter 换行、空输入禁发。此处桌面回归不等于窄屏/原生 Mobile 验收。

稳定选择器：`[data-testid="my-agents-create"]`、`[data-testid="my-agent-<id>"]`、`[data-testid="my-agent-edit-<id>"]`、`[data-testid="new-session-message-input"]`、`[data-testid="message-composer-send-button"]`。

记录自己的 Ego 数字 task-space ID 和精确 targetId，跨轮次只恢复该空间并验证预期 URL。按 Happy 全局要求上报已验证关键步骤到 Skills 面板；用户本轮不需要普通截图附件或视频，勿额外发送。SIGTERM 关闭自己的 server 后删除临时数据。
