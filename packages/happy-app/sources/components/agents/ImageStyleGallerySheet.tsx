import * as React from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { ImageAgentStylePreset } from './imageAgentPrompt';
import { IMAGE_AGENT_STYLE_CATEGORIES, getImageAgentStyleLabel } from './imageAgentPrompt';
import { getImageStylePreviewAsset } from './imageStylePreviewAssets';
import {
    IMAGE_STYLE_GALLERY_COLUMN_COUNT,
    IMAGE_STYLE_GALLERY_COLUMN_GAP,
    getImageStyleGalleryItemType,
    getImageStylePreviewHeight,
} from './imageStyleGalleryLayout';
import { IMAGE_STYLE_PREVIEW_MANIFEST } from './imageStylePreviewManifest';

type Props = {
    visible: boolean;
    styles: ImageAgentStylePreset[];
    selectedStyleId: string | null;
    onSelect: (style: ImageAgentStylePreset) => void;
    onClose: () => void;
};

const ALL_CATEGORY_ID = 'all';
const SHEET_HORIZONTAL_PADDING = 28;

function StylePreview({ styleId, cardWidth }: { styleId: string; cardWidth: number }) {
    const source = getImageStylePreviewAsset(styleId);
    const preview = IMAGE_STYLE_PREVIEW_MANIFEST[styleId];
    const previewHeight = preview ? getImageStylePreviewHeight(preview, cardWidth) : 140;

    if (!source) {
        return (
            <View style={[galleryStyles.previewFallback, { height: previewHeight }]}>
                <Ionicons name="image-outline" size={24} color={galleryStyles.previewFallbackIcon.color} />
            </View>
        );
    }

    return (
        <View style={[galleryStyles.preview, { height: previewHeight }]}>
            <Image source={source} resizeMode="cover" style={galleryStyles.previewImage} />
        </View>
    );
}

export const ImageStyleGallerySheet = React.memo(function ImageStyleGallerySheet(props: Props) {
    const safeArea = useSafeAreaInsets();
    const windowDimensions = useWindowDimensions();
    const styles = galleryStyles;
    const [categoryId, setCategoryId] = React.useState(ALL_CATEGORY_ID);
    const cardWidth = React.useMemo(() => Math.max(
        140,
        Math.floor((windowDimensions.width - SHEET_HORIZONTAL_PADDING - IMAGE_STYLE_GALLERY_COLUMN_GAP) / 2),
    ), [windowDimensions.width]);
    const visibleCategoryIds = React.useMemo(() => new Set(props.styles.map((style) => style.categoryId)), [props.styles]);
    const categoryOptions = React.useMemo(
        () => IMAGE_AGENT_STYLE_CATEGORIES.filter((category) => visibleCategoryIds.has(category.id)),
        [visibleCategoryIds],
    );
    const filteredStyles = React.useMemo(
        () => categoryId === ALL_CATEGORY_ID
            ? props.styles
            : props.styles.filter((style) => style.categoryId === categoryId),
        [categoryId, props.styles],
    );

    React.useEffect(() => {
        if (categoryId !== ALL_CATEGORY_ID && !visibleCategoryIds.has(categoryId)) {
            setCategoryId(ALL_CATEGORY_ID);
        }
    }, [categoryId, visibleCategoryIds]);

    const getItemType = React.useCallback((style: ImageAgentStylePreset) => {
        const preview = IMAGE_STYLE_PREVIEW_MANIFEST[style.id];
        return preview ? getImageStyleGalleryItemType(preview) : 'fallback';
    }, []);

    const renderStyle = React.useCallback(({ item: style }: { item: ImageAgentStylePreset }) => {
        const selected = props.selectedStyleId === style.id;
        return (
            <View style={styles.cell}>
                <Pressable
                    onPress={() => props.onSelect(style)}
                    style={({ pressed }) => [
                        styles.card,
                        selected && styles.cardSelected,
                        pressed && styles.pressed,
                    ]}
                >
                    <StylePreview styleId={style.id} cardWidth={cardWidth} />
                    <View style={styles.cardCopy}>
                        <Text style={styles.cardTitle} numberOfLines={2}>{getImageAgentStyleLabel(style)}</Text>
                        <Text style={styles.cardMeta} numberOfLines={1}>
                            {style.categoryLabel}
                            {' · '}
                            {style.templateLabel}
                        </Text>
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
            </View>
        );
    }, [cardWidth, props, styles]);

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
                    horizontal
                    style={styles.categoryScroller}
                    contentContainerStyle={styles.categoryContent}
                    showsHorizontalScrollIndicator={false}
                >
                    <Pressable
                        onPress={() => setCategoryId(ALL_CATEGORY_ID)}
                        style={({ pressed }) => [
                            styles.categoryChip,
                            categoryId === ALL_CATEGORY_ID && styles.categoryChipSelected,
                            pressed && styles.pressed,
                        ]}
                    >
                        <Text
                            style={[
                                styles.categoryLabel,
                                categoryId === ALL_CATEGORY_ID && styles.categoryLabelSelected,
                            ]}
                            numberOfLines={1}
                        >
                            {t('agents.imageEffectAll')}
                        </Text>
                    </Pressable>
                    {categoryOptions.map((category) => {
                        const selected = categoryId === category.id;
                        return (
                            <Pressable
                                key={category.id}
                                onPress={() => setCategoryId(category.id)}
                                style={({ pressed }) => [
                                    styles.categoryChip,
                                    selected && styles.categoryChipSelected,
                                    pressed && styles.pressed,
                                ]}
                            >
                                <View style={[styles.categoryDot, { backgroundColor: category.accent }]} />
                                <Text
                                    style={[
                                        styles.categoryLabel,
                                        selected && styles.categoryLabelSelected,
                                    ]}
                                    numberOfLines={1}
                                >
                                    {category.label}
                                </Text>
                                <Text style={styles.categoryCount} numberOfLines={1}>{category.count}</Text>
                            </Pressable>
                        );
                    })}
                </ScrollView>

                <FlashList
                    style={styles.list}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    data={filteredStyles}
                    keyExtractor={(style) => style.id}
                    numColumns={IMAGE_STYLE_GALLERY_COLUMN_COUNT}
                    masonry
                    getItemType={getItemType}
                    renderItem={renderStyle}
                    extraData={{ selectedStyleId: props.selectedStyleId, cardWidth }}
                />
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
        marginBottom: 10,
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
        paddingBottom: 8,
    },
    categoryScroller: {
        flexGrow: 0,
        overflow: 'visible',
        marginBottom: 12,
    },
    categoryContent: {
        gap: 8,
        paddingRight: 24,
        paddingVertical: 2,
    },
    categoryChip: {
        minHeight: 38,
        borderRadius: 19,
        paddingHorizontal: 12,
        alignItems: 'center',
        flexDirection: 'row',
        gap: 6,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    categoryChipSelected: {
        borderColor: theme.colors.accent,
    },
    categoryDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
    },
    categoryLabel: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        lineHeight: 18,
        color: theme.colors.textSecondary,
        maxWidth: 156,
    },
    categoryLabelSelected: {
        color: theme.colors.text,
    },
    categoryCount: {
        ...Typography.mono(),
        fontSize: 11,
        lineHeight: 18,
        color: theme.colors.textSecondary,
    },
    cell: {
        paddingHorizontal: 5,
        paddingBottom: 12,
    },
    card: {
        width: '100%',
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
        overflow: 'hidden',
        backgroundColor: theme.colors.groupped.background,
    },
    previewImage: {
        width: '100%',
        height: '100%',
    },
    previewFallback: {
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
        minHeight: 92,
    },
    cardTitle: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        lineHeight: 17,
        color: theme.colors.text,
    },
    cardMeta: {
        ...Typography.default('semiBold'),
        fontSize: 10,
        lineHeight: 14,
        color: theme.colors.textSecondary,
        marginTop: 4,
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
