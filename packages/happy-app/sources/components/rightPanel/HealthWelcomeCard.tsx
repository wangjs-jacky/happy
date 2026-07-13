import * as React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

/**
 * 健康欢迎内容体（无外层 flex）：图标 + 角色 + 引导 + 睡眠/运动/饮食三域 + hint。
 * 供两处复用：会话内空态卡（HealthWelcomeCard，居中全屏）与落地页引导（AgentLandingIntro，顶部对齐）。
 */
export const HealthWelcomeContent = React.memo(function HealthWelcomeContent() {
    const { theme } = useUnistyles();
    return (
        <View style={styles.content}>
            <Ionicons name="heart-circle-outline" size={64} color={theme.colors.text} />
            <Text style={styles.role}>{t('healthPanel.welcomeRole')}</Text>
            <Text style={styles.subtitle}>{t('healthPanel.welcomeSubtitle')}</Text>
            <View style={styles.domains}>
                <View style={styles.domain}>
                    <Ionicons name="moon-outline" size={24} color={theme.colors.textSecondary} />
                    <Text style={styles.domainLabel}>{t('healthPanel.welcomeSleep')}</Text>
                </View>
                <View style={styles.domain}>
                    <Ionicons name="barbell-outline" size={24} color={theme.colors.textSecondary} />
                    <Text style={styles.domainLabel}>{t('healthPanel.welcomeExercise')}</Text>
                </View>
                <View style={styles.domain}>
                    <Ionicons name="restaurant-outline" size={24} color={theme.colors.textSecondary} />
                    <Text style={styles.domainLabel}>{t('healthPanel.welcomeDiet')}</Text>
                </View>
            </View>
            <Text style={styles.hint}>{t('healthPanel.welcomeHint')}</Text>
        </View>
    );
});

/**
 * 空健康会话欢迎卡：内容居中撑满。纯静态展示，无交互无副作用。
 */
export const HealthWelcomeCard = React.memo(function HealthWelcomeCard() {
    return (
        <View style={styles.container}>
            <HealthWelcomeContent />
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        alignItems: 'center',
        paddingHorizontal: 24,
        gap: 12,
    },
    role: {
        fontSize: 20,
        fontWeight: '700',
        color: theme.colors.text,
    },
    subtitle: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
    domains: {
        flexDirection: 'row',
        gap: 20,
        marginTop: 8,
    },
    domain: {
        alignItems: 'center',
        gap: 6,
    },
    domainLabel: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    hint: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginTop: 8,
        lineHeight: 20,
    },
}));
