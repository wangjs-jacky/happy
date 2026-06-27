/**
 * Horizontal gallery for consecutive user image attachments.
 *
 * The wire/sync format still stores each sent image as its own `file`
 * tool-call message (see sync.ts). useGroupedMessages collapses a run of
 * adjacent user attachments into a single `image-group` DisplayItem, which
 * this component renders as a Kimi-style horizontally scrollable row of
 * square thumbnails instead of a tall vertical stack of full-width images.
 *
 * Each thumbnail reuses the same decrypt/cache pipeline as FileView
 * (useAttachmentImage + thumbhash placeholder) and opens the fullscreen
 * zoomable viewer on tap.
 */
import * as React from 'react';
import { ScrollView, View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { z } from 'zod';
import { Message } from '@/sync/typesMessage';
import { useAttachmentImage } from '@/hooks/useAttachmentImage';
import { thumbhashToDataUri } from '@/utils/thumbhash';
import { imageViewer } from '@/sync/imageViewer';

const THUMB_SIZE = 100;
const BORDER_RADIUS = 10;

// Same shape FileView parses out of a `file` tool call's input.
const fileInputSchema = z.object({
    ref: z.string(),
    name: z.string(),
    size: z.number().optional(),
    image: z.object({
        width: z.number(),
        height: z.number(),
        thumbhash: z.string().optional(),
    }).optional(),
});

type GalleryImage = {
    id: string;
    ref: string;
    name: string;
    width?: number;
    height?: number;
    thumbhash?: string;
};

/** Extract renderable image descriptors from a run of `file` messages. */
function toGalleryImages(messages: Message[]): GalleryImage[] {
    const result: GalleryImage[] = [];
    for (const msg of messages) {
        if (msg.kind !== 'tool-call' || msg.tool.name !== 'file') continue;
        const parsed = fileInputSchema.safeParse(msg.tool.input);
        if (!parsed.success) continue;
        const { ref, name, image } = parsed.data;
        result.push({
            id: msg.id,
            ref,
            name,
            width: image?.width,
            height: image?.height,
            thumbhash: image?.thumbhash,
        });
    }
    return result;
}

export const AttachmentGalleryView = React.memo<{
    messages: Message[];
    sessionId: string;
}>(({ messages, sessionId }) => {
    const images = React.useMemo(() => toGalleryImages(messages), [messages]);

    if (images.length === 0) return null;

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.strip}
            contentContainerStyle={styles.stripContent}
        >
            {images.map((img) => (
                <GalleryThumbnail key={img.id} image={img} sessionId={sessionId} />
            ))}
        </ScrollView>
    );
});

const GalleryThumbnail = React.memo<{
    image: GalleryImage;
    sessionId: string;
}>(({ image, sessionId }) => {
    const { theme } = useUnistyles();

    const placeholder = React.useMemo(() => {
        if (!image.thumbhash) return undefined;
        const uri = thumbhashToDataUri(image.thumbhash);
        return uri ? { uri } : undefined;
    }, [image.thumbhash]);

    const { uri, error } = useAttachmentImage(sessionId, sessionId ? image.ref : undefined);

    return (
        <Pressable
            onPress={uri ? () => imageViewer.open({ uri, width: image.width, height: image.height }) : undefined}
            disabled={!uri}
            style={[styles.thumbWrapper, { borderColor: theme.colors.divider }]}
        >
            <Image
                source={uri ? { uri } : undefined}
                placeholder={placeholder}
                style={[{ width: THUMB_SIZE, height: THUMB_SIZE }, styles.thumb]}
                contentFit="cover"
                transition={150}
            />
            {error && !uri && (
                <View style={[styles.errorOverlay, { backgroundColor: theme.colors.surfaceHigh }]}>
                    <Ionicons name="alert-circle-outline" size={20} color={theme.colors.textSecondary} />
                </View>
            )}
        </Pressable>
    );
});

const styles = StyleSheet.create(() => ({
    strip: {
        marginHorizontal: 8,
        marginVertical: 8,
    },
    stripContent: {
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 4,
    },
    thumbWrapper: {
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        borderRadius: BORDER_RADIUS,
        borderWidth: 1,
        overflow: 'hidden',
        position: 'relative',
    },
    thumb: {
        borderRadius: BORDER_RADIUS,
    },
    errorOverlay: {
        position: 'absolute',
        top: 4,
        right: 4,
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));
