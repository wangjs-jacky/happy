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
        return [...this.entries.values()].map((e) => this.toRef(e));
    }
    getFilePath(id: string): string | undefined {
        return this.entries.get(id)?.filePath;
    }
    private toRef(e: StoredEntry): ScreenshotRef {
        return { id: e.id, target: e.target, note: e.note, takenAt: e.takenAt };
    }
}
