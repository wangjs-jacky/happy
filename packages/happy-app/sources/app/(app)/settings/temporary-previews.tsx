import * as React from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/auth/AuthContext';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Modal } from '@/modal';
import { openExternalUrl } from '@/utils/openExternalUrl';
import { disconnectVercelPreview, getVercelPreviewConnectUrl, getVercelPreviewStatus, type VercelPreviewStatus } from '@/sync/apiInteractivePreviews';

export default function TemporaryPreviewsSettings() {
    const { theme } = useUnistyles(); const auth = useAuth();
    const [status, setStatus] = React.useState<VercelPreviewStatus | null>(null); const [busy, setBusy] = React.useState(false);
    const pollTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
    const refresh = React.useCallback(async () => { if (auth.credentials) setStatus(await getVercelPreviewStatus(auth.credentials)); }, [auth.credentials]);
    React.useEffect(() => { void refresh().catch(() => setStatus({ available: false, connected: false })); }, [refresh]);
    React.useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);
    const connect = React.useCallback(async () => {
        if (!auth.credentials || busy) return; setBusy(true);
        const popup = Platform.OS === 'web' && typeof window !== 'undefined'
            ? window.open('about:blank', 'happy-vercel-connect', 'popup,width=720,height=760')
            : null;
        try {
            const url = await getVercelPreviewConnectUrl(auth.credentials);
            if (popup) popup.location.href = url; else await openExternalUrl(url);
            const started = Date.now();
            if (pollTimer.current) clearInterval(pollTimer.current);
            pollTimer.current = setInterval(() => { void getVercelPreviewStatus(auth.credentials!).then((next) => {
                setStatus(next); if (next.connected || Date.now() - started > 120_000) { clearInterval(pollTimer.current!); pollTimer.current = null; }
            }).catch(() => { /* Keep polling through transient network failures. */ }); }, 2000);
        } catch (error) { popup?.close(); Modal.alert('Vercel', error instanceof Error ? error.message : String(error)); }
        finally { setBusy(false); }
    }, [auth.credentials, busy, refresh]);
    const disconnect = React.useCallback(async () => {
        if (!auth.credentials || !await Modal.confirm('断开 Vercel', '之后将无法发布新的临时交互稿。', { confirmText: '断开', destructive: true })) return;
        setBusy(true); try { await disconnectVercelPreview(auth.credentials); await refresh(); } finally { setBusy(false); }
    }, [auth.credentials, refresh]);
    return <ItemList><Stack.Screen options={{ title: '临时交互预览' }} />
        <View style={styles.intro}><Ionicons color={theme.colors.accent} name="cloud-upload-outline" size={32} /><Text style={[styles.title, { color: theme.colors.text }]}>Vercel 云端预览</Text><Text style={[styles.copy, { color: theme.colors.textSecondary }]}>Happy 为当前账号统一保存加密连接。交互稿经私有 OSS 临时中转并发布为不可枚举链接，24 小时后自动删除。</Text></View>
        <ItemGroup title="连接状态">{status === null ? <ActivityIndicator /> : <Item title="Vercel" subtitle={!status.available ? '服务器尚未配置 Vercel Integration' : status.connected ? (status.account?.teamName || status.account?.teamId || '已连接') : '未连接'} icon={<Ionicons color={status.connected ? theme.colors.status.connected : theme.colors.textSecondary} name="cloud-outline" size={28} />} onPress={status.connected ? disconnect : connect} loading={busy} showChevron={false} />}</ItemGroup>
        <ItemGroup title="安全边界"><Item title="仅静态交互稿" subtitle="HTML / CSS / JS 与安全静态资源；不会上传任意项目或 localhost。" showChevron={false} /><Item title="不要放敏感资料" subtitle="预览链接公开可访问，但使用高熵地址且不被 Happy 列出。" showChevron={false} /></ItemGroup>
    </ItemList>;
}
const styles = StyleSheet.create(() => ({ intro: { alignItems: 'center', gap: 8, paddingHorizontal: 28, paddingVertical: 28 }, title: { fontSize: 20, fontWeight: '700' }, copy: { fontSize: 13, lineHeight: 19, maxWidth: 520, textAlign: 'center' } }));
