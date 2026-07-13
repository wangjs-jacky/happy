import * as React from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useLocalSettingMutable } from '@/sync/storage';
import { useHealthReports } from '@/hooks/useHealthReports';
import { pickSleepView, buildExerciseView, buildDietView } from '@/utils/healthLog';
import { hapticsLight } from '../haptics';
import { SleepHeroCard } from '@/components/rightPanel/SleepHeroCard';
import { SleepTrendCard } from '@/components/rightPanel/SleepTrendCard';
import { HealthDomainSwitcher } from '@/components/rightPanel/HealthDomainSwitcher';
import { ExerciseCard } from '@/components/rightPanel/ExerciseCard';
import { DietCard } from '@/components/rightPanel/DietCard';
import { t } from '@/text';
import type { AgentLauncher } from './launchAgent';

/**
 * 「Agent 空间模式」里的健康报告面板（= 会话内右滑 HealthCheckinPanel 的空间版）。
 * 差异：数据走「机器级」`useHealthReports`（空间里可能没有会话）；「记录今天的打卡」不再往会话
 * 输入框插提示词，而是直接在本空间**新起一个会话**并预填打卡提示词。域切换（睡眠/运动/饮食）
 * 与结构/趋势卡片全部复用既有 rightPanel 组件与 healthLog 纯函数。
 */
export const AgentSpaceHealthPanel = React.memo(({ agent, onStartSession }: {
    agent: AgentLauncher;
    onStartSession: (initialInput?: string) => void;
}) => {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const [domain, setDomain] = useLocalSettingMutable('healthActiveDomain');
    const [reloadKey, setReloadKey] = React.useState(0);
    const { loading, today, trend } = useHealthReports({
        machineId: agent.machineId,
        path: agent.path,
        enabled: true,
        reloadKey,
    });

    const sleepView = React.useMemo(() => pickSleepView(today, trend), [today, trend]);

    const logToday = React.useCallback(() => {
        hapticsLight();
        onStartSession(t('healthPanel.logTodayPrompt'));
    }, [onStartSession]);

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <View style={styles.titleRow}>
                <Ionicons name="fitness-outline" size={20} color={theme.colors.text} />
                <Text style={styles.title}>{t('healthPanel.title')}</Text>
                <View style={styles.spacer} />
                <Pressable onPress={() => setReloadKey((k) => k + 1)} hitSlop={10} style={({ pressed }) => pressed && styles.pressed}>
                    <Ionicons name="refresh" size={18} color={theme.colors.textSecondary} />
                </Pressable>
            </View>

            {loading ? (
                <View style={styles.loading}>
                    <ActivityIndicator color={theme.colors.textSecondary} />
                </View>
            ) : (
                <>
                    <HealthDomainSwitcher
                        active={domain}
                        onSelect={setDomain}
                        done={{
                            sleep: !!today?.hasSleep,
                            exercise: !!today?.hasExercise,
                            diet: !!today?.hasDiet,
                        }}
                    />

                    {domain === 'sleep' && (
                        <>
                            {sleepView ? (
                                <SleepHeroCard view={sleepView} />
                            ) : (
                                <View style={styles.card}>
                                    <Text style={styles.cardTitle}>{t('healthPanel.todayTitle')}</Text>
                                    <Text style={styles.muted}>{t('healthPanel.notLoggedToday')}</Text>
                                </View>
                            )}
                            <SleepTrendCard trend={trend} />
                        </>
                    )}

                    {domain === 'exercise' && (
                        <ExerciseCard view={today ? buildExerciseView(today) : null} trend={trend} />
                    )}

                    {domain === 'diet' && (
                        <DietCard view={today ? buildDietView(today) : null} trend={trend} />
                    )}

                    <Pressable
                        onPress={logToday}
                        style={({ pressed }) => [styles.logButton, pressed && styles.pressed]}
                    >
                        <Ionicons name="add-circle-outline" size={20} color={theme.colors.button.primary.tint} />
                        <Text style={styles.logButtonText}>{t('healthPanel.logToday')}</Text>
                    </Pressable>
                </>
            )}
        </ScrollView>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 16,
        paddingBottom: 24,
        gap: 14,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 6,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: theme.colors.text,
    },
    spacer: {
        flex: 1,
    },
    loading: {
        paddingVertical: 40,
        alignItems: 'center',
    },
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
    muted: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    logButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 12,
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
    },
    logButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.text,
    },
    pressed: {
        opacity: 0.6,
    },
}));
