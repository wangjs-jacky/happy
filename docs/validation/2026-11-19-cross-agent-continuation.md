# 新建跨 Agent 接续会话：实现与验证

## 范围与结果

用户确认保留原会话，在相同工作目录创建另一 Agent 的新会话，首版 Claude ↔ Codex；随后明确不需要截图，仅完成代码与功能验证。本次没有安装/替换正在运行的 CLI，没有推送、发布 OTA 或上线 Web，也没有操作浏览器或真实用户会话。

会话菜单与详情页新增相反 Agent 的入口，目标保留 parentSessionId 和来源 Agent。只有在线且声明 conversion capability=1 的机器、已具备原生 ID 的非应用会话才能显示；执行中、待批准或有排队消息时不提供操作。目标以自身账号、系统指令与权限配置启动。

来源由 daemon 通过精确 /v2/sessions/:id 快照验证，前端不能传任意源路径或原始历史。导出前后重新检查来源 revision/native ID/cwd 与运行状态；不会停止、删除或改写源会话，但用户之后仍可能主动同时启动两边，因此界面提示避免两个会话同时执行。

## 历史保留与边界

- Claude 读取主 parent 链；Codex 使用原生 thread/read，绑定账号走既有隔离历史缓存。新建目标都不修改源日志。
- 用户/助手正文、Shell 调用与输出、用户内嵌或可恢复的本机图片迁移；未知工具转文本，私有推理不迁移。
- 工具输出逐条限制为 64 Ki 字符并显式标注截断；总转换限 32 MiB、最多 50,000 项；缺图片、历史链不完整、未知内容或正在执行的调用明确失败。
- Codex 的 inject_items 实测会把 input_image 持久化成文本，不能作为可恢复图片的导入方法。最终实现新建 legacy rollout，写原生 response_item、图片与已闭合 synthetic turn；临时文件完成并同步后才暴露为正式文件。
- 本机 cross-agent-context 保存可移植前缀及 synthetic turn ID；再次导出时剔除对应原生 synthetic turn，再拼入原始前缀，避免丢失或重复。完整 native fork 复制前缀，跨目录 fork 更新目录；缺失必要前缀明确失败。
- 导入部分为一个完整 synthetic turn，首版拒绝在该回合内部截断分叉，避免把 rewind 删除的上下文重新带回。导入后的新回合和完整分叉继续可用。
- 同 requestId 并发合并，持久收据防断线重试重复启动。确认没有 dispatch 的失败可重试；未知结果不盲目重启，可通过目标 metadata 的 request ID 找回已创建会话。跨 Agent 环境标记在 runner 捕获后清除，避免后续子进程继承身份。

## 验证

| 检查 | 最终结果 |
|---|---|
| App 全量 Vitest | 554 文件、4,922 项通过 |
| CLI 全量 unit | 194 文件、1,857 项通过，2 项跳过 |
| App / CLI tsc --noEmit | 均通过 |
| 新增/相关 daemon、转换、重试测试 | 38 项通过；包括真实 daemon regular 已 dispatch 后超时与明确启动前失败 |
| 独立代码评审 | 首轮提出启动失败重试、原生 fork 前缀、旧会话快照问题，修复后通过；另修复目录更新及 synthetic rewind 边界 |
| 独立原生往返探针 | 通过文字、Shell 和精确 PNG 保留；未调用模型、未执行历史工具 |
| 最终 native probe | Claude 写入→Codex 原生 resume→原生历史可见性→导出→Claude 重建通过 |
| 截图 / 浏览器 / 手机验收 | 用户本次不需截图；未执行浏览器或真机交互 |
| 真实模型续聊 / 在线发布 | 未执行；代码与原生格式验证不等于线上已可用 |

CLI 首次全量运行继承当前 Happy 会话的 Codex 账号环境，导致本应模拟未绑定客户端的测试失败；移除测试子进程中的 HAPPY_CODEX_ACCOUNT_PROFILE_ID、HAPPY_CODEX_ACCOUNT_CREDENTIAL_VERSION、CODEX_HOME、HAPPY_CODEX_PATH 后相关客户端测试通过。Goal Board fs.watch 测试在中间两次运行有超时，最终隔离环境的全量运行全部通过。没有为这些现象修改账号或 Goal Board 产品代码。

## 复跑入口

在本 worktree 先 pnpm install，构建 happy-wire 与 paws-agent，再执行：

```sh
pnpm --filter happy-app exec vitest run --maxWorkers=4
env -u HAPPY_CODEX_ACCOUNT_PROFILE_ID -u HAPPY_CODEX_ACCOUNT_CREDENTIAL_VERSION -u CODEX_HOME -u HAPPY_CODEX_PATH pnpm --filter @wangjs-jacky/paws exec vitest run --project unit --maxWorkers=4
pnpm --filter happy-app typecheck
pnpm --filter @wangjs-jacky/paws typecheck
HAPPY_CODEX_PATH=<真实 Codex 二进制绝对路径> pnpm --filter @wangjs-jacky/paws exec tsx scripts/probe-cross-agent-history.ts
```

探针使用隔离临时 home 和合成资料，清理自己的临时文件，不调用模型、不触碰用户项目。真实模型接续、完整 Happy UI 新建链路、手机和已发布 CLI 仍需配套执行端部署后验收；旧 CLI 不声明新 capability，入口不会提前出现。
