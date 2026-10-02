# Agents 对话式流程验收夹具

从仓库根目录运行：

```sh
MY_AGENTS_FIXTURE_PORT=18785 node packages/happy-app/e2e/fixtures/my-agents/serve.mjs
```

通过 Ego 打开打印的 localhost 地址。夹具使用真实 MyAgentsScreen、ComposeHome、MessageComposer、MyAgentCard、useMyAgentCompose、launch、内置 Skill、CLI 工具、canonical scanner 和 ProfileService，采用 ginghamDark。

认证、配置控件与外围布局 hooks、机器 RPC、加密会话存储、hydration、模型与会话壳是模拟边界。只修改临时档案和 synthetic sessions。真实账号隔离和机器 RPC 另由服务/CLI 测试覆盖；这里不能证明完整 Sidebar/Header、真实 daemon、模型质量或 Android 键盘/安全区。

1. **AG-S01 列表：** 名称和简介卡片，无创建/职责/Skills/模型表单，创建与修改入口可发现。
2. **AG-S02 创建：** 点击创建进入 `/new?myAgentMode=create` 的原有输入框。空输入禁发，不自动发消息。输入自然语言并发送，模拟模型加载真实内置 Skill、扫描真实临时 Skills、调用真实保存工具。聊天只显示用户需求，返回列表能看到保存结果。
3. **AG-S03 使用：** 点击卡片进入 `/new?myAgentMode=use&myAgentId=...`。在普通输入框给任务，launch 在发送前确认角色 metadata，模拟回复读回保存角色。保存卡片也直接进入此入口。
4. **AG-S04 修改：** 点击修改进入 `/new?myAgentMode=edit&myAgentId=...`。直接输入调整要求，真实保存工具修改档案，保留未要求变更的字段。没有额外配置页。
5. **AG-S05 状态与布局：** 1440px 下检查焦点、Enter、空/满输入、忙状态与无横向溢出；390×844 只验证窄屏 Web。旧启动/投影不能抢走页面或重复发送，由 hook、launch、ComposeHome 回归测试覆盖。

稳定选择器：`[data-testid="my-agents-create"]`、`[data-testid="my-agent-<id>"]`、`[data-testid="my-agent-edit-<id>"]`、`[data-testid="new-session-message-input"]`、`[data-testid="message-composer-send-button"]`。

记录自己的 Ego 数字 task-space ID 和精确 targetId，跨轮次只恢复该空间并验证预期 URL。按 Happy 全局要求上报已验证关键步骤到 Skills 面板；用户本轮不需要普通截图附件或视频，勿额外发送。SIGTERM 关闭自己的 server 后删除临时数据。
