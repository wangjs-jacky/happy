import * as React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { useSetting, useAllMachines } from '@/sync/storage';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

/**
 * 「我的 Agent」配置列表页：展示已配置的 Agent，点击行进入编辑，顶部入口新建。
 * 每行左侧是色块 + 首字头像，副标题为「机器名 · 路径」。
 */
export default React.memo(function MyAgentsSettingsScreen() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const agents = useSetting('agents');
    const machines = useAllMachines({ includeOffline: true });

    const machineName = React.useCallback((machineId: string): string => {
        const machine = machines.find((m) => m.id === machineId);
        return machine?.metadata?.displayName ?? machine?.metadata?.host ?? (machine ? machineId : t('agents.machineMissing'));
    }, [machines]);

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <ItemGroup>
                <Item
                    title={t('agents.new')}
                    icon={<Ionicons name="add-circle-outline" size={29} color={theme.colors.accent} />}
                    onPress={() => router.push('/settings/my-agent-edit' as any)}
                />
            </ItemGroup>

            {agents.length === 0 ? (
                <View style={styles.empty}>
                    <Ionicons name="people-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={styles.emptyText}>{t('agents.empty')}</Text>
                </View>
            ) : (
                <ItemGroup title={t('agents.title')}>
                    {agents.map((agent) => (
                        <Item
                            key={agent.id}
                            title={agent.name}
                            subtitle={`${agent.kind === 'image-styles' ? `${t('agents.imageStyleAgent')} · ` : ''}${machineName(agent.machineId)} · ${agent.path}`}
                            leftElement={
                                <View style={[styles.avatar, { backgroundColor: agent.color }]}>
                                    <Text style={styles.avatarGlyph}>{agent.glyph}</Text>
                                </View>
                            }
                            onPress={() => router.push(`/settings/my-agent-edit?id=${agent.id}` as any)}
                        />
                    ))}
                </ItemGroup>
            )}
        </ItemList>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    avatar: {
        width: 29,
        height: 29,
        borderRadius: 7,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarGlyph: {
        color: '#FFFFFF',
        fontSize: 15,
        ...Typography.default('semiBold'),
    },
    empty: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 48,
        paddingHorizontal: 32,
        gap: 12,
    },
    emptyText: {
        fontSize: 15,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        ...Typography.default(),
    },
}));
