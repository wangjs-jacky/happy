import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';
import { RelationshipAdvisorMessageImages } from './RelationshipAdvisorMessageImages';
import { imageViewer, useImageViewerStore } from '@/sync/imageViewer';

const cache = vi.hoisted(() => ({ load: vi.fn(), listeners: new Set<(key: string) => void>() }));
vi.mock('@/sync/relationshipAdvisorImageCache', () => ({
    loadAdvisorImageSource: cache.load,
}));
vi.mock('@/sync/relationshipAdvisorImageEvents', () => ({
    subscribeAdvisorImageChanges: (listener: (key: string) => void) => {
        cache.listeners.add(listener);
        return () => cache.listeners.delete(listener);
    },
}));
vi.mock('react-native', () => ({ View: 'View', Pressable: 'Pressable', Text: 'Text', ActivityIndicator: 'ActivityIndicator' }));
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: { create: (factory: any) => factory({ colors: { surface: 'surface', surfacePressed: 'pressed', divider: 'border' } }) },
    useUnistyles: () => ({ theme: { colors: { textSecondary: 'muted', divider: 'border' } } }),
}));

describe('advisor message images', () => {
    let renderer: any;
    beforeEach(() => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        cache.load.mockReset();
        cache.load.mockImplementation(async (key: string) => ({ uri: `blob:${key}`, release: vi.fn() }));
    });
    afterEach(() => {
        act(() => renderer?.unmount());
        imageViewer.close(); imageViewer.clear();
    });
    const mount = async (keys = ['first.png', 'second.jpg']) => {
        await act(async () => { renderer = TestRenderer.create(<RelationshipAdvisorMessageImages imageKeys={keys} imageCount={keys.length} />); });
    };

    it('renders saved images, not only a count, and opens the shared viewer in message order', async () => {
        await mount();
        expect(renderer.root.findAllByType('Image').map((image: any) => image.props.source.uri))
            .toEqual(['blob:first.png', 'blob:second.jpg']);
        act(() => renderer.root.findAllByType('Pressable')[1].props.onPress());
        expect(useImageViewerStore.getState()).toMatchObject({ visible: true, index: 1,
            sources: [{ uri: 'blob:first.png' }, { uri: 'blob:second.jpg' }] });
    });

    it('updates an optimistic message when its local original finishes saving', async () => {
        cache.load.mockRejectedValueOnce(new Error('not saved yet'));
        await mount(['first.png']);
        expect(renderer.root.findAllByType('Image')).toHaveLength(0);
        await act(async () => cache.listeners.forEach(listener => listener('first.png')));
        expect(renderer.root.findByType('Image').props.source.uri).toBe('blob:first.png');
    });

    it('does not show another message or leak a URL when a stale read finishes', async () => {
        let resolveOld: (source: any) => void = () => {};
        const releaseOld = vi.fn();
        cache.load.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
        await mount(['old.png']);
        await act(async () => renderer.update(<RelationshipAdvisorMessageImages imageKeys={['new.png']} imageCount={1} />));
        await act(async () => resolveOld({ uri: 'blob:old.png', release: releaseOld }));
        expect(renderer.root.findByType('Image').props.source.uri).toBe('blob:new.png');
        expect(releaseOld).toHaveBeenCalledOnce();
    });

    it('shows an unavailable placeholder for old history with no original', async () => {
        await act(async () => { renderer = TestRenderer.create(<RelationshipAdvisorMessageImages imageCount={1} />); });
        expect(renderer.root.findAllByType('Image')).toHaveLength(0);
        expect(renderer.root.findByType('Text').children.join('')).toBe('imageUpload.mediaLoadFailed');
    });

    it('releases local URLs and dismisses their viewer when the message is removed', async () => {
        const release = vi.fn();
        cache.load.mockResolvedValue({ uri: 'blob:first.png', release });
        await mount(['first.png']);
        act(() => renderer.root.findByType('Pressable').props.onPress());
        act(() => renderer.unmount());
        expect(release).toHaveBeenCalledOnce();
        expect(useImageViewerStore.getState()).toMatchObject({ visible: false, sources: [] });
    });

    it('keeps the first image viewer open while another original finishes saving', async () => {
        cache.load.mockImplementation(async (key: string) => {
            if (key === 'second.jpg') throw new Error('saving');
            return { uri: 'blob:first.png', release: vi.fn() };
        });
        await mount();
        act(() => renderer.root.findByType('Pressable').props.onPress());
        cache.load.mockImplementation(async (key: string) => ({ uri: `blob:new-${key}`, release: vi.fn() }));
        await act(async () => cache.listeners.forEach(listener => listener('second.jpg')));
        expect(useImageViewerStore.getState().visible).toBe(true);
        expect(renderer.root.findAllByType('Image').map((image: any) => image.props.source.uri))
            .toEqual(['blob:first.png', 'blob:new-second.jpg']);
    });
});
