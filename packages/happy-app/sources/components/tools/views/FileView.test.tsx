import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileView } from './FileView';

// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    release: vi.fn(),
    isSharingAvailable: vi.fn(async () => true),
    share: vi.fn(async () => undefined),
    resolveSource: vi.fn(async () => ({
        uri: 'https://files.test/acceptance.mp4',
        headers: {},
        release: mocks.release,
    })),
}));

vi.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator',
    Pressable: 'Pressable',
    Text: 'Text',
    View: 'View',
}));
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/hooks/useAttachmentImage', () => ({ useAttachmentImage: () => ({ uri: null, error: null }) }));
vi.mock('@/utils/thumbhash', () => ({ thumbhashToDataUri: () => null }));
vi.mock('@/sync/imageViewer', () => ({ imageViewer: { open: vi.fn() } }));
vi.mock('@/sync/resolveMediaAttachmentSource', () => ({ resolveMediaAttachmentSource: mocks.resolveSource }));
vi.mock('expo-sharing', () => ({
    isAvailableAsync: mocks.isSharingAvailable,
    shareAsync: mocks.share,
}));
vi.mock('./MediaAttachmentPlayer', () => ({ MediaAttachmentPlayer: 'MediaAttachmentPlayer' }));
vi.mock('@/text', () => ({
    t: (key: string, params?: { name?: string }) => `${key}:${params?.name ?? ''}`,
}));
vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            divider: '#333',
            surfaceHigh: '#222',
            text: '#fff',
            textSecondary: '#aaa',
            textDestructive: '#f44',
        },
    };
    return {
        StyleSheet: { create: (factory: (value: any) => object) => factory(theme) },
        useUnistyles: () => ({ theme }),
    };
});

function videoTool(input: { encrypted?: boolean; source?: 'generated' } = {}) {
    return {
        name: 'file',
        state: 'completed',
        input: {
            ref: 'sessions/s1/attachments/acceptance.mp4',
            name: 'acceptance.mp4',
            size: 4096,
            kind: 'video',
            mimeType: 'video/mp4',
            ...input,
        },
    } as any;
}

function pdfTool() {
    return {
        name: 'file',
        state: 'completed',
        input: {
            ref: 'sessions/s1/attachments/floor-plan.enc',
            name: 'floor-plan.pdf',
            size: 4096,
            kind: 'file',
            mimeType: 'application/pdf',
        },
    } as any;
}

describe('FileView media playback', () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        mocks.release.mockClear();
        mocks.isSharingAvailable.mockClear();
        mocks.share.mockClear();
        mocks.resolveSource.mockClear();
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => consoleWarnSpy.mockRestore());

    it('renders a generated plaintext MP4 directly without a file card', async () => {
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(
                <FileView tool={videoTool({ encrypted: false, source: 'generated' })} sessionId="s1" metadata={null} messages={[]} />,
            );
        });

        expect(mocks.resolveSource).toHaveBeenCalledWith(expect.objectContaining({ encrypted: false }));
        expect(renderer.root.findAllByProps({ testID: 'media-attachment-card-generated' })).toHaveLength(0);
        expect(renderer.root.findByType('MediaAttachmentPlayer').props).toMatchObject({
            uri: 'https://files.test/acceptance.mp4',
            kind: 'video',
            testID: 'media-attachment-player-generated',
        });

        act(() => renderer.unmount());
        expect(mocks.release).toHaveBeenCalledTimes(1);
    });

    it('renders an encrypted user MP4 directly through the same player component', async () => {
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(
                <FileView tool={videoTool()} sessionId="s1" metadata={null} messages={[]} />,
            );
        });

        expect(mocks.resolveSource).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 's1',
            encrypted: undefined,
            mimeType: 'video/mp4',
        }));
        expect(renderer.root.findAllByProps({ testID: 'media-attachment-card-user' })).toHaveLength(0);
        expect(renderer.root.findByType('MediaAttachmentPlayer').props.testID).toBe('media-attachment-player-user');
        act(() => renderer.unmount());
    });

    it('renders an encrypted PDF as a document card and shares the decrypted file on press', async () => {
        mocks.resolveSource.mockResolvedValueOnce({
            uri: 'file:///tmp/floor-plan.pdf',
            headers: {},
            release: mocks.release,
        });
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(
                <FileView tool={pdfTool()} sessionId="s1" metadata={null} messages={[]} />,
            );
        });

        const card = renderer.root.findByProps({ testID: 'document-attachment-card-user' });
        expect(mocks.resolveSource).not.toHaveBeenCalled();

        await act(async () => {
            await card.props.onPress();
        });

        expect(mocks.resolveSource).toHaveBeenCalledWith({
            sessionId: 's1',
            ref: 'sessions/s1/attachments/floor-plan.enc',
            mimeType: 'application/pdf',
            fileName: 'floor-plan.pdf',
            encrypted: undefined,
        });
        expect(mocks.share).toHaveBeenCalledWith('file:///tmp/floor-plan.pdf', {
            dialogTitle: 'floor-plan.pdf',
            mimeType: 'application/pdf',
        });
        expect(mocks.release).toHaveBeenCalledTimes(1);
        act(() => renderer.unmount());
    });
});
