import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawerGestureContext } from 'react-native-drawer-layout';
import { ExternalHorizontalGestureContext } from '@/components/ExternalHorizontalGestureContext';
import { MediaAttachmentPlayer } from './MediaAttachmentPlayer';

// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    gestureHandlers: {} as Record<string, (...args: any[]) => void>,
    blocksExternalGesture: vi.fn(),
    nativeGesture: {} as Record<string, unknown>,
    panGesture: {} as Record<string, unknown>,
    simultaneousGestures: [] as unknown[],
}));

vi.mock('react-native-webview', () => ({ WebView: 'WebView' }));
vi.mock('react-native-drawer-layout', async () => {
    const ReactModule = await vi.importActual<typeof import('react')>('react');
    return { DrawerGestureContext: ReactModule.createContext(null) };
});
vi.mock('react-native-reanimated', () => ({
    useSharedValue: (value: unknown) => ({ value }),
}));
vi.mock('react-native-gesture-handler', () => {
    const nativeGesture = () => mocks.nativeGesture;
    const panGesture = () => {
        const pan: Record<string, any> = mocks.panGesture;
        for (const method of ['manualActivation', 'onTouchesDown', 'onTouchesMove']) {
            pan[method] = (value: unknown) => {
                if (method.startsWith('on') && typeof value === 'function') {
                    mocks.gestureHandlers[method] = value as (...args: any[]) => void;
                }
                return pan;
            };
        }
        pan.blocksExternalGesture = (...gestures: unknown[]) => {
            mocks.blocksExternalGesture(...gestures);
            return pan;
        };
        return pan;
    };
    return {
        Gesture: {
            Native: vi.fn(nativeGesture),
            Pan: vi.fn(panGesture),
            Simultaneous: vi.fn((...gestures: unknown[]) => {
                mocks.simultaneousGestures = gestures;
                return { gestures };
            }),
        },
        GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    };
});

describe('MediaAttachmentPlayer native video document', () => {
    beforeEach(() => {
        mocks.gestureHandlers = {};
        mocks.blocksExternalGesture.mockClear();
        mocks.nativeGesture = {};
        mocks.panGesture = {};
        mocks.simultaneousGestures = [];
    });

    afterEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    });

    it('loads a real video element with visible native controls instead of navigating the WebView to MP4 bytes', async () => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(
                <MediaAttachmentPlayer
                    uri="file:///cache/acceptance.mp4"
                    headers={{}}
                    title="acceptance.mp4"
                    kind="video"
                    mimeType="video/mp4"
                    testID="native-video"
                />,
            );
        });

        const webView = renderer.root.findByType('WebView');
        expect(webView.props.source.uri).toBeUndefined();
        expect(webView.props.source.html).toContain('<video');
        expect(webView.props.source.html).toContain('controls');
        expect(webView.props.source.html).toContain('playsinline');
        expect(webView.props.source.html).toContain('file:///cache/acceptance.mp4');
        expect(webView.props.source.baseUrl).toBe('file:///cache/');
        expect(webView.props.allowFileAccess).toBe(true);
        expect(webView.props.allowingReadAccessToURL).toBe('file:///cache/');

        await act(async () => renderer.unmount());
    });

    it('claims horizontal seek drags from both full-screen panel gestures while yielding vertical chat scroll', async () => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        const leftDrawerGesture = { id: 'left-drawer' } as any;
        const rightPanelGesture = { id: 'right-panel' } as any;
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(
                <DrawerGestureContext.Provider value={leftDrawerGesture}>
                    <ExternalHorizontalGestureContext.Provider value={[rightPanelGesture]}>
                        <MediaAttachmentPlayer
                            uri="file:///cache/acceptance.mp4"
                            headers={{}}
                            title="acceptance.mp4"
                            kind="video"
                            mimeType="video/mp4"
                            testID="native-video"
                        />
                    </ExternalHorizontalGestureContext.Provider>
                </DrawerGestureContext.Provider>,
            );
        });

        expect(mocks.blocksExternalGesture).toHaveBeenCalledWith(leftDrawerGesture, rightPanelGesture);
        expect(mocks.simultaneousGestures).toEqual([mocks.nativeGesture, mocks.panGesture]);

        const horizontalState = { activate: vi.fn(), fail: vi.fn() };
        mocks.gestureHandlers.onTouchesDown({ allTouches: [{ x: 40, y: 20 }] });
        mocks.gestureHandlers.onTouchesMove({ allTouches: [{ x: 58, y: 22 }] }, horizontalState);
        expect(horizontalState.activate).toHaveBeenCalledOnce();
        expect(horizontalState.fail).not.toHaveBeenCalled();

        const verticalState = { activate: vi.fn(), fail: vi.fn() };
        mocks.gestureHandlers.onTouchesDown({ allTouches: [{ x: 40, y: 20 }] });
        mocks.gestureHandlers.onTouchesMove({ allTouches: [{ x: 42, y: 38 }] }, verticalState);
        expect(verticalState.fail).toHaveBeenCalledOnce();
        expect(verticalState.activate).not.toHaveBeenCalled();

        await act(async () => renderer.unmount());
    });
});
