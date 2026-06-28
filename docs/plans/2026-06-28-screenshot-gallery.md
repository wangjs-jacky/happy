# 截屏 + 带外图库 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 给 Happy 加截屏能力——手动点按钮看桌面/最前浏览器窗口的截图（看图+挂附件），并让 AI 干活中途自主调 MCP 工具截图，图片落进会话的「带外图库」（不进 Claude 上下文、App 本地持久化、底部抽屉展示），需要时由用户点选或 AI 自主拉进上下文分析。

**Architecture:** CLI 端（包裹 Claude Code 运行）用 macOS `screencapture` 截图。手动路径走 App→CLI 的 `sessionRPC('screenshot')` 同步取 base64；AI 路径扩展 Happy 现有内置 HTTP MCP server（`startHappyServer.ts`）新增 `take_screenshot/get_screenshot/list_screenshots` 三个工具，截图存 CLI 会话内临时缓存并把**轻量引用**写进 session metadata（服务器自动推 `update` 给 App，触发图库红点），返回给 AI 的只有文本引用。App 收到信号后用 `sessionRPC` 懒拉取图片字节，写本地文件 + MMKV 持久化，在底部抽屉网格展示，点图可挂输入栏。

**Tech Stack:** TypeScript monorepo（pnpm）。CLI：`@anthropic-ai/claude-agent-sdk`、`@modelcontextprotocol/sdk`、`child_process`。App：React Native / Expo、`react-native-mmkv`、`expo-image`、全局 `imageViewer` 单例、`useImagePicker` hook。

---

## 前置说明 / 执行须知

1. **本计划在 worktree `happy--screenshot-gallery`（分支 `screenshot-gallery`）执行**，主仓库 `jacky-main` 只读。
2. **行号/签名以「锚点」给出，不保证逐行精确**——本计划基于子 agent 调研。每个 Task 开工前**先打开引用文件核对真实签名**，再照范式改。若签名与计划不符，以代码为准并相应调整。
3. **平台范围**：先做 macOS（`screencapture`）。Linux/Windows 留 `TODO`，截图失败时返回明确错误而非崩溃。
4. **测试策略**：纯逻辑（screencapture 封装、临时缓存、引用编码、MMKV 持久化、MCP handler 逻辑）走 TDD。RN UI（按钮、抽屉、查看器接线）以**手动验证 + 类型检查**为主，不强行写 RN 渲染测试。CLI 测试用项目现有测试框架（先 `cd packages/happy-cli && cat package.json` 看 test 脚本，大概率 `vitest`；App 同理看 `packages/happy-app`）。
5. **特性开关**：图片上传受 `expImageUpload` gate（见 `SessionView.tsx`）。截屏 UI 复用同一 gate；若需独立开关，新增 `expScreenshot` 并默认跟随 `expImageUpload`。
6. **关键认知：不要走 `send_image`**。Happy 现有 `send_image` MCP 工具会把图片作为**消息发进聊天流（进上下文）**——这正是带外图库要避免的。带外路径必须自己走 metadata 信号 + 懒拉取，绝不复用 `send_image`。

---

## Phase 0：共享地基（CLI 截图封装 + 临时缓存）

### Task 0.1：screencapture 封装

**Files:**
- Create: `packages/happy-cli/src/utils/screenshot.ts`
- Test: `packages/happy-cli/src/utils/screenshot.spec.ts`（命名按项目现有 spec 约定，开工前先看一个现有 `*.spec.ts`/`*.test.ts`）

**Step 1: 写失败测试**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildScreencaptureArgs } from './screenshot';

describe('buildScreencaptureArgs', () => {
    it('desktop 整屏：-x 静音 + 输出路径', () => {
        expect(buildScreencaptureArgs('desktop', '/tmp/a.png'))
            .toEqual(['-x', '/tmp/a.png']);
    });
    it('browser 最前窗口：-o 去阴影 -l 不可用时退化为前窗 -x', () => {
        // 最前窗口：用 -x 静音 + 截当前激活窗口（macOS 无直接“最前窗口”参数，
        // 采用 -o(去窗口阴影) 且后续实现用窗口模式抓激活窗口；此处仅验证参数拼装契约）
        expect(buildScreencaptureArgs('browser', '/tmp/b.png'))
            .toEqual(['-x', '-o', '-l', 'FRONT_WINDOW', '/tmp/b.png']);
    });
});
```

**Step 2: 跑测试确认失败**

Run: `cd packages/happy-cli && pnpm vitest run src/utils/screenshot.spec.ts`
Expected: FAIL（`buildScreencaptureArgs is not a function`）

**Step 3: 最小实现**

```typescript
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export type ScreenshotTarget = 'desktop' | 'browser';

/** 拼装 screencapture 参数（纯函数，便于测试）。FRONT_WINDOW 为占位，captureScreenshot 内解析。 */
export function buildScreencaptureArgs(target: ScreenshotTarget, outPath: string): string[] {
    if (target === 'browser') {
        // 最前激活窗口：实现里用 -l <windowid>，此处给契约占位
        return ['-x', '-o', '-l', 'FRONT_WINDOW', outPath];
    }
    return ['-x', outPath]; // 整屏，-x 静音
}

/** 真截图：仅 macOS。返回 png 文件路径。失败 throw。 */
export async function captureScreenshot(target: ScreenshotTarget): Promise<string> {
    if (process.platform !== 'darwin') {
        throw new Error(`截图当前仅支持 macOS，检测到平台 ${process.platform}（Linux/Windows TODO）`);
    }
    const outPath = join(tmpdir(), `happy-shot-${Date.now()}-${Math.round(Math.random() * 1e6)}.png`);
    await new Promise<void>((resolve, reject) => {
        // 整屏直接 -x；最前窗口用 -W(交互窗口)不行(需用户点)，改用整屏兜底 + 后续可接 CDP。
        // MVP：browser 也先截整屏，注释标 TODO 精确到窗口。
        const args = target === 'browser'
            ? ['-x', outPath]   // TODO: 精确最前窗口（需 windowid，见 plan 备注）
            : ['-x', outPath];
        const child = spawn('screencapture', args, { stdio: 'ignore' });
        child.on('error', reject);
        child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`screencapture exit ${code}`)));
    });
    return outPath;
}
```

> **备注（最前窗口）**：macOS `screencapture` 没有“截最前窗口且不需交互”的单参数。可行实现：先 `osascript` 取最前窗口的 windowid，再 `screencapture -x -o -l<id>`。MVP 先整屏兜底并留 TODO，避免阻塞主流程。Task 0.1 只需纯函数测试通过 + 整屏可用。

**Step 4: 跑测试确认通过**

Run: `cd packages/happy-cli && pnpm vitest run src/utils/screenshot.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/happy-cli/src/utils/screenshot.ts packages/happy-cli/src/utils/screenshot.spec.ts
git commit -m "feat(cli): screencapture 封装（整屏 + 参数拼装，仅 macOS）"
```

---

### Task 0.2：会话内截图临时缓存 + 引用模型

**Files:**
- Create: `packages/happy-cli/src/utils/screenshotStore.ts`
- Test: `packages/happy-cli/src/utils/screenshotStore.spec.ts`

**Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { ScreenshotStore } from './screenshotStore';

describe('ScreenshotStore', () => {
    it('add 返回自增 id 引用，list 给轻量引用（不含字节）', () => {
        const s = new ScreenshotStore();
        const ref = s.add({ filePath: '/tmp/a.png', target: 'desktop', note: 'hi', takenAt: 100 });
        expect(ref.id).toBe('1');
        expect(ref.target).toBe('desktop');
        expect(ref.note).toBe('hi');
        expect((ref as any).filePath).toBeUndefined(); // 引用不暴露磁盘路径
        const list = s.list();
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe('1');
    });
    it('getFilePath 用 id 取回磁盘路径，未知 id 返回 undefined', () => {
        const s = new ScreenshotStore();
        s.add({ filePath: '/tmp/a.png', target: 'desktop', takenAt: 1 });
        expect(s.getFilePath('1')).toBe('/tmp/a.png');
        expect(s.getFilePath('999')).toBeUndefined();
    });
});
```

**Step 2: 跑测试确认失败**

Run: `cd packages/happy-cli && pnpm vitest run src/utils/screenshotStore.spec.ts`
Expected: FAIL

**Step 3: 最小实现**

```typescript
import type { ScreenshotTarget } from './screenshot';

/** 给 AI / App 看的轻量引用（无字节、无磁盘路径） */
export interface ScreenshotRef {
    id: string;
    target: ScreenshotTarget;
    note?: string;
    takenAt: number; // epoch ms
}

interface StoredEntry extends ScreenshotRef {
    filePath: string;
}

/** 会话内临时缓存：id→磁盘路径，进程内存，会话结束即弃。 */
export class ScreenshotStore {
    private seq = 0;
    private entries = new Map<string, StoredEntry>();

    add(input: { filePath: string; target: ScreenshotTarget; note?: string; takenAt: number }): ScreenshotRef {
        const id = String(++this.seq);
        const entry: StoredEntry = { id, ...input };
        this.entries.set(id, entry);
        return this.toRef(entry);
    }
    list(): ScreenshotRef[] {
        return [...this.entries.values()].map(this.toRef);
    }
    getFilePath(id: string): string | undefined {
        return this.entries.get(id)?.filePath;
    }
    private toRef(e: StoredEntry): ScreenshotRef {
        return { id: e.id, target: e.target, note: e.note, takenAt: e.takenAt };
    }
}
```

**Step 4: 跑测试确认通过**

Run: `cd packages/happy-cli && pnpm vitest run src/utils/screenshotStore.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/happy-cli/src/utils/screenshotStore.ts packages/happy-cli/src/utils/screenshotStore.spec.ts
git commit -m "feat(cli): 会话内截图临时缓存 + 轻量引用模型"
```

---

## Phase 1：能力 A —— 手动截屏（CLI RPC + App 按钮 + 看图/挂附件）

### Task 1.1：CLI `screenshot` RPC handler

**Files:**
- Create: `packages/happy-cli/src/claude/registerScreenshotHandler.ts`（参考 `registerKillSessionHandler.ts` 范式）
- Modify: 注册点——开工前 `rg "registerKillSessionHandler\(" packages/happy-cli/src` 找到现有 handler 在哪里被 wire 起来，照同样位置注册。
- Test: `packages/happy-cli/src/claude/registerScreenshotHandler.spec.ts`

**Step 1: 写失败测试**（用假的 rpcManager 验证注册 + 返回 base64）

```typescript
import { describe, it, expect, vi } from 'vitest';
import { registerScreenshotHandler } from './registerScreenshotHandler';

function fakeRpc() {
    const handlers = new Map<string, Function>();
    return {
        registerHandler: (m: string, h: Function) => handlers.set(m, h),
        call: (m: string, p: any) => handlers.get(m)!(p),
    };
}

describe('registerScreenshotHandler', () => {
    it('截图成功：返回 success + base64 png', async () => {
        const rpc = fakeRpc();
        registerScreenshotHandler(rpc as any, {
            capture: async () => '/tmp/x.png',
            readBase64: async () => 'AAA={base64}',
        });
        const res = await rpc.call('screenshot', { target: 'desktop' });
        expect(res.success).toBe(true);
        expect(res.dataBase64).toBe('AAA={base64}');
        expect(res.mimeType).toBe('image/png');
    });
    it('截图失败：success=false + error', async () => {
        const rpc = fakeRpc();
        registerScreenshotHandler(rpc as any, {
            capture: async () => { throw new Error('boom'); },
            readBase64: async () => '',
        });
        const res = await rpc.call('screenshot', { target: 'desktop' });
        expect(res.success).toBe(false);
        expect(res.error).toContain('boom');
    });
});
```

**Step 2: 跑测试确认失败**

Run: `cd packages/happy-cli && pnpm vitest run src/claude/registerScreenshotHandler.spec.ts`
Expected: FAIL

**Step 3: 最小实现**

```typescript
import { promises as fs } from 'fs';
import type { RpcHandlerManager } from '../api/rpc/RpcHandlerManager';
import { captureScreenshot, type ScreenshotTarget } from '../utils/screenshot';

export interface ScreenshotRequest { target: ScreenshotTarget; }
export interface ScreenshotResponse {
    success: boolean;
    dataBase64?: string;
    mimeType?: string;
    error?: string;
}

// 依赖注入便于测试
interface Deps {
    capture: (t: ScreenshotTarget) => Promise<string>;
    readBase64: (p: string) => Promise<string>;
}

export function registerScreenshotHandler(
    rpc: RpcHandlerManager,
    deps: Deps = {
        capture: captureScreenshot,
        readBase64: (p) => fs.readFile(p, 'base64'),
    },
) {
    rpc.registerHandler<ScreenshotRequest, ScreenshotResponse>('screenshot', async (params) => {
        try {
            const filePath = await deps.capture(params.target ?? 'desktop');
            const dataBase64 = await deps.readBase64(filePath);
            return { success: true, dataBase64, mimeType: 'image/png' };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
}
```

**Step 4: 跑测试确认通过** → PASS

**Step 5: Wire 注册并 typecheck**

在 Step 1 `rg` 找到的位置加 `registerScreenshotHandler(rpcHandlerManager)`。然后：
Run: `cd packages/happy-cli && pnpm tsc --noEmit`（或项目 lint 脚本，先看 package.json）
Expected: 无类型错误

**Step 6: Commit**

```bash
git add packages/happy-cli/src/claude/registerScreenshotHandler.ts packages/happy-cli/src/claude/registerScreenshotHandler.spec.ts <wire文件>
git commit -m "feat(cli): screenshot RPC handler（手动截屏返回 base64）"
```

---

### Task 1.2：App 端 sessionRPC 调用封装

**Files:**
- 找现有 ops 封装：`rg "sessionRPC" packages/happy-app/sources` 看是否有 `sources/sync/ops*.ts` 统一封装层；有就照加，没有就直接在调用处用 `apiSocket.sessionRPC`。
- Create/Modify: `packages/happy-app/sources/sync/ops.screenshot.ts`

**Step 1: 实现（薄封装，无需测试或加 1 个签名测试）**

```typescript
import { apiSocket } from './apiSocket';

export interface ScreenshotRpcResponse {
    success: boolean;
    dataBase64?: string;
    mimeType?: string;
    error?: string;
}

export async function requestScreenshot(
    sessionId: string,
    target: 'desktop' | 'browser',
): Promise<ScreenshotRpcResponse> {
    return apiSocket.sessionRPC<ScreenshotRpcResponse, { target: string }>(
        sessionId, 'screenshot', { target },
    );
}
```

**Step 2: typecheck**

Run: `cd packages/happy-app && pnpm tsc --noEmit`（先看 package.json 确认脚本名）
Expected: 通过

**Step 3: Commit**

```bash
git add packages/happy-app/sources/sync/ops.screenshot.ts
git commit -m "feat(app): requestScreenshot sessionRPC 封装"
```

---

### Task 1.3：base64 → 本地文件 + 图库持久化（MMKV）

**Files:**
- Modify: `packages/happy-app/sources/sync/persistence.ts`（按调研锚点 L132-146 的草稿存储范式，加截图库读写）
- Create: `packages/happy-app/sources/sync/screenshotGallery.ts`（按 sessionId 隔离的持久化 + base64 落地为 file://）
- Test: `packages/happy-app/sources/sync/screenshotGallery.spec.ts`（测纯逻辑：增删读，mock MMKV + 文件写）

**Step 1: 写失败测试**（mock 存储后端，验证 add/load 按 sessionId 隔离、按时间倒序）

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

// mock MMKV + 文件写入后再 import 被测模块
const store = new Map<string, string>();
vi.mock('react-native-mmkv', () => ({
    MMKV: class { getString(k: string) { return store.get(k); } set(k: string, v: string) { store.set(k, v); } },
}));

import { addScreenshotEntry, loadGallery, type ScreenshotEntry } from './screenshotGallery';

describe('screenshotGallery', () => {
    beforeEach(() => store.clear());
    it('按 sessionId 隔离，新图排最前', () => {
        addScreenshotEntry('s1', { uri: 'file://a', source: 'manual', target: 'desktop', createdAt: 1 } as any);
        addScreenshotEntry('s1', { uri: 'file://b', source: 'ai', target: 'browser', createdAt: 2 } as any);
        addScreenshotEntry('s2', { uri: 'file://c', source: 'manual', target: 'desktop', createdAt: 3 } as any);
        const g1 = loadGallery('s1');
        expect(g1.map(e => e.uri)).toEqual(['file://b', 'file://a']);
        expect(loadGallery('s2')).toHaveLength(1);
    });
});
```

**Step 2: 跑测试确认失败** → FAIL

**Step 3: 最小实现**

```typescript
import { MMKV } from 'react-native-mmkv';

const mmkv = new MMKV();
const KEY = 'screenshot-gallery-v1';

export interface ScreenshotEntry {
    id: string;
    uri: string;                 // file:// 本地路径
    source: 'manual' | 'ai';
    target: 'desktop' | 'browser';
    note?: string;
    remoteId?: string;           // CLI 临时缓存里的 id（AI 路径懒拉取用）
    createdAt: number;
}

type AllGalleries = Record<string, ScreenshotEntry[]>;

function readAll(): AllGalleries {
    const raw = mmkv.getString(KEY);
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
}
function writeAll(all: AllGalleries) { mmkv.set(KEY, JSON.stringify(all)); }

export function loadGallery(sessionId: string): ScreenshotEntry[] {
    return (readAll()[sessionId] ?? []).slice().sort((a, b) => b.createdAt - a.createdAt);
}
export function addScreenshotEntry(sessionId: string, entry: Omit<ScreenshotEntry, 'id'>): ScreenshotEntry {
    const all = readAll();
    const withId: ScreenshotEntry = { ...entry, id: `${entry.createdAt}_${Math.round(Math.random() * 1e6)}` };
    all[sessionId] = [...(all[sessionId] ?? []), withId];
    writeAll(all);
    return withId;
}
export function hasRemoteId(sessionId: string, remoteId: string): boolean {
    return (readAll()[sessionId] ?? []).some(e => e.remoteId === remoteId);
}
```

> base64 落地为文件用 `expo-file-system`：先 `rg "expo-file-system" packages/happy-app` 确认已装；写 `FileSystem.documentDirectory + 'screenshots/<id>.png'`，`FileSystem.writeAsStringAsync(path, base64, { encoding: Base64 })`，返回 `file://` uri。把这步封成 `saveBase64Png(base64): Promise<string>` 放同文件（不入上面纯逻辑测试，集成时手验）。

**Step 4: 跑测试确认通过** → PASS

**Step 5: Commit**

```bash
git add packages/happy-app/sources/sync/screenshotGallery.ts packages/happy-app/sources/sync/screenshotGallery.spec.ts
git commit -m "feat(app): 截图库本地持久化（MMKV，按会话隔离）"
```

---

### Task 1.4：MessageComposer 截屏按钮 + 下拉（desktop/browser）

**Files:**
- Modify: `packages/happy-app/sources/components/MessageComposer.tsx`（`actionButtonsRight` 区，发图按钮右侧加按钮；props 加 `onCaptureScreenshot?: (target: 'desktop'|'browser') => void`）
- 下拉范式参考：`components/SessionInfoDropdown.tsx`

**Step 1: 加 prop + 按钮 + 下拉**（照调研里的下拉范式，两项：桌面整屏 / 最前浏览器窗口）。按钮图标用 `Ionicons "camera-outline"`。

**Step 2: typecheck**

Run: `cd packages/happy-app && pnpm tsc --noEmit`
Expected: 通过

**Step 3: Commit**

```bash
git add packages/happy-app/sources/components/MessageComposer.tsx
git commit -m "feat(app): MessageComposer 加截屏按钮 + desktop/browser 下拉"
```

---

### Task 1.5：会话页接线手动截屏（取图→看图→入库→可挂附件）

**Files:**
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`（按调研锚点 L490/616-619；把 `onCaptureScreenshot` 传给 composer）

**Step 1: 实现回调**

```typescript
const handleCaptureScreenshot = React.useCallback(async (target: 'desktop' | 'browser') => {
    const res = await requestScreenshot(sessionId, target);
    if (!res.success || !res.dataBase64) {
        Modal.alert(t('screenshot.failedTitle'), res.error ?? 'unknown'); // 用现有 ModalManager
        return;
    }
    const uri = await saveBase64Png(res.dataBase64);
    const entry = addScreenshotEntry(sessionId, { uri, source: 'manual', target, createdAt: Date.now() });
    imageViewer.open({ uri }); // 立即弹出查看（全局单例）
    refreshGallery();          // 刷新抽屉数据源（Task 3.x 的 state）
    // 看图后“挂附件”由查看器/抽屉点选触发 addImages，不在此自动挂
}, [sessionId]);
```

接到 composer：`onCaptureScreenshot={expImageUpload ? handleCaptureScreenshot : undefined}`。

**Step 2: 手动验证（真机/模拟）**

- 起 CLI + App（按 `docs/dev-environments.md` / `pnpm env:*`）。
- 点截屏→桌面整屏：弹出查看器看到当前桌面图；抽屉里出现该图。

**Step 3: Commit**

```bash
git add packages/happy-app/sources/-session/SessionView.tsx
git commit -m "feat(app): 手动截屏接线——取图/弹查看器/入库"
```

---

## Phase 2：能力 B（CLI 侧）—— MCP 工具 + metadata 信号

### Task 2.1：扩展内置 MCP server 加三个工具

**Files:**
- Modify: `packages/happy-cli/src/claude/utils/startHappyServer.ts`（现有 `change_title`/`send_image` 旁加 `take_screenshot`/`get_screenshot`/`list_screenshots`）
- 注入 `ScreenshotStore` 单例（Task 0.2）；把 store 也传给后续 metadata 信号代码。
- Test: 给 handlers 逻辑写单测 `startHappyServer.screenshot.spec.ts`（把三个 handler 实现抽成可单测的纯函数 `createScreenshotTools(deps)`，再在 server 里注册）

**Step 1: 写失败测试**（验证 take 返回文本引用不含字节；get 返回图像；list 返回引用列表）

```typescript
import { describe, it, expect } from 'vitest';
import { createScreenshotTools } from './startHappyServer';
import { ScreenshotStore } from '../../utils/screenshotStore';

describe('createScreenshotTools', () => {
    it('take_screenshot：存库 + 信号 + 返回纯文本引用（无 base64）', async () => {
        const store = new ScreenshotStore();
        const signals: any[] = [];
        const tools = createScreenshotTools({
            store,
            capture: async () => '/tmp/x.png',
            readBase64: async () => 'BYTES',
            signalNewScreenshot: (refs) => signals.push(refs),
            now: () => 123,
        });
        const out = await tools.take({ target: 'browser', note: '登录页' });
        expect(out).toMatch(/#1/);
        expect(out).toMatch(/get_screenshot/);
        expect(out).not.toMatch(/BYTES/);        // 字节不进返回（不进上下文）
        expect(signals).toHaveLength(1);          // 触发了向 App 的信号
        expect(store.list()).toHaveLength(1);
    });
    it('get_screenshot：返回图像 base64', async () => {
        const store = new ScreenshotStore();
        store.add({ filePath: '/tmp/x.png', target: 'desktop', takenAt: 1 });
        const tools = createScreenshotTools({
            store, capture: async () => '', readBase64: async () => 'BYTES',
            signalNewScreenshot: () => {}, now: () => 1,
        });
        const out = await tools.get({ id: '1' });
        expect(out.base64).toBe('BYTES');
        expect(out.mimeType).toBe('image/png');
    });
    it('get_screenshot 未知 id：报错文本', async () => {
        const store = new ScreenshotStore();
        const tools = createScreenshotTools({
            store, capture: async () => '', readBase64: async () => '',
            signalNewScreenshot: () => {}, now: () => 1,
        });
        await expect(tools.get({ id: '404' })).rejects.toThrow(/not found|不存在/i);
    });
});
```

**Step 2: 跑测试确认失败** → FAIL

**Step 3: 实现 `createScreenshotTools` 并在 server 注册**

```typescript
import { promises as fs } from 'fs';
import { z } from 'zod';
import { captureScreenshot, type ScreenshotTarget } from '../../utils/screenshot';
import type { ScreenshotStore, ScreenshotRef } from '../../utils/screenshotStore';

interface ScreenshotToolDeps {
    store: ScreenshotStore;
    capture: (t: ScreenshotTarget) => Promise<string>;
    readBase64: (p: string) => Promise<string>;
    signalNewScreenshot: (refs: ScreenshotRef[]) => void; // → updateMetadata（Task 2.2）
    now: () => number;
}

export function createScreenshotTools(deps: ScreenshotToolDeps) {
    return {
        take: async ({ target, note }: { target: ScreenshotTarget; note?: string }) => {
            const filePath = await deps.capture(target ?? 'desktop');
            const ref = deps.store.add({ filePath, target: target ?? 'desktop', note, takenAt: deps.now() });
            deps.signalNewScreenshot(deps.store.list());
            return `已截图 #${ref.id} [${ref.target}] ${note ? `note:"${note}" ` : ''}` +
                   `已存入图库（未进上下文）。需要分析时调 get_screenshot({ id: "${ref.id}" })。`;
        },
        get: async ({ id }: { id: string }) => {
            const fp = deps.store.getFilePath(id);
            if (!fp) throw new Error(`screenshot #${id} not found`);
            return { base64: await deps.readBase64(fp), mimeType: 'image/png' as const };
        },
        list: async () => deps.store.list(),
    };
}
```

在 `createMcpServer()` 里注册（默认 deps：`capture: captureScreenshot`, `readBase64: p => fs.readFile(p,'base64')`, `now: () => Date.now()`, `signalNewScreenshot` 由 Task 2.2 注入）：

```typescript
const tools = createScreenshotTools({ store, capture: captureScreenshot, readBase64: p => fs.readFile(p,'base64'), signalNewScreenshot, now: () => Date.now() });

mcp.registerTool('take_screenshot', {
    description: '截取桌面或最前浏览器窗口的截图，存入“带外图库”。图片不会进入对话上下文，只返回一个轻量文本引用；需要真正查看/分析某张时再调 get_screenshot。',
    inputSchema: { target: z.enum(['desktop','browser']).describe('desktop=整屏, browser=最前浏览器窗口'), note: z.string().optional().describe('给这张截图的备注，便于以后引用') },
}, async (args) => ({ content: [{ type: 'text', text: await tools.take(args) }] }));

mcp.registerTool('get_screenshot', {
    description: '按 id 把图库里某张截图取进当前上下文以供分析（这一刻才消耗上下文）。',
    inputSchema: { id: z.string() },
}, async (args) => {
    const { base64, mimeType } = await tools.get(args);
    return { content: [{ type: 'image', data: base64, mimeType }] };
});

mcp.registerTool('list_screenshots', {
    description: '列出当前会话图库里已有截图的轻量引用（id/来源/时间/备注），不含图片本身。',
    inputSchema: {},
}, async () => ({ content: [{ type: 'text', text: JSON.stringify(await tools.list()) }] }));
```

> `toolNames` 数组追加这三个名字，使 `runClaude.ts` 的 `allowedTools` 自动放行 `mcp__happy__take_screenshot` 等。开工前确认 `startHappyServer` 返回的 `toolNames` 来源，照加。

**Step 4: 跑测试确认通过** → PASS；并 `pnpm tsc --noEmit`

**Step 5: Commit**

```bash
git add packages/happy-cli/src/claude/utils/startHappyServer.ts packages/happy-cli/src/claude/utils/startHappyServer.screenshot.spec.ts
git commit -m "feat(cli): MCP 工具 take/get/list_screenshot（带外图库，图不进上下文）"
```

---

### Task 2.2：metadata 信号——通知 App「有新截图」

**Files:**
- Modify: `startHappyServer.ts` 注入 `signalNewScreenshot`，内部调 `session.updateMetadata(...)`（CLI 端 API 见 `packages/happy-cli/src/api/apiSession.ts` 第 627-672 锚点；开工前核对真实方法名/签名）。
- 设计：metadata 里维护 `screenshotRefs: ScreenshotRef[]`（轻量，无字节）+ `screenshotVersion: number`。每次 take 后整体覆盖写。

**Step 1: 实现注入**

```typescript
// 在能拿到 session 对象的地方构造：
const signalNewScreenshot = (refs: ScreenshotRef[]) => {
    session.updateMetadata((prev) => ({ ...prev, screenshotRefs: refs, screenshotVersion: refs.length }));
};
```

> 若 `updateMetadata` 签名是「传对象」而非「传 updater」，按真实签名改（先读 apiSession.ts）。metadata 体积：只放引用（id/target/note/takenAt），几十条无压力。

**Step 2: 手动验证**

- 让 Claude（在某会话里）调用 `take_screenshot`（可在对话里直接要求 AI 截图）。
- CLI 日志确认：截图成功 + metadata 更新发出。
- App 端（Task 3.x 完成后）收到 metadata 更新。

**Step 3: Commit**

```bash
git add packages/happy-cli/src/claude/utils/startHappyServer.ts
git commit -m "feat(cli): take_screenshot 后用 updateMetadata 向 App 发轻量引用信号"
```

---

## Phase 3：能力 B（App 侧）—— 抽屉图库 + 懒拉取 + 红点

### Task 3.1：CLI→App metadata 监听 + 懒拉取图片字节

**Files:**
- Modify: App 的 metadata/session 更新处理（调研锚点 `packages/happy-app/sources/sync/sync.ts` ~L2090 的 update 处理）。检测 `metadata.screenshotRefs` 变化。
- Create: `packages/happy-app/sources/sync/screenshotSync.ts`——对比 metadata refs 与本地 gallery，对缺失的 `remoteId` 调 `sessionRPC('getScreenshotById', { id })` 拉字节、落文件、入库。
- 需要新增一个 CLI RPC `getScreenshotById`（在 Task 1.1 的 handler 文件里加一个，从 `ScreenshotStore.getFilePath` 读 base64 返回）——**注意它和 MCP 的 `get_screenshot` 是两条路**：MCP 给 AI，RPC 给 App。共用同一个 `ScreenshotStore`。

> 依赖：`ScreenshotStore` 实例要在 CLI 内被 RPC handler 和 MCP server 共享。开工时确认 store 创建点能同时被两边拿到（很可能在启动 Happy server 的同一作用域 new 一个，传给两处）。

**Step 1: 写失败测试**（纯同步逻辑：给定 metadata refs + 本地已有 remoteIds，算出「待拉取列表」）

```typescript
import { describe, it, expect } from 'vitest';
import { diffPendingScreenshots } from './screenshotSync';

describe('diffPendingScreenshots', () => {
    it('只返回本地没有的 remoteId', () => {
        const refs = [{ id: '1' }, { id: '2' }, { id: '3' }] as any;
        const localRemoteIds = new Set(['1']);
        expect(diffPendingScreenshots(refs, localRemoteIds).map(r => r.id)).toEqual(['2', '3']);
    });
});
```

**Step 2: 跑测试确认失败 → 实现 `diffPendingScreenshots` → 通过**

```typescript
export function diffPendingScreenshots<T extends { id: string }>(refs: T[], localRemoteIds: Set<string>): T[] {
    return refs.filter(r => !localRemoteIds.has(r.id));
}
```

**Step 3: 写拉取主流程**（不强制单测，集成手验）：metadata 变化 → `diffPendingScreenshots` → 逐个 `sessionRPC('getScreenshotById', {id})` → `saveBase64Png` → `addScreenshotEntry(sessionId, { ..., source:'ai', remoteId: id })` → 标记「有新图」红点。

**Step 4: typecheck + Commit**

```bash
git add packages/happy-app/sources/sync/screenshotSync.ts packages/happy-app/sources/sync/screenshotSync.spec.ts <sync.ts/handler 改动>
git commit -m "feat: AI 截图 metadata 信号 → App 懒拉取字节入库（带外）"
```

---

### Task 3.2：底部抽屉图库面板

**Files:**
- Create: `packages/happy-app/sources/components/ScreenshotGalleryDrawer.tsx`（用调研里的 `BottomSheet` 范式 + 缩略图网格）
- Modify: `SessionView.tsx` 挂载抽屉 + 维护 `galleryOpen`/`hasNew` state + `refreshGallery`

**Step 1: 实现抽屉**

- 数据源：`loadGallery(sessionId)`，`refreshGallery` 重新读。
- 网格项：`Image source={{ uri }}`，角标显示来源（`AI`/`手动`、`browser`/`desktop`）+ note。
- 点缩略图：弹层两个动作——「查看」(`imageViewer.open({uri})`) /「挂到输入栏」(`addImages([{ id, uri, width:0,height:0, mimeType:'image/png', size:0, name }])` 然后关抽屉)。
- 入口：MessageComposer 截屏按钮下拉里加第三项「图库」→ `setGalleryOpen(true)`，或 composer 旁加图库入口图标带 `hasNew` 红点。

**Step 2: 手动验证**

- 让 AI 连续截两张图 → composer 图库入口出现红点 → 打开抽屉看到两张（标 `AI`）→ 点「挂到输入栏」→ 发送给 AI → AI 能看到图。
- 手动截一张 → 同一抽屉里出现（标 `手动`）。

**Step 3: Commit**

```bash
git add packages/happy-app/sources/components/ScreenshotGalleryDrawer.tsx packages/happy-app/sources/-session/SessionView.tsx
git commit -m "feat(app): 底部抽屉截图图库（缩略图网格 + 红点 + 挂附件/查看）"
```

---

## Phase 4：安全闸门 + 收尾

### Task 4.1：AI 调 take_screenshot 的确认闸门（可配置）

**Files:**
- Modify: `startHappyServer.ts` take handler + 一个设置项。
- 设计：默认**首次截图弹一次确认**（通过 metadata 发起一个「待确认」状态，App 弹 Modal，用户允许后记住本会话）。MVP 可先简化为「设置里一个开关 `aiScreenshotRequiresConfirm`，默认 off」，留 TODO 做交互确认。先和现实复杂度匹配——若交互确认成本高，MVP 落「开关 + 默认允许 + 每次截图在聊天流留一条系统提示『AI 截了图 #N』」让用户有感知。

**Step 1: 实现最小开关 + 系统可感知提示**
**Step 2: 手验**
**Step 3: Commit** `feat: AI 截图可感知/可配置确认（MVP 开关）`

---

### Task 4.2：i18n、空态、错误态、平台 TODO

- 文案进 i18n（`rg "i18n\|t('" packages/happy-app` 找现有方案）：截屏失败、空图库、非 macOS 提示。
- 非 macOS：RPC/MCP 返回明确「仅支持 macOS」错误，App Modal 友好提示。
- README/docs 补一句新能力；`docs/` 加一节简述（可选）。
- Commit `chore: 截图功能 i18n/空态/错误态/平台说明`

---

### Task 4.3：最前浏览器窗口精确截图（消化 Task 0.1 的 TODO）

- 实现 macOS「最前窗口」：`osascript` 取最前 app 的 windowid → `screencapture -x -o -l<id>`。封进 `captureScreenshot('browser')`。
- 加单测覆盖 windowid 解析的纯函数部分。
- Commit `feat(cli): browser 目标精确截最前窗口（osascript + -l<windowid>）`

---

## 验收清单（全部完成后）

- [ ] 手动：点截屏→桌面整屏，立即弹查看器看到桌面，抽屉入库。
- [ ] 手动：点截屏→最前浏览器窗口，截到浏览器画面。
- [ ] 手动：抽屉点图「挂到输入栏」→ 发送 → AI 收到图。
- [ ] AI：对话中要求 AI 截图，AI 调 `take_screenshot`，**返回的对话内容里没有图片字节**（不进上下文），只有文本引用。
- [ ] AI：图自动出现在抽屉（标 AI），composer 红点提示。
- [ ] AI：要求 AI「看第 N 张」，AI 调 `get_screenshot` 才把图拉进上下文分析。
- [ ] AI 与手动截图共用同一抽屉，来源标签清晰。
- [ ] 离线重开 App，抽屉历史仍在（MMKV 持久化）。
- [ ] 非 macOS 平台给出明确错误而非崩溃。
- [ ] `pnpm tsc --noEmit`（cli + app）通过；新增单测全绿。

---

## 风险与备注

1. **`updateMetadata` 真实签名/体积上限**：Task 2.2 前必须读 `apiSession.ts`。若 metadata 不宜放数组，退化为「只放 `screenshotVersion` 计数 + App 收到后 `sessionRPC('listScreenshots')` 拉引用列表」。
2. **ScreenshotStore 共享**：RPC handler 与 MCP server 必须共用同一实例，否则 App 拉不到 AI 截的图。开工时定好 new 的位置。
3. **`expImageUpload` gate**：截屏 UI 默认跟随它；若该 gate 当前关闭，开发时手动打开。
4. **`send_image` 不要碰**：它进聊天流=进上下文，与带外目标冲突。
5. **本地模式 vs 远程模式**：`runClaude.ts` 两种模式都会消费 `toolNames`，新工具两边都生效——但本地模式走 `--mcp-config`，确认新工具在本地模式也注册（看 `claudeLocal.ts`）。
