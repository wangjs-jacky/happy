import React, { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Modal } from '@/modal';
import { CommandPalette } from './CommandPalette';
import { Command } from './types';
import { useGlobalKeyboard } from '@/hooks/useGlobalKeyboard';
import { useAuth } from '@/auth/AuthContext';
import { storage } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { t } from '@/text';

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const { logout } = useAuth();
    const sessions = storage(useShallow((state) => state.sessions));
    const commandPaletteEnabled = storage(useShallow((state) => state.localSettings.commandPaletteEnabled));
    const navigateToSession = useNavigateToSession();

    // Define available commands
    const commands = useMemo((): Command[] => {
        const cmds: Command[] = [
            // Navigation commands
            {
                id: 'new-session',
                title: t('newSession.title'),
                subtitle: t('commandPalette.newSessionSubtitle'),
                icon: 'add-circle-outline',
                category: t('sessionHistory.title'),
                shortcut: '⌘N',
                action: () => {
                    router.navigate('/new');
                }
            },
            {
                id: 'sessions',
                title: t('sessionHistory.viewAll'),
                subtitle: t('commandPalette.allSessionsSubtitle'),
                icon: 'chatbubbles-outline',
                category: t('sessionHistory.title'),
                action: () => {
                    router.push('/');
                }
            },
            {
                id: 'settings',
                title: t('settings.title'),
                subtitle: t('commandPalette.settingsSubtitle'),
                icon: 'settings-outline',
                category: t('commandPalette.navigation'),
                shortcut: '⌘,',
                action: () => {
                    router.push('/settings');
                }
            },
            {
                id: 'account',
                title: t('settings.account'),
                subtitle: t('settings.accountSubtitle'),
                icon: 'person-circle-outline',
                category: t('commandPalette.navigation'),
                action: () => {
                    router.push('/settings/account');
                }
            },
            {
                id: 'connect',
                title: t('settingsAccount.linkNewDevice'),
                subtitle: t('settingsAccount.linkNewDeviceSubtitle'),
                icon: 'link-outline',
                category: t('commandPalette.navigation'),
                action: () => {
                    router.push('/terminal/connect');
                }
            },
        ];

        // Add session-specific commands
        const recentSessions = Object.values(sessions)
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 5);

        recentSessions.forEach(session => {
            const sessionName = session.metadata?.name || `${t('machine.untitledSession')} ${session.id.slice(0, 6)}`;
            cmds.push({
                id: `session-${session.id}`,
                title: sessionName,
                subtitle: session.metadata?.path || t('commandPalette.switchToSession'),
                icon: 'time-outline',
                category: t('commandPalette.recentSessions'),
                action: () => {
                    navigateToSession(session.id);
                }
            });
        });

        // System commands
        cmds.push({
            id: 'sign-out',
            title: t('settingsAccount.logout'),
            subtitle: t('settingsAccount.logoutSubtitle'),
            icon: 'log-out-outline',
            category: t('commandPalette.system'),
            action: async () => {
                await logout();
            }
        });

        // Dev commands (if in development)
        if (__DEV__) {
            cmds.push({
                id: 'dev-menu',
                title: t('settings.developerTools'),
                subtitle: t('commandPalette.developerSubtitle'),
                icon: 'code-slash-outline',
                category: t('settings.developer'),
                action: () => {
                    router.push('/dev');
                }
            });
        }

        return cmds;
    }, [router, logout, sessions, navigateToSession]);

    const showCommandPalette = useCallback(() => {
        if (Platform.OS !== 'web' || !commandPaletteEnabled) return;
        
        Modal.show({
            component: CommandPalette,
            props: {
                commands,
            }
        } as any);
    }, [commands, commandPaletteEnabled]);

    // Set up global keyboard handler only if feature is enabled
    useGlobalKeyboard(commandPaletteEnabled ? showCommandPalette : () => {});

    return <>{children}</>;
}
