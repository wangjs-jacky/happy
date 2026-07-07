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
    getScheduleAgentWorkspaceLanes,
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

function primaryActionForModule(id: ScheduleAgentModuleId): ScheduleAgentActionId {
    switch (id) {
        case 'task-pool':
            return 'review-pool';
        case 'review':
            return 'weekly-reset';
        case 'today':
        case 'calendar':
            return 'plan-today';
    }
}

export const ScheduleAgentDashboard = React.memo(function ScheduleAgentDashboard({
    online,
    canSubmit,
    onInsertPrompt,
}: ScheduleAgentDashboardProps) {
    const { theme } = useUnistyles();
    const [state, setState] = React.useState(createScheduleAgentPanelState);
    const lanes = getScheduleAgentWorkspaceLanes(state);
    const contextLane = lanes.find((lane) => lane.kind === 'modules');
    const executeLane = lanes.find((lane) => lane.kind === 'actions');
    const moduleIds = contextLane?.itemIds ?? [];
    const actionIds = executeLane?.itemIds ?? [];
    const activeModule = SCHEDULE_AGENT_MODULES.find((item) => item.id === state.focusedModuleId) ?? SCHEDULE_AGENT_MODULES[0];
    const activeModuleCopy = moduleCopy(activeModule.id);
    const primaryActionId = primaryActionForModule(activeModule.id);
    const primaryAction = SCHEDULE_AGENT_ACTIONS.find((item) => item.id === primaryActionId) ?? SCHEDULE_AGENT_ACTIONS[0];
    const primaryActionCopy = actionCopy(primaryAction.id);
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

    const closeChat = React.useCallback(() => {
        hapticsLight();
        setState((current) => reduceScheduleAgentPanelState(current, { type: 'close-chat' }));
    }, []);

    return (
        <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
        >
            <View style={styles.agentHeader}>
                <View style={styles.headerMark}>
                    <Ionicons name="calendar-clear-outline" size={20} color={theme.colors.button.primary.tint} />
                </View>
                <View style={styles.agentHeaderCopy}>
                    <View style={styles.titleRow}>
                        <Text style={styles.agentTitle} numberOfLines={1}>
                            {t('agents.scheduleDashboardTitle')}
                        </Text>
                        <View style={[styles.liveDot, { backgroundColor: online ? theme.colors.status.connected : theme.colors.status.disconnected }]} />
                    </View>
                    <Text style={styles.agentBody} numberOfLines={2}>
                        {t('agents.scheduleDashboardBody')}
                    </Text>
                </View>
                <Pressable
                    onPress={state.chatOpen ? closeChat : openChat}
                    style={({ pressed }) => [styles.headerChatButton, pressed && styles.pressed]}
                >
                    <Ionicons
                        name={state.chatOpen ? 'chevron-down-outline' : 'chatbubble-ellipses-outline'}
                        size={18}
                        color={theme.colors.text}
                    />
                </Pressable>
            </View>

            {!canSubmit && (
                <View style={styles.warningBanner}>
                    <Ionicons name="alert-circle-outline" size={16} color="#B45309" />
                    <Text style={styles.warningText} numberOfLines={2}>
                        {t('agents.scheduleOfflineHint')}
                    </Text>
                </View>
            )}

            <View style={styles.workspace}>
                <View style={styles.contextRail}>
                    <Text style={styles.railTitle} numberOfLines={1}>
                        {t('agents.scheduleContextRailTitle')}
                    </Text>
                    <View style={styles.contextStack}>
                        {moduleIds.map((moduleId) => {
                            const module = SCHEDULE_AGENT_MODULES.find((item) => item.id === moduleId);
                            if (!module) {
                                return null;
                            }

                            const copy = moduleCopy(module.id);
                            const selected = state.focusedModuleId === module.id;
                            return (
                                <Pressable
                                    key={module.id}
                                    onPress={() => focusModule(module.id)}
                                    style={({ pressed }) => [
                                        styles.contextNode,
                                        selected && { backgroundColor: `${module.accent}16`, borderColor: module.accent },
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <View style={[styles.contextIcon, { backgroundColor: `${module.accent}18` }]}>
                                        <Ionicons name={module.icon} size={16} color={module.accent} />
                                    </View>
                                    <Text style={[styles.contextLabel, selected && { color: module.accent }]} numberOfLines={1}>
                                        {copy.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>

                <View style={styles.planCanvas}>
                    <View style={styles.planTopRow}>
                        <Text style={styles.planKicker} numberOfLines={1}>
                            {t('agents.schedulePlanLaneTitle')}
                        </Text>
                        <View style={styles.protocolPill}>
                            <Text style={styles.protocolPillText} numberOfLines={1}>
                                {t('agents.schedulePlanProtocolTitle')}
                            </Text>
                        </View>
                    </View>
                    <Text style={styles.planTitle} numberOfLines={2}>
                        {activeModuleCopy.title}
                    </Text>
                    <Text style={styles.planMetric} numberOfLines={1}>
                        {activeModuleCopy.metric}
                    </Text>
                    <Text style={styles.planBody} numberOfLines={4}>
                        {activeModuleCopy.body}
                    </Text>

                    <View style={styles.protocolStack}>
                        <View style={styles.protocolStep}>
                            <Ionicons name="search-outline" size={15} color={theme.colors.textSecondary} />
                            <Text style={styles.protocolText} numberOfLines={1}>{t('agents.scheduleProtocolReadFirst')}</Text>
                        </View>
                        <View style={styles.protocolStep}>
                            <Ionicons name="git-compare-outline" size={15} color={theme.colors.textSecondary} />
                            <Text style={styles.protocolText} numberOfLines={1}>{t('agents.scheduleProtocolJudge')}</Text>
                        </View>
                        <View style={styles.protocolStep}>
                            <Ionicons name="lock-closed-outline" size={15} color={theme.colors.textSecondary} />
                            <Text style={styles.protocolText} numberOfLines={1}>{t('agents.scheduleProtocolConfirmFirst')}</Text>
                        </View>
                    </View>

                    <Pressable
                        onPress={() => selectCommand(primaryAction.id)}
                        style={({ pressed }) => [styles.primaryCommand, pressed && styles.pressed]}
                    >
                        <View style={styles.primaryCommandIcon}>
                            <Ionicons name={primaryAction.icon} size={18} color={theme.colors.button.primary.tint} />
                        </View>
                        <View style={styles.primaryCommandCopy}>
                            <Text style={styles.primaryCommandTitle} numberOfLines={1}>{primaryActionCopy.title}</Text>
                            <Text style={styles.primaryCommandBody} numberOfLines={1}>{t('agents.scheduleRunInChat')}</Text>
                        </View>
                        <Ionicons name="arrow-down-outline" size={17} color={theme.colors.button.primary.tint} />
                    </Pressable>
                </View>

                <View style={styles.executionRail}>
                    <Text style={styles.railTitle} numberOfLines={1}>
                        {t('agents.scheduleExecutionRailTitle')}
                    </Text>
                    <View style={styles.executionStack}>
                        {actionIds.map((actionId) => {
                            const action = SCHEDULE_AGENT_ACTIONS.find((item) => item.id === actionId);
                            if (!action) {
                                return null;
                            }

                            const copy = actionCopy(action.id);
                            const selected = state.selectedActionId === action.id;
                            return (
                                <Pressable
                                    key={action.id}
                                    onPress={() => selectCommand(action.id)}
                                    style={({ pressed }) => [
                                        styles.executionNode,
                                        selected && { backgroundColor: `${action.accent}16`, borderColor: action.accent },
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <Ionicons name={action.icon} size={18} color={action.accent} />
                                    <Text style={[styles.executionLabel, selected && { color: action.accent }]} numberOfLines={2}>
                                        {copy.title}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>
            </View>

            <View style={styles.chatPanel}>
                <View style={styles.chatPanelHeader}>
                    <Text style={styles.chatPanelTitle} numberOfLines={1}>{t('agents.scheduleChatPanelTitle')}</Text>
                    <View style={styles.chatPanelActions}>
                        <View style={styles.chatReadyPill}>
                            <Text style={styles.chatReadyText} numberOfLines={1}>
                                {selectedAction ? t('agents.schedulePromptReady') : t('agents.schedulePromptEmpty')}
                            </Text>
                        </View>
                        <Pressable
                            onPress={state.chatOpen ? closeChat : openChat}
                            style={({ pressed }) => [styles.chatToggle, pressed && styles.pressed]}
                        >
                            <Ionicons
                                name={state.chatOpen ? 'chevron-up-outline' : 'chevron-down-outline'}
                                size={16}
                                color={theme.colors.text}
                            />
                        </Pressable>
                    </View>
                </View>
                <Text style={styles.chatPanelBody} numberOfLines={state.chatOpen ? 4 : 2}>
                    {state.chatOpen
                        ? selectedAction
                            ? t('agents.scheduleChatPanelReady', { action: selectedAction.title })
                            : t('agents.scheduleChatPanelEmpty')
                        : t('agents.scheduleChatCollapsed')}
                </Text>
            </View>
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    scroll: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 14,
        gap: 10,
    },
    agentHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    headerMark: {
        width: 36,
        height: 36,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.button.primary.background,
    },
    agentHeaderCopy: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
    },
    liveDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
    },
    agentTitle: {
        ...Typography.default('semiBold'),
        flexShrink: 1,
        color: theme.colors.text,
        fontSize: 18,
        lineHeight: 23,
    },
    agentBody: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 17,
    },
    headerChatButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    warningBanner: {
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 10,
        paddingHorizontal: 11,
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
    workspace: {
        minHeight: 336,
        flexDirection: 'row',
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        overflow: 'hidden',
    },
    contextRail: {
        width: 78,
        paddingHorizontal: 7,
        paddingVertical: 10,
        gap: 9,
        backgroundColor: theme.colors.input.background,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: theme.colors.divider,
    },
    executionRail: {
        width: 78,
        paddingHorizontal: 7,
        paddingVertical: 10,
        gap: 9,
        backgroundColor: theme.colors.input.background,
        borderLeftWidth: StyleSheet.hairlineWidth,
        borderLeftColor: theme.colors.divider,
    },
    railTitle: {
        ...Typography.mono(),
        fontSize: 10,
        lineHeight: 13,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
    contextStack: {
        gap: 8,
    },
    contextNode: {
        minHeight: 58,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'transparent',
        paddingHorizontal: 4,
    },
    contextIcon: {
        width: 28,
        height: 28,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    contextLabel: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 11,
        lineHeight: 14,
        textAlign: 'center',
    },
    planCanvas: {
        flex: 1,
        minWidth: 0,
        paddingHorizontal: 12,
        paddingVertical: 12,
        gap: 8,
    },
    planTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    planKicker: {
        ...Typography.mono(),
        color: theme.colors.textSecondary,
        fontSize: 11,
        lineHeight: 14,
    },
    protocolPill: {
        maxWidth: 86,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: theme.colors.input.background,
    },
    protocolPillText: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 10,
        lineHeight: 12,
    },
    planTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 19,
        lineHeight: 24,
    },
    planMetric: {
        ...Typography.mono(),
        color: theme.colors.textSecondary,
        fontSize: 11,
        lineHeight: 14,
    },
    planBody: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 18,
    },
    protocolStack: {
        marginTop: 2,
        gap: 9,
    },
    protocolStep: {
        minHeight: 24,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    protocolText: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 16,
        flex: 1,
    },
    primaryCommand: {
        marginTop: 'auto',
        minHeight: 54,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 11,
        paddingHorizontal: 10,
        paddingVertical: 9,
        backgroundColor: theme.colors.button.primary.background,
    },
    primaryCommandIcon: {
        width: 30,
        height: 30,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.14)',
    },
    primaryCommandCopy: {
        flex: 1,
        minWidth: 0,
    },
    primaryCommandTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.button.primary.tint,
        fontSize: 13,
        lineHeight: 17,
    },
    primaryCommandBody: {
        ...Typography.default(),
        color: theme.colors.button.primary.tint,
        opacity: 0.74,
        fontSize: 11,
        lineHeight: 14,
    },
    executionStack: {
        gap: 8,
    },
    executionNode: {
        minHeight: 58,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'transparent',
        paddingHorizontal: 4,
    },
    executionLabel: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 10,
        lineHeight: 13,
        textAlign: 'center',
    },
    chatPanel: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        paddingHorizontal: 12,
        paddingVertical: 11,
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
    chatPanelActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
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
    chatToggle: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.input.background,
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
