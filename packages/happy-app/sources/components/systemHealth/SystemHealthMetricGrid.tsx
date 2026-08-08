import React from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import type { SystemHealthCurrent } from '@/utils/systemHealth';
import { t } from '@/text';

const bytes = (value: number) => `${(value / 1024 ** 3).toFixed(1)} GB`;

export const SystemHealthMetricGrid = React.memo<{ current: SystemHealthCurrent }>(({ current }) => {
    const metrics = [
        [t('machine.systemHealth.metrics.cpu'), `${current.cpuUsedPercent.toFixed(1)}%`],
        [t('machine.systemHealth.metrics.memory'), `${bytes(current.memoryAvailableBytes)} / ${bytes(current.memoryTotalBytes)}`],
        [t('machine.systemHealth.metrics.swap'), `${bytes(current.swapUsedBytes)} / ${bytes(current.swapTotalBytes)}`],
        [t('machine.systemHealth.metrics.processes'), current.processLimit ? `${current.processCount.toLocaleString()} / ${current.processLimit.toLocaleString()}` : current.processCount.toLocaleString()],
    ];
    return (
        <View style={styles.grid}>
            {metrics.map(([label, value]) => (
                <View key={label} style={styles.metric}>
                    <Text style={styles.value}>{value}</Text>
                    <Text style={styles.label}>{label}</Text>
                </View>
            ))}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: -4,
    },
    metric: {
        width: {
            xs: '50%',
            lg: '25%',
        },
        padding: 8,
    },
    value: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 17,
    },
    label: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginTop: 2,
    },
}));
