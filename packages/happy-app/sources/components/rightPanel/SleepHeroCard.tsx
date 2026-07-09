import * as React from 'react';
import { View, Text, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { todayLocalISO, type SleepView } from '@/utils/healthLog';
import { useLocalSettingMutable } from '@/sync/storage';
import { hapticsLight } from '../haptics';
import { t } from '@/text';
import { SleepScoreRing } from './SleepScoreRing';
import { SleepStructureBar } from './SleepStructureBar';
import { SleepStructureDonut } from './SleepStructureDonut';

/**
 * Hero 卡：展示今晚总睡眠时长（大字）、评分环（可选）、结构视图（堆叠条/甜甜圈可切换）、
 * 入睡/起床时间。渐变背景在明暗主题下均使用半透明叠加，不硬编码深色值。
 */
export const SleepHeroCard = React.memo(function SleepHeroCard(props: { view: SleepView }) {
    const { view } = props;
    const { theme } = useUnistyles();
    const [mode, setMode] = useLocalSettingMutable('healthSleepStructureView');

    const handleToggleMode = React.useCallback(() => {
        hapticsLight();
        setMode(mode === 'bar' ? 'donut' : 'bar');
    }, [mode, setMode]);

    // 渐变色：基于 surface 做两段叠加，在所有主题下均和谐
    const gradientColors: [string, string] = [
        theme.colors.surface,
        theme.colors.surfaceHighest,
    ];

    const hasStructure = view.stages.length > 0;
    // 今天有记录显示「今晚」，否则显示「最近一晚 · MM-DD」（兜底：今天没打卡也能看到富样式）
    const isToday = view.date === todayLocalISO(new Date());

    return (
        <LinearGradient
            colors={gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.card}
        >
            {/* 顶部：左总时长 + 右评分环 */}
            <View style={styles.topRow}>
                <View style={styles.leftBlock}>
                    <Text style={styles.totalLabel}>{view.totalLabel ?? '—'}</Text>
                    <Text style={styles.totalSubLabel}>{isToday ? t('healthPanel.tonightSleep') : t('healthPanel.recentNightLabel', { date: view.date.slice(5) })}</Text>
                </View>
                {view.score != null ? (
                    <SleepScoreRing score={view.score} size={64} />
                ) : null}
            </View>

            {/* 结构区：仅有 stages 时才渲染 */}
            {hasStructure ? (
                <View style={styles.structureSection}>
                    <View style={styles.structureTitleRow}>
                        <Text style={styles.structureTitle}>{t('healthPanel.structureTitle')}</Text>
                        <Pressable
                            onPress={handleToggleMode}
                            hitSlop={10}
                            style={({ pressed }) => pressed && styles.pressed}
                        >
                            <Ionicons
                                name={mode === 'bar' ? 'pie-chart-outline' : 'stats-chart-outline'}
                                size={18}
                                color={theme.colors.textSecondary}
                            />
                        </Pressable>
                    </View>
                    {mode === 'bar' ? (
                        <SleepStructureBar stages={view.stages} />
                    ) : (
                        <View style={styles.donutWrap}>
                            <SleepStructureDonut stages={view.stages} centerLabel={view.totalLabel} />
                        </View>
                    )}
                </View>
            ) : null}

            {/* 底部：入睡 / 起床 */}
            {(view.bedtime != null || view.wakeTime != null) ? (
                <View style={styles.bottomRow}>
                    {view.bedtime != null ? (
                        <View style={styles.timeItem}>
                            <Text style={styles.timeLabel}>{t('healthPanel.bedtime')}</Text>
                            <Text style={styles.timeValue}>{view.bedtime}</Text>
                        </View>
                    ) : null}
                    {view.wakeTime != null ? (
                        <View style={styles.timeItem}>
                            <Text style={styles.timeLabel}>{t('healthPanel.wakeTime')}</Text>
                            <Text style={styles.timeValue}>{view.wakeTime}</Text>
                        </View>
                    ) : null}
                </View>
            ) : null}
        </LinearGradient>
    );
});

const styles = StyleSheet.create((theme) => ({
    card: {
        borderRadius: 16,
        padding: 16,
        gap: 14,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    leftBlock: {
        gap: 2,
    },
    totalLabel: {
        fontSize: 36,
        fontWeight: '800',
        color: theme.colors.text,
        letterSpacing: -1,
    },
    totalSubLabel: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        fontWeight: '500',
    },
    structureSection: {
        gap: 10,
    },
    structureTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    structureTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
    },
    donutWrap: {
        alignItems: 'center',
    },
    bottomRow: {
        flexDirection: 'row',
        gap: 24,
        paddingTop: 4,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    timeItem: {
        gap: 2,
    },
    timeLabel: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        fontWeight: '500',
        textTransform: 'uppercase',
    },
    timeValue: {
        fontSize: 17,
        fontWeight: '700',
        color: theme.colors.text,
    },
    pressed: {
        opacity: 0.6,
    },
}));
