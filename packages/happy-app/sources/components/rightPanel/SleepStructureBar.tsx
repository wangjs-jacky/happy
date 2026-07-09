import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { SleepStage } from '@/utils/healthLog';
import { t } from '@/text';

export const STAGE_COLORS: Record<SleepStage['key'], string> = { deep: '#4263eb', light: '#4dabf7', rem: '#9775fa' };
const LABEL: Record<SleepStage['key'], () => string> = { deep: () => t('healthPanel.deep'), light: () => t('healthPanel.light'), rem: () => t('healthPanel.rem') };

export const SleepStructureBar = React.memo(function SleepStructureBar(props: { stages: SleepStage[] }) {
    return (
        <View>
            <View style={styles.track}>
                {props.stages.map((s) => (
                    <View key={s.key} style={{ width: `${s.ratio * 100}%`, backgroundColor: STAGE_COLORS[s.key] }} />
                ))}
            </View>
            <View style={styles.legend}>
                {props.stages.map((s) => (
                    <View key={s.key} style={styles.item}>
                        <View style={[styles.sw, { backgroundColor: STAGE_COLORS[s.key] }]} />
                        <Text style={styles.txt}>{LABEL[s.key]()} {Math.round(s.ratio * 100)}%</Text>
                    </View>
                ))}
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    track: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: theme.colors.surfacePressed },
    legend: { flexDirection: 'row', gap: 12, marginTop: 8, flexWrap: 'wrap' },
    item: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    sw: { width: 8, height: 8, borderRadius: 2 },
    txt: { fontSize: 11, color: theme.colors.textSecondary },
}));
