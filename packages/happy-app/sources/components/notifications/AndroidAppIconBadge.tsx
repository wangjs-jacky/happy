import * as React from 'react';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import { log } from '@/log';
import { storage } from '@/sync/storage';
import { getSessionAttentionBadgeCount } from '@/utils/sessionAttentionBadge';

/** Keeps supported Android launchers in sync with sessions needing attention. */
export const AndroidAppIconBadge = React.memo(() => {
    const badgeCount = storage((state) => getSessionAttentionBadgeCount(
        state.sessions,
        state.unreadSessionIds,
    ));

    React.useEffect(() => {
        if (Platform.OS !== 'android') return;

        const applyBadgeCount = () => {
            void Notifications.setBadgeCountAsync(badgeCount).catch((error: unknown) => {
                log.log(`Failed to update Android app icon badge: ${error}`);
            });
        };

        applyBadgeCount();
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') applyBadgeCount();
        });

        return () => subscription.remove();
    }, [badgeCount]);

    return null;
});

AndroidAppIconBadge.displayName = 'AndroidAppIconBadge';
