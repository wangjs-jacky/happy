/**
 * Single mount point for the global fullscreen image viewer.
 * Subscribes to the `imageViewer` store and renders `ImageViewer` inside a
 * native Modal so it sits above all navigation. The Modal hosts a fresh
 * GestureHandlerRootView because RN Modal content is a separate view root —
 * gesture-handler gestures would otherwise not fire inside it.
 *
 * Mounted once in app/_layout.tsx.
 */
import * as React from 'react';
import { Modal, StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SessionImageViewer } from './SessionImageViewer';
import { useImageViewerStore } from '@/sync/imageViewer';
import { releaseImageViewerImageCache } from '@/hooks/useAttachmentImage';

export function ImageViewerHost() {
    const visible = useImageViewerStore((s) => s.visible);
    const sources = useImageViewerStore((s) => s.sources);
    const index = useImageViewerStore((s) => s.index);
    const openId = useImageViewerStore((s) => s.openId);
    const close = useImageViewerStore((s) => s.close);
    const clear = useImageViewerStore((s) => s.clear);
    const handleDismiss = React.useCallback(() => {
        releaseImageViewerImageCache();
        clear();
    }, [clear]);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            statusBarTranslucent
            onRequestClose={close}
            onDismiss={handleDismiss}
        >
            <StatusBar backgroundColor="#000" barStyle="light-content" />
            <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
                {sources.length > 0 && (
                    <SessionImageViewer key={openId} sources={sources} initialIndex={index} onClose={close} active={visible} />
                )}
            </GestureHandlerRootView>
        </Modal>
    );
}
