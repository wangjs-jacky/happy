import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { MagpieActionSchema, type MagpieAccount } from '@slopus/happy-wire';
import { Typography } from '@/constants/Typography';
import { useMagpie } from '@/hooks/useMagpie';
import { Modal } from '@/modal';
import { t } from '@/text';

type Machine = { id: string; name: string; active: boolean };
function Button({ title, onPress, disabled, selected, testID }: {
    title: string; onPress(): void; disabled?: boolean; selected?: boolean; testID: string;
}) {
    const [hovered, setHovered] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title}
        aria-pressed={selected}
        accessibilityState={{ disabled: !!disabled, ...(selected === undefined ? {} : { selected }) }}
        disabled={disabled} onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={({ pressed }) => [styles.button, selected && styles.selected, !disabled && (pressed || hovered) && styles.pressed, focused && styles.focused, disabled && styles.disabled]}>
        <Text style={styles.link}>{title}</Text>
    </Pressable>;
}

export function MagpieSection({ machines, connected = true }: { machines: Machine[]; connected?: boolean }) {
    const { theme } = useUnistyles();
    const [chosenId, setChosenId] = React.useState<string | null>(null);
    const [confirming, setConfirming] = React.useState(false);
    const [notice, setNotice] = React.useState<string | null>(null);
    const machine = machines.find(m => m.id === chosenId) ?? machines.find(m => m.active) ?? machines[0];
    const online = !!machine?.active && connected;
    const controller = useMagpie(machine?.id ?? null, online);
    const current = React.useRef({ machineId: machine?.id, online, controller });
    current.current = { machineId: machine?.id, online, controller };
    const { snapshot, busy, failed } = controller;
    const disabled = !online || busy || confirming;
    React.useEffect(() => { setNotice(null); }, [machine?.id, online]);
    async function act(account: MagpieAccount, kind: 'rename' | 'switch') {
        const targetMachine = machine;
        if (disabled || !targetMachine) return;
        setConfirming(true); setNotice(null);
        try {
            let name: string | null | undefined;
            if (kind === 'rename') {
                name = await Modal.prompt(t('magpie.rename'), t('magpie.nameHint'), { defaultValue: account.name, confirmText: t('common.save'), cancelText: t('common.cancel') });
                if (!name?.trim() || name.trim() === account.name) return;
                if (!MagpieActionSchema.safeParse({ action: 'rename', accountId: account.id, name }).success) {
                    setNotice(t('magpie.nameHint')); return;
                }
            } else if (!await Modal.confirm(t('magpie.switchTitle'), t('magpie.switchConfirm', { name: account.name, machine: targetMachine.name }), {
                confirmText: t('magpie.switch'), cancelText: t('common.cancel'),
            })) return;
            // A prompt can outlive a device switch, disconnection or account removal.
            const latest = current.current;
            if (!latest.online || latest.machineId !== targetMachine.id || !latest.controller.snapshot?.accounts.some(a => a.id === account.id)) return;
            const ok = await latest.controller.execute(kind === 'rename'
                ? { action: 'rename', accountId: account.id, name: name!.trim() }
                : { action: 'switch', accountId: account.id, confirmed: true });
            if (ok && current.current.machineId === targetMachine.id) setNotice(t(kind === 'rename' ? 'magpie.renamed' : 'magpie.switched'));
        } finally { setConfirming(false); }
    }
    const errorText = failed ? t('magpie.connectionFailed') : snapshot?.error === 'verification-failed' ? t('magpie.uncertain')
        : snapshot?.error === 'busy' ? t('magpie.deviceBusy') : snapshot?.error ? t('magpie.operationFailed') : null;
    return <View style={styles.section} testID="magpie-section">
        <View style={styles.heading}>
            <View style={styles.headingText}>
                <Text accessibilityRole="header" style={styles.title}>{t('magpie.title')}</Text>
                <Text style={styles.secondary}>{t('magpie.description')}</Text>
            </View>
            <Button testID="magpie-reload" title={t('magpie.reload')} disabled={disabled || !machine} onPress={() => { setNotice(null); void controller.execute({ action: 'inspect' }); }} />
        </View>
        {machines.length > 0 ? <ScrollView horizontal contentContainerStyle={styles.devices} showsHorizontalScrollIndicator={false} testID="magpie-devices">
            {machines.map(m => <Button key={m.id} testID={`magpie-device-${m.id}`} title={`${m.name}${!m.active ? ` · ${t('magpie.offlineShort')}` : ''}`}
                selected={machine?.id === m.id} disabled={confirming} onPress={() => { setChosenId(m.id); setNotice(null); }} />)}
        </ScrollView> : <Text style={styles.secondary}>{t('magpie.noDevices')}</Text>}
        {machine && !online ? <Text style={styles.secondary}>{t('magpie.offline')}</Text> : null}
        {busy ? <View style={styles.loading}><ActivityIndicator size="small" color={theme.colors.textLink} /><Text accessibilityLiveRegion="polite" style={styles.secondary}>{t('magpie.working')}</Text></View> : null}
        {online && errorText ? <Text accessibilityRole="alert" style={styles.error}>{errorText}</Text> : null}
        {online && notice ? <Text accessibilityLiveRegion="polite" style={styles.success}>{notice}</Text> : null}
        {online && snapshot?.status === 'not-installed' ? <Text style={styles.secondary}>{t('magpie.notInstalled')}</Text> : null}
        {online && snapshot?.status === 'ready' && !snapshot.accounts.length ? <Text style={styles.secondary}>{t('magpie.noAccounts')}</Text> : null}
        {online && snapshot?.accounts.length ? <View style={styles.cards}>{snapshot.accounts.map(account => <View key={account.id} style={styles.card} testID={`magpie-account-${account.id}`}>
            <View style={styles.cardHeading}>
                <Text selectable style={styles.accountName}>{account.name}</Text>
                <Text style={account.active ? styles.success : styles.secondary}>{t(account.active ? 'magpie.current' : account.enabled ? 'magpie.inPool' : 'magpie.saved')}</Text>
            </View>
            <Text style={styles.secondary}>{account.agent}{account.plan ? ` · ${account.plan}` : ''}</Text>
            {account.name !== account.user ? <Text selectable style={styles.secondary}>{account.user}</Text> : null}
            {account.needsLogin ? <Text style={styles.error}>{t('magpie.needsLogin')}</Text> : null}
            {account.quotaError ? <Text style={styles.error}>{t('magpie.quotaFailed')}</Text> : null}
            {!account.windows.length ? <Text style={styles.secondary}>{t('magpie.quotaUnknown')}</Text> : account.windows.map((window, index) => <Text key={index} style={styles.quota}>
                {window.name} · {window.remaining === null ? t('magpie.quotaUnknown') : t('magpie.remaining', { percent: Math.round(window.remaining) })}
                {window.resetsAt ? ` · ${t('magpie.resets', { time: new Date(window.resetsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })}` : ''}
            </Text>)}
            <Text style={styles.secondary}>{account.readAt ? t('magpie.updated', { time: new Date(account.readAt).toLocaleString() }) : t('magpie.readTimeUnknown')}</Text>
            <View style={styles.actions}>
                <Button testID={`magpie-refresh-${account.id}`} title={t('magpie.refresh')} disabled={disabled || !account.canRename} onPress={() => { setNotice(null); void controller.execute({ action: 'refresh', accountId: account.id }); }} />
                {account.canRename ? <Button testID={`magpie-rename-${account.id}`} title={t('magpie.rename')} disabled={disabled} onPress={() => { void act(account, 'rename'); }} /> : null}
                {account.canSwitch ? <Button testID={`magpie-switch-${account.id}`} title={t('magpie.switch')} disabled={disabled} onPress={() => { void act(account, 'switch'); }} /> : null}
            </View>
        </View>)}</View> : null}
        <Text style={styles.hint}>{t('magpie.scopeHint')}</Text>
    </View>;
}

const styles = StyleSheet.create(theme => ({
    section: { gap: 12, paddingBottom: 24, marginBottom: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider },
    heading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
    headingText: { flex: 1, gap: 6 }, title: { ...Typography.default('semiBold'), fontSize: 17, color: theme.colors.text },
    secondary: { ...Typography.default(), fontSize: 13, lineHeight: 20, color: theme.colors.textSecondary },
    devices: { gap: 8 }, cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    card: { flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 0, padding: 16, gap: 6, backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderWidth: 1, borderRadius: 12 },
    cardHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    accountName: { ...Typography.default('semiBold'), flexShrink: 1, fontSize: 15, color: theme.colors.text },
    quota: { ...Typography.default(), fontSize: 13, lineHeight: 21, color: theme.colors.text },
    loading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
    button: { minHeight: 40, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center', borderRadius: 8, backgroundColor: theme.colors.surface },
    pressed: { backgroundColor: theme.colors.surfacePressed }, selected: { backgroundColor: theme.colors.surfaceSelected },
    focused: { borderWidth: 1, borderColor: theme.colors.textLink }, disabled: { opacity: 0.45 },
    link: { ...Typography.default('semiBold'), fontSize: 13, color: theme.colors.textLink },
    success: { ...Typography.default(), fontSize: 13, color: theme.colors.success },
    error: { ...Typography.default(), fontSize: 13, lineHeight: 20, color: theme.colors.textDestructive },
    hint: { ...Typography.default(), fontSize: 12, lineHeight: 19, color: theme.colors.textSecondary },
}));
