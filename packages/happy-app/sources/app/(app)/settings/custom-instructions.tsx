import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { randomUUID } from 'expo-crypto';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Switch } from '@/components/Switch';
import { Modal } from '@/modal';
import { useSettingMutable } from '@/sync/storage';

const ACCENT = '#FF2D55';
const DELETE_RED = '#FF3B30';
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

    // Edit an existing entry; empty input is treated as a no-op (swipe to delete instead).
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

    // Swipe-left reveals this red action; tapping it removes the entry immediately
    // (swipe + tap is deliberate enough, so no extra confirm dialog).
    const handleDelete = React.useCallback((id: string) => {
        setItems(items.filter((entry) => entry.id !== id));
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

            {/* Instruction entries — swipe left to delete */}
            <ItemGroup
                title="我的指令"
                footer="左滑删除。内置规则（如图片用 send_image 内联发送）已写在系统提示词里，无需在此重复。"
            >
                {items.map((entry) => (
                    <ReanimatedSwipeable
                        key={entry.id}
                        friction={2}
                        rightThreshold={40}
                        renderRightActions={(_progress, _translation, methods) => (
                            <Pressable
                                style={styles.deleteAction}
                                onPress={() => {
                                    methods.close();
                                    handleDelete(entry.id);
                                }}
                            >
                                <Ionicons name="trash-outline" size={22} color="#FFFFFF" />
                                <Text style={styles.deleteActionText}>删除</Text>
                            </Pressable>
                        )}
                    >
                        <Item
                            title={entry.text}
                            onPress={() => handleEdit(entry.id, entry.text)}
                            showChevron={false}
                            showDivider
                            style={styles.rowOpaque}
                        />
                    </ReanimatedSwipeable>
                ))}
                <Item
                    title="添加指令"
                    titleStyle={{ color: ACCENT }}
                    icon={<Ionicons name="add-circle-outline" size={29} color={ACCENT} />}
                    onPress={handleAdd}
                    showChevron={false}
                    showDivider={false}
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
    // Row must be opaque so the red delete action only shows in the vacated area while swiping.
    rowOpaque: {
        backgroundColor: theme.colors.surface,
    },
    deleteAction: {
        backgroundColor: DELETE_RED,
        width: 80,
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
    },
    deleteActionText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '600',
    },
}));
