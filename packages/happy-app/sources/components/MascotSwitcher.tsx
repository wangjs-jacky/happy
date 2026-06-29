import * as React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import { useLocalSettingMutable } from '@/sync/storage';
import { getMascotImage, MASCOT_IDS, resolveMascotId } from '@/components/mascots';
import { hapticsLight } from '@/components/haptics';
import { useDisableRootDrawerSwipeWhileFocused } from '@/hooks/useDisableRootDrawerSwipeWhileFocused';

//
// 设置页头部「土拨鼠 logo」滑动切换器
// ------------------------------------------------------------------
// 在吉祥物图上左右滑动即可切换形象（6 套，两端循环），切换时轻震动反馈。
// 下方一排小圆点指示当前是第几个。拖拽过程图片跟手平移 + 轻微淡出，松手回弹。
//
// 流畅的关键：手机端 Drawer 声明了整屏横滑开合手势，会和这里的横滑争抢。本组件
// 挂载（即设置页展示土拨鼠）期间，用 useDisableRootDrawerSwipeWhileFocused 临时关掉
// Drawer 横滑，冲突源头消失，左右滑切换才丝滑；离开设置页自动恢复。
//

const SWIPE_THRESHOLD = 36;   // 横向位移超过该值才算一次有效切换
const MASCOT_SIZE = 110;

export const MascotSwitcher = React.memo(function MascotSwitcher() {
    const [mascot, setMascot] = useLocalSettingMutable('mascot');
    const currentId = resolveMascotId(mascot);
    const currentIndex = MASCOT_IDS.indexOf(currentId);

    // 设置页聚焦期间关掉根 Drawer 的整屏横滑，避免和本组件横滑争抢
    useDisableRootDrawerSwipeWhileFocused();

    const translateX = useSharedValue(0);
    const opacity = useSharedValue(1);

    // 切到相邻吉祥物（dir: +1 下一个 / -1 上一个），两端循环 + 轻震动
    const cycleMascot = React.useCallback((dir: number) => {
        const n = MASCOT_IDS.length;
        setMascot(MASCOT_IDS[(currentIndex + dir + n) % n]);
        hapticsLight();
    }, [currentIndex, setMascot]);

    const pan = React.useMemo(() => {
        return Gesture.Pan()
            .activeOffsetX([-10, 10])   // 横向超过 10px 才激活；不设 failOffsetY，斜滑也稳
            .onUpdate((e) => {
                translateX.value = e.translationX * 0.55;
                opacity.value = 1 - Math.min(Math.abs(e.translationX) / 300, 0.4);
            })
            .onEnd((e) => {
                if (Math.abs(e.translationX) > SWIPE_THRESHOLD) {
                    runOnJS(cycleMascot)(e.translationX < 0 ? 1 : -1);   // 左滑下一个，右滑上一个
                }
                translateX.value = withTiming(0, { duration: 260 });
                opacity.value = withTiming(1, { duration: 260 });
            });
    }, [cycleMascot, translateX, opacity]);

    const animStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: translateX.value }],
        opacity: opacity.value,
    }));

    return (
        <View style={styles.container}>
            <GestureDetector gesture={pan}>
                <Animated.View style={animStyle}>
                    <Image
                        source={getMascotImage(currentId)}
                        contentFit="contain"
                        style={{ width: MASCOT_SIZE, height: MASCOT_SIZE }}
                    />
                </Animated.View>
            </GestureDetector>
            <View style={styles.dots}>
                {MASCOT_IDS.map((id, i) => (
                    <View key={id} style={[styles.dot, i === currentIndex ? styles.dotActive : null]} />
                ))}
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        alignItems: 'center',
    },
    dots: {
        flexDirection: 'row',
        gap: 7,
        marginTop: 14,
        alignItems: 'center',
    },
    dot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
        backgroundColor: theme.colors.textSecondary,
        opacity: 0.25,
    },
    dotActive: {
        width: 18,
        borderRadius: 4,
        backgroundColor: theme.colors.accent,
        opacity: 1,
    },
}));
