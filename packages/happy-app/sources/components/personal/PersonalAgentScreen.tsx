import * as React from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { DrawerActions, useIsFocused } from '@react-navigation/native';
import { useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { MessageView } from '@/components/MessageView';
import { MultiTextInput } from '@/components/MultiTextInput';
import { PermissionFooter } from '@/components/tools/PermissionFooter';
import { useDraft } from '@/hooks/useDraft';
import { sync } from '@/sync/sync';
import { machineResumeSession, machineSpawnNewSession, sessionAbort } from '@/sync/ops';
import { storage, useAllMachines, useIsDataReady, usePersonalAgentConversations, useSession, useSessionMessages, useSetting, useLocalSettingMutable } from '@/sync/storage';
import { isPersonalAgentConversation, personalAgentDisplayName, selectPersonalAgentConversation } from '@/sync/personalAgent';
import { useSessionTextPreviews } from '@/sync/sessionTextStream';
import { selectVisibleTextPreviews } from '@/components/sessionTextPreviewProjection';
import { isMachineOnline } from '@/utils/machineUtils';
import { useIsTablet } from '@/utils/responsive';
import type { Message } from '@/sync/typesMessage';
import type { SessionRouteOwner } from '@/sync/sessionRouteOwnership';
import { t } from '@/text';
import { PersonalAvatar } from './PersonalAvatar';
import { PersonalProfileDialog } from './PersonalProfileDialog';
import { PersonalComputerPanel } from './PersonalComputerPanel';
import { personalActivityState, personalTimeline, type PersonalTimelineRow } from './personalTimeline';

export function PersonalAgentScreen() {
    const conversations = usePersonalAgentConversations();
    const [preferred, setPreferred] = useLocalSettingMutable('personalAgentConversationId');
    const conversationId = selectPersonalAgentConversation(conversations, preferred);
    const name = personalAgentDisplayName(useSetting('personalAgentName'));
    const avatar = useSetting('personalAgentAvatar');
    const ready = useIsDataReady();
    const machines = useAllMachines().filter(machine => machine.metadata?.cliAvailability?.personal && isMachineOnline(machine));
    const [machineId, setMachineId] = React.useState<string | null>(null);
    const [starting, setStarting] = React.useState(false);
    const startingRef = React.useRef(false);
    const [error, setError] = React.useState<string | null>(null);
    const [editing, setEditing] = React.useState(false);
    const [computerOpen, setComputerOpen] = React.useState(false);
    const [computerExpanded, setComputerExpanded] = React.useState(false);
    React.useEffect(() => setComputerExpanded(false), [conversationId]);
    const [creating, setCreating] = React.useState(false);
    const [historyOpen, setHistoryOpen] = React.useState(false);
    const [target, setTarget] = React.useState<'local' | 'docker'>('local');
    const { width } = useWindowDimensions();
    const conversation = useSession(conversationId ?? '');
    const hasComputer = conversation?.metadata?.personalComputer === true && conversation.metadata.personalExecutionTarget === 'docker';
    const focused = useIsFocused();
    const focusedRef = React.useRef(focused);
    focusedRef.current = focused;
    React.useEffect(() => () => { focusedRef.current = false; }, []);
    const { theme } = useUnistyles();
    const navigation = useNavigation();
    const isTablet = useIsTablet();
    const selectedMachine = machines.find(machine => machine.id === machineId) ?? machines[0];

    React.useEffect(() => {
        if (focused && ready && !preferred && conversationId) setPreferred(conversationId);
    }, [conversationId, focused, preferred, ready, setPreferred]);

    const start = async () => {
        if (startingRef.current || !selectedMachine || (target === 'docker' && !selectedMachine.metadata?.cliAvailability?.personalComputer)) return;
        startingRef.current = true; setStarting(true); setError(null);
        try {
            const home = selectedMachine.metadata?.happyHomeDir;
            if (!home) throw new Error('personal-home-unavailable');
            const result = await machineSpawnNewSession({ machineId: selectedMachine.id,
                directory: `${home.replace(/[\\/]+$/, '')}/personal-agent/workspace`,
                agent: 'personal', approvedNewDirectoryCreation: true,
                environmentVariables: { PAWS_PERSONAL_EXECUTION_TARGET: target } });
            if (result.type !== 'success') throw new Error('personal-start-failed');
            // Store identity before hydration: network failure must not create
            // another thread on the user's next visit.
            if (focusedRef.current) { setPreferred(result.sessionId); setCreating(false); }
        } catch { if (focusedRef.current) setError(t('personalAgent.loadFailed')); }
        finally { startingRef.current = false; if (focusedRef.current) setStarting(false); }
    };

    return <View style={styles.screen} testID="personal-agent-screen">
        <View style={styles.header}>
            {!isTablet && <Pressable accessibilityRole="button" accessibilityLabel={t('personalAgent.openMenu')} onPress={() => navigation.dispatch(DrawerActions.openDrawer())} style={styles.icon}><Feather name="menu" size={21} color={theme.colors.text} /></Pressable>}
            <Pressable accessibilityRole="button" accessibilityLabel={t('personalAgent.editProfile')} onPress={() => setEditing(true)} style={({ pressed }) => [styles.identity, pressed && styles.pressed]} testID="personal-header-profile">
                <PersonalAvatar uri={avatar} size={32} /><View style={styles.identityText}><Text style={styles.title} numberOfLines={1}>{name}</Text><Text style={styles.subtitle}>{t(hasComputer ? 'personalAgent.computer.isolatedMode' : 'personalAgent.conversation')}</Text></View>
            </Pressable>
            {conversationId && !hasComputer && !creating && <Pressable accessibilityRole="button" accessibilityLabel={t('personalAgent.computer.newConversation')} testID="personal-new-computer" onPress={() => { setTarget('docker'); setCreating(true); }} style={styles.computerButton}><Feather name="monitor" size={17} color={theme.colors.text} />{width >= 600 && <Text style={styles.secondary}>{t('personalAgent.computer.newConversation')}</Text>}</Pressable>}
            {hasComputer && <Pressable accessibilityRole="button" accessibilityLabel={t('personalAgent.computer.title')} accessibilityState={{ expanded: computerOpen }} testID="personal-open-computer" onPress={() => setComputerOpen(value => !value)} style={({ pressed }) => [styles.computerButton, computerOpen && styles.machineSelected, pressed && styles.pressed]}><Feather name="monitor" size={17} color={theme.colors.text} />{width >= 600 && <Text style={styles.secondary}>{t('personalAgent.computer.title')}</Text>}</Pressable>}
            {conversations.length > 1 && <Pressable accessibilityRole="button" accessibilityLabel={t('personalAgent.computer.conversations')} accessibilityState={{ expanded: historyOpen }} testID="personal-conversations" disabled={starting} onPress={() => setHistoryOpen(value => !value)} style={styles.icon}><Feather name="clock" size={19} color={theme.colors.textSecondary} /></Pressable>}
            <Pressable accessibilityRole="button" accessibilityLabel={t('personalAgent.editProfile')} onPress={() => setEditing(true)} style={({ pressed }) => [styles.icon, pressed && styles.pressed]}><Feather name="sliders" size={19} color={theme.colors.textSecondary} /></Pressable>
        </View>
        {historyOpen && <ScrollView style={styles.history} testID="personal-conversation-picker">{[...conversations].sort((a, b) => b.createdAt - a.createdAt).map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: conversationId === item.id }} testID={`personal-select-${item.id}`} onPress={() => { if (startingRef.current) return; setPreferred(item.id); setHistoryOpen(false); setCreating(false); setComputerOpen(false); }} style={({ pressed }) => [styles.historyItem, conversationId === item.id && styles.machineSelected, pressed && styles.pressed]}><Text style={styles.text}>{t(item.metadata?.personalExecutionTarget === 'docker' ? 'personalAgent.computer.isolatedMode' : 'personalAgent.computer.localMode')}</Text><Text style={styles.secondary}>{new Date(item.createdAt).toLocaleString()}</Text></Pressable>)}</ScrollView>}
        <View style={styles.body}>
        <View style={styles.chat}>
        {conversationId && !creating ? <PersonalConversation key={conversationId} id={conversationId} name={name} />
            : <ScrollView contentContainerStyle={styles.empty}>
                <PersonalAvatar uri={avatar} size={80} />
                <Text style={styles.emptyTitle}>{t('personalAgent.emptyTitle', { name })}</Text>
                <Text style={styles.hint}>{t('personalAgent.emptyDescription')}</Text>
                {!ready || starting ? <ActivityIndicator color={theme.colors.textSecondary} /> : machines.length ? <>
                    <Text style={styles.hint}>{t('personalAgent.chooseMachine')}</Text>
                    {machines.map(machine => <Pressable key={machine.id} accessibilityRole="radio" accessibilityState={{ checked: selectedMachine?.id === machine.id }} onPress={() => setMachineId(machine.id)} style={({ pressed }) => [styles.machine, selectedMachine?.id === machine.id && styles.machineSelected, pressed && styles.pressed]}><Text style={styles.text}>{machine.metadata?.displayName || machine.metadata?.host || machine.id}</Text></Pressable>)}
                    {(['local', 'docker'] as const).map(mode => <Pressable key={mode} testID={`personal-target-${mode}`} accessibilityRole="radio" accessibilityState={{ checked: target === mode }} onPress={() => setTarget(mode)} style={[styles.machine, target === mode && styles.machineSelected]}><Text style={styles.text}>{t(mode === 'docker' ? 'personalAgent.computer.isolatedMode' : 'personalAgent.computer.localMode')}</Text></Pressable>)}
                    <Text style={styles.hint}>{t(target === 'docker' ? 'personalAgent.computer.isolatedHint' : 'personalAgent.computer.localHint')}</Text>
                    {target === 'docker' && !selectedMachine?.metadata?.cliAvailability?.personalComputer && <Text style={styles.error}>{t('personalAgent.computer.updateRequired')}</Text>}
                    <Pressable accessibilityRole="button" disabled={target === 'docker' && !selectedMachine?.metadata?.cliAvailability?.personalComputer} onPress={() => void start()} style={[styles.primary, target === 'docker' && !selectedMachine?.metadata?.cliAvailability?.personalComputer && styles.disabled]} testID="personal-start-conversation"><Text style={styles.primaryText}>{t('personalAgent.startConversation')}</Text></Pressable>
                </> : <Text style={styles.hint}>{t('personalAgent.noMachine')}</Text>}
                {creating && <Pressable accessibilityRole="button" testID="personal-cancel-create" disabled={starting} onPress={() => { if (!startingRef.current) setCreating(false); }} style={styles.machine}><Text style={styles.text}>{t('common.cancel')}</Text></Pressable>}
                {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            </ScrollView>}
        </View>
        {computerOpen && !creating && focused && hasComputer && conversationId && <View style={width >= 1200 && !computerExpanded ? styles.computerSide : styles.computerOverlay}><PersonalComputerPanel key={conversationId} sessionId={conversationId} expanded={computerExpanded} onToggleExpand={width >= 1200 ? () => setComputerExpanded(value => !value) : undefined} onClose={() => setComputerOpen(false)} /></View>}
        </View>
        {editing && <PersonalProfileDialog visible onClose={() => setEditing(false)} />}
    </View>;
}

function PersonalConversation({ id, name }: { id: string; name: string }) {
    const session = useSession(id);
    const { messages, isLoaded, hasMoreOlder, isLoadingOlder, isAtLatest, olderError } = useSessionMessages(id);
    const previews = useSessionTextPreviews(id);
    const visiblePreviews = selectVisibleTextPreviews(id, isAtLatest, messages, previews);
    const [resolution, setResolution] = React.useState<'loading' | 'ready' | 'error'>('loading');
    const [retry, setRetry] = React.useState(0);
    const [error, setError] = React.useState<string | null>(null);
    const [sending, setSending] = React.useState(false);
    const sendingRef = React.useRef(false);
    const [resuming, setResuming] = React.useState(false);
    const resumingRef = React.useRef(false);
    const [aborting, setAborting] = React.useState(false);
    const abortingRef = React.useRef(false);
    const [text, setText] = React.useState(session?.draft ?? '');
    const textRef = React.useRef(text); textRef.current = text;
    const draftRestored = React.useRef(!!session);
    React.useEffect(() => {
        if (!session || draftRestored.current) return;
        draftRestored.current = true;
        if (!textRef.current && session.draft) setText(session.draft);
    }, [session]);
    const focused = useIsFocused();
    const ownerRef = React.useRef<SessionRouteOwner | null>(null);
    const { clearDraft, updateDraft } = useDraft(id, text, setText);
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const list = React.useRef<FlatList<PersonalTimelineRow>>(null);
    const following = React.useRef(true);
    const [awayFromBottom, setAwayFromBottom] = React.useState(false);
    const [jumping, setJumping] = React.useState(false);
    // Live agent state remains available when the tool's message is outside
    // the loaded history window. Keep the action visible above the composer.
    const pendingPermissions = Object.entries(session?.agentState?.requests ?? {})
        .filter(([requestId]) => !session?.agentState?.completedRequests?.[requestId]);
    const awaitingPermission = pendingPermissions.length > 0;
    const running = !!session?.thinking || awaitingPermission || session?.agentState?.turnStatus?.status === 'running';
    React.useEffect(() => {
        if (!running) { abortingRef.current = false; setAborting(false); }
    }, [running]);

    React.useEffect(() => {
        if (!focused) return;
        let cancelled = false;
        const owner = sync.beginSessionRoute(id);
        ownerRef.current = owner;
        setResolution('loading'); setError(null);
        void sync.openSession(id, owner, { retry: retry > 0 }).then(async result => {
            if (cancelled || !sync.isSessionRouteOwner(owner)) return;
            if (result !== 'ready' || !isPersonalAgentConversation(storage.getState().sessions[id] ?? {})) {
                setResolution('error'); return;
            }
            if (storage.getState().sessionMessages?.[id]?.isAtLatest === false) {
                await sync.jumpToLatestMessages(id);
                if (cancelled || !sync.isSessionRouteOwner(owner)) return;
            }
            sync.promoteSessionRoute(owner);
            storage.getState().setCurrentViewingSession(id);
            void sync.sessionRouteBecameInteractive();
            setResolution('ready');
        }).catch(() => { if (!cancelled) setResolution('error'); });
        return () => {
            cancelled = true;
            if (sync.isSessionRouteOwner(owner) && storage.getState().currentViewingSessionId === id) storage.getState().setCurrentViewingSession(null);
            sync.leaveSessionRoute(owner);
            if (ownerRef.current === owner) ownerRef.current = null;
        };
    }, [focused, id, retry]);

    const isCurrent = () => !!ownerRef.current && sync.isSessionRouteOwner(ownerRef.current)
        && isPersonalAgentConversation(storage.getState().sessions[id] ?? {});
    const send = async () => {
        const submitted = textRef.current.trim();
        const current = storage.getState().sessions[id];
        const pending = Object.keys(current?.agentState?.requests ?? {}).some(key => !current.agentState?.completedRequests?.[key]);
        if (!submitted || sendingRef.current || !current?.active || current.thinking || current.agentState?.turnStatus?.status === 'running' || pending || resolution !== 'ready' || !isCurrent()) return;
        const submittingOwner = ownerRef.current;
        const submissionIsCurrent = () => !!submittingOwner && sync.isSessionRouteOwner(submittingOwner);
        sendingRef.current = true; setSending(true); setError(null);
        try {
            await sync.sendMessage(id, submitted, { source: 'chat', isCurrent: submissionIsCurrent });
            if (isCurrent() && textRef.current.trim() === submitted) { clearDraft(); setText(''); textRef.current = ''; }
            if (isCurrent()) { following.current = true; setAwayFromBottom(false); list.current?.scrollToOffset({ offset: 0, animated: true }); }
        } catch { if (isCurrent()) setError(t('personalAgent.sendFailed')); }
        finally { sendingRef.current = false; if (isCurrent()) setSending(false); }
    };
    const reconnect = async () => {
        if (!session?.metadata?.machineId || resumingRef.current || !isCurrent()) return;
        resumingRef.current = true;
        setResuming(true); setError(null);
        try {
            const result = await machineResumeSession({ machineId: session.metadata.machineId, sessionId: id, agent: 'personal' });
            if (result.type !== 'success' || result.sessionId !== id) throw new Error('personal-resume-failed');
            if (isCurrent()) setRetry(value => value + 1);
        } catch { if (isCurrent()) setError(t('personalAgent.loadFailed')); }
        finally { resumingRef.current = false; if (isCurrent()) setResuming(false); }
    };
    const stop = async () => {
        if (abortingRef.current || !isCurrent()) return;
        abortingRef.current = true; setAborting(true); setError(null);
        try { await sessionAbort(id); }
        catch { abortingRef.current = false; if (isCurrent()) { setAborting(false); setError(t('personalAgent.stopFailed')); } }
    };
    const jumpToLatest = async () => {
        if (jumping || !isCurrent()) return;
        setJumping(true);
        try {
            if (!isAtLatest) await sync.jumpToLatestMessages(id);
            if (isCurrent()) { following.current = true; setAwayFromBottom(false); list.current?.scrollToOffset({ offset: 0, animated: true }); }
        } catch { if (isCurrent()) setError(t('personalAgent.loadFailed')); }
        finally { if (isCurrent()) setJumping(false); }
    };
    const chatMessages = React.useMemo(() => personalTimeline(messages), [messages]);
    if (resolution === 'error') return <View style={styles.empty}><Text style={styles.hint}>{t('personalAgent.loadFailed')}</Text><Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={styles.machine}><Text style={styles.text}>{t('common.retry')}</Text></Pressable></View>;
    if (resolution !== 'ready' || !isLoaded || !session || !isPersonalAgentConversation(session)) return <View style={styles.empty}><ActivityIndicator color={theme.colors.textSecondary} /></View>;
    return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.conversation}>
        <FlatList ref={list} inverted data={chatMessages} keyExtractor={item => item.id}
            testID="personal-conversation-messages"
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            onScroll={event => { following.current = event.nativeEvent.contentOffset.y < 80; setAwayFromBottom(!following.current); }}
            scrollEventThrottle={100}
            onContentSizeChange={() => { if (following.current) list.current?.scrollToOffset({ offset: 0, animated: false }); }}
            ListFooterComponent={<>
                {(hasMoreOlder || olderError) && <Pressable accessibilityRole="button" disabled={isLoadingOlder} onPress={() => { void sync.loadOlderMessages(id).catch(() => { if (isCurrent()) setError(t('personalAgent.loadFailed')); }); }} style={styles.loadOlder}><Text style={styles.hint}>{isLoadingOlder ? t('common.loading') : olderError ? t('common.retry') : t('personalAgent.loadMore')}</Text></Pressable>}
                {!chatMessages.length && <View style={styles.empty}><Text style={styles.hint}>{t('personalAgent.emptyTitle', { name })}</Text></View>}
            </>}
            ListHeaderComponent={<>
                {visiblePreviews.map(preview => <View key={`${preview.turnId}:${preview.itemId}`} style={[styles.bubble, styles.assistant]}><Text selectable style={styles.text}>{preview.text}</Text></View>)}
                {running && !awaitingPermission && !visiblePreviews.length && <View style={styles.thinking} testID="personal-thinking"><ActivityIndicator size="small" color={theme.colors.textSecondary} /><Text style={styles.hint}>{aborting ? t('personalAgent.stopping') : t('personalAgent.thinking')}</Text></View>}
            </>}
            renderItem={({ item, index }) => <View style={styles.message}>
                {(!chatMessages[index + 1] || item.createdAt - chatMessages[index + 1].createdAt > 5 * 60_000) && <Text style={styles.time}>{new Date(item.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>}
                {item.kind === 'activity' ? <PersonalActivity row={item} sessionId={id} metadata={session.metadata} /> : <PersonalChatMessage message={item.message} sessionId={id} />}
            </View>}
        />
        <View style={[styles.composeArea, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            {(!isAtLatest || awayFromBottom) && <Pressable accessibilityRole="button" accessibilityLabel={t('session.scrollToBottom')} disabled={jumping} onPress={() => void jumpToLatest()} style={({ pressed }) => [styles.latest, pressed && styles.pressed]} testID="personal-jump-to-latest"><Feather name="arrow-down" size={16} color={theme.colors.text} /><Text style={styles.secondary}>{jumping ? t('common.loading') : t('session.scrollToBottom')}</Text></Pressable>}
            {pendingPermissions.length > 0 && <View style={styles.permissionPanel} testID="personal-pending-permission">
                <Text accessibilityRole="header" style={styles.permissionTitle}>{t('personalAgent.waitingForApproval')}</Text>
                <Text style={styles.permissionDescription}>{t('personalAgent.waitingForApprovalDescription')}</Text>
                <ScrollView style={styles.permissionRequests} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {pendingPermissions.map(([requestId, request]) => <View key={requestId} style={styles.permissionRequest}>
                        <Text style={styles.text}>{request.tool}</Text>
                        <Text selectable style={styles.permissionCommand} testID="personal-pending-command">{typeof request.arguments?.command === 'string'
                            ? request.arguments.command : JSON.stringify(request.arguments, null, 2)}</Text>
                        <PermissionFooter permission={{ id: requestId, status: 'pending' }} sessionId={id} toolName={request.tool} toolInput={request.arguments} metadata={session.metadata} />
                    </View>)}
                </ScrollView>
            </View>}
            {!session.active && <Pressable accessibilityRole="button" disabled={resuming} onPress={() => void reconnect()} style={styles.reconnect} testID="personal-reconnect"><Text style={styles.hint}>{resuming ? t('personalAgent.connecting') : t('personalAgent.reconnect')}</Text></Pressable>}
            {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            <View style={styles.composer}>
                <View style={styles.composeInput}><MultiTextInput accessibilityLabel={t('personalAgent.messagePlaceholder', { name })} placeholder={t('personalAgent.messagePlaceholder', { name })}
                    value={text} onChangeText={value => { textRef.current = value; setText(value); updateDraft(value); }} maxHeight={176} lineHeight={24} testID="personal-message-input"
                    onKeyPress={event => {
                        if (Platform.OS === 'web' && event.key === 'Enter' && !event.shiftKey) { void send(); return true; }
                        return false;
                    }}
                /></View>
                <View style={styles.composerFooter}>
                    <View style={styles.composerContext}>
                        <Text style={styles.status} testID="personal-status" accessibilityLiveRegion="polite">{!session.active ? t('personalAgent.offline') : awaitingPermission ? t('personalAgent.waitingForApproval') : aborting ? t('personalAgent.stopping') : session.hasPendingLocalMessages ? t('personalAgent.queued') : sending ? t('personalAgent.sending') : running ? t('personalAgent.thinking') : t('personalAgent.ready')}</Text>
                        {!!session.metadata?.currentModelCode && <Text style={styles.model} numberOfLines={1} testID="personal-model">{session.metadata.currentModelCode}</Text>}
                    </View>
                    {running ? <Pressable accessibilityRole="button" accessibilityLabel={aborting ? t('personalAgent.stopping') : t('personalAgent.stop')} disabled={aborting || !session.active} onPress={() => void stop()} testID="personal-stop" style={({ pressed }) => [styles.send, pressed && styles.pressed, (aborting || !session.active) && styles.disabled]}>{aborting ? <ActivityIndicator size="small" color={theme.colors.button.composer.tint} /> : <Feather name="square" size={16} color={theme.colors.button.composer.tint} />}</Pressable>
                        : <Pressable accessibilityRole="button" accessibilityLabel={t('personalAgent.send')} disabled={!text.trim() || sending || !session.active} onPress={() => void send()} testID="personal-message-send" style={({ pressed }) => [styles.send, pressed && styles.pressed, (!text.trim() || sending || !session.active) && styles.disabled]}>{sending ? <ActivityIndicator size="small" color={theme.colors.button.composer.tint} /> : <Feather name="arrow-up" size={20} color={theme.colors.button.composer.tint} />}</Pressable>}
                </View>
            </View>
            {Platform.OS === 'web' && <Text style={styles.inputHint}>{t('personalAgent.inputHint')}</Text>}
        </View>
    </KeyboardAvoidingView>;
}

function PersonalChatMessage({ message, sessionId }: {
    message: Exclude<Message, { kind: 'agent-event' | 'tool-call' }>; sessionId: string;
}) {
    const { theme } = useUnistyles();
    const [copied, setCopied] = React.useState(false);
    const [copyFailed, setCopyFailed] = React.useState(false);
    const user = message.kind === 'user-text';
    React.useEffect(() => { setCopied(false); setCopyFailed(false); }, [message.text]);
    return <View testID={`personal-message-${message.id}`}>
        <View style={[styles.bubble, user ? styles.user : styles.assistant]} testID={user ? 'personal-user-bubble' : 'personal-assistant-bubble'}>
            {message.kind === 'user-text' ? <Text selectable style={styles.userText}>{message.displayText ?? message.text}</Text>
                : <MarkdownView markdown={message.text} sessionId={sessionId} />}
        </View>
        {!user && <View style={styles.responseActions}><Pressable accessibilityRole="button" accessibilityLabel={copied ? t('common.copied') : t('common.copy')} testID={`personal-copy-${message.id}`} style={({ pressed }) => [styles.copy, pressed && styles.pressed]} onPress={() => { void Clipboard.setStringAsync(message.text).then(() => { setCopied(true); setCopyFailed(false); }).catch(() => { setCopied(false); setCopyFailed(true); }); }}><Feather name={copied ? 'check' : 'copy'} size={14} color={theme.colors.textSecondary} /><Text style={styles.secondary}>{copied ? t('common.copied') : t('common.copy')}</Text></Pressable>{copyFailed && <Text accessibilityRole="alert" style={styles.error}>{t('personalAgent.copyFailed')}</Text>}</View>}
    </View>;
}

function PersonalActivity({ row, sessionId, metadata }: { row: Extract<PersonalTimelineRow, { kind: 'activity' }>; sessionId: string; metadata: React.ComponentProps<typeof MessageView>['metadata'] }) {
    const [expanded, setExpanded] = React.useState(false);
    const { theme } = useUnistyles();
    const state = personalActivityState(row.messages);
    // The fixed approval panel remains actionable even outside the history
    // window; don't also auto-open a second set of permission controls here.
    const open = expanded;
    return <View style={styles.activity} testID="personal-activity">
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} testID="personal-activity-toggle" onPress={() => setExpanded(value => !value)} style={({ pressed }) => [styles.toolToggle, pressed && styles.pressed]}>
            {state === 'running' ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : <Feather name={state === 'error' ? 'alert-circle' : state === 'pending' ? 'pause-circle' : state === 'cancelled' ? 'slash' : 'check-circle'} size={16} color={theme.colors.textSecondary} />}
            <View style={styles.activitySummary}><Text style={styles.activityTitle}>{t('personalAgent.activity', { count: row.messages.length })}</Text><Text style={styles.secondary} numberOfLines={1}>{state === 'pending' ? t('personalAgent.waitingForApproval') : state === 'running' ? row.messages.find(message => message.tool.state === 'running')?.tool.description || row.messages[0].tool.name : state === 'error' ? t('personalAgent.activityFailed') : state === 'cancelled' ? t('personalAgent.activityCancelled') : t('personalAgent.activityComplete')}</Text></View>
            <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.textSecondary} />
        </Pressable>
        {open && <View style={styles.activityDetails}>{[...row.messages].reverse().map(message => <MessageView key={message.id} message={message} metadata={metadata} sessionId={sessionId} />)}</View>}
    </View>;
}

const styles = StyleSheet.create(theme => ({
    screen: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surface },
    body: { flex: 1, minHeight: 0, flexDirection: 'row' },
    chat: { flex: 1, minWidth: 0, minHeight: 0 },
    computerSide: { width: '54%', borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.colors.divider },
    computerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.colors.surface },
    computerButton: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
    header: { height: 68, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider },
    identity: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 24, padding: 6, minWidth: 0, flexShrink: 1 },
    identityText: { minWidth: 0, flexShrink: 1, gap: 2 },
    title: { fontSize: 16, fontWeight: '600', color: theme.colors.text, flexShrink: 1 },
    subtitle: { fontSize: 11, color: theme.colors.textSecondary },
    icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
    conversation: { flex: 1, minHeight: 0, width: '100%', maxWidth: 880, alignSelf: 'center' },
    messages: { flexGrow: 1, paddingHorizontal: 16, paddingVertical: 24 },
    message: { width: '100%', marginBottom: 20 },
    bubble: { maxWidth: '84%', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 12, minWidth: 0 },
    assistant: { alignSelf: 'flex-start', backgroundColor: theme.colors.surfaceHigh },
    user: { alignSelf: 'flex-end', backgroundColor: theme.colors.userMessageBackground },
    userText: { color: theme.colors.userMessageText, fontSize: 16, lineHeight: 26 },
    text: { color: theme.colors.text, fontSize: 15, lineHeight: 24 },
    time: { color: theme.colors.textSecondary, textAlign: 'center', fontSize: 12, marginVertical: 16 },
    activity: { width: '100%', borderRadius: 16, borderColor: theme.colors.divider, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
    toolToggle: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 15 },
    activitySummary: { flex: 1, minWidth: 0, gap: 3 },
    activityTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '500' },
    activityDetails: { padding: 12, gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
    secondary: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    responseActions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 5 },
    copy: { minHeight: 32, paddingHorizontal: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
    thinking: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16 },
    emptyTitle: { color: theme.colors.text, fontSize: 26, fontWeight: '600', textAlign: 'center' },
    hint: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22, textAlign: 'center', maxWidth: 440 },
    composeArea: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
    history: { maxHeight: 240, flexGrow: 0, borderBottomColor: theme.colors.divider, borderBottomWidth: StyleSheet.hairlineWidth },
    historyItem: { paddingHorizontal: 20, paddingVertical: 12, gap: 4, backgroundColor: theme.colors.surface },
    latest: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 6 },
    permissionPanel: { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 12, gap: 6 },
    permissionTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
    permissionDescription: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
    permissionRequests: { maxHeight: 180, flexGrow: 0 },
    permissionRequest: { gap: 6, paddingTop: 6 },
    permissionCommand: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    composer: { backgroundColor: theme.colors.input.background, borderColor: theme.colors.divider, borderWidth: StyleSheet.hairlineWidth, borderRadius: 24, gap: 12, padding: 12 },
    composeInput: { minWidth: 0, paddingHorizontal: 6, paddingTop: 4, minHeight: 32 },
    composerFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    composerContext: { flex: 1, minWidth: 0, paddingHorizontal: 6, gap: 3 },
    status: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 16 },
    model: { color: theme.colors.textSecondary, fontSize: 11, lineHeight: 14 },
    inputHint: { color: theme.colors.textSecondary, fontSize: 11, textAlign: 'center', lineHeight: 16 },
    send: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.button.composer.background, alignItems: 'center', justifyContent: 'center' },
    primary: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20, backgroundColor: theme.colors.button.primary.background },
    primaryText: { color: theme.colors.button.primary.tint, fontSize: 15 },
    machine: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: theme.colors.surface },
    machineSelected: { backgroundColor: theme.colors.surfaceSelected },
    pressed: { backgroundColor: theme.colors.surfacePressed },
    disabled: { opacity: 0.4 },
    error: { color: theme.colors.textDestructive, fontSize: 13, textAlign: 'center' },
    reconnect: { padding: 10, alignItems: 'center' },
    loadOlder: { padding: 16, alignSelf: 'center' },
}));
