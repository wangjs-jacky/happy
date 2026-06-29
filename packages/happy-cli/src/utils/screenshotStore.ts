import { randomUUID } from 'crypto';
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
    // 进程级随机前缀（nonce）：保证 id 跨进程全局唯一。否则 CLI 重启/续接同一
    // session 时新进程又从 1 重数，新 id 会与 App 已落盘的 remoteId 碰撞 →
    // hasRemoteId 误判跳过、漏拉新图。id 形如 `${nonce}-${seq}`。
    private readonly nonce = randomUUID().slice(0, 8);
    private entries = new Map<string, StoredEntry>();

    add(input: { filePath: string; target: ScreenshotTarget; note?: string; takenAt: number }): ScreenshotRef {
        const id = `${this.nonce}-${++this.seq}`;
        const entry: StoredEntry = { id, ...input };
        this.entries.set(id, entry);
        return this.toRef(entry);
    }
    list(): ScreenshotRef[] {
        return [...this.entries.values()].map((e) => this.toRef(e));
    }
    getFilePath(id: string): string | undefined {
        return this.entries.get(id)?.filePath;
    }
    private toRef(e: StoredEntry): ScreenshotRef {
        return { id: e.id, target: e.target, note: e.note, takenAt: e.takenAt };
    }
}
