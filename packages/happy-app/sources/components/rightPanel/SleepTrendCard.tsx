import * as React from 'react';
import { View, Text, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { HealthLog } from '@/utils/healthLog';
import { useLocalSettingMutable } from '@/sync/storage';
import { hapticsLight } from '../haptics';
import { t } from '@/text';

/**
 * 本周睡眠趋势卡。
 * 用 useLocalSettingMutable('healthSleepTrendMetric') 在「时长」/「评分」间切换 tab。
 * 复用 HealthCheckinPanel 的 barTrack/barFill 样式。缺失数据的日期显示灰色占位条。
 */
export const SleepTrendCard = React.memo(function SleepTrendCard(props: { trend: HealthLog[] }) {
    const { theme } = useUnistyles();
    const [metric, setMetric] = useLocalSettingMutable('healthSleepTrendMetric');

    const handleSetDuration = React.useCallback(() => {
        hapticsLight();
        setMetric('duration');
    }, [setMetric]);

    const handleSetScore = React.useCallback(() => {
        hapticsLight();
        setMetric('score');
    }, [setMetric]);

    const isDuration = metric === 'duration';

    // 计算最大值，用于归一化柱高；确保至少为 1 避免除零
    const maxValue = React.useMemo(() => {
        if (isDuration) {
            return Math.max(1, ...props.trend.map((d) => d.sleepTotalMin ?? 0));
        } else {
            return Math.max(1, ...props.trend.map((d) => d.sleepScore ?? 0));
        }
    }, [props.trend, isDuration]);

    const hasAnyData = props.trend.some((d) =>
        isDuration ? d.sleepTotalMin != null : d.sleepScore != null,
    );

    return (
        <View style={styles.card}>
            {/* 标题 + tab 切换 */}
            <View style={styles.headerRow}>
                <Text style={styles.cardTitle}>{t('healthPanel.trendTitle')}</Text>
                <View style={styles.tabs}>
                    <Pressable
                        onPress={handleSetDuration}
                        style={({ pressed }) => [
                            styles.tab,
                            isDuration && styles.tabActive,
                            pressed && styles.pressed,
                        ]}
                    >
                        <Text style={[styles.tabText, isDuration && styles.tabTextActive]}>
                            {t('healthPanel.trendDuration')}
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={handleSetScore}
                        style={({ pressed }) => [
                            styles.tab,
                            !isDuration && styles.tabActive,
                            pressed && styles.pressed,
                        ]}
                    >
                        <Text style={[styles.tabText, !isDuration && styles.tabTextActive]}>
                            {t('healthPanel.trendScore')}
                        </Text>
                    </Pressable>
                </View>
            </View>

            {/* 数据区 */}
            {!hasAnyData ? (
                <Text style={styles.muted}>{t('healthPanel.noTrendData')}</Text>
            ) : (
                <View style={styles.trend}>
                    {props.trend.map((d) => {
                        const rawValue = isDuration ? d.sleepTotalMin : d.sleepScore;
                        const hasDatum = rawValue != null;
                        const pct = hasDatum ? (rawValue / maxValue) * 100 : 0;

                        // 显示文字：时长用 XhYm 风格，评分用数字
                        let label = '—';
                        if (hasDatum) {
                            if (isDuration) {
                                const h = Math.floor(rawValue / 60);
                                const m = rawValue % 60;
                                label = `${h}h${m}m`;
                            } else {
                                label = String(rawValue);
                            }
                        }

                        return (
                            <View key={d.date} style={styles.trendRow}>
                                <Text style={styles.trendDate}>{d.date.slice(5)}</Text>
                                <View style={styles.barTrack}>
                                    <View
                                        style={[
                                            styles.barFill,
                                            !hasDatum && styles.barFillMissing,
                                            { width: hasDatum ? `${pct}%` : '15%' },
                                        ]}
                                    />
                                </View>
                                <Text style={[styles.trendValue, !hasDatum && styles.muted]}>
                                    {label}
                                </Text>
                            </View>
                        );
                    })}
                </View>
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 14,
        gap: 12,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    cardTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.colors.textSecondary,
    },
    tabs: {
        flexDirection: 'row',
        gap: 4,
        backgroundColor: theme.colors.surfacePressed,
        borderRadius: 8,
        padding: 2,
    },
    tab: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
    },
    tabActive: {
        backgroundColor: theme.colors.surface,
    },
    tabText: {
        fontSize: 12,
        fontWeight: '500',
        color: theme.colors.textSecondary,
    },
    tabTextActive: {
        color: theme.colors.text,
        fontWeight: '600',
    },
    muted: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    trend: {
        gap: 8,
    },
    trendRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    trendDate: {
        width: 40,
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    barTrack: {
        flex: 1,
        height: 10,
        borderRadius: 5,
        backgroundColor: theme.colors.surfacePressed,
        overflow: 'hidden',
    },
    barFill: {
        height: 10,
        borderRadius: 5,
        backgroundColor: theme.colors.button.primary.background,
    },
    barFillMissing: {
        backgroundColor: theme.colors.surfacePressed,
    },
    trendValue: {
        width: 44,
        textAlign: 'right',
        fontSize: 12,
        color: theme.colors.text,
    },
    pressed: {
        opacity: 0.6,
    },
}));
