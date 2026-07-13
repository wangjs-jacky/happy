import * as React from 'react';
import { Text, View, Pressable, ScrollView, Platform, type GestureResponderEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAllMachines, useAgentSpaceSessions } from '@/sync/storage';
import { useEnterAgentSpace } from '@/hooks/useEnterAgentSpace';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { launchAgent, type AgentLauncher } from './launchAgent';
import { getAgentSubtitle } from './builtinAgents';
import { AgentSpaceHealthPanel } from './AgentSpaceHealthPanel';
import { hapticsLight } from '@/components/haptics';
import { SessionActionsPopover, type SessionActionsAnchor } from '@/components/SessionActionsPopover';

/**
 * 追加 8 位十六进制透明度得到该 accent 色的半透明版本，用于空间头/徽章底色。
 * agent.color 理论上是 `#RRGGBB`，非法格式则返回 null，由调用方回落到主题底色。
 */
function withAlpha(hex: string, alpha: string): string | null {
    return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${alpha}` : null;
}

type SpaceTab = 'workbench' | 'health';

interface Props {
    agent: AgentLauncher;
    onExit: () => void;
    /** 导航（由 SidebarView 传入：会先关抽屉再跳转，避免手机端抽屉盖在新页面上）。 */
    onNavigate: (path: string) => void;
    /** 只关闭侧栏抽屉；新会话导航始终由 useEnterAgentSpace 统一执行。 */
    onCloseDrawer: () => void;
}

/**
 * 「Agent 空间模式」左侧工作台。进入某个「我的 Agent」后取代侧栏常规内容：
 * 顶部固定空间头（退出 + 身份 + 专属空间徽章）；健康打卡类 Agent 额外出现「工作台 / 健康报告」
 * 分段——工作台 = 预设快捷指令 + 仅本空间会话 + 新建；健康报告 = 睡眠/运动/饮食面板（机器级读日报）。
 * 视觉沿用统一设计系统主题 token，只把该 Agent 的 color 作为局部 accent，不改全局主题。
 */
export const AgentSpaceWorkbench = React.memo(({ agent, onExit, onNavigate, onCloseDrawer }: Props) => {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const machines = useAllMachines({ includeOffline: true });
    const sessions = useAgentSpaceSessions(agent.machineId, agent.path);
    const { entering, enter } = useEnterAgentSpace();
    const draft = useNewSessionDraft();
    const [sessionActions, setSessionActions] = React.useState<{
        anchor: SessionActionsAnchor;
        sessionId: string;
    } | null>(null);

    // spaceType 是迁移/新建时一次性确定的稳定 provider 标识；运行时不再从可改名路径推断。
    const isHealth = agent.spaceType === 'health';
    const [tab, setTab] = React.useState<SpaceTab>(isHealth ? 'health' : 'workbench');

    const machine = React.useMemo(() => machines.find((m) => m.id === agent.machineId), [machines, agent.machineId]);
    const subtitle = getAgentSubtitle(agent, machine, t('agents.machineMissing'));
    const accent = agent.color;
    const headTint = withAlpha(accent, '14') ?? theme.colors.surface;
    const badgeTint = withAlpha(accent, '22') ?? theme.colors.surface;

    const startSession = React.useCallback((initialInput?: string) => {
        if (entering) return;
        if (agent.kind === 'image-styles') {
            launchAgent(agent, draft, onNavigate, initialInput !== undefined ? { initialInput } : undefined);
            return;
        }
        return enter(agent, {
            ...(initialInput !== undefined ? { initialDraft: initialInput } : {}),
            beforeNavigate: onCloseDrawer,
        });
    }, [agent, draft, enter, entering, onCloseDrawer, onNavigate]);

    const exitSpace = React.useCallback(() => {
        if (!entering) onExit();
    }, [entering, onExit]);

    const navigateToHistory = React.useCallback((sessionId: string) => {
        if (!entering) onNavigate(`/session/${sessionId}`);
    }, [entering, onNavigate]);

    const openSessionActions = React.useCallback((sessionId: string, event: GestureResponderEvent) => {
        if (entering || Platform.OS === 'web') return;
        hapticsLight();
        setSessionActions({
            sessionId,
            anchor: {
                type: 'point',
                x: event.nativeEvent.pageX,
                y: event.nativeEvent.pageY,
            },
        });
    }, [entering]);

    return (
        <View style={styles.root}>
            {/* 固定空间头 + 分段 */}
            <View style={styles.headWrap}>
                <View style={[styles.head, { backgroundColor: headTint }]}>
                    <Pressable
                        disabled={entering}
                        onPress={exitSpace}
                        hitSlop={8}
                        style={({ pressed }) => [styles.back, pressed && styles.pressedDim]}
                    >
                        <Ionicons name="chevron-back" size={16} color={accent} />
                        <Text style={[styles.backText, { color: accent }]}>{t('agentSpace.exit')}</Text>
                    </Pressable>
                    <View style={styles.headRow}>
                        <View style={[styles.avatar, { backgroundColor: accent }]}>
                            <Text style={styles.avatarGlyph}>{agent.glyph}</Text>
                        </View>
                        <View style={styles.headText}>
                            <Text style={styles.name} numberOfLines={1}>{agent.name}</Text>
                            <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
                        </View>
                        <View style={[styles.badge, { backgroundColor: badgeTint }]}>
                            <Text style={[styles.badgeText, { color: accent }]} numberOfLines={1}>{t('agentSpace.badge')}</Text>
                        </View>
                    </View>
                </View>

                {isHealth && (
                    <View style={styles.seg}>
                        <Pressable
                            onPress={() => setTab('workbench')}
                            style={[styles.segBtn, tab === 'workbench' && styles.segBtnOn]}
                        >
                            <Text style={[styles.segText, tab === 'workbench' && { color: accent }]}>{t('agentSpace.tabWorkbench')}</Text>
                        </Pressable>
                        <Pressable
                            onPress={() => setTab('health')}
                            style={[styles.segBtn, tab === 'health' && styles.segBtnOn]}
                        >
                            <Text style={[styles.segText, tab === 'health' && { color: accent }]}>{t('agentSpace.tabHealth')}</Text>
                        </Pressable>
                    </View>
                )}
            </View>

            {/* 主体：健康报告 or 工作台 */}
            {isHealth && tab === 'health' ? (
                <AgentSpaceHealthPanel agent={agent} onStartSession={startSession} />
            ) : (
                <ScrollView style={styles.body} contentContainerStyle={styles.workbenchContent}>
                    {/* 预设快捷指令 */}
                    {agent.presets.length > 0 && (
                        <>
                            <Text style={styles.sectionTitle}>{t('agentSpace.quickPrompts')}</Text>
                            <View style={styles.chipsWrap}>
                                {agent.presets.map((preset, index) => (
                                    <Pressable
                                        key={`${preset.label}-${index}`}
                                        disabled={entering}
                                        onPress={() => startSession(preset.prompt)}
                                        style={({ pressed }) => [styles.chip, { borderColor: accent }, pressed && styles.pressedDim]}
                                    >
                                        <Text style={[styles.chipText, { color: accent }]} numberOfLines={1}>{preset.label}</Text>
                                    </Pressable>
                                ))}
                            </View>
                        </>
                    )}

                    {/* 本空间会话 */}
                    <Text style={styles.sectionTitle}>{t('agentSpace.sessionsTitle')}</Text>
                    <View style={styles.sessionsCard}>
                        {sessions.length === 0 ? (
                            <Text style={styles.empty}>{t('agentSpace.empty')}</Text>
                        ) : (
                            sessions.map((session, index) => (
                                <Pressable
                                    key={session.id}
                                    disabled={entering}
                                    onLongPress={(event) => openSessionActions(session.id, event)}
                                    onPress={() => navigateToHistory(session.id)}
                                    style={({ pressed }) => [
                                        styles.sessionRow,
                                        index > 0 && styles.sessionRowDivider,
                                        pressed && styles.sessionRowPressed,
                                    ]}
                                >
                                    <View
                                        style={[
                                            styles.statusDot,
                                            { backgroundColor: session.active ? theme.colors.status.connected : theme.colors.status.disconnected },
                                        ]}
                                    />
                                    <View style={styles.sessionText}>
                                        <Text style={styles.sessionName} numberOfLines={1}>{session.name}</Text>
                                        {!!session.subtitle && (
                                            <Text style={styles.sessionSubtitle} numberOfLines={1}>{session.subtitle}</Text>
                                        )}
                                    </View>
                                    <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                                </Pressable>
                            ))
                        )}
                    </View>
                    {sessionActions && (
                        <SessionActionsPopover
                            anchor={sessionActions.anchor}
                            onClose={() => setSessionActions(null)}
                            sessionId={sessionActions.sessionId}
                            visible
                        />
                    )}

                    {/* 在此空间新建会话 */}
                    <Pressable
                        disabled={entering}
                        onPress={() => startSession()}
                        style={({ pressed }) => [styles.newBtn, { backgroundColor: accent }, pressed && styles.pressedDim]}
                    >
                        <Ionicons name="add" size={18} color="#FFFFFF" />
                        <Text style={styles.newBtnText}>
                            {entering ? t('agentSpace.entering') : t('agentSpace.newSession')}
                        </Text>
                    </Pressable>
                </ScrollView>
            )}
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
    },
    headWrap: {
        paddingHorizontal: 16,
        paddingTop: 2,
    },
    head: {
        borderRadius: 18,
        padding: 14,
        marginBottom: 6,
    },
    back: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 2,
        marginBottom: 10,
    },
    backText: {
        fontSize: 14,
        ...Typography.default('semiBold'),
    },
    headRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    avatar: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarGlyph: {
        color: '#FFFFFF',
        fontSize: 22,
        ...Typography.default('semiBold'),
    },
    headText: {
        flex: 1,
    },
    name: {
        fontSize: 18,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    subtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginTop: 2,
        ...Typography.default(),
    },
    badge: {
        paddingVertical: 4,
        paddingHorizontal: 9,
        borderRadius: 999,
    },
    badgeText: {
        fontSize: 11,
        ...Typography.default('semiBold'),
    },
    seg: {
        flexDirection: 'row',
        backgroundColor: theme.colors.surfacePressed,
        borderRadius: 12,
        padding: 4,
        gap: 4,
        marginBottom: 6,
    },
    segBtn: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 8,
        borderRadius: 9,
    },
    segBtnOn: {
        backgroundColor: theme.colors.surface,
    },
    segText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    body: {
        flex: 1,
    },
    workbenchContent: {
        paddingHorizontal: 16,
        paddingBottom: 24,
        gap: 4,
    },
    sectionTitle: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 12,
        marginBottom: 6,
        marginHorizontal: 4,
        ...Typography.default('semiBold'),
    },
    chipsWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginHorizontal: 2,
    },
    chip: {
        borderWidth: 1.5,
        borderRadius: 999,
        paddingVertical: 7,
        paddingHorizontal: 13,
        backgroundColor: theme.colors.surface,
        maxWidth: '100%',
    },
    chipText: {
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    sessionsCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        paddingHorizontal: 12,
        overflow: 'hidden',
    },
    empty: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        paddingVertical: 18,
        ...Typography.default(),
    },
    sessionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        gap: 12,
    },
    sessionRowDivider: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    sessionRowPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    sessionText: {
        flex: 1,
    },
    sessionName: {
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    sessionSubtitle: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
        ...Typography.default(),
    },
    newBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginTop: 12,
        paddingVertical: 13,
        borderRadius: 14,
    },
    newBtnText: {
        color: '#FFFFFF',
        fontSize: 15,
        ...Typography.default('semiBold'),
    },
    pressedDim: {
        opacity: 0.6,
    },
}));
