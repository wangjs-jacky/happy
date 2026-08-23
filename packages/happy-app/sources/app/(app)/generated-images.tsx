import * as React from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useGeneratedImages, type GeneratedImageEntry } from '@/hooks/useGeneratedImages';
import { t } from '@/text';
import { layout } from '@/components/layout';
import { GeneratedImageCard } from '@/components/GeneratedImageCard';

const CARD_GAP = 12;
const MIN_CARD_WIDTH = 168;
const MAX_COLUMNS = 4;

export default React.memo(function GeneratedImagesScreen() {
    const { theme } = useUnistyles();
    const dimensions = useWindowDimensions();
    const images = useGeneratedImages();
    const contentWidth = Math.min(layout.maxWidth, dimensions.width);
    const columns = Math.max(1, Math.min(
        MAX_COLUMNS,
        Math.floor((contentWidth - 32 + CARD_GAP) / (MIN_CARD_WIDTH + CARD_GAP)),
    ));
    const cardWidth = Math.floor((contentWidth - 32 - CARD_GAP * (columns - 1)) / columns);

    const renderItem = React.useCallback(({ item }: { item: GeneratedImageEntry }) => (
        <GeneratedImageCard
            item={item}
            cardWidth={cardWidth}
        />
    ), [cardWidth]);

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
        <FlashList
            data={images}
            key={columns}
            keyExtractor={(item) => item.id}
            masonry
            numColumns={columns}
            optimizeItemArrangement
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
