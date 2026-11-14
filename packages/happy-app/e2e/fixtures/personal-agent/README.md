# Personal 完整 App 隔离验收

在仓库根运行：

```sh
pnpm exec tsx --tsconfig packages/happy-cli/tsconfig.json packages/happy-app/e2e/fixtures/personal-agent/serve.mjs
```

此入口创建独立 PGlite 服务、合成账号、支持 Personal 的机器和 Personal 对话，运行真实完整 App、加密 socket/RPC/消息。执行器为测试替身：不会启动 daemon、调用模型、运行命令、读真实用户文件或访问生产账号。初始化包含本地数据库迁移和 Metro 冷构建，不构建 CLI。

运行信息位于被 Git 忽略的 `packages/happy-app/test-results/personal-agent/runtime.json`。认证入口仅写入同目录 `auth-url.txt`（0600），不得打印、截图、提交或公开。通过 Ego 导航该文件中的认证 URL 后，立即导航到干净的 `<webUrl>/personal`，再读取页面或截图。只能使用 Ego 浏览器。

`controllerUrl` 仅绑定 `127.0.0.1`，接口由用户动作触发；不轮询业务状态：

| 方法与路径 | 作用 |
| --- | --- |
| `GET /runtime` | 安全运行信息及明确能力边界 |
| `GET /metrics` | spawn、resume、message、abort、approval、denial、completed 计数；不含凭据或正文 |
| `POST /running` | 开始一轮合成运行，保持到明确完成或停止 |
| `POST /pending` | 写入真实待确认 agentState；默认故意不写工具历史，以验证历史窗口之外的固定审批入口 |
| `POST /pending?history=1` | 同时写入工具开始消息，验证展开/收起及待确认卡片 |
| `POST /complete` | 清除待确认并完成合成轮次 |
| `POST /offline` | 发送该对话离线事件，暂停 presence 心跳 |
| `POST /online` | 恢复在线 presence |
| `POST /shutdown` | 关闭本 fixture 的客户连接、服务并删除其隔离环境 |

所有状态接口默认作用于 `runtime.sessionId`；新建对话后可用 `?sessionId=<明确ID>` 指定当前合成对话。未知对话、重复运行或重复审批返回 409，避免隐式切换对象。

前端允许/拒绝通过真实 `permission` RPC 完成，随后写回 completedRequests、发送合成完成回复及真实 turn-end；不会执行展示的命令，不接受全会话或全工具授权。停止通过真实 abort RPC，重连通过 `resume-happy-session` 返回原 ID。机器和会话的 transport ping 仅续在线，不扫描或查询业务。

最小验收：

1. 从侧栏 Personal 进入，发送普通文本；核对右侧用户消息、左侧回复、completed 状态及 `/metrics` 单次增量。
2. 写入多行草稿，离开并返回/刷新，确认草稿和原对话 ID 保留；资料更名、取消和恢复不切换对话。
3. `POST /pending`，确认固定审批入口可见且无虚假思考提示；允许或拒绝后该入口消失，计数仅增一次。
4. `POST /running`，从页面点击停止；核对取消状态与 abort 计数。
5. `POST /offline`，从页面重新连接；核对原 ID、历史、草稿和 resume 计数。
6. 检查主题与较窄桌面视口的按钮可达、长命令换行与页面溢出。

以上只证明完整客户端、隔离服务与真实传输链路，不能表述为真实模型、默认 daemon、生产发布或原生真机验收。退出优先调用 `/shutdown`；不要结束其他工作树、服务或用户 worker。

## 真实隔离电脑模式

`PAWS_PERSONAL_FIXTURE_COMPUTER=1` 接入真实 PersonalComputer；仍不调用模型，聊天和审批保持测试替身，但电脑 RPC、Docker、chrome-use 与图像传输均为真实实现。只有用户点击启动才构建/启动电脑。设置 `PAWS_PERSONAL_FIXTURE_INITIAL_TARGET=local` 可从旧本地对话测试显式新建 Docker 对话。机器的协议能力与新建请求中的执行目标分别校验，不允许静默降级。

关闭 fixture 只断开 runtime 并保留本轮电脑卷；先在 App 停止电脑，避免遗留运行容器。

## Ego 验收与视频

`verify.ego.mjs` 导出 `run(context, options)`，仅在已记录数字 task space 和精确 p2 target 上操作。传入 `spaceId`、`targetId`、干净 `/personal` URL、Happy `sessionId`、任务固定 `runId` 和当前 Happy runtime 提供的 `captureHelperUrl`（file URL）；`part` 为 `chat` 或 `computer`。先普通验收，再用 `record: true` 复跑。电脑路径从原 local 对话开始，原草稿为“保留多行草稿\n第二行”；只操作合成会话和本任务电脑。

视频使用 Ego 当前目标的 JPEG 采样及已绑定关键帧，不查询业务状态。采样与页面动作串行，防止原始 CDP 使 Ego 的动作定位失效。当前 Ego Page.cdp 拒绝 screencast ACK 的 sessionId 字段，不能把无 ACK 的一次帧流当作连续录屏。JSON 保存实际帧时间和检查结果；编码前统一 PNG/JPEG 格式，保留实际时间，再完整解码及抽帧检查。
