import * as React from 'react';
import { Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useNavigation } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { useHeaderHeight } from '@/utils/responsive';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { useRealtimeStatus, useFriendRequests } from '@/sync/storage';
import { MainView } from './MainView';
import { StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        borderStyle: 'solid',
        backgroundColor: theme.colors.groupped.background,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    messagesRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 2,
        paddingVertical: 11,
        paddingHorizontal: 14,
        borderRadius: 10,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        gap: 10,
    },
    messagesText: {
        flex: 1,
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    badge: {
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        paddingHorizontal: 5,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.status.error,
    },
    badgeText: {
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '700',
        ...Typography.default('semiBold'),
    },
    newSessionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 4,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        gap: 8,
    },
    newSessionButtonPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    newSessionText: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    settingsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        gap: 10,
    },
    settingsText: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
        ...Typography.default(),
    },
}));

export const SidebarView = React.memo(() => {
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const router = useRouter();
    const navigation = useNavigation();
    const headerHeight = useHeaderHeight();
    const realtimeStatus = useRealtimeStatus();
    const friendRequests = useFriendRequests();

    // Navigate, closing the drawer first. On phone the drawer is a `front` overlay
    // that would otherwise stay open on top of the pushed screen; on desktop the
    // drawer is permanent so closeDrawer is a harmless no-op.
    const go = React.useCallback((path: string) => {
        navigation.dispatch(DrawerActions.closeDrawer());
        router.navigate(path as any);
    }, [navigation, router]);

    return (
        <View style={[styles.container, { paddingTop: safeArea.top + headerHeight }]}>
            {/* Messages / friends (formerly the Inbox tab) */}
            <Pressable onPress={() => go('/inbox')} style={styles.messagesRow}>
                <Ionicons name="chatbubble-ellipses-outline" size={17} color={stylesheet.messagesText.color} />
                <Text style={styles.messagesText}>{t('tabs.inbox')}</Text>
                {friendRequests.length > 0 && (
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>{friendRequests.length}</Text>
                    </View>
                )}
            </Pressable>

            {/* New Session button */}
            <Pressable
                onPress={() => go('/new')}
                style={({ pressed }) => [
                    styles.newSessionButton,
                    pressed && styles.newSessionButtonPressed,
                ]}
            >
                <Ionicons name="create-outline" size={16} color={stylesheet.newSessionText.color} />
                <Text style={styles.newSessionText}>{t('sidebar.newSession')}</Text>
            </Pressable>

            {realtimeStatus !== 'disconnected' && (
                <VoiceAssistantStatusBar variant="sidebar" />
            )}

            {/* Sessions list */}
            <MainView variant="sidebar" />

            {/* Settings at bottom */}
            <Pressable
                onPress={() => go('/settings')}
                style={styles.settingsRow}
            >
                <Ionicons name="settings-outline" size={18} color={stylesheet.settingsText.color} />
                <Text style={styles.settingsText}>{t('settings.title')}</Text>
            </Pressable>
        </View>
    );
});
