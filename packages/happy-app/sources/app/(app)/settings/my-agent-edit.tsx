import * as React from 'react';
import { View, Text, TextInput, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { PathPickerContent, type PickerItem } from '@/components/SessionConfigPanel';
import { RoundButton } from '@/components/RoundButton';
import { useSettingMutable, useAllMachines, useSessions } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';
import { entityColor } from '@/components/entityColor';
import { Modal } from '@/modal';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { AgentLauncher, AgentPreset } from '@/components/agents/launchAgent';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import type { Session } from '@/sync/storageTypes';

/** 取名称第一个字形（grapheme-safe）作为默认头像字符；空则回退 '?'。 */
function firstGlyph(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return '?';
    return [...trimmed][0]!.toUpperCase();
}

/**
 * 新建 / 编辑「我的 Agent」表单。
 * 路由参数 id 为空 → 新建；带 id → 编辑该 Agent。
 * glyph/color 自动派生（首字 + entityColor），不暴露给用户编辑。
 */
export default React.memo(function AgentEditScreen() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const params = useLocalSearchParams<{ id?: string }>();
    const editingId = typeof params.id === 'string' && params.id.length > 0 ? params.id : null;

    const [agents, setAgents] = useSettingMutable('agents');
    const machines = useAllMachines({ includeOffline: true });
    const sessions = useSessions();

    const existing = React.useMemo(
        () => (editingId ? agents.find((a) => a.id === editingId) ?? null : null),
        [agents, editingId],
    );

    const [name, setName] = React.useState(existing?.name ?? '');
    const [machineId, setMachineId] = React.useState<string | null>(existing?.machineId ?? null);
    const [path, setPath] = React.useState(existing?.path ?? '~');
    // 编辑态预设：在持久化的 {label, prompt} 之外，为每行附加一个本地临时 _key（不落库），
    // 作为 React 列表的稳定 key——避免用数组下标做 key 时，删除非末行导致受控
    // TextInput 的光标/输入法状态串到错误的行上。保存时会剥离 _key。
    type PresetRow = { _key: string; label: string; prompt: string };
    const [presets, setPresets] = React.useState<PresetRow[]>(
        () => (existing?.presets ?? []).map((p) => ({ _key: randomUUID(), label: p.label, prompt: p.prompt })),
    );

    // Save 需要非空名称 + 已选机器；否则禁用保存按钮（路径为空时落库回退 '~'）。
    const canSave = name.trim().length > 0 && !!machineId;
    const selectedMachine = React.useMemo(
        () => machines.find((m) => m.id === machineId) ?? null,
        [machines, machineId],
    );
    const selectedMachineOnline = selectedMachine ? isMachineOnline(selectedMachine) : false;
    const pathItems = React.useMemo<PickerItem[]>(() => {
        if (!machineId || !sessions) {
            return [];
        }
        const paths = new Set<string>();
        for (const s of sessions) {
            if (typeof s === 'string') {
                continue;
            }
            const session = s as Session;
            if (session.metadata?.machineId === machineId && session.metadata?.path) {
                paths.add(session.metadata.path);
            }
        }
        const homeDir = selectedMachine?.metadata?.homeDir;
        return Array.from(paths).sort().map((p) => ({
            key: p,
            label: formatPathRelativeToHome(p, homeDir),
        }));
    }, [machineId, sessions, selectedMachine]);

    const updatePreset = React.useCallback((index: number, patch: Partial<AgentPreset>) => {
        setPresets((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    }, []);
    const removePreset = React.useCallback((index: number) => {
        setPresets((prev) => prev.filter((_, i) => i !== index));
    }, []);
    const addPreset = React.useCallback(() => {
        setPresets((prev) => [...prev, { _key: randomUUID(), label: '', prompt: '' }]);
    }, []);

    const handleSave = React.useCallback(() => {
        const trimmedName = name.trim();
        // Save 按钮在 !canSave 时已 disabled，这里仅作防御性提前返回（无需弹窗提示）。
        if (!trimmedName || !machineId) {
            return;
        }
        // Drop preset rows that are entirely blank. 落库前剥离临时 _key，保持 {label, prompt} 形状。
        const cleanedPresets = presets
            .map((p) => ({ label: p.label.trim(), prompt: p.prompt.trim() }))
            .filter((p) => p.label.length > 0 || p.prompt.length > 0);

        const id = existing?.id ?? randomUUID();
        const agent: AgentLauncher = {
            id,
            name: trimmedName,
            glyph: firstGlyph(trimmedName),
            color: existing?.color ?? entityColor(id),
            machineId,
            path: path.trim() || '~',
            presets: cleanedPresets,
        };

        // Preserve order on edit (replace in place); append when new.
        setAgents(
            existing
                ? agents.map((a) => (a.id === id ? agent : a))
                : [...agents, agent],
        );
        router.back();
    }, [name, machineId, path, presets, existing, agents, setAgents, router]);

    const handleDelete = React.useCallback(() => {
        if (!existing) return;
        Modal.alert(t('agents.delete'), t('agents.deleteConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('agents.delete'),
                style: 'destructive',
                onPress: () => {
                    setAgents(agents.filter((a) => a.id !== existing.id));
                    router.back();
                },
            },
        ]);
    }, [existing, agents, setAgents, router]);

    return (
        <>
            <Stack.Screen
                options={{
                    headerTitle: existing ? t('agents.editTitle') : t('agents.newTitle'),
                    headerRight: () => (
                        <RoundButton
                            title={t('agents.save')}
                            size="small"
                            disabled={!canSave}
                            onPress={handleSave}
                        />
                    ),
                }}
            />
            <ItemList style={{ paddingTop: 0 }}>
                {/* 名称 */}
                <ItemGroup title={t('agents.name')}>
                    <View style={styles.inputRow}>
                        <TextInput
                            style={[styles.input, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
                            value={name}
                            onChangeText={setName}
                            placeholder={t('agents.namePlaceholder')}
                            placeholderTextColor={theme.colors.input.placeholder}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    </View>
                </ItemGroup>

                {/* 机器 */}
                <ItemGroup title={t('agents.machine')}>
                    {machines.length === 0 ? (
                        <Item title={t('agents.noMachines')} disabled showChevron={false} />
                    ) : (
                        machines.map((m) => {
                            const label = m.metadata?.displayName ?? m.metadata?.host ?? m.id;
                            const selected = machineId === m.id;
                            return (
                                <Item
                                    key={m.id}
                                    title={label}
                                    subtitle={isMachineOnline(m) ? t('status.online') : t('agents.machineOffline')}
                                    onPress={() => setMachineId(m.id)}
                                    showChevron={false}
                                    rightElement={selected ? (
                                        <Ionicons name="checkmark" size={20} color={theme.colors.header.tint} />
                                    ) : undefined}
                                />
                            );
                        })
                    )}
                </ItemGroup>

                {/* 文件夹路径 */}
                <ItemGroup title={t('agents.folder')}>
                    <PathPickerContent
                        title={t('agents.folder')}
                        items={pathItems}
                        value={path}
                        homeDir={selectedMachine?.metadata?.homeDir}
                        machineId={machineId}
                        machineOnline={selectedMachineOnline}
                        onChangeValue={setPath}
                        embedded
                        manualInput={false}
                    />
                </ItemGroup>

                {/* 预设指令 */}
                <ItemGroup title={t('agents.presets')}>
                    {presets.map((preset, index) => (
                        <View key={preset._key} style={styles.presetRow}>
                            <View style={styles.presetInputs}>
                                <TextInput
                                    style={[styles.input, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
                                    value={preset.label}
                                    onChangeText={(v) => updatePreset(index, { label: v })}
                                    placeholder={t('agents.presetLabelPlaceholder')}
                                    placeholderTextColor={theme.colors.input.placeholder}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                                <TextInput
                                    style={[styles.input, styles.presetPrompt, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
                                    value={preset.prompt}
                                    onChangeText={(v) => updatePreset(index, { prompt: v })}
                                    placeholder={t('agents.presetPromptPlaceholder')}
                                    placeholderTextColor={theme.colors.input.placeholder}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    multiline
                                />
                            </View>
                            <Pressable
                                onPress={() => removePreset(index)}
                                hitSlop={8}
                                accessibilityRole="button"
                                accessibilityLabel={t('agents.delete')}
                                style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
                            >
                                <Ionicons name="remove-circle-outline" size={22} color={theme.colors.textDestructive} />
                            </Pressable>
                        </View>
                    ))}
                    <Item
                        title={t('agents.addPreset')}
                        icon={<Ionicons name="add-circle-outline" size={29} color={theme.colors.accent} />}
                        onPress={addPreset}
                        showChevron={false}
                    />
                </ItemGroup>

                {/* 删除（仅编辑模式） */}
                {existing && (
                    <ItemGroup>
                        <Item
                            title={t('agents.delete')}
                            icon={<Ionicons name="trash-outline" size={29} color={theme.colors.textDestructive} />}
                            destructive
                            onPress={handleDelete}
                            showChevron={false}
                        />
                    </ItemGroup>
                )}
            </ItemList>
        </>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    inputRow: {
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 16,
        paddingVertical: 6,
    },
    input: {
        fontSize: 16,
        color: theme.colors.text,
        paddingVertical: Platform.select({ ios: 10, default: 8 }),
        ...Typography.default(),
    } as any,
    mono: {
        ...Typography.mono(),
        fontSize: 14,
    },
    presetRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 8,
    },
    presetInputs: {
        flex: 1,
    },
    presetPrompt: {
        minHeight: 40,
        textAlignVertical: 'top',
    },
    removeBtn: {
        paddingTop: 10,
    },
    pressed: {
        opacity: 0.6,
    },
}));
