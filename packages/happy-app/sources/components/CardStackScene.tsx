import * as React from 'react';
import { Platform, View } from 'react-native';
import Animated, { useAnimatedStyle, interpolate, Extrapolation } from 'react-native-reanimated';
import { DrawerProgressContext } from '@react-navigation/drawer';
import { useUnistyles } from 'react-native-unistyles';
import { useIsTablet } from '@/utils/responsive';
import { useAuth } from '@/auth/AuthContext';

/**
 * 卡片栈主场景包裹层。
 *
 * 背景：手机端把侧边栏从抽屉（drawerType: 'front'，浮在内容上方）改成卡片栈
 * （drawerType: 'back'，侧栏固定在背后、内容滑开露出它）后，仅靠库自带的内容
 * 横移还差「卡片感」。这里用 useDrawerProgress() 拿到 0→1 的打开进度，给主内容
 * 叠加 缩放 + 圆角 + 轻微右移，做出「主卡被推走、缩小、圆角」的层叠观感。
 *
 * 只在 native 手机 + 已登录 时启用，原因：
 *  - 平板走 drawerType: 'permanent'，progress 恒为 1，启用会把内容永久缩小；
 *  - web 端 progress 是 0/1 二值跳变（CSS transition 实现，无逐帧），缩放会突兀闪跳；
 *  这两种情况直接平铺渲染。
 *
 * 注意：启动/错误恢复路径中本组件可能先于 Drawer provider 渲染。没有 progress 时
 * 直接退化为静态容器，避免开发构建在进入主界面前被 drawer hook 打断。
 */
export const CardStackScene = React.memo((props: { children: React.ReactNode }) => {
    const progress = React.useContext(DrawerProgressContext);
    const isTablet = useIsTablet();
    const auth = useAuth();
    const { theme } = useUnistyles();

    const enabled = !!progress && !isTablet && auth.isAuthenticated && Platform.OS !== 'web';

    const animatedStyle = useAnimatedStyle(() => {
        if (!enabled) {
            return {};
        }
        const p = progress?.value ?? 0;
        return {
            transform: [
                { translateX: interpolate(p, [0, 1], [0, 12], Extrapolation.CLAMP) },
                { scale: interpolate(p, [0, 1], [1, 0.9], Extrapolation.CLAMP) },
            ],
            borderRadius: interpolate(p, [0, 1], [0, 24], Extrapolation.CLAMP),
        };
    });

    if (!enabled) {
        return <View style={{ flex: 1 }}>{props.children}</View>;
    }

    return (
        <Animated.View
            style={[
                { flex: 1, overflow: 'hidden', backgroundColor: theme.colors.surface },
                animatedStyle,
            ]}
        >
            {props.children}
        </Animated.View>
    );
});
