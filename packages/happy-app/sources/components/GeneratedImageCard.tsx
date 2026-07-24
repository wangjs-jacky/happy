import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { GeneratedImageEntry } from '@/hooks/useGeneratedImages';
import { useAttachmentImage } from '@/hooks/useAttachmentImage';
import { imageViewer } from '@/sync/imageViewer';
import { t } from '@/text';
import { thumbhashToDataUri } from '@/utils/thumbhash';

export const GeneratedImageCard = React.memo(function GeneratedImageCard(props: {
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
                    marginRight: props.isLastColumn ? 0 : 10,
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.divider,
                },
            ]}
        >
            <Pressable
                accessibilityLabel={t('generatedImages.openImage')}
                accessibilityRole="button"
                accessibilityState={{ disabled: !uri }}
                onPress={openImage}
                disabled={!uri}
                style={styles.imageButton}
            >
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
                    accessibilityLabel={t('generatedImages.openSession')}
                    accessibilityRole="button"
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
    card: {
        borderRadius: 8,
        borderWidth: 1,
        marginBottom: 10,
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
}));
