import * as React from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { ImageAgentStylePreset } from './imageAgentPrompt';
import { getImageStylePreviewAsset } from './imageStylePreviewAssets';

type Props = {
    visible: boolean;
    styles: ImageAgentStylePreset[];
    selectedStyleId: string | null;
    onSelect: (style: ImageAgentStylePreset) => void;
    onClose: () => void;
};

function StylePreview({ styleId }: { styleId: string }) {
    const source = getImageStylePreviewAsset(styleId);

    if (!source) {
        return (
            <View style={galleryStyles.previewFallback}>
                <Ionicons name="image-outline" size={24} color={galleryStyles.previewFallbackIcon.color} />
            </View>
        );
    }

    return (
        <View style={galleryStyles.preview}>
            <Image source={source} resizeMode="cover" blurRadius={12} style={galleryStyles.previewBackdrop} />
            <View pointerEvents="none" style={galleryStyles.previewTint} />
            <Image source={source} resizeMode="contain" style={galleryStyles.previewImage} />
        </View>
    );
}

export const ImageStyleGallerySheet = React.memo(function ImageStyleGallerySheet(props: Props) {
    const safeArea = useSafeAreaInsets();
    const styles = galleryStyles;

    return (
        <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
            <Pressable style={styles.scrim} onPress={props.onClose} />
            <View style={[styles.sheet, { paddingBottom: safeArea.bottom + 12 }]}>
                <View style={styles.handle} />
                <View style={styles.header}>
                    <View style={styles.headerCopy}>
                        <Text style={styles.title} numberOfLines={1}>{t('agents.imageEffectGalleryTitle')}</Text>
                        <Text style={styles.subtitle} numberOfLines={1}>{t('agents.imageEffectGallerySubtitle')}</Text>
                    </View>
                    <Pressable onPress={props.onClose} hitSlop={8} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                        <Ionicons name="close" size={18} color={styles.closeIcon.color} />
                    </Pressable>
                </View>

                <ScrollView
                    style={styles.list}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                >
                    {props.styles.map((style) => {
                        const selected = props.selectedStyleId === style.id;
                        return (
                            <Pressable
                                key={style.id}
                                onPress={() => props.onSelect(style)}
                                style={({ pressed }) => [
                                    styles.card,
                                    selected && styles.cardSelected,
                                    pressed && styles.pressed,
                                ]}
                            >
                                <StylePreview styleId={style.id} />
                                <View style={styles.cardCopy}>
                                    <Text style={styles.cardTitle} numberOfLines={1}>{t(style.labelKey)}</Text>
                                    <Text style={styles.cardHint} numberOfLines={2}>{style.promptHint}</Text>
                                </View>
                                <View style={styles.cardFooter}>
                                    <Text style={styles.cardAction} numberOfLines={1}>
                                        {selected ? t('agents.imageEffectSelected') : t('agents.imageEffectApply')}
                                    </Text>
                                    <Ionicons
                                        name={selected ? 'checkmark-circle' : 'arrow-forward-circle-outline'}
                                        size={16}
                                        color={selected ? styles.selectedIcon.color : styles.cardAction.color}
                                    />
                                </View>
                            </Pressable>
                        );
                    })}
                </ScrollView>
            </View>
        </Modal>
    );
});

const galleryStyles = StyleSheet.create((theme) => ({
    scrim: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.48)',
    },
    sheet: {
        maxHeight: '82%',
        backgroundColor: theme.colors.groupped.background,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        paddingTop: 8,
        paddingHorizontal: 14,
    },
    handle: {
        alignSelf: 'center',
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: theme.colors.divider,
        marginBottom: 12,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
    },
    headerCopy: {
        flex: 1,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 17,
        color: theme.colors.text,
    },
    subtitle: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
    },
    closeIcon: {
        color: theme.colors.textSecondary,
    },
    list: {
        flexGrow: 0,
    },
    listContent: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        paddingBottom: 8,
    },
    card: {
        width: '48%',
        minHeight: 196,
        borderRadius: 14,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    cardSelected: {
        borderColor: theme.colors.accent,
    },
    pressed: {
        opacity: 0.76,
    },
    preview: {
        height: 124,
        overflow: 'hidden',
        backgroundColor: theme.colors.groupped.background,
    },
    previewBackdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        opacity: 0.72,
        transform: [{ scale: 1.08 }],
    },
    previewTint: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.18)',
    },
    previewImage: {
        width: '100%',
        height: '100%',
    },
    previewFallback: {
        height: 124,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
    },
    previewFallbackIcon: {
        color: theme.colors.textSecondary,
    },
    cardCopy: {
        paddingHorizontal: 10,
        paddingTop: 9,
        minHeight: 67,
    },
    cardTitle: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
    },
    cardHint: {
        ...Typography.default(),
        fontSize: 11,
        lineHeight: 15,
        color: theme.colors.textSecondary,
        marginTop: 3,
    },
    cardFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 10,
        paddingBottom: 10,
        gap: 8,
    },
    cardAction: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        color: theme.colors.text,
        flex: 1,
    },
    selectedIcon: {
        color: theme.colors.accent,
    },
}));
