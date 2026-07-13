import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { HealthWelcomeContent } from '@/components/rightPanel/HealthWelcomeCard';
import { resolveAgentIntroKind } from './agentIntro';
import type { AgentLauncher } from './launchAgent';

/**
 * 落地页引导区：健康 Agent 复用 HealthWelcomeContent 富引导；其它 Agent 极简派生
 * （glyph+color 方块头像 + 名字 + 一行路径）。纯静态展示。
 */
export const AgentLandingIntro = React.memo(function AgentLandingIntro({ agent }: { agent: AgentLauncher }) {
    if (resolveAgentIntroKind(agent) === 'health') {
        return (
            <View style={styles.healthWrap}>
                <HealthWelcomeContent />
            </View>
        );
    }
    return (
        <View style={styles.genericWrap}>
            <View style={[styles.avatar, { backgroundColor: agent.color }]}>
                <Text style={styles.avatarGlyph}>{agent.glyph}</Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>{agent.name}</Text>
            <Text style={styles.path} numberOfLines={1}>{agent.path}</Text>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    healthWrap: {
        alignItems: 'center',
        paddingTop: 24,
    },
    genericWrap: {
        alignItems: 'center',
        paddingTop: 24,
        gap: 8,
    },
    avatar: {
        width: 56,
        height: 56,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarGlyph: {
        color: '#FFFFFF',
        fontSize: 24,
        ...Typography.default('semiBold'),
    },
    name: {
        fontSize: 18,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    path: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.mono(),
    },
}));
