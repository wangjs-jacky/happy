import { useCallback, useEffect, useMemo, useState } from 'react';
import { MMKV } from 'react-native-mmkv';
import {
    getLastViewedTitle,
    setLastViewedTitle,
    getLatestTitle
} from '@/changelog';
import { getOtaChangelogTitle } from '@/changelog/runtime';
import { loadAppConfig } from '@/sync/appConfig';
import { useOtaVersions } from './useOtaVersions';

const mmkv = new MMKV();

export function useChangelog() {
    const appConfig = useMemo(() => loadAppConfig(), []);
    const changelogChannel = appConfig.otaChannel || 'preview';
    const { versions, loading } = useOtaVersions(changelogChannel);
    const fallbackTitle = getLatestTitle();
    const latestTitle = versions[0] ? getOtaChangelogTitle(versions[0]) : fallbackTitle;
    const [hasUnread, setHasUnread] = useState(false);

    useEffect(() => {
        if (loading || !latestTitle) return;

        const lastViewed = getLastViewedTitle();

        if (!lastViewed) {
            const hadOldKey = mmkv.contains('changelog-last-viewed-version');
            if (!hadOldKey) {
                setLastViewedTitle(latestTitle);
                setHasUnread(false);
                return;
            }
            setHasUnread(true);
            return;
        }

        setHasUnread(latestTitle !== lastViewed);
    }, [latestTitle, loading]);

    const markAsRead = useCallback(() => {
        if (latestTitle) {
            setLastViewedTitle(latestTitle);
            setHasUnread(false);
        }
    }, [latestTitle]);

    return {
        hasUnread,
        latestTitle,
        loading,
        markAsRead
    };
}
