import * as React from 'react';
import { View, Text, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';

/**
 * 会话顶栏的「空间身份」chip：当会话属于某个「我的 Agent」专属空间时，替代通用机器 pill，
 * 显示该 Agent 头像(accent) + 名字 + 在线点 + 回退箭头，点击回到该空间页 `/space/<id>`。
 * 让「从空间进来的会话」保持空间感、随手能返回空间；accent 用 Agent 自身的 color。
 */
export const SessionSpaceChip = React.memo(({ name, glyph, color, online, onPress }: {
    name: string;
    glyph: string;
    color: string;
    online: boolean;
    onPress: () => void;
}) => {
    const { theme } = useUnistyles();
    return (
        <Pressable onPress={onPress} hitSlop={8} style={[styles.chip, { borderColor: color }]}>
            <View style={[styles.avatar, { backgroundColor: color }]}>
                <Text style={styles.glyph} numberOfLines={1}>{glyph}</Text>
            </View>
            <Text style={[styles.name, { color }]} numberOfLines={1}>{name}</Text>
            <View
                style={[
                    styles.dot,
                    { backgroundColor: online ? theme.colors.status.connected : theme.colors.status.disconnected },
                ]}
            />
            <Ionicons name="chevron-forward" size={13} color={color} />
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        maxWidth: 230,
        paddingVertical: 5,
        paddingLeft: 5,
        paddingRight: 10,
        borderRadius: 999,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
    },
    avatar: {
        width: 22,
        height: 22,
        borderRadius: 7,
        alignItems: 'center',
        justifyContent: 'center',
    },
    glyph: {
        color: '#FFFFFF',
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
    name: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        flexShrink: 1,
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
}));
