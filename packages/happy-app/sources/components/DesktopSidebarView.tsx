import * as React from 'react';
import { Pressable, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { getDisplayName } from '@/sync/profile';
import { useFriendRequests, useProfile, useRealtimeStatus } from '@/sync/storage';
import { t } from '@/text';
import { useAgentSpace } from '@/hooks/useAgentSpace';
import { useCommandPaletteLauncher } from './CommandPalette/CommandPaletteProvider';
import { useDesktopSettingsModal } from './DesktopSettingsModal';
import { DesktopSidebarIconRail } from './DesktopSidebarIconRail';
import { DesktopSidebarSessionsNavigation } from './DesktopSidebarSessionsNavigation';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { AgentSheet } from './agents/AgentSheet';
import { AgentSpaceWorkbench } from './agents/AgentSpaceWorkbench';
import { PluginLeftSidebarSlot } from './plugins/PluginLeftSidebarSlot';
import { PluginMarketplaceModal } from './plugins/PluginMarketplaceModal';

type FooterMenu = 'account' | 'help' | null;

/**
 * PC Web/Tauri-only sidebar architecture.
 *
 * Keep this component separate from SidebarView's legacy mobile implementation:
 * the desktop three-level navigation owns its icon rail, organization pane and
 * session pane without changing Android/iOS drawer structure or navigation state.
 */
export const DesktopSidebarView = React.memo(function DesktopSidebarView() {
    const router = useRouter();
    const pathname = usePathname();
    const safeArea = useSafeAreaInsets();
    const realtimeStatus = useRealtimeStatus();
    const friendRequests = useFriendRequests();
    const profile = useProfile();
    const { agent: spaceAgent, exit: exitSpace } = useAgentSpace();
    const commandPaletteLauncher = useCommandPaletteLauncher();
    const { openSettings } = useDesktopSettingsModal();
    const [sheetOpen, setSheetOpen] = React.useState(false);
    const [pluginMarketplaceOpen, setPluginMarketplaceOpen] = React.useState(false);
    const [footerMenu, setFooterMenu] = React.useState<FooterMenu>(null);
    const displayName = getDisplayName(profile) ?? t('settings.title');

    const go = React.useCallback((path: string) => {
        router.navigate(path as never);
    }, [router]);

    const openSessionSearch = React.useCallback(() => {
        if (commandPaletteLauncher?.isAvailable) {
            commandPaletteLauncher.open();
            return;
        }
        go('/session/search');
    }, [commandPaletteLauncher, go]);

    const openPluginMarketplace = React.useCallback(() => {
        setSheetOpen(false);
        setPluginMarketplaceOpen(true);
    }, []);

    if (spaceAgent) {
        return (
            <View style={[styles.container, { paddingTop: safeArea.top + 4 }]} testID="desktop-agent-space-sidebar">
                <AgentSpaceWorkbench
                    agent={spaceAgent}
                    onCloseDrawer={() => undefined}
                    onExit={() => {
                        exitSpace();
                        go('/');
                    }}
                    onNavigate={go}
                />
            </View>
        );
    }

    return (
        <View style={styles.container} testID="sidebar-desktop-density">
            {footerMenu !== null ? (
                <Pressable
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    onPress={() => setFooterMenu(null)}
                    style={styles.dismissLayer}
                    testID="sidebar-footer-menu-dismiss-layer"
                />
            ) : null}

            <DesktopSidebarIconRail
                displayName={displayName}
                footerMenu={footerMenu}
                onFooterMenuChange={setFooterMenu}
                onNavigate={go}
                onOpenAgents={() => setSheetOpen(true)}
                onOpenPluginMarketplace={openPluginMarketplace}
                onOpenSessionSearch={openSessionSearch}
                onOpenSettings={openSettings}
                profile={profile}
                unreadCount={friendRequests.length}
            />

            <View style={[styles.library, { paddingTop: safeArea.top + 4 }]} testID="desktop-sidebar-library">
                {realtimeStatus !== 'disconnected' ? <VoiceAssistantStatusBar variant="sidebar" /> : null}
                {pathname === '/relationship-advisor' ? (
                    <PluginLeftSidebarSlot desktopDensity fill onNavigate={go} />
                ) : (
                    <DesktopSidebarSessionsNavigation desktopDensity />
                )}
            </View>

            <AgentSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
            <PluginMarketplaceModal
                initialPluginId={null}
                onClose={() => setPluginMarketplaceOpen(false)}
                visible={pluginMarketplaceOpen}
            />
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.groupped.background,
        borderColor: theme.colors.divider,
        borderStyle: 'solid',
        borderWidth: 0,
        flex: 1,
        flexDirection: 'row',
    },
    library: {
        flex: 1,
        minWidth: 0,
    },
    dismissLayer: {
        bottom: 0,
        left: 0,
        position: 'absolute',
        right: 0,
        top: 0,
        zIndex: 10,
    },
}));
