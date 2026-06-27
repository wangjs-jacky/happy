import * as React from 'react';
import { View, Text, Pressable, Platform, Image as RNImage } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { Session } from '@/sync/storageTypes';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import {
    getAvailableModels,
    getAvailablePermissionModes,
    getEffortLevelsForModel,
    resolveCurrentOption,
} from '@/components/modelModeOptions';
import { resolveAgentDefaultConfig } from '@/sync/agentDefaults';
import { storage, useSetting } from '@/sync/storage';
import { t } from '@/text';

// Agent icon assets — mirrors SessionConfigPanel so the panel reads identically.
const agentIcons = {
    claude: require('@/assets/images/icon-claude.png'),
    codex: require('@/assets/images/icon-gpt.png'),
    openclaw: require('@/assets/images/icon-openclaw.png'),
    gemini: require('@/assets/images/icon-gemini.png'),
} as const;

const AGENT_LABELS: Record<string, string> = {
    claude: 'claude code',
    codex: 'codex',
    openclaw: 'openclaw',
    gemini: 'gemini',
};

type AgentKey = keyof typeof agentIcons;

// Permission glyph, matching SessionConfigPanel's getPermissionStyle.
function permissionIcon(key: string | undefined): 'play-forward' | 'pause' | 'shield-outline' {
    switch (key) {
        case 'acceptEdits':
        case 'auto_edit':
        case 'dontAsk':
        case 'safe-yolo':
        case 'bypassPermissions':
        case 'yolo':
            return 'play-forward';
        case 'plan':
        case 'read-only':
            return 'pause';
        default:
            return 'shield-outline';
    }
}

/**
 * Session config panel that drops down under the chat header when the
 * SessionHeaderChip is tapped. Visually mirrors the particle home's inline
 * SessionConfigPanel (machine / folder / agent·model·effort / permission) and
 * reflects the *running* session's metadata.
 *
 * Editability splits by what the running CLI process can actually change mid-
 * session: permission / model / effort are per-turn meta (happy-cli re-reads
 * them from each outgoing message), so those rows are tappable and expand an
 * inline option list — the pick takes effect on the *next* turn. machine /
 * folder / agent are baked into the spawned process and can't change without a
 * new session, so they stay read-only. Each editable row only becomes tappable
 * when it actually has more than one option to choose from.
 *
 * A "Session details" row at the bottom links into the full info screen.
 * Renders its own full-screen backdrop so a tap anywhere outside collapses it.
 */
interface SessionInfoDropdownProps {
    session: Session;
    machineName: string | null;
    online: boolean;
    /** Y offset where the panel/backdrop begin (header bottom = safeArea.top + headerHeight). */
    top: number;
    onClose: () => void;
    onViewDetails: () => void;
}

export const SessionInfoDropdown = React.memo(({ session, machineName, online, top, onClose, onViewDetails }: SessionInfoDropdownProps) => {
    const { theme } = useUnistyles();
    const metadata = session.metadata;
    const flavor = metadata?.flavor ?? undefined;
    const agentKey: AgentKey = (flavor && flavor in agentIcons ? flavor : 'claude') as AgentKey;
    const agentLabel = AGENT_LABELS[agentKey] ?? agentKey;
    const pathName = metadata?.path ? formatPathRelativeToHome(metadata.path, metadata.homeDir) : null;

    // Resolve the session's current model / permission / effort display names the
    // same way SessionViewLoaded does, so the panel matches the chat's selectors.
    const agentDefaultOverrides = useSetting('agentDefaultOverrides');
    const effectiveAgentDefaults = React.useMemo(() => resolveAgentDefaultConfig(agentDefaultOverrides, flavor), [agentDefaultOverrides, flavor]);

    const availableModels = React.useMemo(() => getAvailableModels(flavor, metadata, t), [flavor, metadata]);
    const availableModes = React.useMemo(() => getAvailablePermissionModes(flavor, metadata, t), [flavor, metadata]);

    const permissionMode = React.useMemo(() => resolveCurrentOption(availableModes, [
        session.permissionMode,
        effectiveAgentDefaults.permissionMode,
        metadata?.currentOperatingModeCode,
    ]), [availableModes, session.permissionMode, effectiveAgentDefaults.permissionMode, metadata?.currentOperatingModeCode]);

    const modelMode = React.useMemo(() => resolveCurrentOption(availableModels, [
        session.modelMode,
        effectiveAgentDefaults.modelMode,
        metadata?.currentModelCode,
    ]), [availableModels, session.modelMode, effectiveAgentDefaults.modelMode, metadata?.currentModelCode]);

    const modelKey = modelMode?.key ?? 'default';
    const availableEffortLevels = React.useMemo(() => getEffortLevelsForModel(flavor, modelKey), [flavor, modelKey]);
    const effortLevel = React.useMemo(() => resolveCurrentOption(availableEffortLevels, [
        session.effortLevel,
        effectiveAgentDefaults.effortLevel,
    ]), [availableEffortLevels, session.effortLevel, effectiveAgentDefaults.effortLevel]);

    // Only the rows with a real choice (>1 option) become tappable; otherwise
    // there's nothing to switch to and they stay read-only.
    const canEditPermission = availableModes.length > 1;
    const canEditModel = availableModels.length > 1;
    const canEditEffort = availableEffortLevels.length > 1;

    // Which editable row is currently expanded into its option list (one at a time).
    const [expanded, setExpanded] = React.useState<'permission' | 'model' | 'effort' | null>(null);
    const toggle = React.useCallback((row: 'permission' | 'model' | 'effort') => {
        setExpanded((cur) => (cur === row ? null : row));
    }, []);

    // Apply a pick to the running session. happy-cli attaches the updated value
    // to the next outgoing message's meta, so the change lands on the next turn.
    const applyPermission = React.useCallback((key: string) => {
        storage.getState().updateSessionPermissionMode(session.id, key);
        setExpanded(null);
    }, [session.id]);
    const applyModel = React.useCallback((key: string) => {
        storage.getState().updateSessionModelMode(session.id, key);
        setExpanded(null);
    }, [session.id]);
    const applyEffort = React.useCallback((key: string) => {
        storage.getState().updateSessionEffortLevel(session.id, key);
        setExpanded(null);
    }, [session.id]);

    // Inline option list shown under an expanded editable row.
    const renderOptions = (
        options: { key: string; name: string }[],
        currentKey: string | undefined,
        onSelect: (key: string) => void,
    ) => (
        <View style={styles.optionList}>
            {options.map((opt) => {
                const isSelected = opt.key === currentKey;
                return (
                    <Pressable
                        key={opt.key}
                        style={(p) => [styles.optionRow, p.pressed && styles.rowPressed]}
                        onPress={() => onSelect(opt.key)}
                    >
                        <Ionicons
                            name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                            size={15}
                            color={isSelected ? theme.colors.text : theme.colors.textSecondary}
                        />
                        <Text
                            style={[styles.configLabel, styles.configValueText, !isSelected && { color: theme.colors.textSecondary }]}
                            numberOfLines={1}
                        >
                            {opt.name}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );

    return (
        <>
            <Pressable style={[styles.backdrop, { top }]} onPress={onClose} />
            <View style={[styles.dropdown, { top }]}>
                <View style={styles.configBox}>
                    {/* Machine */}
                    <View style={styles.configRow}>
                        <Ionicons name="desktop-outline" size={15} color={theme.colors.textSecondary} />
                        <Text style={[styles.configLabel, styles.configValueText]} numberOfLines={1}>
                            {machineName ?? t('agentInput.noMachinesAvailable')}
                        </Text>
                        <View style={[styles.dot, { backgroundColor: online ? theme.colors.status.connected : theme.colors.status.disconnected }]} />
                    </View>

                    {/* Folder */}
                    {pathName ? (
                        <View style={styles.configRow}>
                            <Ionicons name="folder-outline" size={15} color={theme.colors.textSecondary} />
                            <Text style={[styles.configLabel, styles.configValueText]} numberOfLines={1}>
                                {pathName}
                            </Text>
                        </View>
                    ) : null}

                    {/* Agent (read-only) · Model · Effort. Model/effort tap to expand. */}
                    <View style={styles.configRow}>
                        <View style={styles.configInlineField}>
                            <RNImage
                                source={agentIcons[agentKey]}
                                style={[styles.agentIcon, { tintColor: theme.colors.textSecondary }]}
                                resizeMode="contain"
                            />
                            <Text style={[styles.configLabel, styles.configInlineText]} numberOfLines={1}>
                                {agentLabel}
                            </Text>
                        </View>
                        {modelMode?.name ? (
                            <>
                                <Text style={[styles.configLabel, { color: theme.colors.textSecondary }]}>·</Text>
                                {canEditModel ? (
                                    <Pressable
                                        onPress={() => toggle('model')}
                                        style={(p) => [styles.configInlineField, p.pressed && styles.rowPressed]}
                                    >
                                        <Text style={[styles.configLabel, styles.configInlineText, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                                            {modelMode.name}
                                        </Text>
                                        <Ionicons name={expanded === 'model' ? 'chevron-up' : 'chevron-down'} size={11} color={theme.colors.textSecondary} />
                                    </Pressable>
                                ) : (
                                    <Text style={[styles.configLabel, styles.configInlineText, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                                        {modelMode.name}
                                    </Text>
                                )}
                            </>
                        ) : null}
                        {effortLevel?.name ? (
                            <>
                                <Text style={[styles.configLabel, { color: theme.colors.textSecondary }]}>·</Text>
                                {canEditEffort ? (
                                    <Pressable
                                        onPress={() => toggle('effort')}
                                        style={(p) => [styles.configInlineField, p.pressed && styles.rowPressed]}
                                    >
                                        <Text style={[styles.configLabel, styles.configInlineText, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                                            {effortLevel.name}
                                        </Text>
                                        <Ionicons name={expanded === 'effort' ? 'chevron-up' : 'chevron-down'} size={11} color={theme.colors.textSecondary} />
                                    </Pressable>
                                ) : (
                                    <Text style={[styles.configLabel, styles.configInlineText, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                                        {effortLevel.name}
                                    </Text>
                                )}
                            </>
                        ) : null}
                    </View>
                    {expanded === 'model' ? renderOptions(availableModels, modelMode?.key, applyModel) : null}
                    {expanded === 'effort' ? renderOptions(availableEffortLevels, effortLevel?.key, applyEffort) : null}

                    {/* Permission mode — tap to expand when there's more than one. */}
                    {permissionMode?.name ? (
                        canEditPermission ? (
                            <Pressable
                                style={(p) => [styles.configRow, p.pressed && styles.rowPressed]}
                                onPress={() => toggle('permission')}
                            >
                                <Ionicons name={permissionIcon(permissionMode.key)} size={15} color={theme.colors.textSecondary} />
                                <Text style={[styles.configLabel, styles.configValueText]} numberOfLines={1}>
                                    {permissionMode.name}
                                </Text>
                                <Ionicons name={expanded === 'permission' ? 'chevron-up' : 'chevron-down'} size={13} color={theme.colors.textSecondary} />
                            </Pressable>
                        ) : (
                            <View style={styles.configRow}>
                                <Ionicons name={permissionIcon(permissionMode.key)} size={15} color={theme.colors.textSecondary} />
                                <Text style={[styles.configLabel, styles.configValueText]} numberOfLines={1}>
                                    {permissionMode.name}
                                </Text>
                            </View>
                        )
                    ) : null}
                    {expanded === 'permission' ? renderOptions(availableModes, permissionMode?.key, applyPermission) : null}

                    {/* Divider + entry into the full info screen (the one tappable row). */}
                    <View style={styles.divider} />
                    <Pressable
                        style={(p) => [styles.configRow, p.pressed && styles.rowPressed]}
                        onPress={onViewDetails}
                    >
                        <Ionicons name="information-circle-outline" size={15} color={theme.colors.text} />
                        <Text style={[styles.configLabel, styles.configValueText]} numberOfLines={1}>
                            {t('sessionInfo.viewDetails')}
                        </Text>
                        <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>
            </View>
        </>
    );
});

const styles = StyleSheet.create((theme) => ({
    backdrop: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
    },
    dropdown: {
        position: 'absolute',
        left: 0,
        right: 0,
        paddingHorizontal: 12,
        paddingTop: 8,
        zIndex: 11,
    },
    configBox: {
        backgroundColor: theme.colors.input.background,
        borderRadius: Platform.select({ default: 16, android: 20 }),
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        paddingVertical: 4,
        paddingHorizontal: 4,
        overflow: 'hidden',
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 12,
        elevation: 8,
    },
    configRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
    },
    rowPressed: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    configLabel: {
        minWidth: 0,
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
        ...Platform.select({ web: { userSelect: 'none' } as any, default: {} }),
    },
    configValueText: {
        flex: 1,
        flexShrink: 1,
    },
    configInlineField: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minWidth: 0,
        flexShrink: 1,
    },
    configInlineText: {
        minWidth: 0,
        flexShrink: 1,
    },
    agentIcon: {
        width: 15,
        height: 15,
    },
    dot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
        marginHorizontal: 12,
        marginVertical: 2,
    },
    optionList: {
        marginHorizontal: 8,
        marginBottom: 4,
        paddingVertical: 2,
        borderRadius: 12,
        backgroundColor: theme.colors.surfaceHigh,
    },
    optionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: 10,
    },
}));
