import * as React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { ImageAgentStylePreset } from './imageAgentPrompt';

type Props = {
    visible: boolean;
    styles: ImageAgentStylePreset[];
    selectedStyleId: string | null;
    onSelect: (style: ImageAgentStylePreset) => void;
    onClose: () => void;
};

const PREVIEW_PALETTES: Record<string, [string, string, string]> = {
    'vintage-film': ['#4B2D1F', '#D9A36A', '#F2D8A5'],
    'premium-studio': ['#171717', '#A47148', '#F0E3D0'],
    'white-product': ['#F7F4EE', '#CFC7BC', '#7D7163'],
    'lifestyle-scene': ['#2F4B3A', '#B6854D', '#F0D7A6'],
    packaging: ['#6E4A2A', '#E9D9C3', '#B3834E'],
    'recipe-flow': ['#8A5A2B', '#EFE4C8', '#C89D64'],
    'step-infographic': ['#6C5137', '#F3E7D3', '#D0A85F'],
    'hand-drawn-info': ['#E8D9B5', '#725033', '#2D4057'],
    'bento-grid': ['#2A2018', '#B78B5E', '#F1E2CF'],
    'tvc-storyboard': ['#1C1815', '#D0A16B', '#5B3A24'],
    'cinematic-storyboard': ['#11151B', '#9B6A41', '#D8C5A6'],
    'mixed-styles': ['#2F241D', '#C88A4A', '#E8DCC9'],
    'brand-poster': ['#1E1714', '#C47C43', '#F3E7DA'],
    'campaign-kv': ['#211612', '#9E6B3D', '#DCC7AC'],
    'web-hero': ['#2B1D14', '#D4A15F', '#F3E0C7'],
    'editorial-cover': ['#3A261B', '#D5B382', '#F4E9D8'],
    'vintage-editorial': ['#7A5836', '#E5D1A8', '#2E241B'],
    'food-map': ['#355142', '#D0A364', '#EAD7B3'],
    'lookbook-grid': ['#211A16', '#B98755', '#EEE1CF'],
    'banner-grid': ['#402819', '#C69058', '#F0DFCB'],
    'retro-icons': ['#5A351F', '#C69A62', '#F4E1C5'],
};

function paletteForStyle(styleId: string): [string, string, string] {
    return PREVIEW_PALETTES[styleId] ?? ['#2A211A', '#A8794C', '#E7D5BD'];
}

function StylePreview({ styleId }: { styleId: string }) {
    const [dark, mid, light] = paletteForStyle(styleId);
    return (
        <View style={[galleryStyles.preview, { backgroundColor: dark }]}>
            <View style={[galleryStyles.previewGlow, { backgroundColor: mid }]} />
            <View style={[galleryStyles.previewPlate, { backgroundColor: light }]} />
            <View style={[galleryStyles.previewSubject, { backgroundColor: mid }]} />
            <View style={galleryStyles.previewDustRow}>
                <View style={[galleryStyles.previewDust, { backgroundColor: light }]} />
                <View style={[galleryStyles.previewDust, { backgroundColor: mid }]} />
                <View style={[galleryStyles.previewDust, { backgroundColor: light }]} />
            </View>
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
        height: 92,
        overflow: 'hidden',
        justifyContent: 'flex-end',
        padding: 10,
    },
    previewGlow: {
        position: 'absolute',
        width: 78,
        height: 78,
        borderRadius: 39,
        right: -10,
        top: -18,
        opacity: 0.48,
    },
    previewPlate: {
        width: '82%',
        height: 19,
        borderRadius: 10,
        alignSelf: 'center',
        opacity: 0.92,
    },
    previewSubject: {
        position: 'absolute',
        left: 26,
        right: 26,
        bottom: 24,
        height: 28,
        borderRadius: 8,
        opacity: 0.95,
    },
    previewDustRow: {
        position: 'absolute',
        top: 12,
        left: 12,
        flexDirection: 'row',
        gap: 4,
    },
    previewDust: {
        width: 5,
        height: 5,
        borderRadius: 3,
        opacity: 0.85,
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
