import * as React from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { DrawerGestureContext } from 'react-native-drawer-layout';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

const BALL_SIZE = 48;
const EDGE_MARGIN = 14;
const DECIDE_OFFSET = 4;
const EDGE_SNAP_ZONE = 42;
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
    visible: boolean;
}) {
    const router = useRouter();
    const { theme } = useUnistyles();
    const { width, height } = useWindowDimensions();
    const safeArea = useSafeAreaInsets();
    const drawerPan = React.useContext(DrawerGestureContext);
    const externalHorizontalGestures = React.useContext(ExternalHorizontalGestureContext);

    const leftDockX = -BALL_SIZE / 2;
    const rightDockX = width - BALL_SIZE / 2;
    const minVisibleX = EDGE_MARGIN;
    const maxVisibleX = Math.max(minVisibleX, width - BALL_SIZE - EDGE_MARGIN);
    const minY = Math.max(EDGE_MARGIN, safeArea.top + 76);
    const maxY = Math.max(minY, height - BALL_SIZE - safeArea.bottom - 112);
    const initialX = rightDockX;
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
            x.value = rightDockX;
            y.value = initialY;
            return;
        }
        x.value = withSpring(clamp(x.value, leftDockX, rightDockX), SPRING);
        y.value = withSpring(clamp(y.value, minY, maxY), SPRING);
    }, [initialY, leftDockX, maxY, minY, rightDockX, x, y]);

    const openSwitcher = React.useCallback(() => {
        hapticsLight();
        router.push('/dev/ota-versions' as any);
    }, [router]);

    const settleX = React.useCallback((projectedX: number): number => {
        'worklet';
        if (projectedX <= minVisibleX + EDGE_SNAP_ZONE) {
            return leftDockX;
        }
        if (projectedX >= maxVisibleX - EDGE_SNAP_ZONE) {
            return rightDockX;
        }
        return clamp(projectedX, minVisibleX, maxVisibleX);
    }, [leftDockX, maxVisibleX, minVisibleX, rightDockX]);

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
                x.value = clamp(startX.value + event.translationX, leftDockX, rightDockX);
                y.value = clamp(startY.value + event.translationY, minY, maxY);
            })
            .onEnd((event) => {
                'worklet';
                x.value = withSpring(settleX(x.value + event.velocityX * 0.04), SPRING);
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
        maxY,
        minY,
        leftDockX,
        openSwitcher,
        rightDockX,
        settleX,
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

    if (!props.visible) {
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
                        <Ionicons name="swap-horizontal" size={18} color={theme.colors.button.primary.tint} />
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
        gap: 1,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: theme.colors.shadow.opacity * 1.6,
        shadowRadius: 10,
        elevation: 9,
        zIndex: 900,
    },
    iconWrap: {
        width: 22,
        height: 19,
        alignItems: 'center',
        justifyContent: 'center',
    },
    label: {
        ...Typography.default('semiBold'),
        fontSize: 8,
        lineHeight: 10,
        letterSpacing: 0.3,
    },
}));
