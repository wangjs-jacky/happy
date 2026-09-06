import * as React from 'react';
import { Modal, Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';
import { UsagePanel } from './UsagePanel';

const VIEWPORT_GUTTER = 12;
const DESKTOP_WIDTH = 560;
const DESKTOP_MAX_HEIGHT = 720;

export function getUsageDialogLayout(viewport: { height: number; width: number }): {
    height: number;
    width: number;
} {
    const availableWidth = Math.max(0, viewport.width - VIEWPORT_GUTTER * 2);
    const availableHeight = Math.max(0, viewport.height - VIEWPORT_GUTTER * 2);
    const narrow = viewport.width < 600;

    return {
        height: narrow
            ? availableHeight
            : Math.min(DESKTOP_MAX_HEIGHT, Math.floor(viewport.height * 0.8), availableHeight),
        width: narrow ? availableWidth : Math.min(DESKTOP_WIDTH, availableWidth),
    };
}

export const UsageDialog = React.memo(function UsageDialog(props: {
    onClose: () => void;
    open: boolean;
    returnFocusRef?: React.RefObject<{ focus?: () => void } | null>;
}) {
    const viewport = useWindowDimensions();
    const closeButtonRef = React.useRef<any>(null);
    const layout = React.useMemo(
        () => getUsageDialogLayout(viewport),
        [viewport.height, viewport.width],
    );
    const closeAndRestoreFocus = React.useCallback(() => {
        props.onClose();
        if (Platform.OS === 'web') {
            setTimeout(() => props.returnFocusRef?.current?.focus?.(), 0);
        }
    }, [props.onClose, props.returnFocusRef]);

    React.useEffect(() => {
        if (Platform.OS !== 'web' || !props.open) return;
        const timeout = setTimeout(() => closeButtonRef.current?.focus?.(), 0);
        return () => clearTimeout(timeout);
    }, [props.open]);

    const handleKeyDown = React.useCallback((event: {
        nativeEvent?: { key?: string };
        preventDefault?: () => void;
        stopPropagation?: () => void;
    }) => {
        if (event.nativeEvent?.key !== 'Escape') return;
        event.preventDefault?.();
        event.stopPropagation?.();
        closeAndRestoreFocus();
    }, [closeAndRestoreFocus]);

    if (!props.open) return null;

    return (
        <Modal
            accessibilityLabel={t('settings.usage')}
            animationType={Platform.OS === 'web' ? 'none' : 'fade'}
            onRequestClose={closeAndRestoreFocus}
            transparent
            visible
        >
            <View accessibilityViewIsModal style={styles.overlay}>
                <Pressable
                    accessibilityLabel={t('common.cancel')}
                    onPress={closeAndRestoreFocus}
                    style={styles.scrim}
                    testID="sidebar-account-usage-dialog-backdrop"
                />
                <View
                    accessibilityViewIsModal
                    style={[
                        styles.dialog,
                        layout,
                    ]}
                    testID="sidebar-account-usage-dialog"
                    {...(Platform.OS === 'web' ? {
                        'aria-modal': true,
                        onKeyDown: handleKeyDown,
                        role: 'dialog',
                    } as any : {})}
                >
                    <View style={styles.header}>
                        <Text style={styles.title}>{t('settings.usage')}</Text>
                        <Pressable
                            ref={closeButtonRef}
                            accessibilityLabel={t('common.cancel')}
                            accessibilityRole="button"
                            hitSlop={8}
                            onPress={closeAndRestoreFocus}
                            style={({ pressed }) => [
                                styles.closeButton,
                                pressed && styles.closeButtonPressed,
                            ]}
                            testID="sidebar-account-usage-dialog-close"
                        >
                            <Text style={styles.closeGlyph}>×</Text>
                        </Pressable>
                    </View>
                    <View style={styles.body} testID="sidebar-account-usage-dialog-content">
                        <UsagePanel />
                    </View>
                </View>
            </View>
        </Modal>
    );
});

const styles = StyleSheet.create((theme) => ({
    overlay: {
        alignItems: 'center',
        flex: 1,
        justifyContent: 'center',
        padding: VIEWPORT_GUTTER,
        position: 'relative',
    },
    scrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: theme.colors.shadow.color,
        opacity: 0.34,
    },
    dialog: {
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.divider,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        elevation: 12,
        overflow: 'hidden',
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { height: 12, width: 0 },
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 32,
    },
    header: {
        alignItems: 'center',
        borderBottomColor: theme.colors.divider,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: 'row',
        justifyContent: 'space-between',
        minHeight: 52,
        paddingHorizontal: 14,
    },
    title: {
        color: theme.colors.text,
        fontSize: 15,
        fontWeight: '700',
    },
    closeButton: {
        alignItems: 'center',
        borderRadius: 8,
        color: theme.colors.textSecondary,
        height: 30,
        justifyContent: 'center',
        width: 30,
    },
    closeButtonPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    closeGlyph: {
        color: theme.colors.textSecondary,
        fontSize: 22,
        lineHeight: 24,
    },
    body: {
        flex: 1,
        minHeight: 0,
    },
}));
