/**
 * Audio/video attachment lane helpers.
 *
 * Unlike images (E2E-encrypted, decrypted into memory, sniffed by magic byte),
 * audio/video travel plaintext and are streamed straight to disk. The model
 * cannot read the media directly, so we hand it the local file *path* as text
 * and let it run ffmpeg/whisper. These helpers decide the kind, pick a safe
 * on-disk filename, and format the prompt notice.
 */
import { join } from 'node:path';
import { configuration } from '@/configuration';
import type { MediaAttachment } from '@/utils/MessageQueue2';

/** File-event fields this module needs — a structural subset of the wire schema. */
export type MediaFileEvent = {
    ref: string;
    name: string;
    size: number;
    mimeType?: string;
    kind?: 'image' | 'audio' | 'video';
    encrypted?: boolean;
};

/**
 * Whether a file event takes the plaintext streaming lane. Only explicit
 * `encrypted: false` opts in; anything missing/true stays on the encrypted
 * image path (back-compat with historical image-only events).
 */
export function isPlaintextMediaEvent(ev: MediaFileEvent): boolean {
    return ev.encrypted === false;
}

/**
 * Resolve the media kind. Trust the wire `kind` first; otherwise fall back to
 * the mimeType prefix, then the filename extension. Defaults to 'video' when
 * nothing is conclusive (it still lands on disk and the path is handed off).
 */
export function resolveMediaKind(ev: MediaFileEvent): 'audio' | 'video' {
    if (ev.kind === 'audio' || ev.kind === 'video') return ev.kind;
    const mime = (ev.mimeType ?? '').toLowerCase();
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    const ext = (ev.name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
    if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'].includes(ext)) return 'audio';
    return 'video';
}

/**
 * Absolute staging path under the attachments dir, keeping the original
 * extension and sanitising the base name. `stamp`/`index` keep concurrent
 * downloads from colliding; tests pass a fixed stamp for determinism.
 */
export function stagedMediaPath(ev: MediaFileEvent, stamp: string, index: number): string {
    const ext = ev.name.match(/\.([^.]+)$/)?.[1]?.replace(/[^\w]+/g, '') ?? '';
    const base = ev.name.replace(/\.[^.]+$/, '').replace(/[^\w.\-]+/g, '_') || 'media';
    const safeStamp = stamp.replace(/[:.]/g, '-');
    const fileName = ext ? `${safeStamp}-${index}-${base}.${ext}` : `${safeStamp}-${index}-${base}`;
    return join(configuration.attachmentsDir, fileName);
}

function humanSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${bytes}B`;
}

/**
 * Prompt text injected for staged audio/video attachments. Returns null when
 * there are none. Tells the model it can't read the media directly but the file
 * is on disk at these paths, and to use command-line tools.
 */
export function formatMediaAttachmentNotice(items: MediaAttachment[]): string | null {
    if (items.length === 0) return null;
    const lines = items.map(
        (it, i) => `- ${it.kind === 'audio' ? 'Audio' : 'Video'} ${i + 1}: ${it.localPath} (${it.mimeType}, ${humanSize(it.size)})`,
    );
    return [
        `[附件] 用户附带 ${items.length} 个音视频文件，已保存到本地磁盘：`,
        ...lines,
        '你无法直接读取音视频内容，但可以用命令行工具处理这些本地文件（例如 ffmpeg 抽帧/取信息、whisper 转录）。请按用户需求处理。',
        '不要去扫描 ~/.happy/attachments 猜测文件，直接使用上面给出的确切路径。',
    ].join('\n');
}
