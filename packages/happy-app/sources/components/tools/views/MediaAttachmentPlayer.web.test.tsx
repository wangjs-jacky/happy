import * as React from 'react';
import { act } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaAttachmentPlayer } from './MediaAttachmentPlayer.web';

// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';

vi.mock('react-native', () => ({
    Pressable: 'Pressable',
    View: 'View',
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/text', () => ({
    t: (key: string, params?: { name?: string }) => `${key}:${params?.name ?? ''}`,
}));

const AUTH_HEADERS = { Authorization: 'Bearer test-token' };

function player() {
    return (
        <MediaAttachmentPlayer
            uri="https://files.test/protected.mp4"
            headers={AUTH_HEADERS}
            title="protected.mp4"
            kind="video"
            mimeType="video/mp4"
            testID="protected-player"
        />
    );
}

describe('MediaAttachmentPlayer.web authenticated downloads', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        createObjectURL.mockReset();
        revokeObjectURL.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    afterAll(() => {
        createObjectURL.mockRestore();
        revokeObjectURL.mockRestore();
    });

    it('aborts a pending authenticated fetch on unmount without creating an object URL', async () => {
        let requestSignal: AbortSignal | undefined;
        const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
            requestSignal = init?.signal ?? undefined;
            return new Promise<Response>((_resolve, reject) => {
                requestSignal?.addEventListener('abort', () => {
                    reject(new DOMException('The operation was aborted', 'AbortError'));
                }, { once: true });
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(player());
        });

        expect(fetchMock).toHaveBeenCalledWith('https://files.test/protected.mp4', {
            headers: AUTH_HEADERS,
            signal: expect.any(AbortSignal),
        });
        expect(requestSignal?.aborted).toBe(false);
        expect(renderer.root.findAllByType('video')).toHaveLength(0);

        await act(async () => {
            renderer.unmount();
        });

        expect(requestSignal?.aborted).toBe(true);
        expect(createObjectURL).not.toHaveBeenCalled();
        expect(revokeObjectURL).not.toHaveBeenCalled();
    });

    it('revokes an object URL created by a completed authenticated fetch', async () => {
        let requestSignal: AbortSignal | undefined;
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            requestSignal = init?.signal ?? undefined;
            return {
                ok: true,
                arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
            } as Response;
        });
        vi.stubGlobal('fetch', fetchMock);
        createObjectURL.mockReturnValue('blob:protected-video');

        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(player());
        });

        expect(renderer.root.findByType('video').props.src).toBe('blob:protected-video');

        await act(async () => {
            renderer.unmount();
        });

        expect(requestSignal?.aborted).toBe(true);
        expect(revokeObjectURL).toHaveBeenCalledOnce();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:protected-video');
    });

    it('renders audio as a compact control without autoplay by default', async () => {
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(
                <MediaAttachmentPlayer
                    uri="https://files.test/voice.mp3"
                    headers={{}}
                    title="voice.mp3"
                    kind="audio"
                    mimeType="audio/mpeg"
                    testID="voice-player"
                />,
            );
        });

        const frame = renderer.root.findByType('View');
        const audio = renderer.root.findByType('audio');
        expect(frame.props.style).toMatchObject({ height: 54, backgroundColor: 'transparent' });
        expect(audio.props).toMatchObject({ controls: true, title: 'voice.mp3' });
        expect(audio.props.autoPlay).toBeUndefined();
        expect(audio.props.style).toMatchObject({ backgroundColor: 'transparent', borderRadius: 27 });

        await act(async () => renderer.unmount());
    });

    it('requests playback when click-originated audio is mounted with autoplay', async () => {
        const play = vi.fn(() => Promise.resolve());
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(
                <MediaAttachmentPlayer
                    uri="https://files.test/voice.mp3"
                    headers={{}}
                    title="voice.mp3"
                    kind="audio"
                    mimeType="audio/mpeg"
                    testID="voice-player"
                    autoPlay
                />,
                { createNodeMock: (element: { type?: string }) => element.type === 'audio' ? { play } : null },
            );
        });

        expect(renderer.root.findByType('audio').props.autoPlay).toBe(true);
        expect(play).toHaveBeenCalledOnce();

        await act(async () => renderer.unmount());
    });
});
