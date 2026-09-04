import * as React from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/AuthContext';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Modal } from '@/modal';
import { t } from '@/text';
import { openExternalUrl } from '@/utils/openExternalUrl';
import {
    disconnectVercelPreview,
    getVercelPreviewConnectUrl,
    getVercelPreviewStatus,
    type VercelPreviewStatus,
} from '@/sync/apiInteractivePreviews';

type LoadState =
    | { kind: 'loading' }
    | { kind: 'ready'; status: VercelPreviewStatus }
    | { kind: 'error' };

const OAUTH_POLL_MS = 2_000;
const OAUTH_POLL_TIMEOUT_MS = 120_000;

export default function TemporaryPreviewsSettings() {
    const { theme } = useUnistyles();
    const { credentials } = useAuth();
    const [loadState, setLoadState] = React.useState<LoadState>({ kind: 'loading' });
    const [busy, setBusy] = React.useState(false);
    const pollTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
    const popupRef = React.useRef<Window | null>(null);
    const popupConnectionRef = React.useRef<string | null>(null);
    const refreshGeneration = React.useRef(0);
    const mounted = React.useRef(true);
    const status = loadState.kind === 'ready' ? loadState.status : null;

    const stopPolling = React.useCallback(() => {
        if (pollTimer.current) clearInterval(pollTimer.current);
        pollTimer.current = null;
    }, []);

    const closePopup = React.useCallback(() => {
        const popup = popupRef.current;
        if (popup && !popup.closed) popup.close();
        popupRef.current = null;
        popupConnectionRef.current = null;
        stopPolling();
    }, [stopPolling]);

    const refresh = React.useCallback(async () => {
        const generation = ++refreshGeneration.current;
        if (!credentials) {
            if (mounted.current && generation === refreshGeneration.current) setLoadState({ kind: 'error' });
            return;
        }
        try {
            const status = await getVercelPreviewStatus(credentials);
            if (!mounted.current || generation !== refreshGeneration.current) return;
            setLoadState({ kind: 'ready', status });
            const connectionKey = status.account
                ? `${status.account.teamId ?? ''}:${status.account.projectId ?? ''}`
                : '';
            if (status.connected && popupRef.current && (
                popupConnectionRef.current === null || popupConnectionRef.current !== connectionKey
            )) closePopup();
        } catch {
            if (mounted.current && generation === refreshGeneration.current) setLoadState({ kind: 'error' });
        }
    }, [closePopup, credentials]);

    React.useEffect(() => { void refresh(); }, [refresh]);
    React.useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    React.useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return;
        const browserWindow = window;
        const query = new URLSearchParams(browserWindow.location.search);
        const isCallback = query.get('vercel') === 'connected' || query.has('vercel_error');
        if (isCallback && browserWindow.opener && !browserWindow.opener.closed) {
            browserWindow.opener.postMessage({ type: 'happy-vercel-connected' }, browserWindow.location.origin);
            browserWindow.close();
            return;
        }
        if (isCallback) void refresh();

        const onFocus = () => { void refresh(); };
        const onMessage = (event: MessageEvent) => {
            if (event.origin === browserWindow.location.origin && event.data?.type === 'happy-vercel-connected') {
                closePopup();
                void refresh();
            }
        };
        browserWindow.addEventListener('focus', onFocus);
        browserWindow.addEventListener('message', onMessage);
        return () => {
            browserWindow.removeEventListener('focus', onFocus);
            browserWindow.removeEventListener('message', onMessage);
        };
    }, [closePopup, refresh]);

    React.useEffect(() => () => closePopup(), [closePopup]);

    const startPolling = React.useCallback((popup: Window) => {
        if (!credentials || !mounted.current || popupRef.current !== popup || popup.closed) return;
        stopPolling();
        const startedAt = Date.now();
        pollTimer.current = setInterval(() => {
            if (popupRef.current !== popup || popup.closed) {
                closePopup();
                return;
            }
            if (Date.now() - startedAt >= OAUTH_POLL_TIMEOUT_MS) {
                // Invalidate any in-flight poll before making the timeout retryable.
                refreshGeneration.current += 1;
                closePopup();
                if (mounted.current) setLoadState({ kind: 'error' });
                return;
            }
            void refresh();
        }, OAUTH_POLL_MS);
    }, [closePopup, credentials, refresh, stopPolling]);

    const connect = React.useCallback(async () => {
        if (!credentials || busy || (popupRef.current && !popupRef.current.closed)) return;
        setBusy(true);
        try {
            if (Platform.OS === 'web') {
                const popup = typeof window !== 'undefined'
                    ? window.open('about:blank', 'happy-vercel-connect', 'popup,width=720,height=760')
                    : null;
                if (!popup) {
                    Modal.alert(t('interactivePreviews.title'), t('interactivePreviews.popupBlocked'));
                    return;
                }
                popupRef.current = popup;
                popupConnectionRef.current = status?.connected
                    ? `${status.account?.teamId ?? ''}:${status.account?.projectId ?? ''}`
                    : null;
                try {
                    const url = await getVercelPreviewConnectUrl(credentials);
                    if (!mounted.current || popupRef.current !== popup || popup.closed) return;
                    popup.location.href = url;
                    startPolling(popup);
                } catch {
                    if (mounted.current && popupRef.current === popup) {
                        closePopup();
                        Modal.alert(t('interactivePreviews.title'), t('interactivePreviews.safeError'));
                    }
                }
                return;
            }
            await openExternalUrl(await getVercelPreviewConnectUrl(credentials));
        } catch {
            Modal.alert(t('interactivePreviews.title'), t('interactivePreviews.safeError'));
        } finally {
            if (mounted.current) setBusy(false);
        }
    }, [busy, closePopup, credentials, startPolling, status?.account?.projectId, status?.account?.teamId, status?.connected]);

    const disconnect = React.useCallback(async () => {
        if (!credentials || busy) return;
        const confirmed = await Modal.confirm(
            t('interactivePreviews.disconnectTitle'),
            t('interactivePreviews.disconnectBody'),
            { confirmText: t('interactivePreviews.disconnect'), destructive: true },
        );
        if (!confirmed) return;
        setBusy(true);
        try {
            const result = await disconnectVercelPreview(credentials);
            await refresh();
            if (result.warning === 'VERCEL_DEPLOYMENT_CLEANUP_PENDING') {
                Modal.alert(t('interactivePreviews.title'), t('interactivePreviews.disconnectWarning'));
            }
        } catch {
            Modal.alert(t('interactivePreviews.title'), t('interactivePreviews.safeError'));
        } finally {
            setBusy(false);
        }
    }, [busy, credentials, refresh]);

    const connectedName = status?.account?.teamName || status?.account?.teamId || 'Vercel';

    return <ItemList testID="temporary-previews-screen">
        <Stack.Screen options={{ title: t('interactivePreviews.title') }} />
        <View style={styles.intro}>
            <Ionicons color={theme.colors.accent} name="cloud-upload-outline" size={32} />
            <Text style={[styles.title, { color: theme.colors.text }]}>{t('interactivePreviews.title')}</Text>
            <Text style={[styles.copy, { color: theme.colors.textSecondary }]}>{t('interactivePreviews.disclosure')}</Text>
        </View>
        <ItemGroup title={t('interactivePreviews.connection')}>
            {loadState.kind === 'loading' ? <View testID="temporary-previews-status-loading" style={styles.loading}><ActivityIndicator color={theme.colors.accent} /><Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>{t('interactivePreviews.loading')}</Text></View> : null}
            {loadState.kind === 'error' ? <>
                <Text testID="temporary-previews-error" style={[styles.error, { color: theme.colors.textSecondary }]}>{t('interactivePreviews.safeError')}</Text>
                <Item accessibilityLabel={t('interactivePreviews.retry')} onPress={refresh} showChevron={false} testID="temporary-previews-retry" title={t('interactivePreviews.retry')} />
            </> : null}
            {status ? <Item
                accessibilityLabel={t('interactivePreviews.connection')}
                disabled={!status.available}
                icon={<Ionicons color={status.connected ? theme.colors.status.connected : theme.colors.textSecondary} name="cloud-outline" size={28} />}
                showChevron={false}
                subtitle={!status.available
                    ? t('interactivePreviews.unavailable')
                    : status.connected
                        ? t('interactivePreviews.connected', { name: connectedName })
                        : t('interactivePreviews.disconnected')}
                testID="temporary-previews-status"
                title="Vercel"
            /> : null}
            {status?.connected && status.account?.projectId ? <Item
                showChevron={false}
                subtitle={status.account.projectId}
                testID="temporary-previews-project"
                title={t('interactivePreviews.project')}
            /> : null}
            {status?.available && !status.connected ? <Item
                accessibilityLabel={t('interactivePreviews.connect')}
                loading={busy}
                onPress={connect}
                showChevron={false}
                testID="temporary-previews-connect"
                title={t('interactivePreviews.connect')}
            /> : null}
            {status?.available && status.connected ? <>
                <Item accessibilityLabel={t('interactivePreviews.reconnect')} loading={busy} onPress={connect} showChevron={false} testID="temporary-previews-reconnect" title={t('interactivePreviews.reconnect')} />
                <Item accessibilityLabel={t('interactivePreviews.disconnect')} destructive loading={busy} onPress={disconnect} showChevron={false} testID="temporary-previews-disconnect" title={t('interactivePreviews.disconnect')} />
            </> : null}
        </ItemGroup>
    </ItemList>;
}

const styles = StyleSheet.create(() => ({
    intro: { alignItems: 'center', gap: 8, paddingHorizontal: 28, paddingVertical: 28 },
    title: { fontSize: 20, fontWeight: '700' },
    copy: { fontSize: 13, lineHeight: 19, maxWidth: 520, textAlign: 'center' },
    loading: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 56, paddingHorizontal: 16 },
    loadingText: { fontSize: 14 },
    error: { fontSize: 14, lineHeight: 20, padding: 16 },
}));
