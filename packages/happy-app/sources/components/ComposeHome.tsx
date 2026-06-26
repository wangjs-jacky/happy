import * as React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Platform } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useRouter, useNavigation } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Header } from './navigation/Header';
import { AgentInputAttachmentStrip } from './AgentInputAttachmentStrip';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { Modal } from '@/modal';
import { useProfile, useAllMachines, useSetting } from '@/sync/storage';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { useSpawnSession } from '@/hooks/useSpawnSession';
import { useImagePicker } from '@/hooks/useImagePicker';
import { getDisplayName } from '@/sync/profile';
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
 * Compose-first home (phone). A greeting, the current machine/agent shown as a
 * chip, and a real text input. Sending spawns a session inline via useSpawnSession
 * for the straightforward case (machine online, no new worktree); for anything that
 * needs more setup — no machine selected, an offline machine, a fresh worktree, or
 * image attachments — it hands off to the full composer (/new) with the text
 * prefilled. The session list lives in the swipe drawer; settings sits top-left.
 */
export const ComposeHome = React.memo(() => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();
    const profile = useProfile();
    const machines = useAllMachines();
    const { sending, spawn } = useSpawnSession();
    const [text, setText] = React.useState('');

    const { agentType, selectedMachineId } = useNewSessionDraft(useShallow((s) => ({
        agentType: s.agentType,
        selectedMachineId: s.selectedMachineId,
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

    const openComposer = React.useCallback(() => {
        router.navigate('/new');
    }, [router]);

    // Hand off to the full composer with the typed text prefilled.
    const handoffToComposer = React.useCallback((prompt: string) => {
        useNewSessionDraft.getState().setInput(prompt);
        router.navigate('/new');
    }, [router]);

    const handleSend = React.useCallback(() => {
        const trimmed = text.trim();
        const images = hasImages ? selectedImages : undefined;
        if ((!trimmed && !images) || sending) return;

        const draft = useNewSessionDraft.getState();
        const machine = machines.find((m) => m.id === draft.selectedMachineId);

        // Inline-spawnable only when a machine is selected, online, and we're not
        // creating a fresh worktree. Otherwise hand off to /new for full setup.
        const canInline = !!draft.selectedMachineId
            && !!machine
            && isMachineOnline(machine)
            && draft.worktreeKey !== '__new__';

        if (!canInline) {
            // Attachments live in this component's picker state and can't ride the
            // navigation to /new (which has its own empty picker), so block rather
            // than silently drop them. Text-only handoff stays as before.
            if (images) {
                Modal.alert(t('common.error'), t('newSession.machineOffline'));
                return;
            }
            handoffToComposer(trimmed);
            return;
        }

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
    }, [text, sending, machines, spawn, handoffToComposer, hasImages, selectedImages, clearImages]);

    const canSend = (text.trim().length > 0 || hasImages) && !sending;

    const modelChip = (
        <Pressable onPress={openComposer} hitSlop={8} style={styles.modelChip}>
            <Text style={styles.modelChipAgent} numberOfLines={1}>{agentLabel}</Text>
            <View style={[styles.dot, { backgroundColor: online ? theme.colors.status.connected : theme.colors.status.disconnected }]} />
            <Text style={styles.modelChipMachine} numberOfLines={1}>
                {machineName ?? t('agentInput.noMachinesAvailable')}
            </Text>
            <Ionicons name="chevron-down" size={13} color={theme.colors.textSecondary} />
        </Pressable>
    );

    return (
        <View style={styles.container}>
            <Header
                title={modelChip}
                headerShadowVisible={false}
                headerTransparent={true}
                headerLeft={() => (
                    <Pressable onPress={openDrawer} hitSlop={12} style={styles.headerButton}>
                        <Ionicons name="menu-outline" size={26} color={theme.colors.header.tint} />
                    </Pressable>
                )}
                headerRight={() => (
                    <Pressable onPress={openSettings} hitSlop={12} style={styles.headerButton}>
                        <Ionicons name="settings-outline" size={23} color={theme.colors.header.tint} />
                    </Pressable>
                )}
            />

            <KeyboardAvoidingView
                style={styles.body}
                behavior="padding"
            >
                <View style={styles.greetWrap}>
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
                        <Pressable onPress={openComposer} hitSlop={8} style={styles.inputPlus}>
                            <Ionicons name="add" size={24} color={theme.colors.textSecondary} />
                        </Pressable>
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
    inputPlus: {
        width: 34,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
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
