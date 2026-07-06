import * as React from 'react';
import { View, Text, Pressable, LayoutAnimation, ScrollView } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useRouter, useNavigation, useLocalSearchParams } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Header } from './navigation/Header';
import { MessageComposer } from './MessageComposer';
import type { MultiTextInputHandle } from './MultiTextInput';
import { SessionConfigPanel, type SessionConfigPanelHandle } from './SessionConfigPanel';
import { ComposeHomeParticles } from './ComposeHomeParticles';
import { useHeaderHeight } from '@/utils/responsive';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { useProfile, useAllMachines, useSetting } from '@/sync/storage';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { useSpawnSession } from '@/hooks/useSpawnSession';
import { useImagePicker } from '@/hooks/useImagePicker';
import { getDisplayName, getAvatarUrl } from '@/sync/profile';
import { Avatar } from './Avatar';
import { RightSwipePanelHost } from './RightSwipePanelHost';
import { SessionCapabilityHub } from './rightPanel/SessionCapabilityHub';
import { isMachineOnline } from '@/utils/machineUtils';
import { resolveNewSessionModeSelection } from '@/utils/newSessionModeSelection';
import type { Machine } from '@/sync/storageTypes';
import { useShallow } from 'zustand/react/shallow';
import { hapticsLight } from './haptics';
import { buildImageAgentPrompt, getImageAgentStyleLabel, getImageAgentStylesForAgent, getImageAgentVariantCount, type ImageAgentStylePreset } from './agents/imageAgentPrompt';
import { IMAGE_STYLE_COMPOSE_ROUTE, resolveComposeImageAgent, setImageAgentStyles, toggleImageAgentStyle } from './agents/imageAgentMode';
import { ImageStyleGallerySheet } from './agents/ImageStyleGallerySheet';
import { createAppBuilderAgent } from './agents/builtinAgents';

// Agent display labels for the compose chip. Mirrors the list used in /new.
const AGENT_LABELS: Record<string, string> = {
    ask: 'ask',
    claude: 'claude code',
    codex: 'codex',
    opencode: 'opencode',
    openclaw: 'openclaw',
    gemini: 'gemini',
};

function getMachineName(machine: Machine | undefined): string | null {
    if (!machine) return null;
    return machine.metadata?.displayName || machine.metadata?.host || null;
}

/**
 * Compose-first new-session page. A greeting, the current machine/agent shown as
 * a chip (tap to drop the inline config panel), and a real text input. Sending
 * spawns a session inline via useSpawnSession. It only spawns when the target is
 * actually reachable — a selected, online machine and no fresh-worktree request;
 * otherwise the send button stays disabled (greyed) rather than bouncing
 * elsewhere. Creating a new worktree / spawning on an offline machine is not
 * supported here.
 *
 * Two variants:
 *  - 'home'   (default): the phone home. Header shows the drawer hamburger (session
 *             list) on the left and the settings avatar on the right.
 *  - 'screen': pushed as the `/new` route (tablet empty state, command palette,
 *             home header "+", …). Header shows a back button and drops the avatar.
 */
type ComposeHomeProps = {
    variant?: 'home' | 'screen';
};

export const ComposeHome = React.memo(({ variant = 'home' }: ComposeHomeProps) => {
    const isScreen = variant === 'screen';
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();
    const headerHeight = useHeaderHeight();
    const profile = useProfile();
    const machines = useAllMachines();
    const agentDefaultOverrides = useSetting('agentDefaultOverrides');
    const { sending, spawn } = useSpawnSession();
    const [text, setText] = React.useState('');
    const [imageGalleryOpen, setImageGalleryOpen] = React.useState(false);
    const [selectedImageStyleIds, setSelectedImageStyleIds] = React.useState<string[]>([]);
    const composerInputRef = React.useRef<MultiTextInputHandle>(null);
    const configPanelRef = React.useRef<SessionConfigPanelHandle>(null);

    // 当从「我的 Agent」启动器进入时，路由带 ?agentId=<id>。据此查出对应 Agent，
    // 用于显示个性化问候 + 预设提示词；查不到（或无该参数）时一切退化为默认行为。
    const { agentId, mode } = useLocalSearchParams<{ agentId?: string; mode?: string }>();
    const agents = useSetting('agents');
    const activeAgent = React.useMemo(
        () => (agentId ? agents.find((a) => a.id === agentId) ?? null : null),
        [agentId, agents],
    );
    const imageAgent = React.useMemo(
        () => resolveComposeImageAgent({ routeMode: mode, agent: activeAgent }),
        [activeAgent, mode],
    );
    const effectiveImageAgent = React.useMemo(
        () => (imageAgent ? setImageAgentStyles(imageAgent, selectedImageStyleIds) : null),
        [imageAgent, selectedImageStyleIds],
    );
    const activeImageAgent = !!imageAgent;
    const galleryImageStyles = React.useMemo(
        () => (imageAgent ? getImageAgentStylesForAgent(imageAgent) : []),
        [imageAgent],
    );
    const activeImageStyles = React.useMemo(
        () => (effectiveImageAgent && selectedImageStyleIds.length > 0
            ? getImageAgentStylesForAgent(effectiveImageAgent)
            : []),
        [effectiveImageAgent, selectedImageStyleIds.length],
    );
    const activeImageVariants = effectiveImageAgent ? getImageAgentVariantCount(effectiveImageAgent) : 1;
    const imageEffectTitle = React.useMemo(() => {
        if (activeImageStyles.length === 1) {
            return getImageAgentStyleLabel(activeImageStyles[0]);
        }
        if (activeImageStyles.length > 1) {
            return t('agents.imageAgentSummary', { count: activeImageStyles.length, variants: activeImageVariants });
        }
        return t('agents.imageEffectChoose');
    }, [activeImageStyles, activeImageVariants]);

    React.useEffect(() => {
        const initialStyleIds = activeAgent?.kind === 'image-styles' && imageAgent
            ? getImageAgentStylesForAgent(imageAgent).map((style) => style.id)
            : [];
        setSelectedImageStyleIds(initialStyleIds);
        setImageGalleryOpen(false);
    }, [activeAgent?.id, imageAgent?.id, imageAgent?.imageStyleIds]);

    // 预设提示词「填充」走 MessageComposer 转发出来的命令式 ref：输入框是非受控的
    // （MultiTextInput 用 defaultValue 播种），setText 只改父级状态、看不见。调用
    // setTextAndSelection 才会真正改写原生输入框，并回调 onChangeText 同步父级 text
    // 与发送按钮的 hasText 状态。随后 focus 让光标落到末尾，但不自动发送。
    const fillPreset = React.useCallback((prompt: string) => {
        hapticsLight();
        const len = prompt.length;
        composerInputRef.current?.setTextAndSelection(prompt, { start: len, end: len });
        composerInputRef.current?.focus();
    }, []);

    const { agentType, selectedMachineId, worktreeKey, setAgentType } = useNewSessionDraft(useShallow((s) => ({
        agentType: s.agentType,
        selectedMachineId: s.selectedMachineId,
        worktreeKey: s.worktreeKey,
        setAgentType: s.setAgentType,
    })));
    const selectedPath = useNewSessionDraft(s => s.selectedPath);

    React.useEffect(() => {
        if (activeImageAgent && agentType !== 'codex') {
            setAgentType('codex');
        }
    }, [activeImageAgent, agentType, setAgentType]);

    // Inline image attachments (claude / codex). 图片上传已转正：Claude、Codex 会话默认
    // 显示图片按钮，不再依赖实验开关。两者的 runner 都会把附件转发给模型（见 sync.ts
    // supportsAttachments），其余 runner（gemini / openclaw）会静默丢弃，故不显示。
    // compact horizontal strip keeps the footprint to one row.
    const canAttach = activeImageAgent || agentType === 'claude' || agentType === 'codex';
    const { selectedImages, pickImages, removeImage, clearImages, addImages } = useImagePicker();
    const hasImages = canAttach && selectedImages.length > 0;

    const name = getDisplayName(profile);
    const selectedMachine = React.useMemo(
        () => machines.find((m) => m.id === selectedMachineId),
        [machines, selectedMachineId],
    );
    const builtinAppAgent = React.useMemo(() => createAppBuilderAgent({
        machines,
        preferredMachineId: selectedMachineId,
        preferredPath: selectedPath,
        title: t('agents.appBuilderTitle'),
        presetBuildLabel: t('agents.appBuilderPresetBuild'),
        presetBugfixLabel: t('agents.appBuilderPresetBugfix'),
    }), [machines, selectedMachineId, selectedPath]);
    const displayAgent = React.useMemo(() => {
        if (!agentId) return null;
        return agents.find((a) => a.id === agentId) ?? (builtinAppAgent?.id === agentId ? builtinAppAgent : null);
    }, [agentId, agents, builtinAppAgent]);
    const machineName = getMachineName(selectedMachine);
    const online = selectedMachine ? isMachineOnline(selectedMachine) : false;
    const displayAgentType = activeImageAgent ? 'codex' : agentType;
    const agentLabel = AGENT_LABELS[displayAgentType] ?? displayAgentType;

    const openDrawer = React.useCallback(() => {
        navigation.dispatch(DrawerActions.openDrawer());
    }, [navigation]);

    const openSettings = React.useCallback(() => {
        router.push('/settings');
    }, [router]);

    const goBack = React.useCallback(() => {
        router.back();
    }, [router]);

    const openImageStyleMode = React.useCallback(() => {
        hapticsLight();
        router.push(IMAGE_STYLE_COMPOSE_ROUTE as any);
    }, [router]);

    const openImageStyleGallery = React.useCallback(() => {
        hapticsLight();
        setImageGalleryOpen(true);
    }, []);

    const closeImageStyleGallery = React.useCallback(() => {
        setImageGalleryOpen(false);
    }, []);

    const toggleImageStyleFromGallery = React.useCallback((style: ImageAgentStylePreset) => {
        hapticsLight();
        setSelectedImageStyleIds((current) => (
            toggleImageAgentStyle(setImageAgentStyles(imageAgent!, current), style.id).imageStyleIds
        ));
    }, [imageAgent]);

    // The machine/agent chip drops the full session-config panel down in place
    // (instead of navigating to /new). Tapping the chip again — or anywhere
    // outside — collapses it. The panel writes straight to the shared draft
    // store, so the chip label and the inline-spawn config stay in sync.
    const [panelOpen, setPanelOpen] = React.useState(false);
    const togglePanel = React.useCallback(() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setPanelOpen(v => !v);
    }, []);
    const closePanel = React.useCallback(() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setPanelOpen(false);
    }, []);

    const handleSend = React.useCallback(() => {
        const trimmed = text.trim();
        const images = hasImages ? selectedImages : undefined;
        if ((!trimmed && !images) || sending) return;
        if (activeImageAgent && (!effectiveImageAgent || activeImageStyles.length === 0)) return;
        const prompt = activeImageAgent && effectiveImageAgent
            ? buildImageAgentPrompt({
                agent: effectiveImageAgent,
                userPrompt: trimmed,
                imageCount: images?.length ?? 0,
            })
            : trimmed;

        const draft = useNewSessionDraft.getState();
        const liveSelection = configPanelRef.current?.getSelection();
        const machine = machines.find((m) => m.id === draft.selectedMachineId);
        const spawnAgent = activeImageAgent ? 'codex' : draft.agentType;
        const resolvedModes = resolveNewSessionModeSelection({
            agent: spawnAgent,
            permissionMode: draft.permissionMode,
            modelMode: draft.modelMode,
            effortLevel: draft.effortLevel,
            agentDefaultOverrides,
        });

        // Spawnable only when a machine is selected, online, and we're not asked to
        // create a fresh worktree. The send button is disabled in every other case
        // (see `canSpawn` below), so this is just a safety guard.
        const canSpawn = !!draft.selectedMachineId
            && !!machine
            && isMachineOnline(machine)
            && draft.worktreeKey !== '__new__';
        if (!canSpawn) return;

        // Clear the input only once a session was actually created, so the prompt
        // and attachments aren't lost if spawning fails or directory creation is declined.
        spawn({
            machineId: draft.selectedMachineId!,
            machine: machine!,
            path: draft.selectedPath,
            agent: spawnAgent,
            worktreeKey: draft.worktreeKey,
            permissionMode: liveSelection?.permissionKey ?? resolvedModes.permissionMode,
            modelMode: liveSelection?.modelKey ?? resolvedModes.modelMode,
            effortLevel: liveSelection?.effortKey ?? resolvedModes.effortLevel,
            prompt,
            images,
        }).then((ok) => {
            if (ok) {
                composerInputRef.current?.setTextAndSelection('', { start: 0, end: 0 });
                setText('');
                clearImages();
            }
        });
    }, [activeImageAgent, effectiveImageAgent, activeImageStyles.length, agentDefaultOverrides, text, sending, machines, spawn, hasImages, selectedImages, clearImages]);

    // The send target must be reachable: an online machine and no fresh-worktree
    // request. When it isn't, MessageComposer's send button greys out (via
    // isSendDisabled) instead of letting a doomed spawn through.
    const canSpawn = online && worktreeKey !== '__new__';
    const canSubmit = canSpawn && (!activeImageAgent || activeImageStyles.length > 0);

    const modelChip = (
        <Pressable onPress={togglePanel} hitSlop={8} style={styles.modelChip}>
            <Text style={styles.modelChipAgent} numberOfLines={1}>{agentLabel}</Text>
            <View style={[styles.dot, { backgroundColor: online ? theme.colors.status.connected : theme.colors.status.disconnected }]} />
            <Text style={styles.modelChipMachine} numberOfLines={1}>
                {machineName ?? t('agentInput.noMachinesAvailable')}
            </Text>
            <Ionicons name={panelOpen ? 'chevron-up' : 'chevron-down'} size={13} color={theme.colors.textSecondary} />
        </Pressable>
    );

    return (
        <RightSwipePanelHost panelContent={<SessionCapabilityHub />}>
            <View style={styles.container}>
            <Header
                title={modelChip}
                headerShadowVisible={false}
                headerTransparent={true}
                headerLeft={() => (
                    isScreen ? (
                        <Pressable onPress={goBack} hitSlop={12} style={styles.headerButton}>
                            <Ionicons name="chevron-back" size={28} color={theme.colors.header.tint} />
                        </Pressable>
                    ) : (
                        <Pressable onPress={openDrawer} hitSlop={12} style={styles.headerButton}>
                            <Ionicons name="menu-outline" size={26} color={theme.colors.header.tint} />
                        </Pressable>
                    )
                )}
                headerRight={isScreen ? undefined : () => (
                    <Pressable onPress={openSettings} hitSlop={12} style={styles.headerButton}>
                        <Avatar
                            id={profile.id}
                            size={28}
                            imageUrl={getAvatarUrl(profile)}
                            thumbhash={profile.avatar?.thumbhash}
                        />
                    </Pressable>
                )}
            />

            <KeyboardAvoidingView
                style={styles.body}
                behavior="padding"
            >
                <View style={styles.greetWrap}>
                    <ComposeHomeParticles mode={theme.dark ? 'dark' : 'light'} />
                    <Text style={styles.greeting}>
                        {displayAgent
                            ? t('composeHome.greetingAgent', { name: displayAgent.name })
                            : activeImageAgent
                                ? t('composeHome.greetingAgent', { name: t('agents.imageStyleAgent') })
                                : name
                                    ? t('composeHome.greeting', { name })
                                    : t('composeHome.greetingNoName')}
                    </Text>
                </View>

                <View style={[styles.composer, { paddingBottom: insets.bottom + 12 }]}>
                    {activeImageAgent && (
                        <View style={styles.imageAgentPanel}>
                            <View style={styles.imageAgentHeader}>
                                <Ionicons
                                    name={sending ? 'lock-closed-outline' : 'sparkles-outline'}
                                    size={18}
                                    color={theme.colors.accent}
                                />
                                <View style={styles.imageAgentCopy}>
                                    <Text style={styles.imageAgentTitle} numberOfLines={1}>
                                        {sending ? t('agents.imageAgentLocked') : t('agents.imageAgentReady')}
                                    </Text>
                                    <Text style={styles.imageAgentSubtitle} numberOfLines={1}>
                                        {t('agents.imageAgentSummary', { count: activeImageStyles.length, variants: activeImageVariants })}
                                    </Text>
                                </View>
                            </View>
                            {!hasImages && (
                                <Pressable
                                    onPress={pickImages}
                                    style={({ pressed }) => [
                                        styles.imageUploadAction,
                                        pressed && styles.imageUploadActionPressed,
                                    ]}
                                    hitSlop={6}
                                >
                                    <View style={styles.imageUploadIcon}>
                                        <Ionicons name="add" size={22} color={theme.colors.text} />
                                    </View>
                                    <View style={styles.imageUploadCopy}>
                                        <Text style={styles.imageUploadTitle} numberOfLines={1}>
                                            {t('agents.imageUploadCta')}
                                        </Text>
                                        <Text style={styles.imageUploadSubtitle} numberOfLines={1}>
                                            {t('agents.imageUploadHint')}
                                        </Text>
                                    </View>
                                    <Ionicons name="images-outline" size={18} color={theme.colors.textSecondary} />
                                </Pressable>
                            )}
                            <Pressable
                                onPress={openImageStyleGallery}
                                style={({ pressed }) => [
                                    styles.imageEffectAction,
                                    pressed && styles.imageEffectActionPressed,
                                ]}
                                hitSlop={6}
                            >
                                <View style={styles.imageEffectIcon}>
                                    <Ionicons name="color-filter-outline" size={18} color={theme.colors.text} />
                                </View>
                                <View style={styles.imageEffectCopy}>
                                    <Text style={styles.imageEffectTitle} numberOfLines={1}>
                                        {imageEffectTitle}
                                    </Text>
                                    <Text style={styles.imageEffectSubtitle} numberOfLines={1}>
                                        {t('agents.imageEffectChooseHint')}
                                    </Text>
                                </View>
                                <Ionicons name="chevron-up" size={17} color={theme.colors.textSecondary} />
                            </Pressable>
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.imageStyleRow}
                                keyboardShouldPersistTaps="always"
                            >
                                {activeImageStyles.map((style) => (
                                    <Pressable
                                        key={style.id}
                                        onPress={openImageStyleGallery}
                                        style={({ pressed }) => [
                                            styles.imageStyleChip,
                                            pressed && styles.imageStyleChipPressed,
                                        ]}
                                        hitSlop={6}
                                    >
                                        <Text style={styles.imageStyleChipText} numberOfLines={1}>
                                            {getImageAgentStyleLabel(style)}
                                        </Text>
                                    </Pressable>
                                ))}
                            </ScrollView>
                        </View>
                    )}
                    {!activeImageAgent && (
                        <View style={styles.creationRail}>
                            <Pressable
                                onPress={openImageStyleMode}
                                style={({ pressed }) => [
                                    styles.creationAction,
                                    pressed && styles.creationActionPressed,
                                ]}
                                hitSlop={6}
                            >
                                <View style={styles.creationActionIcon}>
                                    <Ionicons name="sparkles-outline" size={17} color={theme.colors.text} />
                                </View>
                                <View style={styles.creationActionCopy}>
                                    <Text style={styles.creationActionTitle} numberOfLines={1}>
                                        {t('agents.imageCreationAction')}
                                    </Text>
                                    <Text style={styles.creationActionSubtitle} numberOfLines={1}>
                                        {t('agents.imageCreationActionSubtitle')}
                                    </Text>
                                </View>
                            </Pressable>
                        </View>
                    )}
                    {displayAgent && displayAgent.presets.length > 0 && (
                        <View style={styles.presetRow}>
                            {displayAgent.presets.map((preset, i) => (
                                <Pressable
                                    key={`${preset.label}-${i}`}
                                    onPress={() => fillPreset(preset.prompt)}
                                    style={styles.presetChip}
                                    hitSlop={6}
                                >
                                    <Text style={styles.presetChipText} numberOfLines={1}>{preset.label}</Text>
                                </Pressable>
                            ))}
                        </View>
                    )}
                    <MessageComposer
                        ref={composerInputRef}
                        mode="home"
                        placeholder={activeImageAgent ? t('agents.imagePromptPlaceholder') : t('composeHome.placeholder')}
                        initialValue={text}
                        onChangeText={setText}
                        onSend={handleSend}
                        isSending={sending}
                        isSendDisabled={!canSubmit}
                        selectedImages={hasImages ? selectedImages : undefined}
                        onPickImages={canAttach ? pickImages : undefined}
                        onRemoveImage={canAttach ? removeImage : undefined}
                        onAddImages={canAttach ? addImages : undefined}
                    />
                    <Text style={styles.byline}>{t('composeHome.byline')}</Text>
                </View>
            </KeyboardAvoidingView>

            {/* In-place config dropdown anchored under the header chip. The
                backdrop starts below the header so the chip itself stays tappable
                (tap again to collapse); tapping anywhere else dismisses it. */}
            {panelOpen && (
                <>
                    <Pressable
                        style={[styles.panelBackdrop, { top: insets.top + headerHeight }]}
                        onPress={closePanel}
                    />
                    <View style={[styles.panelDropdown, { top: insets.top + headerHeight }]}>
                        <SessionConfigPanel ref={configPanelRef} layout="inline" collapsible={false} />
                    </View>
                </>
            )}
            {activeImageAgent && (
                <ImageStyleGallerySheet
                    visible={imageGalleryOpen}
                    styles={galleryImageStyles}
                    selectedStyleIds={selectedImageStyleIds}
                    onToggle={toggleImageStyleFromGallery}
                    onClose={closeImageStyleGallery}
                />
            )}
            </View>
        </RightSwipePanelHost>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    headerButton: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
    },
    panelBackdrop: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
    },
    panelDropdown: {
        position: 'absolute',
        left: 0,
        right: 0,
        paddingHorizontal: 12,
        paddingTop: 8,
        zIndex: 11,
    },
    modelChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        maxWidth: 230,
        paddingVertical: 7,
        paddingHorizontal: 13,
        borderRadius: 999,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    modelChipAgent: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.text,
        flexShrink: 1,
    },
    modelChipMachine: {
        ...Typography.mono(),
        fontSize: 11,
        color: theme.colors.textSecondary,
        flexShrink: 1,
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    body: {
        flex: 1,
    },
    greetWrap: {
        flex: 1,
        justifyContent: 'flex-start',
        paddingHorizontal: 26,
        paddingTop: 28,
    },
    greeting: {
        ...Typography.display('semiBold'),
        fontSize: 26,
        lineHeight: 34,
        color: theme.colors.text,
        maxWidth: 360,
    },
    composer: {
        paddingHorizontal: 14,
        paddingTop: 8,
    },
    imageAgentPanel: {
        backgroundColor: theme.colors.surface,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        padding: 10,
        gap: 8,
        marginBottom: 10,
    },
    imageAgentHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    imageAgentCopy: {
        flex: 1,
    },
    imageAgentTitle: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
    },
    imageAgentSubtitle: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 1,
    },
    imageUploadAction: {
        minHeight: 58,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 9,
        paddingHorizontal: 10,
        borderRadius: 12,
        backgroundColor: theme.colors.surfacePressed,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    imageUploadActionPressed: {
        opacity: 0.78,
    },
    imageUploadIcon: {
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
    },
    imageUploadCopy: {
        flex: 1,
    },
    imageUploadTitle: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
    },
    imageUploadSubtitle: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    imageEffectAction: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 12,
        backgroundColor: theme.colors.surfacePressed,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    imageEffectActionPressed: {
        opacity: 0.78,
    },
    imageEffectIcon: {
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
    },
    imageEffectCopy: {
        flex: 1,
    },
    imageEffectTitle: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
    },
    imageEffectSubtitle: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 1,
    },
    imageStyleRow: {
        gap: 6,
        paddingRight: 8,
    },
    imageStyleChip: {
        maxWidth: 180,
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfacePressed,
    },
    imageStyleChipPressed: {
        opacity: 0.75,
    },
    imageStyleChipText: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        color: theme.colors.text,
    },
    creationRail: {
        flexDirection: 'row',
        paddingHorizontal: 4,
        paddingBottom: 10,
    },
    creationAction: {
        minHeight: 46,
        maxWidth: 220,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        paddingVertical: 8,
        paddingLeft: 9,
        paddingRight: 14,
        borderRadius: 23,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    creationActionPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    creationActionIcon: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfacePressed,
    },
    creationActionCopy: {
        flexShrink: 1,
    },
    creationActionTitle: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
    },
    creationActionSubtitle: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 1,
    },
    presetRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        paddingHorizontal: 4,
        paddingBottom: 10,
    },
    presetChip: {
        maxWidth: 240,
        paddingVertical: 7,
        paddingHorizontal: 13,
        borderRadius: 999,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    presetChipText: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.text,
    },
    byline: {
        ...Typography.default(),
        textAlign: 'center',
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 9,
    },
}));
