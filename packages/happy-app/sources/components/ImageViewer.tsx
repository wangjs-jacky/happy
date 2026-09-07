/**
 * Fullscreen, swipeable, pinch-to-zoom image viewer.
 *
 * Presented globally via the `imageViewer` store (see sync/imageViewer.ts) and
 * mounted once through `ImageViewerHost`. The viewer is a horizontal pager:
 * each page is one image with its own zoom/pan state, and a paging ScrollView
 * lets the user swipe left/right between every image in the run (Kimi-style).
 *
 * Per image:
 *   - pinch to zoom (clamped 1x–4x)
 *   - pan when zoomed in (bounded to image edges)
 *   - double-tap to toggle zoom
 *   - swipe-down (while at 1x) to dismiss, with backdrop fade
 *   - single tap / close button to dismiss
 *
 * Gesture vs. paging: while an image is at 1x, horizontal swipes belong to the
 * pager (the dismiss pan only claims vertical movement); once zoomed in, paging
 * is disabled so the pan can move the image freely. A counter ("2 / 5") shows
 * the position whenever there is more than one image.
 *
 * expo-image is used directly (no Unistyles) per the repo styling convention.
 */
import * as React from 'react';
import { ActivityIndicator, View, Text, Pressable, useWindowDimensions, StyleSheet, Platform, ScrollView, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    runOnJS,
    interpolate,
    Extrapolation,
    SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ImageViewerSource } from '@/sync/imageViewer';
import { downloadImage } from '@/utils/imageDownload';
import { getImageDownloadMimeType } from '@/utils/imageDownloadCore';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useAttachmentImage } from '@/hooks/useAttachmentImage';
import { resolveMotionPhotoAttachmentSource } from '@/sync/resolveMotionPhotoAttachmentSource';
import { resolveMediaAttachmentSource } from '@/sync/resolveMediaAttachmentSource';
import type { MediaPlaybackSource } from '@/sync/mediaPlaybackSourceTypes';
import { MediaAttachmentPlayer } from '@/components/tools/views/MediaAttachmentPlayer';
import { DesktopShortcutTooltip } from '@/components/DesktopShortcutTooltip';
import { useUnistyles } from 'react-native-unistyles';

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const CLOSE_TRANSLATE_Y = 120; // swipe-down distance that dismisses
const PAGE_OVERSCAN = 1;

interface ImageViewerProps {
    sources: ImageViewerSource[];
    initialIndex: number;
    onClose: () => void;
    active?: boolean;
    hasEarlier?: boolean;
    earliestAvailableRef?: string;
    loadEarlier?: (sources: ImageViewerSource[], signal: AbortSignal) => Promise<ImageViewerSource[]>;
}

export function ImageViewer({ sources: initialSources, initialIndex, onClose, active = true, hasEarlier: hasUnloadedEarlier = false, earliestAvailableRef, loadEarlier }: ImageViewerProps) {
    const [sources, setSources] = React.useState(initialSources);
    const hasEarlier = hasUnloadedEarlier || (!!earliestAvailableRef && earliestAvailableRef !== sources[0]?.attachmentRef);
    const [loadingEarlier, setLoadingEarlier] = React.useState(false);
    const historyRequest = React.useRef<AbortController | null>(null);
    React.useEffect(() => () => historyRequest.current?.abort(), []);
    React.useEffect(() => { if (!active) historyRequest.current?.abort(); }, [active]);
    const { theme } = useUnistyles();
    const { width: screenW, height: screenH } = useWindowDimensions();
    const insets = useSafeAreaInsets();

    const scrollRef = React.useRef<ScrollView>(null);
    const pendingHistoryIndex = React.useRef<number | null>(null);
    const rootRef = React.useRef<View>(null);
    const [currentIndex, setCurrentIndex] = React.useState(initialIndex);
    // Paging is disabled while the active image is zoomed in, so the pan gesture
    // can move the image instead of the pager swallowing the drag.
    const [pagingEnabled, setPagingEnabled] = React.useState(true);
    // Shared backdrop opacity — the active page's swipe-down drives the fade.
    const backdropOpacity = useSharedValue(1);
    const [downloadBusy, setDownloadBusy] = React.useState(false);
    const [motionSource, setMotionSource] = React.useState<MediaPlaybackSource | null>(null);
    const [motionLoading, setMotionLoading] = React.useState(false);
    const [motionError, setMotionError] = React.useState(false);
    const [motionHovered, setMotionHovered] = React.useState(false);
    const [motionFocused, setMotionFocused] = React.useState(false);
    const motionSourceRef = React.useRef<MediaPlaybackSource | null>(null);
    const motionRequest = React.useRef(0);

    // Android honors contentOffset unreliably; jump to the tapped image once we
    // know the screen width.
    const onScrollLayout = React.useCallback(() => {
        scrollRef.current?.scrollTo({ x: currentIndex * screenW, y: 0, animated: false });
    }, [currentIndex, screenW]);

    React.useEffect(() => {
        if (Platform.OS === 'web') rootRef.current?.focus();
    }, []);

    const updateCurrentIndex = React.useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (pendingHistoryIndex.current !== null) return;
        const next = Math.max(0, Math.min(
            Math.round(e.nativeEvent.contentOffset.x / screenW),
            sources.length - 1,
        ));
        if (next !== currentIndex) {
            historyRequest.current?.abort();
            historyRequest.current = null;
            setLoadingEarlier(false);
        }
        setCurrentIndex((prev) => (prev === next ? prev : next));
    }, [currentIndex, screenW, sources.length]);

    const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

    const single = sources.length === 1;
    const currentSource = sources[currentIndex];
    const currentSourceKey = currentSource
        ? `${currentIndex}:${currentSource.sessionId ?? ''}:${currentSource.attachmentRef ?? currentSource.filename ?? ''}`
        : '';
    const windowStart = Math.max(0, currentIndex - PAGE_OVERSCAN);
    const windowEnd = Math.min(sources.length - 1, currentIndex + PAGE_OVERSCAN);
    const visibleSources = sources.slice(windowStart, windowEnd + 1);
    const leadingWidth = windowStart * screenW;
    const trailingWidth = Math.max(0, (sources.length - windowEnd - 1) * screenW);

    const handleZoomChange = React.useCallback((zoomed: boolean) => {
        setPagingEnabled(!zoomed);
    }, []);

    const stopMotionPhoto = React.useCallback(() => {
        motionRequest.current += 1;
        const source = motionSourceRef.current;
        motionSourceRef.current = null;
        setMotionSource(null);
        setMotionLoading(false);
        setMotionError(false);
        void source?.release?.();
    }, []);

    React.useEffect(() => {
        stopMotionPhoto();
    }, [currentSourceKey, stopMotionPhoto]);

    React.useEffect(() => () => {
        motionRequest.current += 1;
        void motionSourceRef.current?.release?.();
        motionSourceRef.current = null;
    }, []);

    const handleMotionToggle = React.useCallback(() => {
        if (motionSource) {
            stopMotionPhoto();
            return;
        }
        if (
            !currentSource?.motionPhoto
            || !currentSource.sessionId
            || !currentSource.attachmentRef
            || motionLoading
        ) return;

        const request = ++motionRequest.current;
        setMotionLoading(true);
        setMotionError(false);
        void resolveMotionPhotoAttachmentSource({
            sessionId: currentSource.sessionId,
            ref: currentSource.attachmentRef,
            fileName: currentSource.filename ?? 'motion-photo.jpg',
        }).then((source) => {
            if (motionRequest.current !== request) {
                void source.release?.();
                return;
            }
            motionSourceRef.current = source;
            setMotionSource(source);
        }).catch((cause) => {
            if (motionRequest.current !== request) return;
            console.warn('[motion-photo] failed to open in image viewer', cause);
            setMotionError(true);
        }).finally(() => {
            if (motionRequest.current === request) setMotionLoading(false);
        });
    }, [currentSource, motionLoading, motionSource, stopMotionPhoto]);

    const handleClose = React.useCallback(() => {
        historyRequest.current?.abort();
        stopMotionPhoto();
        onClose();
    }, [onClose, stopMotionPhoto]);

    const navigate = React.useCallback((direction: number) => {
        if (direction < 0 && currentIndex === 0 && hasEarlier && loadEarlier) {
            if (historyRequest.current) return;
            const controller = new AbortController();
            historyRequest.current = controller;
            setLoadingEarlier(true);
            if (Platform.OS === 'web') rootRef.current?.focus();
            void (async () => {
                let retryMs = 1000;
                try {
                    while (!controller.signal.aborted) {
                        try {
                            const earlier = await loadEarlier(sources, controller.signal);
                            if (controller.signal.aborted) return;
                            const anchor = earlier.findIndex(source => source.attachmentRef === sources[0]?.attachmentRef);
                            const next = Math.max(0, anchor - 1);
                            if (earlier.length !== sources.length) pendingHistoryIndex.current = next;
                            setSources(earlier);
                            setCurrentIndex(next);
                            setPagingEnabled(true);
                            stopMotionPhoto();
                            // The new native content width does not exist until
                            // onContentSizeChange; scrolling before it can clamp
                            // to the old width and show a different picture.
                            return;
                        } catch {
                            if (controller.signal.aborted) return;
                            await new Promise<void>(resolve => {
                                const finish = () => {
                                    clearTimeout(timer);
                                    controller.signal.removeEventListener('abort', finish);
                                    resolve();
                                };
                                const timer = setTimeout(finish, retryMs);
                                controller.signal.addEventListener('abort', finish, { once: true });
                            });
                            retryMs = Math.min(retryMs * 2, 30_000);
                        }
                    }
                } finally {
                    if (historyRequest.current === controller) {
                        historyRequest.current = null;
                        if (!controller.signal.aborted) setLoadingEarlier(false);
                    }
                }
            })();
            return;
        }
        historyRequest.current?.abort();
        historyRequest.current = null;
        setLoadingEarlier(false);
        pendingHistoryIndex.current = null;
        const next = Math.max(0, Math.min(currentIndex + direction, sources.length - 1));
        if (next === currentIndex) return;
        // An edge button becomes disabled after paging. Move focus before that
        // update so browser arrow keys continue to reach the modal.
        if (Platform.OS === 'web') rootRef.current?.focus();
        stopMotionPhoto();
        setPagingEnabled(true);
        setCurrentIndex(next);
        scrollRef.current?.scrollTo({ x: next * screenW, y: 0, animated: false });
    }, [currentIndex, screenW, sources, stopMotionPhoto, hasEarlier, loadEarlier]);

    // These keys belong only to the focused modal, not the app's global shortcuts.
    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Escape') handleClose();
            else navigate(event.key === 'ArrowLeft' ? -1 : 1);
        }
    };

    const handleDownload = React.useCallback(() => {
        if (!currentSource || downloadBusy) return;
        setDownloadBusy(true);
        void (async () => {
            const original = currentSource.sessionId && currentSource.attachmentRef
                ? await resolveMediaAttachmentSource({
                    sessionId: currentSource.sessionId,
                    ref: currentSource.attachmentRef,
                    mimeType: getImageDownloadMimeType(currentSource),
                    fileName: currentSource.filename,
                })
                : null;
            try {
                await downloadImage({ ...currentSource, uri: original?.uri ?? currentSource.uri }, { dialogTitle: t('imageViewer.download') });
            } finally {
                if (Platform.OS === 'web' && original?.release) {
                    setTimeout(() => { void original.release?.(); }, 60_000);
                } else {
                    await original?.release?.();
                }
            }
        })()
            .catch((error) => {
                Modal.alert(
                    t('imageViewer.downloadFailedTitle'),
                    error instanceof Error ? error.message : t('imageViewer.downloadFailedMessage'),
                    [{ text: t('common.ok') }],
                );
            })
            .finally(() => setDownloadBusy(false));
    }, [currentSource, downloadBusy]);

    return (
        <View ref={rootRef} testID="image-viewer" style={styles.root}
            {...(Platform.OS === 'web' ? { tabIndex: -1, onKeyDown } : {})}
        >
            <Animated.View style={[styles.backdrop, backdropStyle]} />

            <ScrollView
                ref={scrollRef}
                horizontal
                pagingEnabled
                scrollEnabled={pagingEnabled && !single && !motionSource}
                showsHorizontalScrollIndicator={false}
                contentOffset={{ x: initialIndex * screenW, y: 0 }}
                onLayout={onScrollLayout}
                onScroll={updateCurrentIndex}
                onMomentumScrollEnd={updateCurrentIndex}
                onContentSizeChange={() => {
                    const next = pendingHistoryIndex.current;
                    if (next === null) return;
                    pendingHistoryIndex.current = null;
                    scrollRef.current?.scrollTo({ x: next * screenW, y: 0, animated: false });
                }}
                scrollEventThrottle={16}
                decelerationRate="fast"
                style={styles.fill}
            >
                {leadingWidth > 0 && <View style={{ width: leadingWidth, height: screenH }} />}
                {visibleSources.map((source, relativeIndex) => {
                    const index = windowStart + relativeIndex;
                    return (
                        <ZoomablePage
                            key={`${index}-${source.uri}`}
                            source={source}
                            screenW={screenW}
                            screenH={screenH}
                            isActive={index === currentIndex}
                            backdropOpacity={backdropOpacity}
                            onZoomChange={handleZoomChange}
                            onClose={handleClose}
                        />
                    );
                })}
                {trailingWidth > 0 && <View style={{ width: trailingWidth, height: screenH }} />}
            </ScrollView>

            {motionSource && currentSource && (
                <View
                    testID="motion-photo-viewer-player-frame"
                    style={styles.motionPlayerLayer}
                    pointerEvents="box-none"
                >
                    <View style={fitMotionPlayer(currentSource, screenW, screenH)}>
                        <MediaAttachmentPlayer
                            uri={motionSource.uri}
                            headers={motionSource.headers}
                            title={currentSource.filename ?? 'motion-photo.mp4'}
                            kind="video"
                            mimeType={currentSource.motionPhoto?.mimeType ?? 'video/mp4'}
                            aspectRatio={imageAspect(currentSource)}
                            testID="motion-photo-viewer-player"
                        />
                    </View>
                </View>
            )}

            {(!single || hasEarlier || loadingEarlier) && ([-1, 1] as const).map((direction) => {
                const disabled = direction === -1 ? (currentIndex === 0 && !hasEarlier) || loadingEarlier : currentIndex === sources.length - 1;
                return (
                    <Pressable
                        key={direction}
                        testID={direction === -1 ? 'image-viewer-previous' : 'image-viewer-next'}
                        accessibilityRole="button"
                        accessibilityLabel={t(direction === -1 ? 'imageViewer.previousImage' : 'imageViewer.nextImage')}
                        accessibilityState={{ disabled }}
                        disabled={disabled}
                        onPress={() => navigate(direction)}
                        style={({ pressed }) => [styles.navigationButton, {
                            top: screenH / 2 - 24,
                            ...(direction === -1 ? { left: insets.left + 12 } : { right: insets.right + 12 }),
                            backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surface,
                            opacity: disabled ? 0.4 : 1,
                        }]}
                    >
                        {direction === -1 && loadingEarlier
                            ? <ActivityIndicator testID="image-viewer-history-loading" color={theme.colors.text} />
                            : <Ionicons name={direction === -1 ? 'chevron-back' : 'chevron-forward'} size={26} color={theme.colors.text} />}
                    </Pressable>
                );
            })}

            {!single && (
                <View style={[styles.counter, { top: insets.top + 14, pointerEvents: 'none' }]}>
                    <Text style={styles.counterText}>{currentIndex + 1} / {sources.length}</Text>
                </View>
            )}

            <View style={[styles.topActions, { top: insets.top + 8 }]}>
                {currentSource?.motionPhoto && currentSource.sessionId && currentSource.attachmentRef && (
                    <View style={styles.motionActionSlot}>
                        <Pressable
                            testID="motion-photo-viewer-toggle"
                            onPress={handleMotionToggle}
                            hitSlop={8}
                            disabled={motionLoading}
                            onBlur={() => setMotionFocused(false)}
                            onFocus={() => setMotionFocused(true)}
                            onHoverIn={() => setMotionHovered(true)}
                            onHoverOut={() => setMotionHovered(false)}
                            accessibilityRole="button"
                            accessibilityLabel={t(motionSource ? 'imageViewer.stopMotionPhoto' : 'imageViewer.playMotionPhoto')}
                            accessibilityState={{ busy: motionLoading, selected: !!motionSource }}
                            style={[styles.iconButton, motionLoading && styles.iconButtonDisabled]}
                        >
                            <Ionicons
                                name={motionLoading ? 'hourglass-outline' : motionSource ? 'stop-circle-outline' : 'aperture-outline'}
                                size={23}
                                color="#fff"
                            />
                        </Pressable>
                        <DesktopShortcutTooltip
                            align="right"
                            compact
                            label={t(motionSource ? 'imageViewer.stopMotionPhoto' : 'imageViewer.playMotionPhoto')}
                            placement="below"
                            testID="motion-photo-viewer-tooltip"
                            visible={Platform.OS === 'web' && (motionHovered || motionFocused)}
                        />
                    </View>
                )}

                <Pressable
                    onPress={handleDownload}
                    hitSlop={8}
                    disabled={downloadBusy || !currentSource}
                    accessibilityRole="button"
                    accessibilityLabel={t('imageViewer.download')}
                    style={[styles.iconButton, downloadBusy && styles.iconButtonDisabled]}
                >
                    <Ionicons name={downloadBusy ? 'hourglass-outline' : 'download-outline'} size={22} color="#fff" />
                </Pressable>

                <Pressable
                    onPress={handleClose}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('imageViewer.close')}
                    style={styles.iconButton}
                >
                    <Ionicons name="close" size={24} color="#fff" />
                </Pressable>
            </View>

            {currentSource?.onAction && currentSource.actionLabel && (
                <Pressable
                    onPress={currentSource.onAction}
                    hitSlop={8}
                    style={[styles.actionButton, { bottom: Math.max(insets.bottom + 22, 34) }]}
                >
                    <Ionicons name="camera-outline" size={18} color="#fff" />
                    <Text style={styles.actionText}>{currentSource.actionLabel}</Text>
                </Pressable>
            )}

            {motionError && (
                <View style={[styles.motionError, { bottom: Math.max(insets.bottom + 22, 34) }]}>
                    <Ionicons name="alert-circle-outline" size={18} color="#fff" />
                    <Text style={styles.actionText}>{t('imageViewer.motionPhotoLoadFailedMessage')}</Text>
                </View>
            )}
        </View>
    );
}

function imageAspect(source: ImageViewerSource): number {
    return source.width && source.height && source.width > 0 && source.height > 0
        ? source.width / source.height
        : 4 / 3;
}

function fitMotionPlayer(source: ImageViewerSource, screenW: number, screenH: number) {
    const aspect = imageAspect(source);
    let width = screenW;
    let height = width / aspect;
    if (height > screenH) {
        height = screenH;
        width = height * aspect;
    }
    return { width, height };
}

interface ZoomablePageProps {
    source: ImageViewerSource;
    screenW: number;
    screenH: number;
    isActive: boolean;
    backdropOpacity: SharedValue<number>;
    onZoomChange: (zoomed: boolean) => void;
    onClose: () => void;
}

const ZoomablePage = React.memo<ZoomablePageProps>(({
    source,
    screenW,
    screenH,
    isActive,
    backdropOpacity,
    onZoomChange,
    onClose,
}) => {
    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const savedTranslateX = useSharedValue(0);
    const savedTranslateY = useSharedValue(0);

    // Drives the pan gesture's enabled-mode (zoomed = free move, else = dismiss).
    const [zoomed, setZoomed] = React.useState(false);

    const reset = React.useCallback((animated: boolean) => {
        const to = (v: number) => (animated ? withTiming(v, { duration: 200 }) : v);
        scale.value = to(1);
        savedScale.value = 1;
        translateX.value = to(0);
        translateY.value = to(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
    }, [scale, savedScale, translateX, translateY, savedTranslateX, savedTranslateY]);

    const setZoomedJS = React.useCallback((v: boolean) => {
        setZoomed(v);
        onZoomChange(v);
    }, [onZoomChange]);

    // When this page scrolls out of view, snap it back to a clean 1x state so
    // returning to it later doesn't show a half-zoomed image, and re-enable
    // paging for the next page.
    React.useEffect(() => {
        if (!isActive) {
            reset(false);
            setZoomed(false);
            backdropOpacity.value = 1;
        }
    }, [isActive, reset, backdropOpacity]);

    const pinch = Gesture.Pinch()
        .onUpdate((e) => {
            const next = Math.max(1, Math.min(savedScale.value * e.scale, MAX_SCALE));
            scale.value = next;
        })
        .onEnd(() => {
            savedScale.value = scale.value;
            if (scale.value <= 1) {
                runOnJS(reset)(true);
                runOnJS(setZoomedJS)(false);
            } else {
                runOnJS(setZoomedJS)(true);
            }
        });

    // Move gesture — active only while zoomed in; free pan clamped to bounds.
    const movePan = Gesture.Pan()
        .enabled(zoomed)
        .onUpdate((e) => {
            const maxX = (screenW * (scale.value - 1)) / 2;
            const maxY = (screenH * (scale.value - 1)) / 2;
            translateX.value = Math.max(-maxX, Math.min(savedTranslateX.value + e.translationX, maxX));
            translateY.value = Math.max(-maxY, Math.min(savedTranslateY.value + e.translationY, maxY));
        })
        .onEnd(() => {
            savedTranslateX.value = translateX.value;
            savedTranslateY.value = translateY.value;
        });

    // Dismiss gesture — active only at 1x. Claims vertical drags only so that
    // horizontal swipes fall through to the pager ScrollView.
    const dismissPan = Gesture.Pan()
        .enabled(!zoomed)
        .activeOffsetY([-12, 12])
        .failOffsetX([-20, 20])
        .onUpdate((e) => {
            translateY.value = e.translationY;
            backdropOpacity.value = interpolate(
                Math.abs(e.translationY),
                [0, CLOSE_TRANSLATE_Y * 2],
                [1, 0.3],
                Extrapolation.CLAMP,
            );
        })
        .onEnd((e) => {
            if (Math.abs(e.translationY) > CLOSE_TRANSLATE_Y) {
                runOnJS(onClose)();
            } else {
                translateY.value = withTiming(0, { duration: 200 });
                backdropOpacity.value = withTiming(1, { duration: 200 });
            }
        });

    const doubleTap = Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
            if (scale.value > 1) {
                runOnJS(reset)(true);
                runOnJS(setZoomedJS)(false);
            } else {
                scale.value = withTiming(DOUBLE_TAP_SCALE, { duration: 200 });
                savedScale.value = DOUBLE_TAP_SCALE;
                runOnJS(setZoomedJS)(true);
            }
        });

    const singleTap = Gesture.Tap()
        .numberOfTaps(1)
        .onEnd(() => {
            runOnJS(onClose)();
        });

    const composed = Gesture.Exclusive(
        Gesture.Simultaneous(pinch, movePan, dismissPan),
        doubleTap,
        singleTap,
    );

    const imageStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: translateX.value },
            { translateY: translateY.value },
            { scale: scale.value },
        ],
    }));

    return (
        <GestureDetector gesture={composed}>
            <Animated.View style={[styles.page, { width: screenW, height: screenH }]}>
                <Animated.View style={[styles.imageWrap, imageStyle]}>
                    <ViewerImage source={source} width={screenW} height={screenH} isActive={isActive} />
                </Animated.View>
            </Animated.View>
        </GestureDetector>
    );
});

type ViewerImageProps = { source: ImageViewerSource; width: number; height: number; isActive: boolean };

function ViewerImage(props: ViewerImageProps) {
    const [attempt, setAttempt] = React.useState(0);
    const retry = React.useCallback(() => setAttempt((value) => value + 1), []);
    return <ResolvedViewerImage key={attempt} {...props} onRetry={retry} retryDelay={Math.min(30_000, 2_000 * 2 ** Math.min(attempt, 4))} />;
}

function ResolvedViewerImage({ source, width, height, isActive, onRetry, retryDelay }: ViewerImageProps & {
    onRetry: () => void;
    retryDelay: number;
}) {
    const { theme } = useUnistyles();
    const { uri, loading, error } = useAttachmentImage(source.sessionId ?? '', source.sessionId ? source.attachmentRef : undefined, { lifetime: 'viewer' });
    // A failed historical attachment retries while active; closing or paging
    // away cancels the timer. Remounting restarts the existing decryption hook.
    React.useEffect(() => {
        if (!isActive || !error) return;
        const timer = setTimeout(onRetry, retryDelay);
        return () => clearTimeout(timer);
    }, [error, isActive, onRetry, retryDelay]);
    const displayUri = uri || source.uri;
    return (
        <View style={{ width, height }}>
            {displayUri ? <Image
                testID={isActive ? 'image-viewer-image' : undefined}
                source={{ uri: displayUri }}
                style={{ width, height }}
                contentFit="contain"
                cachePolicy="none"
                recyclingKey={source.attachmentRef ?? source.uri}
                transition={150}
            /> : null}
            {!displayUri && (loading || error) ? (
                <View testID="image-viewer-loading" style={[StyleSheet.absoluteFillObject, styles.page]} pointerEvents="none">
                    <View style={[styles.loadingIndicator, { backgroundColor: theme.colors.surface }]}>
                        <ActivityIndicator size="large" color={theme.colors.text} accessibilityLabel={t('common.loading')} />
                    </View>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1000,
        ...(Platform.OS === 'web' ? { position: 'fixed' as any } : null),
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#000',
    },
    fill: {
        flex: 1,
    },
    page: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    imageWrap: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    counter: {
        position: 'absolute',
        alignSelf: 'center',
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 14,
        backgroundColor: 'rgba(0,0,0,0.45)',
    },
    counterText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
    },
    topActions: {
        position: 'absolute',
        right: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    iconButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.4)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconButtonDisabled: {
        opacity: 0.55,
    },
    navigationButton: {
        position: 'absolute',
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingIndicator: {
        width: 64,
        height: 64,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    motionActionSlot: {
        position: 'relative',
    },
    motionPlayerLayer: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000',
    },
    motionError: {
        position: 'absolute',
        alignSelf: 'center',
        maxWidth: '80%',
        minHeight: 44,
        paddingHorizontal: 16,
        borderRadius: 22,
        backgroundColor: 'rgba(0,0,0,0.7)',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    actionButton: {
        position: 'absolute',
        alignSelf: 'center',
        minHeight: 44,
        paddingHorizontal: 18,
        borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.18)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.32)',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    actionText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '600',
    },
});
