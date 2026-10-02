# 我的 Agent

第一版把 Agent 当作可复用的个人助手：职责 + 少量真实 Skills + 用户明确保存的偏好 + 运行环境。先使用普通 Codex 会话，不自动启动 Party 或多模型辩论。

左侧只有一个 Agents 入口。列表展示名称和一句简介；点击卡片开始使用助手。创建和修改都在普通聊天完成，可以直接在任意支持的已有会话发送 `/agent 创建一个狗头军师` 或 `/agent 修改狗头军师，回答简短一点`，继续使用同一会话与上下文。

列表中的“创建 Agent”和“修改”仅通过 `/new?agentCommand=...` 在普通输入框预填可编辑的 `/agent` 请求，沿用当前设备与项目；入口不自动发送、不切换引擎或模型，也没有独立创建/修改模式。仅启动已保存的助手仍使用 `/new?myAgentMode=use&myAgentId=...` 来绑定角色与执行环境。Skills、模型和长期偏好不形成额外配置步骤。普通自然语言“帮我创建一个 Agent”“把这次的方法保存成 Agent”仍可触发内置工具；需要明确路由时用 `/agent`。

## 固定指令

`/agent` 只匹配消息开头的完整指令 token，大小写不敏感，接受空格、换行或制表符分隔。`/agents`、`/agent-builder`、引用、代码块或正文中提到 `/agent` 都按普通文本处理。单独发送 `/agent` 会加载管理 Skill 并询问需求，不自动创建空助手。

支持此功能的 CLI 在会话 capabilities 中声明 `myAgentCommand`；App 在发送前检查，并把原始请求记录为本条消息的 `meta.myAgentCommand`，避免续接上下文前缀遮挡指令。旧 CLI 和无 Happy 工具的会话会明确报错，保留用户请求。普通聊天补全只在支持的会话中显示 `/agent`。

CLI 直接读取包内 `skills/agent-builder/SKILL.md` 并把完整内容加入该轮请求，无需模型猜测是否调用管理 Skill。当前支持 Codex、Claude、Gemini 与 ACP/OpenCode；Ask 和 OpenClaw 明确拒绝。指令独立排队但不清除前后消息，附件仍属于原消息；后续普通消息不自动重复加载 Skill，也不把当前会话绑定成新创建的助手。稳定触发不等于保证模型产出的质量，实际保存仍由工具验证。

## 创建与更新

CLI 包包含 `skills/agent-builder/SKILL.md`。Happy MCP 的 `agent_builder` 读取此文件，`agent_skills` 列出执行设备上的真实名称、描述和 canonical SKILL.md 路径。`agent_save` 持久化助手并返回 `<happy-agent>` 卡片。`agent_list`、`agent_get`、`agent_archive` 完成查询、乐观并发修改和归档恢复。

同设备绑定必须匹配真实扫描结果；另一设备只能保留原有绑定。未安装 Skills 可以保留名称并省略路径；必要依赖问题由 builder 写入 `setupNotes`，任务启动会明确阻止。Skills 是方法与提示，不能自动授予安装、浏览器、外部发送或其他权限。

编辑省略的字段会继承既有值。创建沿用当前可用 Codex 模型/思考配置；Claude 会话的模型不会写进 Codex 档案，缺省交由已有服务默认值处理。首版不创建其他引擎的专用助手。

## 普通会话

启动前重新读取档案，并通过机器的 `my-agent-skills` RPC 检查 Skills。RPC 与 builder 共用 CLI 的 scanner，覆盖 `.codex/skills`、`.codex/plugins`、`.claude/skills`、`.claude/plugins` 和 `.agents/skills`，按真实文件路径去重。档案中的设备和目录只作为输入框初始值；实际启动以发送时所选设备、项目或已有 worktree 为准，并在目标环境重新校验 Skills。路径绑定不会自动迁移，目标缺少绑定文件则停止启动。保存助手当前固定使用 Codex，界面锁定对应引擎，模型、权限和执行环境仍可调整。启动后先确认加密 metadata 中的 `myAgentId`，再记录会话并发送任务。App 每次发送都读取最新档案并加入系统提示；Codex 在提示变化或线程恢复后重新注入。空偏好会明确撤销历史保存偏好。

启动 receipt 存在当前账号的 MMKV namespace，在 RPC 发出前写入。已返回 sessionId 的重试继续同一会话；结果未知时保持待找回状态，阻止同一请求再次 spawn。消息入队后保存 localIds，运行时保留原 receipt 来重建本地投影，重试不重新发送。blur 或账号切换不能删掉未完成 receipt 或抢走新页面。reload 后原 receipt 对象不可恢复时，可打开已创建的会话，不保证所有投影问题都自动恢复。

工作记录是会话引用。新任务不会复制其他会话的项目内容。`preferences` 仅保存用户明确要求长期记住的偏好；用户在修改对话中要求清除时，由 builder 保存空偏好。

## 服务与兼容

沿用 Party 的 account-isolated `ProfileService`，增加 Skills、概要、显式偏好、待配置说明、归档和最近会话。存储写入串行，创建按 requestId+配置 fingerprint 去重，编辑/归档按 updatedAt 防止覆盖并发改动。App 高级管理器和 Party 网站编辑器都携带 revision；旧客户端不传 revision 的旧 API 仍保持兼容。

`/agent-party/api/my-agents` 只接受受信 Paws relay 验证过的账号 bearer，提供窄范围 catalog 路由；该 bearer 不能进入 Party 的机器执行 API。CLI 使用当前会话的 token，不读取其他账号凭据。Party 邀请复用相同档案库；已有群聊仍保留邀请时的快照，归档助手不能新加入群聊。第一版不改变 Party 的多助手执行模型，也不声称群聊已自动调用绑定 Skills。

上线需要配套部署 account-server、发布包含内置 Skill/工具/RPC 的 Paws CLI，升级并重启执行设备 daemon，以及 App/Web 更新。单独装 preview OTA 不能补齐旧 CLI 或后端。

## 验证边界

自动测试覆盖保存、重启恢复、A/B 账号隔离、创建幂等、并发修改、原管理器字段保留、真实路径、部分字段编辑、机器 RPC、角色刷新、启动顺序、未知结果重试及页面异步取消。另有真实组件与工具的 [Ego 隔离夹具](../../packages/happy-app/e2e/fixtures/my-agents/README.md)。

隔离夹具复用真实列表、ComposeHome、MessageComposer、内置 Skill/命令加载器和保存工具；认证、配置控件、模型、RPC、加密传输与会话壳属于模拟边界。自动测试另覆盖原始 `/agent` 元数据与续接上下文、CLI 版本能力检查、非破坏性队列、附件保留、普通 first submission 与已保存角色启动恢复。夹具不能代表完整 Happy 页面的交互验收。

完整页面联调使用独立本地账号、实际 relay/account-server、独立 daemon、真实 Codex 模型和完整 Expo Web。开发构建允许通过当前账号的 loopback 服务地址访问 Agents API；正式构建仍只允许现有正式/预发布 origin。测试数据不进入正式账号。用户要求的截图来自完整 Happy 页面，并通过 Happy 图片工具发送；PC Web 验收不代表 Android 真机或正式服务器已上线。

Codex 的六个 Happy Agent MCP 操作和会话标题更新在聊天中显示简短状态行，避免展开完整职责、Skills 路径等内部 JSON。点击操作仍可查看详细输入输出；失败状态和权限反馈保留。

完整页面 Ego 验收已覆盖：左侧入口与真实列表、普通输入框的创建/修改快捷入口、同一会话创建并修改助手、后续普通聊天、保存后重新读取档案、实际绑定 Skill 的使用、原中断请求复用已有会话，以及全新助手会话启动。真实联调发现服务端 metadata CAS 失败时返回旧快照，现改为按账号回读最新密文和版本；客户端仍保持三次有界尝试。最终页面证据见 [助手列表](my-agents-evidence/full-happy-catalog.png)、[同一聊天修改](my-agents-evidence/full-happy-edit-chat.png) 和 [使用助手](my-agents-evidence/full-happy-use.png)。
