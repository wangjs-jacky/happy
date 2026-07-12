import * as React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

/**
 * 休眠空态卡：当某个健康域今天尚无记录时展示的静态占位视觉。
 * 月亮图标 + 标题 + 引导文字，纯静态、无交互、无副作用。
 */
export const HealthDormantState = React.memo(function HealthDormantState() {
    const { theme } = useUnistyles();
    return (
        <View style={styles.container}>
            <Ionicons name="moon-outline" size={40} color={theme.colors.textSecondary} />
            <Text style={styles.title}>{t('healthPanel.dormantTitle')}</Text>
            <Text style={styles.hint}>{t('healthPanel.dormantHint')}</Text>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 28,
        gap: 8,
    },
    title: {
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.text,
    },
    hint: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
}));
