import * as React from 'react';
import { useNavigation } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useIsTablet } from '@/utils/responsive';

//
// 当前屏幕聚焦期间，临时关闭根 Drawer（id="root"）的整屏横滑开合手势，失焦/卸载时恢复。
// ------------------------------------------------------------------
// 用途：手机端 Drawer 把 swipeEdgeWidth 设为整屏宽，全屏横滑都会拉出侧边栏，会和
// 页面内的自定义横滑（设置页土拨鼠左右滑切换形象）争抢、致其不流畅。让承载该交互
// 的屏幕在聚焦时关掉 Drawer 横滑，冲突源头即消失。
//
// - 仅手机端处理：桌面/平板 Drawer 是常驻（permanent）、本就 swipeEnabled=false，
//   不能在失焦时误置为 true，故 isTablet 时直接跳过。
// - useFocusEffect 的 cleanup 在失焦与卸载时都会跑，保证一定恢复，不会把 Drawer
//   横滑全局关死。
//
export function useDisableRootDrawerSwipeWhileFocused() {
    const navigation = useNavigation();
    const isTablet = useIsTablet();

    useFocusEffect(
        React.useCallback(() => {
            if (isTablet) {
                return;
            }
            const drawer = navigation.getParent('root' as never) as
                | { setOptions: (o: { swipeEnabled: boolean }) => void }
                | undefined;
            drawer?.setOptions({ swipeEnabled: false });
            return () => {
                drawer?.setOptions({ swipeEnabled: true });
            };
        }, [navigation, isTablet])
    );
}
