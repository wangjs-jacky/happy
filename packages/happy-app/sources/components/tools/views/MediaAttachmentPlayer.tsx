import * as React from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { DrawerGestureContext } from 'react-native-drawer-layout';
import { useSharedValue } from 'react-native-reanimated';
import { WebView } from 'react-native-webview';
import { ExternalHorizontalGestureContext } from '@/components/ExternalHorizontalGestureContext';
import type { MediaAttachmentPlayerProps } from './MediaAttachmentPlayer.types';

export type { MediaAttachmentPlayerProps } from './MediaAttachmentPlayer.types';

const SEEK_GESTURE_DECIDE_OFFSET = 6;

function escapeHtmlAttribute(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function mediaDocument(props: MediaAttachmentPlayerProps): string {
    const tag = props.kind === 'audio' ? 'audio' : 'video';
    const uri = escapeHtmlAttribute(props.uri);
    const mimeType = escapeHtmlAttribute(props.mimeType);
    const title = escapeHtmlAttribute(props.title);
    return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}
${tag}{display:block;width:100%;height:100%;object-fit:contain;background:#000}
</style>
</head>
<body>
<${tag} controls playsinline webkit-playsinline preload="metadata" aria-label="${title}">
<source src="${uri}" type="${mimeType}">
</${tag}>
</body>
</html>`;
}

function mediaBaseUrl(uri: string): string | undefined {
    if (!uri.startsWith('file:')) return undefined;
    const lastSlash = uri.lastIndexOf('/');
    return lastSlash >= 0 ? uri.slice(0, lastSlash + 1) : undefined;
}

export function MediaAttachmentPlayer(props: MediaAttachmentPlayerProps) {
    const drawerPan = React.useContext(DrawerGestureContext);
    const externalHorizontalGestures = React.useContext(ExternalHorizontalGestureContext);
    const startX = useSharedValue(0);
    const startY = useSharedValue(0);
    const decided = useSharedValue(false);
    const style = props.kind === 'audio'
        ? { width: 300, maxWidth: '100%' as const, height: 64, backgroundColor: '#000' }
        : {
            width: '100%' as const,
            maxWidth: 960,
            aspectRatio: 16 / 9,
            backgroundColor: '#000',
            borderRadius: 12,
            overflow: 'hidden' as const,
        };
    const baseUrl = mediaBaseUrl(props.uri);
    const playbackGesture = React.useMemo(() => {
        // Keep WebView's own recognizer alive for native media controls. The
        // manual Pan only arbitrates with the two full-screen panel gestures:
        // horizontal drags belong to the seek bar, while vertical drags yield
        // so the surrounding chat can continue scrolling naturally.
        const native = Gesture.Native();
        const arbiter = Gesture.Pan()
            .manualActivation(true)
            .onTouchesDown((event) => {
                'worklet';
                const touch = event.allTouches[0];
                if (!touch) return;
                startX.value = touch.x;
                startY.value = touch.y;
                decided.value = false;
            })
            .onTouchesMove((event, state) => {
                'worklet';
                if (decided.value) return;
                const touch = event.allTouches[0];
                if (!touch) return;
                const dx = touch.x - startX.value;
                const dy = touch.y - startY.value;
                const absX = Math.abs(dx);
                const absY = Math.abs(dy);
                if (absX < SEEK_GESTURE_DECIDE_OFFSET && absY < SEEK_GESTURE_DECIDE_OFFSET) return;
                decided.value = true;
                if (absY > absX) {
                    state.fail();
                    return;
                }
                state.activate();
            });

        const gesturesToBlock = drawerPan
            ? [drawerPan, ...externalHorizontalGestures]
            : externalHorizontalGestures;
        if (gesturesToBlock.length > 0) {
            arbiter.blocksExternalGesture(...gesturesToBlock);
        }
        return Gesture.Simultaneous(native, arbiter);
    }, [decided, drawerPan, externalHorizontalGestures, startX, startY]);

    return (
        <GestureDetector gesture={playbackGesture}>
            <WebView
                testID={props.testID}
                source={{ html: mediaDocument(props), ...(baseUrl ? { baseUrl } : {}) }}
                style={style}
                originWhitelist={['*']}
                allowFileAccess
                allowingReadAccessToURL={baseUrl}
                allowsFullscreenVideo
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction
                androidLayerType="hardware"
                accessibilityLabel={props.title}
            />
        </GestureDetector>
    );
}
