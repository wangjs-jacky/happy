import * as React from 'react';
import { View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import Animated, { useSharedValue, useAnimatedStyle, withSequence, withTiming } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import { useLocalSettingMutable } from '@/sync/storage';
import { getMascotImage, MASCOT_IDS, resolveMascotId } from '@/components/mascots';
import { hapticsLight } from '@/components/haptics';

//
// 设置页头部「土拨鼠 logo」点击切换器
// ------------------------------------------------------------------
// 点一下土拨鼠就切到下一套形象（6 套，两端循环），切换时轻震动 + 弹一下。
// 下方一排小圆点指示当前是第几个。
//
// 为什么用点击而非滑动：手机端 Drawer（SidebarNavigator）声明了整屏横滑开合
// 手势，自定义横滑 Pan 与之争抢只能缓解、做不到丝滑（见 git 历史 #55~#57）。
// 点击不与任何 pan 手势冲突，最稳。
//

const MASCOT_SIZE = 110;

export const MascotSwitcher = React.memo(function MascotSwitcher() {
    const [mascot, setMascot] = useLocalSettingMutable('mascot');
    const currentId = resolveMascotId(mascot);
    const currentIndex = MASCOT_IDS.indexOf(currentId);

    const scale = useSharedValue(1);

    // 点击切到下一个吉祥物（两端循环）+ 轻震动 + 弹一下反馈
    const cycleMascot = React.useCallback(() => {
        const n = MASCOT_IDS.length;
        setMascot(MASCOT_IDS[(currentIndex + 1) % n]);
        hapticsLight();
        scale.value = withSequence(
            withTiming(0.88, { duration: 90 }),
            withTiming(1, { duration: 170 }),
        );
    }, [currentIndex, setMascot, scale]);

    const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

    return (
        <View style={styles.container}>
            <Pressable onPress={cycleMascot} hitSlop={8}>
                <Animated.View style={animStyle}>
                    <Image
                        source={getMascotImage(currentId)}
                        contentFit="contain"
                        style={{ width: MASCOT_SIZE, height: MASCOT_SIZE }}
                    />
                </Animated.View>
            </Pressable>
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
