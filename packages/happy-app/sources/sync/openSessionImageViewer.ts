import { imageViewer, type ImageViewerSource } from './imageViewer';
import { storage } from './storage';
import { collectSessionImageGallery } from './sessionImageGallery';

/** Resolve history only on click, keeping thumbnail rows independent of message updates. */
export function openSessionImageViewer(sources: ImageViewerSource | ImageViewerSource[], index = 0) {
    const gallery = getSessionImageViewerGallery(sources, index);
    if (gallery) imageViewer.open(gallery.sources, gallery.index);
}

/** Also used by a viewer inside an existing modal, avoiding stacked RN Modals. */
export function getSessionImageViewerGallery(sources: ImageViewerSource | ImageViewerSource[], index = 0) {
    const fallback = Array.isArray(sources) ? sources : [sources];
    const selected = fallback[index];
    if (!selected) return;
    const sessionId = selected.sessionId;
    if (!sessionId || !selected.attachmentRef) {
        return { sources: fallback, index };
    }
    const history = collectSessionImageGallery(sessionId, storage.getState().sessionMessages[sessionId]?.messages ?? []);
    // Current rows can arrive before storage catches up. Retain their sources,
    // and preserve any thumbnail URI or detected Motion Photo metadata.
    for (const source of fallback) {
        const existing = history.findIndex((item) => item.attachmentRef === source.attachmentRef);
        if (existing < 0) history.push(source);
        else history[existing] = { ...history[existing], ...source };
    }
    return { sources: history, index: history.findIndex((item) => item.attachmentRef === selected.attachmentRef) };
}
