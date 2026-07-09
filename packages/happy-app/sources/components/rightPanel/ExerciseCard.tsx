import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { ExerciseView, HealthLog } from '@/utils/healthLog';
import { t } from '@/text';

interface Props {
    view: ExerciseView | null;
    trend: HealthLog[];
}

/**
 * 运动卡片：今日运动摘要 + 本周运动频率趋势。
 * 趋势展示是否有运动（频率），而非卡路里数值，对空数据更健壮。
 */
export const ExerciseCard = React.memo(function ExerciseCard(props: Props) {
    const { view, trend } = props;

    return (
        <>
            {/* 今日运动卡 */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('healthPanel.exerciseToday')}</Text>
                {view ? (
                    <View style={styles.content}>
                        {/* 运动类型列表 */}
                        {view.types.length > 0 && (
                            <View style={styles.typesRow}>
                                {view.types.map((type, i) => (
                                    <View key={i} style={styles.typeChip}>
                                        <Text style={styles.typeText}>{type}</Text>
                                    </View>
                                ))}
                            </View>
                        )}
                        {/* 消耗卡路里 */}
                        {view.burn != null && (
                            <Text style={styles.burnText}>
                                {t('healthPanel.burnedKcal')}{' '}
                                <Text style={styles.burnValue}>
                                    {view.burn}{t('healthPanel.kcalSuffix')}
                                </Text>
                            </Text>
                        )}
                    </View>
                ) : (
                    <Text style={styles.muted}>{t('healthPanel.noExerciseToday')}</Text>
                )}
            </View>

            {/* 本周运动频率趋势卡 */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('healthPanel.trendTitle')}</Text>
                {trend.length === 0 ? (
                    <Text style={styles.muted}>{t('healthPanel.noTrendData')}</Text>
                ) : (
                    <View style={styles.trend}>
                        {trend.map((d) => (
                            <View key={d.date} style={styles.trendRow}>
                                <Text style={styles.trendDate}>{d.date.slice(5)}</Text>
                                {/* 填充/空心圆点：是否当天有运动 */}
                                <View style={styles.dotWrapper}>
                                    <View style={d.hasExercise ? styles.dotFilled : styles.dotHollow} />
                                </View>
                                <Text style={[styles.trendLabel, !d.hasExercise && styles.muted]}>
                                    {d.hasExercise
                                        ? d.exerciseTypes.length > 0
                                            ? d.exerciseTypes[0]
                                            : t('healthPanel.exercise')
                                        : '—'}
                                </Text>
                            </View>
                        ))}
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
        gap: 10,
    },
    typesRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    typeChip: {
        backgroundColor: theme.colors.surfacePressed,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    typeText: {
        fontSize: 13,
        fontWeight: '500',
        color: theme.colors.text,
    },
    burnText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    burnValue: {
        fontWeight: '600',
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
        gap: 10,
    },
    trendDate: {
        width: 40,
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    dotWrapper: {
        width: 18,
        alignItems: 'center',
    },
    dotFilled: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: theme.colors.button.primary.background,
    },
    dotHollow: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: theme.colors.surfacePressed,
    },
    trendLabel: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.text,
    },
    pressed: {
        opacity: 0.6,
    },
}));
