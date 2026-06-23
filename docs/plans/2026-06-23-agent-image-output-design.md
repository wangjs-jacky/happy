# 设计文档：让助手输出的图片在对话里渲染

> 日期：2026-06-23
> 目标：让运行在 happy-cli 里的 agent（claude）能把本地生成的图片（如 P 图结果）推送到对话中，在 App 端（手机 / 桌面 / 网页）直接渲染显示。

## 一、背景与问题

### 现状

Happy 里存在**两套互不相通的图片系统**：

| | 用户发的图 | 助手输出的 Markdown 图 |
|---|---|---|
| 渲染组件 | `FileView`（走 `file` 事件） | `RenderImageBlock`（走 Markdown） |
| 传输 | 加密上传服务器 → 下载解密 | 直接把 URL 丢给 RN `<Image>` |
| 认证 / 加密 | ✅ 完整 | ❌ 无 |
| 错误处理 | ✅ 有 | ❌ 静默失败 |
| 跨设备（手机也能看） | ✅ | ❌ 本地路径手机上不存在 |

### 实测结论

在对话中输出 Markdown 图片（本地路径 `/Users/...`、`file://`、网络 URL）**三种全部不渲染**。原因：

1. `RenderImageBlock` 把 URL 原样传给 React Native `<Image>`，不支持本地文件系统路径；
2. 没有认证 / 解密逻辑，拿不到服务器加密附件；
3. 无错误 UI，失败即静默。

这套 Markdown 图片本就只为"公网直链图片"设计，不适合承载本地 / 加密资源。

## 二、设计目标与约束

- **目标**：agent 生成的本地图片，能在对话里以图片形式显示。
- **硬约束**：手机端和桌面端**都要**能看到 → 必须走服务器加密通道，本地文件方案排除。
- **YAGNI**：不动 App 渲染层、不动 Server，最大化复用已验证的通道。

## 三、方案：复用「加密附件通道」

不碰 Markdown 渲染，复用"用户发图"完全相同的 `file` 事件通道：agent 生成图片 → 上传成加密 blob → 发 `file` 事件 → App 端用现成 `FileView` 渲染。

### 数据流

```
agent（claude）P 图完成 → 本地文件 /tmp/result.png
        │  调用 MCP 工具 mcp__happy__send_image(path, caption?)
        ▼
happy-cli 的 Happy MCP server (startHappyServer.ts)
        │  1. 读文件 → 读宽高
        │  2. client.getBlobKey()              [已有]
        │  3. encryptBlob(data, key)           [新增]
        │  4. requestAttachmentUpload(...)     [新增]
        │  5. uploadEncryptedBlob(...)         [新增]
        │  6. createEnvelope('user',{t:'file',ref,...})  [已有]
        │  7. sendSessionProtocolMessage(envelope)       [已有]
        ▼
happy-server（10MB 限制、加密存储、session 所有权校验）   [零改动]
        ▼
App 端：解密 → FileView 渲染                              [零改动]
```

### 为什么 App / Server 零改动

`file` 事件通道是用户发图已经在用的成熟路径：上传加密、下载解密、`FileView` 渲染、缩略图占位、LRU 缓存、错误处理全部现成。CLI 侧只要"生产"一个合法的 `file` 事件，整条下游链路自动工作；agent 输出的图会以内联图片形式出现在对话中。

## 四、改动清单

| 模块 | 改动 | 估量 |
|------|------|------|
| `happy-cli/src/api/encryption.ts` | 新增 `encryptBlob()`（现有 `decryptBlob` 的反向，tweetnacl secretbox） | ~5 行 |
| `happy-cli/src/api/attachmentUpload.ts`（新建） | `requestAttachmentUpload()` + `uploadEncryptedBlob()` | ~40 行 |
| `happy-cli/src/api/apiSession.ts` | `ApiSessionClient.uploadImageAttachment()` + `sendFileEvent()` | ~35 行 |
| `happy-cli/src/claude/utils/startHappyServer.ts` | 注册 MCP 工具 `send_image` | ~30 行 |
| happy-app（手机 / 桌面端） | **零改动** | 0 |
| happy-server | **零改动** | 0 |

**总计约 110 行，全在 happy-cli 一侧。**

### 复用的现成能力（apiSession.ts）

- `getBlobKey()` — blob 加密密钥派生（dataKey / master 两种 variant）
- `createEnvelope()` / `sendSessionProtocolMessage()` — 协议封装与发送
- `enqueueMessage()` + `flushOutbox()` — 加密、批量发送队列
- HTTP（axios）、credentials/token、`configuration.serverUrl`

## 五、触发方式：新增 MCP 工具（方案 A）

沿用现有 `change_title` 的模式（`startHappyServer.ts` 里已注册，且 MCP server 持有 `ApiSessionClient client`）。

```
工具名：send_image
入参：
  - path: string     必填，本地图片绝对路径
  - caption?: string 可选，图片说明
行为：读文件 → 读宽高 → client.uploadImageAttachment() → client.sendFileEvent()
返回：成功/失败文本（与 change_title 一致的 content 结构）
```

调用方（agent）侧表现为 `mcp__happy__send_image`。

**未被采用的备选**（记录备查）：
- B. 监听魔法目录 `~/.happy/outbox/` 自动上传 —— 有竞态、不可控，弃用。
- C. 拦截 agent 输出文本里的 `![](本地路径)` 自动转 file 事件 —— UX 最自然但拦截输出流较脆弱，作为后续可选增强。

## 六、技术细节

### 6.1 encryptBlob（encryption.ts）

与 `decryptBlob` 对称，格式 `[nonce(24B)][ciphertext+authtag]`：

```ts
export function encryptBlob(data: Uint8Array, key: Uint8Array): Uint8Array {
  const nonce = getRandomBytes(tweetnacl.secretbox.nonceLength); // 24
  const box = tweetnacl.secretbox(data, nonce, key);
  const out = new Uint8Array(nonce.length + box.length);
  out.set(nonce); out.set(box, nonce.length);
  return out;
}
```

### 6.2 上传 API（attachmentUpload.ts，新建）

复用 server 现有路由：
- `POST /v1/sessions/{sid}/attachments/request-upload` body `{ filename, size }` → `{ ref, uploadUrl, method, formFields? }`
- 本地存储：`PUT {uploadUrl}` body=加密字节；S3：`POST` + formFields。
- 鉴权 `Authorization: Bearer {token}`。

### 6.3 图片宽高

`FileView` 用 `image.{width,height}` 定布局。CLI 侧读 PNG/JPEG 文件头解析宽高（轻量自实现或 `image-size`），`thumbhash` 占位可先省略（FileView 对缺失要兼容）。

### 6.4 blob key variant

`getBlobKey()` 依据 session 的 `encryptionVariant`（`dataKey` → path `['session']`；legacy → `['master']`）派生，已有逻辑直接用，确保与 App 端解密一致。

## 七、错误处理

- 文件不存在 / 非图片 / 超 10MB → MCP 工具返回 `isError: true` 文本，不抛崩 CLI。
- 上传失败（网络 / 鉴权）→ 捕获并返回错误文本。
- 宽高解析失败 → 退化为不带 `image` 字段的 file 事件（仍作为附件发送，FileView 走非图片分支）。

## 八、测试策略

- **单测**：`encryptBlob` 与 `decryptBlob` round-trip；宽高解析对样例 PNG/JPEG 正确。
- **集成**：起本地 happy-server，调 `uploadImageAttachment` 上传一张测试图，断言 `request-upload` + `PUT` 成功、返回 ref。
- **端到端**（手动）：在真实会话里让 agent 调 `send_image`，确认手机端与桌面端均显示图片。

## 九、验收标准

1. agent 调用 `mcp__happy__send_image(path)` 后，对话中出现该图片。
2. 桌面端**和**手机端都能看到（验证跨设备）。
3. happy-app、happy-server 代码零改动。
4. 失败场景（文件不存在 / 超限）有清晰错误返回，CLI 不崩。
