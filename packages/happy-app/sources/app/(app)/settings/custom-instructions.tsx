import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { randomUUID } from 'expo-crypto';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Switch } from '@/components/Switch';
import { Modal } from '@/modal';
import { useSettingMutable } from '@/sync/storage';

const ACCENT = '#FF2D55';
const MAX_LEN = 4000;

export default React.memo(function CustomInstructionsScreen() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const [items, setItems] = useSettingMutable('customInstructions');
    const [enabled, setEnabled] = useSettingMutable('customInstructionsEnabled');

    // Add a new instruction entry via the shared prompt modal.
    const handleAdd = React.useCallback(async () => {
        const text = await Modal.prompt('添加指令', '会追加到每条消息的系统提示词', {
            placeholder: '例如：回复都用中文',
            confirmText: '保存',
            cancelText: '取消',
        });
        const trimmed = text?.trim();
        if (trimmed) {
            setItems([...items, { id: randomUUID(), text: trimmed.slice(0, MAX_LEN) }]);
        }
    }, [items, setItems]);

    // Edit an existing entry; empty input is treated as a no-op (use delete to remove).
    const handleEdit = React.useCallback(async (id: string, current: string) => {
        const text = await Modal.prompt('编辑指令', undefined, {
            defaultValue: current,
            confirmText: '保存',
            cancelText: '取消',
        });
        const trimmed = text?.trim();
        if (trimmed) {
            setItems(items.map((entry) => (entry.id === id ? { ...entry, text: trimmed.slice(0, MAX_LEN) } : entry)));
        }
    }, [items, setItems]);

    const handleDelete = React.useCallback(async (id: string) => {
        const ok = await Modal.confirm('删除指令', '确定删除这条指令？', { confirmText: '删除', destructive: true });
        if (ok) {
            setItems(items.filter((entry) => entry.id !== id));
        }
    }, [items, setItems]);

    return (
        <ItemList style={{ paddingTop: 0 }}>
            {/* Header card: big icon + title + description (Kimi-style) */}
            <View style={styles.headerCard}>
                <View style={styles.iconBadge}>
                    <Ionicons name="sparkles" size={34} color={ACCENT} />
                </View>
                <Text style={styles.cardTitle}>自定义指令</Text>
                <Text style={styles.cardSubtitle}>
                    你的偏好会追加到每条消息的系统提示词，对所有会话与设备生效（端到端同步）。
                </Text>
            </View>

            {/* Global enable toggle */}
            <ItemGroup>
                <Item
                    title="启用"
                    subtitle={enabled ? '指令会随消息一起发送' : '已关闭，指令暂不发送'}
                    icon={<Ionicons name="power-outline" size={29} color={ACCENT} />}
                    rightElement={<Switch value={enabled} onValueChange={setEnabled} />}
                    showChevron={false}
                />
            </ItemGroup>

            {/* Instruction entries */}
            <ItemGroup
                title="我的指令"
                footer="内置规则（如图片用 send_image 内联发送）已写在系统提示词里，无需在此重复。"
            >
                {items.map((entry) => (
                    <Item
                        key={entry.id}
                        title={entry.text}
                        onPress={() => handleEdit(entry.id, entry.text)}
                        showChevron={false}
                        rightElement={
                            <Ionicons
                                name="trash-outline"
                                size={22}
                                color={theme.colors.textSecondary}
                                onPress={() => handleDelete(entry.id)}
                                suppressHighlighting
                            />
                        }
                    />
                ))}
                <Item
                    title="添加指令"
                    titleStyle={{ color: ACCENT }}
                    icon={<Ionicons name="add-circle-outline" size={29} color={ACCENT} />}
                    onPress={handleAdd}
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    headerCard: {
        alignItems: 'center',
        paddingTop: 28,
        paddingBottom: 24,
        paddingHorizontal: 32,
    },
    iconBadge: {
        width: 72,
        height: 72,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
        marginBottom: 16,
    },
    cardTitle: {
        fontSize: 22,
        fontWeight: '700',
        color: theme.colors.text,
        marginBottom: 8,
    },
    cardSubtitle: {
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
}));
