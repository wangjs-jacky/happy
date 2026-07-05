import * as React from 'react';
import { View, Text, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';
import { getDuplicateSheetFrame } from '@/utils/duplicateSheetLayout';
import type { UserMessageAnchor } from '@/hooks/useUserMessageAnchors';
import { hapticsLight } from './haptics';

export interface AnchorListSheetProps {
    anchors: UserMessageAnchor[];
    /** Called with the chosen anchor so the chat can scroll to it. */
    onSelect: (anchor: UserMessageAnchor) => void;
    /** Injected by the modal infra. */
    onClose?: () => void;
}

/**
 * Table-of-contents sheet listing every message the user sent. Tap a row to
 * jump the chat to that message. Rows are oldest-first (the order the anchors
 * arrive in) so reading top-to-bottom matches the conversation timeline.
 */
export const AnchorListSheet = React.memo(function AnchorListSheet(props: AnchorListSheetProps) {
    const { anchors, onSelect, onClose } = props;
    const windowSize = useWindowDimensions();
    const sheetFrame = React.useMemo(
        () => getDuplicateSheetFrame(windowSize),
        [windowSize.width, windowSize.height],
    );

    const handlePick = React.useCallback((anchor: UserMessageAnchor) => {
        hapticsLight();
        onSelect(anchor);
        onClose?.();
    }, [onSelect, onClose]);

    return (
        <View style={[styles.sheet, sheetFrame]}>
            <View style={styles.header}>
                <Text style={styles.title}>{t('session.anchorsTitle')}</Text>
                <Text style={styles.subtitle}>{t('session.anchorsSubtitle', { count: anchors.length })}</Text>
            </View>

            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {anchors.length === 0 ? (
                    <Text style={styles.emptyText}>{t('session.anchorsEmpty')}</Text>
                ) : (
                    anchors.map((anchor) => (
                        <Pressable
                            key={anchor.id}
                            onPress={() => handlePick(anchor)}
                            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                        >
                            <View style={styles.ordinalBadge}>
                                <Text style={styles.ordinalText}>{anchor.ordinal}</Text>
                            </View>
                            <Text style={styles.rowText} numberOfLines={2}>
                                {anchor.text}
                            </Text>
                        </Pressable>
                    ))
                )}
            </ScrollView>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    sheet: {
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        overflow: 'hidden',
        alignSelf: 'center',
        minWidth: 0,
    },
    header: {
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    title: {
        fontSize: 17,
        fontWeight: '600' as const,
        color: theme.colors.text,
    },
    subtitle: {
        marginTop: 4,
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    list: {
        flexGrow: 0,
        flexShrink: 1,
        maxHeight: 480,
        minHeight: 0,
    },
    listContent: {
        paddingVertical: 4,
    },
    emptyText: {
        textAlign: 'center',
        color: theme.colors.textSecondary,
        paddingVertical: 32,
        paddingHorizontal: 20,
        fontSize: 14,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    rowPressed: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    ordinalBadge: {
        minWidth: 26,
        height: 26,
        borderRadius: 8,
        paddingHorizontal: 6,
        backgroundColor: theme.colors.surfaceHigh,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 1,
    },
    ordinalText: {
        fontSize: 12,
        fontWeight: '700' as const,
        color: theme.colors.fab.background,
    },
    rowText: {
        flex: 1,
        fontSize: 14,
        color: theme.colors.text,
        lineHeight: 19,
    },
}));
