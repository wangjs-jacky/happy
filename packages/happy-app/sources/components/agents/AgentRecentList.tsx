import * as React from 'react';
import { View, Text, Pressable } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { useAllSessions, useAllMachines } from '@/sync/storage';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { getSessionName, formatLastSeen } from '@/utils/sessionUtils';
import { recentSessionsForAgent } from './recentSessionsForAgent';
import type { AgentLauncher } from './launchAgent';

/**
 * 落地页「最近」区：列出该 Agent（machineId+path 匹配）最近 5 次会话，点击秒回带历史。
 * 无匹配会话时整块不渲染（return null），让引导区的 hint 承担引导。
 */
export const AgentRecentList = React.memo(function AgentRecentList({ agent }: { agent: AgentLauncher }) {
    const sessions = useAllSessions();
    const machines = useAllMachines({ includeOffline: true });
    const navigateToSession = useNavigateToSession();
    const recent = React.useMemo(
        () => recentSessionsForAgent({ agent, sessions, machines }),
        [agent, sessions, machines],
    );

    if (recent.length === 0) return null;

    return (
        <View style={styles.container}>
            <Text style={styles.title}>{t('agents.recentTitle')}</Text>
            {recent.map((session) => (
                <Pressable
                    key={session.id}
                    onPress={() => navigateToSession(session.id)}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                    <View style={styles.rowText}>
                        <Text style={styles.rowName} numberOfLines={1}>{getSessionName(session)}</Text>
                        <Text style={styles.rowTime} numberOfLines={1}>{formatLastSeen(session.updatedAt)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={styles.chevron.color} />
                </Pressable>
            ))}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        marginTop: 24,
        paddingHorizontal: 16,
        gap: 6,
    },
    title: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginBottom: 2,
        ...Typography.default('semiBold'),
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        gap: 8,
    },
    rowPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    rowText: {
        flex: 1,
    },
    rowName: {
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default(),
    },
    rowTime: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
        ...Typography.default(),
    },
    chevron: {
        color: theme.colors.textSecondary,
    },
}));
