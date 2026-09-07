import * as React from 'react';
import { ActivityIndicator, Platform, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/AuthContext';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Modal } from '@/modal';
import { t } from '@/text';
import {
    connectCloudflarePreview, disconnectCloudflarePreview, getCloudflarePreviewStatus,
    CloudflarePreviewApiError, isCloudflareConnectionSecure, type CloudflarePreviewStatus,
} from '@/sync/apiInteractivePreviews';
import { createPreviewE2EFixture, resolvePreviewE2EFixture } from '@/sync/previewE2EFixture';

type LoadState = { kind: 'loading' } | { kind: 'ready'; status: CloudflarePreviewStatus } | { kind: 'error' };

export default React.memo(function TemporaryPreviewsSettings() {
    const { theme } = useUnistyles();
    const { credentials } = useAuth();
    const [loadState, setLoadState] = React.useState<LoadState>({ kind: 'loading' });
    const [busy, setBusy] = React.useState(false);
    const [editing, setEditing] = React.useState(false);
    const [accountId, setAccountId] = React.useState('');
    const [apiToken, setApiToken] = React.useState('');
    const actionLock = React.useRef(false);
    const mounted = React.useRef(true);
    const generation = React.useRef(0);
    const fixtureRef = React.useRef<ReturnType<typeof createPreviewE2EFixture>>(null);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
        fixtureRef.current = resolvePreviewE2EFixture(fixtureRef.current, window.location.href);
    }
    const fixture = fixtureRef.current;
    const status = loadState.kind === 'ready' ? loadState.status : null;
    const refresh = React.useCallback(async () => {
        const current = ++generation.current;
        try {
            if (!credentials) throw new Error('No credentials');
            const result = fixture ? fixture.getStatus() : await getCloudflarePreviewStatus(credentials);
            if (mounted.current && current === generation.current) setLoadState({ kind: 'ready', status: result });
        } catch {
            if (mounted.current && current === generation.current) setLoadState({ kind: 'error' });
        }
    }, [credentials, fixture]);
    React.useEffect(() => {
        mounted.current = true;
        void refresh();
        return () => { mounted.current = false; generation.current++; };
    }, [refresh]);

    const configure = () => {
        if (!isCloudflareConnectionSecure()) {
            Modal.alert(t('interactivePreviews.title'), t('interactivePreviews.secureConnectionRequired'));
            return;
        }
        setAccountId(status?.account?.accountId ?? '');
        setApiToken('');
        setEditing(true);
    };
    const connect = async () => {
        if (!credentials || actionLock.current) return;
        if (!/^[a-f0-9]{32}$/.test(accountId.trim()) || !/^[A-Za-z0-9_-]{20,4096}$/.test(apiToken.trim())) {
            Modal.alert(t('interactivePreviews.title'), t('interactivePreviews.invalidCredentials'));
            return;
        }
        actionLock.current = true;
        setBusy(true);
        try {
            if (fixture) fixture.markConnected();
            else await connectCloudflarePreview(credentials, accountId.trim(), apiToken.trim());
            if (mounted.current) setEditing(false);
            await refresh();
        } catch (error) {
            if (mounted.current) Modal.alert(t('interactivePreviews.title'), t(error instanceof CloudflarePreviewApiError && error.kind === 'insecure'
                ? 'interactivePreviews.secureConnectionRequired' : error instanceof CloudflarePreviewApiError && error.kind === 'credentials'
                    ? 'interactivePreviews.invalidCredentials' : 'interactivePreviews.safeError'));
        } finally {
            // Tokens never enter persistent settings, URLs or browser storage.
            if (mounted.current) { setApiToken(''); setBusy(false); }
            actionLock.current = false;
        }
    };
    const disconnect = async () => {
        if (!credentials || actionLock.current) return;
        const confirmed = await Modal.confirm(t('interactivePreviews.disconnectTitle'), t('interactivePreviews.disconnectBody'),
            { confirmText: t('interactivePreviews.disconnect'), destructive: true });
        if (!confirmed || actionLock.current) return;
        actionLock.current = true;
        setBusy(true);
        try {
            const result = fixture ? fixture.disconnect() : await disconnectCloudflarePreview(credentials);
            if (mounted.current) { setEditing(false); setApiToken(''); }
            await refresh();
            if (result.warning) Modal.alert(t('interactivePreviews.title'), t('interactivePreviews.disconnectWarning'));
        } catch {
            if (mounted.current) Modal.alert(t('interactivePreviews.title'), t('interactivePreviews.safeError'));
        } finally {
            actionLock.current = false;
            if (mounted.current) setBusy(false);
        }
    };
    return <ItemList testID="temporary-previews-screen">
        <View style={styles.intro}>
            <Ionicons color={theme.colors.accent} name="cloud-upload-outline" size={32} />
            <Text style={styles.title}>{t('interactivePreviews.title')}</Text>
            <Text style={styles.copy}>{t('interactivePreviews.disclosure')}</Text>
        </View>
        <ItemGroup title={t('interactivePreviews.tunnelProvider')}>
            <Item title={t('interactivePreviews.tunnelProvider')} showChevron={false}
                icon={<Ionicons color={theme.colors.accent} name="cloud-outline" size={28} />} testID="temporary-previews-cloudflare" />
            <Text style={styles.description}>{t('interactivePreviews.cloudflareDescription')}</Text>
            <Text style={styles.description}>{t('interactivePreviews.sessionLifetime')}</Text>
        </ItemGroup>
        <ItemGroup title={t('interactivePreviews.hostedProvider')}>
            <Text style={styles.description}>{t('interactivePreviews.hostedDescription')}</Text>
            {loadState.kind === 'loading' ? <View testID="temporary-previews-status-loading" style={styles.loading}>
                <ActivityIndicator color={theme.colors.accent} /><Text style={styles.description}>{t('interactivePreviews.loading')}</Text>
            </View> : null}
            {loadState.kind === 'error' ? <>
                <Text testID="temporary-previews-error" style={styles.description}>{t('interactivePreviews.safeError')}</Text>
                <Item onPress={() => { fixture?.allowRetry(); void refresh(); }} showChevron={false} testID="temporary-previews-retry" title={t('interactivePreviews.retry')} />
            </> : null}
            {status ? <>
                <Item title={t('interactivePreviews.connection')} testID="temporary-previews-status" showChevron={false}
                    icon={<Ionicons color={status.connected ? theme.colors.status.connected : theme.colors.textSecondary} name="cloud-done-outline" size={28} />} />
                <Text style={styles.description}>{!status.available ? t('interactivePreviews.unavailable')
                    : status.connected ? t('interactivePreviews.connected', { name: status.account?.accountId ?? 'Cloudflare' })
                    : t('interactivePreviews.disconnected')}</Text>
            </> : null}
            {status?.connected && status.account?.projectId ? <Item showChevron={false} subtitle={status.account.projectId}
                testID="temporary-previews-project" title={t('interactivePreviews.project')} /> : null}
            {status?.available && !editing ? <Item disabled={busy} onPress={configure} showChevron={false}
                testID={status.connected ? 'temporary-previews-reconnect' : 'temporary-previews-connect'}
                title={t(status.connected ? 'interactivePreviews.reconnect' : 'interactivePreviews.configure')} /> : null}
            {editing ? <View style={styles.form}>
                <Text style={styles.label}>{t('interactivePreviews.accountId')}</Text>
                <TextInput accessibilityLabel={t('interactivePreviews.accountId')} autoCapitalize="none" autoCorrect={false}
                    editable={!busy} maxLength={32} onChangeText={setAccountId} style={styles.input} value={accountId} testID="temporary-previews-account-id" />
                <Text style={styles.label}>{t('interactivePreviews.apiToken')}</Text>
                <TextInput accessibilityLabel={t('interactivePreviews.apiToken')} autoCapitalize="none" autoCorrect={false}
                    autoComplete="off" secureTextEntry editable={!busy} maxLength={4096} onChangeText={setApiToken}
                    style={styles.input} value={apiToken} testID="temporary-previews-api-token" />
                <Text style={styles.help}>{t('interactivePreviews.tokenHelp')}</Text>
                <Item disabled={busy} loading={busy} onPress={() => void connect()} showChevron={false}
                    testID="temporary-previews-save" title={t('interactivePreviews.saveConnection')} />
                <Item disabled={busy} onPress={() => { setEditing(false); setApiToken(''); }} showChevron={false} title={t('common.cancel')} />
            </View> : null}
            {status?.connected ? <Item destructive disabled={busy} loading={busy} onPress={() => void disconnect()} showChevron={false}
                testID="temporary-previews-disconnect" title={t('interactivePreviews.disconnect')} /> : null}
        </ItemGroup>
    </ItemList>;
});

const styles = StyleSheet.create(theme => ({
    intro: { alignItems: 'center', gap: 8, paddingHorizontal: 28, paddingVertical: 28 },
    title: { fontSize: 20, fontWeight: '700', color: theme.colors.text },
    copy: { fontSize: 13, lineHeight: 19, maxWidth: 520, textAlign: 'center', color: theme.colors.textSecondary },
    loading: { alignItems: 'center', flexDirection: 'row', paddingHorizontal: 16 },
    description: { fontSize: 14, lineHeight: 20, paddingHorizontal: 16, paddingVertical: 10, color: theme.colors.textSecondary },
    form: { gap: 10, padding: 16 },
    label: { color: theme.colors.text, fontSize: 14 },
    input: { color: theme.colors.text, backgroundColor: theme.colors.surface, borderColor: theme.colors.divider,
        borderWidth: 1, borderRadius: 8, padding: 12, minHeight: 44 },
    help: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
}));
