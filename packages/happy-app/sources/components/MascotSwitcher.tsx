import * as React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import { useLocalSettingMutable } from '@/sync/storage';
import { getMascotImage, MASCOT_IDS, resolveMascotId } from '@/components/mascots';
import { hapticsLight } from '@/components/haptics';

//
// 设置页头部「土拨鼠 logo」滑动切换器
// ------------------------------------------------------------------
// 在吉祥物图上左右滑动即可切换形象（6 套，两端循环），切换时轻震动反馈。
// 下方一排小圆点指示当前是第几个。
// - 用 Pan 手势的 activeOffsetX / failOffsetY 限定为横向手势，避免抢占
//   外层设置列表的纵向滚动。
// - 拖拽过程中图片跟手平移 + 轻微淡出，松手回弹（reanimated）。
//

const SWIPE_THRESHOLD = 36;   // 横向位移超过该值才算一次有效切换
const MASCOT_SIZE = 110;

export const MascotSwitcher = React.memo(function MascotSwitcher() {
    const [mascot, setMascot] = useLocalSettingMutable('mascot');
    const currentId = resolveMascotId(mascot);
    const currentIndex = MASCOT_IDS.indexOf(currentId);

    const translateX = useSharedValue(0);
    const opacity = useSharedValue(1);

    // 切到相邻吉祥物（dir: +1 下一个 / -1 上一个），两端循环 + 轻震动
    const cycleMascot = React.useCallback((dir: number) => {
        const n = MASCOT_IDS.length;
        const next = MASCOT_IDS[(currentIndex + dir + n) % n];
        setMascot(next);
        hapticsLight();
    }, [currentIndex, setMascot]);

    const pan = Gesture.Pan()
        .activeOffsetX([-12, 12])   // 横向超过 12px 才激活手势
        .failOffsetY([-16, 16])     // 纵向先动则放弃，交还给列表滚动
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
