import * as React from 'react';
import { View, TextInput, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { useAllMachines } from '@/sync/storage';
import { scanSkills, type SkillEntry } from '@/sync/skills';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

export default React.memo(function SkillsScreen() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const machines = useAllMachines();

    const [selectedMachineId, setSelectedMachineId] = React.useState<string | null>(null);

    // Default selected machine to the first online machine; keep selection valid
    // as the machine list changes underneath us.
    React.useEffect(() => {
        if (machines.length === 0) {
            if (selectedMachineId !== null) setSelectedMachineId(null);
            return;
        }
        const stillValid = selectedMachineId && machines.some((m) => m.id === selectedMachineId);
        if (!stillValid) {
            setSelectedMachineId(machines[0].id);
        }
    }, [machines, selectedMachineId]);

    const [skills, setSkills] = React.useState<SkillEntry[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [query, setQuery] = React.useState('');
    // Bump to force a reload (retry) for the same machine.
    const [reloadToken, setReloadToken] = React.useState(0);

    React.useEffect(() => {
        if (!selectedMachineId) {
            setSkills([]);
            setLoading(false);
            setError(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            try {
                const result = await scanSkills(selectedMachineId);
                if (cancelled) return;
                setSkills(result);
            } catch (e) {
                if (cancelled) return;
                setError(e instanceof Error ? e.message : '扫描失败');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedMachineId, reloadToken]);

    const filtered = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return skills;
        return skills.filter((s) => {
            if (s.name.toLowerCase().includes(q)) return true;
            return s.triggers.some((t) => t.toLowerCase().includes(q));
        });
    }, [skills, query]);

    const personal = React.useMemo(() => filtered.filter((s) => s.source === 'personal'), [filtered]);
    const plugin = React.useMemo(() => filtered.filter((s) => s.source === 'plugin'), [filtered]);

    const openSkill = React.useCallback((skill: SkillEntry) => {
        router.push({
            pathname: '/settings/skill',
            params: { path: skill.path, machineId: selectedMachineId!, name: skill.name },
        } as any);
    }, [router, selectedMachineId]);

    const renderSkill = React.useCallback((skill: SkillEntry) => (
        <Item
            key={skill.path}
            title={skill.name}
            subtitle={skill.triggers.join(' · ') || skill.description}
            subtitleLines={2}
            icon={<Ionicons name="cube-outline" size={29} color={theme.colors.textSecondary} />}
            onPress={() => openSkill(skill)}
        />
    ), [openSkill, theme]);

    // No online machine: dead-end but with a clear hint, not an error.
    if (machines.length === 0) {
        return (
            <ItemList>
                <ItemGroup>
                    <Item
                        title="无在线机器，请先连接一台机器"
                        icon={<Ionicons name="desktop-outline" size={29} color={theme.colors.textSecondary} />}
                        showChevron={false}
                    />
                </ItemGroup>
            </ItemList>
        );
    }

    return (
        <ItemList>
            {/* Machine switcher (only when there is more than one) */}
            {machines.length > 1 && (
                <ItemGroup title="机器">
                    {machines.map((m) => {
                        const name = m.metadata?.displayName || m.metadata?.host || m.id;
                        const isSelected = m.id === selectedMachineId;
                        return (
                            <Item
                                key={m.id}
                                title={name}
                                icon={<Ionicons name="desktop-outline" size={29} color={theme.colors.textSecondary} />}
                                selected={isSelected}
                                showChevron={false}
                                rightElement={isSelected ? (
                                    <Ionicons name="checkmark" size={22} color={theme.colors.button.primary.background} />
                                ) : undefined}
                                onPress={() => setSelectedMachineId(m.id)}
                            />
                        );
                    })}
                </ItemGroup>
            )}

            {/* Search */}
            <View style={styles.searchContainer}>
                <View style={styles.searchBox}>
                    <Ionicons name="search" size={18} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
                    <TextInput
                        style={[
                            styles.searchInput,
                            Platform.OS === 'web' && ({ outlineStyle: 'none', outlineWidth: 0 } as any),
                        ]}
                        value={query}
                        onChangeText={setQuery}
                        placeholder="搜索名称或触发词…"
                        placeholderTextColor={theme.colors.input.placeholder}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                </View>
            </View>

            {/* Loading */}
            {loading && (
                <View style={styles.centered}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                </View>
            )}

            {/* Error — never a dead end, always offer retry */}
            {!loading && error && (
                <ItemGroup title="出错了" footer={error}>
                    <Item
                        title="扫描失败"
                        subtitle={error}
                        subtitleLines={3}
                        icon={<Ionicons name="alert-circle-outline" size={29} color="#FF3B30" />}
                        showChevron={false}
                    />
                    <Item
                        title="重试"
                        icon={<Ionicons name="refresh" size={29} color={theme.colors.button.primary.background} />}
                        onPress={() => setReloadToken((t) => t + 1)}
                        showChevron={false}
                    />
                </ItemGroup>
            )}

            {/* Success */}
            {!loading && !error && (
                <>
                    {personal.length === 0 && plugin.length === 0 && (
                        <ItemGroup>
                            <Item
                                title={query.trim() ? '无匹配的 Skills' : '未发现 Skills'}
                                icon={<Ionicons name="cube-outline" size={29} color={theme.colors.textSecondary} />}
                                showChevron={false}
                            />
                        </ItemGroup>
                    )}
                    {personal.length > 0 && (
                        <ItemGroup title="个人 Skills">
                            {personal.map(renderSkill)}
                        </ItemGroup>
                    )}
                    {plugin.length > 0 && (
                        <ItemGroup title="插件 Skills">
                            {plugin.map(renderSkill)}
                        </ItemGroup>
                    )}
                </>
            )}
        </ItemList>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    searchContainer: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 4,
    },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        paddingHorizontal: 12,
        height: 44,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        color: theme.colors.text,
        paddingVertical: 0,
    } as any,
    centered: {
        paddingVertical: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));
