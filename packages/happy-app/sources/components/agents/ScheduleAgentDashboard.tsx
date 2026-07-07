import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { hapticsLight } from '../haptics';
import {
    SCHEDULE_AGENT_ACTIONS,
    SCHEDULE_AGENT_MODULES,
    createScheduleAgentPanelState,
    getScheduleAgentActionPrompt,
    reduceScheduleAgentPanelState,
    type ScheduleAgentActionId,
    type ScheduleAgentModuleId,
} from './scheduleAgentModel';

type ScheduleAgentDashboardProps = {
    machineName: string | null;
    online: boolean;
    canSubmit: boolean;
    onInsertPrompt: (prompt: string) => void;
};

function moduleCopy(id: ScheduleAgentModuleId) {
    switch (id) {
        case 'today':
            return {
                label: t('agents.scheduleModuleTodayLabel'),
                title: t('agents.scheduleModuleTodayTitle'),
                body: t('agents.scheduleModuleTodayBody'),
                metric: t('agents.scheduleModuleTodayMetric'),
            };
        case 'task-pool':
            return {
                label: t('agents.scheduleModulePoolLabel'),
                title: t('agents.scheduleModulePoolTitle'),
                body: t('agents.scheduleModulePoolBody'),
                metric: t('agents.scheduleModulePoolMetric'),
            };
        case 'calendar':
            return {
                label: t('agents.scheduleModuleCalendarLabel'),
                title: t('agents.scheduleModuleCalendarTitle'),
                body: t('agents.scheduleModuleCalendarBody'),
                metric: t('agents.scheduleModuleCalendarMetric'),
            };
        case 'review':
            return {
                label: t('agents.scheduleModuleReviewLabel'),
                title: t('agents.scheduleModuleReviewTitle'),
                body: t('agents.scheduleModuleReviewBody'),
                metric: t('agents.scheduleModuleReviewMetric'),
            };
    }
}

function actionCopy(id: ScheduleAgentActionId) {
    switch (id) {
        case 'plan-today':
            return {
                title: t('agents.scheduleActionPlanToday'),
                body: t('agents.scheduleActionPlanTodayBody'),
            };
        case 'review-pool':
            return {
                title: t('agents.scheduleActionReviewPool'),
                body: t('agents.scheduleActionReviewPoolBody'),
            };
        case 'sync-tt':
            return {
                title: t('agents.scheduleActionSyncTt'),
                body: t('agents.scheduleActionSyncTtBody'),
            };
        case 'weekly-reset':
            return {
                title: t('agents.scheduleActionWeeklyReset'),
                body: t('agents.scheduleActionWeeklyResetBody'),
            };
    }
}

export const ScheduleAgentDashboard = React.memo(function ScheduleAgentDashboard({
    machineName,
    online,
    canSubmit,
    onInsertPrompt,
}: ScheduleAgentDashboardProps) {
    const { theme } = useUnistyles();
    const [state, setState] = React.useState(createScheduleAgentPanelState);
    const activeModule = SCHEDULE_AGENT_MODULES.find((item) => item.id === state.focusedModuleId) ?? SCHEDULE_AGENT_MODULES[0];
    const activeModuleCopy = moduleCopy(activeModule.id);
    const selectedAction = state.selectedActionId ? actionCopy(state.selectedActionId) : null;

    const focusModule = React.useCallback((moduleId: ScheduleAgentModuleId) => {
        hapticsLight();
        setState((current) => reduceScheduleAgentPanelState(current, { type: 'focus-module', moduleId }));
    }, []);

    const selectCommand = React.useCallback((actionId: ScheduleAgentActionId) => {
        hapticsLight();
        const prompt = getScheduleAgentActionPrompt(actionId);
        setState((current) => reduceScheduleAgentPanelState(current, { type: 'select-command', actionId }));
        onInsertPrompt(prompt);
    }, [onInsertPrompt]);

    const openChat = React.useCallback(() => {
        hapticsLight();
        setState((current) => reduceScheduleAgentPanelState(current, { type: 'open-chat' }));
    }, []);

    return (
        <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
        >
            <View style={styles.hero}>
                <View style={styles.heroTop}>
                    <View style={styles.agentMark}>
                        <Ionicons name="calendar-clear-outline" size={22} color={theme.colors.button.primary.tint} />
                    </View>
                    <View style={styles.statusWrap}>
                        <View style={[styles.statusDot, { backgroundColor: online ? theme.colors.status.connected : theme.colors.status.disconnected }]} />
                        <Text style={styles.statusText} numberOfLines={1}>
                            {online
                                ? t('agents.scheduleStatusOnline', { machine: machineName ?? t('agentInput.noMachinesAvailable') })
                                : t('agents.scheduleStatusOffline')}
                        </Text>
                    </View>
                </View>
                <Text style={styles.heroTitle} numberOfLines={2}>
                    {t('agents.scheduleDashboardTitle')}
                </Text>
                <Text style={styles.heroBody} numberOfLines={3}>
                    {t('agents.scheduleDashboardBody')}
                </Text>
                {!canSubmit && (
                    <View style={styles.warningPill}>
                        <Ionicons name="alert-circle-outline" size={15} color="#B45309" />
                        <Text style={styles.warningText} numberOfLines={2}>
                            {t('agents.scheduleOfflineHint')}
                        </Text>
                    </View>
                )}
            </View>

            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.segmentRow}
                keyboardShouldPersistTaps="always"
            >
                {SCHEDULE_AGENT_MODULES.map((module) => {
                    const copy = moduleCopy(module.id);
                    const selected = state.activeView === module.id;
                    return (
                        <Pressable
                            key={module.id}
                            onPress={() => focusModule(module.id)}
                            style={({ pressed }) => [
                                styles.segment,
                                selected && { backgroundColor: module.accent, borderColor: module.accent },
                                pressed && styles.pressed,
                            ]}
                        >
                            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]} numberOfLines={1}>
                                {copy.label}
                            </Text>
                        </Pressable>
                    );
                })}
            </ScrollView>

            <View style={styles.focusPanel}>
                <View style={[styles.focusAccent, { backgroundColor: activeModule.accent }]} />
                <View style={styles.focusCopy}>
                    <Text style={styles.focusEyebrow} numberOfLines={1}>
                        {activeModuleCopy.metric}
                    </Text>
                    <Text style={styles.focusTitle} numberOfLines={2}>
                        {activeModuleCopy.title}
                    </Text>
                    <Text style={styles.focusBody} numberOfLines={3}>
                        {activeModuleCopy.body}
                    </Text>
                </View>
            </View>

            <View style={styles.moduleGrid}>
                {SCHEDULE_AGENT_MODULES.map((module) => {
                    const copy = moduleCopy(module.id);
                    const selected = state.focusedModuleId === module.id;
                    return (
                        <Pressable
                            key={module.id}
                            onPress={() => focusModule(module.id)}
                            style={({ pressed }) => [
                                styles.moduleCard,
                                selected && { borderColor: module.accent },
                                pressed && styles.pressed,
                            ]}
                        >
                            <View style={[styles.moduleIcon, { backgroundColor: `${module.accent}18` }]}>
                                <Ionicons name={module.icon} size={20} color={module.accent} />
                            </View>
                            <Text style={styles.moduleTitle} numberOfLines={1}>{copy.title}</Text>
                            <Text style={styles.moduleBody} numberOfLines={2}>{copy.body}</Text>
                        </Pressable>
                    );
                })}
            </View>

            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle} numberOfLines={1}>{t('agents.scheduleActionsTitle')}</Text>
                <Pressable onPress={openChat} style={({ pressed }) => [styles.chatButton, pressed && styles.pressed]}>
                    <Ionicons name="chatbubble-ellipses-outline" size={15} color={theme.colors.text} />
                    <Text style={styles.chatButtonText} numberOfLines={1}>{t('agents.scheduleOpenChat')}</Text>
                </Pressable>
            </View>

            <View style={styles.actionList}>
                {SCHEDULE_AGENT_ACTIONS.map((action) => {
                    const copy = actionCopy(action.id);
                    const selected = state.selectedActionId === action.id;
                    return (
                        <Pressable
                            key={action.id}
                            onPress={() => selectCommand(action.id)}
                            style={({ pressed }) => [
                                styles.actionCard,
                                selected && { borderColor: action.accent },
                                pressed && styles.pressed,
                            ]}
                        >
                            <View style={[styles.actionIcon, { backgroundColor: `${action.accent}18` }]}>
                                <Ionicons name={action.icon} size={19} color={action.accent} />
                            </View>
                            <View style={styles.actionCopy}>
                                <Text style={styles.actionTitle} numberOfLines={1}>{copy.title}</Text>
                                <Text style={styles.actionBody} numberOfLines={2}>{copy.body}</Text>
                            </View>
                            <Ionicons name="arrow-down-circle-outline" size={19} color={theme.colors.textSecondary} />
                        </Pressable>
                    );
                })}
            </View>

            {state.chatOpen && (
                <View style={styles.chatPanel}>
                    <View style={styles.chatPanelHeader}>
                        <Text style={styles.chatPanelTitle} numberOfLines={1}>{t('agents.scheduleChatPanelTitle')}</Text>
                        <View style={styles.chatReadyPill}>
                            <Text style={styles.chatReadyText} numberOfLines={1}>
                                {selectedAction ? t('agents.schedulePromptReady') : t('agents.schedulePromptEmpty')}
                            </Text>
                        </View>
                    </View>
                    <Text style={styles.chatPanelBody} numberOfLines={4}>
                        {selectedAction
                            ? t('agents.scheduleChatPanelReady', { action: selectedAction.title })
                            : t('agents.scheduleChatPanelEmpty')}
                    </Text>
                </View>
            )}
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    scroll: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 16,
        paddingTop: 18,
        paddingBottom: 12,
        gap: 12,
    },
    hero: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        padding: 14,
        gap: 10,
    },
    heroTop: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    agentMark: {
        width: 40,
        height: 40,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.button.primary.background,
    },
    statusWrap: {
        flexShrink: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: theme.colors.input.background,
    },
    statusDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
    },
    statusText: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        color: theme.colors.textSecondary,
        flexShrink: 1,
    },
    heroTitle: {
        ...Typography.display('semiBold'),
        fontSize: 25,
        lineHeight: 31,
        color: theme.colors.text,
        letterSpacing: 0,
    },
    heroBody: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
    warningPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: '#FEF3C7',
    },
    warningText: {
        ...Typography.default('semiBold'),
        flex: 1,
        color: '#92400E',
        fontSize: 12,
        lineHeight: 16,
    },
    segmentRow: {
        gap: 8,
        paddingRight: 8,
    },
    segment: {
        minWidth: 72,
        minHeight: 34,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 13,
        borderRadius: 999,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    segmentText: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    segmentTextSelected: {
        color: theme.colors.button.primary.tint,
    },
    focusPanel: {
        flexDirection: 'row',
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        overflow: 'hidden',
    },
    focusAccent: {
        width: 5,
    },
    focusCopy: {
        flex: 1,
        padding: 13,
        gap: 5,
    },
    focusEyebrow: {
        ...Typography.mono(),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    focusTitle: {
        ...Typography.default('semiBold'),
        fontSize: 17,
        lineHeight: 22,
        color: theme.colors.text,
    },
    focusBody: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
    },
    moduleGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 9,
    },
    moduleCard: {
        flexBasis: '47%',
        flexGrow: 1,
        minHeight: 116,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        padding: 11,
        gap: 8,
    },
    moduleIcon: {
        width: 34,
        height: 34,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
    },
    moduleTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 14,
    },
    moduleBody: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 16,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginTop: 2,
    },
    sectionTitle: {
        ...Typography.default('semiBold'),
        flex: 1,
        color: theme.colors.text,
        fontSize: 16,
    },
    chatButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 34,
        paddingHorizontal: 11,
        borderRadius: 999,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    chatButtonText: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 12,
    },
    actionList: {
        gap: 9,
    },
    actionCard: {
        minHeight: 68,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 11,
        paddingVertical: 10,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    actionIcon: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionCopy: {
        flex: 1,
        minWidth: 0,
    },
    actionTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 14,
    },
    actionBody: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 16,
        marginTop: 2,
    },
    chatPanel: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        padding: 12,
        gap: 8,
    },
    chatPanelHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    chatPanelTitle: {
        ...Typography.default('semiBold'),
        flex: 1,
        color: theme.colors.text,
        fontSize: 15,
    },
    chatReadyPill: {
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 5,
        backgroundColor: theme.colors.input.background,
    },
    chatReadyText: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 11,
    },
    chatPanelBody: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 18,
    },
    pressed: {
        opacity: 0.72,
    },
}));
