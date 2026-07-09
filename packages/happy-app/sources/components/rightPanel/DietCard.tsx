import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { DietView, HealthLog } from '@/utils/healthLog';
import { t } from '@/text';

interface Props {
    view: DietView | null;
    trend: HealthLog[];
}

/**
 * 饮食卡片：今日饮食摘要 + 本周摄入卡路里趋势（复用 SleepTrendCard 条形图视觉）。
 */
export const DietCard = React.memo(function DietCard(props: Props) {
    const { view, trend } = props;

    const kcalSuffix = t('healthPanel.kcalSuffix');

    // 计算最大摄入卡路里，用于归一化柱宽；确保至少为 1 避免除零
    const maxKcal = React.useMemo(
        () => Math.max(1, ...trend.map((d) => d.intakeKcal ?? 0)),
        [trend],
    );

    const hasAnyKcal = trend.some((d) => d.intakeKcal != null);

    return (
        <>
            {/* 今日饮食卡 */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('healthPanel.dietToday')}</Text>
                {view ? (
                    <View style={styles.content}>
                        {/* 各餐列表 */}
                        {view.meals.map((meal, i) => (
                            <View key={i} style={styles.mealRow}>
                                <Text style={styles.mealName}>{meal.name}</Text>
                                <Text style={styles.mealKcal}>
                                    {meal.kcal != null ? `${meal.kcal}${kcalSuffix}` : '—'}
                                </Text>
                            </View>
                        ))}
                        {/* 摄入总量 */}
                        {view.intakeKcal != null && (
                            <View style={styles.totalRow}>
                                <Text style={styles.totalLabel}>{t('healthPanel.intakeLabel')}</Text>
                                <Text style={styles.totalValue}>
                                    {view.intakeKcal}{kcalSuffix}
                                </Text>
                            </View>
                        )}
                    </View>
                ) : (
                    <Text style={styles.muted}>{t('healthPanel.noDietToday')}</Text>
                )}
            </View>

            {/* 本周摄入卡路里趋势卡 */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('healthPanel.trendTitle')}</Text>
                {trend.length === 0 || !hasAnyKcal ? (
                    <Text style={styles.muted}>{t('healthPanel.noTrendData')}</Text>
                ) : (
                    <View style={styles.trend}>
                        {trend.map((d) => {
                            const kcal = d.intakeKcal;
                            const hasDatum = kcal != null;
                            const pct = hasDatum ? (kcal / maxKcal) * 100 : 0;
                            const label = hasDatum ? `${kcal}${kcalSuffix}` : '—';

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
        </>
    );
});

const styles = StyleSheet.create((theme) => ({
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 14,
        gap: 12,
    },
    cardTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.colors.textSecondary,
    },
    content: {
        gap: 8,
    },
    mealRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    mealName: {
        fontSize: 14,
        color: theme.colors.text,
        flex: 1,
    },
    mealKcal: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginLeft: 8,
    },
    totalRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 6,
        borderTopWidth: 1,
        borderTopColor: theme.colors.surfacePressed,
    },
    totalLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
    },
    totalValue: {
        fontSize: 14,
        fontWeight: '700',
        color: theme.colors.text,
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
        width: 52,
        textAlign: 'right',
        fontSize: 12,
        color: theme.colors.text,
    },
}));
