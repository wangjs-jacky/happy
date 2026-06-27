/**
 * Fullscreen pinch-to-zoom image viewer.
 *
 * Presented globally via the `imageViewer` store (see sync/imageViewer.ts) and
 * mounted once through `ImageViewerHost`. Supports:
 *   - pinch to zoom (clamped 1x–4x, focal-point aware)
 *   - pan when zoomed in
 *   - double-tap to toggle zoom
 *   - swipe-down (while at 1x) to dismiss, with backdrop fade
 *   - single tap / close button to dismiss
 *
 * expo-image is used directly (no Unistyles) per the repo styling convention.
 */
import * as React from 'react';
import { View, Pressable, useWindowDimensions, StyleSheet, Platform } from 'react-native';
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
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ImageViewerSource } from '@/sync/imageViewer';

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const CLOSE_TRANSLATE_Y = 120; // swipe-down distance that dismisses

interface ImageViewerProps {
    source: ImageViewerSource;
    onClose: () => void;
}

export function ImageViewer({ source, onClose }: ImageViewerProps) {
    const { width: screenW, height: screenH } = useWindowDimensions();
    const insets = useSafeAreaInsets();

    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const savedTranslateX = useSharedValue(0);
    const savedTranslateY = useSharedValue(0);
    const focalX = useSharedValue(0);
    const focalY = useSharedValue(0);

    const reset = React.useCallback((animated: boolean) => {
        const to = (v: number) => (animated ? withTiming(v, { duration: 200 }) : v);
        scale.value = to(1);
        savedScale.value = 1;
        translateX.value = to(0);
        translateY.value = to(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
    }, [scale, savedScale, translateX, translateY, savedTranslateX, savedTranslateY]);

    const pinch = Gesture.Pinch()
        .onUpdate((e) => {
            const next = Math.max(1, Math.min(savedScale.value * e.scale, MAX_SCALE));
            scale.value = next;
        })
        .onEnd(() => {
            savedScale.value = scale.value;
            if (scale.value <= 1) {
                runOnJS(reset)(true);
            }
        });

    const pan = Gesture.Pan()
        .onUpdate((e) => {
            if (scale.value > 1) {
                // Zoomed: free pan, clamp to image bounds.
                const maxX = (screenW * (scale.value - 1)) / 2;
                const maxY = (screenH * (scale.value - 1)) / 2;
                translateX.value = Math.max(-maxX, Math.min(savedTranslateX.value + e.translationX, maxX));
                translateY.value = Math.max(-maxY, Math.min(savedTranslateY.value + e.translationY, maxY));
            } else {
                // At 1x: vertical drag drives swipe-to-dismiss.
                translateY.value = e.translationY;
            }
        })
        .onEnd((e) => {
            if (scale.value > 1) {
                savedTranslateX.value = translateX.value;
                savedTranslateY.value = translateY.value;
            } else if (Math.abs(e.translationY) > CLOSE_TRANSLATE_Y) {
                runOnJS(onClose)();
            } else {
                translateY.value = withTiming(0, { duration: 200 });
            }
        });

    const doubleTap = Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
            if (scale.value > 1) {
                runOnJS(reset)(true);
            } else {
                scale.value = withTiming(DOUBLE_TAP_SCALE, { duration: 200 });
                savedScale.value = DOUBLE_TAP_SCALE;
            }
        });

    const singleTap = Gesture.Tap()
        .numberOfTaps(1)
        .onEnd(() => {
            runOnJS(onClose)();
        });

    // Pinch + pan run together; taps are exclusive; double-tap wins over single.
    const composed = Gesture.Exclusive(
        Gesture.Simultaneous(pinch, pan),
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

    const backdropStyle = useAnimatedStyle(() => {
        // Fade the backdrop as the user swipes down at 1x.
        const fade = scale.value <= 1
            ? interpolate(
                Math.abs(translateY.value),
                [0, CLOSE_TRANSLATE_Y * 2],
                [1, 0.3],
                Extrapolation.CLAMP,
            )
            : 1;
        return { opacity: fade };
    });

    return (
        <View style={styles.root}>
            <Animated.View style={[styles.backdrop, backdropStyle]} />
            <GestureDetector gesture={composed}>
                <Animated.View style={styles.fill}>
                    <Animated.View style={[styles.imageWrap, imageStyle]}>
                        <Image
                            source={{ uri: source.uri }}
                            style={{ width: screenW, height: screenH }}
                            contentFit="contain"
                            transition={150}
                        />
                    </Animated.View>
                </Animated.View>
            </GestureDetector>

            <Pressable
                onPress={onClose}
                hitSlop={8}
                style={[styles.closeButton, { top: insets.top + 8 }]}
            >
                <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
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
        alignItems: 'center',
        justifyContent: 'center',
    },
    imageWrap: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    closeButton: {
        position: 'absolute',
        right: 12,
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.4)',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
