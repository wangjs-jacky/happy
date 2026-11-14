import * as React from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { PersonalComputerResponseSchema, type PersonalComputerRequest, type PersonalComputerState } from '@slopus/happy-wire';
import { Text } from '@/components/StyledText';
import { apiSocket } from '@/sync/apiSocket';
import { personalComputerStream, usePersonalComputerFrame, usePersonalComputerInterrupted } from '@/sync/personalComputerStream';
import { t } from '@/text';

export function PersonalComputerPanel({ sessionId, onClose, expanded, onToggleExpand }: { sessionId: string; onClose: () => void; expanded?: boolean; onToggleExpand?: () => void }) {
    const { theme } = useUnistyles();
    const [viewerId] = React.useState(randomUUID);
    const [state, setState] = React.useState<PersonalComputerState | null>(null);
    const [busy, setBusy] = React.useState(true);
    const busyRef = React.useRef(false);
    const current = React.useRef(true);
    const generation = React.useRef(0);
    const [error, setError] = React.useState(false);
    const [address, setAddress] = React.useState('');
    const [text, setText] = React.useState('');
    const [viewWidth, setViewWidth] = React.useState(0);
    const frame = usePersonalComputerFrame(sessionId, viewerId);
    const interrupted = usePersonalComputerInterrupted();

    const rpc = React.useCallback(async (request: PersonalComputerRequest) => {
        const requestedGeneration = generation.current;
        const result = PersonalComputerResponseSchema.parse(await apiSocket.sessionRPC(sessionId, 'personal-computer', request,
            { timeoutMs: request.action === 'start' ? 180_000 : 30_000 }));
        if (!current.current || requestedGeneration !== generation.current) throw new Error('Computer viewer changed');
        setState(result.state);
        personalComputerStream.epoch(viewerId, result.state.epoch);
        if (result.frame) personalComputerStream.receive(sessionId, result.frame);
        return result;
    }, [sessionId, viewerId]);
    const perform = async (request: PersonalComputerRequest, viewAfter = false) => {
        if (busyRef.current || !current.current) return;
        const requestedGeneration = generation.current;
        busyRef.current = true; setBusy(true); setError(false);
        try {
            const result = await rpc(request);
            if (current.current && requestedGeneration === generation.current && viewAfter && result.state.phase === 'ready') {
                personalComputerStream.open(sessionId, viewerId, result.state.epoch);
                await rpc({ action: 'view', viewerId });
            }
            return true;
        } catch { if (current.current && requestedGeneration === generation.current) setError(true); return false; }
        finally { if (requestedGeneration === generation.current) { busyRef.current = false; if (current.current) setBusy(false); } }
    };
    React.useEffect(() => {
        current.current = true;
        generation.current++; busyRef.current = false; setBusy(false);
        personalComputerStream.open(sessionId, viewerId);
        void perform({ action: 'status' }, true);
        return () => {
            current.current = false;
            generation.current++;
            personalComputerStream.close(viewerId);
            // Closing a viewer must never silently return control to the agent.
            void apiSocket.sessionRPC(sessionId, 'personal-computer', { action: 'unview', viewerId }).catch(() => {});
        };
    }, [sessionId, viewerId]);
    const ownsControl = state?.phase === 'ready' && state.control === 'human' && state.controllerId === viewerId;
    const liveFrame = frame?.epoch === state?.epoch ? frame : null;
    const human = ownsControl && !interrupted && !!liveFrame;
    const input = async (value: Extract<PersonalComputerRequest, { action: 'input' }>['input']) => {
        if (!human || !state) return;
        return await perform({ action: 'input', viewerId, epoch: state.epoch, input: value });
    };
    const key = (value: 'Enter' | 'Tab' | 'Escape' | 'Backspace' | 'SelectAll') => void input({ kind: 'key', key: value });
    return <View style={styles.panel} testID="personal-computer-panel">
        <View style={styles.header}>
            <Feather name="monitor" size={18} color={theme.colors.text} />
            <View style={styles.heading}><Text style={styles.title}>{t('personalAgent.computer.title')}</Text><Text style={styles.caption} accessibilityLiveRegion="polite">{interrupted ? t('personalAgent.computer.disconnected') : state?.phase !== 'ready' ? t('personalAgent.computer.stopped') : ownsControl ? t('personalAgent.computer.human') : state.control === 'human' ? t('personalAgent.computer.otherHuman') : t('personalAgent.computer.agent')}</Text></View>
            {onToggleExpand && <Pressable accessibilityRole="button" testID="personal-computer-expand" accessibilityLabel={t(expanded ? 'personalAgent.computer.collapse' : 'personalAgent.computer.expand')} accessibilityState={{ expanded: !!expanded }} onPress={onToggleExpand} style={styles.icon}><Feather name={expanded ? "minimize-2" : "maximize-2"} size={19} color={theme.colors.textSecondary} /></Pressable>}
            <Pressable accessibilityRole="button" accessibilityLabel={t('personalAgent.computer.close')} onPress={onClose} style={styles.icon}><Feather name="x" size={20} color={theme.colors.textSecondary} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.caption}>{t('personalAgent.computer.description')}</Text>
            <View style={styles.toolbar}>
                <ComputerButton label={t('personalAgent.computer.refresh')} disabled={busy} onPress={() => void perform({ action: 'status' }, true)} />
                {state?.phase !== 'ready' ? <ComputerButton label={busy ? t(state ? 'personalAgent.computer.starting' : 'common.loading') : t('personalAgent.computer.start')} disabled={busy} onPress={() => void perform({ action: 'start' }, true)} /> : <>
                    <ComputerButton label={ownsControl ? t('personalAgent.computer.release') : t('personalAgent.computer.takeover')} disabled={busy || interrupted} testID="personal-computer-control" onPress={() => void perform(ownsControl ? { action: 'release', viewerId, epoch: state.epoch } : { action: 'takeover', viewerId }, true)} />
                    <ComputerButton label={t('personalAgent.computer.stop')} disabled={busy || interrupted} onPress={() => void perform({ action: 'stop', epoch: state.epoch })} />
                </>}
                {busy && <ActivityIndicator size="small" color={theme.colors.textSecondary} />}
            </View>
            {(error || state?.phase === 'error' || state?.error) && <View><Text accessibilityRole="alert" style={styles.error}>{t('personalAgent.computer.failed')}</Text>{!!state?.error && <Text selectable style={styles.caption}>{state.error}</Text>}</View>}
            {state?.phase === 'ready' && <>
                <View style={styles.addressRow}>
                    <TextInput accessibilityLabel={t('personalAgent.computer.address')} placeholder={state.url || 'https://'} placeholderTextColor={theme.colors.textSecondary} value={address} onChangeText={setAddress} editable={human && !busy} autoCapitalize="none" autoCorrect={false} style={styles.address} testID="personal-computer-address" />
                    <ComputerButton label={t('personalAgent.computer.go')} disabled={!human || busy || !address.trim()} onPress={() => void input({ kind: 'navigate', url: address.trim() })} />
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={t('personalAgent.computer.canvas')} disabled={!human || busy} testID="personal-computer-canvas" onLayout={event => setViewWidth(event.nativeEvent.layout.width)} style={[styles.canvas, { aspectRatio: (liveFrame?.width || state.width) / (liveFrame?.height || state.height) }]} onPress={event => {
                    if (!liveFrame || !viewWidth) return;
                    const scale = liveFrame.width / viewWidth;
                    void input({ kind: 'click', x: Math.max(0, Math.min(liveFrame.width - 1, event.nativeEvent.locationX * scale)), y: Math.max(0, Math.min(liveFrame.height - 1, event.nativeEvent.locationY * scale)) });
                }}>
                    {liveFrame ? <Image source={{ uri: `data:image/jpeg;base64,${liveFrame.data}` }} resizeMode="contain" style={styles.image} /> : <Text style={styles.caption}>{t('personalAgent.computer.waitingFrame')}</Text>}
                </Pressable>
                <Text style={styles.caption}>{human ? t('personalAgent.computer.humanHint') : t('personalAgent.computer.viewHint')}</Text>
                {human && <>
                    <View style={styles.toolbar}>
                        <ComputerButton label="Tab" disabled={busy} onPress={() => key('Tab')} /><ComputerButton label="Enter" disabled={busy} onPress={() => key('Enter')} />
                        <ComputerButton label="Esc" disabled={busy} onPress={() => key('Escape')} /><ComputerButton label="⌫" disabled={busy} onPress={() => key('Backspace')} />
                        <ComputerButton label={t('personalAgent.computer.selectAll')} disabled={busy} onPress={() => key('SelectAll')} />
                        <ComputerButton label="↑" disabled={busy} onPress={() => void input({ kind: 'scroll', x: state.width / 2, y: state.height / 2, deltaY: -500 })} />
                        <ComputerButton label="↓" disabled={busy} onPress={() => void input({ kind: 'scroll', x: state.width / 2, y: state.height / 2, deltaY: 500 })} />
                    </View>
                    <TextInput accessibilityLabel={t('personalAgent.computer.text')} placeholder={t('personalAgent.computer.text')} placeholderTextColor={theme.colors.textSecondary} value={text} onChangeText={setText} multiline autoCapitalize="none" autoCorrect={false} style={styles.input} testID="personal-computer-text" />
                    <ComputerButton label={t('personalAgent.computer.type')} disabled={busy || !text} onPress={() => { const submitted = text; void input({ kind: 'text', text: submitted }).then(success => { if (success && current.current) setText(latest => latest === submitted ? '' : latest); }); }} />
                </>}
            </>}
        </ScrollView>
    </View>;
}

function ComputerButton({ label, disabled, onPress, testID }: { label: string; disabled?: boolean; onPress: () => void; testID?: string }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} testID={testID} style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create(theme => ({
    panel: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: theme.colors.surface },
    header: { minHeight: 58, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider },
    heading: { flex: 1, gap: 3 }, title: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
    caption: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    body: { padding: 16, gap: 14 }, toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    button: { minHeight: 36, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface },
    buttonText: { color: theme.colors.text, fontSize: 13 }, pressed: { backgroundColor: theme.colors.surfacePressed }, disabled: { opacity: 0.45 },
    addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, address: { flex: 1, minWidth: 0, color: theme.colors.text, fontSize: 13, padding: 10, backgroundColor: theme.colors.input.background, borderRadius: 10 },
    canvas: { width: '100%', maxWidth: 1280, alignSelf: 'center', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: theme.colors.surfaceHigh, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider },
    image: { width: '100%', height: '100%' }, input: { color: theme.colors.text, minHeight: 64, maxHeight: 160, padding: 12, backgroundColor: theme.colors.input.background, borderRadius: 10, fontSize: 14, textAlignVertical: 'top' },
    error: { color: theme.colors.textDestructive, fontSize: 13, lineHeight: 19 },
}));
