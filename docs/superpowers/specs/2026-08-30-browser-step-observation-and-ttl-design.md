# Browser Step 自动上报与临时截图 TTL 设计

## 一、产品目标

用户安装 Happy CLI 与 Ego Lite 后，不需要单独配置 Ego skill。只要 Agent 在 Happy 会话里使用 `ego-browser`，Happy 注入的浏览器观察协议就要求 Agent 在每个有意义的页面步骤完成后：验证页面状态、截图、调用 `report_browser_step`。右侧 Browser Steps 面板按事件到达顺序实时显示步骤。

Ego skill 负责“怎么操作浏览器”；Happy 的 Prompt 与 MCP 工具负责“什么时候观察、怎么上报、在哪里展示”。两者通过 Agent 编排协作，没有进程级强绑定。

## 二、自动上报链路

```text
Happy 启动 Agent
  -> 注入 Browser Observation Prompt
  -> Agent 调用 ego-browser 完成一个页面步骤并验证
  -> Ego CDP 截 JPEG 到系统临时目录
  -> Agent 调 report_browser_step(path, label)
  -> Happy CLI 校验图片并加密上传
  -> Happy CLI 发 browser_step 文件事件
  -> Happy Web 收到事件，右侧面板追加步骤
  -> 上传与事件均成功后，CLI 删除本地临时截图
```

稳定性约束：

- Codex 使用 App Server 原生 `developerInstructions`；创建、恢复、分叉和强制重连都保留协议。
- Claude 使用原生 append system prompt。
- MCP 工具收到绝对文件路径，不接收 base64，避免大图片进入模型上下文。
- 图片必须是 PNG/JPEG，单张不超过 10 MiB；步骤名为 1–80 个字符。
- 上传或事件发送失败时保留本地临时文件，并返回稳定错误码；Agent 必须停止后续 Ego 步骤并报告失败。
- 上传与事件都成功后，只删除系统临时目录中以 `happy-browser-step-` 开头的文件，避免误删用户文件。
- 环境变量 `HAPPY_BROWSER_OBSERVATION_PROMPT=0` 是紧急关闭开关；默认开启。

## 三、OSS 临时区设计

### 3.1 存储布局

v1 使用现有 OSS 附件桶，不新建 Bucket；在同一桶中增加独立顶层前缀。OSS 的“文件夹”本质是对象 Key 前缀：

```text
browser-steps-temp/v1/{sessionId}/{runId}/{stepId}.enc
```

- 不在 Key 中写用户名、网页标题或 URL，避免元数据泄漏。
- 对象仍使用会话 blob key 加密，OSS 只保存 `.enc` 密文。
- `runId` 区分同一会话内的不同浏览器任务；`stepId` 用 UUID，避免覆盖。
- 现有普通附件继续放在 `sessions/{sessionId}/attachments/`，生命周期不受影响。

当前附件 API 只允许 `sessions/{sessionId}/attachments/`，因此切换到临时前缀需要新增 browser-step 上传/下载类型或专用路由，不能只修改 CLI 里的字符串。

### 3.2 推荐 TTL

| 截图类型 | 逻辑可见期 | OSS 物理 TTL | 用途 |
|---|---:|---:|---|
| 普通成功步骤 | 72 小时 | 3 天 | 实时观察与短期回看 |
| 失败步骤、最终结果步骤 | 7 天 | 7 天 | 排障和验收证据 |
| 用户主动“保留” | 不走临时区 | 按普通附件策略 | 长期留档 |

72 小时是默认平衡点：足够覆盖当天执行、隔日回看与两天内排障，同时不会让高频截图长期累积。若第一阶段不做截图分类，可统一按 3 天过期，后续再引入 7 天失败证据层。

### 3.3 两层过期机制

1. **逻辑过期**：browser-step 事件记录 `expiresAt`。Web 到时间立即停止请求图片，保留步骤标题、时间和状态，缩略图显示“截图已过期”。这样 OSS 生命周期任务尚未物理删除时，产品行为也一致。
2. **物理过期**：OSS Lifecycle 对 `browser-steps-temp/` 前缀执行删除。普通对象 3 天、失败证据 7 天需要分成两个前缀或对象标签规则，例如 `browser-steps-temp/standard/` 与 `browser-steps-temp/evidence/`。

生命周期规则还应清理：

- 未完成的分片上传：1 天后终止。
- 若 Bucket 开启版本控制：非当前版本和删除标记尽快清理，避免删除后仍产生历史版本费用。
- 会话被永久删除时，服务端立即删除该会话的普通附件前缀和 browser-step 临时前缀，不等待 TTL。

OSS Lifecycle 是最终物理兜底，不保证精确到分钟；界面应以 `expiresAt` 为准。

## 四、显示与保留行为

- 右侧面板默认显示仍在有效期内的截图；截图过期不删除步骤事件。
- 下载继续使用短时签名 URL，签名时长和对象 TTL 是两件独立的事。
- 图片 404、解密失败或已过期时，显示统一占位，不让整条步骤消失。
- “保留截图”不是延长临时对象 TTL，而是服务端重新复制到普通附件前缀并更新事件引用；成功后才允许临时对象自然过期。
- 后续可增加会话级“浏览器步骤回显”开关。关闭时 Prompt 不要求截图上报，从源头减少上传和存储成本。

## 五、成本与观测

- Ego 默认使用 JPEG quality 70；PNG 只用于 JPEG 不适合的页面。
- CLI 以 10 MiB 做硬上限；后续可再加最长边 1280–1600 px 的本地缩放，进一步降低存储和下行成本。
- 监控四个指标：每日对象数、每日上传字节、每日下载字节、过期删除对象数。
- 为防异常任务无限截图，后续增加每个 run 的步骤数和总字节预算；超过预算时停止上报并在面板显示原因。

## 六、分阶段实施

### 阶段 A：自动上报 POC（本次）

- 注入 Browser Observation Prompt。
- 复用现有加密附件通道。
- MCP 工具做路径、格式、大小与标签校验。
- 成功后删除本地临时文件，失败则保留。

此阶段的云端截图仍沿用普通附件前缀，不会自动 TTL 删除。

### 阶段 B：临时存储（批准后）

- 附件上传请求增加 `kind: 'browser_step'` 与 retention class。
- 服务端生成独立临时 Key，并校验下载引用必须属于当前会话。
- 事件增加 `stepId`、`runId`、`expiresAt`、`retentionClass`。
- Web 增加过期占位与可选“保留”动作。
- 配置 OSS Lifecycle，并为 local-storage 模式增加定时 GC。
- 会话永久删除逻辑同时清理临时前缀。

### 阶段 C：成本优化（按数据决定）

- 本地缩放、去重、run 级预算与上传采样。
- 根据真实回看率，将默认 TTL 从 72 小时调整为 24 小时或 7 天。

## 七、验收标准

1. 新 Happy 会话无需用户追加 Prompt；Ego 浏览步骤可按顺序实时出现。
2. Codex/Claude 均能调用同一个 `report_browser_step` 工具。
3. 上报失败不会继续静默执行后续步骤；本地证据仍可重试。
4. 阶段 B 上线后，72 小时后的普通截图不再展示，步骤文字仍在。
5. OSS 中临时对象按规则删除，普通会话附件不受影响。
6. 删除会话后，该会话的两类对象都不可再下载。
