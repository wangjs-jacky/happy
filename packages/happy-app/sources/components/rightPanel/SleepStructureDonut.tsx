import * as React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { SleepStage } from '@/utils/healthLog';
import { STAGE_COLORS } from './SleepStructureBar';

/** 甜甜圈：各阶段占比拼环。size 默认 96，中心显 centerLabel（如总时长）。 */
export const SleepStructureDonut = React.memo(function SleepStructureDonut(props: { stages: SleepStage[]; centerLabel?: string | null }) {
    const { theme } = useUnistyles();
    const size = 96, stroke = 12, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    let offset = 0;
    return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
                <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.colors.surfacePressed} strokeWidth={stroke} fill="none" />
                {props.stages.map((s) => {
                    const seg = c * s.ratio;
                    const dash = `${seg} ${c - seg}`;
                    const el = <Circle key={s.key} cx={size / 2} cy={size / 2} r={r} stroke={STAGE_COLORS[s.key]} strokeWidth={stroke} fill="none" strokeDasharray={dash} strokeDashoffset={-offset} />;
                    offset += seg;
                    return el;
                })}
            </Svg>
            {props.centerLabel ? <Text style={styles.center}>{props.centerLabel}</Text> : null}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    center: { position: 'absolute', fontSize: 14, fontWeight: '800', color: theme.colors.text },
}));
