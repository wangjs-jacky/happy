import React from 'react';
import {
    View,
    Text,
    Platform,
    Pressable,
    TextInput,
    ScrollView,
    LayoutAnimation,
    TextInputSelectionChangeEventData,
    NativeSyntheticEvent,
    Image as RNImage,
    ActivityIndicator,
} from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { Ionicons, Octicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { useAllMachines, useLocalSetting, useSessions, useSetting } from '@/sync/storage';
import type { NewSessionAgentType } from '@/sync/persistence';
import { isMachineOnline } from '@/utils/machineUtils';
import { listWorktrees } from '@/utils/worktree';
import { machineBrowseDirectory } from '@/sync/ops';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import { formatPathRelativeToHome, formatLastSeen } from '@/utils/sessionUtils';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { useShallow } from 'zustand/react/shallow';
import type { Machine, Session } from '@/sync/storageTypes';
import {
    getHardcodedPermissionModes,
    getHardcodedModelModes,
    getEffortLevelsForModel,
    getSupportsWorktree,
    type PermissionMode,
    type ModelMode,
    type EffortLevel,
} from '@/components/modelModeOptions';
import { getAgentPickerItems, getModePickerItems } from '@/utils/newSessionPickerItems';
import { resolveAgentDefaultConfig } from '@/sync/agentDefaults';
import { isRunningOnMac } from '@/utils/platform';

// Agent icon assets
const agentIcons = {
    claude: require('@/assets/images/icon-claude.png'),
    codex: require('@/assets/images/icon-gpt.png'),
    opencode: require('@/assets/images/icon-gpt.png'),
    openclaw: require('@/assets/images/icon-openclaw.png'),
    gemini: require('@/assets/images/icon-gemini.png'),
};

type AgentKey = NewSessionAgentType;
const ALL_AGENTS: { key: AgentKey; label: string }[] = [
    { key: 'opencode', label: 'opencode' },
    { key: 'claude', label: 'claude code' },
    { key: 'codex', label: 'codex' },
    { key: 'openclaw', label: 'openclaw' },
    { key: 'gemini', label: 'gemini' },
];

export type PickerItem = { key: string; label: string; subtitle?: string; dimmed?: boolean };

type PickerType = 'machine' | 'path' | 'worktree' | 'agent' | 'model' | 'effort' | 'permission';

type PermissionStyle = { color: string; icon: 'play-forward' | 'pause' };

const WORKTREE_PATH_DEBOUNCE_MS = 300;

function trimPathInput(path: string | null | undefined): string {
    return path?.trim() ?? '';
}

function trimTrailingPathSeparator(path: string): string {
    if (path === '/' || /^[A-Za-z]:[\\/]?$/.test(path)) {
        return path;
    }
    return path.replace(/[\\/]+$/, '');
}

function normalizePathForComparison(path: string | null | undefined, homeDir?: string): string | null {
    const trimmed = trimPathInput(path);
    if (!trimmed) {
        return null;
    }
    return trimTrailingPathSeparator(resolveAbsolutePath(trimmed, homeDir));
}

function getPermissionStyle(key: string): PermissionStyle | null {
    switch (key) {
        case 'acceptEdits':
        case 'auto_edit':
            return { color: '#A78BFA', icon: 'play-forward' };
        case 'plan':
            return { color: '#5EABA4', icon: 'pause' };
        case 'dontAsk':
        case 'safe-yolo':
            return { color: '#FBBF24', icon: 'play-forward' };
        case 'bypassPermissions':
        case 'yolo':
            return { color: '#F87171', icon: 'play-forward' };
        case 'read-only':
            return { color: '#60A5FA', icon: 'pause' };
        default:
            return null;
    }
}

// Option-list wrapper. Embedded (inline accordion under a row) renders a plain
// content-sized View: inside an unbounded parent a ScrollView collapses to zero
// height on native, which left the inline picker showing an empty strip. The
// non-embedded popover/sheet keeps a real ScrollView for long, scrollable lists.
function OptionListContainer({ embedded, children }: { embedded: boolean; children: React.ReactNode }) {
    if (embedded) {
        return <View style={pickerStyles.embeddedOptionListContent}>{children}</View>;
    }
    return (
        <ScrollView style={pickerStyles.optionList} keyboardShouldPersistTaps="handled">
            {children}
        </ScrollView>
    );
}

// Generic picker content — reused for machine, path, and worktree selection
function PickerContent({
    title,
    fixedItems,
    items,
    selectedKey,
    onSelect,
    searchPlaceholder,
    embedded = false,
}: {
    title: string;
    fixedItems?: PickerItem[];
    items: PickerItem[];
    selectedKey: string | null;
    onSelect: (key: string) => void;
    searchPlaceholder?: string;
    embedded?: boolean;
}) {
    const { theme } = useUnistyles();
    const [search, setSearch] = React.useState('');
    const shouldShowSearch = !embedded || items.length + (fixedItems?.length ?? 0) > 4;

    const filtered = React.useMemo(() => {
        if (!shouldShowSearch || !search) return items;
        const q = search.toLowerCase();
        return items.filter(item => item.label.toLowerCase().includes(q));
    }, [shouldShowSearch, search, items]);

    const renderOption = (item: PickerItem) => {
        const isSelected = item.key === selectedKey;
        return (
            <Pressable
                key={item.key}
                style={(p) => [
                    pickerStyles.option,
                    embedded && pickerStyles.embeddedOption,
                    p.pressed && pickerStyles.optionPressed,
                    item.dimmed && { opacity: 0.45 },
                ]}
                onPress={() => onSelect(item.key)}
            >
                <Octicons
                    name={isSelected ? 'check-circle-fill' : 'circle'}
                    size={16}
                    color={isSelected ? theme.colors.button.primary.background : theme.colors.textSecondary}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[pickerStyles.optionText, { color: theme.colors.text }]} numberOfLines={1}>
                        {item.label}
                    </Text>
                    {item.subtitle && (
                        <Text style={[pickerStyles.optionText, { color: theme.colors.textSecondary, fontSize: 13 }]} numberOfLines={1}>
                            {item.subtitle}
                        </Text>
                    )}
                </View>
            </Pressable>
        );
    };

    return (
        <View style={[pickerStyles.container, embedded && pickerStyles.embeddedContainer]}>
            {!embedded && (
                <Text style={[pickerStyles.title, { color: theme.colors.text }]}>{title}</Text>
            )}

            {shouldShowSearch && (
                <View style={[
                    pickerStyles.searchRow,
                    { backgroundColor: embedded ? 'transparent' : theme.colors.input.background },
                    embedded && pickerStyles.embeddedSearchRow,
                ]}>
                    <Ionicons name="search" size={16} color={theme.colors.textSecondary} />
                    <TextInput
                        value={search}
                        onChangeText={setSearch}
                        placeholder={searchPlaceholder ?? 'search...'}
                        placeholderTextColor={theme.colors.textSecondary}
                        style={[pickerStyles.searchInput, { color: theme.colors.text }]}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                </View>
            )}

            <OptionListContainer embedded={embedded}>
                {fixedItems?.map(renderOption)}
                {fixedItems && fixedItems.length > 0 && filtered.length > 0 && (
                    <View style={[pickerStyles.divider, { backgroundColor: theme.colors.divider }]} />
                )}
                {filtered.map(renderOption)}
                {filtered.length === 0 && (!fixedItems || fixedItems.length === 0) && (
                    <Text style={[pickerStyles.emptyText, { color: theme.colors.textSecondary }]}>
                        {search.length > 0 ? 'no results' : 'no options'}
                    </Text>
                )}
            </OptionListContainer>
        </View>
    );
}

// A single breadcrumb step: a display label and the absolute path it points to.
type Crumb = { label: string; path: string };

// Build breadcrumb steps from an absolute path, rooted at home ('~'). Falls
// back to raw absolute segments if the path somehow sits outside home.
function buildCrumbs(absPath: string | undefined, home: string | undefined): Crumb[] {
    if (!absPath) return [];
    if (home && absPath === home) return [{ label: '~', path: home }];
    if (home && absPath.startsWith(home + '/')) {
        const rel = absPath.slice(home.length + 1).split('/').filter(Boolean);
        let acc = home;
        const out: Crumb[] = [{ label: '~', path: home }];
        for (const seg of rel) {
            acc = `${acc}/${seg}`;
            out.push({ label: seg, path: acc });
        }
        return out;
    }
    const parts = absPath.split('/').filter(Boolean);
    let acc = '';
    const out: Crumb[] = [{ label: '/', path: '/' }];
    for (const seg of parts) {
        acc = `${acc}/${seg}`;
        out.push({ label: seg, path: acc });
    }
    return out;
}

export function PathPickerContent({
    title,
    items,
    value,
    homeDir,
    machineId,
    machineOnline,
    onChangeValue,
    onDone,
    embedded = false,
    manualInput = true,
}: {
    title: string;
    items: PickerItem[];
    value: string | null;
    homeDir?: string;
    machineId: string | null;
    machineOnline: boolean;
    onChangeValue: (value: string) => void;
    onDone?: () => void;
    embedded?: boolean;
    manualInput?: boolean;
}) {
    const { theme } = useUnistyles();
    const inputRef = React.useRef<TextInput>(null);
    const currentValue = value ?? '';
    const [selection, setSelection] = React.useState<{ start: number; end: number } | undefined>(undefined);

    // Point-and-click browse mode. Off by default so opening the picker no
    // longer forces the keyboard up — typing is opt-in via the field below.
    const [browsing, setBrowsing] = React.useState(false);
    const [browseDirs, setBrowseDirs] = React.useState<{ name: string; path: string; isProjectRoot: boolean }[]>([]);
    const [browsePath, setBrowsePath] = React.useState<string | undefined>(undefined);
    const [browseHome, setBrowseHome] = React.useState<string | undefined>(undefined);
    const [browseLoading, setBrowseLoading] = React.useState(false);
    const [browseError, setBrowseError] = React.useState<string | null>(null);

    // Load a directory from the machine. Empty string lands on the home dir.
    const loadDir = React.useCallback(async (path: string) => {
        if (!machineId) return;
        setBrowseLoading(true);
        setBrowseError(null);
        const res = await machineBrowseDirectory(machineId, path);
        if (res.success) {
            setBrowseDirs(res.directories ?? []);
            setBrowsePath(res.path);
            setBrowseHome(res.home);
        } else {
            setBrowseError(res.error ?? 'Failed to list directory');
        }
        setBrowseLoading(false);
    }, [machineId]);

    const startBrowsing = React.useCallback(() => {
        setBrowsing(true);
        const trimmed = currentValue.trim();
        // Seed from the current selection if any, otherwise from home.
        loadDir(trimmed ? resolveAbsolutePath(trimmed, homeDir) : '');
    }, [currentValue, homeDir, loadDir]);

    const selectFolder = React.useCallback((path: string) => {
        onChangeValue(path);
        onDone?.();
    }, [onChangeValue, onDone]);

    const crumbs = React.useMemo(() => buildCrumbs(browsePath, browseHome ?? homeDir), [browsePath, browseHome, homeDir]);

    const matchedItemKey = React.useMemo(() => {
        const normalizedValue = normalizePathForComparison(currentValue, homeDir);
        if (!normalizedValue) {
            return null;
        }

        const match = items.find((item) =>
            normalizePathForComparison(item.key, homeDir) === normalizedValue,
        );

        return match?.key ?? null;
    }, [currentValue, homeDir, items]);

    // Recent rows now select-and-close directly (no longer just fill the field).
    const handleSuggestionPress = React.useCallback((item: PickerItem) => {
        selectFolder(item.key);
    }, [selectFolder]);

    const isCustomPath = currentValue.trim().length > 0 && matchedItemKey === null;
    const handleSelectionChange = React.useCallback((event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
        setSelection(event.nativeEvent.selection);
    }, []);
    const doneIconColor = theme.colors.header.tint;
    const canBrowse = !!machineId && machineOnline;
    const currentFolderName = browsePath ? (crumbs[crumbs.length - 1]?.label ?? browsePath) : '';
    const pathInputRow = (
        <View
            style={[
                pickerStyles.pathInputRow,
                {
                    backgroundColor: embedded ? 'transparent' : theme.colors.input.background,
                    borderColor: embedded ? 'transparent' : theme.colors.divider,
                },
                embedded && pickerStyles.embeddedPathInputRow,
            ]}
        >
            <Ionicons name="folder-outline" size={16} color={theme.colors.textSecondary} />
            <View style={pickerStyles.pathInputField}>
                <TextInput
                    ref={inputRef}
                    value={currentValue}
                    onChangeText={onChangeValue}
                    onSelectionChange={handleSelectionChange}
                    selection={selection}
                    placeholder={manualInput ? 'Enter project path' : 'Select project path'}
                    placeholderTextColor={theme.colors.textSecondary}
                    style={[
                        pickerStyles.pathTextInput,
                        embedded && pickerStyles.embeddedPathTextInput,
                        { color: theme.colors.text },
                    ]}
                    editable={manualInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline={false}
                    numberOfLines={1}
                    returnKeyType="done"
                    onSubmitEditing={onDone}
                />
            </View>
        </View>
    );

    return (
        <View style={[pickerStyles.container, embedded && pickerStyles.embeddedContainer]}>
            {!embedded && (
                <View style={pickerStyles.titleRow}>
                    <Text style={[pickerStyles.title, { color: theme.colors.text }]}>{title}</Text>
                    {Platform.OS !== 'web' && onDone && (
                        <Pressable
                            onPress={onDone}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={({ pressed }) => [
                                pickerStyles.doneButtonPressable,
                                { opacity: pressed ? 0.82 : 1 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="Done"
                        >
                            <GlassView
                                glassEffectStyle="regular"
                                tintColor="rgba(255,255,255,0.10)"
                                isInteractive={true}
                                style={[
                                    pickerStyles.doneButtonGlass,
                                    { borderColor: 'rgba(255,255,255,0.16)' },
                                ]}
                            >
                                <Ionicons
                                    name="checkmark"
                                    size={20}
                                    color={doneIconColor}
                                />
                            </GlassView>
                        </Pressable>
                    )}
                </View>
            )}

            {browsing ? (
                <>
                    {/* Breadcrumb + exit-browse control */}
                    <View style={pickerStyles.breadcrumbRow}>
                        <Pressable
                            onPress={() => setBrowsing(false)}
                            hitSlop={8}
                            style={(p) => [pickerStyles.crumbBack, p.pressed && pickerStyles.optionPressed]}
                            accessibilityLabel="Close browser"
                        >
                            <Ionicons name="close" size={16} color={theme.colors.textSecondary} />
                        </Pressable>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            style={pickerStyles.crumbScroll}
                            contentContainerStyle={pickerStyles.crumbScrollContent}
                            keyboardShouldPersistTaps="handled"
                        >
                            {crumbs.map((c, i) => {
                                const isLast = i === crumbs.length - 1;
                                return (
                                    <React.Fragment key={c.path}>
                                        {i > 0 && (
                                            <Ionicons name="chevron-forward" size={12} color={theme.colors.textSecondary} style={pickerStyles.crumbSep} />
                                        )}
                                        <Pressable onPress={() => !isLast && loadDir(c.path)} hitSlop={6}>
                                            <Text
                                                style={[
                                                    pickerStyles.crumbText,
                                                    { color: isLast ? theme.colors.text : theme.colors.textSecondary },
                                                ]}
                                                numberOfLines={1}
                                            >
                                                {c.label}
                                            </Text>
                                        </Pressable>
                                    </React.Fragment>
                                );
                            })}
                        </ScrollView>
                    </View>

                    {browseError ? (
                        <Text style={[pickerStyles.emptyText, { color: theme.colors.textSecondary }]}>
                            {browseError}
                        </Text>
                    ) : browseLoading && browseDirs.length === 0 ? (
                        <View style={pickerStyles.browseLoading}>
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        </View>
                    ) : (
                        // Bounded, scrollable list: directory listings can be long, and the
                        // embedded picker (a plain View) would otherwise clip them with no
                        // way to scroll. nestedScrollEnabled lets it scroll inside the
                        // parent ScrollView on Android.
                        <ScrollView
                            style={pickerStyles.dirScroll}
                            contentContainerStyle={pickerStyles.embeddedOptionListContent}
                            nestedScrollEnabled
                            keyboardShouldPersistTaps="handled"
                        >
                            {browseDirs.map((dir) => (
                                <Pressable
                                    key={dir.path}
                                    style={(p) => [
                                        pickerStyles.option,
                                        embedded && pickerStyles.embeddedOption,
                                        p.pressed && pickerStyles.optionPressed,
                                    ]}
                                    onPress={() => loadDir(dir.path)}
                                >
                                    <Ionicons name="folder-outline" size={16} color={theme.colors.textSecondary} />
                                    <View style={{ flex: 1, minWidth: 0 }}>
                                        <Text style={[pickerStyles.optionText, { color: theme.colors.text }]} numberOfLines={1}>
                                            {dir.name}
                                        </Text>
                                    </View>
                                    {dir.isProjectRoot && (
                                        <Octicons name="git-branch" size={13} color={theme.colors.textSecondary} />
                                    )}
                                    <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} />
                                </Pressable>
                            ))}
                            {browseDirs.length === 0 && (
                                <Text style={[pickerStyles.emptyText, { color: theme.colors.textSecondary }]}>
                                    no sub-folders here
                                </Text>
                            )}
                        </ScrollView>
                    )}

                    {/* Confirm the directory we're currently standing in */}
                    {!!browsePath && (
                        <Pressable
                            onPress={() => selectFolder(browsePath)}
                            style={(p) => [
                                pickerStyles.selectButton,
                                { backgroundColor: theme.colors.button.primary.background },
                                p.pressed && pickerStyles.optionPressed,
                            ]}
                        >
                            <Ionicons name="checkmark" size={16} color={theme.colors.button.primary.tint} />
                            <Text style={[pickerStyles.selectButtonText, { color: theme.colors.button.primary.tint }]} numberOfLines={1}>
                                Select “{currentFolderName}”
                            </Text>
                        </Pressable>
                    )}
                </>
            ) : (
                <>
                    {manualInput ? pathInputRow : (
                        <Pressable
                            onPress={canBrowse ? startBrowsing : undefined}
                            disabled={!canBrowse}
                            accessibilityRole="button"
                            accessibilityLabel="Select project path"
                        >
                            {pathInputRow}
                        </Pressable>
                    )}

                    {manualInput && isCustomPath && (
                        <Text style={[pickerStyles.pathMetaText, { color: theme.colors.textSecondary }]}>
                            using custom path above
                        </Text>
                    )}

                    {/* Point-and-click browse entry — no typing required */}
                    {canBrowse && (
                        <Pressable
                            onPress={startBrowsing}
                            style={(p) => [
                                pickerStyles.option,
                                embedded && pickerStyles.embeddedOption,
                                p.pressed && pickerStyles.optionPressed,
                            ]}
                        >
                            <Ionicons name="folder-open-outline" size={16} color={theme.colors.button.primary.background} />
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={[pickerStyles.optionText, { color: theme.colors.button.primary.background }]} numberOfLines={1}>
                                    Browse folders…
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} />
                        </Pressable>
                    )}

                    <Text style={[pickerStyles.sectionLabel, { color: theme.colors.textSecondary }]}>
                        Recent
                    </Text>

                    <OptionListContainer embedded={embedded}>
                        {items.map((item) => {
                            const isSelected = item.key === matchedItemKey;

                            return (
                                <Pressable
                                    key={item.key}
                                    style={(p) => [
                                        pickerStyles.option,
                                        embedded && pickerStyles.embeddedOption,
                                        p.pressed && pickerStyles.optionPressed,
                                    ]}
                                    onPress={() => handleSuggestionPress(item)}
                                >
                                    <Ionicons
                                        name="folder-outline"
                                        size={16}
                                        color={theme.colors.textSecondary}
                                    />
                                    <View style={{ flex: 1, minWidth: 0 }}>
                                        <Text style={[pickerStyles.optionText, { color: theme.colors.text }]} numberOfLines={1}>
                                            {item.label}
                                        </Text>
                                    </View>
                                    {isSelected && (
                                        <Ionicons
                                            name="checkmark-circle"
                                            size={18}
                                            color={theme.colors.button.primary.background}
                                        />
                                    )}
                                </Pressable>
                            );
                        })}

                        {items.length === 0 && (
                            <Text style={[pickerStyles.emptyText, { color: theme.colors.textSecondary }]}>
                                no recent projects yet
                            </Text>
                        )}
                    </OptionListContainer>
                </>
            )}
        </View>
    );
}

// Helper: get machine display name
function getMachineName(machine: Machine): string {
    return machine.metadata?.displayName || machine.metadata?.host || 'unknown';
}

const WORKTREE_FIXED_ITEMS: PickerItem[] = [
    { key: '__none__', label: 'no worktree' },
    { key: '__new__', label: 'new worktree' },
];

/**
 * The selection keys the consumer (e.g. /new's handleSend) needs at send time.
 * These mirror the panel's local index-based selection — which can legitimately
 * diverge from the persisted draft right after an agent switch resets the
 * indices to that agent's defaults — so they're exposed imperatively rather than
 * read back from the draft store.
 */
export interface SessionConfigSelection {
    permissionKey?: string;
    modelKey?: string;
    effortKey: string | null;
    /** '__none__' | '__new__' | <existing worktree absolute path>. */
    worktreeKey: string;
}

export interface SessionConfigPanelHandle {
    getSelection(): SessionConfigSelection;
    closePickers(): void;
}

export interface SessionConfigPanelProps {
    /**
     * 'inline' — phone/narrow: full-width config box, native pickers in a bottom
     * sheet, web pickers as inline popovers with a self-managed click-away layer.
     * 'sidebar' — desktop: config box with embedded popovers; the host owns the
     * shell-level click-away backdrop (see onPickerOpenChange/closePickers).
     */
    layout?: 'inline' | 'sidebar';
    /**
     * When false the box stays fully expanded and the collapse chevron is hidden —
     * used when the host (ComposeHome) controls show/hide itself. Defaults to true.
     */
    collapsible?: boolean;
    /** Fired (in an effect) whenever a picker opens/closes — for host backdrops. */
    onPickerOpenChange?: (open: boolean) => void;
}

/**
 * The new-session configuration surface: machine / path / agent / model / effort /
 * permission / worktree, plus the pickers that drive them. Extracted from the
 * /new screen so both /new and the compose-first home can render the same panel.
 * It reads and writes the shared `useNewSessionDraft` store for the persisted
 * fields (machine/path/agent/permission/model/effort/worktree) and keeps the
 * model/permission/effort *indices* as local state, exposed via the imperative
 * handle.
 */
export const SessionConfigPanel = React.forwardRef<SessionConfigPanelHandle, SessionConfigPanelProps>(
    function SessionConfigPanel({ layout = 'inline', collapsible = true, onPickerOpenChange }, ref) {
        const { theme } = useUnistyles();
        const isSidebar = layout === 'sidebar';

        // Real data sources
        const allMachines = useAllMachines({ includeOffline: true });
        const sessions = useSessions();
        const agentDefaultOverrides = useSetting('agentDefaultOverrides');

        const draft = useNewSessionDraft(useShallow((s) => ({
            selectedMachineId: s.selectedMachineId,
            setMachineId: s.setMachineId,
            selectedPath: s.selectedPath,
            setPath: s.setPath,
            agentType: s.agentType,
            setAgentType: s.setAgentType,
            setPermissionMode: s.setPermissionMode,
            setModelMode: s.setModelMode,
            effortLevel: s.effortLevel,
            setEffortLevel: s.setEffortLevel,
            sessionType: s.sessionType,
            setSessionType: s.setSessionType,
            worktreeKey: s.worktreeKey,
            setWorktreeKey: s.setWorktreeKey,
        })));
        const hasText = useNewSessionDraft((s) => s.input.trim().length > 0);
        const selectedAgent = draft.agentType;
        const setSelectedAgent = draft.setAgentType;
        const selectedMachineId = draft.selectedMachineId;
        const setSelectedMachineId = draft.setMachineId;
        const selectedPath = draft.selectedPath;
        const setSelectedPath = draft.setPath;
        const [worktreeKey, setWorktreeKey] = React.useState<string>(
            draft.worktreeKey ?? (draft.sessionType === 'worktree' ? '__new__' : '__none__')
        );
        React.useEffect(() => {
            draft.setSessionType(worktreeKey !== '__none__' ? 'worktree' : 'simple');
            draft.setWorktreeKey(worktreeKey === '__none__' || worktreeKey === '__new__' ? null : worktreeKey);
        }, [worktreeKey]);

        // Local-only UI state (not persisted)
        const [permissionIndex, setPermissionIndex] = React.useState(0);
        const [modelIndex, setModelIndex] = React.useState(0);
        const [effortIndex, setEffortIndex] = React.useState(0);
        const [activePicker, setActivePicker] = React.useState<PickerType | null>(null);

        // Config collapse — auto-collapses when typing, expands when empty
        const [isConfigExpanded, setIsConfigExpanded] = React.useState(true);

        // Notify the host when a picker opens/closes (used for desktop backdrops).
        React.useEffect(() => {
            onPickerOpenChange?.(activePicker !== null);
        }, [activePicker, onPickerOpenChange]);

        // Auto-select first machine when none selected (first-ever use, no draft)
        React.useEffect(() => {
            if (selectedMachineId) return;
            if (allMachines.length > 0) {
                setSelectedMachineId(allMachines[0].id);
            }
        }, [allMachines, selectedMachineId]);

        const selectedMachine = React.useMemo(
            () => allMachines.find(m => m.id === selectedMachineId) ?? null,
            [allMachines, selectedMachineId],
        );
        const selectedHomeDir = selectedMachine?.metadata?.homeDir;

        // Build machine picker items: online first, then offline
        const machineItems = React.useMemo<PickerItem[]>(() => {
            const sorted = [...allMachines].sort((a, b) => {
                const aOnline = isMachineOnline(a) ? 0 : 1;
                const bOnline = isMachineOnline(b) ? 0 : 1;
                return aOnline - bOnline;
            });
            return sorted.map(m => ({
                key: m.id,
                label: getMachineName(m),
                subtitle: isMachineOnline(m) ? t('status.online') : t('status.lastSeen', { time: formatLastSeen(m.activeAt, false) }),
                dimmed: !isMachineOnline(m),
            }));
        }, [allMachines]);

        // Build path items from session history for selected machine
        const pathItems = React.useMemo<PickerItem[]>(() => {
            if (!selectedMachineId || !sessions) return [];
            const paths = new Set<string>();
            for (const s of sessions) {
                if (typeof s === 'string') continue;
                const session = s as Session;
                if (session.metadata?.machineId === selectedMachineId && session.metadata?.path) {
                    paths.add(session.metadata.path);
                }
            }
            const homeDir = selectedMachine?.metadata?.homeDir;
            return Array.from(paths).sort().map(p => ({
                key: p,
                label: formatPathRelativeToHome(p, homeDir),
            }));
        }, [selectedMachineId, sessions, selectedMachine]);

        // Auto-select first path when machine changes
        React.useEffect(() => {
            if (!selectedMachineId || selectedPath !== null) {
                return;
            }

            setSelectedPath(pathItems[0]?.label ?? '~');
        }, [selectedMachineId, pathItems, selectedPath, setSelectedPath]);

        const resolvedSelectedPath = React.useMemo(() => {
            return normalizePathForComparison(selectedPath, selectedHomeDir);
        }, [selectedHomeDir, selectedPath]);

        const [debouncedResolvedSelectedPath, setDebouncedResolvedSelectedPath] = React.useState<string | null>(resolvedSelectedPath);

        React.useEffect(() => {
            if (!resolvedSelectedPath) {
                setDebouncedResolvedSelectedPath(null);
                return;
            }

            const timeout = setTimeout(() => {
                setDebouncedResolvedSelectedPath(resolvedSelectedPath);
            }, WORKTREE_PATH_DEBOUNCE_MS);

            return () => clearTimeout(timeout);
        }, [resolvedSelectedPath]);

        // Fetch existing worktrees from the selected machine/path
        const [worktreeItems, setWorktreeItems] = React.useState<PickerItem[]>([]);
        React.useEffect(() => {
            if (!selectedMachineId || !debouncedResolvedSelectedPath) {
                setWorktreeItems([]);
                return;
            }
            if (!selectedMachine || !isMachineOnline(selectedMachine)) {
                setWorktreeItems([]);
                return;
            }
            let cancelled = false;
            listWorktrees(selectedMachineId, debouncedResolvedSelectedPath).then(worktrees => {
                if (cancelled) return;
                setWorktreeItems(worktrees.map(wt => ({
                    key: wt.path,
                    label: wt.branch,
                    subtitle: wt.path,
                })));
            });
            return () => { cancelled = true; };
        }, [debouncedResolvedSelectedPath, selectedMachineId, selectedMachine]);

        React.useEffect(() => {
            if (worktreeKey === '__none__' || worktreeKey === '__new__') {
                return;
            }

            if (!worktreeItems.some((item) => item.key === worktreeKey)) {
                setWorktreeKey('__none__');
            }
        }, [worktreeItems, worktreeKey]);

        // Filter available agents based on CLI availability from machine metadata
        const availableAgents = React.useMemo(() => {
            const availability = selectedMachine?.metadata?.cliAvailability;
            if (!availability) return ALL_AGENTS;
            return ALL_AGENTS.filter(a => availability[a.key]);
        }, [selectedMachine]);

        // If current agent not available on this machine, switch to first available
        React.useEffect(() => {
            if (availableAgents.length > 0 && !availableAgents.find(a => a.key === selectedAgent)) {
                setSelectedAgent(availableAgents[0].key);
            }
        }, [availableAgents, selectedAgent, setSelectedAgent]);

        // Derive options from agent type
        const permissionModes = React.useMemo<PermissionMode[]>(
            () => getHardcodedPermissionModes(selectedAgent, t),
            [selectedAgent],
        );
        const modelModes = React.useMemo<ModelMode[]>(
            () => getHardcodedModelModes(selectedAgent, t),
            [selectedAgent],
        );

        const currentModel = modelModes[modelIndex] ?? modelModes[0];
        const currentModelKey = currentModel?.key ?? 'default';

        const effortLevels = React.useMemo<EffortLevel[]>(
            () => getEffortLevelsForModel(selectedAgent, currentModelKey),
            [selectedAgent, currentModelKey],
        );
        const effectiveAgentDefaults = React.useMemo(() => (
            resolveAgentDefaultConfig(agentDefaultOverrides, selectedAgent)
        ), [agentDefaultOverrides, selectedAgent]);

        const supportsWorktree = getSupportsWorktree(selectedAgent);
        const showModel = modelModes.length > 1;
        const showEffort = effortLevels.length > 0;
        const showPermission = permissionModes.length > 1;

        // Reset indices when agent/default settings change.
        React.useEffect(() => {
            const defaultPermIdx = permissionModes.findIndex(m => m.key === effectiveAgentDefaults.permissionMode);
            setPermissionIndex(defaultPermIdx >= 0 ? defaultPermIdx : 0);

            const defaultModelIdx = modelModes.findIndex(m => m.key === effectiveAgentDefaults.modelMode);
            setModelIndex(defaultModelIdx >= 0 ? defaultModelIdx : 0);

            if (!supportsWorktree) setWorktreeKey('__none__');
        }, [permissionModes, modelModes, supportsWorktree, effectiveAgentDefaults.permissionMode, effectiveAgentDefaults.modelMode]);

        // Reset effort when model changes
        React.useEffect(() => {
            const defaultEffort = draft.effortLevel ?? effectiveAgentDefaults.effortLevel;
            if (defaultEffort && effortLevels.length > 0) {
                const idx = effortLevels.findIndex(e => e.key === defaultEffort);
                setEffortIndex(idx >= 0 ? idx : effortLevels.length - 1);
            } else {
                setEffortIndex(0);
            }
        }, [draft.effortLevel, effectiveAgentDefaults.effortLevel, currentModelKey, effortLevels]);

        // Auto collapse config once when user starts typing (mobile only, collapsible).
        // On desktop (web / Mac Catalyst) the panel stays expanded. Also skip on
        // the initial render when draft text is restored.
        const hasCollapsedOnceRef = React.useRef(false);
        const isInitialRef = React.useRef(true);
        const isDesktop = Platform.OS === 'web' || isRunningOnMac();
        React.useEffect(() => {
            if (isInitialRef.current) {
                isInitialRef.current = false;
                return;
            }
            if (!collapsible || isSidebar || isDesktop) return;
            if (hasText && !hasCollapsedOnceRef.current) {
                hasCollapsedOnceRef.current = true;
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setIsConfigExpanded(false);
            }
        }, [hasText, collapsible, isSidebar, isDesktop]);

        const toggleConfig = React.useCallback(() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setActivePicker(null);
            setIsConfigExpanded(v => !v);
        }, []);

        // Expand/collapse a picker inline under its row. Animate on native so the
        // option list slides in/out (web inline popovers don't need LayoutAnimation).
        const togglePicker = React.useCallback((type: PickerType) => {
            if (Platform.OS !== 'web') {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            }
            setActivePicker(v => v === type ? null : type);
        }, []);

        // Collapse the open picker (option picked / dismissed), animated on native.
        const dismissPicker = React.useCallback(() => {
            if (Platform.OS !== 'web') {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            }
            setActivePicker(null);
        }, []);

        const isOffline = selectedMachine ? !isMachineOnline(selectedMachine) : false;
        const agent = availableAgents.find(a => a.key === selectedAgent) ?? ALL_AGENTS[0];
        const currentPermission = permissionModes[permissionIndex] ?? permissionModes[0];
        const currentEffort = effortLevels[effortIndex] ?? effortLevels[0];
        const permissionStyle = currentPermission?.key !== 'default' ? getPermissionStyle(currentPermission.key) : null;

        // Display values
        const machineName = selectedMachine ? getMachineName(selectedMachine) : 'Select machine';
        const pathName = trimPathInput(selectedPath)
            ? formatPathRelativeToHome(trimPathInput(selectedPath), selectedHomeDir)
            : '~';
        const worktreeLabel = worktreeKey === '__none__'
            ? 'no worktree'
            : worktreeKey === '__new__'
                ? 'new worktree'
                : worktreeItems.find(wt => wt.key === worktreeKey)?.label || worktreeKey;

        // Picker data derived from active picker type
        const pickerData = React.useMemo(() => {
            switch (activePicker) {
                case 'machine':
                    return { title: 'Machine', items: machineItems, selectedKey: selectedMachineId, searchPlaceholder: 'search machines...' };
                case 'worktree':
                    return { title: 'Worktree', fixedItems: WORKTREE_FIXED_ITEMS, items: worktreeItems, selectedKey: worktreeKey, searchPlaceholder: 'search worktrees...' };
                case 'agent':
                    return { title: 'Agent', items: getAgentPickerItems(availableAgents), selectedKey: selectedAgent, searchPlaceholder: 'search agents...' };
                case 'model':
                    return { title: 'Model', items: getModePickerItems(modelModes), selectedKey: currentModelKey, searchPlaceholder: 'search models...' };
                case 'effort':
                    return { title: 'Effort', items: getModePickerItems(effortLevels), selectedKey: currentEffort?.key ?? null, searchPlaceholder: 'search efforts...' };
                case 'permission':
                    return { title: 'Permissions', items: getModePickerItems(permissionModes), selectedKey: currentPermission?.key ?? null, searchPlaceholder: 'search permissions...' };
                default:
                    return null;
            }
        }, [
            activePicker,
            availableAgents,
            currentEffort?.key,
            currentModelKey,
            currentPermission?.key,
            effortLevels,
            machineItems,
            modelModes,
            permissionModes,
            selectedAgent,
            selectedMachineId,
            worktreeKey,
            worktreeItems,
        ]);

        const handlePickerSelect = React.useCallback((key: string) => {
            switch (activePicker) {
                case 'machine':
                    setSelectedMachineId(key);
                    break;
                case 'worktree':
                    setWorktreeKey(key);
                    break;
                case 'agent':
                    if (availableAgents.some((candidate) => candidate.key === key)) {
                        setSelectedAgent(key as NewSessionAgentType);
                    }
                    break;
                case 'model': {
                    const next = modelModes.findIndex((mode) => mode.key === key);
                    if (next >= 0) {
                        setModelIndex(next);
                        draft.setModelMode(modelModes[next]?.key ?? 'default');
                    }
                    break;
                }
                case 'effort': {
                    const next = effortLevels.findIndex((level) => level.key === key);
                    if (next >= 0) {
                        setEffortIndex(next);
                        draft.setEffortLevel(effortLevels[next]?.key ?? null);
                    }
                    break;
                }
                case 'permission': {
                    const next = permissionModes.findIndex((mode) => mode.key === key);
                    if (next >= 0) {
                        setPermissionIndex(next);
                        draft.setPermissionMode(permissionModes[next]?.key ?? 'default');
                    }
                    break;
                }
            }
            dismissPicker();
        }, [
            activePicker,
            availableAgents,
            dismissPicker,
            draft.setEffortLevel,
            draft.setModelMode,
            draft.setPermissionMode,
            effortLevels,
            modelModes,
            permissionModes,
            setSelectedAgent,
            setSelectedMachineId,
            setWorktreeKey,
        ]);

        // Expose the live selection + a way to dismiss pickers to the host.
        React.useImperativeHandle(ref, () => ({
            getSelection: () => ({
                permissionKey: currentPermission?.key === 'default' ? undefined : currentPermission?.key,
                modelKey: currentModelKey === 'default' ? undefined : currentModelKey,
                effortKey: draft.effortLevel ?? effectiveAgentDefaults.effortLevel ?? null,
                worktreeKey,
            }),
            closePickers: dismissPicker,
        }), [currentPermission?.key, currentModelKey, draft.effortLevel, effectiveAgentDefaults.effortLevel, worktreeKey, dismissPicker]);

        // Render the active picker inline directly under its row. Web (non-sidebar)
        // shows it as a dropdown popover; sidebar and native render it embedded as a
        // flush accordion. Native previously opened a bottom-sheet modal — it now
        // expands in place, matching the running-session SessionInfoDropdown.
        const isWeb = Platform.OS === 'web';
        const renderActivePickerPopover = React.useCallback((type: PickerType) => {
            if (activePicker !== type) {
                return null;
            }

            const embedded = isSidebar || !isWeb;
            return (
                <View style={[
                    styles.popover,
                    isSidebar
                        ? styles.sidebarPopover
                        : isWeb
                            ? { backgroundColor: theme.colors.header.background }
                            : styles.inlinePopover,
                ]}>
                    {type === 'path' ? (
                        <PathPickerContent
                            title="Project"
                            items={pathItems}
                            value={selectedPath}
                            homeDir={selectedHomeDir}
                            machineId={selectedMachineId}
                            machineOnline={selectedMachine ? isMachineOnline(selectedMachine) : false}
                            onChangeValue={setSelectedPath}
                            onDone={dismissPicker}
                            embedded={embedded}
                        />
                    ) : pickerData ? (
                        <PickerContent
                            {...pickerData}
                            onSelect={handlePickerSelect}
                            embedded={embedded}
                        />
                    ) : null}
                </View>
            );
        }, [
            activePicker,
            dismissPicker,
            handlePickerSelect,
            isSidebar,
            isWeb,
            pathItems,
            pickerData,
            selectedHomeDir,
            selectedMachineId,
            selectedMachine,
            selectedPath,
            setSelectedPath,
            theme.colors.header.background,
        ]);

        return (
            <>
                <View style={[
                    styles.configBox,
                    // Web popovers overflow the box (shadow/positioning); native inline
                    // pickers stay clipped inside the rounded box like an accordion.
                    activePicker && isWeb && styles.configBoxWithPopover,
                    isSidebar && styles.sidebarConfigBox,
                ]}>
                    {isSidebar || isConfigExpanded ? (
                        <>
                            <View style={styles.configRowWithToggle}>
                                <Pressable
                                    style={(p) => [
                                        styles.configRow,
                                        { flex: 1 },
                                        p.pressed && styles.configRowPressed,
                                    ]}
                                    onPress={() => togglePicker('machine')}
                                >
                                    <Ionicons name="desktop-outline" size={15} color={theme.colors.textSecondary} />
                                    <Text style={[styles.configLabel, styles.configValueText]} numberOfLines={1}>
                                        {machineName}
                                    </Text>
                                    <Ionicons name="chevron-down" size={13} color={theme.colors.textSecondary} />
                                </Pressable>
                                {collapsible && !isSidebar && (
                                    <Pressable
                                        onPress={toggleConfig}
                                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                        style={(p) => [styles.collapseToggle, p.pressed && styles.configRowPressed]}
                                    >
                                        <Ionicons name="chevron-up" size={16} color={theme.colors.textSecondary} />
                                    </Pressable>
                                )}
                            </View>
                            {renderActivePickerPopover('machine')}

                            {isOffline && (
                                <View style={styles.offlineHelp}>
                                    <Ionicons name="cloud-offline-outline" size={14} color={theme.colors.status.disconnected} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.offlineHelpTitle, { color: theme.colors.status.disconnected }]}>
                                            {t('newSession.machineOffline')}
                                        </Text>
                                        <Text style={[styles.offlineHelpText, { color: theme.colors.textSecondary }]}>
                                            {t('machine.offlineHelp')}
                                            {'\n'}{t('newSession.switchMachinesHint')}
                                        </Text>
                                    </View>
                                </View>
                            )}

                            <View style={{ opacity: isOffline ? 0.4 : 1 }} pointerEvents={isOffline ? 'none' : 'auto'}>
                                <Pressable
                                    style={(p) => [styles.configRow, p.pressed && styles.configRowPressed]}
                                    onPress={() => togglePicker('path')}
                                >
                                    <Ionicons name="folder-outline" size={15} color={theme.colors.textSecondary} />
                                    <Text style={[styles.configLabel, styles.configValueText]} numberOfLines={1}>
                                        {pathName}
                                    </Text>
                                    <Ionicons name="chevron-down" size={13} color={theme.colors.textSecondary} />
                                </Pressable>
                                {renderActivePickerPopover('path')}

                                <View style={styles.configRow}>
                                    <Pressable
                                        onPress={() => togglePicker('agent')}
                                        style={(p) => [styles.configInlineField, p.pressed && styles.configRowPressed]}
                                    >
                                        <RNImage
                                            source={agentIcons[agent.key]}
                                            style={[styles.agentIcon, { tintColor: theme.colors.textSecondary }]}
                                            resizeMode="contain"
                                        />
                                        <Text style={[styles.configLabel, styles.configInlineText]} numberOfLines={1}>
                                            {agent.label}
                                        </Text>
                                        <Ionicons name="chevron-down" size={12} color={theme.colors.textSecondary} />
                                    </Pressable>

                                    {showModel && (
                                        <>
                                            <Text style={[styles.configLabel, { color: theme.colors.textSecondary }]}>·</Text>
                                            <Pressable onPress={() => togglePicker('model')} style={(p) => [styles.configInlineField, p.pressed && styles.configRowPressed]}>
                                                <Text style={[styles.configLabel, styles.configInlineText, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                                                    {currentModel.name}
                                                </Text>
                                                <Ionicons name="chevron-down" size={12} color={theme.colors.textSecondary} />
                                            </Pressable>
                                        </>
                                    )}

                                    {showEffort && (
                                        <>
                                            <Text style={[styles.configLabel, { color: theme.colors.textSecondary }]}>·</Text>
                                            <Pressable onPress={() => togglePicker('effort')} style={(p) => [styles.configInlineField, p.pressed && styles.configRowPressed]}>
                                                <Text style={[styles.configLabel, styles.configInlineText, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                                                    {currentEffort?.name}
                                                </Text>
                                                <Ionicons name="chevron-down" size={12} color={theme.colors.textSecondary} />
                                            </Pressable>
                                        </>
                                    )}
                                </View>
                                {renderActivePickerPopover('agent')}
                                {renderActivePickerPopover('model')}
                                {renderActivePickerPopover('effort')}

                                {showPermission && (
                                    <Pressable
                                        style={(p) => [styles.configRow, p.pressed && styles.configRowPressed]}
                                        onPress={() => togglePicker('permission')}
                                    >
                                        <Ionicons
                                            name={permissionStyle?.icon ?? 'shield-outline'}
                                            size={15}
                                            color={theme.colors.textSecondary}
                                        />
                                        <Text style={[styles.configLabel, styles.configValueText]} numberOfLines={1}>
                                            {currentPermission?.name}
                                        </Text>
                                        <Ionicons name="chevron-down" size={13} color={theme.colors.textSecondary} />
                                    </Pressable>
                                )}
                                {renderActivePickerPopover('permission')}

                                {supportsWorktree && (
                                    <>
                                        <Pressable
                                            style={(p) => [styles.configRow, p.pressed && styles.configRowPressed]}
                                            onPress={() => togglePicker('worktree')}
                                        >
                                            <MaterialCommunityIcons name="tree" size={15} color={theme.colors.textSecondary} />
                                            <Text style={[styles.configLabel, styles.configValueText]} numberOfLines={1}>
                                                {worktreeLabel}
                                            </Text>
                                            <Ionicons name="chevron-down" size={13} color={theme.colors.textSecondary} />
                                        </Pressable>
                                        {renderActivePickerPopover('worktree')}
                                    </>
                                )}
                            </View>
                        </>
                    ) : (
                        <>
                            <View style={styles.configRowWithToggle}>
                                <Pressable
                                    style={(p) => [styles.collapsedRow, { flex: 1 }, p.pressed && styles.configRowPressed]}
                                    onPress={() => togglePicker('path')}
                                >
                                    <Ionicons name="folder-outline" size={15} color={theme.colors.textSecondary} />
                                    <Text style={[styles.configLabel, { flex: 1 }]} numberOfLines={1}>
                                        {pathName}
                                    </Text>
                                </Pressable>
                                <Pressable
                                    onPress={toggleConfig}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    style={(p) => [styles.collapseToggle, p.pressed && styles.configRowPressed]}
                                >
                                    <Ionicons name="chevron-down" size={16} color={theme.colors.textSecondary} />
                                </Pressable>
                            </View>
                            {renderActivePickerPopover('path')}

                            <View style={styles.collapsedIconsRow}>
                                <Pressable
                                    onPress={() => togglePicker('machine')}
                                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                                    style={(p) => [styles.collapsedIconButton, p.pressed && styles.configRowPressed]}
                                >
                                    <Ionicons name="desktop-outline" size={14} color={isOffline ? theme.colors.status.disconnected : theme.colors.textSecondary} />
                                </Pressable>

                                <Pressable
                                    onPress={() => togglePicker('agent')}
                                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                                    style={(p) => [styles.collapsedIconButton, p.pressed && styles.configRowPressed]}
                                >
                                    <RNImage
                                        source={agentIcons[agent.key]}
                                        style={[styles.collapsedAgentIcon, { tintColor: theme.colors.textSecondary }]}
                                        resizeMode="contain"
                                    />
                                </Pressable>

                                {showPermission && (
                                    <Pressable
                                        onPress={() => togglePicker('permission')}
                                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                                        style={(p) => [styles.collapsedIconButton, p.pressed && styles.configRowPressed]}
                                    >
                                        <Ionicons
                                            name={permissionStyle?.icon ?? 'shield-outline'}
                                            size={14}
                                            color={permissionStyle?.color ?? theme.colors.textSecondary}
                                        />
                                    </Pressable>
                                )}

                                {supportsWorktree && (
                                    <Pressable
                                        onPress={() => togglePicker('worktree')}
                                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                                        style={(p) => [styles.collapsedIconButton, p.pressed && styles.configRowPressed]}
                                    >
                                        <MaterialCommunityIcons name="tree" size={14} color={theme.colors.textSecondary} />
                                    </Pressable>
                                )}
                            </View>
                            {renderActivePickerPopover('machine')}
                            {renderActivePickerPopover('agent')}
                            {renderActivePickerPopover('permission')}
                            {renderActivePickerPopover('worktree')}

                            {isOffline && (
                                <View style={styles.offlineHelp}>
                                    <Ionicons name="cloud-offline-outline" size={14} color={theme.colors.status.disconnected} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.offlineHelpTitle, { color: theme.colors.status.disconnected }]}>
                                            {t('newSession.machineOffline')}
                                        </Text>
                                        <Text style={[styles.offlineHelpText, { color: theme.colors.textSecondary }]}>
                                            {t('machine.offlineHelp')}
                                            {'\n'}{t('newSession.switchMachinesHint')}
                                        </Text>
                                    </View>
                                </View>
                            )}
                        </>
                    )}
                </View>

                {/* Web inline: click-away layer behind the popover (inline layout only;
                    the sidebar layout's backdrop is owned by the host shell). Native
                    pickers expand inline under their row — no bottom sheet, no backdrop;
                    re-tapping the row or picking an option collapses them. */}
                {Platform.OS === 'web' && !isSidebar && activePicker && (
                    <Pressable
                        style={styles.clickAwayBackdropBehind}
                        onPress={dismissPicker}
                    />
                )}
            </>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    clickAwayBackdropBehind: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: -1,
    },
    configBox: {
        backgroundColor: theme.colors.input.background,
        borderRadius: Platform.select({ default: 16, android: 20 }),
        paddingVertical: 4,
        paddingHorizontal: 4,
        overflow: 'hidden',
    },
    configBoxWithPopover: {
        overflow: 'visible',
    },
    sidebarConfigBox: {
        backgroundColor: 'transparent',
        borderRadius: 0,
        paddingVertical: 0,
        paddingHorizontal: 0,
        overflow: 'visible',
    },
    popover: {
        borderRadius: 12,
        paddingVertical: 4,
        marginTop: 4,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        ...Platform.select({
            web: {
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.12)',
            },
            default: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.12,
                shadowRadius: 10,
                elevation: 8,
            },
        }),
    },
    sidebarPopover: {
        minWidth: 0,
        alignSelf: 'stretch',
        backgroundColor: 'transparent',
        borderRadius: 0,
        borderWidth: 0,
        overflow: 'hidden',
        paddingVertical: 0,
        marginTop: -2,
        marginRight: 6,
        marginBottom: 6,
        marginLeft: 24,
        ...Platform.select({
            web: {
                boxShadow: 'none',
            },
            default: {
                shadowOpacity: 0,
                elevation: 0,
            },
        }),
    },
    // Native inline picker: flush accordion under the row, mirroring the running
    // session's SessionInfoDropdown option list (subtle raised surface, no border).
    inlinePopover: {
        marginTop: 2,
        marginBottom: 4,
        marginHorizontal: 4,
        paddingHorizontal: 8,
        borderRadius: 12,
        borderWidth: 0,
        backgroundColor: theme.colors.surfaceHigh,
        shadowOpacity: 0,
        elevation: 0,
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
    configRowWithToggle: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    collapseToggle: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    collapsedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
    },
    collapsedIconsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingHorizontal: 4,
        paddingBottom: 8,
    },
    collapsedIconButton: {
        width: 34,
        height: 28,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    configRowPressed: {
        opacity: 0.6,
    },
    agentIcon: {
        width: 15,
        height: 15,
    },
    collapsedAgentIcon: {
        width: 14,
        height: 14,
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
    offlineHelp: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
    },
    offlineHelpTitle: {
        fontSize: 13,
        ...Typography.default('semiBold'),
        marginBottom: 4,
    },
    offlineHelpText: {
        fontSize: 12,
        lineHeight: 18,
        ...Typography.default(),
    },
}));

// Picker styles
const pickerStyles = {
    container: {
        paddingHorizontal: 16,
        paddingBottom: 8,
    } as const,
    embeddedContainer: {
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        alignSelf: 'stretch',
        paddingHorizontal: 0,
        paddingBottom: 2,
    } as const,
    title: {
        fontSize: 18,
        paddingVertical: 12,
        paddingHorizontal: 4,
        ...Typography.default('semiBold'),
        ...Platform.select({ web: { userSelect: 'none' } as any, default: {} }),
    } as const,
    titleRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
    },
    doneButtonPressable: {
        width: 44,
        height: 44,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    },
    doneButtonGlass: {
        width: 40,
        height: 36,
        borderRadius: 18,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        overflow: 'hidden' as const,
        borderWidth: 1,
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    searchRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        marginBottom: 8,
    },
    embeddedSearchRow: {
        width: '100%',
        minWidth: 0,
        paddingHorizontal: 4,
        paddingVertical: 8,
        borderRadius: 0,
        marginBottom: 4,
    } as const,
    searchInput: {
        flex: 1,
        minWidth: 0,
        fontSize: 15,
        padding: 0,
        ...Typography.default(),
        ...Platform.select({ web: { outlineStyle: 'none' } as any, default: {} }),
    } as const,
    pathInputRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 10,
        paddingHorizontal: 12,
        minHeight: 46,
        borderRadius: 12,
        marginBottom: 8,
        borderWidth: 1,
    },
    embeddedPathInputRow: {
        width: '100%',
        minWidth: 0,
        paddingHorizontal: 4,
        minHeight: 38,
        borderRadius: 0,
        borderWidth: 0,
        marginBottom: 4,
    } as const,
    pathInputField: {
        flex: 1,
        minWidth: 0,
    } as const,
    pathTextInput: {
        fontSize: 16,
        minHeight: 44,
        paddingVertical: 0,
        ...Typography.default(),
        ...Platform.select({
            android: { textAlignVertical: 'center' as const },
            web: { outlineStyle: 'none' } as any,
            default: {},
        }),
    } as const,
    embeddedPathTextInput: {
        fontSize: 15,
        minHeight: 34,
    } as const,
    pathMetaText: {
        fontSize: 13,
        paddingHorizontal: 4,
        paddingBottom: 8,
        ...Typography.default(),
        ...Platform.select({ web: { userSelect: 'none' } as any, default: {} }),
    } as const,
    sectionLabel: {
        fontSize: 13,
        paddingHorizontal: 4,
        paddingBottom: 8,
        ...Typography.default('semiBold'),
        ...Platform.select({ web: { userSelect: 'none' } as any, default: {} }),
    } as const,
    option: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderRadius: 12,
    },
    embeddedOption: {
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        paddingHorizontal: 4,
        paddingVertical: 8,
        borderRadius: 0,
    } as const,
    optionPressed: {
        opacity: 0.6,
    } as const,
    optionText: {
        minWidth: 0,
        flexShrink: 1,
        fontSize: 15,
        ...Typography.default(),
        ...Platform.select({ web: { userSelect: 'none' } as any, default: {} }),
    } as const,
    divider: {
        height: 1,
        marginHorizontal: 12,
        marginVertical: 4,
    } as const,
    optionList: {
        flexGrow: 0,
        flexShrink: 1,
    } as const,
    embeddedOptionList: {
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        maxHeight: 176,
    } as const,
    embeddedOptionListContent: {
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
    } as const,
    emptyText: {
        fontSize: 14,
        textAlign: 'center' as const,
        paddingVertical: 20,
        ...Typography.default(),
        ...Platform.select({ web: { userSelect: 'none' } as any, default: {} }),
    } as const,
    // --- Directory browser (point-and-click path picker) ---
    breadcrumbRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 6,
        paddingVertical: 6,
        marginBottom: 2,
    } as const,
    crumbBack: {
        width: 28,
        height: 28,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        borderRadius: 8,
    } as const,
    crumbScroll: {
        flex: 1,
        minWidth: 0,
    } as const,
    crumbScrollContent: {
        alignItems: 'center' as const,
        gap: 2,
        paddingRight: 8,
    } as const,
    crumbText: {
        fontSize: 14,
        maxWidth: 160,
        paddingHorizontal: 2,
        ...Typography.default('semiBold'),
        ...Platform.select({ web: { userSelect: 'none' } as any, default: {} }),
    } as const,
    crumbSep: {
        marginHorizontal: 1,
    } as const,
    browseLoading: {
        paddingVertical: 28,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    } as const,
    dirScroll: {
        maxHeight: 300,
        flexGrow: 0,
    } as const,
    selectButton: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        gap: 8,
        marginTop: 8,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
    } as const,
    selectButtonText: {
        fontSize: 15,
        ...Typography.default('semiBold'),
        ...Platform.select({ web: { userSelect: 'none' } as any, default: {} }),
    } as const,
};
