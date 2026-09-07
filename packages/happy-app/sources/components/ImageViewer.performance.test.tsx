import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error react-test-renderer does not publish declarations here.
import TestRenderer from 'react-test-renderer';

import { ImageViewer } from './ImageViewer';
import { downloadImage } from '@/utils/imageDownload';
import { resolveMediaAttachmentSource } from '@/sync/resolveMediaAttachmentSource';
const attachment = vi.hoisted(() => ({
    state: { uri: null, loading: false, error: null } as { uri: string | null; loading: boolean; error: string | null },
    loads: vi.fn(),
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const ScrollView = ReactModule.forwardRef((props: any, _ref) => (
        ReactModule.createElement('ScrollView', props, props.children)
    ));
    return {
        ActivityIndicator: 'ActivityIndicator',
        NativeScrollEvent: {},
        NativeSyntheticEvent: {},
        Platform: { OS: 'web' },
        Pressable: 'Pressable',
        ScrollView,
        StyleSheet: {
            absoluteFillObject: {},
            create: (styles: object) => styles,
            hairlineWidth: 1,
        },
        Text: 'Text',
        View: 'View',
        useWindowDimensions: () => ({ width: 1280, height: 800 }),
    };
});
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('react-native-unistyles', () => ({ useUnistyles: () => ({ theme: { colors: {
    surface: 'navy', surfacePressed: 'blue', text: 'white',
} } }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('react-native-reanimated', () => ({
    default: { View: 'AnimatedView' },
    Extrapolation: { CLAMP: 'clamp' },
    interpolate: () => 1,
    runOnJS: (fn: (...args: any[]) => unknown) => fn,
    useAnimatedStyle: (factory: () => object) => factory(),
    useSharedValue: (value: number) => ({ value }),
    withTiming: (value: number) => value,
}));
vi.mock('react-native-gesture-handler', () => {
    const gesture = () => {
        const chain: Record<string, any> = {};
        for (const method of ['activeOffsetY', 'enabled', 'failOffsetX', 'numberOfTaps', 'onEnd', 'onUpdate']) {
            chain[method] = () => chain;
        }
        return chain;
    };
    return {
        Gesture: {
            Exclusive: gesture,
            Pan: gesture,
            Pinch: gesture,
            Simultaneous: gesture,
            Tap: gesture,
        },
        GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    };
});
vi.mock('@/utils/imageDownload', () => ({ downloadImage: vi.fn() }));
vi.mock('@/hooks/useAttachmentImage', () => ({
    useAttachmentImage: () => { attachment.loads(); return attachment.state; },
}));
vi.mock('@/sync/resolveMotionPhotoAttachmentSource', () => ({
    resolveMotionPhotoAttachmentSource: vi.fn(),
}));
vi.mock('@/sync/resolveMediaAttachmentSource', () => ({ resolveMediaAttachmentSource: vi.fn() }));
vi.mock('@/components/tools/views/MediaAttachmentPlayer', () => ({
    MediaAttachmentPlayer: 'MediaAttachmentPlayer',
}));
vi.mock('@/components/DesktopShortcutTooltip', () => ({
    DesktopShortcutTooltip: 'DesktopShortcutTooltip',
}));
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn() } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

describe('ImageViewer large gallery performance', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        attachment.state = { uri: null, loading: false, error: null };
        attachment.loads.mockClear();
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        consoleErrorSpy.mockRestore();
    });

    it('mounts only the focused image and its neighbours for a large gallery', () => {
        const sources = Array.from({ length: 100 }, (_, index) => ({
            uri: `blob:image-${index}`,
            width: 3840,
            height: 2560,
        }));
        let renderer: any;

        act(() => {
            renderer = TestRenderer.create(
                <ImageViewer sources={sources} initialIndex={50} onClose={() => {}} />,
            );
        });

        const mountedUris = renderer.root
            .findAllByType('Image')
            .map((node: any) => node.props.source.uri);

        expect(mountedUris).toContain('blob:image-50');
        expect(mountedUris.length).toBeLessThanOrEqual(3);

        act(() => renderer.unmount());
    });

    it('navigates across images using buttons and focused keyboard events, with bounded edges', () => {
        const onClose = vi.fn();
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<ImageViewer
                sources={[{ uri: 'first' }, { uri: 'second' }, { uri: 'third' }]}
                initialIndex={1} onClose={onClose}
            />);
        });
        const activeUri = () => renderer.root.findByProps({ testID: 'image-viewer-image' }).props.source.uri;
        expect(activeUri()).toBe('second');
        act(() => renderer.root.findByProps({ testID: 'image-viewer-previous' }).props.onPress());
        expect(activeUri()).toBe('first');
        expect(renderer.root.findByProps({ testID: 'image-viewer-previous' }).props.disabled).toBe(true);
        const key = (value: string) => act(() => renderer.root.findByProps({ testID: 'image-viewer' }).props.onKeyDown({
            key: value, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(),
        }));
        key('ArrowLeft');
        expect(activeUri()).toBe('first');
        key('ArrowRight');
        key('ArrowRight');
        expect(activeUri()).toBe('third');
        expect(renderer.root.findByProps({ testID: 'image-viewer-next' }).props.disabled).toBe(true);
        key('Escape');
        expect(onClose).toHaveBeenCalledOnce();
        act(() => renderer.unmount());
    });

    it('shows loading for unresolved history and retries failures without blocking navigation', () => {
        vi.useFakeTimers();
        attachment.state = { uri: null, loading: false, error: 'offline' };
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<ImageViewer sources={[
                { uri: '', sessionId: 's1', attachmentRef: 'old' }, { uri: 'latest' },
            ]} initialIndex={0} onClose={() => {}} />);
        });
        expect(renderer.root.findByProps({ testID: 'image-viewer-loading' })).toBeTruthy();
        const before = attachment.loads.mock.calls.length;
        act(() => vi.advanceTimersByTime(2000));
        expect(attachment.loads.mock.calls.length).toBeGreaterThan(before);
        act(() => renderer.root.findByProps({ testID: 'image-viewer-next' }).props.onPress());
        expect(renderer.root.findByProps({ testID: 'image-viewer-image' }).props.source.uri).toBe('latest');
        act(() => renderer.unmount());
        expect(vi.getTimerCount()).toBe(0);
    });

    it('loads the previous history page at the left edge and lands on the preceding image', async () => {
        let finish!: (value: any) => void;
        const loadEarlier = vi.fn(() => new Promise<any>(resolve => { finish = resolve; }));
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<ImageViewer sources={[{ uri: 'new', attachmentRef: 'new' }]}
                initialIndex={0} onClose={() => {}} hasEarlier loadEarlier={loadEarlier} />);
        });
        act(() => renderer.root.findByProps({ testID: 'image-viewer-previous' }).props.onPress());
        expect(renderer.root.findByProps({ testID: 'image-viewer-history-loading' })).toBeTruthy();
        await act(async () => finish([{ uri: 'oldest', attachmentRef: 'oldest' }, { uri: 'old', attachmentRef: 'old' }, { uri: 'new', attachmentRef: 'new' }]));
        // A native ScrollView may report its old offset before the prepended
        // pages have laid out. That event must not replace the requested image.
        act(() => renderer.root.findByType('ScrollView').props.onScroll({ nativeEvent: { contentOffset: { x: 0 } } }));
        expect(renderer.root.findByProps({ testID: 'image-viewer-image' }).props.source.uri).toBe('old');
        act(() => renderer.root.findByType('ScrollView').props.onContentSizeChange());
        act(() => renderer.root.findByProps({ testID: 'image-viewer-next' }).props.onPress());
        expect(renderer.root.findByProps({ testID: 'image-viewer-image' }).props.source.uri).toBe('new');
        act(() => renderer.unmount());
    });

    it('does not jump back when an older-page request finishes after swiping to a newer image', async () => {
        let finish!: (value: any) => void;
        const loadEarlier = vi.fn(() => new Promise<any>(resolve => { finish = resolve; }));
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<ImageViewer
            sources={[{ uri: 'first', attachmentRef: 'first' }, { uri: 'second', attachmentRef: 'second' }]}
            initialIndex={0} onClose={() => {}} hasEarlier loadEarlier={loadEarlier} />); });
        act(() => renderer.root.findByProps({ testID: 'image-viewer-previous' }).props.onPress());
        act(() => renderer.root.findByType('ScrollView').props.onScroll({ nativeEvent: { contentOffset: { x: 1280 } } }));
        await act(async () => finish([{ uri: 'old', attachmentRef: 'old' }, { uri: 'first', attachmentRef: 'first' }, { uri: 'second', attachmentRef: 'second' }]));
        expect(renderer.root.findByProps({ testID: 'image-viewer-image' }).props.source.uri).toBe('second');
        expect(renderer.root.findAllByProps({ testID: 'image-viewer-history-loading' })).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it('still offers older images loaded concurrently even after server pagination is exhausted', () => {
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<ImageViewer sources={[{ uri: 'new', attachmentRef: 'new' }]}
            initialIndex={0} onClose={() => {}} hasEarlier={false} earliestAvailableRef="old" loadEarlier={vi.fn()} />); });
        expect(renderer.root.findByProps({ testID: 'image-viewer-previous' }).props.disabled).toBe(false);
        act(() => renderer.unmount());
    });

    it('cancels pagination when the host hides the modal before its dismiss animation completes', async () => {
        let finish!: (value: any) => void;
        let signal!: AbortSignal;
        const loadEarlier = vi.fn((_sources, requestSignal) => { signal = requestSignal; return new Promise<any>(resolve => { finish = resolve; }); });
        const props = { sources: [{ uri: 'new', attachmentRef: 'new' }], initialIndex: 0, onClose: () => {}, hasEarlier: true, loadEarlier };
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<ImageViewer {...props} />); });
        act(() => renderer.root.findByProps({ testID: 'image-viewer-previous' }).props.onPress());
        act(() => renderer.update(<ImageViewer {...props} active={false} />));
        expect(signal.aborted).toBe(true);
        await act(async () => finish([{ uri: 'old', attachmentRef: 'old' }, ...props.sources]));
        expect(renderer.root.findByProps({ testID: 'image-viewer-image' }).props.source.uri).toBe('new');
        act(() => renderer.unmount());
    });

    it('downloads the original for a historical image with no thumbnail URI and releases it after the browser consumes it', async () => {
        vi.useFakeTimers();
        const release = vi.fn();
        vi.mocked(resolveMediaAttachmentSource).mockResolvedValue({ uri: 'blob:original', headers: {}, release });
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<ImageViewer sources={[
                { uri: '', sessionId: 's1', attachmentRef: 'old', filename: 'old.jpg' },
            ]} initialIndex={0} onClose={() => {}} />);
        });
        await act(async () => renderer.root.findByProps({ accessibilityLabel: 'imageViewer.download' }).props.onPress());
        expect(resolveMediaAttachmentSource).toHaveBeenCalledWith({
            sessionId: 's1', ref: 'old', fileName: 'old.jpg', mimeType: 'image/jpeg',
        });
        expect(downloadImage).toHaveBeenCalledWith(expect.objectContaining({ uri: 'blob:original', filename: 'old.jpg' }), expect.anything());
        expect(release).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(60_000));
        expect(release).toHaveBeenCalledOnce();
        act(() => renderer.unmount());
    });
});
