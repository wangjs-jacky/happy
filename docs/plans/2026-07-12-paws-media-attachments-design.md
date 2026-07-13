# 设计：Paws 移动端音视频附件支持（v2，含代码级评审修正）

> 让 Paws 手机端能选并上传音频 / 视频文件，终端侧 Claude / Codex 拿到**本地文件路径**后自行用 ffmpeg / whisper 等命令行工具处理。模型不直接读音视频，但能对落盘的本地文件跑工具。

日期：2026-07-12（v2 修订 2026-07-13）· 分支：`media-attachments` · 基于 `main`（已含 PR #185 图片 HEIC 规范化）

> **v2 修订说明**：v1 经 sub-agent 对照真实代码逐条评审，发现 **1 个致命遗漏 + 3 个过时假设**，本版已全部修正。关键变化见 [§0 评审修正摘要](#零v2-评审修正摘要)。

---

## 零、v2 评审修正摘要

| # | v1 说法 | 代码实际 | v2 修正 |
|---|---------|----------|---------|
| **致命** | 终端「流式下载落盘，不占内存」沿用现有链路 | `apiSession.ts:388` `downloadAttachment` 整块 `await response.arrayBuffer()` 进内存，**无任何流式能力**；上层 `PendingAttachment.data: Uint8Array` 也全内存 → **500MB 在 CLI/daemon 侧同样 OOM** | **新增技术核心工作项**：为 `encrypted:false` 附件写独立的 `fetch → Readable.pipeline → createWriteStream` 流式落盘，**不复用** `downloadAndDecryptAttachment`。见 §5.4 |
| 过时① | 「presigned 现仅 POST policy，需新增 PUT 选项」 | `attachmentRoutes.ts:96` 响应 schema 已 `method: enum(['PUT','POST'])`；CLI/App 两端 `UploadDescriptor` 早已双模。只是 **S3 模式当前无条件签 POST**（:140） | 改为「S3 模式下**为音视频分支签发 presigned PUT**」，非从零加 |
| 过时② | 「终端信任 wire 的 `mimeType`」 | App 发 file event 的 `ev` 对象**根本不带 mimeType**（`sync.ts:640-643` 只有 `t/ref/name/size/image`）；CLI 只能 fallback `'image/jpeg'` | 增补：**App 侧 file event 必须新增 `mimeType` 透传**（从 picker 一路带到 `ev`），CLI schema 同步；否则退化为靠 `ev.name` 扩展名判类型 |
| 过时③ | MAX_FILE_SIZE「attachmentRoutes.ts 内多处一致改」 | 漏了 **3 处客户端硬编码**：App `apiAttachments.ts:17`、CLI `apiSession.ts:410`、axios `maxBodyLength`（`attachmentUpload.ts:45`）——500MB 会被 axios 直接拦截 | 列全 4 处；且**音视频不复用 50MB 常量**，图片保留 50MB OOM 保护 |
| 校准 | 第九节引用正则 `(X-Amz-Algorithm\|X-Amz-Signature\|Expires)` | `apiSession.ts:368` 实际含 `X-Amz-Credential\|Signature` | 更新为真实正则（结论方向不变） |
| 降级 | 风险 1「MULTIPART 字段顺序 file 须最后，需实测」 | `attachmentUpload.ts:55` 注释已确认「formFields 先、file 后」load-bearing 且生效 | 从「未决风险」降为「已知约束」 |

---

## 一、目标与非目标

**目标**
- 手机端可以从系统文件选择器 / 相册选择音频、视频文件并上传。
- 音视频文件经阿里云 OSS 中转，终端侧**流式**下载落盘，把**本地路径**注入 prompt，交给 Claude / Codex。
- Claude / Codex 两条路径都支持。

**非目标（本期不做）**
- App 内录音 / 录像（只选已有文件）。
- 让模型"直接"理解音视频内容（由 AI 自行调 ffmpeg / whisper，本期不内置转录）。
- 流式分块加密（音视频走明文，见 §3）。

---

## 二、已确认决策

| 决策点 | 结论 |
|--------|------|
| 中转链路 | 阿里云 OSS（S3 兼容，复用 happy-server 现有 presigned 机制） |
| 上传方式 | 手机直传 OSS，服务端签发一次性 presigned 凭证（S3 模式音视频走 **PUT**，图片保持 POST policy） |
| 附件来源 | 只选已有文件，不录音录像 |
| 路由规则 | **按类型**：图片走现有加密路径（不动）；**音频 / 视频（任意大小）一律走明文流式直传 OSS** |
| 最大体积 | 500MB（音视频专用上限；图片保持 50MB） |
| AI 后端 | Claude + Codex 都支持 |
| 加密模型 | 混合双车道：图片 E2E 加密；音视频明文（私有桶 + 短时效 presigned 保护） |
| **内存模型** | **上传侧（手机）与下载侧（终端）都必须流式**——两侧现有代码都是整块进内存，500MB 双向 OOM |

---

## 三、为什么音视频走明文（关键权衡）

现有端到端加密是**整块 secretbox**，且手机端上传前 `readFileBytes` 先把整文件读成 base64 字符串再 decode（`sync.ts:535` → `readFileBytes.ts:8`）。对一个 500MB 文件，手机内存峰值约为：

```
读成 base64 字符串   ~667MB
decode 成字节        +500MB
加密(含防御性拷贝)    +~1GB
POST 模式再 encodeBase64 写临时文件  +667MB   ← v2 补：uploadFormFile.ts:23 又一份
────────────────────────────
峰值 ≈ 2.6GB → 手机必 OOM
```

流式上传（`expo-file-system` `uploadAsync`，从磁盘直推 OSS）内存恒定、500MB 无压力——但流式无法套用"整块加密"。因此：

- **音视频 → 流式上传 ⟹ 明文**（性能上必须如此）。
- 安全由 **私有桶（不公开读）+ 短时效 presigned URL** 提供，对个人自托管场景足够。
- 图片天然小（客户端限 50MB），继续走现有加密路径，零改动、零风险。

**⚠️ 对称问题（v2 新增）**：终端下载侧现有 `downloadAttachment`（`apiSession.ts:388`）整块 `arrayBuffer`，500MB 在 daemon 里同样 OOM（且可能多会话并发）。**明文不只为上传，也为下载能流式落盘**——密文必须整块读才能解密，明文才能边下边写。

路由按类型而非大小：`kind === 'image'` → 加密路径；`audio` / `video` → 明文流式路径。

---

## 四、架构 / 数据流

### 小车道（图片，现有，原封不动）
```
手机选图 → normalizeImageForUpload → 会话密钥整块加密
  → request-upload 拿 presigned POST → 直传 OSS(密文 .enc)
    → file event {t:'file', ref, encrypted:true, image:{...}}
      → 终端 downloadAndDecryptAttachment → 整块下载 → 解密 → 交模型(base64/localImage)
```

### 大车道（音视频，新增，两侧都流式）
```
手机选音/视频文件 → 不加密 → 带真实 mimeType
  → request-upload 拿 presigned PUT → uploadAsync 从磁盘流式直传 OSS(明文)
    → file event {t:'file', ref, name, size, mimeType, kind:'audio'|'video', encrypted:false}
      → 终端 onFileEvent 分流: encrypted===false
        → 新 streamAttachmentToDisk: fetch(presignedGet).body → pipeline → createWriteStream
          → 落盘到 attachmentsDir/xxx.mp4 (内存恒定)
            → 把「本地路径 + 提示」以文本注入本轮 prompt
              → Claude / Codex 自行跑 ffmpeg / whisper
```

文件字节全程 **手机 ↔ OSS ↔ 终端 直连**，不经过中继服务器（中继只签上传/下载凭证）。两侧内存均恒定。

---

## 五、组件改动

### 1. happy-wire（协议）
`sessionFileEventSchema`（`sessionProtocol.ts:46`）新增可选字段，向后兼容（旧端忽略）：
- `kind?: 'image' | 'audio' | 'video'`
- `encrypted?: boolean`（缺省视为 `true`，兼容历史图片事件）
- `mimeType?: string`（**v2 新增关键**：CLI 类型判定的唯一可信源）

CLI 侧 `FileEventMessageSchema`（`packages/happy-cli/.../types.ts:288`）同步加同样字段，否则 CLI 读不到。

### 2. happy-server（中继）
- 存储后端指向 OSS：部署侧配 `S3_HOST=oss-cn-hangzhou.aliyuncs.com` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET=happy-attachments-jacky` / `S3_REGION=cn-hangzhou` / `S3_PATH_STYLE=false`。
  - `useLocalStorage = !process.env.S3_HOST`（`files.ts:5`）是**全局开关**，配上后所有附件（含图片密文）落 OSS。图片仍是密文，仅存储位置变化，可接受。存量本地图片经 `hasLocalAttachment`（`attachmentRoutes.ts:256`）仍可服务，迁移期混合状态 OK。
- **`MAX_FILE_SIZE` 处理（v2 重排）**：音视频专用 500MB 上限，**不放大图片的 50MB**。服务端 `attachmentRoutes.ts` 的 `MAX_FILE_SIZE`（:19）、错误文案（:125/:200）、body schema `.max()`（:92）需按 `kind` 分流上限，或对音视频单独一套常量。
- **S3 模式为音视频签 presigned PUT**：当前 `attachmentRoutes.ts:140-157` S3 模式无条件走 POST policy。为 `kind∈{audio,video}` 分支改签 `presignedPutObject`。PUT 无法在签名里强制 content-length（:141 注释已述），接受「私有桶 + 限流」。⚠️ `checkUploadRate`（:50）是每进程 60/min，多进程部署形同虚设——**显式记录此 tradeoff**，个人自托管可接受。
- 按需拉长 `PRESIGNED_TTL_SECONDS`（:20，现 15 分钟）；500MB 慢网上传可能不够，实测后定。

### 3. happy-app（移动端）
- 新增"选文件"入口：`expo-document-picker` 选 `audio/*`、`video/*`（图片按钮保持不变；音频相册里没有，必须走 document-picker）。
- `AttachmentPreview` 加 `kind`（+ 可选 `duration`）。
- **上传分流**：`kind==='image'` 走现有加密上传；`audio`/`video` 走新的 `FileSystem.uploadAsync(putUrl, fileUri, {httpMethod:'PUT', uploadType:BINARY_CONTENT, headers:{'Content-Type':mime}})` 流式明文上传。
- **`mimeType` 透传（v2 关键）**：`sync.ts:640-643` 的 file event `ev` 对象当前**不带 mimeType**，必须补上，把 picker 拿到的真实 MIME 一路带到 `ev.mimeType` + `ev.kind` + `ev.encrypted:false`。
- **客户端上限**：`apiAttachments.ts:17` 的 `MAX_FILE_SIZE=50MB` 要为音视频放开到 500MB（图片保留）；axios/上传路径的 `maxBodyLength` 同步。
- 附件卡片：音视频显示"文件名 + 类型图标 + 大小"（无缩略图）；图片保持缩略图。
- iOS/Android 权限：document-picker 一般不需额外权限；如相册视频用 image-picker(videos) 需相册权限。

### 4. happy-cli（终端，核心新逻辑）
- **下载分流（v2 核心）**：`onFileEvent`（`runClaude.ts:497` / `runCodex.ts:522`）当前**无条件** `downloadAndDecryptAttachment`。加分流：
  - `encrypted !== false`（图片）→ 维持现状（整块下载 + 解密）。
  - `encrypted === false`（音视频）→ 走**新函数 `streamAttachmentToDisk(ref, destPath)`**：`fetch(presignedGetUrl)` → `Readable.fromWeb(res.body)` → `pipeline` → `createWriteStream(destPath)`，内存恒定，**绝不 `arrayBuffer`**。落盘到 `attachmentsDir`（保留原扩展名）。
  - 下载 URL 的 presigned 识别沿用 `apiSession.ts:368` 正则 `/[?&](X-Amz-Algorithm|X-Amz-Signature|X-Amz-Credential|Signature|Expires)=/`（带 `X-Amz-*` 命中 → 不加 Bearer）。
  - 客户端上限 `apiSession.ts:410` `MAX_ATTACHMENT_BYTES=50MB` 对音视频放开/跳过。
- **模型侧分流**（`codexImageInput.ts` / `claudeRemoteLauncher.ts`）：
  - **图片**：维持现状（Claude base64 内联 / Codex `localImage`）。现有 magic-byte 嗅探对非 png/jpeg/gif/webp 静默丢弃——音视频**不进这条嗅探链**，避免被丢。
  - **音视频**：① 已由上面 `streamAttachmentToDisk` 落盘；② 把路径以**文本**注入本轮 prompt，例如：
    > `[附件] 用户附带 1 个视频文件，已保存到本地：/Users/.../x.mp4 (video/mp4, 210MB)。你无法直接读取音视频，可用命令行工具处理（ffmpeg 提取信息/抽帧、whisper 等转录）。请按用户需求处理。`
  - Claude 并入 text block；Codex 只进 text（`localImage` 只吃图片）。
  - 类型判定：信任 wire 的 `mimeType`（v2 已确保 App 发送）+ `ev.name` 扩展名，配 `audio/*`、`video/*` 白名单过滤；不靠 magic-byte。
- 排障锚点（沿用图片链路）：会话日志 grep `File event received` / `Attachment decrypted` / `Skipping unsupported attachment`。

---

## 六、错误处理
- 上传失败（OSS 拒绝 / 网络）：手机端沿用现有附件失败计数 + 提示；大文件建议展示进度。
- presigned 过期（超 TTL）：提示重试（会重新签发）。
- **流式下载失败**：`pipeline` reject → 删除半截落盘文件 + 日志，`onFileEvent` 沿用 `pendingDownloads` 返回 null 过滤，不阻断消息。
- 落盘失败 / 非白名单类型：跳过 + 日志，不阻断。

---

## 七、测试
- happy-wire：`kind` / `encrypted` / `mimeType` 字段解析单测 + 旧 file event 向后兼容（缺字段视为 `encrypted:true` 图片）。
- happy-cli：
  - `streamAttachmentToDisk` 单测：给一个 mock presigned GET，断言流式落盘、内存不整块、文件字节一致。
  - 给定一个 audio、一个 video 附件（`encrypted:false`），断言"下载落盘 + prompt 注入了本地路径"，Claude 与 Codex 各一条。
- 手动端到端：OSS 配好后，从 Paws 发一个 mp3 和一个较大 mp4 → 终端确认拿到本地路径 → AI 能 ffmpeg。

---

## 八、风险与实测项（v2 更新）
**必须实测（不看代码无法确定）：**
1. **OSS presigned PUT 大文件**：`presignedPutObject` 签的 PUT URL，App/CLI `fetch/uploadAsync PUT` 明文 500MB 是否成功（minio 8.0.6 + OSS）。v1 只验了 POST/GET，PUT 大文件没实测。
2. **`FileSystem.uploadAsync` 真流式**：现有 App 代码根本没用 `uploadAsync`（走 `fetch(PUT, body=arrayBuffer)`）。实测 `uploadAsync(url, fileUri, {httpMethod:'PUT', uploadType:BINARY_CONTENT})` 对 OSS presigned PUT 是否内存恒定、能否带对 Content-Type。**全新路径，零现成参照。**
3. **终端 Node 流式下载落盘**：`fetch(presignedGet).body` → `pipeline` → `createWriteStream`，实测 500MB 内存平稳、OSS presigned GET 在 Node fetch 下 body 可流式。
4. **daemon 并发内存**：多会话同时下大文件的 daemon 峰值（改流式后应解决）。
5. **PRESIGNED_TTL 15min vs 500MB 慢网**：真机弱网上传耗时是否超 TTL。

**已知约束（非未决）：**
- MULTIPART 表单 `file` 字段须最后（`attachmentUpload.ts:55` 注释已确认，生效中）。
- 配 `S3_HOST` 全局迁 OSS（图片也上，密文，可接受）。
- OSS CORS：web target 直传需桶配 CORS；native（手机）不受限。

---

## 九、已验证事实（打底）
- **OSS 接受 happy-server 的 minio presigned POST/GET**：仓库 `node_modules/minio@8.0.6`、endPoint `oss-cn-hangzhou.aliyuncs.com`、region `cn-hangzhou`、pathStyle:false，对桶 `happy-attachments-jacky` 跑 presigned **POST=204 / PUT=200 / GET round-trip 字节一致**（PUT 为独立小文件测试，大文件明文 PUT 仍需 §8-1 实测）。`content-length-range` 被 OSS 强制。
- **下载侧 presigned 识别**：`apiSession.ts:368` 正则 `/[?&](X-Amz-Algorithm|X-Amz-Signature|X-Amz-Credential|Signature|Expires)=/` 判 presigned 就不加 Bearer；OSS presigned GET 带 `X-Amz-*` 正好命中。
- **PR #185 已合入 main**：`normalizeImageForUpload.ts` / `detectSupportedImageMime.ts` 已在主分支，本分支自动继承，音视频 picker 与其互补、无冲突。
- **PUT/POST 双模协议已存在**：`attachmentRoutes.ts:96` 响应 schema、CLI/App `UploadDescriptor` 均已双模，本期只需在 S3 模式为音视频分支签 PUT。

---

## 十、落地顺序（v2 重排：先音频闭环，再放开大视频）

> v1 一步到位 500MB，把「协议打通」和「大文件流式」两个独立风险耦合。v2 先用**小体积音频**打通端到端闭环，再上大视频以真正暴露/验证流式下载。

0. **配中继 OSS**，用**现有图片附件**端到端验证真链路（纯配置，最小代价证明 app→中继→OSS→cli）。
1. **happy-wire**：加 `kind` / `encrypted` / `mimeType`（含向后兼容单测）+ CLI `types.ts` 同步 schema。
2. **happy-app 发送侧最小改动**：file event 补 `mimeType` / `kind` / `encrypted`（先不加 picker，用现有图片路径验证字段透传）。
3. **happy-cli 核心**：
   - 3a. `streamAttachmentToDisk` 流式下载落盘（**技术核心**，先用一个大文件把 `fetch→stream→落盘` 跑通 + 内存实测）。
   - 3b. 下载分流 + 非图片落盘 + 路径注入（Claude / Codex，含单测）。
4. **happy-app 选择器**：document-picker 选**音频**优先 + 流式 `uploadAsync` PUT + 附件卡片 UI。
5. **音频端到端闭环**：Paws 发 mp3 → 终端确认本地路径 → AI 跑 whisper/ffmpeg。
6. **放开大视频**：500MB mp4 端到端，重点验证两侧流式内存（§8-2/3/4）。
