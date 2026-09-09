import { subscribeAttachmentCache } from '@/sync/attachmentCacheContext';

type VideoEntry = {
    key: string;
    video: HTMLVideoElement;
    disposed: boolean;
    cancelRestore?: () => void;
};

const MAX_IDLE_VIDEOS = 8;
const idle = new Map<string, VideoEntry>();
const active = new Set<VideoEntry>();

function dispose(entry: VideoEntry) {
    if (entry.disposed) return;
    entry.disposed = true;
    entry.cancelRestore?.();
    entry.video.pause();
    entry.video.remove();
    entry.video.removeAttribute('src');
    entry.video.load();
}

subscribeAttachmentCache(() => {
    const entries = new Set([...active, ...idle.values()]);
    active.clear();
    idle.clear();
    for (const entry of entries) dispose(entry);
});

function refreshSource(entry: VideoEntry, uri: string) {
    const { video } = entry;
    const position = video.currentTime;
    entry.cancelRestore?.();
    if (Number.isFinite(position) && position > 0) {
        const restore = () => {
            entry.cancelRestore = undefined;
            if (entry.disposed) return;
            const duration = video.duration;
            const target = Number.isFinite(duration) && duration >= 0 ? Math.min(position, duration) : position;
            try { video.currentTime = target; } catch { /* A failed/unseekable stream can still be retried from its start. */ }
        };
        video.addEventListener('loadedmetadata', restore, { once: true });
        entry.cancelRestore = () => {
            video.removeEventListener('loadedmetadata', restore);
            entry.cancelRestore = undefined;
        };
    }
    video.src = uri;
    video.load();
}

/** Exclusive leases for header-free HTTP video only. The caller supplies an
 * ownership-scoped resource key, mounts the node and configures its controls.
 * Detached idle nodes retain browser media state across transcript pagination;
 * they never resume playback implicitly or retain decrypted/blob media. */
export function acquireStreamingVideo(key: string, uri: string): { video: HTMLVideoElement; release(): void } {
    let entry = idle.get(key);
    if (entry) {
        idle.delete(key);
        // A newly signed URI does not require restarting a healthy existing
        // stream. Refresh only a failed source, preserving its seek position.
        if (entry.video.error || entry.video.networkState === 3) refreshSource(entry, uri);
    } else {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = uri;
        entry = { key, video, disposed: false };
    }
    const leased = entry;
    active.add(leased);
    let released = false;
    return {
        video: leased.video,
        release() {
            if (released) return;
            released = true;
            active.delete(leased);
            if (leased.disposed) return;
            leased.video.pause();
            leased.video.remove();
            // Concurrent consumers never share an active node. Once both have
            // released, retain only the most recently released node for a key.
            const previous = idle.get(key);
            if (previous) {
                idle.delete(key);
                dispose(previous);
            }
            idle.set(key, leased);
            while (idle.size > MAX_IDLE_VIDEOS) {
                const oldest = idle.keys().next().value!;
                const evicted = idle.get(oldest)!;
                idle.delete(oldest);
                dispose(evicted);
            }
        },
    };
}
