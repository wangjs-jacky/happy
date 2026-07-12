import * as React from 'react';
import { useIsFocused } from '@react-navigation/native';
import { BackHandler, Platform, Pressable, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { DrawerGestureContext } from 'react-native-drawer-layout';
import { useNavigation } from 'expo-router';
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { useIsTablet } from '@/utils/responsive';
import { hapticsLight } from './haptics';
import { ExternalHorizontalGestureContext } from './ExternalHorizontalGestureContext';

type Props = {
    children: React.ReactNode;
    panelContent?: React.ReactNode;
};

type PanelBackHandler = () => boolean;

type RightSwipePanelContextValue = {
    closePanel: (onClosed?: () => void) => void;
    isOpen: boolean;
    registerBackHandler: (handler: PanelBackHandler) => () => void;
};

const RightSwipePanelContext = React.createContext<RightSwipePanelContextValue | null>(null);

const DECIDE_OFFSET = 3;
const OPEN_PROGRESS_THRESHOLD = 0.28;
const CLOSE_PROGRESS_THRESHOLD = 0.72;
const SPRING_CONFIG = {
    damping: 28,
    stiffness: 320,
    mass: 0.9,
};

export const RightSwipePanelHost = React.memo(function RightSwipePanelHost({ children, panelContent }: Props) {
    const { theme } = useUnistyles();
    const navigation = useNavigation();
    const isFocused = useIsFocused();
    const safeArea = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();
    const isTablet = useIsTablet();
    const drawerPan = React.useContext(DrawerGestureContext);
    const enabled = Platform.OS !== 'web' && !isTablet;
    const panelWidth = Math.min(Math.max(Math.floor(windowWidth * 0.82), 280), 340);

    const [open, setOpen] = React.useState(false);
    const progress = useSharedValue(0);
    const startProgress = useSharedValue(0);
    const startX = useSharedValue(0);
    const startY = useSharedValue(0);
    const decided = useSharedValue(false);
    const backHandlerRef = React.useRef<PanelBackHandler | null>(null);
    const animationRequestRef = React.useRef(0);
    const pendingCloseRef = React.useRef<{ id: number; onClosed?: () => void } | null>(null);

    const supersedePanelAnimation = React.useCallback(() => {
        animationRequestRef.current += 1;
        pendingCloseRef.current = null;
    }, []);

    const completePanelClose = React.useCallback((requestId: number, finished: boolean) => {
        const pending = pendingCloseRef.current;
        if (!pending || pending.id !== requestId) return;
        pendingCloseRef.current = null;
        if (!finished) return;
        setOpen(false);
        pending.onClosed?.();
    }, []);

    const openPanel = React.useCallback(() => {
        supersedePanelAnimation();
        hapticsLight();
        setOpen(true);
        progress.value = withSpring(1, SPRING_CONFIG);
    }, [progress, supersedePanelAnimation]);

    const closePanel = React.useCallback((onClosed?: () => void) => {
        const requestId = animationRequestRef.current + 1;
        animationRequestRef.current = requestId;
        pendingCloseRef.current = { id: requestId, onClosed };
        hapticsLight();
        progress.value = withSpring(0, SPRING_CONFIG, (finished) => {
            runOnJS(completePanelClose)(requestId, finished === true);
        });
    }, [completePanelClose, progress]);

    const registerBackHandler = React.useCallback((handler: PanelBackHandler) => {
        backHandlerRef.current = handler;
        return () => {
            if (backHandlerRef.current === handler) {
                backHandlerRef.current = null;
            }
        };
    }, []);

    const handlePanelBack = React.useCallback(() => {
        if (!isFocused || !open) return false;
        if (backHandlerRef.current?.()) return true;
        closePanel();
        return true;
    }, [closePanel, isFocused, open]);

    React.useEffect(() => {
        if (!enabled || !isFocused) return;
        const subscription = BackHandler.addEventListener('hardwareBackPress', handlePanelBack);
        return () => subscription.remove();
    }, [enabled, handlePanelBack, isFocused]);

    React.useEffect(() => {
        if (!enabled || !isFocused) return;
        return navigation.addListener('beforeRemove', (event) => {
            const actionType = event.data.action.type;
            if (actionType !== 'GO_BACK' && actionType !== 'POP') return;
            if (!handlePanelBack()) return;
            event.preventDefault();
        });
    }, [enabled, handlePanelBack, isFocused, navigation]);

    const contextValue = React.useMemo<RightSwipePanelContextValue>(() => ({
        closePanel,
        isOpen: open,
        registerBackHandler,
    }), [closePanel, open, registerBackHandler]);

    const horizontalGesture = React.useMemo(() => {
        const pan = Gesture.Pan()
            .enabled(enabled)
            .manualActivation(true)
            .onTouchesDown((e) => {
                'worklet';
                const t = e.allTouches[0];
                if (!t) return;
                startX.value = t.x;
                startY.value = t.y;
                decided.value = false;
            })
            .onTouchesMove((e, state) => {
                'worklet';
                if (decided.value) return;
                const t = e.allTouches[0];
                if (!t) return;
                const dx = t.x - startX.value;
                const dy = t.y - startY.value;
                const adx = Math.abs(dx);
                const ady = Math.abs(dy);
                if (adx < DECIDE_OFFSET && ady < DECIDE_OFFSET) return;

                decided.value = true;
                if (ady > adx) { state.fail(); return; }
                if (!open && dx > 0) { state.fail(); return; }
                state.activate();
            })
            .onStart(() => {
                'worklet';
                runOnJS(supersedePanelAnimation)();
                startProgress.value = progress.value;
            })
            .onUpdate((e) => {
                'worklet';
                progress.value = Math.max(0, Math.min(1, startProgress.value - (e.translationX / panelWidth)));
            })
            .onEnd((e) => {
                'worklet';
                const projected = progress.value + Math.max(-0.22, Math.min(0.22, -e.velocityX / 2600));
                if (projected >= (e.translationX < 0 ? OPEN_PROGRESS_THRESHOLD : CLOSE_PROGRESS_THRESHOLD)) {
                    runOnJS(hapticsLight)();
                    runOnJS(setOpen)(true);
                    progress.value = withSpring(1, {
                        ...SPRING_CONFIG,
                        velocity: -e.velocityX / panelWidth,
                    });
                } else {
                    progress.value = withSpring(0, {
                        ...SPRING_CONFIG,
                        velocity: -e.velocityX / panelWidth,
                    }, (finished) => {
                        if (finished) {
                            runOnJS(setOpen)(false);
                        }
                    });
                    runOnJS(hapticsLight)();
                }
            });
        if (drawerPan) {
            pan.blocksExternalGesture(drawerPan);
        }
        return pan;
    }, [decided, drawerPan, enabled, open, panelWidth, progress, startProgress, startX, startY, supersedePanelAnimation]);

    const externalHorizontalGestures = React.useMemo(() => [horizontalGesture], [horizontalGesture]);

    const scrimStyle = useAnimatedStyle(() => ({
        opacity: progress.value * 0.38,
    }));

    const filmstripStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: -progress.value * panelWidth }],
    }));

    if (!enabled) {
        return <>{children}</>;
    }

    return (
        <RightSwipePanelContext.Provider value={contextValue}>
            <ExternalHorizontalGestureContext.Provider value={externalHorizontalGestures}>
                <GestureDetector gesture={horizontalGesture}>
                    <View collapsable={false} style={{ flex: 1, overflow: 'hidden', backgroundColor: theme.colors.surface }}>
                        <Animated.View
                            style={[
                                {
                                    flex: 1,
                                    width: windowWidth + panelWidth,
                                    flexDirection: 'row',
                                },
                                filmstripStyle,
                            ]}
                        >
                            <View style={{ width: windowWidth }}>
                                {children}
                                <Animated.View
                                    pointerEvents="none"
                                    style={[
                                        {
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            right: 0,
                                            bottom: 0,
                                            backgroundColor: '#000',
                                        },
                                        scrimStyle,
                                    ]}
                                />
                            </View>
                            <View
                                style={{
                                    width: panelWidth,
                                    paddingTop: safeArea.top + 12,
                                    paddingBottom: safeArea.bottom + 12,
                                    backgroundColor: theme.colors.surface,
                                }}
                            >
                                <View
                                    style={{
                                        alignSelf: 'center',
                                        width: 36,
                                        height: 4,
                                        borderRadius: 2,
                                        backgroundColor: theme.colors.divider,
                                        opacity: 0.9,
                                    }}
                                />
                                <View style={{ flex: 1, minHeight: 0 }}>
                                    {panelContent}
                                </View>
                            </View>
                        </Animated.View>
                        {open && (
                            <Pressable
                                onPress={() => closePanel()}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    bottom: 0,
                                    width: windowWidth - panelWidth,
                                }}
                            >
                                <View style={{ flex: 1 }} />
                            </Pressable>
                        )}
                    </View>
                </GestureDetector>
            </ExternalHorizontalGestureContext.Provider>
        </RightSwipePanelContext.Provider>
    );
});

export function useRightSwipePanel() {
    return React.useContext(RightSwipePanelContext);
}
