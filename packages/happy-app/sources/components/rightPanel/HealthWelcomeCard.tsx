import * as React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

/**
 * 空健康会话欢迎卡：展示 Agent 角色、三大领域图标（睡眠/运动/饮食）和引导提示。
 * 纯静态展示组件，无交互，无副作用。
 */
export const HealthWelcomeCard = React.memo(function HealthWelcomeCard() {
    const { theme } = useUnistyles();
    return (
        <View style={styles.container}>
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

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
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
