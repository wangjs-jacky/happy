import * as React from 'react';
import { View, Text, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { Avatar } from '@/components/Avatar';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { Session } from '@/sync/storageTypes';
import {
    getSessionName,
    getSessionAvatarId,
    useSessionStatus,
    formatPathRelativeToHome,
    formatOSPlatform,
} from '@/utils/sessionUtils';
import { t } from '@/text';

/**
 * Read-only session info panel that drops down under the chat header when the
 * SessionHeaderChip is tapped. An already-running session can't switch its
 * machine/agent, so this only surfaces the current session's metadata plus a
 * shortcut into the full info screen. Renders its own full-screen backdrop so
 * a tap anywhere outside collapses it — mirrors ComposeHome's inline dropdown.
 */
interface SessionInfoDropdownProps {
    session: Session;
    agentLabel: string;
    online: boolean;
    /** Y offset where the panel/backdrop begin (header bottom = safeArea.top + headerHeight). */
    top: number;
    onClose: () => void;
    onViewDetails: () => void;
}

export const SessionInfoDropdown = React.memo(({ session, agentLabel, online, top, onClose, onViewDetails }: SessionInfoDropdownProps) => {
    const { theme } = useUnistyles();
    const status = useSessionStatus(session);
    const sessionName = getSessionName(session);
    const metadata = session.metadata;

    return (
        <>
            <Pressable style={[styles.backdrop, { top }]} onPress={onClose} />
            <View style={[styles.dropdown, { top }]}>
                <View style={styles.card}>
                    <View style={styles.headerRow}>
                        <Avatar id={getSessionAvatarId(session)} size={40} monochrome={!status.isConnected} flavor={metadata?.flavor} />
                        <View style={styles.headerText}>
                            <Text style={styles.name} numberOfLines={1}>{sessionName}</Text>
                            <View style={styles.statusRow}>
                                <View style={[styles.dot, { backgroundColor: online ? theme.colors.status.connected : theme.colors.status.disconnected }]} />
                                <Text style={styles.agent} numberOfLines={1}>
                                    {agentLabel} · {online ? t('status.online') : t('status.offline')}
                                </Text>
                            </View>
                        </View>
                    </View>

                    <ItemGroup>
                        {metadata?.host ? (
                            <Item
                                title={t('sessionInfo.host')}
                                subtitle={metadata.host}
                                icon={<Ionicons name="desktop-outline" size={29} color={theme.colors.textSecondary} />}
                                showChevron={false}
                            />
                        ) : null}
                        {metadata?.path ? (
                            <Item
                                title={t('sessionInfo.path')}
                                subtitle={formatPathRelativeToHome(metadata.path, metadata.homeDir)}
                                icon={<Ionicons name="folder-outline" size={29} color={theme.colors.textSecondary} />}
                                showChevron={false}
                            />
                        ) : null}
                        {metadata?.os ? (
                            <Item
                                title={t('sessionInfo.operatingSystem')}
                                subtitle={formatOSPlatform(metadata.os)}
                                icon={<Ionicons name="hardware-chip-outline" size={29} color={theme.colors.textSecondary} />}
                                showChevron={false}
                            />
                        ) : null}
                        <Item
                            title={t('sessionInfo.viewDetails')}
                            icon={<Ionicons name="information-circle-outline" size={29} color={theme.colors.text} />}
                            onPress={onViewDetails}
                        />
                    </ItemGroup>
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
    card: {
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        paddingBottom: 8,
        overflow: 'hidden',
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 12,
        elevation: 8,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 4,
    },
    headerText: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        ...Typography.default('semiBold'),
        fontSize: 16,
        color: theme.colors.text,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 3,
    },
    agent: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        flexShrink: 1,
    },
    dot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
    },
}));
