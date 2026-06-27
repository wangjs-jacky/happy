import * as React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Platform, LayoutAnimation } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useRouter, useNavigation } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Header } from './navigation/Header';
import { AgentInputAttachmentStrip } from './AgentInputAttachmentStrip';
import { SessionConfigPanel } from './SessionConfigPanel';
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
import { isMachineOnline } from '@/utils/machineUtils';
import type { Machine } from '@/sync/storageTypes';
import { useShallow } from 'zustand/react/shallow';

// Agent display labels for the compose chip. Mirrors the list used in /new.
const AGENT_LABELS: Record<string, string> = {
    claude: 'claude code',
    codex: 'codex',
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
    const { sending, spawn } = useSpawnSession();
    const [text, setText] = React.useState('');

    const { agentType, selectedMachineId, worktreeKey } = useNewSessionDraft(useShallow((s) => ({
        agentType: s.agentType,
        selectedMachineId: s.selectedMachineId,
        worktreeKey: s.worktreeKey,
    })));

    // Inline image attachments (claude-only, behind the expImageUpload flag) — same
    // gating and picker as /new, so the home can attach without bouncing to the
    // full composer. The compact horizontal strip keeps the footprint to one row.
    const expImageUpload = useSetting('expImageUpload');
    const canAttach = expImageUpload && agentType === 'claude';
    const { selectedImages, pickImages, removeImage, clearImages } = useImagePicker();
    const hasImages = canAttach && selectedImages.length > 0;

    const name = getDisplayName(profile);
    const selectedMachine = React.useMemo(
        () => machines.find((m) => m.id === selectedMachineId),
        [machines, selectedMachineId],
    );
    const machineName = getMachineName(selectedMachine);
    const online = selectedMachine ? isMachineOnline(selectedMachine) : false;
    const agentLabel = AGENT_LABELS[agentType] ?? agentType;

    const openDrawer = React.useCallback(() => {
        navigation.dispatch(DrawerActions.openDrawer());
    }, [navigation]);

    const openSettings = React.useCallback(() => {
        router.push('/settings');
    }, [router]);

    const goBack = React.useCallback(() => {
        router.back();
    }, [router]);

    // The machine/agent chip drops the full session-config panel down in place.
    // Tapping the chip again — or anywhere
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

        const draft = useNewSessionDraft.getState();
        const machine = machines.find((m) => m.id === draft.selectedMachineId);

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
            agent: draft.agentType,
            worktreeKey: draft.worktreeKey,
            prompt: trimmed,
            images,
        }).then((ok) => {
            if (ok) {
                setText('');
                clearImages();
            }
        });
    }, [text, sending, machines, spawn, hasImages, selectedImages, clearImages]);

    // The send target must be reachable: an online machine and no fresh-worktree
    // request. When it isn't, the button greys out instead of navigating away.
    const canSpawn = online && worktreeKey !== '__new__';
    const canSend = (text.trim().length > 0 || hasImages) && !sending && canSpawn;

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
                        {name
                            ? t('composeHome.greeting', { name })
                            : t('composeHome.greetingNoName')}
                    </Text>
                </View>

                <View style={[styles.composer, { paddingBottom: insets.bottom + 12 }]}>
                    {hasImages && (
                        <AgentInputAttachmentStrip
                            images={selectedImages}
                            onRemove={removeImage}
                        />
                    )}
                    <View style={styles.inputPill}>
                        {canAttach && (
                            <Pressable onPress={pickImages} hitSlop={8} style={styles.inputImage}>
                                <Ionicons
                                    name="image-outline"
                                    size={20}
                                    color={selectedImages.length > 0
                                        ? theme.colors.radio.active
                                        : theme.colors.textSecondary}
                                />
                            </Pressable>
                        )}
                        <TextInput
                            style={styles.input}
                            value={text}
                            onChangeText={setText}
                            placeholder={t('composeHome.placeholder')}
                            placeholderTextColor={theme.colors.input.placeholder}
                            multiline
                            maxLength={100000}
                        />
                        <Pressable
                            onPress={handleSend}
                            disabled={!canSend}
                            style={[styles.sendButton, { opacity: canSend ? 1 : 0.4 }]}
                        >
                            {sending
                                ? <ActivityIndicator size="small" color={theme.colors.fab.icon} />
                                : <Ionicons name="arrow-up" size={20} color={theme.colors.fab.icon} />}
                        </Pressable>
                    </View>
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
                        <SessionConfigPanel layout="inline" collapsible={false} />
                    </View>
                </>
            )}
        </View>
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
        ...Typography.default('semiBold'),
        fontSize: 25,
        lineHeight: 34,
        color: theme.colors.text,
        maxWidth: 360,
    },
    composer: {
        paddingHorizontal: 14,
        paddingTop: 8,
    },
    inputPill: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        backgroundColor: theme.colors.input.background,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        borderRadius: 24,
        paddingLeft: 8,
        paddingRight: 8,
        paddingVertical: 7,
        minHeight: 52,
    },
    inputImage: {
        width: 34,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
    },
    input: {
        flex: 1,
        ...Typography.default(),
        fontSize: 15.5,
        lineHeight: 21,
        color: theme.colors.input.text,
        paddingTop: Platform.OS === 'ios' ? 9 : 6,
        paddingBottom: Platform.OS === 'ios' ? 9 : 6,
        maxHeight: 140,
    },
    sendButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: theme.colors.fab.background,
        alignItems: 'center',
        justifyContent: 'center',
    },
    byline: {
        ...Typography.default(),
        textAlign: 'center',
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 9,
    },
}));
