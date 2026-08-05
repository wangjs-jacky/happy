import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileView } from './FileView';

// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    requestSource: vi.fn(async () => ({ uri: 'https://files.test/acceptance.mp4', headers: {} })),
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
vi.mock('@/sync/apiAttachments', () => ({ requestAttachmentDownloadSource: mocks.requestSource }));
vi.mock('@/sync/sync', () => ({ sync: { getCredentials: () => ({ token: 'token' }) } }));
vi.mock('./MediaAttachmentPlayer', () => ({ MediaAttachmentPlayer: 'MediaAttachmentPlayer' }));
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

function videoTool(encrypted?: boolean) {
    return {
        name: 'file',
        state: 'completed',
        input: {
            ref: 'sessions/s1/attachments/acceptance.mp4',
            name: 'acceptance.mp4',
            size: 4096,
            kind: 'video',
            mimeType: 'video/mp4',
            encrypted,
            source: 'generated',
        },
    } as any;
}

describe('FileView media playback', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        mocks.requestSource.mockClear();
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => consoleErrorSpy.mockRestore());

    it('opens a generated plaintext MP4 in the inline phone player', async () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<FileView tool={videoTool(false)} sessionId="s1" metadata={null} messages={[]} />);
        });

        const card = renderer.root.findByProps({ testID: 'media-attachment-card' });
        expect(card.props.accessibilityRole).toBe('button');
        expect(card.props.accessibilityLabel).toContain('acceptance.mp4');

        await act(async () => card.props.onPress());

        expect(mocks.requestSource).toHaveBeenCalledWith({ token: 'token' }, 's1', 'sessions/s1/attachments/acceptance.mp4');
        expect(renderer.root.findByType('MediaAttachmentPlayer').props).toMatchObject({
            uri: 'https://files.test/acceptance.mp4',
            kind: 'video',
        });
        act(() => renderer.unmount());
    });

    it('does not present legacy encrypted media as directly playable', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<FileView tool={videoTool(undefined)} sessionId="s1" metadata={null} messages={[]} />);
        });

        const card = renderer.root.findByProps({ testID: 'media-attachment-card' });
        expect(card.props.disabled).toBe(true);
        expect(card.props.onPress).toBeUndefined();
        act(() => renderer.unmount());
    });
});
