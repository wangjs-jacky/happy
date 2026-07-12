# 设计：Paws 移动端音视频附件支持

> 让 Paws 手机端能选并上传音频 / 视频文件，终端侧 Claude / Codex 拿到**本地文件路径**后自行用 ffmpeg / whisper 等命令行工具处理。模型不直接读音视频，但能对落盘的本地文件跑工具。

日期：2026-07-12 · 分支：`media-attachments` · 基于 `main`（已含 PR #185 图片 HEIC 规范化）

---

## 一、目标与非目标

**目标**
- 手机端可以从系统文件选择器 / 相册选择音频、视频文件并上传。
- 音视频文件经阿里云 OSS 中转，终端侧下载落盘，把**本地路径**注入 prompt，交给 Claude / Codex。
- Claude / Codex 两条路径都支持。

**非目标（本期不做）**
- App 内录音 / 录像（只选已有文件）。
- 让模型"直接"理解音视频内容（由 AI 自行调 ffmpeg / whisper，本期不内置转录）。
- 流式分块加密（音视频走明文，见下）。

---

## 二、已确认决策

| 决策点 | 结论 |
|--------|------|
| 中转链路 | 阿里云 OSS（S3 兼容，复用 happy-server 现有 presigned 机制） |
| 上传方式 | 手机直传 OSS，服务端签发一次性 presigned 凭证（无需新建 STS 接口） |
| 附件来源 | 只选已有文件，不录音录像 |
| 路由规则 | **按类型**：图片走现有加密路径（不动）；**音频 / 视频（任意大小）一律走明文流式直传 OSS** |
| 最大体积 | 500MB |
| AI 后端 | Claude + Codex 都支持 |
| 加密模型 | 混合双车道：图片 E2E 加密；音视频明文（私有桶 + 短时效 presigned 保护） |

---

## 三、为什么音视频走明文（关键权衡）

现有端到端加密是**整块 secretbox**，且手机端上传前 `readFileBytes` 先把整文件读成 base64 字符串再 decode。对一个 500MB 文件，手机内存峰值约为：

```
读成 base64 字符串   ~667MB
decode 成字节        +500MB
加密(含防御性拷贝)    +~1GB
────────────────────────────
峰值 ≈ 2GB → 手机基本必 OOM
```

`expo-file-system` 的 `uploadAsync` 可以把文件**从磁盘直接流式**推到 OSS，内存恒定、500MB 无压力——但流式上传无法套用"整块加密"。因此：

- **音视频 → 流式上传 ⟹ 明文**（性能上必须如此）。
- 安全由 **私有桶（不公开读）+ 短时效 presigned URL** 提供，对个人自托管场景足够。
- 图片天然小（客户端限 50MB），继续走现有加密路径，零改动、零风险。

路由按类型而非大小：`kind === 'image'` → 加密路径；`audio` / `video` → 明文流式路径。

---

## 四、架构 / 数据流

### 小车道（图片，现有，原封不动）
```
手机选图 → normalizeImageForUpload → 会话密钥整块加密
  → request-upload 拿 presigned POST → 直传 OSS(密文 .enc)
    → file event {t:'file', ref, encrypted:true, image:{...}}
      → 终端 request-download → 下载密文 → 解密 → 交模型(base64/localImage)
```

### 大车道（音视频，新增）
```
手机选音/视频文件 → 不加密
  → request-upload 拿 presigned(PUT 或 POST) → uploadAsync 从磁盘流式直传 OSS(明文)
    → file event {t:'file', ref, kind:'audio'|'video', encrypted:false, mimeType}
      → 终端 request-download → 流式下载落盘(不占内存)
        → 落盘到 attachmentsDir/xxx.mp4
          → 把「本地路径 + 提示」注入本轮 prompt
            → Claude / Codex 自行跑 ffmpeg / whisper
```

文件字节全程 **手机 ↔ OSS ↔ 终端 直连**，不经过中继服务器（中继只签上传/下载凭证）。

---

## 五、组件改动

### 1. happy-wire（协议）
`sessionFileEventSchema` 新增两个可选字段，向后兼容（旧端忽略）：
- `kind?: 'image' | 'audio' | 'video'`
- `encrypted?: boolean`（缺省视为 `true`，兼容历史图片事件）

### 2. happy-server（中继，改动极小）
- 存储后端指向 OSS：部署侧配 `S3_HOST=oss-cn-hangzhou.aliyuncs.com` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET=happy-attachments-jacky` / `S3_REGION=cn-hangzhou` / `S3_PATH_STYLE=false`。
  - 注意：`useLocalStorage = !process.env.S3_HOST` 是**全局开关**，配上后所有附件（含图片）都落 OSS。图片仍是密文，仅存储位置变化，可接受。
- `MAX_FILE_SIZE` 50MB → 500MB（`attachmentRoutes.ts` 内多处常量一致修改）。
- 按需拉长 `PRESIGNED_TTL_SECONDS`（现 15 分钟；500MB 慢网上传可能不够）。
- 为明文流式上传提供 presigned PUT 选项（现仅 POST policy）；PUT 无法在签名里强制 content-length，私有桶 + 限流可接受。**实现时先测 `uploadAsync(MULTIPART)` 能否直接套用现有 POST policy（字段顺序 file 需最后），能则连 PUT 都不用加。**

### 3. happy-app（移动端）
- 新增"选文件"入口：`expo-document-picker` 选 `audio/*`、`video/*`（图片按钮保持不变；音频相册里没有，必须走 document-picker）。
- `AttachmentPreview` 加 `kind`（+ 可选 `duration`）。
- 分流：`kind==='image'` 走现有加密上传；`audio`/`video` 走新的 `uploadAsync` 流式明文上传。
- 上传前带真实 `mimeType`，file event 带 `kind` + `encrypted:false`。
- 附件卡片：音视频显示"文件名 + 类型图标 + 大小"（无缩略图）；图片保持缩略图。
- iOS/Android 权限：文件选择走 document-picker 一般不需额外权限；如相册视频用 image-picker(videos) 需相册权限。

### 4. happy-cli（终端，核心新逻辑）
- 下载分流：file event `encrypted:false` → 直接下载不解密（大文件流式落盘，不整块进内存）；`true` → 走现有解密。
- 模型侧分流（`codexImageInput.ts` / `claudeRemoteLauncher.ts`）：
  - **图片**：维持现状（Claude base64 内联 / Codex `localImage`）。
  - **音视频**：① 落盘到 `attachmentsDir`（保留原扩展名）；② 把路径以**文本**注入本轮 prompt，例如：
    > `[附件] 用户附带 1 个视频文件，已保存到本地：/Users/.../x.mp4 (video/mp4, 210MB)。你无法直接读取音视频，可用命令行工具处理（ffmpeg 提取信息/抽帧、whisper 等转录）。请按用户需求处理。`
  - Claude 并入 text block；Codex 只进 text（`localImage` 只吃图片）。
  - 音视频不靠 magic-byte，信任 wire 的 `mimeType` + 扩展名，配 `audio/*`、`video/*` 白名单过滤。
- 排障锚点（沿用图片链路）：会话日志 grep `File event received` / `Attachment decrypted` / `Skipping unsupported attachment`。

---

## 六、错误处理
- 上传失败（OSS 拒绝 / 网络）：手机端沿用现有附件失败计数 + 提示；大文件建议展示进度。
- presigned 过期（超 TTL）：提示重试（会重新签发）。
- 下载 / 解密失败：CLI 沿用 `pendingDownloads` 返回 null 过滤，不阻断消息。
- 落盘失败 / 非白名单类型：跳过 + 日志，不阻断。

---

## 七、测试
- happy-wire：`kind` / `encrypted` 字段解析单测 + 旧 file event 向后兼容。
- happy-cli：给定一个 audio、一个 video 附件（`encrypted:false`），断言"下载落盘 + prompt 注入了本地路径"，Claude 与 Codex 各一条。
- 手动端到端：OSS 配好后，从 Paws 发一个 mp3 和一个较大 mp4 → 终端确认拿到本地路径 → AI 能 ffmpeg。

---

## 八、风险与实测项
1. **`uploadAsync` 与 OSS presigned 的字段兼容性**：MULTIPART 模式的表单字段顺序（`file` 须最后）需实测；不行则退 presigned PUT + BINARY_CONTENT。
2. **presigned TTL vs 大文件慢网**：500MB 上传可能超 15 分钟，需实测并按需拉长 TTL。
3. **全局存储开关**：配 `S3_HOST` 会把图片也迁到 OSS；若要"图片仍留本地、仅音视频上 OSS"，需把存储后端改成按附件选择（更大改动，本期不做）。
4. **OSS CORS**：happy-app web target 直传需桶配 CORS；native（手机）不受限。

---

## 九、已验证事实（打底）
- **OSS 接受 happy-server 的 minio presigned**：用仓库 `node_modules/minio@8.0.6`、endPoint `oss-cn-hangzhou.aliyuncs.com`、region `cn-hangzhou`、pathStyle:false，对桶 `happy-attachments-jacky` 跑 presigned **POST=204 / PUT=200 / GET round-trip 字节一致** 全过。`content-length-range` 被 OSS 强制。
- **下载侧 presigned 识别**：`apiSession.ts` 用正则 `[?&](X-Amz-Algorithm|X-Amz-Signature|Expires)=` 判 presigned 就不加 Bearer；OSS presigned GET 带 `X-Amz-*` 正好命中。
- **PR #185 已合入 main**：`normalizeImageForUpload.ts` / `detectSupportedImageMime.ts` 已在主分支，本分支自动继承，音视频 picker 与其互补、无冲突。

---

## 十、落地顺序
0. 配中继 OSS，用**现有图片附件**端到端验证真链路（纯配置，最小代价证明 app→中继→OSS→cli）。
1. happy-wire 加 `kind` / `encrypted`（含向后兼容单测）。
2. happy-cli 核心：下载分流 + 非图片落盘 + 路径注入（Claude / Codex，含单测）。
3. happy-app：document-picker 选音视频 + 分流上传 + 附件卡片 UI。
4. 端到端：Paws 发 mp3 / 大 mp4 → 终端确认路径 → AI ffmpeg。
