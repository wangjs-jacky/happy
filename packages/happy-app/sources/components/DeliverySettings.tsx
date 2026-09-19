import { cloudflareStatusLabel } from '@/utils/cloudflareStatusLabel';
/** Global, per-message delivery preferences shared by settings and the composer. */
import * as React from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/AuthContext';
import { useSetting, useSettingMutable } from '@/sync/storage';
import { getCloudflarePreviewStatus, type CloudflarePreviewStatus } from '@/sync/apiInteractivePreviews';
import { Modal } from '@/modal';
import { t } from '@/text';
import { Item } from './Item';
import { Switch } from './Switch';


export function openDeliverySettings(): void {
    Modal.show({ component: DeliverySettingsPanel, accessibilityLabel: t('delivery.title') });
}

export const DeliverySettingsRows = React.memo(function DeliverySettingsRows() {
    const [enabled, setEnabled] = useSettingMutable('awayFromComputer');
    const mode = useSetting('previewDeliveryMode');
    return <>
        <Item title={t('delivery.away')} subtitle={t('delivery.description')} subtitleLines={0} showChevron={false}
            rightElement={<Switch testID="delivery-settings-switch" accessibilityLabel={t('delivery.away')} value={enabled} onValueChange={setEnabled} />} />
        {enabled ? <Item title={t('delivery.previewMode')} detail={t(mode === 'hosted' ? 'delivery.hosted' : 'delivery.tunnel')}
            subtitle={t('delivery.scope')} testID="delivery-settings-mode" onPress={openDeliverySettings} /> : null}
    </>;
});

export const DeliveryModeButton = React.memo(function DeliveryModeButton() {
    const { theme } = useUnistyles();
    const enabled = useSetting('awayFromComputer');
    const label = t(enabled ? 'delivery.enabledLabel' : 'delivery.disabledLabel');
    return <Pressable onPress={openDeliverySettings} accessibilityRole="button" accessibilityLabel={label}
        {...(Platform.OS === 'web' ? { title: label } : {})} testID="delivery-mode-button"
        style={({ pressed }) => [styles.trigger, enabled && styles.selected, pressed && styles.pressed]}>
        <Ionicons name="phone-portrait-outline" size={21} color={enabled ? theme.colors.accent : theme.colors.textSecondary} />
        {enabled ? <View style={styles.dot} /> : null}
    </Pressable>;
});

function DeliverySettingsPanel({ onClose }: { onClose: () => void }) {
    const { theme } = useUnistyles();
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { credentials } = useAuth();
    const [enabled, setEnabled] = useSettingMutable('awayFromComputer');
    const [mode, setMode] = useSettingMutable('previewDeliveryMode');
    const [status, setStatus] = React.useState<CloudflarePreviewStatus | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [feedback, setFeedback] = React.useState('');
    const localChange = React.useRef(false);
    const previous = React.useRef({ enabled, mode });
    React.useEffect(() => {
        if (previous.current.enabled !== enabled || previous.current.mode !== mode) {
            setFeedback(t(localChange.current ? 'delivery.saved' : 'delivery.updatedElsewhere'));
            previous.current = { enabled, mode };
            localChange.current = false;
        }
    }, [enabled, mode]);
    const changeEnabled = (value: boolean) => { localChange.current = true; setEnabled(value); };
    const changeMode = (value: 'tunnel' | 'hosted') => { localChange.current = true; setMode(value); };
    const [failed, setFailed] = React.useState(false);
    const generation = React.useRef(0);
    const refresh = React.useCallback(async () => {
        const request = ++generation.current;
        setLoading(true);
        try {
            if (!credentials) throw new Error('No authentication');
            const next = await getCloudflarePreviewStatus(credentials);
            if (request === generation.current) { setStatus(next); setFailed(false); }
        } catch { if (request === generation.current) { setStatus(null); setFailed(true); } }
        finally { if (request === generation.current) setLoading(false); }
    }, [credentials]);
    React.useEffect(() => {
        void refresh();
        const interval = setInterval(() => void refresh(), 30_000);
        const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
        return () => { generation.current++; clearInterval(interval); subscription.remove(); };
    }, [refresh]);
    const configure = (selectHosted = false) => {
        onClose();
        router.push(selectHosted ? '/settings/temporary-previews?selectHosted=1' : '/settings/temporary-previews');
    };
    const mobile = width < 768;
    return <View pointerEvents="box-none" style={[styles.frame, { width: mobile ? width : Math.min(width - 32, 440), height: mobile ? height : undefined, justifyContent: mobile ? 'flex-end' : 'center' }]}>
        <View style={[styles.panel, { maxHeight: height - insets.top - 24, paddingBottom: Math.max(insets.bottom, 16) }]} testID="delivery-settings-panel">
            <View style={styles.header}><Text style={styles.title}>{t('delivery.title')}</Text>
                <Pressable onPress={onClose} accessibilityLabel={t('common.cancel')} accessibilityRole="button" style={styles.trigger}><Ionicons name="close" size={22} color={theme.colors.textSecondary} /></Pressable>
            </View>
            <ScrollView>
                <Item title={t('delivery.away')} subtitle={t('delivery.description')} subtitleLines={0} showChevron={false}
                    rightElement={<Switch testID="delivery-panel-switch" accessibilityLabel={t('delivery.away')} value={enabled} onValueChange={changeEnabled} />} />
                <Text style={styles.copy}>{t('delivery.scope')}</Text>
                {enabled ? <View style={styles.choices}>
                    <Text style={styles.section}>{t('delivery.previewMode')}</Text>
                    <Item title={t('delivery.tunnel')} subtitle={t('delivery.tunnelDescription')} subtitleLines={0}
                        style={mode === 'tunnel' ? styles.selected : undefined}
                        icon={<Ionicons name={mode === 'tunnel' ? 'radio-button-on' : 'radio-button-off'} size={22} color={theme.colors.accent} />} selected={mode === 'tunnel'}
                        accessibilityRole="radio" accessibilityState={{ checked: mode === 'tunnel' }} showChevron={false}
                        testID="delivery-mode-tunnel" onPress={() => changeMode('tunnel')} />
                    <Item title={t('delivery.hosted')} subtitle={t('delivery.hostedDescription')} subtitleLines={0}
                        style={mode === 'hosted' ? styles.selected : undefined}
                        icon={<Ionicons name={mode === 'hosted' ? 'radio-button-on' : 'radio-button-off'} size={22} color={theme.colors.accent} />} selected={mode === 'hosted'}
                        accessibilityRole="radio" accessibilityState={{ checked: mode === 'hosted' }} showChevron={false}
                        disabled={loading || !status?.available} testID="delivery-mode-hosted"
                        onPress={() => status?.connected ? changeMode('hosted') : configure(true)} />
                    {loading ? <ActivityIndicator color={theme.colors.accent} /> : null}
                    <Text testID="delivery-cloudflare-status" style={styles.copy}>{failed ? t('delivery.verificationUnavailable') : status ? cloudflareStatusLabel(status) : t('interactivePreviews.loading')}</Text>
                    {status?.verification ? <Text style={styles.copy}>{t('delivery.checkedAt', { time: new Date(status.verification.checkedAt).toLocaleString() })}</Text> : null}
                    {failed ? <Item title={t('interactivePreviews.retry')} onPress={() => void refresh()} /> : null}
                    <Item title={t('delivery.configure')} testID="delivery-configure" onPress={() => configure()} />
                </View> : null}
                {feedback ? <Text accessibilityLiveRegion="polite" style={styles.copy}>{feedback}</Text> : null}
                <Text style={styles.copy}>{t('delivery.timing')}</Text>
                {enabled ? <Text style={styles.copy}>{t('interactivePreviews.disclosure')}</Text> : null}
            </ScrollView>
        </View>
    </View>;
}

const styles = StyleSheet.create(theme => ({
    trigger: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    selected: { backgroundColor: theme.colors.surfaceSelected },
    pressed: { backgroundColor: theme.colors.surfacePressed },
    dot: { position: 'absolute', top: 7, right: 7, width: 5, height: 5, borderRadius: 3, backgroundColor: theme.colors.accent },
    frame: { alignSelf: 'center' },
    panel: { backgroundColor: theme.colors.surface, borderRadius: 22, overflow: 'hidden' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 8, paddingTop: 8 },
    title: { fontSize: 20, fontWeight: '700', color: theme.colors.text },
    copy: { fontSize: 12, lineHeight: 18, color: theme.colors.textSecondary, paddingHorizontal: 16, paddingBottom: 12 },
    choices: { borderTopWidth: 1, borderColor: theme.colors.divider, paddingTop: 16, marginTop: 8 },
    section: { fontSize: 13, color: theme.colors.textSecondary, paddingHorizontal: 16, marginBottom: 8 },
}));
