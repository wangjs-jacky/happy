import * as React from 'react';
import { FlatList, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useRouter } from 'expo-router';
import { useGeneratedImages, type GeneratedImageEntry } from '@/hooks/useGeneratedImages';
import { useAttachmentImage } from '@/hooks/useAttachmentImage';
import { imageViewer } from '@/sync/imageViewer';
import { t } from '@/text';
import { thumbhashToDataUri } from '@/utils/thumbhash';
import { layout } from '@/components/layout';

const CARD_GAP = 10;
const MIN_CARD_WIDTH = 154;

export default React.memo(function GeneratedImagesScreen() {
    const { theme } = useUnistyles();
    const dimensions = useWindowDimensions();
    const images = useGeneratedImages();
    const contentWidth = Math.min(layout.maxWidth, dimensions.width);
    const columns = Math.max(2, Math.floor((contentWidth - 32 + CARD_GAP) / (MIN_CARD_WIDTH + CARD_GAP)));
    const cardWidth = Math.floor((contentWidth - 32 - CARD_GAP * (columns - 1)) / columns);
    const cardHeight = Math.round(cardWidth * 1.92);

    const renderItem = React.useCallback(({ item, index }: { item: GeneratedImageEntry; index: number }) => (
        <GeneratedImageCard
            item={item}
            cardWidth={cardWidth}
            cardHeight={cardHeight}
            isLastColumn={(index + 1) % columns === 0}
        />
    ), [cardHeight, cardWidth, columns]);

    if (images.length === 0) {
        return (
            <View style={[styles.empty, { backgroundColor: theme.colors.groupped.background }]}>
                <Ionicons name="images-outline" size={42} color={theme.colors.textSecondary} />
                <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
                    {t('generatedImages.emptyTitle')}
                </Text>
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                    {t('generatedImages.emptyDescription')}
                </Text>
            </View>
        );
    }

    return (
        <FlatList
            data={images}
            extraData={`${columns}:${cardWidth}`}
            key={columns}
            keyExtractor={(item) => item.id}
            numColumns={columns}
            renderItem={renderItem}
            style={[styles.container, { backgroundColor: theme.colors.groupped.background }]}
            contentContainerStyle={[styles.content, { maxWidth: layout.maxWidth }]}
            ListHeaderComponent={(
                <View style={styles.header}>
                    <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                        {t('generatedImages.title')}
                    </Text>
                    <Text style={[styles.headerSubtitle, { color: theme.colors.textSecondary }]}>
                        {t('generatedImages.subtitle', { count: images.length })}
                    </Text>
                </View>
            )}
        />
    );
});

const GeneratedImageCard = React.memo(function GeneratedImageCard(props: {
    item: GeneratedImageEntry;
    cardWidth: number;
    cardHeight: number;
    isLastColumn: boolean;
}) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { item, cardHeight, cardWidth } = props;
    const { uri } = useAttachmentImage(item.sessionId, item.ref);
    const placeholder = React.useMemo(() => {
        if (!item.thumbhash) return undefined;
        const uri = thumbhashToDataUri(item.thumbhash);
        return uri ? { uri } : undefined;
    }, [item.thumbhash]);
    const prompt = item.prompt?.trim();
    const imageHeight = Math.round(cardWidth * 1.15);

    const openImage = React.useCallback(() => {
        if (!uri) return;
        imageViewer.open({
            uri,
            width: item.width,
            height: item.height,
            filename: item.name,
        });
    }, [item.height, item.name, item.width, uri]);

    return (
        <View
            style={[
                styles.card,
                {
                    width: cardWidth,
                    height: cardHeight,
                    marginRight: props.isLastColumn ? 0 : CARD_GAP,
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.divider,
                },
            ]}
        >
            <Pressable onPress={openImage} disabled={!uri} style={styles.imageButton}>
                <Image
                    source={uri ? { uri } : undefined}
                    placeholder={placeholder}
                    style={[styles.preview, { height: imageHeight }]}
                    contentFit="cover"
                    transition={150}
                />
                {!uri && (
                    <View style={[styles.loadingOverlay, { backgroundColor: theme.colors.surfaceHigh }]}>
                        <Ionicons name="image-outline" size={22} color={theme.colors.textSecondary} />
                    </View>
                )}
            </Pressable>
            <View style={styles.cardBody}>
                <Text numberOfLines={1} style={[styles.cardTitle, { color: theme.colors.text }]}>
                    {item.name}
                </Text>
                <Text numberOfLines={1} style={[styles.meta, { color: theme.colors.textSecondary }]}>
                    {new Date(item.createdAt).toLocaleString()} · {item.sessionTitle}
                </Text>
                <Text numberOfLines={2} style={[styles.prompt, { color: prompt ? theme.colors.text : theme.colors.textSecondary }]}>
                    {prompt || t('generatedImages.promptMissing')}
                </Text>
                <Pressable
                    onPress={() => router.push({ pathname: '/session/[id]', params: { id: item.sessionId } })}
                    style={({ pressed }) => [
                        styles.sessionButton,
                        {
                            backgroundColor: theme.colors.surfaceHigh,
                            opacity: pressed ? 0.72 : 1,
                        },
                    ]}
                >
                    <Ionicons name="chatbubble-ellipses-outline" size={14} color={theme.colors.text} />
                    <Text numberOfLines={1} style={[styles.sessionButtonText, { color: theme.colors.text }]}>
                        {t('generatedImages.openSession')}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    container: {
        flex: 1,
    },
    content: {
        alignSelf: 'center',
        paddingBottom: 28,
        paddingHorizontal: 16,
        width: '100%',
    },
    header: {
        paddingBottom: 12,
        paddingTop: 18,
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: '700',
        letterSpacing: 0,
    },
    headerSubtitle: {
        fontSize: 13,
        lineHeight: 18,
        marginTop: 4,
    },
    card: {
        borderRadius: 8,
        borderWidth: 1,
        marginBottom: CARD_GAP,
        overflow: 'hidden',
    },
    imageButton: {
        position: 'relative',
    },
    preview: {
        width: '100%',
    },
    loadingOverlay: {
        alignItems: 'center',
        bottom: 0,
        justifyContent: 'center',
        left: 0,
        position: 'absolute',
        right: 0,
        top: 0,
    },
    cardBody: {
        flex: 1,
        gap: 6,
        padding: 10,
    },
    cardTitle: {
        fontSize: 13,
        fontWeight: '700',
    },
    meta: {
        fontSize: 11,
        lineHeight: 15,
    },
    prompt: {
        flex: 1,
        fontSize: 12,
        lineHeight: 17,
    },
    sessionButton: {
        alignItems: 'center',
        borderRadius: 8,
        flexDirection: 'row',
        gap: 6,
        justifyContent: 'center',
        minHeight: 32,
        paddingHorizontal: 8,
    },
    sessionButtonText: {
        fontSize: 12,
        fontWeight: '700',
    },
    empty: {
        alignItems: 'center',
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 28,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '700',
        marginTop: 14,
        textAlign: 'center',
    },
    emptyText: {
        fontSize: 14,
        lineHeight: 20,
        marginTop: 8,
        textAlign: 'center',
    },
}));
