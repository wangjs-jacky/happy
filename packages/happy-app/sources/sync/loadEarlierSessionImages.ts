import type { ImageViewerSource } from './imageViewer';
import { storage } from './storage';
import { getSessionImageViewerGallery } from './openSessionImageViewer';

/** Advance the existing sync pagination only until an older picture is found. */
export async function loadEarlierSessionImages(sources: ImageViewerSource[], signal: AbortSignal): Promise<ImageViewerSource[]> {
    const first = sources[0];
    if (!first?.sessionId || !first.attachmentRef) return sources;
    const sessionId = first.sessionId;
    while (true) {
        if (signal.aborted) throw new Error('Image history request cancelled');
        const gallery = getSessionImageViewerGallery(sources);
        if (gallery && gallery.index > 0) return gallery.sources;
        const before = storage.getState().sessionMessages[sessionId];
        const beforeMessages = before?.messages;
        if (!before?.hasMoreOlder) return sources;
        if (before.isLoadingOlder) {
            await new Promise<void>((resolve, reject) => {
                const finish = () => {
                    unsubscribe();
                    signal.removeEventListener('abort', abort);
                    resolve();
                };
                const abort = () => {
                    unsubscribe();
                    reject(new Error('Image history request cancelled'));
                };
                const unsubscribe = storage.subscribe(state => {
                    if (!state.sessionMessages[sessionId]?.isLoadingOlder) finish();
                });
                signal.addEventListener('abort', abort, { once: true });
                if (signal.aborted) abort();
                else if (!storage.getState().sessionMessages[sessionId]?.isLoadingOlder) finish();
            });
            continue;
        }
        // Avoid pulling the sync runtime into every thumbnail's module graph.
        const { sync } = await import('./sync');
        if (signal.aborted) throw new Error('Image history request cancelled');
        await sync.loadOlderMessages(sessionId);
        if (signal.aborted) throw new Error('Image history request cancelled');
        const after = storage.getState().sessionMessages[sessionId];
        if (after?.hasMoreOlder && after.messages === beforeMessages) {
            throw new Error('Image history pagination made no progress');
        }
    }
}
