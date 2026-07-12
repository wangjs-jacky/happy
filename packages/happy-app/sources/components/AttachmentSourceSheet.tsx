/**
 * Attachment source chooser rendered as a custom modal (via Modal.show).
 *
 * Replaces the plain OS-style alert row with a card picker: one card per source
 * (photo / audio-video), icon over label, matching the app's dark surface style.
 * Each card dismisses the sheet first, then runs its picker on the next tick so
 * the modal is gone before the system picker opens.
 */
import * as React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

interface AttachmentSourceSheetProps {
    onPickPhoto: () => void;
    onPickMedia: () => void;
    /** Injected by the modal host. */
    onClose?: () => void;
}

export function AttachmentSourceSheet({ onPickPhoto, onPickMedia, onClose }: AttachmentSourceSheetProps) {
    const { theme } = useUnistyles();

    const choose = React.useCallback((run: () => void) => {
        onClose?.();
        // Let the modal fully dismiss before the system picker takes over.
        setTimeout(run, 50);
    }, [onClose]);

    return (
        <View style={[styles.panel, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.title, { color: theme.colors.text }]}>
                {t('imageUpload.chooseSourceTitle')}
            </Text>
            <View style={styles.cardRow}>
                <SourceCard
                    icon="image-outline"
                    label={t('imageUpload.chooseSourcePhoto')}
                    theme={theme}
                    onPress={() => choose(onPickPhoto)}
                />
                <SourceCard
                    icon="film-outline"
                    label={t('imageUpload.chooseSourceMedia')}
                    theme={theme}
                    onPress={() => choose(onPickMedia)}
                />
            </View>
        </View>
    );
}

function SourceCard({
    icon,
    label,
    theme,
    onPress,
}: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    theme: any;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            style={(p) => [
                styles.card,
                { backgroundColor: theme.colors.surfaceHigh, borderColor: theme.colors.divider },
                p.pressed && { opacity: 0.7 },
            ]}
        >
            <Ionicons name={icon} size={26} color={theme.colors.text} />
            <Text style={[styles.cardLabel, { color: theme.colors.text }]} numberOfLines={2}>
                {label}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create(() => ({
    panel: {
        width: 320,
        maxWidth: '90%',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingTop: 18,
        paddingBottom: 16,
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 14,
    },
    cardRow: {
        flexDirection: 'row',
        gap: 12,
    },
    card: {
        flex: 1,
        height: 96,
        borderRadius: 16,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingHorizontal: 8,
    },
    cardLabel: {
        fontSize: 13,
        textAlign: 'center',
    },
}));
