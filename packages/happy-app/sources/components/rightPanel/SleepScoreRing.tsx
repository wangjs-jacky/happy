import * as React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

/** 评分环：环占比 = score/100，颜色随档（好/中/差）。size 默认 56。 */
export const SleepScoreRing = React.memo(function SleepScoreRing(props: { score: number; size?: number }) {
    const { theme } = useUnistyles();
    const size = props.size ?? 56;
    const stroke = 5;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(100, props.score)) / 100;
    const color = props.score >= 80 ? theme.colors.status.connected
        : props.score >= 60 ? theme.colors.text        // 中性档
        : theme.colors.textSecondary;
    return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
                <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.colors.surfacePressed} strokeWidth={stroke} fill="none" />
                <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
                    strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round" />
            </Svg>
            <Text style={styles.value}>{props.score}</Text>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    value: { fontSize: 15, fontWeight: '800', color: theme.colors.text },
}));
