import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import type { SystemHealthCurrent, SystemHealthSource } from '@/utils/systemHealth';
import { t } from '@/text';

const rss = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${Math.round(value / 1024 ** 2)} MB`;

function SourceRow({ source }: { source: SystemHealthSource }) {
    return (
        <View testID="system-health-source" style={styles.row}>
            <Text style={styles.name} numberOfLines={1}>{source.name}</Text>
            <Text style={styles.detail}>
                {source.cpuPercent.toFixed(1)}% · {rss(source.rssBytes)} · {source.processCount}
                {source.zombieProcessCount > 0 ? ` · ${t('machine.systemHealth.zombieShort', { count: source.zombieProcessCount })}` : ''}
            </Text>
        </View>
    );
}

export const SystemHealthSources = React.memo<{ current: SystemHealthCurrent }>(({ current }) => {
    const sources = useMemo(() => {
        const selected = current.topCpuSources.slice(0, 3);
        const ids = new Set(selected.map((source) => source.id));
        for (const source of current.topMemorySources) {
            if (selected.length >= 5) break;
            if (!ids.has(source.id)) {
                selected.push(source);
                ids.add(source.id);
            }
        }
        return selected;
    }, [current.topCpuSources, current.topMemorySources]);
    return (
        <View style={styles.container}>
            {sources.length > 0 && <Text style={styles.heading}>{t('machine.systemHealth.sources')}</Text>}
            {sources.map((source) => <SourceRow key={source.id} source={source} />)}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        paddingTop: 12,
        marginTop: 4,
    },
    heading: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 12,
        textTransform: 'uppercase',
        marginBottom: 4,
        marginTop: 6,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 5,
    },
    name: {
        ...Typography.default(),
        color: theme.colors.text,
        fontSize: 13,
        flex: 1,
    },
    detail: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 12,
    },
}));
