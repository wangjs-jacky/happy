import * as React from 'react';
import { Modal, Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { BrowserStepsPanel } from './BrowserStepsPanel';
import type { BrowserStep } from './browserStepsModel';

export type BrowserStepsAnchorRect = {
    height: number;
    width: number;
    x: number;
    y: number;
};

const VIEWPORT_GUTTER = 12;
const ANCHOR_GAP = 8;
const DESKTOP_WIDTH = 520;

export function getBrowserStepsPopoverLayout(
    anchor: BrowserStepsAnchorRect | undefined,
    viewport: { height: number; width: number },
): { height: number; left: number; top: number; width: number } {
    const narrow = viewport.width < 600;
    const width = narrow
        ? Math.max(0, viewport.width - VIEWPORT_GUTTER * 2)
        : Math.min(DESKTOP_WIDTH, Math.max(0, viewport.width - VIEWPORT_GUTTER * 2));
    const height = narrow
        ? Math.max(0, viewport.height - VIEWPORT_GUTTER * 2)
        : Math.min(720, Math.floor(viewport.height * 0.72), Math.max(0, viewport.height - VIEWPORT_GUTTER * 2));

    if (narrow || !anchor) {
        return {
            height,
            left: narrow ? VIEWPORT_GUTTER : Math.max(VIEWPORT_GUTTER, Math.floor((viewport.width - width) / 2)),
            top: narrow ? VIEWPORT_GUTTER : Math.max(VIEWPORT_GUTTER, Math.floor((viewport.height - height) / 2)),
            width,
        };
    }

    const roomOnRight = viewport.width - VIEWPORT_GUTTER - (anchor.x + anchor.width + ANCHOR_GAP);
    const preferredLeft = roomOnRight >= width
        ? anchor.x + anchor.width + ANCHOR_GAP
        : anchor.x - width - ANCHOR_GAP;
    const left = Math.min(
        Math.max(VIEWPORT_GUTTER, preferredLeft),
        Math.max(VIEWPORT_GUTTER, viewport.width - width - VIEWPORT_GUTTER),
    );
    const roomBelow = viewport.height - VIEWPORT_GUTTER - (anchor.y + anchor.height + ANCHOR_GAP);
    const preferredTop = roomBelow >= height
        ? anchor.y + anchor.height + ANCHOR_GAP
        : anchor.y - height - ANCHOR_GAP;
    const top = Math.min(
        Math.max(VIEWPORT_GUTTER, preferredTop),
        Math.max(VIEWPORT_GUTTER, viewport.height - height - VIEWPORT_GUTTER),
    );

    return { height, left, top, width };
}

export const BrowserStepsPopover = React.memo(function BrowserStepsPopover(props: {
    anchor?: BrowserStepsAnchorRect;
    dialogId?: string;
    open: boolean;
    onClose: () => void;
    returnFocusRef?: React.RefObject<{ focus?: () => void } | null>;
    sessionId: string;
    steps: BrowserStep[];
}) {
    const { theme } = useUnistyles();
    const viewport = useWindowDimensions();
    const layout = React.useMemo(
        () => getBrowserStepsPopoverLayout(props.anchor, viewport),
        [props.anchor, viewport.height, viewport.width],
    );
    const closeAndRestoreFocus = React.useCallback(() => {
        props.onClose();
        if (Platform.OS === 'web') {
            setTimeout(() => props.returnFocusRef?.current?.focus?.(), 0);
        }
    }, [props.onClose, props.returnFocusRef]);

    if (!props.open) return null;
    return (
        <Modal
            accessibilityLabel={t('rightPanelCapabilityHub.browserProgress.title')}
            animationType={Platform.OS === 'web' ? 'none' : 'fade'}
            nativeID={props.dialogId}
            onRequestClose={closeAndRestoreFocus}
            transparent
            visible
        >
            <View style={styles.overlay}>
                <Pressable
                    accessibilityLabel={t('rightPanelCapabilityHub.browserProgress.close')}
                    onPress={closeAndRestoreFocus}
                    style={[styles.scrim, { backgroundColor: theme.colors.shadow.color }]}
                    testID="browser-steps-popover-backdrop"
                />
                <View
                    style={[
                        styles.card,
                        layout,
                        {
                            backgroundColor: theme.colors.surface,
                            borderColor: theme.colors.divider,
                            shadowColor: theme.colors.shadow.color,
                            shadowOpacity: theme.colors.shadow.opacity,
                        },
                    ]}
                    testID="browser-steps-popover"
                >
                    <View
                        style={[styles.header, { borderBottomColor: theme.colors.divider }]}
                        testID="browser-steps-popover-header"
                    >
                        <Text style={[styles.title, { color: theme.colors.text }]}>
                            {t('rightPanelCapabilityHub.browserProgress.title')}
                        </Text>
                        <Pressable
                            accessibilityLabel={t('rightPanelCapabilityHub.browserProgress.close')}
                            accessibilityRole="button"
                            hitSlop={8}
                            onPress={closeAndRestoreFocus}
                            style={({ pressed }) => [
                                styles.closeButton,
                                { backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surface },
                            ]}
                            testID="browser-steps-popover-close"
                        >
                            <Ionicons color={theme.colors.textSecondary} name="close" size={18} />
                        </Pressable>
                    </View>
                    <View style={styles.body} testID="browser-steps-popover-content">
                        <BrowserStepsPanel sessionId={props.sessionId} steps={props.steps} />
                    </View>
                </View>
            </View>
        </Modal>
    );
});

const styles = StyleSheet.create(() => ({
    overlay: { flex: 1, position: 'relative' },
    scrim: { ...StyleSheet.absoluteFillObject, opacity: 0.28 },
    card: {
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        elevation: 12,
        overflow: 'hidden',
        position: 'absolute',
        shadowOffset: { height: 12, width: 0 },
        shadowRadius: 32,
    },
    header: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 11 },
    body: { flex: 1, minHeight: 0 },
    closeButton: { alignItems: 'center', borderRadius: 8, height: 30, justifyContent: 'center', width: 30 },
    title: { fontSize: 15, fontWeight: '700' },
}));
