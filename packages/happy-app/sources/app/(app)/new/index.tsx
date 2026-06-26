import React from 'react';
import {
    View,
    Text,
    Platform,
    Pressable,
    ScrollView,
    ActivityIndicator,
    useWindowDimensions,
} from 'react-native';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { useNavigation, useRouter } from 'expo-router';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import {
    MultiTextInput,
    MULTI_TEXT_INPUT_LINE_HEIGHT,
    type KeyPressEvent,
} from '@/components/MultiTextInput';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Constants from 'expo-constants';
import { useHeaderHeight } from '@/utils/responsive';
import { t } from '@/text';
import { useAllMachines, useLocalSetting, useSetting, storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { isMachineOnline } from '@/utils/machineUtils';
import { machineSpawnNewSession } from '@/sync/ops';
import { createWorktree } from '@/utils/worktree';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useImagePicker } from '@/hooks/useImagePicker';
import { AgentInputAttachmentStrip } from '@/components/AgentInputAttachmentStrip';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { useShallow } from 'zustand/react/shallow';
import type { MultiTextInputHandle } from '@/components/MultiTextInput';
import { Modal } from '@/modal';
import { isRunningOnMac } from '@/utils/platform';
import { getNewSessionSidebarLayout } from '@/utils/newSessionSidebarLayout';
import { resolveAgentDefaultConfig } from '@/sync/agentDefaults';
import {
    SessionConfigPanel,
    type SessionConfigPanelHandle,
} from '@/components/SessionConfigPanel';

const COMPOSER_INPUT_VERTICAL_PADDING = Platform.OS === 'web' ? 10 : 8;
// Taller composer on web/desktop where vertical space is plentiful; keep the
// compact cap on native mobile so the input doesn't dominate the screen.
const COMPOSER_INPUT_MAX_HEIGHT = Platform.OS === 'web' ? 480 : 240;
const COMPOSER_SEND_BUTTON_SIZE = 32;

// Owns the `input` subscription so the parent screen can stay decoupled from
// keystroke-rate state changes. Memoized: parent re-renders (e.g. when
// `canSend` flips or a picker opens) won't force the input to re-render
// because all of its props are stable.
type PromptInputProps = {
    placeholder: string;
    onKeyPress?: (e: KeyPressEvent) => boolean;
};
const PromptInput = React.memo(React.forwardRef<MultiTextInputHandle, PromptInputProps>(
    function PromptInput(props, ref) {
        const value = useNewSessionDraft((s) => s.input);
        const onChangeText = useNewSessionDraft((s) => s.setInput);
        return (
            <MultiTextInput
                ref={ref}
                value={value}
                onChangeText={onChangeText}
                placeholder={props.placeholder}
                lineHeight={MULTI_TEXT_INPUT_LINE_HEIGHT}
                paddingTop={COMPOSER_INPUT_VERTICAL_PADDING}
                paddingBottom={COMPOSER_INPUT_VERTICAL_PADDING}
                maxHeight={COMPOSER_INPUT_MAX_HEIGHT}
                onKeyPress={props.onKeyPress}
            />
        );
    },
));

function NewSessionScreen() {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const headerHeight = useHeaderHeight();
    const router = useRouter();
    const navigation = useNavigation();
    const navigateToSession = useNavigateToSession();

    // Real data sources. The config panel owns machine/path/agent/model/etc.
    // selection; this screen only needs the machine list to gate sending and
    // the agent defaults to compute per-session overrides at send time.
    const allMachines = useAllMachines({ includeOffline: true });
    const agentInputEnterToSend = useSetting('agentInputEnterToSend');
    const expImageUpload = useSetting('expImageUpload');
    const agentDefaultOverrides = useSetting('agentDefaultOverrides');
    const fileDiffsSidebarEnabled = useSetting('fileDiffsSidebar');
    const zenMode = useLocalSetting('zenMode');
    const { width: windowWidth } = useWindowDimensions();

    // Persisted draft fields this screen reads directly. The panel writes them;
    // we subscribe to the few we need for send gating / spawning. We deliberately
    // do NOT subscribe to `input` here (typing would re-render the whole screen);
    // PromptInput owns that subscription and handleSend reads it via getState().
    const { selectedMachineId, selectedPath, selectedAgent } = useNewSessionDraft(useShallow((s) => ({
        selectedMachineId: s.selectedMachineId,
        selectedPath: s.selectedPath,
        selectedAgent: s.agentType,
    })));

    const configPanelRef = React.useRef<SessionConfigPanelHandle>(null);

    const [isSpawning, setIsSpawning] = React.useState(false);
    // Mirrors the panel's picker open state so the desktop shell can render a
    // click-away backdrop over the centered composer area.
    const [pickerOpen, setPickerOpen] = React.useState(false);

    // Image attachment state (expImageUpload feature flag). Attachments are
    // only wired into the Claude pipeline, so the picker is gated to claude.
    const { selectedImages, pickImages, removeImage, clearImages } = useImagePicker();
    const canAttach = expImageUpload && selectedAgent === 'claude';

    const selectedMachine = React.useMemo(
        () => allMachines.find(m => m.id === selectedMachineId) ?? null,
        [allMachines, selectedMachineId],
    );

    // Spawn session handler
    const handleSend = React.useCallback(async (approvedNewDirectoryCreation: boolean = false) => {
        if (!selectedMachineId || !selectedMachine) {
            Modal.alert(t('common.error'), 'Please select a machine');
            return;
        }
        if (!isMachineOnline(selectedMachine)) {
            Modal.alert(t('common.error'), 'Machine is offline');
            return;
        }

        // Read the live config selection from the panel (index-based truth that
        // can legitimately diverge from the persisted draft after an agent switch).
        const selection = configPanelRef.current?.getSelection();
        const worktreeKey = selection?.worktreeKey ?? '__none__';
        const permissionKey = selection?.permissionKey ?? 'default';
        const modelKey = selection?.modelKey ?? 'default';
        const effortKey = selection?.effortKey ?? null;
        const effectiveAgentDefaults = resolveAgentDefaultConfig(agentDefaultOverrides, selectedAgent);

        setIsSpawning(true);
        try {
            const pathToUse = (selectedPath ?? '').trim() || '~';
            const absolutePath = resolveAbsolutePath(pathToUse, selectedMachine.metadata?.homeDir);

            // Handle worktree selection
            let spawnDirectory = absolutePath;
            if (worktreeKey === '__new__') {
                const worktreeResult = await createWorktree(selectedMachineId, absolutePath);
                if (!worktreeResult.success) {
                    Modal.alert(t('common.error'), worktreeResult.error || 'Failed to create worktree');
                    return;
                }
                spawnDirectory = worktreeResult.worktreePath;
            } else if (worktreeKey !== '__none__') {
                // Existing worktree — use its path directly
                spawnDirectory = worktreeKey;
            }

            const result = await machineSpawnNewSession({
                machineId: selectedMachineId,
                directory: spawnDirectory,
                approvedNewDirectoryCreation,
                agent: selectedAgent,
            });

            switch (result.type) {
                case 'success':
                    await sync.refreshSessions();

                    // Store only per-session overrides. Matching the effective
                    // default stays null so future code default changes apply.
                    const permissionOverride = permissionKey === effectiveAgentDefaults.permissionMode
                        ? null
                        : permissionKey;
                    const modelOverride = modelKey === effectiveAgentDefaults.modelMode
                        ? null
                        : modelKey;
                    const effortOverride = effortKey === effectiveAgentDefaults.effortLevel
                        ? null
                        : effortKey;
                    storage.getState().updateSessionPermissionMode(result.sessionId, permissionOverride);
                    storage.getState().updateSessionModelMode(result.sessionId, modelOverride);
                    storage.getState().updateSessionEffortLevel(result.sessionId, effortOverride);

                    // Pull live prompt and clear it. We read via getState() so this
                    // callback doesn't have to subscribe to `input` (which would
                    // re-render the screen on every keystroke).
                    const draftState = useNewSessionDraft.getState();
                    const trimmedPrompt = draftState.input.trim();
                    draftState.setInput('');

                    // Pull image attachments (claude-only) and clear the strip.
                    const attachments = canAttach && selectedImages.length > 0 ? selectedImages : undefined;
                    if (attachments) clearImages();

                    // Send initial message if there's text or attachments.
                    if (trimmedPrompt || attachments) {
                        await sync.sendMessage(result.sessionId, trimmedPrompt, { source: 'new_session', attachments });
                    }

                    router.back();
                    navigateToSession(result.sessionId);
                    break;
                case 'requestToApproveDirectoryCreation': {
                    const approved = await Modal.confirm(
                        'Create Directory?',
                        `The directory '${result.directory}' does not exist. Would you like to create it?`,
                        { cancelText: t('common.cancel'), confirmText: t('common.create') },
                    );
                    if (approved) {
                        await handleSend(true);
                    }
                    break;
                }
                case 'error':
                    Modal.alert(t('common.error'), result.errorMessage);
                    break;
            }
        } catch (error) {
            const errorMessage = error instanceof Error
                ? error.message
                : 'Failed to start session';
            Modal.alert(t('common.error'), errorMessage);
        } finally {
            setIsSpawning(false);
        }
    }, [selectedMachineId, selectedMachine, selectedPath, selectedAgent, agentDefaultOverrides, router, navigateToSession, canAttach, selectedImages, clearImages]);

    const canSend = selectedMachineId && selectedMachine && isMachineOnline(selectedMachine) && !isSpawning;
    const sidebarLayout = getNewSessionSidebarLayout({
        platform: Platform.OS,
        isMac: isRunningOnMac(),
        fileDiffsSidebarEnabled,
        zenMode,
        windowWidth,
    });
    React.useLayoutEffect(() => {
        navigation.setOptions({ headerShown: !sidebarLayout.showSidebar });
        return () => navigation.setOptions({ headerShown: true });
    }, [navigation, sidebarLayout.showSidebar]);

    // Handle Enter/Cmd+Enter to send on web
    const handleKeyPress = React.useCallback((event: KeyPressEvent): boolean => {
        if (Platform.OS === 'web' && event.key === 'Enter' && !event.shiftKey && agentInputEnterToSend) {
            if (canSend) {
                handleSend();
                return true;
            }
        }
        return false;
    }, [agentInputEnterToSend, canSend, handleSend]);

    // Auto-focus the text input when the composer mounts
    const composerInputRef = React.useRef<import('@/components/MultiTextInput').MultiTextInputHandle>(null);
    React.useEffect(() => {
        const timeout = setTimeout(() => {
            composerInputRef.current?.focus();
        }, 100);
        return () => clearTimeout(timeout);
    }, []);

    const composerNode = (
        <View style={styles.inputBox}>
            {canAttach && selectedImages.length > 0 && (
                <AgentInputAttachmentStrip
                    images={selectedImages}
                    onRemove={removeImage}
                />
            )}
            <View style={styles.inputField}>
                <PromptInput
                    ref={composerInputRef}
                    placeholder="What would you like to work on?"
                    onKeyPress={handleKeyPress}
                />
            </View>
            <View style={styles.actionButtonsContainer}>
                <View style={styles.actionButtonsLeft}>
                    {canAttach && (
                        <Pressable
                            onPress={pickImages}
                            hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                            style={(p) => [styles.attachButton, p.pressed && styles.sendButtonInnerPressed]}
                        >
                            <Ionicons
                                name="image-outline"
                                size={16}
                                color={selectedImages.length > 0
                                    ? theme.colors.radio.active
                                    : theme.colors.button.secondary.tint}
                            />
                        </Pressable>
                    )}
                </View>
                <View style={[
                    styles.sendButton,
                    isSpawning ? styles.sendButtonActive :
                    canSend ? styles.sendButtonActive : styles.sendButtonInactive,
                ]}>
                    <Pressable
                        style={(p) => [
                            styles.sendButtonInner,
                            p.pressed && styles.sendButtonInnerPressed,
                        ]}
                        hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                        disabled={!canSend}
                        onPress={() => handleSend()}
                    >
                        {isSpawning ? (
                            <ActivityIndicator
                                size="small"
                                color={theme.colors.button.primary.tint}
                            />
                        ) : (
                            <Octicons
                                name="arrow-up"
                                size={16}
                                color={theme.colors.button.primary.tint}
                                style={[
                                    styles.sendButtonIcon,
                                    { marginTop: Platform.OS === 'web' ? 2 : 0 },
                                ]}
                            />
                        )}
                    </Pressable>
                </View>
            </View>
        </View>
    );

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' && !sidebarLayout.showSidebar ? Constants.statusBarHeight + headerHeight : 0}
            style={styles.container}
        >
            {sidebarLayout.showSidebar ? (
                <View style={styles.desktopShell}>
                    {Platform.OS === 'web' && pickerOpen && (
                        <Pressable
                            style={styles.clickAwayBackdrop}
                            onPress={() => configPanelRef.current?.closePickers()}
                        />
                    )}
                    <View style={styles.desktopMain}>
                        <View style={styles.centeredComposerWrap}>
                            <View style={styles.desktopPromptCluster}>
                                <Text style={styles.desktopPromptTitle}>
                                    {t('newSession.title')}
                                </Text>
                                <View style={styles.composerWidthWrap}>
                                    {composerNode}
                                </View>
                            </View>
                        </View>
                    </View>
                    <View style={[styles.rightSidebar, { width: sidebarLayout.sidebarWidth }]}>
                        <ScrollView
                            style={styles.rightSidebarScroll}
                            contentContainerStyle={styles.rightSidebarContent}
                            keyboardShouldPersistTaps="handled"
                        >
                            <SessionConfigPanel
                                ref={configPanelRef}
                                layout="sidebar"
                                onPickerOpenChange={setPickerOpen}
                            />
                        </ScrollView>
                    </View>
                </View>
            ) : (
                <View style={styles.inner}>
                    <View style={styles.inlineConfigWrap}>
                        <SessionConfigPanel
                            ref={configPanelRef}
                            layout="inline"
                            onPickerOpenChange={setPickerOpen}
                        />
                    </View>

                    <View style={{ flex: 1 }} />

                    <View style={styles.inlineComposerWrap}>
                        {composerNode}
                    </View>

                    <View style={{ height: Math.max(16, safeArea.bottom) }} />
                </View>
            )}
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.header.background,
    },
    inner: {
        flex: 1,
    },
    desktopShell: {
        flex: 1,
        flexDirection: 'row',
        position: 'relative',
    },
    desktopMain: {
        flex: 1,
        minWidth: 0,
    },
    centeredComposerWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
    },
    desktopPromptCluster: {
        width: '100%',
        alignItems: 'center',
        gap: 32,
        transform: [{ translateY: -28 }],
    },
    desktopPromptTitle: {
        fontSize: 30,
        lineHeight: 36,
        color: theme.colors.text,
        textAlign: 'center',
        ...Typography.default(),
        ...Platform.select({ web: { userSelect: 'none' } as any, default: {} }),
    },
    composerWidthWrap: {
        maxWidth: layout.maxWidth,
        width: '100%',
    },
    rightSidebar: {
        flexShrink: 0,
        alignSelf: 'stretch',
        backgroundColor: theme.colors.groupped.background,
        borderLeftWidth: StyleSheet.hairlineWidth,
        borderLeftColor: theme.colors.divider,
        zIndex: 2,
    },
    rightSidebarScroll: {
        flex: 1,
    },
    rightSidebarContent: {
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 16,
        gap: 8,
    },
    inlineConfigWrap: {
        maxWidth: layout.maxWidth,
        width: '100%',
        alignSelf: 'center',
        paddingHorizontal: 12,
        gap: 8,
        paddingTop: 12,
    },
    inlineComposerWrap: {
        maxWidth: layout.maxWidth,
        width: '100%',
        alignSelf: 'center',
        paddingHorizontal: 12,
        gap: 8,
    },
    clickAwayBackdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1,
    },
    inputBox: {
        backgroundColor: theme.colors.input.background,
        borderRadius: Platform.select({ default: 16, android: 20 }),
        overflow: 'hidden',
        paddingVertical: 2,
        paddingBottom: 8,
        paddingHorizontal: 8,
    },
    inputField: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 8,
        paddingRight: 8,
        paddingVertical: 4,
        minHeight: 40,
    },
    actionButtonsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 0,
    },
    actionButtonsLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flex: 1,
        overflow: 'hidden',
    },
    attachButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: COMPOSER_SEND_BUTTON_SIZE,
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderRadius: Platform.select({ default: 16, android: 20 }),
    },
    sendButton: {
        width: COMPOSER_SEND_BUTTON_SIZE,
        height: COMPOSER_SEND_BUTTON_SIZE,
        borderRadius: COMPOSER_SEND_BUTTON_SIZE / 2,
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
        marginLeft: 8,
    },
    sendButtonActive: {
        backgroundColor: theme.colors.button.primary.background,
    },
    sendButtonInactive: {
        backgroundColor: theme.colors.button.primary.disabled,
    },
    sendButtonInner: {
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
    sendButtonInnerPressed: {
        opacity: 0.7,
    },
    sendButtonIcon: {
        color: theme.colors.button.primary.tint,
    },
}));

export default React.memo(NewSessionScreen);
