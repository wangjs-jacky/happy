import * as React from 'react';
import { View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { DrawerGestureContext } from 'react-native-drawer-layout';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useLocalSettingMutable } from '@/sync/storage';
import { getMascotImage, MASCOT_IDS, resolveMascotId, getMascotTheme } from '@/components/mascots';
import { hapticsLight } from '@/components/haptics';
import { applyTheme } from '@/unistyles';
import { runThemeTransition } from '@/components/ThemeTransition';

//
// 设置页头部「土拨鼠 logo」滑动切换器
// ------------------------------------------------------------------
// 在吉祥物图上左右滑动即可切换形象（6 套，两端循环），切换时轻震动反馈。
// 两侧另有小箭头，点击等价于左右滑动（左=上一个 / 右=下一个），方便不想滑动时直接点切。
// 下方一排小圆点指示当前是第几个。拖拽过程图片跟手平移 + 轻微淡出，松手回弹。
//
// 与抽屉手势的争抢——照搬上游表格横滑（HorizontalScrollView，commit #64）的「裁判 Pan」方案：
// 手机端 Drawer 把 swipeEdgeWidth 设为整屏宽，且其 pan 是「对称激活」
// （activeOffsetX([-5,5])），左右滑都会被它早早吞掉，普通 Pan 抢不过、发涩。
// 解法：用 manualActivation 的裁判 Pan，在手指移动满 DECIDE_OFFSET(6px) 时按方向
// 一次性判定归属——纵向→state.fail() 让位列表滚动；横向→state.activate() 抢占并
// blocksExternalGesture 压住 Drawer。判定一次定终身（RNGH 不能中途转移已激活手势）。
//

const SWIPE_THRESHOLD = 36;   // 横向位移超过该值才算一次有效切换
const DECIDE_OFFSET = 6;      // 手指移动多少 px 后一次性判定手势归属
const MASCOT_SIZE = 110;

// 解析 #RGB / #RRGGBB 为 [r,g,b]，失败返回 null
function parseHex(color: string): [number, number, number] | null {
    if (typeof color !== 'string' || !color.startsWith('#')) return null;
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6) return null;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return [r, g, b].some(Number.isNaN) ? null : [r, g, b];
}

// 把 overlay 以 t 比例叠到 base 上，得到「不透明淡色」——实心圆干净、安卓投影不糊边；随主题 accent 联动
function tint(base: string, overlay: string, t: number): string {
    const b = parseHex(base);
    const o = parseHex(overlay);
    if (!b || !o) return base;
    const mix = (i: number) => Math.round(b[i] * (1 - t) + o[i] * t);
    return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

export const MascotSwitcher = React.memo(function MascotSwitcher() {
    const [mascot, setMascot] = useLocalSettingMutable('mascot');
    const [, setThemePack] = useLocalSettingMutable('themePack');
    const [themePreference] = useLocalSettingMutable('themePreference');
    const currentId = resolveMascotId(mascot);
    const currentIndex = MASCOT_IDS.indexOf(currentId);

    const drawerPan = React.useContext(DrawerGestureContext);
    const { theme } = useUnistyles();   // 箭头图标颜色需运行时主题值（expo-vector-icons 的 color 走直接属性）

    // 在手势 worklet（UI 线程）里读写的共享值
    const translateX = useSharedValue(0);
    const opacity = useSharedValue(1);
    const startX = useSharedValue(0);
    const startY = useSharedValue(0);
    const decided = useSharedValue(false);

    // 切到相邻吉祥物（dir: +1 下一个 / -1 上一个），两端循环 + 轻震动
    // 切吉祥物即联动套用它绑定的主题配色
    const cycleMascot = React.useCallback((dir: number) => {
        const n = MASCOT_IDS.length;
        const next = MASCOT_IDS[(currentIndex + dir + n) % n];
        hapticsLight();
        // 带 crossfade 过渡：切吉祥物 + 联动主题色
        runThemeTransition(() => {
            setMascot(next);
            const pack = getMascotTheme(next);
            setThemePack(pack as 'caramel');
            applyTheme(pack as 'caramel', themePreference);
        });
    }, [currentIndex, setMascot, setThemePack, themePreference]);

    const pan = React.useMemo(() => {
        const g = Gesture.Pan()
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
                // 纵向 → 让位给列表滚动（Drawer 自身靠 failOffsetY 失败）
                if (ady > adx) { state.fail(); return; }
                // 横向 → 抢占本手势（onUpdate 起效），并压住 Drawer
                state.activate();
            })
            .onUpdate((e) => {
                translateX.value = e.translationX * 0.55;
                opacity.value = 1 - Math.min(Math.abs(e.translationX) / 300, 0.4);
            })
            .onEnd((e) => {
                if (Math.abs(e.translationX) > SWIPE_THRESHOLD) {
                    // 切换：瞬间归位再触发 crossfade。
                    // 否则回弹动画(withTiming 260ms)会和主题快照 captureRef 赛跑，
                    // 截图恰好抓到「回弹途中偏在左侧」的那一帧并冻成残影盖在顶层淡出，
                    // 表现为切换瞬间左侧闪一下旧图。切换本就被全屏 crossfade 溶解盖住，
                    // 这里不需要可见回弹，直接归位保证截图抓到的是居中态。
                    translateX.value = 0;
                    opacity.value = 1;
                    runOnJS(cycleMascot)(e.translationX < 0 ? 1 : -1);   // 左滑下一个，右滑上一个
                } else {
                    // 未达阈值：不切换，平滑回弹
                    translateX.value = withTiming(0, { duration: 260 });
                    opacity.value = withTiming(1, { duration: 260 });
                }
            });
        if (drawerPan) {
            g.blocksExternalGesture(drawerPan);
        }
        return g;
    }, [cycleMascot, drawerPan, translateX, opacity, startX, startY, decided]);

    const animStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: translateX.value }],
        opacity: opacity.value,
    }));

    return (
        <View style={styles.container}>
            <View style={styles.row}>
                <Pressable
                    onPress={() => cycleMascot(-1)}
                    hitSlop={12}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.arrowBtn, { opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] }]}
                >
                    <Ionicons name="chevron-back" size={18} color={theme.colors.accent} />
                </Pressable>
                <GestureDetector gesture={pan}>
                    <Animated.View style={animStyle}>
                        <Image
                            source={getMascotImage(currentId)}
                            contentFit="contain"
                            style={{ width: MASCOT_SIZE, height: MASCOT_SIZE }}
                        />
                    </Animated.View>
                </GestureDetector>
                <Pressable
                    onPress={() => cycleMascot(1)}
                    hitSlop={12}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.arrowBtn, { opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] }]}
                >
                    <Ionicons name="chevron-forward" size={18} color={theme.colors.accent} />
                </Pressable>
            </View>
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
        alignSelf: 'stretch',   // 撑满卡片宽度，箭头才能贴到两侧边界
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',   // 箭头分居两端，吉祥物居中
        width: '100%',
        maxWidth: 340,          // 平板等宽屏下别让箭头分得太开
        paddingHorizontal: 8,
    },
    arrowBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,       // 更小的圆钮，无边框
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tint(theme.colors.surface, theme.colors.accent, 0.16),   // 不透明的淡主题色（accent 叠在卡片色上），随吉祥物主题联动
        // 柔和投影，营造漂浮感
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
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
