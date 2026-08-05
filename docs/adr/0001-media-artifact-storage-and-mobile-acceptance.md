# ADR-0001：媒体产物的存储、手机交付与 PR 验收边界

- 状态：**Proposed（讨论中，尚未接受）**
- 日期：2026-08-05
- 影响范围：Paws App、CLI、Server、Web E2E、PR 验收流程、Obsidian 归档
- 关联：PR [#248](https://github.com/wangjs-jacky/happy/pull/248)、`docs/plans/2026-07-12-paws-media-attachments-design.md`
- 决策门：本 ADR 接受前，不把 PR #248 的媒体存储方式视为正式产品决策，也不部署到生产环境

## 1. 背景

Paws 需要让 Agent 生成的 MP4 在当前会话中直接出现在手机端，用户无需回到桌面复制本地路径。同时，Web E2E 的录屏需要成为 PR 中可追溯、可复核的验收证据。

此前的实现把下面几类产物放在同一个讨论中处理，导致“能传到手机”被误当成“长期存储已经设计完成”：

1. 会话附件：用户或 Agent 在聊天中即时交换的图片、音频、视频。
2. PR 验收证据：与 Requirement、Case、commit 绑定，需要在 PR 生命周期内稳定访问的 MP4、截图和报告。
3. 本地工作文件：Playwright、ffmpeg、图像生成工具产生的中间文件或原始文件。
4. 知识归档：Obsidian 中的验收记录、时间码、结论和项目日志。
5. 发布产物：Expo OTA、Web bundle、APK 等可执行发布内容。

这些对象的访问者、生命周期、隐私要求和删除规则不同，不应由调用者直接选择 bucket、object key 或临时 URL，也不应因为它们都是“文件”就共用同一存储语义。

## 2. 当前已核验事实（2026-08-05）

### 2.1 代码与部署

- 产品代码仓库：`wangjs-jacky/happy`。
- OTA 发布脚本也在该 monorepo 中，但“同一个代码仓库”不代表“同一个对象存储桶”。
- 生产 Server 的部署目录为 `/root/happy-server`，它是 Compose/镜像部署目录，不是 Git checkout。
- 手机 MP4 + PR 证据 SOP 位于 `jacky-skills/skills/web-e2e/`；当前相关修改尚未提交，不能视为已接受规范。

### 2.2 当前对象存储

| 用途 | Bucket | 访问属性 | 已存在前缀 |
| --- | --- | --- | --- |
| 会话附件、公共图片、Image Gateway | `happy-attachments-jacky` | private、BlockPublicAccess=true | `sessions/`、`public/`、`image-gateway/` |
| OTA、Web、APK、Expo assets | `happy-app-ota-jacky` | public-read | `updates/`、`manifests/`、`assets/`、`web/`、`apk/` |

两个 bucket 都位于阿里云 OSS `cn-hangzhou`，当前都没有 Lifecycle 规则，也没有启用 OSS Server-Side Encryption。

附件桶当前允许 `AllowedOrigin: *` 的 GET、POST、HEAD CORS。会话删除时，Server 会尝试删除 `sessions/<sessionId>/attachments/` 前缀；删除失败是非致命错误，且未删除的会话没有基于时间的自动过期机制。

### 2.3 当前文件落点

| 产物 | 当前落点 | 说明 |
| --- | --- | --- |
| PR #248 的验收 MP4 | Git 分支中的 `docs/acceptance/native-file-artifacts/paws-native-mp4-card-acceptance.mp4` | 不在 OSS，也不在 Obsidian；若按现状合并会进入 Git 历史 |
| 聊天图片 | `happy-attachments-jacky/sessions/<sessionId>/attachments/<uuid>.enc` | 应用层加密 |
| PR #248 规划的会话 MP4 | `happy-attachments-jacky/sessions/<sessionId>/attachments/<uuid>.mp4` | 明文对象；通过短期 presigned URL 上传、播放 |
| Agent 生成图片的本地归档 | `~/.happy/generated-images/<date>/<batchId>/outputs/` | 另含 prompt 与 manifest；不是手机交付入口 |
| 宿主图像工具原始输出 | 例如 `~/.codex/generated_images/<task-id>/` | 工具运行产物，不保证长期存在 |
| Obsidian | 仅人工复制的笔记或媒体副本 | 产品代码没有自动 fallback 机制 |

### 2.4 已发现的安全语义冲突

`docs/encryption.md` 把“服务器不可见用户内容”列为项目级设计目标。现有聊天图片遵守该目标；旧媒体设计与 PR #248 则允许音视频以明文存入私有 bucket。

“私有 bucket + 15 分钟 presigned URL”控制的是访问权限，不是端到端加密。OSS 管理员、拥有存储凭据的进程以及对象存储服务本身仍能看到媒体内容。因此，明文媒体不能在未经显式产品决策的情况下被描述为等价于现有图片安全模型。

## 3. 决策驱动因素

本 ADR 需要同时满足：

- 手机可达：生成完成后，用户能在当前 Paws 会话中看到文件卡片并播放 MP4。
- PR 可追溯：Requirement → E2E Case → 视频时间码 → commit/PR 能稳定对应。
- 链接稳定：PR 中不得使用本机绝对路径、将被清理的 Playwright 路径或 15 分钟后失效的 presigned URL。
- 隐私明确：会话私有文件与可公开的、已脱敏的验收证据必须有不同访问等级。
- Server-blind 一致性：如果 Paws 继续承诺服务器不可见用户内容，通用 `send_file` 不得默认上传明文媒体。
- 大文件安全：上传与下载需要流式处理；文件上限必须由可信端或上传后校验执行，不能只相信客户端声明。
- 生命周期可控：活跃、已删、孤儿和过期产物都必须有确定的清理规则。
- OTA 隔离：发布产物的公开访问、回滚和缓存语义不能污染会话或验收证据。
- 可恢复：Paws 即时交付失败时仍保留稳定本地文件；降级路径不得被误报成手机已经验收。

## 4. 候选方案

### 方案 A：验收 MP4 继续提交 Git

优点：

- commit 不可变，PR 中引用简单。
- 不需要新服务或新 bucket。

缺点：

- 二进制永久进入 Git 历史，持续增加 clone/fetch 成本。
- 不适合较大或可能包含敏感内容的视频。
- 删除文件不等于从历史中删除。

结论：只适合极小、刻意保留的文档样例，不适合作为默认 E2E 录屏通道。

### 方案 B：验收证据复用 `happy-attachments-jacky`

优点：

- 现有 Paws 文件卡片和 presigned 机制可以直接复用。
- 手机即时播放链路最短。

缺点：

- 会话附件随 Session 删除，和 PR 证据生命周期冲突。
- presigned URL 会过期，不能直接写进 PR。
- 将“聊天中的临时交付”与“工程验收记录”混为一种对象。
- 当前通用媒体明文存储与 Server-blind 目标冲突。

结论：适合作为即时会话交付，不适合作为 PR 证据的唯一事实来源。

### 方案 C：新增独立验收产物存储（建议方向，尚未接受）

候选 bucket 名：`happy-acceptance-artifacts-jacky`。名称、访问策略和保留期仍需讨论，当前不存在，也不得因本 ADR 自动创建。

优点：

- 与会话、OTA 的访问策略和生命周期物理隔离。
- 可以采用 commit/Case 不可变 key，并单独设置 Lifecycle。
- 可为公开脱敏证据和私有证据建立明确规则。
- 不污染 Git 历史。

缺点：

- 需要新增发布、鉴权、清理和审计逻辑。
- 若 bucket 保持 private，PR 需要稳定的鉴权网关，不能直接嵌 presigned URL。
- 若允许公开读取，必须建立强制脱敏检查和清晰的公开范围。

结论：职责最清楚，是本 ADR 的建议方向；具体访问模型必须先确定。

### 方案 D：Obsidian 作为默认传输或事实来源

优点：

- 适合把视频与验收笔记、时间码和决策放在一起。
- 用户已有跨设备同步习惯。

缺点：

- 同步依赖桌面推送与手机拉取，不能证明文件已经到达手机。
- PR reviewer 通常无法访问用户的 Vault。
- Vault 路径、同步状态和冲突处理不是 Paws 产品可以可靠控制的接口。

结论：保留为显式请求下的知识归档，不作为默认交付通道、自动 fallback 或 PR 事实来源。

### 方案 E：混入 `happy-app-ota-jacky`

OTA bucket 是 public-read，承担应用更新、回滚、缓存和版本浏览职责；媒体证据可能是私有数据，清理周期也完全不同。

结论：拒绝。会话附件和验收证据都不得进入 OTA bucket。

## 5. 建议的目标模型

本节是提案，不是已接受决策。

### 5.1 按“用途”而不是扩展名分类

| Artifact class | 事实来源 | 建议存储 | 生命周期 | 默认访问 |
| --- | --- | --- | --- | --- |
| `working` | 当前执行机器 | 稳定本地任务目录 | 任务结束后按策略清理 | 本机 |
| `session` | Paws 会话事件 | `happy-attachments-jacky` | 跟随 Session；另加孤儿清理 | Paws 账户/Session 私有 |
| `acceptance` | Case + commit + manifest | 独立验收存储 | 独立于 Session 和分支 | 按 `private` / `public-sanitized` 分级 |
| `knowledge` | Obsidian 笔记 | Vault Markdown，可选媒体镜像 | 用户知识库策略 | 用户 Vault |
| `release` | 发布流水线 | `happy-app-ota-jacky` | OTA 回滚与发布策略 | public-read |

同一个 MP4 可以有两个不同的 Artifact：

- Session Artifact 用于当前聊天中的即时播放。
- Acceptance Artifact 用于 PR 的稳定证据。

它们可以来自同一份本地字节，但必须各自获得独立的 Artifact ID、访问策略和保留策略，不能把一个临时 URL 同时当成两个角色。

### 5.2 建立统一的 Artifact publication module

在 CLI/E2E 工具与具体存储之间建立一个 seam。调用者只表达：

- 文件路径；
- 用途：`session` 或 `acceptance`；
- 可见性：`private` 或 `public-sanitized`；
- Case、commit、MIME、保留策略等元数据。

module 隐藏 bucket、object key、上传方式、签名 URL、完整性校验和清理实现，并返回统一 receipt：

```ts
type ArtifactReceipt = {
  artifactId: string;
  purpose: 'session' | 'acceptance';
  sha256: string;
  size: number;
  contentType: string;
  stableLocator: string;
  playbackLocator?: string;
  expiresAt?: string;
};
```

建议至少存在两个 Adapter：

- Session Attachment Adapter：写入附件桶，返回 Session 中可重新解析的稳定 ref；播放时获取新的短期 URL。
- Acceptance Artifact Adapter：写入独立验收存储，返回与 commit/Case 绑定的稳定 locator。

Obsidian 和 OTA 不实现这个 Interface：前者是知识记录，后者是发布 module。这样可以避免它们被调用者当作任意文件上传后端。

### 5.3 建议的验收对象结构

以下仅为候选结构：

```text
repos/happy/pulls/<pr-number>/commits/<commit-sha>/cases/<case-id>/
  acceptance.mp4
  poster.webp
  artifact.json
```

`artifact.json` 至少记录：

- schema version；
- repo、PR、commit、Case；
- sha256、字节数、MIME、宽高、帧率、时长；
- E2E spec 与最短复跑命令；
- 创建时间、创建工具；
- 可见性、保留策略、脱敏检查结果；
- 原始 WebM/trace 是否存在及其 locator。

object key 不使用 Session ID、用户名、原始绝对路径或未清洗的文件名。

## 6. 安全与访问提案

### 6.1 Session Artifact

- 附件 bucket 保持 private + BlockPublicAccess。
- App 持有稳定 ref；每次播放由 Server 校验 Session 归属后签发短期 GET URL。
- OSS 开启 Server-Side Encryption，作为应用层加密之外的纵深防御。
- Web CORS 从 `*` 收敛为实际 Paws Web origins；原生 App 不依赖浏览器 CORS。
- 默认维持 Server-blind 目标。通用媒体文件需要在以下方案中选择一个：
  1. 实现分块/流式认证加密；
  2. 第一阶段只允许可整块加密的小文件，并降低上限；
  3. 增加显式“服务器可见的明文大文件”模式、风险提示与用户同意。

在该选择完成前，不应把明文 500MB 媒体作为默认正式能力。

### 6.2 Acceptance Artifact

- 只有经过抽帧检查、确认不包含账号、Session、通知、内部 URL 或其他私密信息的文件，才可标记 `public-sanitized`。
- 私有证据不得为了 PR 展示改成公开对象；PR 应链接到有权限控制的稳定入口，或只写 Artifact ID 与获取方式。
- PR 不直接保存短期 presigned URL。
- MP4 至少满足 H.264、`yuv420p`、`faststart`，并保存 sha256 与 ffprobe 结果。
- 对象默认不可覆盖；同一 Case 新录屏产生新 commit/Artifact ID。

## 7. 生命周期提案

具体天数属于待决项；建议先按以下语义讨论：

| Artifact class | 删除触发 | 兜底清理 |
| --- | --- | --- |
| Session | 用户删除 Session | 定期清理无 Session 引用的孤儿对象 |
| Acceptance / open PR | PR 关闭或合并前不删除 | Lifecycle 只做存储层级转换，不提前删除 |
| Acceptance / merged PR | 达到项目约定保留期 | 保留 manifest；媒体可转低频或归档存储 |
| Acceptance / closed-unmerged PR | 达到较短保留期 | 删除媒体，保留最小审计记录 |
| Local working | Artifact receipt 已确认且任务结束 | 定期清理临时目录；用户指定目录除外 |
| OTA | 由独立 OTA 保留/回滚 ADR 管理 | 不复用本 ADR 的策略 |

删除必须可观测、可重试。当前 Session 删除中的附件清理失败是非致命的，因此需要独立 orphan sweeper 才能形成完整闭环。

## 8. 手机 E2E 与 PR 交付契约

建议固定以下状态，避免把“已生成”误报为“手机已验收”：

```text
local-ready
  → session-published
  → mobile-playback-confirmed
  → acceptance-published
  → pr-linked
```

- `local-ready`：MP4 已生成，绝对路径稳定，媒体校验通过。
- `session-published`：同一文件已成为 Paws 文件卡片；只证明上传成功。
- `mobile-playback-confirmed`：用户或自动化已在手机环境打开并播放。
- `acceptance-published`：已创建独立 Acceptance Artifact 与 manifest。
- `pr-linked`：实际 PR 正文链接已验证，不是本地路径、分支临时 URL 或过期签名。

Obsidian 同步只产生 `knowledge-archived` 辅助状态，不推进上述交付状态。

PR 中至少携带：

- Requirement / Case 对照；
- E2E spec 与最短复跑命令；
- MP4 稳定 locator 和关键时间码；
- Before / After 可见 UI 证据；
- commit、sha256、媒体规格；
- 环境、副作用、清理结果；
- 手机播放是否由用户确认；
- 已知缺口与隐私级别。

## 9. 对 PR #248 与现有 SOP 的影响

在本 ADR 接受前建议：

- PR #248 保持未合并、未部署；现有测试结果只证明交互原型可行。
- 不把当前 Git 中的示例 MP4 当成未来默认存储方案。
- 不发布使用明文媒体车道的正式 CLI/Server。
- `jacky-skills` 中的手机 MP4 SOP 暂不提交；ADR 接受后再同步修改。
- ADR 接受后再决定是重构 PR #248、拆成“文件卡片 UI”和“Artifact 存储”两个 PR，还是关闭后重开。

## 10. 待决项

以下项目需要产品所有者明确接受，不能由实现者默认：

1. 是否接受新增独立 Acceptance Artifact bucket？候选名是否可用？
2. 验收证据默认是 `private`，还是允许经过脱敏检查后成为 `public-sanitized`？
3. open、merged、closed-unmerged PR 的媒体分别保留多久？
4. Session 音视频选择流式 E2E 加密、小文件整块加密，还是显式明文模式？
5. PR reviewer 的稳定入口由 GitHub、Paws 鉴权网关还是独立 Artifact Gateway 提供？
6. 是否要求所有验收 MP4 同时生成 poster、manifest、sha256 和时间码？
7. 当前已提交到 PR #248 的 MP4 是保留为文档样例，还是在合并前从分支历史中移除？
8. 是否为附件 bucket 与 OTA bucket 分别另开 Lifecycle/SSE ADR？

## 11. 验收本 ADR 的完成条件

- 上述 8 个待决项均有明确结论与负责人。
- 状态从 `Proposed` 改为 `Accepted`，记录接受日期。
- PR #248 的实现和 SOP 与接受后的模型一致。
- 真实手机验证覆盖上传、重新签名播放、URL 过期后恢复、Session 删除和 PR 稳定链接。
- 生产配置变更有回滚步骤，且不会把私有媒体写入 OTA bucket。
