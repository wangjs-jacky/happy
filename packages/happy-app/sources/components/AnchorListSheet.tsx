import * as React from 'react';
import { View, Text, ScrollView, Pressable, useWindowDimensions, StyleSheet } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
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
 *
 * NOTE: styles use react-native's *native* StyleSheet, NOT unistyles'
 * `StyleSheet.create((theme) => ...)`. Inside BaseModal's KeyboardAvoidingView,
 * a unistyles stylesheet re-subscribes to the unistyles runtime (insets /
 * dimensions), and every keyboard-height change then re-renders this sheet,
 * which re-participates in the KeyboardAvoidingView layout, which changes the
 * height again — an unbounded loop that shows up as the sheet "jittering
 * violently" while the keyboard is open. Static native styles + inline theme
 * colours via `useUnistyles()` break that subscription loop.
 */
export const AnchorListSheet = React.memo(function AnchorListSheet(props: AnchorListSheetProps) {
    const { anchors, onSelect, onClose } = props;
    const { theme } = useUnistyles();
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
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface }, sheetFrame]}>
            <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
                <Text style={[styles.title, { color: theme.colors.text }]}>{t('session.anchorsTitle')}</Text>
                <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                    {t('session.anchorsSubtitle', { count: anchors.length })}
                </Text>
            </View>

            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {anchors.length === 0 ? (
                    <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                        {t('session.anchorsEmpty')}
                    </Text>
                ) : (
                    anchors.map((anchor) => (
                        <Pressable
                            key={anchor.id}
                            onPress={() => handlePick(anchor)}
                            style={({ pressed }) => [
                                styles.row,
                                { borderBottomColor: theme.colors.divider },
                                pressed && { backgroundColor: theme.colors.surfaceHigh },
                            ]}
                        >
                            <View style={[styles.ordinalBadge, { backgroundColor: theme.colors.surfaceHigh }]}>
                                <Text style={[styles.ordinalText, { color: theme.colors.fab.background }]}>
                                    {anchor.ordinal}
                                </Text>
                            </View>
                            <Text style={[styles.rowText, { color: theme.colors.text }]} numberOfLines={2}>
                                {anchor.text}
                            </Text>
                        </Pressable>
                    ))
                )}
            </ScrollView>
        </View>
    );
});

const styles = StyleSheet.create({
    sheet: {
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
    },
    title: {
        fontSize: 17,
        fontWeight: '600',
    },
    subtitle: {
        marginTop: 4,
        fontSize: 13,
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
    },
    ordinalBadge: {
        minWidth: 26,
        height: 26,
        borderRadius: 8,
        paddingHorizontal: 6,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 1,
    },
    ordinalText: {
        fontSize: 12,
        fontWeight: '700',
    },
    rowText: {
        flex: 1,
        fontSize: 14,
        lineHeight: 19,
    },
});
