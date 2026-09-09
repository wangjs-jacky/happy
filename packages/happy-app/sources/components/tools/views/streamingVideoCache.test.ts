// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateLocalHistorySession } from '@/sync/localHistoryStore';
import { acquireStreamingVideo } from './streamingVideoCache';

describe('streaming video DOM cache', () => {
    beforeEach(() => {
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
        invalidateLocalHistorySession('video-cache-test', 'reset');
    });
    afterEach(() => {
        invalidateLocalHistorySession('video-cache-test', 'reset');
        vi.restoreAllMocks();
    });

    it('pauses and detaches a released video, then reuses its DOM and source without resuming playback', () => {
        const first = acquireStreamingVideo('video', 'https://media.test/a.mp4?signature=first');
        expect(first.video.preload).toBe('metadata');
        document.body.append(first.video);
        first.video.currentTime = 17;
        first.release();
        expect(first.video.isConnected).toBe(false);
        expect(first.video.pause).toHaveBeenCalled();
        expect(first.video.getAttribute('src')).toContain('signature=first');
        const source = first.video.getAttribute('src');
        const setAttribute = vi.spyOn(first.video, 'setAttribute');
        const next = acquireStreamingVideo('video', 'https://media.test/a.mp4?signature=renewed');
        expect(next.video).toBe(first.video);
        expect(next.video.getAttribute('src')).toBe(source);
        expect(next.video.currentTime).toBe(17);
        expect(setAttribute).not.toHaveBeenCalledWith('src', expect.anything());
        expect(next.video.load).not.toHaveBeenCalled();
        expect(next.video.play).not.toHaveBeenCalled();
        next.release();
    });

    it('keeps simultaneous consumers exclusive and makes StrictMode cleanup idempotent', () => {
        const first = acquireStreamingVideo('same', 'https://media.test/a.mp4');
        const second = acquireStreamingVideo('same', 'https://media.test/a.mp4');
        expect(first.video).not.toBe(second.video);
        first.release();
        const third = acquireStreamingVideo('same', 'https://media.test/a.mp4');
        expect(third.video).toBe(first.video);
        document.body.append(third.video);
        first.release();
        expect(third.video.isConnected).toBe(true);
        expect(second.video.getAttribute('src')).toBe('https://media.test/a.mp4');
        second.release();
        third.release();
    });

    it('retains only eight idle videos while preserving active owners', () => {
        const active = acquireStreamingVideo('active', 'https://media.test/active.mp4');
        document.body.append(active.video);
        const videos: HTMLVideoElement[] = [];
        for (let i = 0; i < 8; i++) {
            const lease = acquireStreamingVideo(String(i), `https://media.test/${i}.mp4`);
            videos.push(lease.video);
            lease.release();
        }
        const touched = acquireStreamingVideo('0', 'https://media.test/0.mp4');
        touched.release();
        acquireStreamingVideo('8', 'https://media.test/8.mp4').release();
        expect(videos[1].hasAttribute('src')).toBe(false);
        expect(videos[0].hasAttribute('src')).toBe(true);
        expect(active.video.isConnected).toBe(true);
        expect(active.video.hasAttribute('src')).toBe(true);
        expect(videos[1].load).toHaveBeenCalled();
        active.release();
    });

    it('destroys active and idle videos on invalidation and ignores late releases', () => {
        const active = acquireStreamingVideo('active', 'https://media.test/a.mp4');
        const idle = acquireStreamingVideo('idle', 'https://media.test/b.mp4');
        document.body.append(active.video);
        idle.release();
        invalidateLocalHistorySession('video-cache-test', 'deleted');
        expect(active.video.isConnected).toBe(false);
        expect(active.video.hasAttribute('src')).toBe(false);
        expect(idle.video.hasAttribute('src')).toBe(false);
        const replacement = acquireStreamingVideo('active', 'https://media.test/new.mp4');
        expect(replacement.video).not.toBe(active.video);
        active.release();
        replacement.release();
        const again = acquireStreamingVideo('active', 'https://media.test/newer.mp4');
        expect(again.video).toBe(replacement.video);
        again.release();
    });

    it.each(['error', 'networkState'] as const)('refreshes an unhealthy %s source and restores time after metadata', property => {
        const first = acquireStreamingVideo('broken', 'https://media.test/old.mp4');
        first.video.currentTime = 42;
        Object.defineProperty(first.video, property, { configurable: true, value: property === 'error' ? { code: 4 } : 3 });
        first.release();
        const next = acquireStreamingVideo('broken', 'https://media.test/new.mp4');
        expect(next.video.getAttribute('src')).toBe('https://media.test/new.mp4');
        next.video.currentTime = 0;
        Object.defineProperty(next.video, 'duration', { configurable: true, value: 30 });
        next.video.dispatchEvent(new Event('loadedmetadata'));
        expect(next.video.currentTime).toBe(30);
        expect(next.video.play).not.toHaveBeenCalled();
        next.release();
    });

    it('removes stale metadata restoration when an unhealthy video is invalidated', () => {
        const first = acquireStreamingVideo('broken', 'https://media.test/old.mp4');
        first.video.currentTime = 42;
        Object.defineProperty(first.video, 'networkState', { configurable: true, value: 3 });
        first.release();
        const next = acquireStreamingVideo('broken', 'https://media.test/new.mp4');
        invalidateLocalHistorySession('video-cache-test', 'deleted');
        next.video.currentTime = 0;
        next.video.dispatchEvent(new Event('loadedmetadata'));
        expect(next.video.currentTime).toBe(0);
        next.release();
    });
});
