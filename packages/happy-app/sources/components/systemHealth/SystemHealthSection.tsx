import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { Machine } from '@/sync/storageTypes';
import { buildSystemHealthViewModel, type SystemHealthStatus } from '@/utils/systemHealth';
import { ItemGroup } from '@/components/ItemGroup';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { SystemHealthMetricGrid } from './SystemHealthMetricGrid';
import { SystemHealthSources } from './SystemHealthSources';
import { SystemHealthSparkline } from './SystemHealthSparkline';

interface Props {
    machine: Machine;
    now: number;
}

function statusKey(status: SystemHealthStatus) {
    return `machine.systemHealth.status.${status}` as const;
}

function bytes(value: number) {
    return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export const SystemHealthSection = React.memo<Props>(({ machine, now }) => {
    const { theme } = useUnistyles();
    const view = useMemo(() => buildSystemHealthViewModel(machine, now), [machine, now]);
    if (!view.visible) return null;

    const color = view.status === 'critical'
        ? theme.colors.warningCritical
        : view.status === 'warning'
            ? '#FF9500'
            : view.status === 'healthy'
                ? theme.colors.success
                : theme.colors.textSecondary;
    const emptyKey = ({
        unsupported: 'machine.systemHealth.empty.unsupported',
        disabled: 'machine.systemHealth.empty.disabled',
        pending: 'machine.systemHealth.empty.pending',
        collecting: 'machine.systemHealth.empty.collecting',
        unavailable: 'machine.systemHealth.empty.unavailable',
    } as const)[view.availability as 'unsupported' | 'disabled' | 'pending' | 'collecting' | 'unavailable'];

    return (
        <View testID="system-health-section">
            <ItemGroup title={t('machine.systemHealth.title')}>
                <View style={styles.container}>
                    <View
                        testID="system-health-status"
                        style={styles.statusRow}
                        accessible
                        accessibilityLabel={t('machine.systemHealth.statusSummary', { status: t(statusKey(view.status) as never) })}
                    >
                        <View style={[styles.dot, { backgroundColor: color }]} />
                        <Text style={[styles.status, { color }]}>{t(statusKey(view.status) as never)}</Text>
                        {view.ageMs !== null && (
                            <Text style={styles.updated}>{t('machine.systemHealth.updatedAgo', { seconds: Math.round(view.ageMs / 1000) })}</Text>
                        )}
                    </View>

                    {view.availability !== 'available' || !view.current || !view.snapshot ? (
                        <View style={styles.empty}>
                            <Text style={styles.emptyTitle}>{emptyKey ? t(emptyKey) : t('machine.systemHealth.empty.unavailable')}</Text>
                            {view.availability === 'disabled' && <Text style={styles.emptyDetail}>HAPPY_SYSTEM_HEALTH_MONITOR=1</Text>}
                            {view.snapshot?.collector.errors.length ? (
                                <Text style={styles.emptyDetail}>{t('machine.systemHealth.collectorErrors', { count: view.snapshot.collector.errors.length })}</Text>
                            ) : null}
                        </View>
                    ) : (
                        <>
                            <SystemHealthMetricGrid current={view.current} />
                            <View style={styles.facts}>
                                <Text style={styles.fact}>{t('machine.systemHealth.facts.zombies', { count: view.current.zombieProcessCount })}</Text>
                                <Text style={styles.fact}>{t('machine.systemHealth.facts.load', { one: view.current.load1.toFixed(1), five: view.current.load5.toFixed(1), fifteen: view.current.load15.toFixed(1) })}</Text>
                                {view.current.memoryPressureFreePercent !== undefined && <Text style={styles.fact}>{t('machine.systemHealth.facts.pressure', { percent: view.current.memoryPressureFreePercent.toFixed(0) })}</Text>}
                                <Text style={styles.fact}>{t('machine.systemHealth.facts.compressed', { value: bytes(view.current.memoryCompressedBytes) })}</Text>
                                {view.current.diskFreeBytes !== undefined && <Text style={styles.fact}>{t('machine.systemHealth.facts.disk', { value: bytes(view.current.diskFreeBytes) })}</Text>}
                                <Text style={styles.fact}>{t('machine.systemHealth.facts.workers', { roots: view.current.pawsWorkerRoots, processes: view.current.pawsWorkerProcesses, rss: bytes(view.current.pawsWorkerRssBytes) })}</Text>
                                <Text style={styles.fact}>{t('machine.systemHealth.facts.orphans', { roots: view.current.orphanWorkerRoots, processes: view.current.orphanWorkerProcesses, rss: bytes(view.current.orphanWorkerRssBytes) })}</Text>
                            </View>
                            {view.snapshot.issues.length > 0 && (
                                <View style={styles.issues}>
                                    {view.snapshot.issues.map((issue) => (
                                        <Text key={`${issue.code}:${issue.subject ?? ''}`} style={[styles.issue, { color }]}>
                                            {t(`machine.systemHealth.issues.${issue.code}` as never)}
                                        </Text>
                                    ))}
                                </View>
                            )}
                            <View style={styles.trends}>
                                <Text style={styles.sectionTitle}>{t('machine.systemHealth.trends')}</Text>
                                {view.charts.map((chart) => <SystemHealthSparkline key={chart.key} chart={chart} color={color} />)}
                            </View>
                            <SystemHealthSources current={view.current} />
                        </>
                    )}
                </View>
            </ItemGroup>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 7,
    },
    status: {
        ...Typography.default('semiBold'),
        fontSize: 14,
    },
    updated: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginLeft: 'auto',
    },
    empty: {
        paddingVertical: 12,
    },
    emptyTitle: {
        ...Typography.default(),
        color: theme.colors.text,
        fontSize: 14,
    },
    emptyDetail: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginTop: 6,
    },
    facts: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        paddingTop: 10,
        marginTop: 4,
        gap: 3,
    },
    fact: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 17,
    },
    issues: {
        marginTop: 10,
        gap: 3,
    },
    issue: {
        ...Typography.default('semiBold'),
        fontSize: 12,
    },
    trends: {
        marginTop: 12,
    },
    sectionTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 12,
        textTransform: 'uppercase',
        marginBottom: 4,
    },
}));
