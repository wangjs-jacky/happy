import * as React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { captureRef } from 'react-native-view-shot';

//
// 主题切换过渡（crossfade）
// ------------------------------------------------------------------
// 切换主题色/吉祥物时，先把「当前屏幕」截一张快照盖在最顶层，再切主题，
// 然后让快照平滑淡出 —— 视觉上就是旧配色柔和溶解到新配色，简洁不花哨。
//
// 用法：把会改主题的操作包进 runThemeTransition(() => { ...setThemePack/applyTheme... })。
// web 或截图不可用时自动降级为「无动画直接切换」。
//

const DURATION = 280;

// 截图根 View 的 ref（由 <ThemeCaptureRoot> 注册）
let rootRef: React.RefObject<View | null> | null = null;
// overlay 控制器（由 <ThemeTransitionOverlay> 注册）
let showOverlay: ((uri: string, apply: () => void) => void) | null = null;

export async function runThemeTransition(apply: () => void) {
    // 不具备条件就直接切换，绝不因动画失败而切不了主题
    if (Platform.OS === 'web' || !rootRef?.current || !showOverlay) {
        apply();
        return;
    }
    try {
        const uri = await captureRef(rootRef, { format: 'png', quality: 1 });
        showOverlay(uri, apply);
    } catch {
        apply();
    }
}

/** 截图根容器：包住要被快照的全部内容，并挂载淡出层 */
export const ThemeCaptureRoot = React.memo(function ThemeCaptureRoot({ children }: { children: React.ReactNode }) {
    const ref = React.useRef<View>(null);
    React.useEffect(() => {
        rootRef = ref;
        return () => { rootRef = null; };
    }, []);
    return (
        <View ref={ref} collapsable={false} style={{ flex: 1 }}>
            {children}
            <ThemeTransitionOverlay />
        </View>
    );
});

const ThemeTransitionOverlay = React.memo(function ThemeTransitionOverlay() {
    const [uri, setUri] = React.useState<string | null>(null);
    const applyRef = React.useRef<(() => void) | null>(null);
    const opacity = useSharedValue(0);

    React.useEffect(() => {
        showOverlay = (u, apply) => {
            applyRef.current = apply;
            opacity.value = 1;   // 盖住（快照加载前底层仍是旧主题，无突兀）
            setUri(u);
        };
        return () => { showOverlay = null; };
    }, [opacity]);

    // 快照加载完成 → 此刻切主题（被快照盖住看不到瞬切）→ 快照淡出露出新配色
    const onLoaded = React.useCallback(() => {
        applyRef.current?.();
        applyRef.current = null;
        opacity.value = withTiming(0, { duration: DURATION }, (finished) => {
            if (finished) runOnJS(setUri)(null);
        });
    }, [opacity]);

    const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

    if (!uri) return null;
    return (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
            <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" onLoad={onLoaded} />
        </Animated.View>
    );
});
