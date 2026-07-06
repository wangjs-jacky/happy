import * as React from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { DrawerGestureContext } from 'react-native-drawer-layout';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { hapticsLight } from '@/components/haptics';
import { ExternalHorizontalGestureContext } from '@/components/ExternalHorizontalGestureContext';
import { t } from '@/text';
import type { SessionOtaPreview } from '@/utils/sessionOtaPreviews';

const BALL_SIZE = 62;
const EDGE_MARGIN = 14;
const DECIDE_OFFSET = 4;
const SPRING = {
    damping: 24,
    stiffness: 320,
    mass: 0.85,
};

function clamp(value: number, min: number, max: number): number {
    'worklet';
    return Math.max(min, Math.min(max, value));
}

export const OtaPreviewFloatingButton = React.memo(function OtaPreviewFloatingButton(props: {
    previews: SessionOtaPreview[];
    topOffset: number;
    bottomOffset: number;
}) {
    const router = useRouter();
    const { theme } = useUnistyles();
    const { width, height } = useWindowDimensions();
    const drawerPan = React.useContext(DrawerGestureContext);
    const externalHorizontalGestures = React.useContext(ExternalHorizontalGestureContext);

    const preview = React.useMemo(
        () => props.previews.find((item) => item.channel?.toLowerCase() === 'preview') ?? null,
        [props.previews],
    );

    const minX = EDGE_MARGIN;
    const maxX = Math.max(minX, width - BALL_SIZE - EDGE_MARGIN);
    const minY = Math.max(EDGE_MARGIN, props.topOffset);
    const maxY = Math.max(minY, height - BALL_SIZE - props.bottomOffset);
    const initialX = maxX;
    const initialY = maxY;

    const x = useSharedValue(initialX);
    const y = useSharedValue(initialY);
    const startX = useSharedValue(initialX);
    const startY = useSharedValue(initialY);
    const touchStartX = useSharedValue(0);
    const touchStartY = useSharedValue(0);
    const decided = useSharedValue(false);
    const initializedRef = React.useRef(false);

    React.useEffect(() => {
        if (!initializedRef.current) {
            initializedRef.current = true;
            x.value = initialX;
            y.value = initialY;
            return;
        }
        x.value = withSpring(clamp(x.value, minX, maxX), SPRING);
        y.value = withSpring(clamp(y.value, minY, maxY), SPRING);
    }, [initialX, initialY, maxX, maxY, minX, minY, x, y]);

    const openSwitcher = React.useCallback(() => {
        hapticsLight();
        router.push('/dev/ota-versions' as any);
    }, [router]);

    const gesture = React.useMemo(() => {
        const pan = Gesture.Pan()
            .manualActivation(true)
            .onTouchesDown((event) => {
                'worklet';
                const touch = event.allTouches[0];
                if (!touch) return;
                touchStartX.value = touch.x;
                touchStartY.value = touch.y;
                decided.value = false;
            })
            .onTouchesMove((event, state) => {
                'worklet';
                if (decided.value) return;
                const touch = event.allTouches[0];
                if (!touch) return;
                const dx = touch.x - touchStartX.value;
                const dy = touch.y - touchStartY.value;
                const adx = Math.abs(dx);
                const ady = Math.abs(dy);
                if (adx < DECIDE_OFFSET && ady < DECIDE_OFFSET) return;
                decided.value = true;
                state.activate();
            })
            .onBegin(() => {
                'worklet';
                startX.value = x.value;
                startY.value = y.value;
            })
            .onUpdate((event) => {
                'worklet';
                x.value = clamp(startX.value + event.translationX, minX, maxX);
                y.value = clamp(startY.value + event.translationY, minY, maxY);
            })
            .onEnd((event) => {
                'worklet';
                x.value = withSpring(clamp(x.value + event.velocityX * 0.04, minX, maxX), SPRING);
                y.value = withSpring(clamp(y.value + event.velocityY * 0.04, minY, maxY), SPRING);
            });

        const gesturesToBlock = drawerPan
            ? [drawerPan, ...externalHorizontalGestures]
            : externalHorizontalGestures;
        if (gesturesToBlock.length > 0) {
            pan.blocksExternalGesture(...gesturesToBlock);
        }

        const tap = Gesture.Tap()
            .maxDistance(8)
            .onEnd(() => {
                'worklet';
                runOnJS(openSwitcher)();
            });

        return Gesture.Simultaneous(tap, pan);
    }, [
        decided,
        drawerPan,
        externalHorizontalGestures,
        maxX,
        maxY,
        minX,
        minY,
        openSwitcher,
        startX,
        startY,
        touchStartX,
        touchStartY,
        x,
        y,
    ]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: x.value },
            { translateY: y.value },
        ],
    }));

    if (!preview) {
        return null;
    }

    return (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <GestureDetector gesture={gesture}>
                <Animated.View
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={t('devTools.switchOtaVersion')}
                    style={[
                        styles.ball,
                        {
                            backgroundColor: theme.colors.button.primary.background,
                            shadowColor: theme.colors.shadow.color,
                        },
                        animatedStyle,
                    ]}
                >
                    <View style={styles.iconWrap}>
                        <Ionicons name="swap-horizontal" size={22} color={theme.colors.button.primary.tint} />
                        <View style={[styles.dot, { backgroundColor: theme.colors.success ?? '#34C759' }]} />
                    </View>
                    <Text style={[styles.label, { color: theme.colors.button.primary.tint }]}>OTA</Text>
                </Animated.View>
            </GestureDetector>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    ball: {
        position: 'absolute',
        left: 0,
        top: 0,
        width: BALL_SIZE,
        height: BALL_SIZE,
        borderRadius: BALL_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: theme.colors.shadow.opacity * 1.8,
        shadowRadius: 12,
        elevation: 9,
        zIndex: 900,
    },
    iconWrap: {
        width: 27,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dot: {
        position: 'absolute',
        right: 0,
        top: 1,
        width: 8,
        height: 8,
        borderRadius: 4,
        borderWidth: 1.5,
        borderColor: theme.colors.button.primary.tint,
    },
    label: {
        ...Typography.default('semiBold'),
        fontSize: 10,
        lineHeight: 12,
        letterSpacing: 0.4,
    },
}));
