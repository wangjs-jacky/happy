/**
 * Global fullscreen image viewer state.
 *
 * Any thumbnail (composer attachment strip, sent-image FileView, markdown image)
 * calls `imageViewer.open({ uri })` to present a pinch-to-zoom fullscreen viewer.
 * A single host (`ImageViewerHost`, mounted once at the app root) subscribes to
 * this store and renders the viewer — this avoids passing potentially huge
 * data: URIs through expo-router params.
 */
import { create } from 'zustand';

export interface ImageViewerSource {
    /** Image URI — local file://, remote http(s):// or a data: URI. */
    uri: string;
    /** Optional intrinsic size; lets the viewer fit the image before it loads. */
    width?: number;
    height?: number;
}

interface ImageViewerState {
    visible: boolean;
    source: ImageViewerSource | null;
    open: (source: ImageViewerSource) => void;
    close: () => void;
}

export const useImageViewerStore = create<ImageViewerState>()((set) => ({
    visible: false,
    source: null,
    open: (source) => set({ visible: true, source }),
    close: () => set({ visible: false }),
}));

/**
 * Imperative singleton — call from anywhere (event handlers, non-React code)
 * without wiring a hook. Mirrors the `storage.getState()` convention.
 */
export const imageViewer = {
    open(source: ImageViewerSource) {
        useImageViewerStore.getState().open(source);
    },
    close() {
        useImageViewerStore.getState().close();
    },
};
