# ADR-0001：Paws 临时验收视频的存储与手机交付

- 状态：**Proposed — 待用户确认功能清单**
- 提案日期：2026-08-05
- 影响范围：Paws App、CLI、Server、Web E2E、PR 验收流程
- 关联实现原型：PR [#248](https://github.com/wangjs-jacky/happy/pull/248)
- 核心原则：验收视频是临时的会话产物，不是 Git 文档、长期 PR 附件或 OTA 发布资源

## 1. 需求

用户主要在手机上编码和验收。当 Agent 修复 PC Web Bug 并完成 E2E 后，用户需要直接在当前 Paws 对话中看到并播放录制的 MP4，以确认交互是否符合预期。

必须满足：

- 对话中出现明确的 Video 对象，而不是只输出本机路径。
- MP4 不进入 Git commit、Git LFS 或仓库历史。
- 终端本地文件能够跨端到达手机。
- 大文件不占用 Paws Server 的磁盘，也不经过 Server 代理传输。
- 视频是临时验收文件，应自动清理。
- 当前阶段以功能闭环为优先；脱敏、端到端加密和进一步安全加固另开专题。

## 2. 推荐方案（待决策）

本节目前是推荐方案，不代表已经批准实施。PR #249 保持 Draft；在用户确认第 9 节之前，不创建 bucket、不修改生产配置，也不合并或重写 PR #248。

### 2.0 待确认的实现功能

| ID | 分类 | 要实现的功能 | 可验收结果 |
| --- | --- | --- | --- |
| VIDEO-001 | 产品能力 | Playwright 通过后生成 H.264、`yuv420p`、`faststart` 的最终 MP4，并完成 `ffprobe` 与完整解码校验 | 不合格或失败过程的视频不会发布 |
| VIDEO-002 | 产品能力 | CLI/MCP 提供单一 `publishAcceptanceVideo` 入口，只接受 MP4，并把最终文件归一化到仓库外目录 | 调用者不接触 bucket、签名 URL 或 object key |
| VIDEO-003 | 产品能力 | Server 鉴权并签发 PUT/GET URL；CLI 直传 OSS，手机直读 OSS | Server 不代理视频字节、不占用 ECS 文件盘 |
| VIDEO-004 | 产品能力 | 当前对话写入 Video 事件；App 显示内联播放器、文件名、大小和有效期 | 手机可播放、暂停、拖动进度 |
| VIDEO-005 | 产品能力 | 播放 URL 过期时自动刷新一次；对象已清理时显示“验收视频已过期” | 不出现永久 loading，也不要求重新跑 E2E |
| VIDEO-006 | 清理能力 | 本地最终 MP4 保留 24 小时；发布时和 daemon 启动时清理过期文件 | 本地临时目录不会无限增长 |
| VIDEO-007 | 清理能力 | OSS Lifecycle 在 7 天后删除；删除 Session 时 best-effort 清理对应前缀 | 云端临时视频不会长期累积 |
| VIDEO-008 | Git 强制门禁 | 最终 MP4 固定写到仓库外；`.gitignore` 忽略视频；CI 扫描所有 Git tracked 视频扩展并阻止 PR 合并 | `*.mp4`、`*.mov`、`*.m4v`、`*.webm` 不能进入仓库历史 |
| VIDEO-009 | 回归能力 | 覆盖上传、Video 事件、播放器、URL 刷新、过期态、本地清理、Lifecycle 配置和 Session 删除的自动化测试 | 核心链路可重复回归，不依赖口头确认 |
| VIDEO-010 | 历史修复 | 基于干净 `main` 重建 PR #248 的实现提交，不保留其已提交 MP4 的旧 commit | #248 分支历史本身不再包含视频 blob |

以下是**流程规范**，不是产品功能，也不能替代上面的技术门禁：

- PR 只记录 Case、E2E 命令、Video ID、时长、有效期和手机确认状态。
- PR 不记录本机绝对路径、临时签名 URL 或视频二进制。
- Obsidian 不参与交付；脱敏与额外安全加固继续作为独立专题。

### 2.1 独立临时视频 bucket

创建独立阿里云 OSS bucket：

```text
happy-acceptance-video-jacky
```

该 bucket 只存最终验收 MP4，不存：

- 图片；
- Playwright trace/report；
- 原始 WebM；
- 音频或其他通用附件；
- `artifact.json` 等额外文件；
- OTA、Web bundle 或 APK。

视频元数据保存在 Paws 会话的 Video 事件中，不为每个视频额外创建 manifest 对象。

### 2.2 存储与传输路径

```text
Playwright E2E 通过
  → 生成/转码最终 MP4
  → 保存到终端临时稳定目录
  → CLI 请求 Paws Server 签发 OSS PUT URL
  → CLI 直接上传到 OSS
  → Paws 会话写入 Video 事件
  → 手机 App 请求短期 OSS GET URL
  → 在对话中直接播放
```

文件字节走：

```text
终端 ↔ OSS ↔ 手机
```

Paws Server 只负责鉴权、签发 URL 和同步 Video 事件，不代理 MP4 字节，也不把视频写入 ECS 本地磁盘。

### 2.3 OSS object key

```text
sessions/<sessionId>/<videoId>.mp4
```

- `videoId` 使用随机 UUID。
- 不使用原始文件名作为 object key。
- 不创建按 PR 永久保存的目录。
- Session 删除时可直接清理整个 Session 前缀。

### 2.4 Paws Video 对象

当前需求只增加 Video 对象，不扩展成通用文件平台。最小事件信息为：

```ts
type AcceptanceVideo = {
  id: string;
  type: 'video';
  ref: string;
  name: string;
  size: number;
  mimeType: 'video/mp4';
  durationMs?: number;
  createdAt: number;
  expiresAt: number;
};
```

App 行为：

- 对话中显示文件名、大小、有效期和视频播放器。
- 播放时根据 `ref` 向 Paws Server 请求新的短期 GET URL。
- 支持 OSS Range 请求，以便播放和拖动进度。
- URL 过期时自动重新请求一次，而不是要求用户重新生成视频。
- 对象已被 Lifecycle 删除时，卡片保留并显示“验收视频已过期”。

### 2.5 小而深的发布 interface

Agent/测试流程只需要调用一个 interface：

```ts
publishAcceptanceVideo({ path, name?, durationMs? }): Promise<AcceptanceVideo>
```

调用者不需要知道 bucket、object key、presigned URL、上传实现或清理机制。该 module 内部完成：

- 校验 MP4；
- 读取文件大小；
- 获取上传 URL；
- 直接上传 OSS；
- 写入 Video 事件；
- 返回可显示的 Video 对象；
- 触发本地过期文件清理。

当前 MCP 可以继续暴露 `send_file` 名称以兼容 PR #248，但本阶段只接受合格的 MP4，并在内部调用这个 interface。音频和任意文件留到独立需求再设计。

## 3. 临时文件与自动清理

### 3.1 终端本地文件

最终 MP4 固定写到仓库外：

```text
~/.happy/acceptance-videos/<sessionId>/<videoId>.mp4
```

规则：

- Playwright 原始 WebM 在 MP4 转码和完整解码验证通过后删除。
- 最终 MP4 上传成功后本地保留 24 小时，便于上传失败重试或桌面复核。
- CLI 每次发布视频和 daemon 启动时，清理该目录中超过 24 小时的 MP4。
- 上传失败时不删除本地 MP4，并在回复中输出绝对路径。
- 该目录位于 Git 仓库外，不从 `docs/`、`test-results/` 或其他仓库目录发布最终文件。

终端没有可依赖的、跨设备通用视频内联能力。桌面终端最多调用系统播放器打开本地路径；手机验收必须依靠 Paws Video 对象。

### 3.2 OSS 文件

- Bucket Lifecycle：对象创建满 **7 天自动删除**。
- Session 在 7 天内被删除时，Server 尝试立即删除 `sessions/<sessionId>/`。
- Lifecycle 是最终兜底，避免 Session 清理失败留下大文件。
- Video 事件中的 `expiresAt` 固定为上传完成时间加 7 天。
- 不提供“永久保留”开关；如未来确有长期视频归档需求，另开设计。

## 4. 文件与播放规格

- 容器：MP4。
- 视频：H.264。
- 像素格式：`yuv420p`。
- 布局：`faststart`。
- 默认静音；声音本身属于验收目标时才保留。
- 建议分辨率：1280×720，25/30 fps。
- 单文件上限：500MB。
- 上传 URL 有效期：1 小时。
- 播放 URL 有效期：1 小时，App 可以按需刷新。

上传前必须：

1. `ffprobe` 检查格式、时长、分辨率和体积。
2. `ffmpeg -v error -i <file> -f null -` 完整解码成功。
3. E2E Case 本身已经通过；不上传失败或中断过程的视频充当验收结果。

## 5. Git 与 PR 规则

### 5.1 Git

“不进入 Git”必须由实现门禁保证，不能只依赖开发者记住规则：

1. 发布 interface 把最终 MP4 固定写入 `~/.happy/acceptance-videos/`，不允许把仓库内的 `docs/`、`test-results/` 等路径作为最终稳定目录。
2. 根 `.gitignore` 增加 `*.mp4`、`*.mov`、`*.m4v`、`*.webm`，降低普通 `git add` 误提交概率。
3. 新增仓库脚本 `check:no-tracked-videos`，基于 `git ls-files` 扫描上述扩展；发现任何 tracked 视频就以非零状态退出。
4. GitHub Actions 的必过检查执行该脚本。因此 `.gitignore` 只做第一层提示，CI 才是防止 `git add -f`、已跟踪文件或误操作进入主分支的强制门禁。
5. 当前不设置视频 allowlist。未来如产品确实需要仓库内视频资产，必须单独修改 ADR 和检查器，不通过临时例外绕过。
6. 不使用 Git LFS；删除后仍存在于历史的提交仍视为不合格。
7. PR #248 中已经提交的 MP4 必须通过基于干净 `main` 重建提交的方式从分支历史移除，不能只追加一个删除 commit。

Git 中可以保留 E2E spec、实现源码、测试代码、文本结果和按现有视觉门禁要求提交的 PNG/JPEG Before/After 截图。

### 5.2 PR

PR 正文记录：

- Case ID 与结果；
- E2E spec 和最短复跑命令；
- Paws 会话中的 Video ID；
- 视频文件名、时长和 `expiresAt`；
- 用户是否已在手机播放确认。

PR 不保存：

- MP4 二进制；
- 本机绝对路径；
- 即将过期的 presigned URL。

视频的事实来源是当前 Paws 会话中的临时 Video 对象。PR 只记录验收结果和临时 Video ID，不承诺视频在 PR 历史中永久可播放。

## 6. 与其他存储的关系

| 存储 | 本需求是否使用 | 原因 |
| --- | --- | --- |
| `happy-acceptance-video-jacky` | 是 | 临时 MP4，7 天自动清理 |
| `happy-attachments-jacky` | 否 | 保持现有聊天图片/附件职责，不混入验收视频 |
| `happy-app-ota-jacky` | 否 | 只用于 OTA、Web、APK 和发布资源 |
| Git / Git LFS | 否 | 视频不能进入提交历史 |
| Obsidian | 否 | 当前不需要额外归档或同步链路 |
| ECS 本地磁盘 | 否 | Server 不代理或持久化视频字节 |

## 7. 当前明确不做

以下内容不阻塞功能实现，后续按独立专题处理：

- 视频脱敏流程；
- 流式端到端加密；
- OSS Server-Side Encryption、KMS 和细粒度审计；
- 对外公开的永久 PR 视频链接；
- 音频、PDF、压缩包等通用文件对象；
- 永久视频归档；
- OTA bucket 的历史清理。

当前实现采用独立 bucket、短期签名 URL 和明文 MP4，以换取最短的跨端播放闭环。该取舍只适用于临时 E2E 验收视频，不自动扩展到用户上传的通用媒体。

## 8. 实现验收条件

- E2E 通过后能生成符合规格的 MP4。
- MP4 的最终路径始终位于 `~/.happy/acceptance-videos/`，Git 变更中不存在视频。
- CLI 直接上传 OSS；Paws Server 的磁盘和代理流量不随视频体积增加。
- 当前会话出现 Video 对象，手机端能够播放并拖动进度。
- 播放 URL 过期后可自动刷新。
- 视频过期后显示明确状态，不出现无限 loading。
- 本地 24 小时清理和 OSS 7 天 Lifecycle 均有自动化验证。
- 删除 Session 会触发对应视频前缀清理。
- PR #248 的 MP4 已从分支历史移除。
- PR 记录 Case、结果、Video ID、有效期和手机确认状态，但不携带视频二进制。

## 9. 用户确认闸门

以下选择在 PR #249 中保持“待确认”，未确认前不开始运行时代码和基础设施实施：

| 确认项 | 推荐值 | 当前状态 |
| --- | --- | --- |
| 独立 bucket | `happy-acceptance-video-jacky`，不与 attachments/OTA 混用 | 待确认 |
| 文件类型 | 只接受最终 MP4，不做通用附件 | 待确认 |
| 传输方式 | CLI 直传 OSS、手机直读 OSS，Server 只签名 | 待确认 |
| 本地保留期 | 24 小时 | 待确认 |
| OSS 保留期 | 7 天 | 待确认 |
| 单文件上限 | 500MB | 待确认 |
| Git 强制门禁 | `.gitignore` + `git ls-files` CI 检查，无 allowlist | 待确认 |
| PR 记录内容 | 只记 Case/结果/Video ID/时长/有效期/手机状态 | 待确认 |
| #248 处理 | 从干净 `main` 重建实现历史，移除视频 blob 后再评审 | 待确认 |
| 安全范围 | 当前只做私有 bucket 与短期签名 URL；脱敏、E2EE、KMS 另开专题 | 待确认 |

用户确认这组默认值后，ADR 才改为 `Accepted`；随后按 `VIDEO-001` 至 `VIDEO-010` 实施和验收。
