import * as React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

//
// 渐变图标 chip
// ------------------------------------------------------------------
// 圆角 squircle 方块 + 对角渐变 + 白色字形 + 柔和同色投影，
// iOS app-icon 质感。用于设置项里需要更精致呈现的图标。
//

type GradientIconProps = {
    name: React.ComponentProps<typeof Ionicons>['name'];
    /** 渐变两端色（左上 → 右下） */
    colors?: readonly [string, string];
    /** chip 边长（默认贴合 Item iconContainer） */
    size?: number;
};

export const GradientIcon = React.memo(function GradientIcon({
    name,
    colors = ['#7B8CFF', '#5856D6'],
    size = 29,
}: GradientIconProps) {
    return (
        <View
            style={[
                styles.chip,
                {
                    width: size,
                    height: size,
                    borderRadius: size * 0.3,
                    shadowColor: colors[1],
                },
            ]}
        >
            <LinearGradient
                colors={colors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
            />
            {/* 顶部高光，增加立体质感 */}
            <View style={[styles.gloss, { pointerEvents: 'none' }]} />
            <Ionicons name={name} size={size * 0.58} color="#FFFFFF" style={styles.glyph} />
        </View>
    );
});

const styles = StyleSheet.create({
    chip: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        shadowOpacity: 0.45,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
    },
    gloss: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '50%',
        backgroundColor: 'rgba(255,255,255,0.18)',
    },
    glyph: {
        backgroundColor: 'transparent',
    },
});
