import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import type { Session } from '@/sync/storageTypes';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

interface EmptyMessagesProps {
    session: Session;
}

/** Shared by empty conversations; task-specific introductions keep their own content. */
export function EmptyMessages({ session }: EmptyMessagesProps) {
    const { theme } = useUnistyles();
    const path = session.metadata?.path
        ? formatPathRelativeToHome(session.metadata.path, session.metadata.homeDir)
        : null;
    const host = session.metadata?.host;

    return (
        <View style={styles.container} testID="session-empty-state">
            <View style={styles.content}>
                <View style={styles.icon}>
                    <Ionicons name="chatbubble-ellipses-outline" size={25} color={theme.colors.textLink} />
                </View>
                <Text accessibilityRole="header" style={styles.title}>
                    {t('session.emptyTitle')}
                </Text>
                <Text style={styles.hint}>{t('session.emptyHint')}</Text>

                {(path || host) && (
                    <View style={styles.context}>
                        {path && (
                            <View style={styles.contextRow}>
                                <Ionicons name="folder-outline" size={15} color={theme.colors.textSecondary} />
                                <Text
                                    selectable
                                    numberOfLines={1}
                                    ellipsizeMode="middle"
                                    accessibilityLabel={path}
                                    style={styles.path}
                                >
                                    {path}
                                </Text>
                            </View>
                        )}
                        {host && (
                            <View style={styles.contextRow}>
                                <Ionicons name="terminal-outline" size={13} color={theme.colors.textSecondary} />
                                <Text selectable numberOfLines={1} style={styles.host}>{host}</Text>
                            </View>
                        )}
                    </View>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        width: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 28,
        paddingVertical: 24,
    },
    content: {
        width: '100%',
        maxWidth: 440,
        alignItems: 'flex-start',
    },
    icon: {
        width: 52,
        height: 52,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceSelected,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        marginBottom: 22,
    },
    title: {
        fontSize: 28,
        lineHeight: 38,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    hint: {
        marginTop: 10,
        fontSize: 14,
        lineHeight: 23,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    context: {
        width: '100%',
        marginTop: 28,
        paddingTop: 16,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        gap: 9,
    },
    contextRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
    },
    path: {
        flex: 1,
        minWidth: 0,
        fontSize: 12,
        lineHeight: 18,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    host: {
        flex: 1,
        minWidth: 0,
        fontSize: 11,
        lineHeight: 17,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));
