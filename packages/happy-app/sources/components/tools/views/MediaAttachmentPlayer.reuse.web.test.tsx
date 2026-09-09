// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MediaAttachmentPlayer } from './MediaAttachmentPlayer.web';

vi.mock('react-native', () => ({ View: ({ children }: any) => <div>{children}</div> }));
vi.mock('@/sync/attachmentCacheContext', () => ({ attachmentCacheGeneration: () => 0, subscribeAttachmentCache: () => () => {} }));
let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const player = (uri = 'https://objects.test/video.mp4?signature=first', extras: any = {}) => <MediaAttachmentPlayer
    uri={uri} headers={{}} title="clip.mp4" kind="video" mimeType="video/mp4" testID="clip"
    reuseKey="account/session/clip" {...extras} />;

it('reuses the same video and playback position across removal of the entire message and changed signed URLs', async () => {
    await act(async () => root.render(<React.StrictMode>{player()}</React.StrictMode>));
    const video = container.querySelector('video')!;
    video.currentTime = 7;
    await act(async () => root.render(null));
    expect(video.isConnected).toBe(false);
    await act(async () => root.render(player('https://objects.test/video.mp4?signature=second', { title: 'updated title' })));
    expect(container.querySelector('video')).toBe(video);
    expect(video.currentTime).toBe(7);
    expect(video.src).toContain('signature=first');
    expect(video.title).toBe('updated title');
    expect(video.autoplay).toBe(false);
});

it('refreshes an errored signed source once and does not retry after unmount', async () => {
    const refreshSource = vi.fn(async () => ({ uri: 'https://objects.test/video.mp4?signature=refreshed', headers: {} }));
    await act(async () => root.render(player(undefined, { reuseKey: 'error-case', refreshSource })));
    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'error', { configurable: true, get: () => ({ code: 2 }) });
    await act(async () => video.dispatchEvent(new Event('error')));
    expect(refreshSource).toHaveBeenCalledTimes(1);
    expect(container.querySelector('video')!.src).toContain('signature=refreshed');
    await act(async () => container.querySelector('video')!.dispatchEvent(new Event('error')));
    expect(refreshSource).toHaveBeenCalledTimes(1);
    await act(async () => root.render(null));
    video.dispatchEvent(new Event('error'));
    expect(refreshSource).toHaveBeenCalledTimes(1);
});

it('does not recreate a player from expired ownership even if stale source props remount', async () => {
    await act(async () => root.render(player(undefined, { reuseKey: 'stale-owner', isSourceCurrent: () => false })));
    expect(container.querySelector('video')).toBeNull();
});
