# 助手输出图片对话内渲染 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让运行在 happy-cli 里的 agent（claude/gemini）能把本地图片通过新增的 `send_image` MCP 工具推送到对话，在 App 端（手机/桌面/网页）内联渲染。

**Architecture:** 复用「用户发图」已验证的加密附件通道——读文件 → `encryptBlob` → `request-upload` 拿 ref → 上传加密 blob → 发 `t:'file'` 的 SessionEnvelope。App 端现成的 `FileView` 自动渲染，happy-app 与 happy-server 零改动。触发用 MCP 工具（沿用 `change_title` 模式）。

**Tech Stack:** TypeScript / Node、tweetnacl（secretbox 加密，已用）、axios（HTTP，已用）、@modelcontextprotocol/sdk（MCP，已用）、@slopus/happy-wire（`createEnvelope`）、vitest（测试）。

**关键约束（已在源码核实）:**
- `sessionFileEventSchema`（`packages/happy-wire/src/sessionProtocol.ts:46`）中 `image.thumbhash` 为**必填** `z.string()`。`createEnvelope` 会 `sessionEnvelopeSchema.parse()` 校验，故 **MVP 省略整个 `image` 字段**（schema 中 `image` 整体 `.optional()`）。
- `FileView`（`packages/happy-app/sources/components/tools/views/FileView.tsx:52-58`）对缺失 `image{}` 用 `DEFAULT_ASPECT = 4/3` 仍内联渲染图片，故省略 image 不影响"显示为图片"。
- blob 加密格式 `[nonce(24)][secretbox]`，与 app 端 `packages/happy-app/sources/encryption/blob.ts` 的 `encryptBlob` 一致；CLI 端 `decryptBlob` 已存在（`packages/happy-cli/src/api/encryption.ts`）。
- blob key 由 `ApiSessionClient.getBlobKey()`（`apiSession.ts:278`）派生，已有。
- `startHappyServer(client: ApiSessionClient)` 被 `runClaude.ts:349` 与 `runGemini.ts:505` 复用，在此注册工具即对两种 agent 同时生效。
- server `request-upload` 响应 `{ ref, uploadUrl, method: 'PUT'|'POST', formFields? }`（`packages/happy-server/sources/app/api/routes/attachmentRoutes.ts:77`）；本地存储为 `PUT`，S3 为 `POST` + formFields。

**测试命令前缀:** 所有命令在 `packages/happy-cli/` 目录下执行。单测：`npx vitest run --project unit <file>`。

---

### Task 1: CLI 端 `encryptBlob`

**Files:**
- Modify: `packages/happy-cli/src/api/encryption.ts`（在 `decryptBlob` 之后追加）
- Test: `packages/happy-cli/src/api/encryption.test.ts`（若不存在则 Create）

**Step 1: 写失败测试**

在 `encryption.test.ts` 追加（顶部确保 `import { encryptBlob, decryptBlob, getRandomBytes } from './encryption'`）：

```ts
import { describe, it, expect } from 'vitest';
import { encryptBlob, decryptBlob, getRandomBytes } from './encryption';

describe('encryptBlob', () => {
  it('round-trips with decryptBlob', () => {
    const key = getRandomBytes(32);
    const data = new Uint8Array([1, 2, 3, 4, 5, 250, 0, 99]);
    const bundle = encryptBlob(data, key);
    // 格式：nonce(24) + ciphertext(>=data+16)
    expect(bundle.length).toBeGreaterThanOrEqual(24 + data.length + 16);
    const out = decryptBlob(bundle, key);
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual(Array.from(data));
  });

  it('fails to decrypt with a wrong key', () => {
    const data = new Uint8Array([9, 9, 9]);
    const bundle = encryptBlob(data, getRandomBytes(32));
    expect(decryptBlob(bundle, getRandomBytes(32))).toBeNull();
  });
});
```

**Step 2: 运行确认失败**

Run: `npx vitest run --project unit src/api/encryption.test.ts`
Expected: FAIL（`encryptBlob is not a function` / 未导出）

**Step 3: 最小实现**

在 `encryption.ts` 的 `decryptBlob` 函数后追加：

```ts
/**
 * Encrypt a binary blob with NaCl crypto_secretbox (XSalsa20-Poly1305).
 * Wire format: [nonce (24 bytes)] [ciphertext + auth tag].
 * Mirror of decryptBlob; matches the app-side encryptBlob() in
 * packages/happy-app/sources/encryption/blob.ts.
 */
export function encryptBlob(data: Uint8Array, key: Uint8Array): Uint8Array {
  const nonce = getRandomBytes(tweetnacl.secretbox.nonceLength); // 24
  const box = tweetnacl.secretbox(data, nonce, key);
  const out = new Uint8Array(nonce.length + box.length);
  out.set(nonce, 0);
  out.set(box, nonce.length);
  return out;
}
```

**Step 4: 运行确认通过**

Run: `npx vitest run --project unit src/api/encryption.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add packages/happy-cli/src/api/encryption.ts packages/happy-cli/src/api/encryption.test.ts
git commit -m "feat(cli): add encryptBlob for attachment upload"
```

---

### Task 2: 附件上传辅助模块

**Files:**
- Create: `packages/happy-cli/src/api/attachmentUpload.ts`
- Test: `packages/happy-cli/src/api/attachmentUpload.test.ts`

**Step 1: 写失败测试**（mock axios）

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { requestAttachmentUpload, uploadEncryptedBlob } from './attachmentUpload';

vi.mock('axios');
const mockedAxios = axios as unknown as { post: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

beforeEach(() => {
  mockedAxios.post = vi.fn();
  mockedAxios.put = vi.fn();
});

describe('requestAttachmentUpload', () => {
  it('POSTs filename/size with bearer token and returns the upload descriptor', async () => {
    mockedAxios.post.mockResolvedValue({ data: { ref: 'sessions/s1/attachments/x.enc', uploadUrl: 'http://srv/up', method: 'PUT' } });
    const res = await requestAttachmentUpload('http://srv', 'tok', 's1', 'pic.png', 123);
    expect(res.ref).toBe('sessions/s1/attachments/x.enc');
    expect(res.method).toBe('PUT');
    const [url, body, cfg] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('http://srv/v1/sessions/s1/attachments/request-upload');
    expect(body).toEqual({ filename: 'pic.png', size: 123 });
    expect(cfg.headers.Authorization).toBe('Bearer tok');
  });
});

describe('uploadEncryptedBlob', () => {
  it('PUTs raw bytes to uploadUrl with bearer token for local-storage mode', async () => {
    mockedAxios.put.mockResolvedValue({ status: 200 });
    const bytes = new Uint8Array([1, 2, 3]);
    await uploadEncryptedBlob({ ref: 'r', uploadUrl: 'http://srv/up', method: 'PUT' }, bytes, 'tok');
    const [url, data, cfg] = mockedAxios.put.mock.calls[0];
    expect(url).toBe('http://srv/up');
    expect(data).toBe(bytes);
    expect(cfg.headers.Authorization).toBe('Bearer tok');
    expect(cfg.headers['Content-Type']).toBe('application/octet-stream');
  });

  it('throws on non-2xx', async () => {
    mockedAxios.put.mockResolvedValue({ status: 500 });
    await expect(
      uploadEncryptedBlob({ ref: 'r', uploadUrl: 'http://srv/up', method: 'PUT' }, new Uint8Array([1]), 'tok'),
    ).rejects.toThrow();
  });
});
```

**Step 2: 运行确认失败**

Run: `npx vitest run --project unit src/api/attachmentUpload.test.ts`
Expected: FAIL（模块不存在）

**Step 3: 最小实现**

```ts
// packages/happy-cli/src/api/attachmentUpload.ts
import axios from 'axios';

export interface UploadDescriptor {
  ref: string;
  uploadUrl: string;
  method: 'PUT' | 'POST';
  formFields?: Record<string, string>;
}

/**
 * Ask the server for an upload slot. Mirrors the app-side request-upload call.
 * Returns the ref (stable id used in the file event) and where to PUT/POST the
 * encrypted bytes.
 */
export async function requestAttachmentUpload(
  serverUrl: string,
  token: string,
  sessionId: string,
  filename: string,
  size: number,
): Promise<UploadDescriptor> {
  const url = `${serverUrl}/v1/sessions/${sessionId}/attachments/request-upload`;
  const res = await axios.post(
    url,
    { filename, size },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 30000 },
  );
  return res.data as UploadDescriptor;
}

/**
 * Upload the already-encrypted blob. Local-storage mode is a plain PUT to our
 * own server (Bearer required); S3 mode is a presigned POST with formFields and
 * does NOT take an auth header.
 */
export async function uploadEncryptedBlob(
  descriptor: UploadDescriptor,
  encrypted: Uint8Array,
  token: string,
): Promise<void> {
  if (descriptor.method === 'PUT') {
    const res = await axios.put(descriptor.uploadUrl, encrypted, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      timeout: 60000,
      maxContentLength: 10 * 1024 * 1024,
      maxBodyLength: 10 * 1024 * 1024,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`attachment PUT failed: ${res.status}`);
    }
    return;
  }
  // POST (S3 presigned): multipart form with formFields + file.
  const form = new FormData();
  for (const [k, v] of Object.entries(descriptor.formFields ?? {})) {
    form.append(k, v);
  }
  form.append('file', new Blob([encrypted]));
  const res = await axios.post(descriptor.uploadUrl, form, {
    timeout: 60000,
    maxContentLength: 10 * 1024 * 1024,
    maxBodyLength: 10 * 1024 * 1024,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`attachment POST failed: ${res.status}`);
  }
}
```

**Step 4: 运行确认通过**

Run: `npx vitest run --project unit src/api/attachmentUpload.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add packages/happy-cli/src/api/attachmentUpload.ts packages/happy-cli/src/api/attachmentUpload.test.ts
git commit -m "feat(cli): add attachment upload helpers (request-upload + PUT/POST)"
```

---

### Task 3: `ApiSessionClient.uploadImageAttachment` + `sendFileEvent`

**Files:**
- Modify: `packages/happy-cli/src/api/apiSession.ts`（类内新增两个方法；顶部确保 import）

**说明:** 这两个方法依赖网络/socket，单测价值低、成本高 → 不写单测，由 Task 6 端到端验证。仅做 `npx tsc --noEmit` 类型校验。

**Step 1: 加 imports**

在 `apiSession.ts` 顶部 import 区追加（与现有风格一致）：

```ts
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createEnvelope } from '@slopus/happy-wire';
import { encryptBlob } from '@/api/encryption';
import { requestAttachmentUpload, uploadEncryptedBlob } from '@/api/attachmentUpload';
```

> 注：`encodeBase64`/`decryptBlob` 等已从 `./encryption` 导入，按文件现有相对/别名风格调整 import 路径，避免重复导入。

**Step 2: 在 `ApiSessionClient` 类中新增方法**（放在 `downloadAndDecryptAttachment` 附近）：

```ts
/**
 * Encrypt + upload a local image file via the attachment channel, returning the
 * server ref. Reuses getBlobKey() so the app can decrypt with the same session
 * blob key. Throws on read/encrypt/upload failure.
 */
async uploadImageAttachment(filePath: string): Promise<{ ref: string; name: string; size: number }> {
  const raw = new Uint8Array(readFileSync(filePath));
  const name = basename(filePath);
  const key = await this.getBlobKey();
  const encrypted = encryptBlob(raw, key);
  const descriptor = await requestAttachmentUpload(
    configuration.serverUrl,
    this.token,
    this.sessionId,
    name,
    encrypted.length,
  );
  await uploadEncryptedBlob(descriptor, encrypted, this.token);
  return { ref: descriptor.ref, name, size: raw.length };
}

/**
 * Emit a file event so the app renders the uploaded attachment inline (FileView).
 * image{} is intentionally omitted: the wire schema requires image.thumbhash,
 * which we don't compute here; FileView falls back to a 4:3 inline render.
 * Use role 'user' to match the proven user-attachment path.
 */
sendFileEvent(ref: string, name: string, size: number): void {
  const envelope = createEnvelope('user', { t: 'file', ref, name, size });
  this.sendSessionProtocolMessage(envelope);
}
```

**Step 3: 类型校验**

Run: `cd packages/happy-cli && npx tsc --noEmit`
Expected: 无新增类型错误（注意 `configuration` 已在文件内被引用，沿用同一引用）。

**Step 4: 提交**

```bash
git add packages/happy-cli/src/api/apiSession.ts
git commit -m "feat(cli): ApiSessionClient.uploadImageAttachment + sendFileEvent"
```

---

### Task 4: 注册 `send_image` MCP 工具

**Files:**
- Modify: `packages/happy-cli/src/claude/utils/startHappyServer.ts`

**Step 1: 扩展 `createMcpServer` 以接收 image handler**

把 `createMcpServer` 的签名从只接收 title handler 改为接收一个 handlers 对象（保持 `change_title` 不变）：

```ts
type HappyMcpHandlers = {
  changeTitle: (title: string) => Promise<{ success: boolean; error?: string }>;
  sendImage: (path: string, caption?: string) => Promise<{ success: boolean; error?: string }>;
};

function createMcpServer(handlers: HappyMcpHandlers): McpServer {
  const mcp = new McpServer({ name: 'Happy MCP', version: '1.0.0' });

  mcp.registerTool('change_title', {
    description: 'Change the title of the current chat session',
    title: 'Change Chat Title',
    inputSchema: { title: z.string().describe('The new title for the chat session') },
  }, async (args) => {
    const response = await handlers.changeTitle(args.title);
    return response.success
      ? { content: [{ type: 'text', text: `Successfully changed chat title to: "${args.title}"` }], isError: false }
      : { content: [{ type: 'text', text: `Failed to change chat title: ${response.error || 'Unknown error'}` }], isError: true };
  });

  mcp.registerTool('send_image', {
    description: 'Send a local image file into the current chat so the user sees it inline (works on phone and desktop). Use after generating or editing an image. Provide an absolute path to a PNG/JPEG.',
    title: 'Send Image To Chat',
    inputSchema: {
      path: z.string().describe('Absolute path to the local image file (PNG/JPEG)'),
      caption: z.string().optional().describe('Optional caption shown with the image'),
    },
  }, async (args) => {
    const response = await handlers.sendImage(args.path, args.caption);
    return response.success
      ? { content: [{ type: 'text', text: `Sent image to chat: ${args.path}` }], isError: false }
      : { content: [{ type: 'text', text: `Failed to send image: ${response.error || 'Unknown error'}` }], isError: true };
  });

  return mcp;
}
```

**Step 2: 在 `startHappyServer` 里实现 `sendImage` handler 并改用 handlers 对象**

替换原 `const handler = ...` 为：

```ts
const handlers: HappyMcpHandlers = {
  changeTitle: async (title: string) => {
    logger.debug('[happyMCP] Changing title to:', title);
    try {
      client.sendClaudeSessionMessage({ type: 'summary', summary: title, leafUuid: randomUUID() });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
  sendImage: async (path: string, _caption?: string) => {
    logger.debug('[happyMCP] Sending image:', path);
    try {
      const { ref, name, size } = await client.uploadImageAttachment(path);
      client.sendFileEvent(ref, name, size);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
};
```

并把 `const mcp = createMcpServer(handler);` 改为 `const mcp = createMcpServer(handlers);`，把返回的 `toolNames` 改为 `['change_title', 'send_image']`。

> 注：`caption` 暂未投递（file 事件无 caption 字段）。保留入参以便后续做"图+文"消息时使用；当前打 `_caption` 前缀避免 unused 报错。

**Step 3: 类型校验 + 现有测试**

Run: `cd packages/happy-cli && npx tsc --noEmit`
Expected: 无类型错误。

Run: `npx vitest run --project unit src/claude/runClaude.test.ts`
Expected: PASS（`startHappyServer` 被 mock，签名变更不影响；若该测试断言 toolNames 需同步更新）。

**Step 4: 提交**

```bash
git add packages/happy-cli/src/claude/utils/startHappyServer.ts
git commit -m "feat(cli): register send_image MCP tool"
```

---

### Task 5（增强，可选）: 携带宽高以获得正确比例

**目的:** MVP 用 4:3 默认比例渲染；本任务解析 PNG/JPEG 宽高，发更精确的 `image{}`，避免首屏比例跳变。

**Files:**
- Create: `packages/happy-cli/src/api/imageSize.ts`
- Test: `packages/happy-cli/src/api/imageSize.test.ts`
- Modify: `packages/happy-cli/src/api/apiSession.ts`（`sendFileEvent` 增加可选 image 参数）

**Step 1: 写失败测试**（用最小合法 PNG/JPEG 字节，或读取仓库内已有样例图）

```ts
import { describe, it, expect } from 'vitest';
import { readImageSize } from './imageSize';

describe('readImageSize', () => {
  it('reads PNG dimensions from IHDR', () => {
    // 8B signature + IHDR length/type + width(13x37)
    const png = new Uint8Array([
      0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
      0x00,0x00,0x00,0x0d, 0x49,0x48,0x44,0x52,
      0x00,0x00,0x00,0x0d, 0x00,0x00,0x00,0x25,
      0x08,0x06,0x00,0x00,0x00,
    ]);
    expect(readImageSize(png)).toEqual({ width: 13, height: 37 });
  });

  it('returns null for unknown formats', () => {
    expect(readImageSize(new Uint8Array([0,1,2,3]))).toBeNull();
  });
});
```

**Step 2: 运行确认失败** → `npx vitest run --project unit src/api/imageSize.test.ts`

**Step 3: 实现** `readImageSize`（无依赖，读 PNG IHDR / JPEG SOF 段）：

```ts
// packages/happy-cli/src/api/imageSize.ts
export function readImageSize(buf: Uint8Array): { width: number; height: number } | null {
  // PNG: 8B sig, then IHDR with width@16, height@20 (big-endian)
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // JPEG: scan SOF0..SOF15 markers (0xFFC0..0xFFCF, excluding C4/C8/CC)
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off++; continue; }
      const marker = buf[off + 1];
      const len = dv.getUint16(off + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = dv.getUint16(off + 5);
        const width = dv.getUint16(off + 7);
        return { width, height };
      }
      off += 2 + len;
    }
  }
  return null;
}
```

**Step 4: 运行确认通过** → `npx vitest run --project unit src/api/imageSize.test.ts`

**Step 5: 接入 `sendFileEvent`**（apiSession.ts）

```ts
sendFileEvent(ref: string, name: string, size: number, dims?: { width: number; height: number } | null): void {
  const ev = dims
    ? { t: 'file' as const, ref, name, size, image: { width: dims.width, height: dims.height, thumbhash: '' } }
    : { t: 'file' as const, ref, name, size };
  this.sendSessionProtocolMessage(createEnvelope('user', ev));
}
```

并在 `startHappyServer` 的 `sendImage` handler 里：上传后 `readImageSize` 解析（用上传时已读的 bytes，或重新读），把 dims 传入 `sendFileEvent`。

> 校验点：`thumbhash: ''` 能通过 `sessionFileEventSchema`（`z.string()` 允许空串），且 `FileView` 对空 thumbhash（`!image.thumbhash` 为真）跳过占位、只用宽高定比例。实现后务必跑一次真实会话确认 App 不报错。

**Step 6: 提交**

```bash
git add packages/happy-cli/src/api/imageSize.ts packages/happy-cli/src/api/imageSize.test.ts packages/happy-cli/src/api/apiSession.ts packages/happy-cli/src/claude/utils/startHappyServer.ts
git commit -m "feat(cli): include image dimensions in file event"
```

---

### Task 6: 构建 + 端到端验证

**Step 1: 构建**

Run: `cd packages/happy-cli && pnpm run build`
Expected: 构建成功，无类型错误。

**Step 2: 全量单测**

Run: `cd packages/happy-cli && npx vitest run --project unit`
Expected: 全绿。

**Step 3: 手动端到端（关键验收）**

1. 用本地构建的 happy-cli 起一个真实会话（连到你日常用的 happy-server）。
2. 在会话里让 agent 调用 `send_image`，传一张本地 PNG 绝对路径（如 `/Users/jacky/jacky-github/happy/packages/happy-app/logo.png` 或任一测试图）。
3. **桌面端**确认对话里出现该图片。
4. **手机端**打开同一会话，确认同样能看到图片（验证跨设备这条硬约束）。
5. 失败用例：传不存在的路径 / 超 10MB 文件，确认工具返回清晰错误、CLI 不崩。

**Step 4: 验收对照**（来自设计文档第九节）

- [ ] agent 调 `send_image(path)` 后对话出现图片
- [ ] 桌面端**和**手机端都能看到
- [ ] happy-app、happy-server 零改动（`git diff --stat` 仅含 happy-cli 与 docs）
- [ ] 失败场景有清晰错误返回，CLI 不崩

**Step 5: 收尾**

参照 superpowers:finishing-a-development-branch 决定合并/PR/清理。
