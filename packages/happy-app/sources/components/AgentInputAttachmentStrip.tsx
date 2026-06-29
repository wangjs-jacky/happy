/**
 * Horizontal scrollable strip showing selected image attachment thumbnails.
 * Each thumbnail shows the image with a remove button.
 * Uses thumbhash as a blurry placeholder while the full image loads.
 */
import * as React from 'react';
import { View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { AttachmentPreview } from '@/sync/attachmentTypes';
import { thumbhashToDataUri } from '@/utils/thumbhash';
import { imageViewer } from '@/sync/imageViewer';
import { HorizontalScrollView } from '@/components/HorizontalScrollView';

const THUMB_SIZE = 72;
const BORDER_RADIUS = 12;

interface AgentInputAttachmentStripProps {
    images: AttachmentPreview[];
    onRemove: (id: string) => void;
}

export function AgentInputAttachmentStrip({ images, onRemove }: AgentInputAttachmentStripProps) {
    const { theme } = useUnistyles();

    if (images.length === 0) return null;

    return (
        // HorizontalScrollView arbitrates against the full-width drawer open
        // gesture so swiping this strip doesn't yank the sidebar out. See
        // HorizontalScrollView.tsx / AttachmentGalleryView for the rationale.
        <HorizontalScrollView
            showsHorizontalScrollIndicator={false}
            style={styles.strip}
            contentContainerStyle={styles.stripContent}
            keyboardShouldPersistTaps="always"
        >
            {images.map((img, index) => (
                <AttachmentThumbnail
                    key={img.id}
                    image={img}
                    index={index}
                    images={images}
                    onRemove={onRemove}
                    theme={theme}
                />
            ))}
        </HorizontalScrollView>
    );
}

function AttachmentThumbnail({
    image,
    index,
    images,
    onRemove,
    theme,
}: {
    image: AttachmentPreview;
    index: number;
    images: AttachmentPreview[];
    onRemove: (id: string) => void;
    theme: any;
}) {
    // Build placeholder from thumbhash if available
    const placeholder = React.useMemo(() => {
        if (!image.thumbhash) return undefined;
        const uri = thumbhashToDataUri(image.thumbhash);
        return uri ? { uri } : undefined;
    }, [image.thumbhash]);

    return (
        <View style={styles.thumbContainer}>
            {/* Tap the image to open the fullscreen swipeable viewer at this one. */}
            <Pressable
                onPress={() => imageViewer.open(
                    images.map((it) => ({ uri: it.uri, width: it.width, height: it.height })),
                    index,
                )}
                style={[styles.thumbPressable, { borderColor: theme.colors.divider }]}
            >
                <Image
                    source={{ uri: image.uri }}
                    placeholder={placeholder}
                    style={[{ width: THUMB_SIZE, height: THUMB_SIZE }, styles.thumb]}
                    contentFit="cover"
                    transition={150}
                />
            </Pressable>
            {/* Remove button — sits above the image so its tap doesn't open the viewer. */}
            <Pressable
                onPress={() => onRemove(image.id)}
                hitSlop={6}
                style={(p) => [
                    styles.removeButton,
                    {
                        backgroundColor: theme.colors.surfaceHigh,
                        borderColor: theme.colors.divider,
                        opacity: p.pressed ? 0.7 : 1,
                    },
                ]}
            >
                <Ionicons name="close" size={12} color={theme.colors.text} />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    strip: {
        marginBottom: 8,
        marginHorizontal: 8,
    },
    stripContent: {
        flexDirection: 'row',
        gap: 8,
        // 删除按钮绝对定位在缩略图框外侧（top/right: -6），ScrollView 会裁切超出内容区的子元素，
        // 故内边距需 ≥6px 把按钮兜进可滚动区域，否则最右/最上缩略图的 ❌ 会被裁掉
        paddingHorizontal: 8,
        paddingTop: 8,
    },
    thumbContainer: {
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        overflow: 'visible',
        position: 'relative',
    },
    thumbPressable: {
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        borderRadius: BORDER_RADIUS,
        borderWidth: 1,
        overflow: 'hidden',
    },
    thumb: {
        borderRadius: BORDER_RADIUS,
    },
    removeButton: {
        position: 'absolute',
        top: -6,
        right: -6,
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
    },
}));
