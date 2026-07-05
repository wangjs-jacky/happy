import * as React from 'react';
import { Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useNavigation } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { useRealtimeStatus, useFriendRequests, useProfile, useSetting } from '@/sync/storage';
import { getDisplayName } from '@/sync/profile';
import { MainView } from './MainView';
import { ProfileAvatarControl } from './ProfileAvatarControl';
import { StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { useDrawerHaptics } from './useDrawerHaptics';
import { AgentSheet } from './agents/AgentSheet';

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
    userCard: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 6,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        gap: 12,
    },
    userCardPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    userInfoButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 40,
    },
    userInfoButtonPressed: {
        opacity: 0.7,
    },
    userName: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    agentsCard: {
        marginHorizontal: 16,
        marginTop: 4,
        marginBottom: 6,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        gap: 8,
    },
    agentsCardPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    agentsHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    agentsTitle: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    agentsAdd: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 2,
        paddingHorizontal: 6,
        borderRadius: 8,
        gap: 2,
    },
    agentsAddPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    agentsAddText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    agentsAvatars: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    agentMiniAvatar: {
        width: 28,
        height: 28,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    agentMiniGlyph: {
        color: '#FFFFFF',
        fontSize: 14,
        ...Typography.default('semiBold'),
    },
    agentsEmpty: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));

export const SidebarView = React.memo(() => {
    useDrawerHaptics();
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const router = useRouter();
    const navigation = useNavigation();
    const realtimeStatus = useRealtimeStatus();
    const friendRequests = useFriendRequests();
    const profile = useProfile();
    const agents = useSetting('agents');
    const [sheetOpen, setSheetOpen] = React.useState(false);
    const displayName = getDisplayName(profile) ?? t('settings.title');

    // Navigate, closing the drawer first. On phone the drawer is a `front` overlay
    // that would otherwise stay open on top of the pushed screen; on desktop the
    // drawer is permanent so closeDrawer is a harmless no-op.
    const go = React.useCallback((path: string) => {
        navigation.dispatch(DrawerActions.closeDrawer());
        router.navigate(path as any);
    }, [navigation, router]);

    return (
        <View style={[styles.container, { paddingTop: safeArea.top + 12 }]}>
            {/* User card — avatar opens the photo, camera changes it, the rest opens settings. */}
            <View style={styles.userCard}>
                <ProfileAvatarControl profile={profile} size={40} />
                <Pressable
                    onPress={() => go('/settings')}
                    style={({ pressed }) => [
                        styles.userInfoButton,
                        pressed && styles.userInfoButtonPressed,
                    ]}
                >
                    <Text style={styles.userName} numberOfLines={1}>{displayName}</Text>
                    <Ionicons name="settings-outline" size={18} color={stylesheet.userName.color} />
                </Pressable>
            </View>

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

            {/* My Agents card — tap body to open the AgentSheet (or jump to config when empty) */}
            <Pressable
                onPress={() => (agents.length > 0 ? setSheetOpen(true) : go('/settings/my-agents'))}
                style={({ pressed }) => [
                    styles.agentsCard,
                    pressed && styles.agentsCardPressed,
                ]}
            >
                <View style={styles.agentsHeader}>
                    <Text style={styles.agentsTitle} numberOfLines={1}>{t('agents.cardTitle')}</Text>
                    <Pressable
                        onPress={(e) => { e.stopPropagation(); go('/settings/my-agents'); }}
                        hitSlop={8}
                        style={({ pressed }) => [styles.agentsAdd, pressed && styles.agentsAddPressed]}
                    >
                        <Ionicons name="add" size={14} color={stylesheet.agentsAddText.color} />
                        <Text style={styles.agentsAddText}>{t('agents.add')}</Text>
                    </Pressable>
                </View>
                {agents.length > 0 ? (
                    <View style={styles.agentsAvatars}>
                        {agents.slice(0, 5).map((agent) => (
                            <View key={agent.id} style={[styles.agentMiniAvatar, { backgroundColor: agent.color }]}>
                                <Text style={styles.agentMiniGlyph}>{agent.glyph}</Text>
                            </View>
                        ))}
                    </View>
                ) : (
                    <Text style={styles.agentsEmpty} numberOfLines={1}>{t('agents.empty')}</Text>
                )}
            </Pressable>

            {/* Search history sessions */}
            <Pressable
                onPress={() => go('/session/search')}
                style={({ pressed }) => [
                    styles.newSessionButton,
                    pressed && styles.newSessionButtonPressed,
                ]}
            >
                <Ionicons name="search-outline" size={16} color={stylesheet.newSessionText.color} />
                <Text style={styles.newSessionText}>{t('sidebar.searchSessions')}</Text>
            </Pressable>

            {realtimeStatus !== 'disconnected' && (
                <VoiceAssistantStatusBar variant="sidebar" />
            )}

            {/* Sessions list */}
            <MainView variant="sidebar" />

            {/* Bottom drawer listing the user's agents (RN Modal — placement in tree is irrelevant) */}
            <AgentSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
        </View>
    );
});
