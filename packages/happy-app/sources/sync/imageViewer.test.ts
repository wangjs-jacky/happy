import { describe, it, expect, beforeEach } from 'vitest';
import { imageViewer, useImageViewerStore } from './imageViewer';

describe('imageViewer store', () => {
    beforeEach(() => {
        useImageViewerStore.setState({ visible: false, source: null });
    });

    it('starts hidden with no source', () => {
        const s = useImageViewerStore.getState();
        expect(s.visible).toBe(false);
        expect(s.source).toBeNull();
    });

    it('open() shows the given source', () => {
        imageViewer.open({ uri: 'file:///a.png', width: 100, height: 200 });
        const s = useImageViewerStore.getState();
        expect(s.visible).toBe(true);
        expect(s.source).toEqual({ uri: 'file:///a.png', width: 100, height: 200 });
    });

    it('close() hides but keeps source so the image does not flash away mid-animation', () => {
        imageViewer.open({ uri: 'file:///a.png' });
        imageViewer.close();
        const s = useImageViewerStore.getState();
        expect(s.visible).toBe(false);
        expect(s.source).toEqual({ uri: 'file:///a.png' });
    });

    it('open() replaces a previous source', () => {
        imageViewer.open({ uri: 'file:///a.png' });
        imageViewer.open({ uri: 'file:///b.png' });
        expect(useImageViewerStore.getState().source).toEqual({ uri: 'file:///b.png' });
    });
});
